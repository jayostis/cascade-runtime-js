import "./offline.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openPod, pullFiles } from "cascade-runtime";
import { probing, type Seen, timed } from "@cascade-runtime/runtime/probe";

/**
 * A bench of `pod.import()` over a pull of one hospital, the pull's shape being Full Picture's (planning#44): one
 * Bundle, about six in ten of it laboratory results over fourteen LOINC codes, the rest conditions, medications,
 * immunizations, allergies and procedures. A cycle of twenty records is one day (about 12 laboratory results and 8
 * others, as a visit or a panel is) and a code recurs on a day in every cycle (a laboratory code on about 8 days in 200
 * resources), because the matcher's cost is its candidate sets: the records of one day and the days of one code.
 * Within a cycle a kind's codes are distinct, so no two share a code and a day by accident; the deliberate repeats are
 * the only matching pairs: a record at each position of a cycle of twenty repeats
 * the record of the same position one cycle before, with its code and day, when `(cycle + position) % 10 === 0`
 * (10 laboratory results, 2 conditions, 2 medications, 2 immunizations, 1 allergy and 1 procedure in 200 resources).
 * A repeated laboratory result is meant to trigger the same-code-and-day rules on a result (same code, day, value and
 * unit); a repeated condition, medication, immunization, allergy or procedure the same-code-and-date rules.
 * It imports as the app does, with `claimProfiles`, so the matcher compares the records, then reads once.
 *
 * Run it as `npm run bench:import -- 200 1000`: it prints a table per size, and `--json <file>` writes the numbers.
 * With `--second` it imports one hospital's pull, then a second hospital's onto the same pod, and reports the second
 * import alone: the same records from another FHIR base and source, so each has a same-code, same-day twin in the pod
 * and the matcher binds the run's records into its comparisons, the path a first import never takes. With `--reopen` the
 * pod is closed and opened again between the two, as the app does, so that nothing of the first import is kept.
 */

const RULE = "matcher.rule:";
const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const HOSPITALS = {
  first: {
    fhirBase: "https://fhir.bench.invalid/r4",
    source: "Bench Hospital",
  },
  second: {
    fhirBase: "https://fhir.second.invalid/r4",
    source: "Second Hospital",
  },
} as const;
const PATIENT = "bench-patient";
const LOINC = [
  ["2823-3", "Potassium", "mmol/L"],
  ["2951-2", "Sodium", "mmol/L"],
  ["2160-0", "Creatinine", "mg/dL"],
  ["718-7", "Hemoglobin", "g/dL"],
  ["4548-4", "Hemoglobin A1c", "%"],
  ["2345-7", "Glucose", "mg/dL"],
  ["2093-3", "Cholesterol", "mg/dL"],
  ["777-3", "Platelets", "10*3/uL"],
  ["6690-2", "Leukocytes", "10*3/uL"],
  ["3094-0", "Urea nitrogen", "mg/dL"],
  ["2075-0", "Chloride", "mmol/L"],
  ["17861-6", "Calcium", "mg/dL"],
  ["1742-6", "Alanine aminotransferase", "U/L"],
  ["1920-8", "Aspartate aminotransferase", "U/L"],
] as const;
const CONDITIONS = [
  "59621000",
  "44054006",
  "195967001",
  "38341003",
  "73211009",
];
const MEDICATIONS = ["197361", "314076", "861007", "197884", "1049630"];
const VACCINES = ["140", "115", "20", "10", "133"];
const ALLERGENS = ["91935009", "256349002", "300916003", "91936005"];
const PROCEDURES = ["80146002", "73761001", "387713003", "399208008"];

