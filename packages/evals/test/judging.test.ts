import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { Answer } from "../src/checks.js";
import { blinded } from "../src/judging.js";

test("a judge reads neither arm's citations nor how it reached the records", async () => {
  const { answers } = JSON.parse(
    await readFile(
      new URL("../../test/fixtures/smoke-run/results.json", import.meta.url),
      "utf8",
    ),
  ) as { answers: Record<string, Answer> };
  assert.equal(Object.keys(answers).length, 2);
  for (const answer of Object.values(answers)) {
    const text = blinded(answer);
    assert.match(text, /### Q1\./);
    assert.doesNotMatch(
      text,
      /pod:\/\/|\.json|\.xml|lab_series|find_changes|\bpod\b|\bquery\b|bundle/i,
    );
  }
});
