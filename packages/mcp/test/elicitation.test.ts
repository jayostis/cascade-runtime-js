import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { openPod } from "cascade-runtime";
import { type PodReads, TOOLS } from "cascade-runtime/tools";
import { PROPOSAL_TOOLS, toolsFor } from "cascade-runtime/tools/propose";
import { podServer } from "../src/server.js";

const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const LATE_MS = 600;
const ASK_TOOLS = PROPOSAL_TOOLS.map(({ name }) => name);
const ASTHMA = `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
<urn:cascade:output-0> a cascade:ProblemOrDiagnosis .
<urn:cascade:output-0-version> prov:specializationOf <urn:cascade:output-0> ;
  cascade:conditionName "Asthma" ;
  cascade:clinicalStatus "active" ;
  cascade:patient <urn:uuid:1b4e6a52-8c3f-4d71-9e0a-5f2c7d8b9a10> .
`;
const PROPOSALS: Record<string, Record<string, unknown>> = {
  propose_entry: { pod: "p", turtle: ASTHMA },
  propose_judgment: {
    pod: "p",
    verdict: "different",
    members: [
      "urn:uuid:19bf6db0-83b8-8973-a79a-6b36138cb69b",
      "urn:uuid:df9490a2-ae95-87ef-a856-b899697aaf11",
    ],
  },
  propose_retraction: {
    pod: "p",
    judgment: "urn:uuid:5e068021-5ff8-4580-8246-4f28453ace64",
  },
};

/** What a client's person does with a question: the action it answers, or never answering. */
type Said =
  | "accept"
  | "decline"
  | "cancel"
  | "silence"
  | "accept without ticking"
  | "accept leaving the box out"
  | "accept with a box that is not a boolean"
  | "accept after the client stopped waiting";

interface Connected {
  readonly client: Client;
  readonly written: {
    pod: string;
    proposal: unknown;
    model: { iri: string; label: string };
  }[];
  readonly shown: string[];
  said: Said;
  close(): Promise<void>;
}

/** A server over reads that record their writes, and a client that can show a question (`asks`) or cannot, linked in memory. */
async function connect(
  clientInfo: { name: string; version: string },
  asks: boolean,
  waitMs?: number,
): Promise<Connected> {
  const written: Connected["written"] = [];
  const shown: string[] = [];
  const reads = {
    pods: async () => ({ pods: [{ name: "p" }] }),
    write: async (input: Connected["written"][number]) => {
      written.push(input);
      return { entry: "urn:written" };
    },
  } as unknown as PodReads;
  const client = new Client(clientInfo, {
    capabilities: asks ? { elicitation: {} } : {},
  });
  const connected: Connected = {
    client,
    written,
    shown,
    said: "accept",
    close: () => client.close(),
  };
  if (asks)
    client.setRequestHandler("elicitation/create", async (request) => {
      shown.push(request.params.message);
      switch (connected.said) {
        case "silence":
          return new Promise<never>(() => undefined);
        case "accept":
          return { action: "accept", content: { yes: true } };
        case "accept without ticking":
          return { action: "accept", content: { yes: false } };
        case "accept leaving the box out":
          return { action: "accept", content: {} };
        case "accept with a box that is not a boolean":
          return { action: "accept", content: { yes: "yes" } };
        case "accept after the client stopped waiting":
          await new Promise((resolve) => setTimeout(resolve, LATE_MS));
          return { action: "accept", content: { yes: true } };
        default:
          return { action: connected.said };
      }
    });
  const [toServer, toClient] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    podServer(reads, waitMs === undefined ? {} : { waitMs }).connect(toServer),
    client.connect(toClient),
  ]);
  return connected;
}

/** A tool's answer as the client reads it: its text, parsed as JSON unless the call failed. */
async function call(
  client: Client,
  name: string,
  input: Record<string, unknown>,
) {
  const result = await client
    .callTool({ name, arguments: input })
    .catch((error: Error) => ({
      isError: true,
      content: [{ text: error.message }],
    }));
  const [first] = result.content as { text: string }[];
  return result.isError === true
    ? { refused: first!.text }
    : { value: JSON.parse(first!.text) as unknown };
}

/**
 * `cascade-mcp` offers the tools that propose a write only to a client that declares it can show the person a question
 * (MCP elicitation), and asks the person with each call: a write happens only on a yes, to that call.
 * @rule runtime/consent.feature Y2
 */
