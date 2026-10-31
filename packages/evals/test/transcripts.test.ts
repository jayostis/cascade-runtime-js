import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { readTranscript } from "../src/transcripts.js";

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
