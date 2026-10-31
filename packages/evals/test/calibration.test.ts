import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { CONFIGS, PACKAGE } from "../src/paths.js";
import { loadConfig } from "../src/plan.js";

interface Calibration {
  readonly threshold: number;
  readonly judges: readonly {
    readonly model: string;
    readonly items: number;
    readonly agreed: number;
    readonly gapItems: number;
    readonly gapAgreed: number;
    readonly usd: number;
  }[];
}

test("the standard tier judges with the cheapest model calibration found in agreement with the reference, on every item and on the gaps alone", async () => {
  const calibration = JSON.parse(
    await readFile(join(PACKAGE, "calibration.json"), "utf8"),
  ) as Calibration;
  const [cheapest] = calibration.judges
    .filter(
      (it) =>
        it.agreed / it.items >= calibration.threshold &&
        it.gapAgreed / it.gapItems >= calibration.threshold,
    )
    .sort((a, b) => a.usd - b.usd);
  assert.ok(
    cheapest !== undefined,
    "no calibrated judge reaches the threshold",
  );
  const calibrated = new Set(calibration.judges.map((it) => it.model));
  for (const name of await readdir(CONFIGS)) {
    const config = await loadConfig(join(CONFIGS, name));
    if (config.tier === "standard")
      assert.deepEqual(config.judges, [cheapest.model], name);
    for (const model of config.judges)
      assert.ok(
        calibrated.has(model),
        `${name} judges with ${model}, which no calibration measured`,
      );
  }
});
