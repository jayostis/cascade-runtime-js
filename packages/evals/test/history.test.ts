import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { recordHistory } from "../src/history.js";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-history-"));
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

test("a run planned from uncommitted work is refused by history, naming what was uncommitted", async () => {
  const results = JSON.parse(
    await readFile(
      new URL("../../test/fixtures/smoke-run/results.json", import.meta.url),
      "utf8",
    ),
  ) as { versions: { harness: { uncommitted: number } } };
  results.versions.harness.uncommitted = 3;
  await writeFile(join(folder, "results.json"), JSON.stringify(results));
  await assert.rejects(
    recordHistory(folder),
    /planned from uncommitted work.*3 uncommitted files/,
  );
});
