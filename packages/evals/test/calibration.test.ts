import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { PACKAGE } from "../src/paths.js";
import { loadConfig } from "../src/plan.js";

interface Calibration {
  readonly threshold: number;
  readonly judges: readonly {
    readonly model: string;
    readonly agreement: number;
    readonly usd: number;
  }[];
}

test("the standard tier judges with the cheapest model calibration found in agreement with the reference", async () => {
  const calibration = JSON.parse(
    await readFile(join(PACKAGE, "calibration.json"), "utf8"),
  ) as Calibration;
  const [cheapest] = calibration.judges
    .filter((it) => it.agreement >= calibration.threshold)
    .sort((a, b) => a.usd - b.usd);
  assert.ok(
    cheapest !== undefined,
    "no calibrated judge reaches the threshold",
  );
  assert.deepEqual((await loadConfig("standard")).judges, [cheapest.model]);
  const calibrated = new Set(calibration.judges.map((it) => it.model));
  for (const tier of ["standard", "full"])
    for (const model of (await loadConfig(tier)).judges)
      assert.ok(
        calibrated.has(model),
        `${tier} judges with ${model}, which no calibration measured`,
      );
});
