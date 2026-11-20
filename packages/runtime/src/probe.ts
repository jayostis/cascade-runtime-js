/**
 * What a span name took: `calls`, `ms` the sum of every call's own time (calls that overlap each count in full, so it can
 * pass the time that went by), and `wallMs` the time at least one call of the name was in progress, which cannot.
 */
export interface Spent {
  calls: number;
  ms: number;
  wallMs: number;
}

/** What a probe has seen: time and calls by span, and counts by name. */
export interface Seen {
  readonly spans: ReadonlyMap<string, Spent>;
  readonly counts: ReadonlyMap<string, number>;
}

/**
 * Counts and times the work of an import for a bench to report. Nothing is measured unless a run is made through
 * `probing`: every site is one check of `active`, so the runtime pays nothing when it is off.
 *
 * Calls of one name may overlap (the import seals every file at once), so each name has two times: the sum of its calls'
 * own times and the wall-clock time some call of it was in progress (`Spent`).
 */
class Probe implements Seen {
  readonly spans = new Map<string, Spent>();
  readonly counts = new Map<string, number>();
  /** The spans open now, innermost last, which a count is credited to as well. */
  readonly open: string[] = [];
  /** The calls of each name in progress now, and when the first of them began: what `wallMs` is made of. */
  readonly #inFlight = new Map<string, { depth: number; since: number }>();

  /** A call of the name begins now; returns the time, for `end`. */
  begin(name: string): number {
    const now = performance.now();
    const flight = this.#inFlight.get(name);
    if (flight === undefined)
      this.#inFlight.set(name, { depth: 1, since: now });
    else flight.depth += 1;
    return now;
  }

  add(name: string, by: number): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + by);
  }

  /** A count of the name, and the same as `<innermost span open>.<name>`, if one is open. */
  addInside(name: string, by: number): void {
    this.add(name, by);
    const inner = this.open.at(-1);
    if (inner !== undefined) this.add(`${inner}.${name}`, by);
  }

  /** The call of the name that began at `started` ends now. */
  end(name: string, started: number): void {
    const now = performance.now();
    const span = this.span(name);
    span.calls += 1;
    span.ms += now - started;
    const flight = this.#inFlight.get(name);
    if (flight === undefined) {
      span.wallMs += now - started;
      return;
    }
    flight.depth -= 1;
    if (flight.depth === 0) {
      span.wallMs += now - flight.since;
      this.#inFlight.delete(name);
    }
  }

  span(name: string): Spent {
    let span = this.spans.get(name);
    if (span === undefined) {
      span = { calls: 0, ms: 0, wallMs: 0 };
      this.spans.set(name, span);
    }
    return span;
  }
}

let active: Probe | undefined;

/**
 * Runs the function with every count and span of the runtime recorded, and gives what was seen with its result. A
 * span's time includes the spans inside it. A graph scan and a store query are also credited to the innermost span
 * open, as `<span>.graph.scans` and `<span>.store.queries`, which is exact only where spans do not interleave: the
 * innermost open span is the last one begun, so work that runs at the same time as another (the files of an import
 * sealed at once, the first screen's questions asked together) credits a count to whichever span began last. Its
 * `ms` adds the time of every call, overlapping ones in full; its `wallMs` is the time some call of the name was open.
 */
export async function probing<T>(
  run: () => Promise<T>,
): Promise<{ result: T; seen: Seen }> {
  if (active !== undefined)
    throw new Error("an import is already being probed");
  const probe = new Probe();
  active = probe;
  try {
    return { result: await run(), seen: probe };
  } finally {
    active = undefined;
  }
}

/** Whether a run is being probed, for work that is run one at a time then so that each span is its own. */
export function probed(): boolean {
  return active !== undefined;
}

/** Counts `by` of the name while probing. */
export function counted(name: string, by = 1): void {
  active?.add(name, by);
}

/** A count under the name of the query's first 70 characters past its prefixes, to tell the callers of one method apart. */
export function countedQuery(name: string, query: string): void {
  if (active === undefined) return;
  const head = query
    .replace(/PREFIX\s+\S*\s*<[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
  active.add(`${name}.query: ${head}`, 1);
}

/** One pass over `quads` of a graph held in memory, from a scan of all of it or a read of the part it is asked for. */
export function scanned(quads: number): void {
  if (active === undefined) return;
  active.addInside("graph.scans", 1);
  active.addInside("graph.quadsVisited", quads);
}

/** Runs the function as the named span while probing, as it would otherwise. */
export function timed<T>(name: string, run: () => Promise<T>): Promise<T> {
  if (active === undefined) return run();
  const probe = active;
  const started = probe.begin(name);
  probe.open.push(name);
  return (async () => {
    try {
      return await run();
    } finally {
      probe.open.splice(probe.open.lastIndexOf(name), 1);
      probe.end(name, started);
    }
  })();
}

/**
 * Runs the function as the named span while probing, but not as an open one: a count made inside is credited to the
 * innermost span `timed` opened, as it would be without this one. For the time of a step whose counts are another's.
 * A name given as a function is made only when probing, so a run that is not probed builds no string for it.
 */
export function timedAside<T>(
  name: string | (() => string),
  run: () => Promise<T>,
): Promise<T> {
  if (active === undefined) return run();
  const probe = active;
  const named = typeof name === "string" ? name : name();
  const started = probe.begin(named);
  return (async () => {
    try {
      return await run();
    } finally {
      probe.end(named, started);
    }
  })();
}

/**
 * A store query, counted and timed as the span `store.query`, and credited to the innermost span open as a count, but
 * not an open span itself, so the counts of what it runs inside are not taken from it.
 */
export function queried<T>(run: () => T): T {
  if (active === undefined) return run();
  const probe = active;
  probe.addInside("store.queries", 1);
  const started = probe.begin("store.query");
  try {
    return run();
  } finally {
    probe.end("store.query", started);
  }
}

/**
 * Records a span measured elsewhere (by another thread, or by the Bridge's own clock) as `calls` calls taking `ms`
 * in all, while probing, which is also its wall time: what was measured elsewhere is not overlapped with itself here.
 * Nothing when it is off.
 */
export function recorded(name: string, ms: number, calls = 1): void {
  if (active === undefined) return;
  const span = active.span(name);
  span.calls += calls;
  span.ms += ms;
  span.wallMs += ms;
}

/** `timed` for a function that is not async. */
export function timedSync<T>(name: string, run: () => T): T {
  if (active === undefined) return run();
  const probe = active;
  const started = probe.begin(name);
  probe.open.push(name);
  try {
    return run();
  } finally {
    probe.open.pop();
    probe.end(name, started);
  }
}
