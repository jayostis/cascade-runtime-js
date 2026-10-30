// The pod arm's one command: a cascade-mcp tool over the case's pods, called as an MCP client on stdio, its answer
// printed as the server gave it and logged to the run with the entries it named.
import { appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { loadPlan } from "./plan.js";
import { runFolder, type ToolCallRecord } from "./results.js";

const MCP_CLI = join(
  dirname(fileURLToPath(import.meta.resolve("cascade-mcp"))),
  "cli.js",
);

/** Every pod entry an answer names, in the order first named. */
export function entriesIn(value: unknown, found = new Set<string>()): string[] {
  if (typeof value === "string") {
    if (value.startsWith("pod://") && value.includes("#")) found.add(value);
  } else if (Array.isArray(value)) for (const it of value) entriesIn(it, found);
  else if (typeof value === "object" && value !== null)
    for (const it of Object.values(value)) entriesIn(it, found);
  return [...found];
}

function rowsIn(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object" && value !== null) {
    const { total, rows } = value as { total?: unknown; rows?: unknown };
    if (typeof total === "number") return total;
    if (Array.isArray(rows)) return rows.length;
  }
  return 1;
}

export async function podCommand(
  given: string,
  job: string,
  args: string[],
): Promise<string> {
  const folder = runFolder(given);
  const plan = await loadPlan(folder);
  const planned = plan.jobs.find((it) => it.id === job && it.arm === "pod");
  if (planned === undefined)
    throw new Error(`${job} is no pod-arm job of ${plan.run}`);
  const prepared = plan.cases.find((it) => it.id === planned.case)!.prepared;
  const client = new Client({ name: "cascade-evals", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [MCP_CLI, "--pods", prepared.pods],
      stderr: "ignore",
    }),
  );
  try {
    if (args[0] === "--list" || args.length === 0) {
      const { tools } = await client.listTools();
      return `${JSON.stringify(
        tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
        null,
        2,
      )}\n`;
    }
    const [tool, json = "{}"] = args as [string, string?];
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(json) as Record<string, unknown>;
    } catch {
      return `the input is not JSON: ${json}\n`;
    }
    const started = performance.now();
    const result = await client.callTool({ name: tool, arguments: input });
    const [first] = result.content as { type: string; text: string }[];
    const text = first?.text ?? "";
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
    const record: ToolCallRecord = {
      job,
      at: new Date().toISOString(),
      tool,
      input,
      ok: result.isError !== true,
      ...(result.isError === true ? { error: text } : {}),
      rows: result.isError === true ? 0 : rowsIn(value),
      entries: result.isError === true ? [] : entriesIn(value),
      milliseconds: Math.round(performance.now() - started),
    };
    await appendFile(
      join(folder, "tool-calls.jsonl"),
      `${JSON.stringify(record)}\n`,
    );
    return `${text}\n`;
  } finally {
    await client.close();
  }
}
