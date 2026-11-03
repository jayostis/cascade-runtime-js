import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { readTranscript, transcriptsSince } from "../src/transcripts.js";

test("a Workflow agent's transcript is found by the tag its computed task carries, after the relayed request", async () => {
  const transcript = await readTranscript(
    fileURLToPath(
      new URL(
        "../../test/fixtures/transcripts/agent-workflow.jsonl",
        import.meta.url,
      ),
    ),
  );
  assert.equal(transcript?.tag, "workflow-smoke-1/harness-6");
  assert.ok(transcript.calls.length > 0);
  assert.ok(
    transcript.calls.every((call) => call.model === "claude-haiku-5-5"),
  );
});

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const session = (prompt: string) =>
  line({ type: "queue-operation", timestamp: "2026-11-02T10:00:00.000Z" }) +
  line({
    type: "user",
    timestamp: "2026-11-02T10:00:00.000Z",
    message: { role: "user", content: prompt },
  }) +
  line({
    type: "assistant",
    timestamp: "2026-11-02T10:00:03.000Z",
    message: {
      id: "msg_1",
      model: "claude-haiku-5-5",
      content: [{ type: "text", text: "done" }],
      usage: { input_tokens: 3, output_tokens: 7 },
    },
  });

test("a `claude -p` session is found by the session id its job was started with, beside an agent transcript found by tag; no other session is, whatever tag it carries", async () => {
  const root = await mkdtemp(join(tmpdir(), "cascade-evals-transcripts-"));
  try {
    const project = join(root, "C--work-job");
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, "0b9f6a52-3c1e-4d7a-9a41-6f2d3c8e1b77.jsonl"),
      session("eval-tag: run-1/job-a\n\nRead the records."),
    );
    await writeFile(
      join(project, "7d1c0e44-2a5b-4c39-8e6f-1b9a4d5c2f08.jsonl"),
      session("eval-tag: run-1/job-c\n\nA later session pasting a tag."),
    );
    await copyFile(
      fileURLToPath(
        new URL(
          "../../test/fixtures/transcripts/agent-workflow.jsonl",
          import.meta.url,
        ),
      ),
      join(project, "agent-aa11.jsonl"),
    );
    const found = await transcriptsSince(
      new Date(0),
      (tag) => tag.startsWith("run-1/") || tag.startsWith("workflow-smoke-1/"),
      root,
      new Map([
        ["run-1/job-a", "0b9f6a52-3c1e-4d7a-9a41-6f2d3c8e1b77"],
        ["run-1/job-b", "7d1c0e44-2a5b-4c39-8e6f-1b9a4d5c2f08"],
      ]),
    );
    assert.deepEqual([...found.keys()].sort(), [
      "run-1/job-a",
      "workflow-smoke-1/harness-6",
    ]);
    assert.equal(found.get("run-1/job-a")?.calls[0]?.model, "claude-haiku-5-5");
    assert.equal(found.get("run-1/job-a")?.calls[0]?.output, 7);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});
