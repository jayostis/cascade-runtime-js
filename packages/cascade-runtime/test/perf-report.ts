import "./offline.js";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism, cpus, release, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { pullFiles, openPod, tablesBeside } from "cascade-runtime";
import { componentsOf } from "@cascade-runtime/runtime/node";
import { probing, type Seen, timed } from "@cascade-runtime/runtime/probe";
import { openFolderPod } from "../src/node/folder-pod.js";
import {
  answersBeside,
  databaseBeside,
  resolved,
} from "../src/node/resolved.js";

/**
 * The runtime's performance file: fixed, named scenarios over a real person's record (a Synthea patient the fhir-r4
 * adapter commits under bench/), written as rows in the Bridge spec's result format (cascade-bridge-spec
 * bench/result.schema.json), so one reader and one comparison serve every repository.
 *
 * Run it as `npm run perf -- [--scenario fresh-first-screen,...] [--size synthea-10y,...] [--encryption plain|encrypted|both]
 * [--repeats 3] [--no-probe] [--out file]`.
 *
 * Two kinds of run, never mixed: the headline rows (`<scenario>/total` and the rest that are not under `stage/` or
 * `count/`) come from UNPROBED runs, each in a process of its own, a plain `performance.now()` around each step, repeated
 * (median, range, samples); the stage and count rows come from ONE separate PROBED run, which times some work one at a
 * time and so is slower than a real run: its stages are for finding where time goes, never for adding up to a total.
 */

/** Each scenario's fixed id: the first part of every row's name. */
export const SCENARIOS = [
  "fresh-first-screen",
  "reopen-first-answer",
  "question-page",
  "close",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** A person's record the fhir-r4 adapter commits, by the id a row names it with, and the id of its bench/manifest.json entry. */
export const DATASETS = {
  "synthea-10y": "fhir-r4-synthea-10y-trimmed",
  "synthea-lifetime": "fhir-r4-synthea-lifetime",
} as const;
export type DatasetId = keyof typeof DATASETS;

/** The size every build runs, and the sizes a nightly or on-demand run adds. */
export const PER_BUILD: DatasetId = "synthea-10y";
export const LARGE: DatasetId = "synthea-lifetime";

/**
 * The questions the starter kit's pod page asks first, in its order (cascade-starter-kit app/said.ts `QUESTIONS`,
 * which app/pod-api.ts `asked` asks together), then what it reads after them. Kept here because the kit is another
 * repository; the kit's commit is in the file's `commit` map when a checkout of it is beside this one.
 */
export const FIRST_SCREEN = [
  "entry/Where it came from",
  "pod/What was seen more than once",
  "entry/What needs review",
  "pod/My genetic variants",
  "pod/What each report says of a variant",
  "pod/My medication history",
  "pod/What each import brought in",
  "pod/My active allergies",
  "pod/My active conditions",
  "pod/My lab results",
  "pod/My immunizations",
  "pod/My procedures",
] as const;
/** Asked one after the first screen's questions, as the kit's `waitingForAnswer` does. */
export const THEN = "profile/What needs review";

/** The questions a page of the pod's database answers, each asked for a first page. */
export const PAGES = [
  "pod/My lab results",
  "pod/My medication history",
  "pod/My condition history",
  "pod/My active conditions",
  "pod/My active medications",
  "pod/My active allergies",
  "pod/My immunizations",
  "pod/My procedures",
  "pod/My genetic variants",
  "pod/My reports, notes and documents",
  "pod/What each import brought in",
  "pod/What everything is called",
  "pod/How many of each kind",
  "pod/Which reference versions are current",
  "pod/The person this pod is about",
  "profile/What needs review",
] as const;
export const PAGE_SIZE = 20;

/** The first and the second read of a reopened pod: the bench's, so the numbers continue its. */
const FIRST_READ = "pod/My active conditions";
const SECOND_READ = "pod/My active medications";

const SECRET = "t-shirt abacus yo-yo zoom drop-down felt-tip";
const CHILD = "--child";
const run = promisify(execFile);

/** A row in the Bridge spec's result format. */
export interface Row {
  readonly name: string;
  readonly unit: "s" | "By" | "{count}";
  readonly value: number;
  readonly kind: "clock" | "cost" | "output";
  readonly samples?: number;
  readonly range?: string;
  readonly extra?: string;
}

export interface PerfFile {
  readonly env: {
    readonly os: string;
    readonly runner: string;
    readonly cpus: number;
    readonly node: string;
    readonly host: "node";
    readonly profile: string;
  };
  readonly commit: Readonly<Record<string, string>>;
  readonly results: readonly Row[];
}

/** The name pattern of the Bridge spec's result schema: a path of two or three parts, each lower case. */
const NAME = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){1,2}$/;

