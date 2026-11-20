import { createHash } from "node:crypto";

/** The instant the first job of a scenario believes it is, so what an import writes with the time of the import is the same on every run. */
export const PINNED = "2026-11-01T09:30:00.000Z";

/** How much later each following job of a scenario believes it is: a later job's times are later, and never tie with an earlier one's. */
const STEP_MS = 60_000;

/** The instant the `n`-th job of a scenario (0 for the first) believes it is. */
export const pinnedAt = (n: number): number => Date.parse(PINNED) + n * STEP_MS;

/** The n-th id of a pinned process: random-looking, as a version 4 UUID is, and the same on every run of the same job. */
function nthId(seed: string, n: number): string {
  const bytes = createHash("sha256")
    .update(`perf-pinned-id ${seed} ${n}`)
    .digest();
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Who a pinned process is: what makes its ids and its instant its own, so a later job in an existing pod never repeats an earlier one's. */
export interface Pin {
  /** The job's name, its scenario and its dataset: the ids of two jobs that differ in any of them differ. */
  readonly seed?: string;
  /** Which job of its scenario this is, from 0: the clock is `n` minutes after `PINNED`. */
  readonly n?: number;
}

/** The pin of a job: its label, scenario, dataset and encryption seed the ids, its place in its scenario sets the time. */
export const pinOf = (job: {
  label?: string;
  scenario: string;
  dataset: string;
  encrypted: boolean;
  n?: number;
}): Pin => ({
  seed: `${job.label ?? ""} ${job.scenario} ${job.dataset} ${job.encrypted}`,
  n: job.n ?? 0,
});

/**
 * Makes the process's wall clock and its random ids repeat, for a process that measures: `Date.now()`, `new Date()` and
 * `Date()` give one instant however long the run takes (frozen by design, not a clock that runs slow), and
 * `crypto.randomUUID()` gives the same version 4 UUIDs on every run of the same job, in the order it is asked (a fixed
 * sequence that is as unordered as random ones are, so keys inserted by id are not inserted in order, which random
 * ones are not either). What an import writes with the time or a new id (the act, the import, the matcher's runs) is
 * then the same on two runs of one input, which is what lets a fingerprint of it stand for the result.
 *
 * The instant and the ids belong to the job (`pin`): a job that imports into a pod an earlier job wrote, from a child
 * process of its own, has ids no earlier job drew and a time after theirs, so "the latest by time" is never a tie.
 * The first job of a scenario (`n` 0, no seed) is at `PINNED`.
 *
 * `performance.now()` is not touched: it is what the durations are read from, and nothing that is written into a pod is
 * read from it. A date given (`new Date(0)`, `Date.parse`, `Date.UTC`) is as it was. Only this thread's
 * `globalThis.crypto.randomUUID` is pinned: a worker thread has its own clock and ids, and so does `node:crypto`'s own
 * `randomUUID` (read by the row cache and the MCP server, which no measured job uses). A frozen `Date.now` also means a
 * hold that expires by it (the 30 s claim on a sealed index, for a stale 1.2 to 1.3 upgrade) never expires inside a
 * pinned process, which no job of the harness has.
 *
 * Returns a function that puts the real ones back.
 */
export function pinClock(pin: Pin = {}): () => void {
  const RealDate = globalThis.Date;
  const at = pinnedAt(pin.n ?? 0);
  const seed = pin.seed ?? "";
  const realUuid = Object.getOwnPropertyDescriptor(
    globalThis.crypto,
    "randomUUID",
  );
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) =>
      Reflect.construct(target, args.length === 0 ? [at] : args, newTarget),
    apply: () => new RealDate(at).toString(),
    get: (target, property, receiver) =>
      property === "now" ? () => at : Reflect.get(target, property, receiver),
  });
  let drawn = 0;
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    writable: true,
    value: () => nthId(seed, ++drawn),
  });
  return () => {
    globalThis.Date = RealDate;
    if (realUuid === undefined)
      delete (globalThis.crypto as object as Record<string, unknown>)
        .randomUUID;
    else Object.defineProperty(globalThis.crypto, "randomUUID", realUuid);
  };
}