describe("Asking the person before a write · elicitation", () => {
  describe("when a client declares no elicitation capability", () => {
    let none: Connected;
    before(async () => {
      none = await connect({ name: "plain", version: "1.0.0" }, false);
    });
    after(() => none.close());

    it("lists the tools that read and none that propose a write", async () => {
      assert.deepEqual(
        (await none.client.listTools()).tools.map(({ name }) => name).sort(),
        TOOLS.map(({ name }) => name).sort(),
      );
    });

    it("refuses a call to a tool that proposes a write, asks nothing and writes nothing", async () => {
      for (const name of ASK_TOOLS) {
        const { refused } = await call(none.client, name, PROPOSALS[name]!);
        assert.match(refused ?? "", /disabled|cannot ask|not offered/i, name);
      }
      assert.deepEqual(none.written, []);
    });
  });

  describe("when a client declares elicitation", () => {
    let asks: Connected;
    before(async () => {
      asks = await connect({ name: "Test Client", version: "2.5.1" }, true);
    });
    after(() => asks.close());

    it("lists every tool of `cascade-runtime/tools`", async () => {
      assert.deepEqual(
        (await asks.client.listTools()).tools.map(({ name }) => name).sort(),
        toolsFor({ canAsk: true })
          .map(({ name }) => name)
          .sort(),
      );
    });

    it("sets each tool's annotations from its tier: `readOnlyHint` for a tool at free, and `destructiveHint` without it for a tool at ask", async () => {
      const { tools } = await asks.client.listTools();
      for (const tool of tools) {
        const tier = toolsFor({ canAsk: true }).find(
          ({ name }) => name === tool.name,
        )!.tier;
        assert.equal(
          tool.annotations?.readOnlyHint,
          tier === "free",
          `${tool.name} is at ${tier}`,
        );
        if (tier === "ask")
          assert.equal(tool.annotations?.destructiveHint, true, tool.name);
      }
    });

    it("no longer says it is read only, in its description or its instructions", () => {
      const said = JSON.stringify([
        asks.client.getServerVersion(),
        asks.client.getInstructions(),
      ]);
      assert.doesNotMatch(said, /read only|read-only/i);
    });

    for (const name of ASK_TOOLS) {
      it(`${name}: asks once, naming the client, and writes the proposal when the person accepts`, async () => {
        asks.said = "accept";
        asks.written.length = asks.shown.length = 0;
        const { value } = await call(asks.client, name, PROPOSALS[name]!);
        assert.equal(asks.shown.length, 1);
        assert.match(asks.shown[0]!, /Test Client 2\.5\.1/);
        assert.equal(asks.written.length, 1);
        assert.equal(asks.written[0]!.model.label, "Test Client 2.5.1");
        assert.match(asks.written[0]!.model.iri, /^urn:uuid:[0-9a-f-]{36}$/);
        assert.equal((value as { written: boolean }).written, true);
      });

      for (const [said, answer] of [
        ["decline", "no"],
        ["cancel", "dismissed"],
        ["accept without ticking", "dismissed"],
        ["accept leaving the box out", "dismissed"],
        ["accept with a box that is not a boolean", "dismissed"],
      ] as const)
        it(`${name}: writes nothing, and says ${answer}, when the person's action is ${said}`, async () => {
          asks.said = said;
          asks.written.length = asks.shown.length = 0;
          const { value } = await call(asks.client, name, PROPOSALS[name]!);
          assert.deepEqual(asks.written, []);
          assert.equal(asks.shown.length, 1);
          assert.deepEqual(value, { written: false, said: answer });
        });
    }

    it("asks again for the same call, so a yes is for the one call it answers", async () => {
      asks.said = "accept";
      asks.written.length = asks.shown.length = 0;
      await call(asks.client, "propose_entry", PROPOSALS.propose_entry!);
      await call(asks.client, "propose_entry", PROPOSALS.propose_entry!);
      assert.equal(asks.shown.length, 2);
      assert.equal(asks.written.length, 2);
    });

    it("names the same model for every call of the connection, and another model for another connection", async () => {
      asks.said = "accept";
      asks.written.length = 0;
      await call(asks.client, "propose_entry", PROPOSALS.propose_entry!);
      await call(
        asks.client,
        "propose_retraction",
        PROPOSALS.propose_retraction!,
      );
      const other = await connect({ name: "Other", version: "0.1" }, true);
      try {
        await call(other.client, "propose_entry", PROPOSALS.propose_entry!);
        const [one, two] = asks.written.map(({ model }) => model.iri);
        assert.equal(one, two);
        assert.notEqual(one, other.written[0]!.model.iri);
      } finally {
        await other.close();
      }
    });
  });

  describe("when a person leaves the question unanswered", () => {
    it("writes nothing after the server stops waiting, and says the question was unanswered", async () => {
      const asks = await connect({ name: "Slow", version: "1" }, true, 200);
      try {
        asks.said = "silence";
        const { value } = await call(
          asks.client,
          "propose_entry",
          PROPOSALS.propose_entry!,
        );
        assert.deepEqual(value, { written: false, said: "unanswered" });
        assert.deepEqual(asks.written, []);
      } finally {
        await asks.close();
      }
    });
  });

  describe("when the client stops waiting for a call before the person answers", () => {
    it("writes nothing when the person says yes after the client gave up on the call", async () => {
      const asks = await connect({ name: "Impatient", version: "1" }, true);
      try {
        asks.said = "accept after the client stopped waiting";
        const result = await asks.client
          .callTool(
            { name: "propose_entry", arguments: PROPOSALS.propose_entry! },
            { timeout: LATE_MS / 4 },
          )
          .then(
            () => "answered",
            () => "gave up",
          );
        assert.equal(result, "gave up");
        await new Promise((resolve) => setTimeout(resolve, LATE_MS * 2));
        assert.equal(asks.shown.length, 1);
        assert.deepEqual(asks.written, []);
      } finally {
        await asks.close();
      }
    });
  });

  describe("when a client speaks the 2026-07-28 revision to `cascade-mcp --pods`", () => {
    it("lists the tools that read and none that propose a write", async () => {
      const folder = await mkdtemp(join(tmpdir(), "cascade-mcp-modern-"));
      const client = new Client(
        { name: "modern-client", version: "1.0.0" },
        {
          capabilities: { elicitation: {} },
          versionNegotiation: { mode: { pin: "2026-07-28" } },
        },
      );
      try {
        await client.connect(
          new StdioClientTransport({
            command: process.execPath,
            args: [CLI, "--pods", folder],
          }),
        );
        assert.deepEqual(
          (await client.listTools()).tools.map(({ name }) => name).sort(),
          TOOLS.map(({ name }) => name).sort(),
        );
      } finally {
        await client.close();
        await rm(folder, { recursive: true, force: true, maxRetries: 5 });
      }
    });
  });

  describe("when `cascade-mcp --pods` serves a pod to a client that accepts", () => {
    let folder: string;
    let client: Client;
    let said: "accept" | "decline" = "accept";
    let subject: string;

    before(
      async () => {
        folder = await mkdtemp(join(tmpdir(), "cascade-mcp-ask-"));
        const made = await openPod(join(folder, "p"));
        subject = made.subject;
        await made.close();
        client = new Client(
          { name: "stdio-client", version: "3.1.4" },
          { capabilities: { elicitation: {} } },
        );
        client.setRequestHandler("elicitation/create", async () =>
          said === "accept"
            ? { action: "accept", content: { yes: true } }
            : { action: "decline" },
        );
        await client.connect(
          new StdioClientTransport({
            command: process.execPath,
            args: [CLI, "--pods", folder],
          }),
        );
      },
      { timeout: 120_000 },
    );

    after(async () => {
      await client?.close();
      await rm(folder, { recursive: true, force: true, maxRetries: 5 });
    });

    const conditions = async () =>
      (
        (
          (
            await call(client, "ask", {
              pod: "p",
              question: "pod/My condition history",
            })
          ).value as { rows: { name?: string; condition?: string }[] }
        ).rows ?? []
      ).length;

    it("writes nothing to the pod when the person declines", async () => {
      said = "decline";
      const before = await conditions();
      await call(client, "propose_entry", PROPOSALS.propose_entry!);
      assert.equal(await conditions(), before);
    });

    it("writes the entry, then a judgment of its record, then the judgment's retraction, when the person accepts each", async () => {
      said = "accept";
      const before = await conditions();
      const entry = await call(client, "propose_entry", {
        pod: "p",
        turtle: ASTHMA.replace(/<urn:uuid:[^>]*>/, `<${subject}>`),
      });
      assert.equal((entry.value as { written: boolean }).written, true);
      assert.equal(await conditions(), before + 1);
      const { rows } = (
        await call(client, "ask", {
          pod: "p",
          question: "entry/Where it came from",
        })
      ).value as { rows: { record: string }[] };
      const judged = await call(client, "propose_judgment", {
        pod: "p",
        verdict: "erroneous",
        members: [rows[0]!.record],
      });
      const { id } = judged.value as { written: boolean; id: string };
      assert.equal((judged.value as { written: boolean }).written, true);
      assert.match(id, /^urn:uuid:/);
      assert.equal(await conditions(), before, "the judgment sets it aside");
      const retracted = await call(client, "propose_retraction", {
        pod: "p",
        judgment: id,
      });
      assert.equal((retracted.value as { written: boolean }).written, true);
      assert.equal(
        await conditions(),
        before + 1,
        "the retraction restores it",
      );
    });
  });
});
