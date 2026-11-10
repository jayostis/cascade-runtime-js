import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { recordHistory } from "../src/history.js";
import { HISTORY } from "../src/paths.js";

const at = "2026-10-31T00:00:00Z";

/** The results of a smoke run planned with three uncommitted files in the harness. */
const dirty = {
  schema: "cascade-evals/results/2",
  run: {
    id: "dirty",
    tier: "smoke",
    runner: "claude-code",
    created: at,
    finished: at,
    wallSeconds: 0,
    stoppedAtCap: false,
    config: {},
    configSha256: "",
  },
  versions: {
    harness: { commit: "0123456789ab", uncommitted: 3 },
    podPackages: {},
    components: [],
    prompts: {},
    priceTable: "2026-10-06",
  },
  budget: {
    cap: {},
    estimate: { tokens: 0, usd: 0 },
    spent: { tokens: 0, usd: 0, basis: "exact" },
    byRole: {},
  },
  ...Object.fromEntries(
    [
      "cases",
      "jobs",
      "asked",
      "toolCalls",
      "evidence",
      "grades",
      "instances",
      "agreement",
    ].map((it) => [it, []]),
  ),
  ...Object.fromEntries(
    ["checks", "judgeDiscipline", "answers"].map((it) => [it, {}]),
  ),
};

/** `recordHistory()` copies a finished run into `history/`, which is committed and published. */
describe("Recording a run in the history · recordHistory()", () => {
  describe("given a run planned from uncommitted work", () => {
    let folder: string;
    let thrown: Error | undefined;

    before(async () => {
      folder = await mkdtemp(join(tmpdir(), "cascade-evals-history-"));
      await writeFile(join(folder, "results.json"), JSON.stringify(dirty));
      thrown = await recordHistory(folder).then(
        () => undefined,
        (error: Error) => error,
      );
    });

    after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

    it("refuses, saying how many files were uncommitted", () => {
      assert.match(
        thrown?.message ?? "",
        /planned from uncommitted work.*3 uncommitted files/,
      );
    });

    it("writes nothing to `history/`", () => {
      assert.equal(
        existsSync(join(HISTORY, "2026-10-31-0123456-smoke")),
        false,
      );
    });
  });
});
