import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  HOT_SPOTS,
  importBench,
  type Measured,
  syntheticPull,
  tableOf,
} from "./import-bench.js";

interface Entry {
  resourceType: string;
  code?: { coding: { code: string }[] };
  vaccineCode?: { coding: { code: string }[] };
  medicationCodeableConcept?: { coding: { code: string }[] };
  effectiveDateTime?: string;
  onsetDateTime?: string;
  authoredOn?: string;
  occurrenceDateTime?: string;
  performedDateTime?: string;
}

function bundleOf(
  total: number,
  repeats?: boolean,
): { entry: { resource: Entry }[] } {
  return JSON.parse(
    new TextDecoder().decode(
      syntheticPull(total, { repeats }).get("pull/bundle.json"),
    ),
  ) as { entry: { resource: Entry }[] };
}

/** For each kind with any, how many records repeat the code and day of an earlier record of that kind. */
function matchingPairs(bundle: {
  entry: { resource: Entry }[];
}): Record<string, number> {
  const seen = new Set<string>();
  const pairs: Record<string, number> = {};
  for (const { resource } of bundle.entry) {
    const code = (
      resource.code ??
      resource.vaccineCode ??
      resource.medicationCodeableConcept
    )?.coding[0]?.code;
    const time =
      resource.effectiveDateTime ??
      resource.onsetDateTime ??
      resource.authoredOn ??
      resource.occurrenceDateTime ??
      resource.performedDateTime;
    assert.ok(code !== undefined && time !== undefined, resource.resourceType);
    const key = `${resource.resourceType} ${code} ${time.slice(0, 10)}`;
    if (seen.has(key))
      pairs[resource.resourceType] = (pairs[resource.resourceType] ?? 0) + 1;
    seen.add(key);
  }
  return pairs;
}

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

    it("binds no record into a comparison's text, since the pod held no record before the import", () => {
      assert.ok((run.counts["matcher.queriesRun"] ?? 0) > 0);
      assert.equal(run.counts["matcher.boundRecords"] ?? 0, 0);
    });

    it("counts the rows of each matcher rule that ran", () => {
      for (const { name } of run.spans.filter(({ name }) =>
        name.startsWith("matcher.rule:"),
      ))
        assert.notEqual(run.counts[`${name}.rows`], undefined, name);
    });

    it("credits each graph scan to the span that made it, a constant however many versions: arrivals one graph.subjects() scan; refuseUnaccounted one whole-graph scan, three graph.subjects() scans and one pass to build the name index", () => {
      assert.equal(run.counts["arrivals.arrivals.graph.scans"], 1);
      assert.equal(
        run.counts["arrivals.refuseUnaccounted.graph.scans"],
        1 + 3 + 1,
      );
    });

    it("prints the table, with a row for each hot spot", () => {
      const table = tableOf(run);
      for (const name of [...HOT_SPOTS.spans, ...HOT_SPOTS.counts])
        assert.ok(table.includes(name), `${name} is not in the table`);
    });
  });

  describe("given a pull of 200 resources imported onto a pod that holds another hospital's", () => {
    let second: Measured;

    before(async () => {
      second = await importBench(200, { second: true });
    });

    it("imports it, with nothing refused", () => {
      assert.equal(second.refused, undefined);
      assert.ok(second.wrote > 0);
    });

    it("binds the records of the run into the comparisons' text, the path a first import never takes", () => {
      assert.ok((second.counts["matcher.queriesRun"] ?? 0) > 0);
      assert.ok((second.counts["matcher.boundRecords"] ?? 0) > 0);
    });
  });

  describe("given a pull of 200 resources, as a Bundle", () => {
    it("holds exactly the deliberate repeats of a code and day, a count for each kind", () => {
      assert.deepEqual(matchingPairs(bundleOf(200)), {
        AllergyIntolerance: 1,
        Condition: 2,
        Immunization: 2,
        MedicationRequest: 2,
        Observation: 10,
        Procedure: 1,
      });
    });

    it("puts many records on one day and one lab code on many days, as a visit and a panel do", () => {
      const entries = bundleOf(200).entry;
      const perDay = new Map<string, number>();
      const daysOfLab = new Map<string, Set<string>>();
      for (const { resource } of entries) {
        const time =
          resource.effectiveDateTime ??
          resource.onsetDateTime ??
          resource.authoredOn ??
          resource.occurrenceDateTime ??
          resource.performedDateTime;
        assert.ok(time !== undefined, resource.resourceType);
        const day = time.slice(0, 10);
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
        if (resource.resourceType === "Observation") {
          const code = resource.code?.coding[0]?.code ?? "";
          daysOfLab.set(code, (daysOfLab.get(code) ?? new Set()).add(day));
        }
      }
      assert.ok(Math.max(...perDay.values()) >= 15, "busiest day");
      assert.ok(
        Math.max(...[...daysOfLab.values()].map((days) => days.size)) >= 5,
        "most frequent lab code",
      );
    });

    it("holds no two records of one kind with the same code and day when the repeats are switched off", () => {
      assert.deepEqual(matchingPairs(bundleOf(200, false)), {});
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