/** The spans and counts a run must report, each with a non-zero count, so the bench cannot go quiet on one. */
export const HOT_SPOTS = {
  spans: [
    "arrivals.refuseUnaccounted",
    "arrivals.arrivals",
    "matcher.recordReads",
    "core-pod.matcherSelect",
    "core-pod.matcherView",
    "pod.unclaimedProfiles",
    "pod.profilesTied",
    "incremental.boundValues",
    "store.query",
    "read.first",
    "arrivals.convert",
    "arrivals.accepting",
    "core-pod.import.adapters",
    "core-pod.step.perform",
    "core-pod.step.commit",
    "core-pod.step.rebuild:import+judge",
    "core-pod.step.rebuild:match",
    "kept.step",
    "kept.step.rebuilt",
    "kept.rebuilt.derive",
    "build.queried",
    "union.loadTurtle",
    "pod.judge",
    "pod.match",
    "matcher.of",
  ],
  counts: [
    "graph.scans",
    "graph.quadsVisited",
    "arrivals.arrivals.graph.scans",
    "arrivals.refuseUnaccounted.graph.scans",
    "core-pod.matcherSelect.store.queries",
    "core-pod.matcherView.store.queries",
    "matcher.queriesRun",
    "store.queries",
    "incremental.boundValues.calls",
    "incremental.boundValues.iris",
    "incremental.boundValues.batches",
  ],
} as const;

function coding(system: string, code: string, display: string): object {
  return { coding: [{ system, code, display }], text: display };
}

/** The `index`th resource of a pull: its kind is by position in a cycle of twenty, and with `repeats` some repeat the record one cycle before. */
function resource(index: number, repeats: boolean): object {
  const id = `r${index}`;
  const slot = index % 20;
  const cycle = Math.floor(index / 20);
  const repeat = repeats && cycle > 0 && (cycle + slot) % 10 === 0;
  const of = repeat ? index - 20 : index;
  const ofCycle = Math.floor(of / 20);
  const at = new Date(Date.UTC(2020, 0, 1, 8) + ofCycle * 86_400_000)
    .toISOString()
    .replace(".000Z", "Z");
  const day = at.slice(0, 10);
  const subject = { reference: `Patient/${PATIENT}` };
  /** The code at `place` among a kind's records of the cycle, rotated by the cycle so each code recurs on many days. */
  const rotated = (length: number, place: number): number =>
    (place + ofCycle) % length;
  if (slot < 12) {
    const [code, name, unit] = LOINC[rotated(LOINC.length, slot)] ?? LOINC[0];
    return {
      resourceType: "Observation",
      id,
      status: "final",
      category: [
        {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "laboratory",
            },
          ],
        },
      ],
      code: coding("http://loinc.org", code, name),
      subject,
      effectiveDateTime: at,
      valueQuantity: {
        value: 1 + (of % 97),
        unit,
        system: "http://unitsofmeasure.org",
        code: unit,
      },
    };
  }
  if (slot < 14)
    return {
      resourceType: "Condition",
      id,
      clinicalStatus: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
            code: "active",
          },
        ],
      },
      code: coding(
        "http://snomed.info/sct",
        CONDITIONS[rotated(CONDITIONS.length, slot - 12)] ?? "",
        `Condition ${rotated(CONDITIONS.length, slot - 12)}`,
      ),
      subject,
      onsetDateTime: day,
    };
  if (slot < 16)
    return {
      resourceType: "MedicationRequest",
      id,
      status: "active",
      intent: "order",
      medicationCodeableConcept: coding(
        "http://www.nlm.nih.gov/research/umls/rxnorm",
        MEDICATIONS[rotated(MEDICATIONS.length, slot - 14)] ?? "",
        `Medication ${rotated(MEDICATIONS.length, slot - 14)}`,
      ),
      subject,
      authoredOn: day,
    };
  if (slot < 18)
    return {
      resourceType: "Immunization",
      id,
      status: "completed",
      vaccineCode: coding(
        "http://hl7.org/fhir/sid/cvx",
        VACCINES[rotated(VACCINES.length, slot - 16)] ?? "",
        `Vaccine ${rotated(VACCINES.length, slot - 16)}`,
      ),
      patient: subject,
      occurrenceDateTime: day,
    };
  if (slot < 19)
    return {
      resourceType: "AllergyIntolerance",
      id,
      clinicalStatus: {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
            code: "active",
          },
        ],
      },
      code: coding(
        "http://snomed.info/sct",
        ALLERGENS[rotated(ALLERGENS.length, 0)] ?? "",
        `Allergen ${rotated(ALLERGENS.length, 0)}`,
      ),
      patient: subject,
      onsetDateTime: day,
    };
  return {
    resourceType: "Procedure",
    id,
    status: "completed",
    code: coding(
      "http://snomed.info/sct",
      PROCEDURES[rotated(PROCEDURES.length, 0)] ?? "",
      `Procedure ${rotated(PROCEDURES.length, 0)}`,
    ),
    subject,
    performedDateTime: day,
  };
}

