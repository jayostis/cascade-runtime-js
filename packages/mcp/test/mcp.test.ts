import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { openPod, sixWords } from "cascade-runtime";
import { replayKit } from "cascade-runtime/fixtures";

/** A folder cascade-mcp's and cascade-runtime's tarballs are installed in, to run `npx cascade-mcp` as a person would. */
const APP =
  process.env.CASCADE_RUNTIME_APP === undefined
    ? undefined
    : resolve(process.env.CASCADE_RUNTIME_APP);
const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

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

before(
  async () => {
    folder = await mkdtemp(join(tmpdir(), "cascade-mcp-"));
    await replayKit("alex-rivera", join(folder, "alex-rivera"), {
      through: "E2",
    });
    await (
      await openPod(join(folder, "locked"), { secret: sixWords() })
    ).close();
    const pods = ["--pods", folder];
    client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport(
        APP === undefined
          ? { command: process.execPath, args: [CLI, ...pods] }
          : {
              command: "npx",
              args: ["--no-install", "cascade-mcp", ...pods],
              cwd: APP,
            },
      ),
    );
  },
  { timeout: 120_000 },
);

after(async () => {
  await client?.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 5 });
});

test("cascade-mcp on stdio offers the read tools, and a question's rows each name their entry", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(({ name }) => name).sort(), [
    "ask",
    "find_changes",
    "finding_rows",
    "lab_series",
    "list_pods",
    "timeline",
  ]);
  assert.deepEqual((await call("list_pods", {})).value, [
    "alex-rivera",
    "locked",
  ]);
  const { value } = await call("ask", {
    pod: "alex-rivera",
    question: "pod/My active allergies",
  });
  const { rows } = value as { rows: Record<string, string>[] };
  assert.ok(rows.length > 0, "Alex's first export holds an allergy");
  for (const row of rows) assert.match(row.entry ?? "", /^pod:\/\/.+#/);
});

test("cascade-mcp refuses, saying why, a pod there is not, an encrypted pod and a question it does not offer", async () => {
  for (const [input, said] of [
    [
      { pod: "nobody", question: "pod/My lab results" },
      /there is no pod nobody/,
    ],
    [{ pod: "locked", question: "pod/My lab results" }, /locked is encrypted/],
    [
      { pod: "alex-rivera", question: "pod/What everything is called" },
      /question/,
    ],
  ] as const)
    assert.match((await call("ask", input)).refused ?? "", said);
});