/** A span, count or question name as one part of a row's name: lower case, `[a-z0-9._-]`, nothing else (`:` and the like become `-`). */
export function part(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/https?:\/\/[^\s]*[/#]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "");
  return (cleaned === "" ? "x" : cleaned).slice(0, 110);
}

/** Whether a row is one the schema takes; the reason it is not, or undefined. */
export function refused(row: Row): string | undefined {
  if (!NAME.test(row.name)) return `name ${row.name}`;
  if (!Number.isFinite(row.value) || row.value < 0)
    return `value of ${row.name}`;
  if (row.kind === "clock") {
    if (row.samples === undefined || row.samples < 1)
      return `samples of ${row.name}`;
    if (row.range === undefined || !/^\d+(\.\d+)?-\d+(\.\d+)?$/.test(row.range))
      return `range of ${row.name}`;
  }
  return undefined;
}

// ---------------------------------------------------------------- the data

export interface Dataset {
  readonly id: DatasetId;
  /** The sha256 of the uncompressed Bundle, as the adapter's manifest states it, and verified. */
  readonly sha256: string;
  readonly records: number;
  readonly bundle: object;
  readonly fhirBase: string;
  readonly patient: string;
}

async function adapterFolder(): Promise<string> {
  const given = process.env.PERF_INPUTS_DIR;
  if (given !== undefined) return given;
  const components = await componentsOf(
    fileURLToPath(new URL("../../", import.meta.url)),
  );
  const adapter = components.config.adapters.find(({ repository }) =>
    repository.endsWith("cascade-bridge-adapter-fhir-r4"),
  );
  if (adapter === undefined)
    throw new Error("cascade-runtime.json names no fhir-r4 adapter");
  return (await components.resolve(adapter)).folder;
}

/** One Synthea patient's record, read from the adapter's committed input and checked against the digest its manifest holds. */
export async function loadDataset(id: DatasetId): Promise<Dataset> {
  const folder = await adapterFolder();
  const manifest = JSON.parse(
    await readFile(join(folder, "bench", "manifest.json"), "utf8"),
  ) as { inputs: { id: string; path: string; sha256: string }[] };
  const input = manifest.inputs.find(({ id: each }) => each === DATASETS[id]);
  if (input === undefined)
    throw new Error(
      `the adapter's bench/manifest.json holds no ${DATASETS[id]}`,
    );
  const bytes = gunzipSync(await readFile(join(folder, input.path)));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== input.sha256)
    throw new Error(
      `${input.path} is ${sha256}, the manifest says ${input.sha256}`,
    );
  const bundle = JSON.parse(new TextDecoder().decode(bytes)) as {
    entry: {
      fullUrl: string;
      resource: { resourceType: string; id: string };
    }[];
  };
  const patient = bundle.entry.find(
    ({ resource }) => resource.resourceType === "Patient",
  );
  if (patient === undefined) throw new Error(`${input.path} has no Patient`);
  const fhirBase = patient.fullUrl.slice(
    0,
    patient.fullUrl.lastIndexOf(`/Patient/${patient.resource.id}`),
  );
  return {
    id,
    sha256,
    records: bundle.entry.length,
    bundle,
    fhirBase,
    patient: patient.resource.id,
  };
}

