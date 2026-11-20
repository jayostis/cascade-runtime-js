import { createHash } from "node:crypto";

/** The instant a measured process believes it is, so what an import writes with the time of the import is the same on every run. */
export const PINNED = "2026-11-01T09:30:00.000Z";

/** The n-th id of a pinned process: random-looking, as a version 4 UUID is, and the same on every run. */
function nthId(n: number): string {
  const bytes = createHash("sha256").update(`perf-pinned-id ${n}`).digest();
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Makes the process's wall clock and its random ids repeat, for a process that measures: `Date.now()`, `new Date()` and
 * `Date()` give `PINNED` however long the run takes, and `crypto.randomUUID()` gives the same version 4 UUIDs on every
 * run, in the order it is asked (a fixed sequence that is as unordered as random ones are, so keys inserted by id are
 * not inserted in order, which random ones are not either). What an import writes with the time or a new id (the act,
 * the import, the matcher's runs) is then the same on two runs of one input, which is what lets a fingerprint of it
 * stand for the result. `performance.now()` is not touched: it is what the durations are read from, and nothing that
 * is written into a pod is read from it. A date given (`new Date(0)`, `Date.parse`, `Date.UTC`) is as it was. Only
 * this thread is pinned: a worker thread has its own clock.
 *
 * Returns a function that puts the real ones back.
 */
export function pinClock(): () => void {
  const RealDate = globalThis.Date;
  const at = RealDate.parse(PINNED);
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
    value: () => nthId(++drawn),
  });
  return () => {
    globalThis.Date = RealDate;
    if (realUuid === undefined)
      delete (globalThis.crypto as object as Record<string, unknown>)
        .randomUUID;
    else Object.defineProperty(globalThis.crypto, "randomUUID", realUuid);
  };
}
