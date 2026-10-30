// The model calls of a Claude Code agent, read from the transcript Claude Code keeps of it: each call's model, its
// input, cache and output tokens as the API reported them, when it ran and the tools it called. An agent's
// transcript is found by the tag its prompt carries.
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export interface ModelCall {
  readonly at: string;
  readonly model: string;
  readonly input: number;
  readonly cacheCreation: number;
  readonly cacheRead: number;
  readonly output: number;
  /** The tools the call asked for, by name, in order. */
  readonly toolCalls: readonly string[];
}

export interface ToolUse {
  readonly at: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface Transcript {
  readonly path: string;
  readonly tag: string;
  readonly started: string;
  readonly ended: string;
  readonly calls: readonly ModelCall[];
  readonly tools: readonly ToolUse[];
}

/** Where Claude Code keeps its transcripts, unless `CASCADE_EVALS_TRANSCRIPTS` says. */
export const TRANSCRIPTS =
  process.env.CASCADE_EVALS_TRANSCRIPTS ??
  join(homedir(), ".claude", "projects");

/** The line a prompt carries that names its job: `eval-tag: <run>/<job>`. */
export const tagLine = (tag: string) => `eval-tag: ${tag}`;
const TAG = /eval-tag: (\S+)/;

interface Line {
  type?: string;
  timestamp?: string;
  message?: {
    id?: string;
    model?: string;
    content?: unknown;
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens?: number;
    };
  };
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((block) =>
        typeof block === "object" && block !== null && "text" in block
          ? String((block as { text: unknown }).text)
          : "",
      )
      .join("\n");
  return "";
}

/** The transcript at `path`, if its first prompt carries a tag. */
export async function readTranscript(
  path: string,
): Promise<Transcript | undefined> {
  const lines = createInterface({
    input: createReadStream(path, "utf8"),
    crlfDelay: Infinity,
  });
  let tag: string | undefined;
  let started = "";
  let ended = "";
  const byId = new Map<string, ModelCall>();
  const order: string[] = [];
  const tools: ToolUse[] = [];
  let first = true;
  for await (const text of lines) {
    if (text.trim() === "") continue;
    let line: Line;
    try {
      line = JSON.parse(text) as Line;
    } catch {
      continue;
    }
    if (line.timestamp !== undefined) {
      if (started === "") started = line.timestamp;
      ended = line.timestamp;
    }
    // The tag is in the prompt: the first user message, or for a Workflow agent the computed task after the relayed
    // request; either way before the agent first answers.
    if (line.type === "user" && first && tag === undefined)
      tag = TAG.exec(textOf(line.message?.content))?.[1];
    if (line.type === "assistant" && first) {
      first = false;
      if (tag === undefined) return undefined;
    }
    if (line.type !== "assistant" || line.message?.usage === undefined)
      continue;
    const {
      id = `${order.length}`,
      model = "unknown",
      usage,
      content,
    } = line.message;
    const named = Array.isArray(content)
      ? (
          content as {
            type?: string;
            name?: string;
            input?: Record<string, unknown>;
          }[]
        ).filter((block) => block.type === "tool_use")
      : [];
    for (const block of named)
      tools.push({
        at: line.timestamp ?? "",
        name: block.name ?? "",
        input: block.input ?? {},
      });
    const before = byId.get(id);
    if (before === undefined) order.push(id);
    byId.set(id, {
      at: before?.at ?? line.timestamp ?? "",
      model,
      input: usage.input_tokens ?? 0,
      cacheCreation: usage.cache_creation_input_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      output: Math.max(before?.output ?? 0, usage.output_tokens ?? 0),
      toolCalls: [
        ...(before?.toolCalls ?? []),
        ...named.map((block) => block.name ?? ""),
      ],
    });
  }
  if (tag === undefined) return undefined;
  return {
    path,
    tag,
    started,
    ended,
    calls: order.map((id) => byId.get(id)!),
    tools,
  };
}

/** Every tagged transcript under `root` written since `since`, by tag; a tag found twice keeps the later one. */
export async function transcriptsSince(
  since: Date,
  wanted: (tag: string) => boolean,
  root = TRANSCRIPTS,
): Promise<Map<string, Transcript>> {
  const found = new Map<string, Transcript>();
  let entries;
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !/^agent-.*\.jsonl$/.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    if ((await stat(path)).mtime < since) continue;
    const transcript = await readTranscript(path);
    if (transcript === undefined || !wanted(transcript.tag)) continue;
    const before = found.get(transcript.tag);
    if (before === undefined || before.started < transcript.started)
      found.set(transcript.tag, transcript);
  }
  return found;
}