/** A pull of `total` resources, saved as the folder `pull`; `repeats: false` (for tests) leaves out the deliberate repeats. */
export function syntheticPull(
  total: number,
  options: {
    readonly repeats?: boolean | undefined;
    /** The hospital that holds them: the same records from another FHIR base and source are another hospital's. */
    readonly hospital?: keyof typeof HOSPITALS | undefined;
  } = {},
): ReadonlyMap<string, Uint8Array> {
  const { fhirBase, source } = HOSPITALS[options.hospital ?? "first"];
  const entry = Array.from({ length: total }, (_, index) => {
    const one = resource(index, options.repeats ?? true) as {
      resourceType: string;
      id: string;
    };
    return {
      fullUrl: `${fhirBase}/${one.resourceType}/${one.id}`,
      resource: one,
    };
  });
  return pullFiles(
    {
      fhirBase,
      patient: PATIENT,
      source,
      retrievedAt: "2026-11-01T09:00:00Z",
      bundle: { resourceType: "Bundle", type: "collection", entry },
    },
    "pull",
  );
}

export interface Measured {
  readonly resources: number;
  /** Milliseconds from the first progress report of each part of the import to the next, the last to the end. */
  readonly phases: readonly { name: string; ms: number }[];
  readonly importMs: number;
  readonly spans: readonly { name: string; calls: number; ms: number }[];
  readonly counts: Readonly<Record<string, number>>;
  readonly wrote: number;
  readonly refused: string | undefined;
  readonly rssMb: number;
}

