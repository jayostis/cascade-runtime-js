import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { recordHistory } from "../src/history.js";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-history-"));
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

test("a run planned from uncommitted work is refused by history, naming what was uncommitted", async () => {
  const at = "2026-10-31T00:00:00Z";
  const results = {
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
  await writeFile(join(folder, "results.json"), JSON.stringify(results));
  await assert.rejects(
    recordHistory(folder),
    /planned from uncommitted work.*3 uncommitted files/,
  );
});
