import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { loadHospital, loadStories } from "@the-cascade-protocol/sandbox/node";
import { openPod, type Pod, pullFiles } from "cascade-runtime";
import { pulled } from "./hospitals.js";
import { settled } from "./settled.js";

type Api = { close(): Promise<void> };

const { podServer, QUESTIONS, WARNING } = (await import(
  new URL("../../starter/mcp-server.mjs", import.meta.url).href
)) as {
  podServer: (
    api: Api,
    options?: { viewOf(pod: string, trend: object): string },
  ) => { build(): { connect(transport: unknown): Promise<void> } };
  QUESTIONS: string[];
  WARNING: string;
};
const { podApi } = (await import(
  new URL("../../starter/pod-api.mjs", import.meta.url).href
)) as { podApi: (host: object) => Api };
const { nodeHost } = (await import(
  new URL("../../starter/node-host.mjs", import.meta.url).href
)) as {
  nodeHost: (options: { folder: string; opensEncrypted: boolean }) => object;
};
const { trendUrl } = (await import(
  new URL("../../starter/pods.mjs", import.meta.url).href
)) as { trendUrl: (pod: string, trend: object) => string };

const STATIN = "story-statin";
const pods = new Map<string, Pod>();
let api: Api;
let client: Client;

/** A client connected to `podServer(served, options)`, in memory. */
async function clientOf(
  served: Api,
  options?: { viewOf(pod: string, trend: object): string },
) {
  const [toServer, toClient] = InMemoryTransport.createLinkedPair();
  await podServer(served, options).build().connect(toServer);
  const connected = new Client({ name: "test", version: "0.0.0" });
  await connected.connect(toClient);
  return connected;
}

/** What a tool call gave: its text read as JSON, and whether it was a tool error. */
async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as { type: string; text: string }[];
  assert.equal(first!.type, "text");
  return { error: result.isError === true, text: first!.text };
}

before(async () => {
  const north = await loadHospital("cascade-north");
  const story = (await loadStories()).find(
    ({ patient }) => patient === STATIN,
  )!;
  const { pull } = await pulled(north, story.patient);
  const statin = await openPod();
  const imported = await statin.import(pullFiles(pull, "north"), {
    aboutSubject: true,
  });
  assert.equal(imported.refused, undefined);
  pods.set(STATIN, statin);

  api = podApi({
    pods: {
      names: async () => [...pods.keys()],
      title: async () => undefined,
      open: async (name: string) => pods.get(name)!,
    },
    tables: async () => {
      throw new Error("no tables here");
    },
    opensEncrypted: false,
    unsaid() {},
  });
  client = await clientOf(api, { viewOf: trendUrl });
});

after(async () => {
  await client.close();
  await api.close();
});

test("a client lists the pods and the tools, each but the list taking the pod's name, and is warned that a hosted client sends the answers to its provider", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(({ name }) => name).sort(), [
    "ask",
    "find_changes",
    "finding_rows",
    "lab_series",
    "list_pods",
    "timeline",
    "worth_a_look",
  ]);
  for (const { name, inputSchema } of tools)
    assert.equal(
      (inputSchema.required as string[] | undefined)?.includes("pod") ?? false,
      name !== "list_pods",
      name,
    );
  const ask = tools.find(({ name }) => name === "ask")!;
  assert.deepEqual(
    (ask.inputSchema.properties as Record<string, { enum?: string[] }>)
      .question!.enum,
    QUESTIONS,
  );
  assert.ok(client.getInstructions()?.includes(WARNING));
  assert.match(
    client.getInstructions() ?? "",
    /worth_a_look is a good first call/,
  );

  assert.deepEqual(JSON.parse((await call("list_pods", {})).text), [STATIN]);
});

test("each finding of find_changes carries the address of the app's trend page for it", async () => {
  const found = await call("find_changes", { pod: STATIN });
  assert.equal(found.error, false);
  const [finding] = JSON.parse(found.text) as { key: string; view: string }[];
  assert.equal(finding!.key, "start:617310:18262-6");
  const view = new URL(finding!.view);
  assert.match(view.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(
    view.pathname + view.search,
    "/pods/story-statin/trend?test=18262-6&medication=617310",
  );
});

test("input the tool's schema refuses is a tool error that says why, never a crash: a question outside the list, a missing pod, a property it does not take", async () => {
  const refused: [string, Record<string, unknown>, RegExp][] = [
    [
      "ask",
      { pod: STATIN, question: "pod/Which files are out of place" },
      /data\/question must be equal to one of the allowed values/,
    ],
    [
      "ask",
      { pod: STATIN, question: "SELECT * WHERE { ?s ?p ?o }" },
      /data\/question must be equal to one of the allowed values/,
    ],
    ["find_changes", {}, /required property 'pod'/],
    ["timeline", { pod: STATIN, extra: true }, /additional properties/],
  ];
  for (const [name, args, reason] of refused) {
    const { error, text } = await call(name, args);
    assert.ok(error, `${name} ${JSON.stringify(args)}`);
    assert.match(text, reason, `${name} ${JSON.stringify(args)}`);
  }
});

test("an error that is not a refusal is logged and reaches the client as a fixed message, never its own, so a path in it does not leave", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const broken = podApi({
    pods: {
      names: async () => ["broken"],
      title: async () => undefined,
      open: async () => {
        throw new Error("ENOENT: open 'C:/private/path'");
      },
    },
    opensEncrypted: false,
  });
  const other = await clientOf(broken);
  const result = await other.callTool({
    name: "find_changes",
    arguments: { pod: "broken" },
  });
  const [first] = result.content as { text: string }[];
  assert.equal(result.isError, true);
  assert.doesNotMatch(first!.text, /private/);
  assert.equal(logged.mock.callCount(), 1);
  await other.close();
});

test("an encrypted pod is listed, and a tool asked about it says in one line that this server does not open it", async () => {
  const folder = await mkdtemp(join(tmpdir(), "t351-mcp-"));
  const words = "abacus abdomen abide abnormal abrasion abrupt";
  try {
    await (await openPod(join(folder, "sealed"), { secret: words })).close();
    const elsewhere = podApi(nodeHost({ folder, opensEncrypted: false }));
    const sealed = await clientOf(elsewhere);
    try {
      const listed = await sealed.callTool({
        name: "list_pods",
        arguments: {},
      });
      assert.deepEqual(
        JSON.parse((listed.content as { text: string }[])[0]!.text),
        ["sealed"],
      );
      const asked = await sealed.callTool({
        name: "ask",
        arguments: { pod: "sealed", question: QUESTIONS[0] },
      });
      assert.equal(asked.isError, true);
      const [first] = asked.content as { text: string }[];
      assert.match(first!.text, /^sealed is encrypted: open it in the app/);
      assert.equal(first!.text.includes(words), false);
    } finally {
      await sealed.close();
      await elsewhere.close();
    }
  } finally {
    await settled(folder);
    await rm(folder, { recursive: true, force: true });
  }
});
