import "./offline.js";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { availableParallelism, cpus, release, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { pullFiles, openPod, tablesBeside } from "cascade-runtime";
import { componentsOf, findRoot } from "@cascade-runtime/runtime/node";
import { probing, type Seen, timed } from "@cascade-runtime/runtime/probe";
import { explain, explainSpan } from "./perf-glossary.js";
import { chromeTrace, selfTimes } from "./perf-trace.js";
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
 * [--repeats 3] [--no-probe] [--out file] [--profiles folder [--no-cpu-profile]]`.
 *
 * Two kinds of run, never mixed: the headline rows (`<scenario>/total` and the rest that are not under `stage/` or
 * `count/`) come from UNPROBED runs, each in a process of its own, a plain `performance.now()` around each step, repeated
 * (median, range, samples); the stage and count rows come from ONE separate PROBED run, which times some work one at a
 * time and so is slower than a real run: its stages are for finding where time goes, never for adding up to a total.
 *
 * With `--profiles`, the folder also gets, for each scenario, a trace of the probed run (`<scenario>-<size>.trace.json`, every
 * call as a Chrome trace event) and a CPU profile of one more, unprobed run (`<scenario>-<size>.cpuprofile`, which node
 * writes), and `flame.json` that lists them with the steps whose own time was longest. speedscope opens both.
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
 * The questions the starter kit's pod page asks first, in its order (cascade-starter-kit app/said.ts `QUESTIONS`),
 * and `THEN`, the profile's question (app/pod-api.ts `waitingForAnswer`), which the kit's `asked` starts in the same
 * breath, with `unheldTableVersions()`. Kept here because the kit is another repository; the kit's commit is in the
 * file's `commit` map when a checkout of it is beside this one, and a test fails when one of these is not in said.ts.
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
/** What the kit's `waitingForAnswer` asks, with the first screen's questions. */
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
  // A Bundle whose entries are named urn:uuid:… has no server; the pull is given one, as a hospital's would be.
  const fhirBase = patient.fullUrl.startsWith("https://")
    ? patient.fullUrl.slice(
        0,
        patient.fullUrl.lastIndexOf(`/Patient/${patient.resource.id}`),
      )
    : "https://synthea.demo.invalid/fhir";
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
  /** Where a probed run writes the trace of each scenario it ran. */
  readonly profiles?: string;
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
  /** The traces a probed run wrote. */
  readonly traces?: readonly TraceNote[];
}

/** A trace file a probed run wrote, and what is worth saying of it without opening it. */
export interface TraceNote {
  readonly scenario: Scenario;
  readonly dataset: DatasetId;
  readonly encrypted: boolean;
  readonly file: string;
  readonly bytes: number;
  /** Calls the probe saw, and calls the file draws, each as an event of its own. */
  readonly calls: number;
  readonly drawn: number;
  /** Calls shorter than this are not drawn, in milliseconds; 0 when all are. */
  readonly shortestMs: number;
  /** Calls drawn together because too many ran at the same time, and the merged events that stand for them. */
  readonly merged: number;
  readonly mergedEvents: number;
  /** How long the probed run took, from its first call to its last, in milliseconds: what each step's share of the run is of. */
  readonly runMs?: number;
  readonly top: readonly {
    name: string;
    selfMs: number;
    calls: number;
    says?: string;
  }[];
  /**
   * The Bridge's queries by their total time, which the file does not draw: the Bridge says how long each took in all and
   * not when, and a stage's own time includes the queries it ran.
   */
  readonly bridgeQueries: readonly {
    name: string;
    ms: number;
    calls: number;
    says?: string;
  }[];
}

/** The most own time a trace's top list names. */
const TOP = 10;

/** What the name of a span of one of the Bridge's queries begins with, as `bridgeSpans` records it. */
const BRIDGE_QUERY = "bridge.query:";

export interface Tabulated {
  /** Each span's calls, the sum of their own times (`ms`) and the time some call of it was in progress (`wallMs`). */
  readonly spans: readonly {
    name: string;
    calls: number;
    ms: number;
    wallMs: number;
    /** The time some call of it was in progress with none of the spans inside it in progress; only for a traced run. */
    selfWallMs?: number;
  }[];
  readonly counts: Readonly<Record<string, number>>;
}

export function tabulated(seen: Seen): Tabulated {
  const selves = seen.events === undefined ? undefined : selfTimes(seen.events);
  return {
    spans: [...seen.spans]
      .map(([name, { calls, ms, wallMs }]) => ({
        name,
        calls,
        ms,
        wallMs,
        ...(selves?.has(name) && { selfWallMs: selves.get(name) as number }),
      }))
      .sort((a, b) => b.wallMs - a.wallMs),
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

/** A scenario at a size, the first part of the names of its rows and files. */
const nameOf = (scenario: Scenario, dataset: DatasetId, encrypted: boolean) =>
  `${scenario}-${dataset}${encrypted ? "-encrypted" : ""}`;

/** The trace of a probed run, written to `dir`, and what to say of it. */
async function traced(
  dir: string,
  scenario: Scenario,
  job: Job,
  seen: Seen,
  table: Tabulated,
): Promise<TraceNote> {
  const name = nameOf(scenario, job.dataset, job.encrypted);
  const {
    file,
    seen: calls,
    kept,
    shortestMs,
    merged,
    mergedEvents,
  } = chromeTrace(seen.events ?? [], {
    title: `${scenario} on ${job.dataset}${job.encrypted ? ", encrypted" : ""}: the probed run`,
    says: (span) => explainSpan(part(span)),
  });
  const spans = seen.events ?? [];
  const runMs =
    spans.length === 0
      ? undefined
      : fixed(
          spans.reduce((last, { end }) => Math.max(last, end), -Infinity) -
            spans.reduce(
              (first, { start }) => Math.min(first, start),
              Infinity,
            ),
          3,
        );
  const text = JSON.stringify(file);
  const path = `${name}.trace.json`;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, path), text);
  const top = [...table.spans]
    .filter(({ selfWallMs = 0 }) => selfWallMs > 0)
    .sort((a, b) => (b.selfWallMs ?? 0) - (a.selfWallMs ?? 0))
    .slice(0, TOP)
    .map(({ name: span, selfWallMs = 0, calls: count }) => {
      const says = explainSpan(part(span));
      return {
        name: span,
        selfMs: fixed(selfWallMs, 3),
        calls: count,
        ...(says !== undefined && { says }),
      };
    });
  return {
    scenario,
    dataset: job.dataset,
    encrypted: job.encrypted,
    file: path,
    bytes: Buffer.byteLength(text),
    calls,
    drawn: kept,
    shortestMs: fixed(shortestMs, 3),
    merged,
    mergedEvents,
    ...(runMs !== undefined && { runMs }),
    top,
    bridgeQueries: table.spans
      .filter(({ name: span }) => span.startsWith(BRIDGE_QUERY))
      .sort((a, b) => b.wallMs - a.wallMs)
      .slice(0, TOP)
      .map(({ name: span, wallMs, calls: count }) => {
        const says = explainSpan(part(span));
        return {
          name: span.slice(BRIDGE_QUERY.length).replace(/^.*\//, ""),
          ms: fixed(wallMs, 3),
          calls: count,
          ...(says !== undefined && { says }),
        };
      }),
  };
}

/** The work as a probed run when the job is one, and its trace written where the job says. */
async function maybeProbed<T>(
  job: Job,
  scenario: Scenario,
  notes: TraceNote[],
  work: () => Promise<T>,
): Promise<{ result: T; seen?: Tabulated }> {
  if (!job.probed) return { result: await work() };
  const { result, seen } = await probing(work, { trace: true });
  const table = tabulated(seen);
  if (job.profiles !== undefined)
    notes.push(await traced(job.profiles, scenario, job, seen, table));
  return { result, seen: table };
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
  const notes: TraceNote[] = [];
  let pod: Awaited<ReturnType<typeof openedAt>> | undefined;
  if (job.scenario === "fresh") {
    // The harness's own copy of the record is dropped before the pod opens, so it is not in what the pod is charged.
    (data as { bundle: unknown }).bundle = undefined;
    const body = await maybeProbed(
      job,
      "fresh-first-screen",
      notes,
      async () => {
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
        // All together, as the kit's `asked` starts them: the questions, the tables newer than the pod's, and the profile's.
        await step("first-screen", async () => {
          await Promise.all([
            opened.unheldTableVersions(),
            opened.ask(THEN),
            ...FIRST_SCREEN.map((question) => opened.ask(question)),
          ]);
        });
      },
    );
    seen = body.seen;
    rssBytes = process.memoryUsage.rss();
    const closing = await maybeProbed(job, "close", notes, () =>
      step("close", () => (pod as NonNullable<typeof pod>).close()),
    );
    closeSeen = closing.seen;
  } else if (job.scenario === "reopen") {
    const body = await maybeProbed(
      job,
      "reopen-first-answer",
      notes,
      async () => {
        const opened = await step("open", () =>
          openedAt(job.folder, job.encrypted),
        );
        await step("first-read", () => opened.ask(FIRST_READ));
        await step("second-read", () => opened.ask(SECOND_READ));
        rssBytes = process.memoryUsage.rss();
        await step("close", () => opened.close());
      },
    );
    seen = body.seen;
  } else {
    const opened = await openedAt(job.folder, job.encrypted);
    await opened.ask(FIRST_READ);
    rssBytes = process.memoryUsage.rss();
    const body = await maybeProbed(job, "question-page", notes, async () => {
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
    ...(notes.length > 0 && { traces: notes }),
  };
}

// ------------------------------------------------------------------ the parent

/** A CPU profile node wrote for one run, and those of the worker threads the run started. */
export interface CpuNote {
  readonly file: string;
  readonly bytes: number;
  readonly workers: readonly { file: string; bytes: number; role: string }[];
}

/** The most often the processor is sampled while a CPU profile is taken, in microseconds: node's own is 1000. */
const CPU_INTERVAL = 500;

/**
 * Gives the profiles `--cpu-prof` wrote in `from` the names a reader opens them by: the main thread's is `<name>.cpuprofile`
 * and each worker's `<name>.<role>.cpuprofile`, the role being the worker's script (`pod-database-worker`).
 */
export async function keptCpu(
  from: string,
  into: string,
  name: string,
): Promise<CpuNote> {
  await mkdir(into, { recursive: true });
  const found = (await readdir(from)).filter((each) =>
    each.endsWith(".cpuprofile"),
  );
  // CPU.<date>.<time>.<pid>.<thread>.<n>.cpuprofile: the main thread is thread 0.
  const thread = (each: string) => Number(each.split(".").at(-3));
  const main = found.find((each) => thread(each) === 0);
  if (main === undefined)
    throw new Error(`node wrote no CPU profile of the main thread in ${from}`);
  const file = `${name}.cpuprofile`;
  await copyFile(join(from, main), join(into, file));
  const workers: { file: string; bytes: number; role: string }[] = [];
  const roles = new Map<string, number>();
  const threads = found
    .filter((other) => thread(other) !== 0)
    .sort((a, b) => thread(a) - thread(b));
  for (const each of threads) {
    const text = await readFile(join(from, each), "utf8");
    const role = /\/([a-z0-9-]+-worker)\.js/.exec(text)?.[1] ?? "worker";
    const seen = (roles.get(role) ?? 0) + 1;
    roles.set(role, seen);
    const named = `${name}.${role}${seen > 1 ? `-${seen}` : ""}.cpuprofile`;
    await writeFile(join(into, named), text);
    workers.push({ file: named, bytes: Buffer.byteLength(text), role });
  }
  return { file, bytes: (await stat(join(into, file))).size, workers };
}

async function child(
  job: Omit<Job, "out">,
  dir: string,
  /** Where to keep the CPU profile of this process, under which name, when one is wanted. */
  cpu?: { into: string; name: string; notes: Map<string, CpuNote> },
): Promise<Measured> {
  const out = join(dir, `result-${Math.random().toString(36).slice(2)}.json`);
  const profiled =
    cpu === undefined ? undefined : await mkdtemp(join(dir, "cpuprof-"));
  await run(
    process.execPath,
    [
      ...process.execArgv,
      ...(profiled === undefined
        ? []
        : [
            "--cpu-prof",
            `--cpu-prof-dir=${profiled}`,
            `--cpu-prof-interval=${CPU_INTERVAL}`,
          ]),
      fileURLToPath(import.meta.url),
      CHILD,
      JSON.stringify({ ...job, out }),
    ],
    { maxBuffer: 1 << 26, timeout: 3 * 3_600_000 },
  );
  if (cpu !== undefined && profiled !== undefined) {
    cpu.notes.set(cpu.name, await keptCpu(profiled, cpu.into, cpu.name));
    await rm(profiled, { recursive: true, force: true });
  }
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
  // Microseconds: a question answered from the database takes under a millisecond, which three places would round to 0.
  const places = unit === "s" ? 6 : 0;
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

export const countRow = (name: string, value: number, extra?: string): Row => ({
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
  /** Each span's name as its stage row has it, which its own-time row repeats. */
  const named = new Map<string, string>();
  for (const { name, calls, ms, wallMs } of seen.spans.slice(0, limit)) {
    named.set(name, unique(taken, part(name)));
    rows.push({
      name: `${prefix}/stage/${named.get(name)}`,
      unit: "s",
      value: fixed(wallMs / 1000, 6),
      kind: "clock",
      samples: 1,
      range: `${(wallMs / 1000).toFixed(6)}-${(wallMs / 1000).toFixed(6)}`,
      extra: `probed run; the time some call of it was in progress, inclusive of the spans inside it; ${calls} calls whose own times sum to ${(ms / 1000).toFixed(6)} s (more than the time in progress where calls overlap); ${name.slice(0, 140)}`,
    });
  }
  for (const { name, calls, selfWallMs } of [...seen.spans]
    .filter(({ selfWallMs: own }) => own !== undefined)
    .sort((a, b) => (b.selfWallMs ?? 0) - (a.selfWallMs ?? 0))
    .slice(0, limit)) {
    const self = (selfWallMs ?? 0) / 1000;
    rows.push({
      name: `${prefix}/self/${named.get(name) ?? unique(taken, part(name))}`,
      unit: "s",
      value: fixed(self, 6),
      kind: "clock",
      samples: 1,
      range: `${self.toFixed(6)}-${self.toFixed(6)}`,
      extra: `probed run; the time some call of it was in progress with none of the spans inside it in progress; ${calls} calls; ${name.slice(0, 140)}`,
    });
  }
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

export interface Plan {
  readonly scenarios: ReadonlySet<Scenario>;
  readonly sizes: readonly DatasetId[];
  readonly encryption: "plain" | "encrypted" | "both" | "auto";
  readonly repeats: number;
  readonly probe: boolean;
  /** The folder the traces, the CPU profiles and `flame.json` go to; none are made without it. */
  readonly profiles?: string;
  /** Whether each scenario also gets a CPU profile, when there is a folder: one more run of it, unprobed. */
  readonly cpuProfile?: boolean;
}

/** What the runs left in the profiles folder: the traces written by probed runs and the CPU profiles kept, by scenario name. */
interface Flame {
  readonly traces: TraceNote[];
  readonly cpu: Map<string, CpuNote>;
}

/** One build of a scenario at a size, as `flame.json` lists it. */
export interface FlameBuild {
  /** `<scenario>-<size>[-encrypted]`, as the rows name it. */
  readonly name: string;
  readonly scenario: Scenario;
  readonly dataset: DatasetId;
  readonly encrypted: boolean;
  readonly trace: Omit<TraceNote, "scenario" | "dataset" | "encrypted">;
  readonly cpu?: CpuNote & {
    /** The scenario whose process this profile is, when it is not this one's: a close is the last step of a fresh run. */
    readonly processOf?: Scenario;
  };
}

/** The builds of a run, each scenario's trace with the CPU profile that goes with it. */
export function flameBuilds(flame: Flame): FlameBuild[] {
  return flame.traces.map(({ scenario, dataset, encrypted, ...trace }) => {
    const name = nameOf(scenario, dataset, encrypted);
    const own = flame.cpu.get(name);
    const fresh = flame.cpu.get(
      nameOf("fresh-first-screen", dataset, encrypted),
    );
    const cpu =
      own ??
      (scenario === "close" && fresh !== undefined
        ? { ...fresh, processOf: "fresh-first-screen" as const }
        : undefined);
    return {
      name,
      scenario,
      dataset,
      encrypted,
      trace,
      ...(cpu !== undefined && { cpu }),
    };
  });
}

/** Every scenario wanted at one size, encrypted or not: runs them and gives their rows. */
async function scenariosAt(
  plan: Plan,
  dataset: DatasetId,
  encrypted: boolean,
  work: string,
  log: (line: string) => void,
  flame: Flame,
): Promise<Row[]> {
  const data = await loadDataset(dataset);
  const claim = await profileOfPatient(data);
  const about = `dataset=${dataset} sha256=${data.sha256} records=${data.records}${encrypted ? " encrypted" : ""}`;
  const wants = (scenario: Scenario) => plan.scenarios.has(scenario);
  const rows: Row[] = wants("fresh-first-screen")
    ? [
        countRow(
          `${nameOf("fresh-first-screen", dataset, encrypted)}/count/records`,
          data.records,
          about,
        ),
      ]
    : [];
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
      await rm(dirname(kept), { recursive: true, force: true });
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
        `after the first screen, before close; the harness's own copy of the input is dropped before the pod opens; ${how}`,
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
      {
        ...unprobed("fresh-probed", "fresh"),
        probed: true,
        ...(plan.profiles !== undefined && { profiles: plan.profiles }),
      },
      work,
    );
    flame.traces.push(...(probed.traces ?? []));
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

  // The CPU profile: one more fresh run, unprobed, so that it is the code as it runs. The close is its last step.
  if (
    plan.profiles !== undefined &&
    plan.cpuProfile &&
    (wants("fresh-first-screen") || wants("close"))
  ) {
    log(`${dataset}${encrypted ? " encrypted" : ""}: fresh run, CPU profile`);
    await child(unprobed("fresh-cpu", "fresh"), work, {
      into: plan.profiles,
      name: nameOf(
        wants("fresh-first-screen") ? "fresh-first-screen" : "close",
        dataset,
        encrypted,
      ),
      notes: flame.cpu,
    });
    await rm(dirname(place("fresh-cpu")), { recursive: true, force: true });
  }

  // reopen and question-page, on the last pod a fresh run left.
  for (const [scenario, kind] of [
    ["reopen-first-answer", "reopen"],
    ["question-page", "question-page"],
  ] as const) {
    if (!wants(scenario) || kept === undefined) continue;
    const name = nameOf(scenario, dataset, encrypted);
    // Each run opens a copy of the pod the fresh run left, so that each is the first open after an import, as the
    // headline says, and none finds what an earlier run left in the folder.
    const keptFolder = dirname(kept);
    let copies = 0;
    const onACopy = async (
      probed: boolean,
      profiled = false,
    ): Promise<Measured> => {
      const label = `${kind}-${copies++}`;
      await cp(keptFolder, join(work, label), { recursive: true });
      try {
        return await child(
          {
            ...unprobed(label, kind),
            probed,
            ...(probed &&
              plan.profiles !== undefined && { profiles: plan.profiles }),
          },
          work,
          profiled && plan.profiles !== undefined
            ? { into: plan.profiles, name, notes: flame.cpu }
            : undefined,
        );
      } finally {
        await rm(join(work, label), { recursive: true, force: true });
      }
    };
    const runs: Measured[] = [];
    for (let at = 0; at < plan.repeats; at++) {
      log(
        `${dataset}${encrypted ? " encrypted" : ""}: ${scenario} ${at + 1}/${plan.repeats}`,
      );
      runs.push(await onACopy(false));
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
      const probed = await onACopy(true);
      flame.traces.push(...(probed.traces ?? []));
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
    if (plan.profiles !== undefined && plan.cpuProfile) {
      log(
        `${dataset}${encrypted ? " encrypted" : ""}: ${scenario}, CPU profile`,
      );
      await onACopy(false, true);
    }
  }
  if (kept !== undefined)
    await rm(dirname(kept), { recursive: true, force: true });
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

/** A resolved component's commit, `-dirty` when its folder holds changes the commit does not; undefined for a folder that is no checkout. */
function commitOf(resolvedAt: {
  commit?: string;
  uncommitted?: number;
}): string | undefined {
  const { commit, uncommitted = 0 } = resolvedAt;
  if (commit === undefined || !/^[0-9a-f]{40}$/.test(commit)) return undefined;
  return uncommitted > 0 ? `${commit}-dirty` : commit;
}

/** The runtime checkout's folder, the one holding cascade-runtime.json. */
export const RUNTIME_ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));

