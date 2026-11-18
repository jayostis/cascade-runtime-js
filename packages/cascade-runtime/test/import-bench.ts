import "./offline.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openPod, type Pod, pullFiles } from "cascade-runtime";
import { answersBeside, resolved } from "../src/node/resolved.js";
import { openPodWith } from "../src/pod.js";
import { probing, type Seen, timed } from "@cascade-runtime/runtime/probe";

/**
 * A bench of `pod.import()` over a pull of one hospital, the pull's shape being Full Picture's (planning#44): one
 * Bundle, about six in ten of it laboratory results over thirteen LOINC codes, the rest conditions, medications,
 * immunizations, allergies and procedures. A cycle of twenty records is one day (12 laboratory results and 8 others, as
 * a visit or a panel is) and a laboratory code recurs on a day in every cycle (a code on about 8 days in 200 resources),
 * because the matcher's cost is its candidate sets: the records of one day and the days of one code. The other kinds
 * have a code to each record, as a person's conditions and medications are rarely the same twice, so only a deliberate
 * repeat shares one. A record repeats one record at most, never a chain of them (an entry of the pod holds two, as real
 * ones hold two or three): in the odd cycles, a record at the positions where `(cycle / 2 + position) % 5 === 0` repeats
 * the record of the same position in the cycle before, with its code and day (12 laboratory results, 2 conditions,
 * 2 medications, 2 immunizations, 1 allergy and 1 procedure in 200 resources). A repeated laboratory result is meant to
 * trigger the same-code-and-day rules on a result (same code, day, value and unit); a repeated condition, medication,
 * immunization, allergy or procedure the same-code-and-date rules.
 * The data is as a hospital's is where a fix depends on it: one cycle in three writes its times to the minute, as a
 * C-CDA does, for the importer to pad; every fifth cycle has a report made from four of its laboratory results and a
 * note made from two others (a fifth of a cycle more than the resources asked for); the document of each pull names
 * the hospital as its author (a pull states no custodian or transmitter, and a C-CDA document in a pull is refused when
 * its import is described otherwise than the Bundle's); and from 400 resources a pull is two, the later beginning again
 * with the last cycle of the first, as a hospital's later pull does, and the two are imported one after another.
 * It imports as the app does, with `claimProfiles` naming the pull's patient, so the matcher compares the records,
 * then reads once.
 *
 * Run it as `npm run bench:import -- 200 1000`: it prints a table per size, and `--json <file>` writes the numbers.
 * With `--second` it imports one hospital's pull, then a second hospital's onto the same pod, and reports the second
 * import alone: the same records from another FHIR base and source, so each has a same-code, same-day twin in the pod
 * and the matcher binds the run's records into its comparisons, the path a first import never takes. With `--reopen` the
 * pod is closed and opened again between the two, as the app does, so that nothing of the first import is kept.
 * With `--read-reopened` it imports one pull, closes the pod and opens it again, and measures the first read and the one
 * after, as the app's host reads a pod an earlier process imported. A pod kept in a folder is opened as a packed runtime
 * opens it, its answers and its build kept beside it.
 * With `--series 20` it makes twenty imports in a row into one pod on disk, each a new pull of the same patient (the
 * days run on from the last, so the records accumulate and the repeats still give the matcher work), measured as one
 * import is, to show whether an import costs by the pod or by the import. With `--reopen-read` it imports each size
 * into a pod on disk, closes it, and times `openPod`, the first read and a second; `--secret` makes the pod encrypted.
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
/** Where the codes of each kind other than laboratory results begin: a record has a code of its own (its index added), so only a deliberate repeat shares one. */
const CODES = {
  condition: 100_000_000,
  medication: 200_000,
  vaccine: 300,
  allergen: 400_000_000,
  procedure: 500_000_000,
} as const;

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
    "union.loadFiles",
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
  const repeat =
    repeats && cycle % 2 === 1 && (Math.floor(cycle / 2) + slot) % 5 === 0;
  const of = repeat ? index - 20 : index;
  const ofCycle = Math.floor(of / 20);
  const whole = new Date(Date.UTC(2020, 0, 1, 8) + ofCycle * 86_400_000)
    .toISOString()
    .replace(".000Z", "Z");
  /** One cycle in three is written as C-CDA writes a time, to the minute: the importer pads it. */
  const at = ofCycle % 3 === 0 ? whole.replace(":00Z", "Z") : whole;
  const day = at.slice(0, 10);
  const subject = { reference: `Patient/${PATIENT}` };
  /** The code at `place` among a kind's records of the cycle, rotated by the cycle so each code recurs on many days (laboratory results only: the rest have a code each). */
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
        String(CODES.condition + of),
        `Condition ${of}`,
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
        String(CODES.medication + of),
        `Medication ${of}`,
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
        String(CODES.vaccine + of),
        `Vaccine ${of}`,
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
        String(CODES.allergen + of),
        `Allergen ${of}`,
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
      String(CODES.procedure + of),
      `Procedure ${of}`,
    ),
    subject,
    performedDateTime: day,
  };
}

