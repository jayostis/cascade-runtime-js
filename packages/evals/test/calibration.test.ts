import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { before, describe, it } from "node:test";
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

/** A judge nobody calibrated makes the grades unknowable: every tier's judges are ones whose agreement with the reference was measured. */
describe("The tiers in `configs/`, against `calibration.json`", () => {
  let calibration: Calibration;
  let configs: { name: string; tier: string; judges: readonly string[] }[];

  before(async () => {
    calibration = JSON.parse(
      await readFile(join(PACKAGE, "calibration.json"), "utf8"),
    ) as Calibration;
    configs = [];
    for (const name of await readdir(CONFIGS)) {
      const config = await loadConfig(join(CONFIGS, name));
      configs.push({ name, tier: config.tier, judges: config.judges });
    }
  });

  describe("given every config", () => {
    it("judges only with a model that calibration measured", () => {
      const calibrated = new Set(calibration.judges.map((it) => it.model));
      for (const { name, judges } of configs)
        for (const model of judges)
          assert.ok(
            calibrated.has(model),
            `${name} judges with ${model}, which no calibration measured`,
          );
    });
  });

  describe("given a config of the standard tier", () => {
    it("judges with the cheapest model that agrees with the reference on every item and on the gaps alone", () => {
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
      const standard = configs.filter((it) => it.tier === "standard");
      assert.ok(standard.length > 0, "no config is of the standard tier");
      for (const { name, judges } of standard)
        assert.deepEqual(judges, [cheapest.model], name);
    });
  });
});
