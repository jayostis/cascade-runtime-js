import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import {
  readTranscript,
  type Transcript,
  transcriptsSince,
} from "../src/transcripts.js";

const AGENT = fileURLToPath(
  new URL(
    "../../test/fixtures/transcripts/agent-workflow.jsonl",
    import.meta.url,
  ),
);

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

/**
 * What a job cost is read from the transcript Claude Code wrote of it. A transcript is a job's only by the session id the
 * job was started with, or by the tag a Workflow agent's task carries.
 */
describe("Finding the transcript of a job · readTranscript(), transcriptsSince()", () => {
  describe("given a Workflow agent's transcript (`readTranscript()`)", () => {
    let transcript: Transcript | undefined;

    before(async () => {
      transcript = await readTranscript(AGENT);
    });

    it("returns the tag its task carries, though the relayed request comes first", () => {
      assert.equal(transcript?.tag, "workflow-smoke-1/harness-6");
    });

    it("returns each model call with its model", () => {
      assert.ok(transcript!.calls.length > 0);
      assert.ok(
        transcript!.calls.every((call) => call.model === "claude-haiku-5-5"),
      );
    });
  });

  describe("transcriptsSince(since, wanted, root, sessions)", () => {
    let root: string;
    let found: Map<string, Transcript>;

    before(async () => {
      root = await mkdtemp(join(tmpdir(), "cascade-evals-transcripts-"));
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
      await copyFile(AGENT, join(project, "agent-aa11.jsonl"));
      found = await transcriptsSince(
        new Date(0),
        (tag) =>
          tag.startsWith("run-1/") || tag.startsWith("workflow-smoke-1/"),
        root,
        new Map([
          ["run-1/job-a", "0b9f6a52-3c1e-4d7a-9a41-6f2d3c8e1b77"],
          ["run-1/job-b", "7d1c0e44-2a5b-4c39-8e6f-1b9a4d5c2f08"],
        ]),
      );
    });

    after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

    it("finds a `claude -p` session by the session id its job was started with", () => {
      assert.ok(found.has("run-1/job-a"));
    });

    it("returns that session's model calls with their tokens", () => {
      const [call] = found.get("run-1/job-a")!.calls;
      assert.deepEqual(
        [call?.model, call?.input, call?.output],
        ["claude-haiku-5-5", 3, 7],
      );
    });

    it("finds a Workflow agent's transcript by its tag", () => {
      assert.ok(found.has("workflow-smoke-1/harness-6"));
    });

    it("takes no session for a job whose session file carries another job's tag", () => {
      assert.equal(found.has("run-1/job-b"), false);
    });

    it("takes no session that no job was started with, whatever tag its prompt carries", () => {
      assert.deepEqual(
        [...found.keys()].sort(),
        ["run-1/job-a", "workflow-smoke-1/harness-6"],
        "run-1/job-c is in a session file nobody was started with",
      );
    });
  });
});