/** The reports and notes of a cycle: every fifth cycle has a report of its first four laboratory results and a note on the next two. */
function made(cycle: number): object[] {
  if (cycle % 5 !== 0) return [];
  const first = cycle * 20;
  const day = new Date(Date.UTC(2020, 0, 1, 8) + cycle * 86_400_000)
    .toISOString()
    .replace(".000Z", "Z");
  const results = (from: number, count: number) =>
    Array.from({ length: count }, (_, at) => ({
      reference: `Observation/r${first + from + at}`,
    }));
  return [
    {
      resourceType: "DiagnosticReport",
      id: `report${cycle}`,
      status: "final",
      code: coding(
        "http://loinc.org",
        "24323-8",
        "Comprehensive metabolic panel",
      ),
      subject: { reference: `Patient/${PATIENT}` },
      effectiveDateTime: day,
      result: results(0, 4),
    },
    {
      resourceType: "DocumentReference",
      id: `note${cycle}`,
      status: "current",
      type: coding("http://loinc.org", "11502-2", "Laboratory report"),
      subject: { reference: `Patient/${PATIENT}` },
      date: day,
      context: { related: results(4, 2) },
      content: [
        {
          attachment: {
            contentType: "text/plain",
            title: `Note on cycle ${cycle}`,
          },
        },
      ],
    },
  ];
}

/**
 * A pull of `total` resources (the reports and notes are made from them, a fifth of a cycle more), as one pull or, when there are enough for two, two imports in a row, each the folder `pull`: the first holds the first six tenths and the second the rest,
 * and begins with the cycle the first ended on, as a later pull of a hospital begins again where it last read.
 * `repeats: false` (for tests) leaves out the deliberate repeats.
 */
export function syntheticPulls(
  total: number,
  options: {
    readonly repeats?: boolean | undefined;
    /** The hospital that holds them: the same records from another FHIR base and source are another hospital's. */
    readonly hospital?: keyof typeof HOSPITALS | undefined;
    /** The records before it in the pod, a multiple of 20: its days and ids run on from them. */
    readonly from?: number | undefined;
  } = {},
): ReadonlyMap<string, Uint8Array>[] {
  const { fhirBase, source } = HOSPITALS[options.hospital ?? "first"];
  const from = options.from ?? 0;
  const split = total >= 400 ? Math.floor((total * 0.6) / 20) * 20 : total;
  const parts = [
    {
      folder: "pull",
      begin: 0,
      end: split,
      retrievedAt: "2026-11-01T09:00:00Z",
    },
    ...(split < total
      ? [
          {
            folder: "pull",
            begin: split - 20,
            end: total,
            retrievedAt: "2026-11-02T09:00:00Z",
          },
        ]
      : []),
  ];
  return parts.map(({ folder, begin, end, retrievedAt }) => {
    const entry: { fullUrl: string; resource: object }[] = Array.from(
      { length: end - begin },
      (_, at) => {
        const one = resource(from + begin + at, options.repeats ?? true) as {
          resourceType: string;
          id: string;
        };
        return {
          fullUrl: `${fhirBase}/${one.resourceType}/${one.id}`,
          resource: one,
        };
      },
    );
    const cycles = Array.from(
      { length: Math.floor((end - begin) / 20) },
      (_, at) => (from + begin) / 20 + at,
    );
    for (const one of cycles.flatMap(made) as {
      resourceType: string;
      id: string;
    }[])
      entry.push({
        fullUrl: `${fhirBase}/${one.resourceType}/${one.id}`,
        resource: one,
      });
    return pullFiles(
      {
        fhirBase,
        patient: PATIENT,
        source,
        retrievedAt,
        bundle: { resourceType: "Bundle", type: "collection", entry },
      },
      folder,
    );
  });
}

