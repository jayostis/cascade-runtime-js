// A stand-in for `claude -p`: it reads the prompt from stdin, logs how it was started, writes a session transcript the
// way Claude Code does (<session id>.jsonl, the prompt as its first user line) and the files its job is to write.
// FAKE_CLAUDE_LOG: where each start is logged as a JSON line. FAKE_CLAUDE_FILES: {tag: {path: source file}}, copied
// as the job's answers, under "judge" for any judge; a path that is not absolute is relative to the working directory.
// FAKE_CLAUDE_EXIT: {tag: {code, times}}: the first `times` starts of that tag write a transcript and exit `code` with no answers
// (a usage limit, a lost login). --session-id names the transcript file.
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  copyFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import process from "node:process";

const MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const args = process.argv.slice(2);
const alias = args[args.indexOf("--model") + 1] ?? "opus";
const tag = /eval-tag: (\S+)/.exec(prompt)?.[1] ?? "";
const sessionId = args.includes("--session-id")
  ? args[args.indexOf("--session-id") + 1]
  : randomUUID();
appendFileSync(
  process.env.FAKE_CLAUDE_LOG,
  `${JSON.stringify({ args, cwd: process.cwd(), prompt, tag, memory: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY })}\n`,
);

const at = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();
const project = join(
  process.env.CASCADE_EVALS_TRANSCRIPTS,
  process.cwd().replace(/[^A-Za-z0-9]/g, "-"),
);
mkdirSync(project, { recursive: true });
const usage = {
  input_tokens: 10,
  cache_creation_input_tokens: 1000,
  cache_read_input_tokens: 5000,
  output_tokens: 200,
};
writeFileSync(
  join(project, `${sessionId}.jsonl`),
  [
    { type: "queue-operation", timestamp: at(0) },
    {
      type: "user",
      timestamp: at(0),
      message: { role: "user", content: prompt },
    },
    {
      type: "assistant",
      timestamp: at(1),
      message: {
        id: "msg_1",
        role: "assistant",
        model: MODELS[alias] ?? alias,
        content: [{ type: "text", text: "done" }],
        usage,
      },
    },
  ]
    .map((line) => JSON.stringify(line))
    .join("\n") + "\n",
);

const failing = JSON.parse(process.env.FAKE_CLAUDE_EXIT ?? "{}")[tag];
const failed = `${process.env.FAKE_CLAUDE_LOG}.failed`;
const failedBefore = existsSync(failed)
  ? readFileSync(failed, "utf8")
      .split("\n")
      .filter((it) => it === tag).length
  : 0;
if (failing !== undefined && failedBefore < failing.times) {
  appendFileSync(failed, `${tag}\n`);
  process.exit(failing.code);
}

const wanted = JSON.parse(process.env.FAKE_CLAUDE_FILES ?? "{}");
const files =
  wanted[tag] ?? (tag.includes(".judge.") ? wanted.judge : undefined) ?? {};
for (const [path, source] of Object.entries(files)) {
  const target = isAbsolute(path) ? path : join(process.cwd(), path);
  mkdirSync(join(target, ".."), { recursive: true });
  copyFileSync(source, target);
}
process.stdout.write("done\n");
