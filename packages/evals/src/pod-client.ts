// The pod arm's one command: a cascade-mcp tool over the case's pods, its answer printed as the server gave it and
// logged to the run with the entries it named. One server runs per job: the first call starts it, behind a local
// socket, and every call of the job is sent to it, so a call costs its query, not the server's start. It stops when
// idle.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { Client } from "@modelcontextprotocol/client";
import type { Prepared } from "./cases.js";
import { runtimeRoot } from "./paths.js";
import type { Plan } from "./plan.js";
import { runFolder, type ToolCallRecord } from "./results.js";

const MCP_CLI = join(
  dirname(fileURLToPath(import.meta.resolve("cascade-mcp"))),
  "cli.js",
);
const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));

/** How long a job's server waits for its next call before it stops. */
const IDLE_MS = 10 * 60_000;
/** How long a call waits for its job's server to start. */
const START_MS = 60_000;

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

/** The local socket a job's server listens on: a named pipe on Windows, a socket file elsewhere. */
function socketOf(folder: string, job: string): string {
  const name = `cascade-evals-${createHash("sha256").update(`${folder}\n${job}`).digest("hex").slice(0, 24)}`;
  return process.platform === "win32"
    ? `\\\\.\\pipe\\${name}`
    : join(tmpdir(), `${name}.sock`);
}

/**
 * How a job's cascade-mcp starts: this checkout's, where the harness runs, or a pinned build's, in its own checkout so it
 * reads its own cascade-runtime.json (see runtimeRoot).
 */
export function mcpServer(prepared: Pick<Prepared, "mcp" | "pods">) {
  return {
    command: process.execPath,
    args: [prepared.mcp ?? MCP_CLI, "--pods", prepared.pods],
    ...(prepared.mcp === undefined ? {} : { cwd: runtimeRoot(prepared.mcp) }),
    stderr: "ignore" as const,
  };
}

/** Sends one call to the job's server and returns its answer, or undefined when no server listens. */
function ask(socket: string, call: string[]): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const connection = connect(socket);
    let answer = "";
    // One line out, then the answer until the server ends: a Windows pipe has no half-close, so the call never ends
    // its own side first.
    connection.on("connect", () =>
      connection.write(`${JSON.stringify(call)}\n`),
    );
    connection.on("data", (chunk) => (answer += chunk.toString("utf8")));
    connection.on("end", () => resolve(answer));
    connection.on("error", (error: NodeJS.ErrnoException) =>
      ["ENOENT", "ECONNREFUSED"].includes(error.code ?? "")
        ? resolve(undefined)
        : reject(error),
    );
  });
}

/** The pod command: the call sent to the job's server, started first when none runs. */
export async function podCommand(
  given: string,
  job: string,
  args: string[],
): Promise<string> {
  const folder = runFolder(given);
  const socket = socketOf(folder, job);
  const first = await ask(socket, args);
  if (first !== undefined) return first;
  spawn(process.execPath, [CLI, "pod-serve", "--run", folder, "--job", job], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
  const until = Date.now() + START_MS;
  for (let wait = 50; Date.now() < until; wait = Math.min(wait * 2, 500)) {
    await new Promise((done) => setTimeout(done, wait));
    const answer = await ask(socket, args);
    if (answer !== undefined) return answer;
  }
  throw new Error(`the pod server of ${job} did not start`);
}

/**
 * A job's server: one cascade-mcp, started once, behind the job's socket. Each connection sends one call; its answer
 * goes back and is logged to the run exactly as a call by itself would be. It stops after `IDLE_MS` with no call.
 */
export async function podServe(given: string, job: string): Promise<void> {
  const folder = runFolder(given);
  const plan = JSON.parse(
    await readFile(join(folder, "plan.json"), "utf8"),
  ) as Plan;
  const planned = plan.jobs.find((it) => it.id === job && it.arm === "pod");
  if (planned === undefined)
    throw new Error(`${job} is no pod-arm job of ${plan.run}`);
  const prepared = plan.cases.find((it) => it.id === planned.case)!.prepared;
  const { Client } = await import("@modelcontextprotocol/client");
  const { StdioClientTransport } =
    await import("@modelcontextprotocol/client/stdio");
  const client = new Client({ name: "cascade-evals", version: "0.0.0" });
  await client.connect(new StdioClientTransport(mcpServer(prepared)));
  const log = join(folder, "tool-calls.jsonl");
  const counter = {
    made: existsSync(log)
      ? (await readFile(log, "utf8"))
          .split("\n")
          .filter((line) => line.includes(`"job":${JSON.stringify(job)}`))
          .length
      : 0,
  };
  let idle: NodeJS.Timeout;
  const server = createServer((connection: Socket) => {
    clearTimeout(idle);
    let text = "";
    let answered = false;
    connection.on("error", () => undefined);
    connection.on("data", async (chunk) => {
      text += chunk.toString("utf8");
      const end = text.indexOf("\n");
      if (answered || end === -1) return;
      answered = true;
      try {
        const call = JSON.parse(text.slice(0, end)) as string[];
        connection.end(await answer(client, folder, job, call, counter));
      } catch (error) {
        connection.end(`the pod server failed: ${(error as Error).message}\n`);
      }
      idle = setTimeout(stop, IDLE_MS);
    });
  });
  const stop = () => {
    server.close();
    void client.close().then(() => process.exit(0));
  };
  await new Promise<void>((listening, failed) => {
    server.once("error", failed);
    server.listen(socketOf(folder, job), () => listening());
  }).catch(async () => {
    // another call started this job's server first
    await client.close();
    process.exit(0);
  });
  idle = setTimeout(stop, IDLE_MS);
}

/**
 * One call through the job's MCP client: the tools, or a tool's answer, logged with the entries it named and
 * numbered, the number printed after the answer so an absence can name the call that looked.
 */
async function answer(
  client: Client,
  folder: string,
  job: string,
  args: string[],
  counter: { made: number },
): Promise<string> {
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
  const call = ++counter.made;
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
    call,
    at: new Date().toISOString(),
    tool,
    input,
    ok: result.isError !== true,
    ...(result.isError === true ? { error: text } : {}),
    rows: result.isError === true ? 0 : rowsIn(value),
    entries: result.isError === true ? [] : entriesIn(value),
    answer: text,
    milliseconds: Math.round(performance.now() - started),
  };
  await appendFile(
    join(folder, "tool-calls.jsonl"),
    `${JSON.stringify(record)}\n`,
  );
  return `${text}\n(call ${call})\n`;
}
