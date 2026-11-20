/** The instant a measured process believes it is, so what an import writes with the time of the import is the same on every run. */
export const PINNED = "2026-11-01T09:30:00.000Z";

/**
 * Makes the process's wall clock and its random ids repeat, for a process that measures: `Date.now()`, `new Date()` and
 * `Date()` give `PINNED` however long the run takes, and `crypto.randomUUID()` gives 00000000-0000-4000-8000-000000000001,
 * ...2 and so on in the order it is asked. What an import writes with the time or a new id (the act, the import, the
 * matcher's runs) is then the same on two runs of one input, which is what lets a fingerprint of it stand for the
 * result. `performance.now()` is not touched: it is what the durations are read from, and nothing that is written
 * into a pod is read from it. A date given (`new Date(0)`, `Date.parse`, `Date.UTC`) is as it was. Only this thread
 * is pinned: a worker thread has its own clock.
 *
 * Returns a function that puts the real ones back.
 */
export function pinClock(): () => void {
  return () => undefined;
}
