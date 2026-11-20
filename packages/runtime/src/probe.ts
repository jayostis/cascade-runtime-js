/**
 * What a span name took: `calls`, `ms` the sum of every call's own time (calls that overlap each count in full, so it can
 * pass the time that went by), and `wallMs` the time at least one call of the name was in progress, which cannot.
 */
export interface Spent {
  calls: number;
  ms: number;
  wallMs: number;
}

/**
 * One call of a span, for a trace of a run: when it began and ended (milliseconds on this thread's `performance.now()`)
 * and the span open around it, whose index in `Seen.events` is `parent` (-1 for none). A call measured elsewhere has the
 * `track` it is drawn on.
 */
export interface SpanEvent {
  readonly name: string;
  readonly start: number;
  end: number;
  readonly parent: number;
  readonly track?: string;
  readonly calls?: number;
}

/** What a probe has seen: time and calls by span, and counts by name; and, when the run was traced, every call of every span. */
export interface Seen {
  readonly spans: ReadonlyMap<string, Spent>;
  readonly counts: ReadonlyMap<string, number>;
  readonly events?: readonly SpanEvent[];
}

/** A call of a span in progress: when it began, and, in a traced run, the index of the event that stands for it. */
interface Call {
  readonly name: string;
  readonly at: number;
  readonly event?: number;
}

/** Where a span measured elsewhere sat: the track it is drawn on and when it began (milliseconds on this thread's `performance.now()`). */
export interface Placed {
  readonly track: string;
  readonly start: number;
}

/** The index of the call a function runs inside of, carried through its awaits: a span's parent is the span it was called inside of, not the last one begun. */
interface Context {
  run<R>(store: number, run: () => R): R;
  getStore(): number | undefined;
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
  /** Every call, in the order begun, when the run is traced. */
  readonly events: SpanEvent[] | undefined;
  readonly #context: Context | undefined;
  /** The spans open now, innermost last, which a count is credited to as well. */
  readonly open: string[] = [];
  /** The calls of each name in progress now, and when the first of them began: what `wallMs` is made of. */
  readonly #inFlight = new Map<string, { depth: number; since: number }>();

  constructor(traced: boolean) {
    if (!traced) return;
    const hooks = (
      globalThis as {
        process?: {
          getBuiltinModule?: (name: string) => {
            AsyncLocalStorage?: new () => Context;
          };
        };
      }
    ).process?.getBuiltinModule?.("node:async_hooks");
    if (hooks?.AsyncLocalStorage === undefined)
      throw new Error("a traced run needs node:async_hooks");
    this.#context = new hooks.AsyncLocalStorage();
    this.events = [];
  }

  /** A call of the name begins now; returns it, for `end`. */
  begin(name: string): Call {
    const at = performance.now();
    const flight = this.#inFlight.get(name);
    if (flight === undefined) this.#inFlight.set(name, { depth: 1, since: at });
    else flight.depth += 1;
    if (this.events === undefined) return { name, at };
    this.events.push({
      name,
      start: at,
      end: Number.NaN,
      parent: this.#context?.getStore() ?? -1,
    });
    return { name, at, event: this.events.length - 1 };
  }

  /** Runs the function with the call as the span open around what it starts, in a traced run. */
  within<R>(call: Call, run: () => R): R {
    return call.event === undefined || this.#context === undefined
      ? run()
      : this.#context.run(call.event, run);
  }

  /** Ends, now, the calls still open when the run ends. */
  closed(): void {
    const now = performance.now();
    for (const event of this.events ?? [])
      if (Number.isNaN(event.end)) event.end = now;
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

  /** The call ends now. */
  end({ name, at: started, event }: Call): void {
    const now = performance.now();
    if (event !== undefined && this.events !== undefined)
      (this.events[event] as SpanEvent).end = now;
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

  /** A span measured elsewhere, as an event. */
  place(name: string, ms: number, calls: number, where?: Placed): void {
    if (this.events === undefined) return;
    const end = where === undefined ? performance.now() : where.start + ms;
    this.events.push({
      name,
      start: end - ms,
      end,
      parent: this.#context?.getStore() ?? -1,
      track: where?.track ?? "measured elsewhere",
      calls,
    });
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
 *
 * With `trace`, it also gives every call as an event (`Seen.events`) with the span it ran inside of, which follows a call
 * through its awaits, so concurrent work keeps its own parents. A run that is not traced keeps no event.
 */
export async function probing<T>(
  run: () => Promise<T>,
  options: { readonly trace?: boolean } = {},
): Promise<{ result: T; seen: Seen }> {
  if (active !== undefined)
    throw new Error("an import is already being probed");
  const probe = new Probe(options.trace === true);
  active = probe;
  try {
    return { result: await run(), seen: probe };
  } finally {
    active = undefined;
    probe.closed();
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
  const call = probe.begin(name);
  probe.open.push(name);
  return (async () => {
    try {
      return await probe.within(call, run);
    } finally {
      probe.open.splice(probe.open.lastIndexOf(name), 1);
      probe.end(call);
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
  const call = probe.begin(named);
  return (async () => {
    try {
      return await probe.within(call, run);
    } finally {
      probe.end(call);
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
  const call = probe.begin("store.query");
  try {
    return run();
  } finally {
    probe.end(call);
  }
}

/**
 * Records a span measured elsewhere (by another thread, or by the Bridge's own clock) as `calls` calls taking `ms`
 * in all, while probing, which is also its wall time: what was measured elsewhere is not overlapped with itself here.
 * A traced run draws it as one event on the track it is `placed` on, a child of the span it is recorded inside of, ending
 * where it began plus `ms`; one not placed is drawn on the track `measured elsewhere`, ending now. Nothing when it is off.
 */
export function recorded(
  name: string,
  ms: number,
  calls = 1,
  placed?: Placed,
): void {
  if (active === undefined) return;
  const span = active.span(name);
  span.calls += calls;
  span.ms += ms;
  span.wallMs += ms;
  active.place(name, ms, calls, placed);
}

/** `timed` for a function that is not async. */
export function timedSync<T>(name: string, run: () => T): T {
  if (active === undefined) return run();
  const probe = active;
  const call = probe.begin(name);
  probe.open.push(name);
  try {
    return probe.within(call, run);
  } finally {
    probe.open.pop();
    probe.end(call);
  }
}