function pullOf(
  data: Dataset,
  bundle: object,
): ReadonlyMap<string, Uint8Array> {
  return pullFiles(
    {
      fhirBase: data.fhirBase,
      patient: data.patient,
      source: "Synthea",
      retrievedAt: "2026-11-01T09:00:00Z",
      bundle,
    },
    "pull",
  );
}

/** The profile the record's patient has, which an import that names it as the person's own takes: found in a pod of its own, apart from every run measured. */
export async function profileOfPatient(
  data: Dataset,
): Promise<readonly string[]> {
  const { entry } = data.bundle as {
    entry: { resource: { resourceType: string } }[];
  };
  const only = {
    resourceType: "Bundle",
    type: "collection",
    entry: entry.filter(({ resource }) => resource.resourceType === "Patient"),
  };
  const scratch = await openPod();
  try {
    const { unclaimedProfiles } = await scratch.import(pullOf(data, only), {
      match: false,
    });
    return unclaimedProfiles;
  } finally {
    await scratch.close();
  }
}

// --------------------------------------------------------- one child process

interface Job {
  readonly scenario: "fresh" | "reopen" | "question-page";
  readonly dataset: DatasetId;
  readonly encrypted: boolean;
  readonly probed: boolean;
  readonly folder: string;
  readonly claim: readonly string[];
  readonly out: string;
}

/** What a child measured; times in seconds. */
export interface Measured {
  /** Seconds by step, from a plain clock. */
  readonly seconds: Readonly<Record<string, number>>;
  /** Seconds by the import's own parts (loading the adapter, converting, saving, judging…). */
  readonly parts: Readonly<Record<string, number>>;
  readonly rssBytes: number;
  readonly peakRssBytes: number;
  readonly wrote?: number;
  readonly seen?: Tabulated;
  /** The close alone, for a fresh run: its own probe. */
  readonly closeSeen?: Tabulated;
}

export interface Tabulated {
  readonly spans: readonly { name: string; calls: number; ms: number }[];
  readonly counts: Readonly<Record<string, number>>;
}

