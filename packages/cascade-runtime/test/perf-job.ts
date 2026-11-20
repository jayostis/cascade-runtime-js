import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tablesBeside } from "cascade-runtime";
import { probing, type Seen, timed } from "@cascade-runtime/runtime/probe";
import { type Loaded } from "./perf-floor.js";
import { explainSpan } from "./perf-glossary.js";
import { type DatasetId } from "./perf-data.js";
import { type Scenario } from "./perf-plan.js";
import { type Stored } from "./perf-scenarios/stored.js";
import { fixed, part, type Tabulated, tabulated } from "./perf-rows.js";
import { chromeTrace } from "./perf-trace.js";
import { openFolderPod } from "../src/node/folder-pod.js";
import {
  answersBeside,
  databaseBeside,
  resolved,
} from "../src/node/resolved.js";

export const SECRET = "t-shirt abacus yo-yo zoom drop-down felt-tip";

/** What one child process is asked to measure. */
export interface Job {
  readonly scenario: "fresh" | "reopen" | "question-page" | "floor" | "stored";
  readonly dataset: DatasetId;
  readonly encrypted: boolean;
  readonly probed: boolean;
  /** Where a probed run writes the trace of each scenario it ran. */
  readonly profiles?: string;
  readonly folder: string;
  readonly claim: readonly string[];
  readonly out: string;
  /** What the job is called, which seeds its ids (see `pinClock`); a later job that imports into an earlier one's pod needs one of its own. */
  readonly label?: string;
  /** Which job of its scenario this is, from 0, which sets its clock (see `pinClock`). */
  readonly n?: number;
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
  /** What the floor loaded and how long each stage took, for the floor scenario. */
  readonly floor?: Loaded;
  /** What the pod holds, counted, for the stored scenario. */
  readonly stored?: Stored;
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

/** A CPU profile node wrote for one run, and those of the worker threads the run started. */
export interface CpuNote {
  readonly file: string;
  readonly bytes: number;
  readonly workers: readonly { file: string; bytes: number; role: string }[];
}

/** What the runs left in the profiles folder: the traces written by probed runs and the CPU profiles kept, by scenario name. */
export interface Flame {
  readonly traces: TraceNote[];
  readonly cpu: Map<string, CpuNote>;
}

/** The most own time a trace's top list names. */
const TOP = 10;

/** What the name of a span of one of the Bridge's queries begins with, as `bridgeSpans` records it. */
const BRIDGE_QUERY = "bridge.query:";

/** The pod in the folder as a packed runtime opens it: its answers, its build and its database kept beside it, its tables beside the folder. */
export async function openedAt(folder: string, encrypted: boolean) {
  const parts = {
    ...(await resolved()),
    answers: { runtime: "perf", at: answersBeside },
    databaseBeside,
    tables: await tablesBeside(dirname(folder)),
  };
  return openFolderPod(parts, folder, encrypted ? { secret: SECRET } : {});
}

/** A scenario at a size, the first part of the names of its rows and files. */
export const nameOf = (
  scenario: Scenario,
  dataset: DatasetId,
  encrypted: boolean,
) => `${scenario}-${dataset}${encrypted ? "-encrypted" : ""}`;

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
export async function maybeProbed<T>(
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

/** Seconds by step, and the function that runs a step as the named span, timing it with a plain clock either way. */
export function stepper() {
  const seconds: Record<string, number> = {};
  const step = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await timed(`scenario.${name}`, work);
    } finally {
      seconds[name] = (performance.now() - started) / 1000;
    }
  };
  return { seconds, step };
}

/** What a child process hands back. */
export function measured(parts: {
  seconds: Record<string, number>;
  parts: Record<string, number>;
  rssBytes: number;
  wrote: number;
  seen: Tabulated | undefined;
  closeSeen?: Tabulated | undefined;
  notes: TraceNote[];
}): Measured {
  return {
    seconds: parts.seconds,
    parts: parts.parts,
    rssBytes: parts.rssBytes,
    // The most the resident set reached in this process, which the operating system keeps exactly (KiB).
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    ...(parts.wrote > 0 && { wrote: parts.wrote }),
    ...(parts.seen && { seen: parts.seen }),
    ...(parts.closeSeen && { closeSeen: parts.closeSeen }),
    ...(parts.notes.length > 0 && { traces: parts.notes }),
  };
}

/** The sum of the named steps' seconds in one run, none counting as 0. */
export const secs = (each: Measured, ...names: string[]) =>
  names.reduce((sum, name) => sum + (each.seconds[name] ?? 0), 0);

/** The samples of a measurement across runs, a run without it leaving none. */
export const samplesOf = (
  runs: readonly Measured[],
  pick: (each: Measured) => number | undefined,
) => runs.flatMap((each) => pick(each) ?? []);