/** The starter kit's folder name: its checkout is beside the runtime's. */
export const KIT = "cascade-starter-kit";

/**
 * The commit of the runtime and of each component the run read (the vocabulary, the fhir-r4 adapter that owns the
 * record and its mapping, the Bridge, the reference tables), and of the kit when a checkout of it is beside.
 */
export async function commits(): Promise<Record<string, string>> {
  const root = RUNTIME_ROOT;
  const found: Record<string, string | undefined> = { runtime: headOf(root) };
  const parts = await resolved();
  found.vocabulary = commitOf(parts.local.resolved);
  const components = await componentsOf(
    fileURLToPath(new URL("../../", import.meta.url)),
  );
  /** What cannot be found is left out of a file written where it cannot be. */
  const each = async (
    name: string,
    work: () => Promise<string | undefined>,
  ): Promise<void> => {
    try {
      found[name] = await work();
    } catch {
      // left out
    }
  };
  await each("bridge", async () => {
    const { commit } = await components.bridge();
    return /^[0-9a-f]{40}$/.test(commit) ? commit : undefined;
  });
  await each("adapter-fhir-r4", async () => {
    const adapter = components.config.adapters.find(({ repository }) =>
      repository.endsWith("cascade-bridge-adapter-fhir-r4"),
    );
    return adapter === undefined
      ? undefined
      : commitOf(await components.resolve(adapter));
  });
  await each("reference-tables", async () =>
    commitOf(await components.resolve(components.config.tables.repository)),
  );
  const kit = join(dirname(root), KIT);
  if (existsSync(kit)) found.kit = headOf(kit);
  return Object.fromEntries(
    Object.entries(found).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

/** The file's environment. The runner is named by its kind, never by the job's own name, which differs on every run. */
export function envOf(plan: Plan): PerfFile["env"] {
  const model = cpus()[0]?.model.replace(/\s+/g, " ").trim() ?? "unknown cpu";
  const runner =
    process.env.GITHUB_ACTIONS === "true"
      ? `github-actions ${process.env.RUNNER_OS ?? ""}`.trim()
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
      ...(value("--profiles") !== undefined && {
        profiles: value("--profiles") as string,
      }),
      cpuProfile: !args.includes("--no-cpu-profile"),
    },
    out: value("--out"),
  };
}