function tabulated(seen: Seen): Tabulated {
  return {
    spans: [...seen.spans]
      .map(([name, { calls, ms }]) => ({ name, calls, ms }))
      .sort((a, b) => b.ms - a.ms),
    counts: Object.fromEntries(
      [...seen.counts].sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  };
}

/** The pod in the folder as a packed runtime opens it: its answers, its build and its database kept beside it, its tables beside the folder. */
async function openedAt(folder: string, encrypted: boolean) {
  const parts = {
    ...(await resolved()),
    answers: { runtime: "perf", at: answersBeside },
    databaseBeside,
    tables: await tablesBeside(dirname(folder)),
  };
  return openFolderPod(parts, folder, encrypted ? { secret: SECRET } : {});
}

async function maybeProbed<T>(
  on: boolean,
  work: () => Promise<T>,
): Promise<{ result: T; seen?: Tabulated }> {
  if (!on) return { result: await work() };
  const { result, seen } = await probing(work);
  return { result, seen: tabulated(seen) };
}

/** One scenario in this process, which is as fresh as a process is: nothing is warm that a run of the app would not have warm. */
async function measure(job: Job): Promise<Measured> {
  const seconds: Record<string, number> = {};
  const parts: Record<string, number> = {};
  /** Runs the step as the named span, timing it with a plain clock either way. */
  const step = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await timed(`scenario.${name}`, work);
    } finally {
      seconds[name] = (performance.now() - started) / 1000;
    }
  };
  const data =
    job.scenario === "fresh" ? await loadDataset(job.dataset) : undefined;
  let pull = data === undefined ? undefined : pullOf(data, data.bundle);
  let wrote = 0;
  let rssBytes = 0;
  let seen: Tabulated | undefined;
  let closeSeen: Tabulated | undefined;
  let pod: Awaited<ReturnType<typeof openedAt>> | undefined;
  if (job.scenario === "fresh") {
    // The harness's own copy of the record is dropped before the pod opens, so it is not in what the pod is charged.
    (data as { bundle: unknown }).bundle = undefined;
    const body = await maybeProbed(job.probed, async () => {
      pod = await step("open", () => openedAt(job.folder, job.encrypted));
      const opened = pod;
      const marks: { part: string; at: number }[] = [];
      const done = await step("import", () =>
        opened.import(pull as ReadonlyMap<string, Uint8Array>, {
          claimProfiles: job.claim,
          onProgress: ({ part: named }) => {
            marks.push({ part: named, at: performance.now() });
          },
        }),
      );
      pull = undefined;
      if (done.refused !== undefined)
        throw new Error(`the import was refused: ${done.refused}`);
      wrote = done.wrote.length;
      const ended = performance.now();
      marks.forEach(({ part: named, at }, index) => {
        const next = marks[index + 1]?.at ?? ended;
        parts[named] = (parts[named] ?? 0) + (next - at) / 1000;
      });
      await step("first-screen", async () => {
        await Promise.all(FIRST_SCREEN.map((question) => opened.ask(question)));
        await opened.unheldTableVersions();
        await opened.ask(THEN);
      });
    });
    seen = body.seen;
    rssBytes = process.memoryUsage.rss();
    const closing = await maybeProbed(job.probed, () =>
      step("close", () => (pod as NonNullable<typeof pod>).close()),
    );
    closeSeen = closing.seen;
  } else if (job.scenario === "reopen") {
    const body = await maybeProbed(job.probed, async () => {
      const opened = await step("open", () =>
        openedAt(job.folder, job.encrypted),
      );
      await step("first-read", () => opened.ask(FIRST_READ));
      await step("second-read", () => opened.ask(SECOND_READ));
      rssBytes = process.memoryUsage.rss();
      await step("close", () => opened.close());
    });
    seen = body.seen;
  } else {
    const opened = await openedAt(job.folder, job.encrypted);
    await opened.ask(FIRST_READ);
    rssBytes = process.memoryUsage.rss();
    const body = await maybeProbed(job.probed, async () => {
      for (const question of PAGES) {
        const started = performance.now();
        await opened.askPage(question, { size: PAGE_SIZE });
        seconds[`question:${question}`] = (performance.now() - started) / 1000;
      }
    });
    seen = body.seen;
    await opened.close();
  }
  return {
    seconds,
    parts,
    rssBytes,
    // The most the resident set reached in this process, which the operating system keeps exactly (KiB).
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    ...(wrote > 0 && { wrote }),
    ...(seen && { seen }),
    ...(closeSeen && { closeSeen }),
  };
}

// ------------------------------------------------------------------ the parent