/** The first pull of `syntheticPulls`, which is all of them where there are fewer than four hundred records. */
export function syntheticPull(
  total: number,
  options: Parameters<typeof syntheticPulls>[1] = {},
): ReadonlyMap<string, Uint8Array> {
  return syntheticPulls(total, options)[0] as ReadonlyMap<string, Uint8Array>;
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
  /** The most the resident set was seen at: sampled at each progress report and every 100 ms, so a long synchronous step can hide a higher one. */
  readonly peakRssMb: number;
}

/** The measurements of one pod that was imported into again and again, and opened again. */
export interface Opened {
  readonly records: number;
  readonly encrypted: boolean;
  readonly importMs: number;
  readonly openMs: number;
  readonly firstReadMs: number;
  /** The spans and counts of the first read alone, the views it rebuilt among them. */
  readonly firstRead: Pick<Measured, "spans" | "counts">;
  readonly secondReadMs: number;
  readonly rssAfterOpenMb: number;
  readonly peakRssMb: number;
}

const SECRET = "t-shirt abacus yo-yo zoom drop-down felt-tip";
const FIRST_READ = "pod/My active conditions";

function rss(): number {
  return Math.round(process.memoryUsage().rss / 1048576);
}

/** `run` with its peak resident set sampled: `seen` is called at the points a caller can give. */
async function sampling<T>(
  run: (seen: () => void) => Promise<T>,
): Promise<{ result: T; peakMb: number }> {
  let peak = 0;
  const seen = (): void => {
    peak = Math.max(peak, rss());
  };
  const timer = setInterval(seen, 100);
  try {
    const result = await run(seen);
    seen();
    return { result, peakMb: peak };
  } finally {
    clearInterval(timer);
  }
}

/** A span named for a file of the vocabulary: a derivation or a query of the layout, of which there are many. */
function byFile(name: string): boolean {
  return name.startsWith("derive.step:") || name.startsWith("build.query:");
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/** The profile a hospital's patient has, which a pull of one resource names as a pull of any size does. */
export async function profileOf(
  hospital: keyof typeof HOSPITALS,
): Promise<readonly string[]> {
  const scratch = await openPod();
  try {
    const { unclaimedProfiles } = await scratch.import(
      syntheticPull(1, { hospital }),
      { match: false },
    );
    return unclaimedProfiles;
  } finally {
    await scratch.close();
  }
}

/** The pod in the folder as a packed runtime opens it, keeping its answers and its build beside it. */
async function openPacked(folder: string): Promise<Pod> {
  return openPodWith(
    { ...(await resolved()), answers: { runtime: "bench", at: answersBeside } },
    folder,
  );
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
  const pulls = syntheticPulls(resources, {
    hospital: second ? "second" : "first",
  });
  const folder = reopen
    ? await mkdtemp(join(tmpdir(), "import-bench-"))
    : undefined;
  const claiming = await profileOf(second ? "second" : "first");
  let pod = folder === undefined ? await openPod() : await openPacked(folder);
  try {
    if (second)
      await importAll(pod, syntheticPulls(resources), await profileOf("first"));
    if (reopen && folder !== undefined) {
      await pod.close();
      pod = await openPacked(folder);
    }
    return await measured(pod, pulls, claiming, resources, true);
  } finally {
    await pod.close();
    if (folder !== undefined)
      await rm(folder, { recursive: true, force: true });
  }
}

/** The pulls imported into the pod one after another, as an app does: what was written, and the first refusal. */
async function importAll(
  pod: Pod,
  pulls: readonly ReadonlyMap<string, Uint8Array>[],
  claimProfiles: readonly string[],
): Promise<{ wrote: string[]; refused: string | undefined }> {
  const wrote: string[] = [];
  let refused: string | undefined;
  for (const pull of pulls) {
    const done = await pod.import(pull, { claimProfiles });
    wrote.push(...done.wrote);
    refused ??= done.refused;
  }
  return { wrote, refused };
}

/** The imports of `pulls` into `pod` one after another, measured as one, with the first read after it when `read`. */
async function measured(
  pod: Pod,
  pulls: readonly ReadonlyMap<string, Uint8Array>[],
  claiming: readonly string[],
  resources: number,
  read: boolean,
): Promise<Measured> {
  const marks: { name: string; at: number }[] = [];
  let started = 0;
  const { result: timing, peakMb } = await sampling((seen) =>
    probing(async () => {
      started = performance.now();
      const wrote: string[] = [];
      let refused: string | undefined;
      for (const [index, pull] of pulls.entries()) {
        const done = await pod.import(pull, {
          claimProfiles: claiming,
          onProgress: ({ part, done, of }) => {
            seen();
            const name = of === undefined ? part : `${part} ${done}/${of}`;
            marks.push({
              name: pulls.length > 1 ? `pull ${index + 1}: ${name}` : name,
              at: performance.now(),
            });
          },
        });
        wrote.push(...done.wrote);
        refused ??= done.refused;
      }
      const done = { wrote, refused };
      const imported = performance.now();
      if (read) await timed("read.first", () => pod.ask(FIRST_READ));
      return { done, imported };
    }),
  );
  const { result, seen } = timing;
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
    rssMb: rss(),
    peakRssMb: peakMb,
  };
}