/** A span named for a file of the vocabulary: a derivation or a query of the layout, of which there are many. */
function byFile(name: string): boolean {
  return name.startsWith("derive.step:") || name.startsWith("build.query:");
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/**
 * The import of a synthetic pull of `resources`, then the first read and one more, measured; with `second`, the
 * import of the second hospital's pull onto a pod that already holds the first's, which is measured and the first not;
 * with `reopen`, onto that pod closed and opened again from its folder, as the app imports into a pod it has just opened.
 */
export async function importBench(
  resources: number,
  options: { readonly second?: boolean; readonly reopen?: boolean } = {},
): Promise<Measured> {
  const reopen = options.reopen ?? false;
  const second = (options.second ?? false) || reopen;
  const pull = syntheticPull(resources, {
    hospital: second ? "second" : "first",
  });
  const folder = reopen
    ? await mkdtemp(join(tmpdir(), "import-bench-"))
    : undefined;
  let pod = await openPod(folder);
  try {
    if (second)
      await pod.import(syntheticPull(resources), { claimProfiles: true });
    if (reopen) {
      await pod.close();
      pod = await openPod(folder);
    }
    const marks: { name: string; at: number }[] = [];
    let started = 0;
    const { result, seen } = await probing(async () => {
      started = performance.now();
      const done = await pod.import(pull, {
        claimProfiles: true,
        onProgress: ({ part, done, of }) => {
          marks.push({
            name: of === undefined ? part : `${part} ${done}/${of}`,
            at: performance.now(),
          });
        },
      });
      const imported = performance.now();
      await timed("read.first", () => pod.ask("pod/My active conditions"));
      return { done, imported };
    });
    const ends = [...marks.slice(1).map(({ at }) => at), result.imported];
    return {
      resources,
      phases: marks.map(({ name, at }, index) => ({
        name,
        ms: round((ends[index] ?? at) - at),
      })),
      importMs: round(result.imported - started),
      ...tabulated(seen),
      wrote: result.done.wrote.length,
      refused: result.done.refused,
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
    };
  } finally {
    await pod.close();
    if (folder !== undefined)
      await rm(folder, { recursive: true, force: true });
  }
}

function tabulated(seen: Seen): Pick<Measured, "spans" | "counts"> {
  return {
    spans: [...seen.spans]
      .map(([name, { calls, ms }]) => ({ name, calls, ms: round(ms) }))
      .sort((a, b) => b.ms - a.ms),
    counts: Object.fromEntries(
      [...seen.counts].sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  };
}

/** The table a run prints: the phases, then each span with its calls and time, the matcher by rule, then the counts. */
export function tableOf(run: Measured): string {
  const lines = [
    `${run.resources} resources: import ${run.importMs} ms, ${run.wrote} files written, rss ${run.rssMb} MB${run.refused === undefined ? "" : `, REFUSED: ${run.refused}`}`,
    "",
    "phase of the import (ms)",
    ...run.phases.map(
      ({ name, ms }) => `  ${name.padEnd(24)} ${String(ms).padStart(10)}`,
    ),
    "",
    "span (inclusive; calls, ms)",
    ...run.spans
      .filter(({ name }) => !name.startsWith(RULE) && !byFile(name))
      .map(
        ({ name, calls, ms }) =>
          `  ${name.padEnd(34)} ${String(calls).padStart(8)} ${String(ms).padStart(10)}`,
      ),
    "",
    "derivation and layout query, by file (calls, ms)",
    ...run.spans
      .filter(({ name }) => byFile(name))
      .map(
        ({ name, calls, ms }) =>
          `  ${name.padEnd(66)} ${String(calls).padStart(4)} ${String(ms).padStart(9)}`,
      ),
    "",
    "matcher by rule (calls, ms, store queries, rows; a rule sharing another's query text reads its rows and shows 0 ms and 0 queries)",
    ...run.spans
      .filter(({ name }) => name.startsWith("matcher.rule:"))
      .map(({ name, calls, ms }) => {
        const queries = run.counts[`${name}.store.queries`] ?? 0;
        const rows = run.counts[`${name}.rows`] ?? 0;
        return `  ${name.slice(RULE.length).replace(CASCADE, "").padEnd(66)} ${String(calls).padStart(4)} ${String(ms).padStart(9)} ${String(queries).padStart(6)} ${String(rows).padStart(8)}`;
      }),
    "",
    "counts",
    ...Object.entries(run.counts)
      .filter(([name]) => !name.startsWith(RULE))
      .map(
        ([name, count]) => `  ${name.padEnd(70)} ${String(count).padStart(10)}`,
      ),
  ];
  return lines.join("\n");
}

async function main(args: string[]): Promise<void> {
  const at = args.indexOf("--json");
  const json = at === -1 ? undefined : args[at + 1];
  const sizes = args
    .filter(
      (arg, index) => (at === -1 || index !== at + 1) && /^\d+$/.test(arg),
    )
    .map(Number);
  if (sizes.length === 0) {
    process.stderr.write(
      "usage: import-bench.js [--second | --reopen] <resources>... [--json <file>]\n",
    );
    process.exitCode = 2;
    return;
  }
  const runs: Measured[] = [];
  for (const size of sizes) {
    const run = await importBench(size, {
      second: args.includes("--second"),
      reopen: args.includes("--reopen"),
    });
    runs.push(run);
    process.stdout.write(`${tableOf(run)}\n\n`);
  }
  if (json !== undefined)
    await writeFile(json, `${JSON.stringify(runs, null, 2)}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main(process.argv.slice(2));