async function child(job: Omit<Job, "out">, dir: string): Promise<Measured> {
  const out = join(dir, `result-${Math.random().toString(36).slice(2)}.json`);
  await run(
    process.execPath,
    [
      ...process.execArgv,
      fileURLToPath(import.meta.url),
      CHILD,
      JSON.stringify({ ...job, out }),
    ],
    { maxBuffer: 1 << 26, timeout: 3 * 3_600_000 },
  );
  return JSON.parse(await readFile(out, "utf8")) as Measured;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

const fixed = (value: number, places: number): number =>
  Number(value.toFixed(places));

/** A noisy measurement as a row: the median of its samples and their range. */
export function clockRow(
  name: string,
  unit: "s" | "By",
  samples: readonly number[],
  extra: string,
): Row {
  const places = unit === "s" ? 3 : 0;
  return {
    name,
    unit,
    value: fixed(median(samples), places),
    kind: "clock",
    samples: samples.length,
    range: `${Math.min(...samples).toFixed(places)}-${Math.max(...samples).toFixed(places)}`,
    extra,
  };
}

const countRow = (name: string, value: number, extra?: string): Row => ({
  name,
  unit: "{count}",
  value,
  kind: "cost",
  ...(extra !== undefined && { extra }),
});

/** Gives each name once: a name taken already is told apart by a number. */
function unique(taken: Set<string>, name: string): string {
  let candidate = name;
  for (let at = 2; taken.has(candidate); at++) candidate = `${name}-${at}`;
  taken.add(candidate);
  return candidate;
}

/** The stage and count rows of one probed run, under the scenario's name. */
export function probedRows(
  prefix: string,
  seen: Tabulated,
  limit = 250,
): Row[] {
  const taken = new Set<string>();
  const rows: Row[] = [];
  for (const { name, calls, ms } of seen.spans.slice(0, limit))
    rows.push({
      name: `${prefix}/stage/${unique(taken, part(name))}`,
      unit: "s",
      value: fixed(ms / 1000, 4),
      kind: "clock",
      samples: 1,
      range: `${(ms / 1000).toFixed(4)}-${(ms / 1000).toFixed(4)}`,
      extra: `probed run, ${calls} calls, inclusive of the spans inside it; ${name.slice(0, 140)}`,
    });
  const counted = new Set<string>();
  for (const [name, value] of Object.entries(seen.counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit))
    rows.push(
      countRow(
        `${prefix}/count/${unique(counted, part(name))}`,
        value,
        `probed run; ${name.slice(0, 160)}`,
      ),
    );
  return rows;
}

interface Plan {
  readonly scenarios: ReadonlySet<Scenario>;
  readonly sizes: readonly DatasetId[];
  readonly encryption: "plain" | "encrypted" | "both" | "auto";
  readonly repeats: number;
  readonly probe: boolean;
}

const nameOf = (scenario: Scenario, dataset: DatasetId, encrypted: boolean) =>
  `${scenario}-${dataset}${encrypted ? "-encrypted" : ""}`;

/** Every scenario wanted at one size, encrypted or not: runs them and gives their rows. */
async function scenariosAt(
  plan: Plan,
  dataset: DatasetId,
  encrypted: boolean,
  work: string,
  log: (line: string) => void,
): Promise<Row[]> {
  const data = await loadDataset(dataset);
  const claim = await profileOfPatient(data);
  const about = `dataset=${dataset} sha256=${data.sha256} records=${data.records}${encrypted ? " encrypted" : ""}`;
  const wants = (scenario: Scenario) => plan.scenarios.has(scenario);
  const rows: Row[] = [
    countRow(
      `${nameOf("fresh-first-screen", dataset, encrypted)}/count/records`,
      data.records,
      about,
    ),
  ];
  const place = (label: string) => join(work, label, "pod");
  const unprobed = (label: string, kind: Job["scenario"]) => ({
    scenario: kind,
    dataset,
    encrypted,
    probed: false,
    folder: place(label),
    claim,
  });

  // fresh: the headline runs, then the probed one. The last unprobed pod stays for the scenarios that open one.
  const needsPod = wants("reopen-first-answer") || wants("question-page");
  const fresh: Measured[] = [];
  let kept: string | undefined;
  const freshRuns =
    wants("fresh-first-screen") || wants("close")
      ? plan.repeats
      : needsPod
        ? 1
        : 0;
  for (let at = 0; at < freshRuns; at++) {
    const label = `fresh-${at}`;
    log(
      `${dataset}${encrypted ? " encrypted" : ""}: fresh run ${at + 1}/${freshRuns}`,
    );
    fresh.push(await child(unprobed(label, "fresh"), work));
    if (kept !== undefined)
      await rm(dirname(dirname(kept)), { recursive: true, force: true });
    kept = place(label);
  }
  const samples = (pick: (each: Measured) => number | undefined) =>
    fresh.flatMap((each) => pick(each) ?? []);
  const secs = (each: Measured, ...names: string[]) =>
    names.reduce((sum, name) => sum + (each.seconds[name] ?? 0), 0);
  const how = `unprobed, median of ${plan.repeats} runs, each in a process of its own; ${about}`;
  if (wants("fresh-first-screen") && fresh.length > 0) {
    const name = nameOf("fresh-first-screen", dataset, encrypted);
    rows.push(
      clockRow(
        `${name}/total`,
        "s",
        fresh.map((each) => secs(each, "open", "import", "first-screen")),
        `open + import + first screen; ${how}`,
      ),
      clockRow(
        `${name}/open`,
        "s",
        samples((each) => each.seconds.open),
        how,
      ),
      clockRow(
        `${name}/import`,
        "s",
        samples((each) => each.seconds.import),
        how,
      ),
      clockRow(
        `${name}/first-screen`,
        "s",
        samples((each) => each.seconds["first-screen"]),
        how,
      ),
      clockRow(
        `${name}/rss`,
        "By",
        samples((each) => each.rssBytes),
        `after the first screen, before close; includes the harness's copy of the input; ${how}`,
      ),
      clockRow(
        `${name}/peak-rss`,
        "By",
        samples((each) => each.peakRssBytes),
        `the most the process reached, as the operating system keeps it; ${how}`,
      ),
    );
    const named = new Set(fresh.flatMap((each) => Object.keys(each.parts)));
    const taken = new Set<string>();
    for (const each of named)
      rows.push(
        clockRow(
          `${name}/${unique(taken, `phase-${part(each.replace(/\s*\d+\/\d+$/, ""))}`)}`,
          "s",
          samples((one) => one.parts[each]),
          `part of the import (onProgress marks); ${how}`,
        ),
      );
    const wrote = fresh[0]?.wrote;
    if (wrote !== undefined)
      rows.push(countRow(`${name}/count/files-written`, wrote, about));
  }
  if (wants("close") && fresh.length > 0)
    rows.push(
      clockRow(
        `${nameOf("close", dataset, encrypted)}/total`,
        "s",
        samples((each) => each.seconds.close),
        `closing a pod right after its import and first screen; ${how}`,
      ),
    );

  // the probed fresh run, on a pod of its own.
  if (plan.probe && (wants("fresh-first-screen") || wants("close"))) {
    log(`${dataset}${encrypted ? " encrypted" : ""}: fresh run, probed`);
    const probed = await child(
      { ...unprobed("fresh-probed", "fresh"), probed: true },
      work,
    );
    await rm(dirname(place("fresh-probed")), { recursive: true, force: true });
    const note = `probed run: some work runs one at a time, so these are slower than the same steps unprobed`;
    if (wants("fresh-first-screen") && probed.seen !== undefined) {
      const name = nameOf("fresh-first-screen", dataset, encrypted);
      rows.push(
        {
          ...clockRow(
            `${name}/probed-total`,
            "s",
            [secs(probed, "open", "import", "first-screen")],
            note,
          ),
        },
        ...probedRows(name, probed.seen),
      );
    }
    if (wants("close") && probed.closeSeen !== undefined) {
      const name = nameOf("close", dataset, encrypted);
      rows.push(
        clockRow(
          `${name}/probed-total`,
          "s",
          [probed.seconds.close ?? 0],
          note,
        ),
        ...probedRows(name, probed.closeSeen),
      );
    }
  }

  // reopen and question-page, on the last pod a fresh run left.
  for (const [scenario, kind] of [
    ["reopen-first-answer", "reopen"],
    ["question-page", "question-page"],
  ] as const) {
    if (!wants(scenario) || kept === undefined) continue;
    const name = nameOf(scenario, dataset, encrypted);
    const label = `fresh-${freshRuns - 1}`;
    const job = (probed: boolean): Omit<Job, "out"> => ({
      ...unprobed(label, kind),
      probed,
    });
    const runs: Measured[] = [];
    for (let at = 0; at < plan.repeats; at++) {
      log(
        `${dataset}${encrypted ? " encrypted" : ""}: ${scenario} ${at + 1}/${plan.repeats}`,
      );
      runs.push(await child(job(false), work));
    }
    const from = (pick: (each: Measured) => number | undefined) =>
      runs.flatMap((each) => pick(each) ?? []);
    if (kind === "reopen")
      rows.push(
        clockRow(
          `${name}/total`,
          "s",
          runs.map((each) => secs(each, "open", "first-read")),
          `open + first read; ${how}`,
        ),
        clockRow(
          `${name}/open`,
          "s",
          from((each) => each.seconds.open),
          how,
        ),
        clockRow(
          `${name}/first-read`,
          "s",
          from((each) => each.seconds["first-read"]),
          `${FIRST_READ}; ${how}`,
        ),
        clockRow(
          `${name}/second-read`,
          "s",
          from((each) => each.seconds["second-read"]),
          `${SECOND_READ}; ${how}`,
        ),
        clockRow(
          `${name}/close`,
          "s",
          from((each) => each.seconds.close),
          how,
        ),
        clockRow(
          `${name}/rss`,
          "By",
          runs.map((each) => each.rssBytes),
          `after the second read; ${how}`,
        ),
        clockRow(
          `${name}/peak-rss`,
          "By",
          runs.map((each) => each.peakRssBytes),
          how,
        ),
      );
    else {
      const taken = new Set<string>();
      rows.push(
        clockRow(
          `${name}/total`,
          "s",
          runs.map((each) =>
            Object.entries(each.seconds).reduce(
              (sum, [, value]) => sum + value,
              0,
            ),
          ),
          `${PAGES.length} questions, a page of ${PAGE_SIZE} each, from pod.db; ${how}`,
        ),
        clockRow(
          `${name}/rss`,
          "By",
          runs.map((each) => each.rssBytes),
          `after a first read, before the pages; ${how}`,
        ),
        clockRow(
          `${name}/peak-rss`,
          "By",
          runs.map((each) => each.peakRssBytes),
          how,
        ),
      );
      for (const question of PAGES)
        rows.push(
          clockRow(
            `${name}/${unique(taken, `question-${part(question)}`)}`,
            "s",
            from((each) => each.seconds[`question:${question}`]),
            `askPage(${question}, size ${PAGE_SIZE}); ${how}`,
          ),
        );
    }
    if (plan.probe) {
      log(`${dataset}${encrypted ? " encrypted" : ""}: ${scenario}, probed`);
      const probed = await child(job(true), work);
      if (probed.seen !== undefined) {
        const total =
          kind === "reopen"
            ? secs(probed, "open", "first-read")
            : Object.values(probed.seconds).reduce(
                (sum, value) => sum + value,
                0,
              );
        rows.push(
          clockRow(
            `${name}/probed-total`,
            "s",
            [total],
            `probed run: some work runs one at a time, so these are slower than the same steps unprobed`,
          ),
          ...probedRows(name, probed.seen),
        );
      }
    }
  }
  if (kept !== undefined)
    await rm(dirname(dirname(kept)), { recursive: true, force: true });
  return rows;
}

function git(folder: string, ...args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", folder, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/** A checkout's HEAD, `-dirty` when it holds changes the commit does not. */
function headOf(folder: string): string | undefined {
  const head = git(folder, "rev-parse", "HEAD");
  if (head === undefined || !/^[0-9a-f]{40}$/.test(head)) return undefined;
  return git(folder, "status", "--porcelain") === "" ? head : `${head}-dirty`;
}

/** The commit of the runtime and of each component the run read, the kit's when a checkout of it is beside. */
async function commits(): Promise<Record<string, string>> {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const found: Record<string, string | undefined> = { runtime: headOf(root) };
  const parts = await resolved();
  const { commit, uncommitted = 0 } = parts.local.resolved;
  if (commit !== undefined && /^[0-9a-f]{40}$/.test(commit))
    found.vocabulary = uncommitted > 0 ? `${commit}-dirty` : commit;
  try {
    const bridge = await (
      await componentsOf(fileURLToPath(new URL("../../", import.meta.url)))
    ).bridge();
    if (/^[0-9a-f]{40}$/.test(bridge.commit)) found.bridge = bridge.commit;
  } catch {
    // The Bridge's commit is left out of a file written where it cannot be found.
  }
  const kit = join(dirname(root), "cascade-starter-kit");
  if (existsSync(kit)) found.kit = headOf(kit);
  return Object.fromEntries(
    Object.entries(found).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function envOf(plan: Plan): PerfFile["env"] {
  const model = cpus()[0]?.model.replace(/\s+/g, " ").trim() ?? "unknown cpu";
  const runner =
    process.env.GITHUB_ACTIONS === "true"
      ? `github-actions ${process.env.RUNNER_OS ?? ""} ${process.env.RUNNER_NAME ?? ""}`.trim()
      : "local";
  return {
    os: `${process.platform} ${release()}`,
    runner: `${runner}; ${model}; other load: ${process.env.PERF_OTHER_LOAD ?? "none known"}`,
    cpus: availableParallelism(),
    node: process.versions.node,
    host: "node",
    profile: `runtime-perf ${[...plan.scenarios].join("+")}; headline unprobed median of ${plan.repeats}${plan.probe ? ", stages from one probed run" : ""}`,
  };
}

function parsed(args: string[]): { plan: Plan; out: string | undefined } {
  const value = (flag: string): string | undefined => {
    const at = args.indexOf(flag);
    return at === -1 ? undefined : args[at + 1];
  };
  const list = <T extends string>(
    text: string | undefined,
    all: readonly T[],
    what: string,
  ): T[] =>
    (text === undefined ? [...all] : text.split(",")).map((each) => {
      if (!(all as readonly string[]).includes(each))
        throw new Error(`no ${what} ${each}; there are ${all.join(", ")}`);
      return each as T;
    });
  const sizes = list(
    value("--size") ?? value("--sizes") ?? PER_BUILD,
    Object.keys(DATASETS) as DatasetId[],
    "size",
  );
  const encryption = (value("--encryption") ?? "auto") as Plan["encryption"];
  if (!["plain", "encrypted", "both", "auto"].includes(encryption))
    throw new Error("--encryption is plain, encrypted, both or auto");
  return {
    plan: {
      scenarios: new Set(list(value("--scenario"), SCENARIOS, "scenario")),
      sizes,
      encryption,
      repeats: Number(value("--repeats") ?? 3),
      probe: !args.includes("--no-probe"),
    },
    out: value("--out"),
  };
}

/** The file for a plan: every scenario at every size, plain, and encrypted at the large size. */
export async function perfFile(
  plan: Plan,
  log: (line: string) => void = () => undefined,
): Promise<PerfFile> {
  const work = await mkdtemp(join(tmpdir(), "perf-report-"));
  try {
    const results: Row[] = [];
    for (const size of plan.sizes) {
      const modes: boolean[] =
        plan.encryption === "plain"
          ? [false]
          : plan.encryption === "encrypted"
            ? [true]
            : plan.encryption === "both" ||
                (plan.encryption === "auto" && size === LARGE)
              ? [false, true]
              : [false];
      for (const encrypted of modes)
        results.push(...(await scenariosAt(plan, size, encrypted, work, log)));
    }
    const bad = results.map(refused).find((reason) => reason !== undefined);
    if (bad !== undefined)
      throw new Error(`a row the result schema refuses: ${bad}`);
    return { env: envOf(plan), commit: await commits(), results };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main(args: string[]): Promise<void> {
  const at = args.indexOf(CHILD);
  if (at !== -1) {
    const job = JSON.parse(args[at + 1] as string) as Job;
    await writeFile(job.out, JSON.stringify(await measure(job)));
    return;
  }
  const { plan, out } = parsed(args);
  const file = await perfFile(plan, (line) =>
    process.stderr.write(`${line}\n`),
  );
  const text = `${JSON.stringify(file, null, 2)}\n`;
  if (out === undefined) process.stdout.write(text);
  else await writeFile(out, text);
  process.stderr.write(
    `${file.results.length} rows${out === undefined ? "" : ` written to ${out}`}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main(process.argv.slice(2));