/** `imports` pulls of `resources`, one after another into one pod on disk, each measured; the last is read once. */
export async function seriesBench(
  resources: number,
  imports: number,
): Promise<readonly Measured[]> {
  const folder = await mkdtemp(join(tmpdir(), "import-bench-"));
  const claiming = await profileOf("first");
  const pod = await openPod(folder);
  try {
    const runs: Measured[] = [];
    for (let index = 0; index < imports; index++) {
      const pulls = syntheticPulls(resources, { from: index * resources });
      const run = await measured(
        pod,
        pulls,
        claiming,
        resources,
        index === imports - 1,
      );
      runs.push(run);
      process.stdout.write(
        `import ${index + 1}/${imports}: ${run.importMs} ms, rss ${run.rssMb} MB\n`,
      );
    }
    return runs;
  } finally {
    await pod.close();
    await rm(folder, { recursive: true, force: true });
  }
}

/** A pod on disk given `records` in one import, closed and opened again: `openPod`, the first read and a second, timed. */
export async function openBench(
  records: number,
  encrypted: boolean,
): Promise<Opened> {
  const folder = await mkdtemp(join(tmpdir(), "import-bench-"));
  const options = encrypted ? { secret: SECRET } : {};
  const claiming = await profileOf("first");
  try {
    let pod = await openPod(folder, options);
    const importing = performance.now();
    await importAll(pod, syntheticPulls(records), claiming);
    const importMs = round(performance.now() - importing);
    await pod.close();
    const { result, peakMb } = await sampling(async () => {
      const opening = performance.now();
      pod = await openPod(folder, options);
      const openMs = round(performance.now() - opening);
      const rssAfterOpenMb = rss();
      const timeOf = async (): Promise<number> => {
        const at = performance.now();
        await pod.ask(FIRST_READ);
        return round(performance.now() - at);
      };
      const { result: firstReadMs, seen } = await probing(timeOf);
      return {
        openMs,
        rssAfterOpenMb,
        firstReadMs,
        firstRead: tabulated(seen),
        secondReadMs: await timeOf(),
      };
    });
    await pod.close();
    return {
      records,
      encrypted,
      importMs,
      ...result,
      peakRssMb: peakMb,
    };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/**
 * The import of a synthetic pull of `resources` into a pod in a folder, closed and opened again; then the first read
 * and one more, measured, the import not.
 */
export async function reopenedReadBench(resources: number): Promise<Measured> {
  const folder = await mkdtemp(join(tmpdir(), "import-bench-"));
  let pod = await openPacked(folder);
  try {
    const started = performance.now();
    const done = await importAll(
      pod,
      syntheticPulls(resources),
      await profileOf("first"),
    );
    const importMs = round(performance.now() - started);
    await pod.close();
    pod = await openPacked(folder);
    const { seen } = await probing(async () => {
      await timed("read.reopened", () => pod.ask("pod/My active conditions"));
      await timed("read.second", () => pod.ask("pod/My active medications"));
    });
    return {
      resources,
      phases: [],
      importMs,
      ...tabulated(seen),
      wrote: done.wrote.length,
      refused: done.refused,
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      peakRssMb: rss(),
    };
  } finally {
    await pod.close();
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

/** The time each stage of an import may take at a size: a run over it fails, so a slowdown shows in CI, not in a report. */
export interface Budget {
  readonly resources: number;
  /** The unit of every time here: milliseconds. */
  readonly unit: "ms";
  /** The runner the times were taken on, which the budget holds for only. */
  readonly runner: string;
  /** The CI runs the budget was set from, each stage's budget being about three times its slowest. */
  readonly calibrationRuns: readonly string[];
  /** Milliseconds by stage: `importMs` is the whole import, any other a span's inclusive time, which the run must have. */
  readonly stagesMs: Readonly<Record<string, number>>;
}

/** Each stage of the budget with the time the run took and whether it is within, and what the run lacks that the budget names. */
export function againstBudget(
  run: Measured,
  budget: Pick<Budget, "resources" | "stagesMs">,
): {
  stage: string;
  ms: number | undefined;
  budgetMs: number;
  within: boolean;
}[] {
  return Object.entries(budget.stagesMs).map(([stage, budgetMs]) => {
    const ms =
      stage === "importMs"
        ? run.importMs
        : run.spans.find(({ name }) => name === stage)?.ms;
    return { stage, ms, budgetMs, within: ms !== undefined && ms <= budgetMs };
  });
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

/**
 * Prints each budgeted stage of the run against its budget. A stage over, or gone from the run, is taken again: `again`
 * runs the bench once more and the process fails, naming them, only for a stage that is over or missing in both runs, as a
 * runner's slow minute is not a slowdown.
 */
async function checkBudget(
  run: Measured,
  file: string,
  again: () => Promise<Measured>,
): Promise<void> {
  const budget = JSON.parse(await readFile(file, "utf8")) as Budget;
  if (run.resources !== budget.resources)
    throw new Error(
      `${file} is the budget of ${budget.resources} resources, not ${run.resources}`,
    );
  const print = (title: string, rows: ReturnType<typeof againstBudget>) =>
    process.stdout.write(
      `${[
        `${title} at ${run.resources} resources (${budget.unit}; ${file})`,
        ...rows.map(
          ({ stage, ms, budgetMs, within }) =>
            `  ${within ? "ok  " : "OVER"} ${stage.padEnd(40)} ${String(ms ?? "missing").padStart(9)} of ${String(budgetMs).padStart(7)}`,
        ),
      ].join("\n")}\n\n`,
    );
  const first = againstBudget(run, budget);
  print("stage budget", first);
  if (first.every(({ within }) => within)) return;
  process.stdout.write(
    "over budget in the first run: running the bench again\n",
  );
  const second = againstBudget(await again(), budget);
  print("stage budget, second run", second);
  const over = first
    .filter(({ within }, at) => !within && !(second[at]?.within ?? true))
    .map(({ stage }) => stage);
  if (over.length > 0) {
    process.stderr.write(`over budget in both runs: ${over.join(", ")}\n`);
    process.exitCode = 1;
  }
}

async function main(args: string[]): Promise<void> {
  const at = args.indexOf("--json");
  const json = at === -1 ? undefined : args[at + 1];
  const series = args.indexOf("--series");
  const imports = series === -1 ? 0 : Number(args[series + 1]);
  const budgeted = args.indexOf("--budget");
  const budgetFile = budgeted === -1 ? undefined : args[budgeted + 1];
  if (
    budgeted !== -1 &&
    (budgetFile === undefined || budgetFile.startsWith("--"))
  ) {
    process.stderr.write("--budget needs the path of a budget file\n");
    process.exitCode = 2;
    return;
  }
  const sizes = args
    .filter(
      (arg, index) =>
        (at === -1 || index !== at + 1) &&
        (series === -1 || index !== series + 1) &&
        /^\d+$/.test(arg),
    )
    .map(Number);
  if (sizes.length === 0) {
    process.stderr.write(
      "usage: import-bench.js [--second | --reopen | --read-reopened | --series <imports> | --reopen-read [--secret]] <resources>... [--json <file>]\n",
    );
    process.exitCode = 2;
    return;
  }
  const runs: unknown[] = [];
  for (const size of sizes) {
    if (imports > 0) runs.push(...(await seriesBench(size, imports)));
    else if (args.includes("--reopen-read")) {
      const opened = await openBench(size, args.includes("--secret"));
      runs.push(opened);
      process.stdout.write(`${JSON.stringify(opened)}
`);
    } else {
      const once = () =>
        args.includes("--read-reopened")
          ? reopenedReadBench(size)
          : importBench(size, {
              second: args.includes("--second"),
              reopen: args.includes("--reopen"),
            });
      const run = await once();
      runs.push(run);
      if (budgetFile !== undefined)
        await checkBudget(run, budgetFile, once as () => Promise<Measured>);
      process.stdout.write(`${tableOf(run)}

`);
    }
  }
  if (json !== undefined)
    await writeFile(json, `${JSON.stringify(runs, null, 2)}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main(process.argv.slice(2));
