import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { openPod, sixWords } from "cascade-runtime";
import { replayKit } from "cascade-runtime/fixtures";
import { TOOLS } from "cascade-runtime/tools";

/** A folder cascade-mcp's and cascade-runtime's tarballs are installed in, to run the `cascade-mcp` bin they installed. */
const APP =
  process.env.CASCADE_RUNTIME_APP === undefined
    ? undefined
    : resolve(process.env.CASCADE_RUNTIME_APP);

/** The script to start: the installed package's `cascade-mcp` bin, or this package's own. `npx` is `npx.cmd` on Windows, so node starts the script. */
const CLI =
  APP === undefined
    ? fileURLToPath(new URL("../src/cli.js", import.meta.url))
    : join(
        APP,
        "node_modules",
        "cascade-mcp",
        (
          JSON.parse(
            readFileSync(
              join(APP, "node_modules", "cascade-mcp", "package.json"),
              "utf8",
            ),
          ) as { bin: { "cascade-mcp": string } }
        ).bin["cascade-mcp"],
      );

/** The command, its arguments and its folder that start cascade-mcp with `args`, as the tests start it. */
const command = (args: string[]) => ({
  command: process.execPath,
  args: [CLI, ...args],
  ...(APP === undefined ? {} : { cwd: APP }),
});

let folder: string;
let client: Client;

/** A tool's answer: its text as JSON, or, for an error, the text. */
async function call(name: string, input: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: input });
  const [first] = result.content as { type: string; text: string }[];
  return result.isError === true
    ? { refused: first!.text }
    : { value: JSON.parse(first!.text) as unknown };
}

interface Ended {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** cascade-mcp started with `args` and left to end, which it does for a start it cannot serve. */
function endsWith(args: string[]): Promise<Ended> {
  return new Promise((done, fail) => {
    const { command: program, args: given, cwd } = command(args);
    const child = spawn(program, given, {
      ...(cwd === undefined ? {} : { cwd }),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk: Buffer) => (stderr += String(chunk)));
    child.on("error", fail);
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
}

const USAGE = "usage: cascade-mcp --pods <folder> [--check-tables]";

before(
  async () => {
    folder = await mkdtemp(join(tmpdir(), "cascade-mcp-"));
    await replayKit("alex-rivera", join(folder, "alex-rivera"), {
      through: "J1",
    });
    await (
      await openPod(join(folder, "locked"), { secret: sixWords() })
    ).close();
    client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StdioClientTransport(command(["--pods", folder])));
  },
  { timeout: 120_000 },
);

after(async () => {
  await client?.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 5 });
});

/**
 * `cascade-mcp --pods <folder>` is started by an MCP client and offers it the tools a model reads a pod with, over the
 * pods in the folder. What each tool returns is on cascade-runtime's page, from "Tools a model reads a pod with" to
 * "Checking a pod against the reference tables"; here is what the command adds.
 */
describe("Serving a folder of pods to an MCP client · cascade-mcp --pods, --check-tables", () => {
  describe("when a client connects", () => {
    it("offers each tool of `cascade-runtime/tools` that reads, by its name, to a client that cannot ask the person", async () => {
      const { tools } = await client.listTools();
      assert.deepEqual(
        tools.map(({ name }) => name).sort(),
        TOOLS.filter(({ tier }) => tier === "free")
          .map(({ name }) => name)
          .sort(),
      );
    });

    it("serves the pods of the folder that `--pods` names", async () => {
      assert.deepEqual((await call("list_pods", {})).value, [
        "alex-rivera",
        "locked",
      ]);
    });

    it("returns the `ask` tool's rows, for a named question of a pod in the folder, as JSON text", async () => {
      const { value } = await call("ask", {
        pod: "alex-rivera",
        question: "pod/My active allergies",
      });
      const { rows } = value as { rows: Record<string, string>[] };
      assert.ok(
        rows.length > 0,
        "a pod of the folder holds an allergy once J1 judges the first export about the person",
      );
    });
  });

  describe("when a tool refuses its input", () => {
    it("answers with `isError` and the tool's reason", async () => {
      assert.match(
        (await call("ask", { pod: "nobody", question: "pod/My lab results" }))
          .refused ?? "",
        /there is no pod nobody/,
      );
    });
  });

  describe("when started without `--check-tables`", () => {
    it('answers `reference_table_checks` with `tables: "off"` and a sentence that names the flag', async () => {
      const { value } = await call("reference_table_checks", {
        pod: "alex-rivera",
      });
      assert.deepEqual(Object.keys(value as object).sort(), ["said", "tables"]);
      assert.equal((value as { tables: string }).tables, "off");
      assert.match((value as { said: string }).said, /--check-tables/);
    });
  });
});

/**
 * The command keeps its standard output for the protocol, so what it has to say to a person goes to standard error.
 * A start it cannot serve ends with status 2 and the usage.
 */
describe("Starting cascade-mcp · --pods, --help", () => {
  const started = new Map<string, Ended>();
  const never = () => resolve(folder, "never-made");

  before(
    async () => {
      const starts = {
        none: [],
        missing: ["--pods", never()],
        unknown: ["--nope"],
        help: ["--help"],
      };
      await Promise.all(
        Object.entries(starts).map(async ([name, args]) => {
          started.set(name, await endsWith(args));
        }),
      );
    },
    { timeout: 120_000 },
  );

  describe("when started with no `--pods`", () => {
    it("exits with status 2, telling the person to give the pods' folder", () => {
      const { status, stdout, stderr } = started.get("none")!;
      assert.equal(status, 2);
      assert.equal(stderr.split("\n")[0], "give the pods' folder with --pods");
      assert.ok(stderr.includes(USAGE));
      assert.equal(stdout, "");
    });
  });

  describe("with a `--pods` that is no folder", () => {
    it("exits with status 2, naming the folder", () => {
      const { status, stdout, stderr } = started.get("missing")!;
      assert.equal(status, 2);
      assert.equal(stderr.split("\n")[0], `${never()} is no folder`);
      assert.equal(stdout, "");
    });
  });

  describe("with a flag it does not have", () => {
    it("exits with status 2, with the usage", () => {
      const { status, stdout, stderr } = started.get("unknown")!;
      assert.equal(status, 2);
      assert.match(stderr.split("\n")[0]!, /--nope/);
      assert.ok(stderr.includes(USAGE));
      assert.equal(stdout, "");
    });
  });

  describe("with `--help`", () => {
    it("prints the usage to standard error and exits with status 0", () => {
      const { status, stdout, stderr } = started.get("help")!;
      assert.equal(status, 0);
      assert.ok(stderr.startsWith(USAGE));
      assert.equal(stdout, "");
    });
  });
});
