import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  HOT_SPOTS,
  importBench,
  type Measured,
  syntheticPull,
  tableOf,
} from "./import-bench.js";

/**
 * The import bench imports a synthetic pull of one hospital as the app does, and reports the time and the counts of
 * each place an import spends it, so that a speed-up is argued from a measurement.
 */
describe("Timing an import by mechanism · importBench(), syntheticPull(), probing()", () => {
  let run: Measured;

  before(async () => {
    run = await importBench(200);
  });

  describe("given a pull of 200 resources", () => {
    it("imports it, with nothing refused", () => {
      assert.equal(run.refused, undefined);
      assert.ok(run.wrote > 0);
    });

    it("reports every hot spot's span with a non-zero count of calls", () => {
      for (const name of HOT_SPOTS.spans)
        assert.ok(
          (run.spans.find((span) => span.name === name)?.calls ?? 0) > 0,
          `${name} was not measured`,
        );
    });

    it("reports every counted mechanism with a non-zero count", () => {
      for (const name of HOT_SPOTS.counts)
        assert.ok((run.counts[name] ?? 0) > 0, `${name} was not counted`);
    });

    it("reports each matcher rule that ran by its justification, with its store queries", () => {
      const rules = run.spans.filter(({ name }) =>
        name.startsWith("matcher.rule:"),
      );
      assert.ok(rules.length > 0);
      for (const { name } of rules)
        assert.ok((run.counts[`${name}.store.queries`] ?? 0) > 0, name);
    });

    it("prints the table, with a row for each hot spot", () => {
      const table = tableOf(run);
      for (const name of [...HOT_SPOTS.spans, ...HOT_SPOTS.counts])
        assert.ok(table.includes(name), `${name} is not in the table`);
    });
  });

  describe("given a pull of no resources, one, and ten", () => {
    it("saves a Bundle of that many entries, each with an id of its own", () => {
      for (const total of [0, 1, 10]) {
        const bundle = JSON.parse(
          new TextDecoder().decode(
            syntheticPull(total).get("pull/bundle.json"),
          ),
        ) as { entry: { resource: { id: string } }[] };
        assert.equal(bundle.entry.length, total);
        assert.equal(
          new Set(bundle.entry.map((e) => e.resource.id)).size,
          total,
        );
      }
    });
  });
});