/** Each row with its glossary sentence first in `extra`, so a reader of the file or the history page hovers to a plain meaning. */
export function explained(rows: readonly Row[]): {
  rows: Row[];
  missing: string[];
} {
  const missing: string[] = [];
  const out = rows.map((row) => {
    const says = explain(row.name);
    if (says === undefined) {
      missing.push(row.name);
      return row;
    }
    return {
      ...row,
      extra: row.extra === undefined ? says : `${says} | ${row.extra}`,
    };
  });
  return { rows: out, missing };
}

/** The file for a plan: every scenario at every size, plain, and encrypted at the large size. */
export async function perfFile(
  plan: Plan,
  log: (line: string) => void = () => undefined,
  /** Called with the file as far as it is, after each size, so a run that fails late loses nothing before it. */
  partial: (file: PerfFile) => Promise<void> = () => Promise.resolve(),
): Promise<PerfFile> {
  const work = await mkdtemp(join(tmpdir(), "perf-report-"));
  const flame: Flame = { traces: [], cpu: new Map() };
  const flamed = async (): Promise<void> => {
    if (plan.profiles === undefined) return;
    await mkdir(plan.profiles, { recursive: true });
    await writeFile(
      join(plan.profiles, "flame.json"),
      `${JSON.stringify({ builds: flameBuilds(flame) }, null, 2)}
`,
    );
  };
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
      for (const encrypted of modes) {
        results.push(
          ...(await scenariosAt(plan, size, encrypted, work, log, flame)),
        );
        await flamed();
        await partial({
          env: envOf(plan),
          commit: await commits(),
          results: explained(results).rows,
        });
      }
    }
    const bad = results.map(refused).find((reason) => reason !== undefined);
    if (bad !== undefined)
      throw new Error(`a row the result schema refuses: ${bad}`);
    const { rows, missing } = explained(results);
    if (missing.length > 0)
      log(
        `the glossary (perf-glossary.json) has no sentence for ${missing.length} rows, first ${missing.slice(0, 5).join(", ")}`,
      );
    return { env: envOf(plan), commit: await commits(), results: rows };
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
  const started = performance.now();
  const file = await perfFile(
    plan,
    (line) =>
      process.stderr.write(
        `[${((performance.now() - started) / 1000).toFixed(0)}s] ${line}\n`,
      ),
    async (so) => {
      if (out !== undefined)
        await writeFile(out, `${JSON.stringify(so, null, 2)}\n`);
    },
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
