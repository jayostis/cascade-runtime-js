import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPod } from "cascade-runtime";
import { probing } from "@cascade-runtime/runtime/probe";
import {
  againstBudget,
  HOT_SPOTS,
  importBench,
  openBench,
  type Measured,
  profileOf,
  seriesBench,
  syntheticPull,
  syntheticPulls,
  tableOf,
} from "./import-bench.js";

interface Entry {
  resourceType: string;
  id: string;
  result?: { reference: string }[];
  context?: { related: { reference: string }[] };
  code?: { coding: { code: string }[] };
  vaccineCode?: { coding: { code: string }[] };
  medicationCodeableConcept?: { coding: { code: string }[] };
  effectiveDateTime?: string;
  onsetDateTime?: string;
  authoredOn?: string;
  occurrenceDateTime?: string;
  performedDateTime?: string;
}

/** The entries of each pull of `total` resources, as the Bundles hold them. */
function entriesOf(total: number, repeats?: boolean): { resource: Entry }[][] {
  return syntheticPulls(total, { repeats }).map(
    (pull) =>
      (
        JSON.parse(new TextDecoder().decode(pull.get("pull/bundle.json"))) as {
          entry: { resource: Entry }[];
        }
      ).entry,
  );
}

/** The records of the pulls that stand for themselves, each once: every entry but the reports and notes made from laboratory results. */
function bundleOf(
  total: number,
  repeats?: boolean,
): { entry: { resource: Entry }[] } {
  return {
    entry: [
      ...new Map(
        entriesOf(total, repeats)
          .flat()
          .filter(({ resource }) => /^r[0-9]+$/.test(resource.id))
          .map((one) => [one.resource.id, one]),
      ).values(),
    ],
  };
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

/** Each rebuild of the pod the run made, named by the steps it followed, with how many were made. */
function rebuildsOf(run: Measured): [string, number][] {
  return run.spans
    .filter(({ name }) => name.startsWith("core-pod.step.rebuild:"))
    .map(({ name, calls }): [string, number] => [name, calls])
    .sort(([a], [b]) => (a < b ? -1 : 1));
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

    it("rebuilds the pod twice, once for the import and the judgment that claims its patient and once after the matcher's run, not after each of the three steps", () => {
      assert.deepEqual(rebuildsOf(run), [
        ["core-pod.step.rebuild:import+judge", 1],
        ["core-pod.step.rebuild:match", 1],
      ]);
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

    it("binds into a comparison's text only the records the import began that its rule applies to", () => {
      assert.ok((run.counts["matcher.queriesRun"] ?? 0) > 0);
      const bound = run.counts["matcher.boundRecords"] ?? 0;
      const taken = run.counts["matcher.takenRecords"] ?? 0;
      assert.ok(bound > 0 && bound < taken, `${bound} of ${taken} bound`);
    });

    it("times each layout view alone, so that the views' spans sum to no more than the build they are in", () => {
      const ms = (name: string) =>
        run.spans.find((span) => span.name === name)?.ms ?? 0;
      const views = run.spans.filter(({ name }) =>
        name.startsWith("build.query:"),
      );
      assert.ok(views.length > 0);
      assert.ok(
        views.reduce((all, { ms }) => all + ms, 0) <= ms("build.queried"),
      );
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

    it("reports the time of `pod.profilesTied` and of `pod.unclaimedProfiles`, each of which the import calls once", () => {
      for (const name of ["pod.profilesTied", "pod.unclaimedProfiles"])
        assert.equal(
          second.spans.find((span) => span.name === name)?.calls,
          1,
          name,
        );
    });

    it("rebuilds the pod twice, as a first import does", () => {
      assert.equal(
        rebuildsOf(second).reduce((all, [, calls]) => all + calls, 0),
        2,
      );
    });

    it("binds the records of the run into the comparisons' text, the path a first import never takes", () => {
      assert.ok((second.counts["matcher.queriesRun"] ?? 0) > 0);
      assert.ok((second.counts["matcher.boundRecords"] ?? 0) > 0);
    });
  });

  describe("given a pull of 200 resources imported onto a pod that holds another hospital's, closed and opened again", () => {
    let reopened: Measured;

    before(async () => {
      reopened = await importBench(200, { reopen: true });
    });

    it("imports it, with nothing refused", () => {
      assert.equal(reopened.refused, undefined);
      assert.ok(reopened.wrote > 0);
    });

    it("reads the build the first import wrote back once, rather than building the pod whole, as the build the import's rebuilds continue from, and derives no matcher view of it apart", () => {
      const calls = (name: string) =>
        reopened.spans.find((span) => span.name === name)?.calls ?? 0;
      assert.equal(calls("kept.readBack"), 1);
      assert.equal(calls("kept.whole"), 0);
      assert.equal(calls("matcher.view"), 0);
    });

    it("rebuilds the pod twice, as an import onto an open pod does", () => {
      assert.equal(
        rebuildsOf(reopened).reduce((all, [, calls]) => all + calls, 0),
        2,
      );
    });
  });

  describe("given a pod holding one hospital's pull, closed and opened again, whose next import is refused before the good one", () => {
    /** The good import onto the reopened pod, after `refusals` imports of a file no importer reads. */
    async function importedAfter(refusals: number) {
      // A pod opened again is built whole, or read back where its build is kept beside it: either is its one build.
      const folder = await mkdtemp(join(tmpdir(), "import-refused-"));
      try {
        let pod = await openPod(folder);
        await pod.import(syntheticPull(40, { hospital: "first" }), {
          claimProfiles: await profileOf("first"),
        });
        await pod.close();
        pod = await openPod(folder);
        try {
          for (let refused = 0; refused < refusals; refused++) {
            const done = await pod.import(
              new Map([["junk.json", new TextEncoder().encode("{not json")]]),
            );
            assert.match(done.refused ?? "", /no importer/);
          }
          const second = await profileOf("second");
          const { result, seen } = await probing(() =>
            pod.import(syntheticPull(40, { hospital: "second" }), {
              claimProfiles: second,
            }),
          );
          return {
            refused: result.refused,
            wrote: result.wrote.length,
            built:
              (seen.spans.get("kept.whole")?.calls ?? 0) +
              (seen.spans.get("kept.readBack")?.calls ?? 0),
            rows: await pod.ask("record/Which entry shows it"),
          };
        } finally {
          await pod.close();
        }
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    }

    it("builds the pod no more than once for the refused import and the good one, and imports as it would with none refused", async () => {
      const control = await importedAfter(0);
      const refused = await importedAfter(2);
      assert.equal(control.refused, undefined);
      assert.equal(refused.refused, undefined);
      assert.equal(control.built, 1);
      assert.equal(refused.built, 0, "built by the refused import's read");
      assert.ok(control.rows.length > 0);
      assert.equal(refused.wrote, control.wrote);
      assert.equal(refused.rows.length, control.rows.length);
    });
  });

  describe("given a pull of 200 resources, as a Bundle", () => {
    it("holds exactly the deliberate repeats of a code and day, a count for each kind", () => {
      assert.deepEqual(matchingPairs(bundleOf(200)), {
        AllergyIntolerance: 1,
        Condition: 2,
        Immunization: 2,
        MedicationRequest: 2,
        Observation: 12,
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

  describe("given a budget of the time of each stage", () => {
    it("finds a stage over its budget or missing from the run, and one within", () => {
      const run = {
        importMs: 90,
        spans: [{ name: "pod.match", calls: 1, ms: 40 }],
      } as unknown as Measured;
      assert.deepEqual(
        againstBudget(run, {
          resources: 1,
          stagesMs: { importMs: 100, "pod.match": 30, "pod.judge": 30 },
        }).map(({ stage, within }) => [stage, within]),
        [
          ["importMs", true],
          ["pod.match", false],
          ["pod.judge", false],
        ],
      );
    });
  });

  describe("given the same pull imported into two pods, one probed, one not", () => {
    it("holds the same triples, the probe running the views one at a time and a plain import running them together", async () => {
      const profiles = await profileOf("first");
      const imported = async (probed: boolean) => {
        const folder = await mkdtemp(join(tmpdir(), "import-probed-"));
        const pod = await openPod(folder);
        try {
          const pull = () =>
            pod.import(syntheticPull(40, { hospital: "first" }), {
              claimProfiles: profiles,
            });
          if (probed) await probing(pull);
          else await pull();
          return (await pod.ask("record/Which entry shows it"))
            .map((row) =>
              JSON.stringify([
                row.recordLabel,
                row.entryLabel,
                String(row.view).split("/").at(-1),
              ]),
            )
            .sort();
        } finally {
          await pod.close();
          await rm(folder, { recursive: true, force: true });
        }
      };
      const plain = await imported(false);
      assert.ok(plain.length > 0);
      assert.deepEqual(await imported(true), plain);
    });
  });

  describe("given a pull of no resources, one, and ten", () => {
    it("saves a Bundle of that many entries, each with an id of its own", () => {
      for (const total of [0, 1, 10]) {
        const { entry } = bundleOf(total);
        assert.equal(entry.length, total);
        assert.equal(new Set(entry.map((e) => e.resource.id)).size, total);
      }
    });
  });

  describe("given a pull of 1000 resources, which is two pulls", () => {
    const [first, later] = entriesOf(1000) as [
      { resource: Entry }[],
      { resource: Entry }[],
    ];
    const ids = (entries: { resource: Entry }[]) =>
      new Set(entries.map(({ resource }) => resource.id));

    it("splits it into a first pull and a later one that begins again with the last cycle of the first", () => {
      const shared = [...ids(first)].filter((id) => ids(later).has(id));
      assert.ok(shared.filter((id) => /^r[0-9]+$/.test(id)).length === 20);
      assert.equal(
        new Set(
          [...ids(first), ...ids(later)].filter((id) => /^r[0-9]+$/.test(id)),
        ).size,
        1000,
      );
    });

    it("repeats a record only one earlier record has, in pairs and never in chains", () => {
      const all = bundleOf(1000).entry.map(({ resource }) => resource);
      const key = (r: Entry): string =>
        JSON.stringify([
          r.resourceType,
          (r.code ?? r.vaccineCode ?? r.medicationCodeableConcept)?.coding[0]
            ?.code,
          (
            r.effectiveDateTime ??
            r.onsetDateTime ??
            r.authoredOn ??
            r.occurrenceDateTime ??
            r.performedDateTime
          )?.slice(0, 10),
        ]);
      const sizes = new Map<string, number>();
      for (const r of all) sizes.set(key(r), (sizes.get(key(r)) ?? 0) + 1);
      assert.equal(Math.max(...sizes.values()), 2);
    });

    it("makes reports of laboratory results and notes on others, each naming records that are in the pull", () => {
      const all = [...first, ...later].map(({ resource }) => resource);
      const held = ids(all.map((resource) => ({ resource })));
      const reports = all.filter((r) => r.resourceType === "DiagnosticReport");
      const notes = all.filter((r) => r.resourceType === "DocumentReference");
      assert.ok(reports.length > 0 && notes.length > 0);
      for (const r of reports)
        for (const { reference } of r.result ?? [])
          assert.ok(held.has(reference.replace("Observation/", "")), reference);
      for (const r of notes)
        for (const { reference } of r.context?.related ?? [])
          assert.ok(held.has(reference.replace("Observation/", "")), reference);
    });

    it("writes the time of one cycle in three to the minute, as C-CDA does, and the rest to the second", () => {
      const times = bundleOf(1000).entry.flatMap(({ resource }) =>
        resource.effectiveDateTime === undefined
          ? []
          : [resource.effectiveDateTime],
      );
      assert.ok(times.some((t) => /T[0-9][0-9]:[0-9][0-9]Z$/.test(t)));
      assert.ok(
        times.some((t) => /T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z$/.test(t)),
      );
    });
  });

  describe("given a series of two imports of 20 resources into one pod, and a pod of 20 opened again", () => {
    it("runs on from the records before it, so that the pulls share no id", () => {
      const ids = [0, 20].flatMap((from) =>
        (
          JSON.parse(
            new TextDecoder().decode(
              syntheticPull(20, { from }).get("pull/bundle.json"),
            ),
          ) as { entry: { resource: { id: string } }[] }
        ).entry.map((e) => e.resource.id),
      );
      assert.equal(new Set(ids).size, ids.length);
      assert.equal(ids.length, 42);
    });

    it("measures each import of the series, with nothing refused, and opens an encrypted pod again", async () => {
      const series = await seriesBench(20, 2);
      assert.equal(series.length, 2);
      for (const run of series) {
        assert.equal(run.refused, undefined);
        assert.ok(run.peakRssMb >= run.rssMb - 1);
      }
      const opened = await openBench(20, true);
      assert.ok(opened.openMs > 0 && opened.firstReadMs > 0);
    });
  });
});
