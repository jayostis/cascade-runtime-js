import type { SpanEvent } from "@cascade-runtime/runtime/probe";

/**
 * A traced run's calls (`Seen.events` of the probe) as what a person drills into: each span's own time, and a file in
 * Chrome's trace event format, which speedscope (https://www.speedscope.app) opens as a flame chart of nested calls.
 */

/** The time inside each call of a name with none of the calls it made running, where the name had a call in progress. */
export function selfTimes(
  events: readonly SpanEvent[],
): ReadonlyMap<string, number> {
  const count = events.length;
  const first = new Int32Array(count).fill(-1);
  const next = new Int32Array(count).fill(-1);
  for (let at = count - 1; at >= 0; at--) {
    const parent = (events[at] as SpanEvent).parent;
    if (parent < 0) continue;
    next[at] = first[parent] as number;
    first[parent] = at;
  }
  const own = new Map<string, number[]>();
  for (let at = 0; at < count; at++) {
    const event = events[at] as SpanEvent;
    const children: [number, number][] = [];
    for (
      let child = first[at] as number;
      child >= 0;
      child = next[child] as number
    ) {
      const found = events[child] as SpanEvent;
      const from = Math.max(found.start, event.start);
      const to = Math.min(found.end, event.end);
      if (to > from) children.push([from, to]);
    }
    children.sort((a, b) => a[0] - b[0]);
    const spans = own.get(event.name) ?? [];
    let cursor = event.start;
    for (const [from, to] of children) {
      if (from > cursor) spans.push(cursor, from);
      if (to > cursor) cursor = to;
    }
    if (event.end > cursor) spans.push(cursor, event.end);
    own.set(event.name, spans);
  }
  const selves = new Map<string, number>();
  for (const [name, flat] of own) {
    const pairs: [number, number][] = [];
    for (let at = 0; at < flat.length; at += 2)
      pairs.push([flat[at] as number, flat[at + 1] as number]);
    pairs.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let end = Number.NEGATIVE_INFINITY;
    for (const [from, to] of pairs) {
      if (to <= end) continue;
      total += to - Math.max(from, end);
      end = to;
    }
    selves.set(name, total);
  }
  return selves;
}

/**
 * One event of a trace file. It has no `args`: speedscope names a frame by its name and its args together, so any that
 * differ from call to call would split one step into many frames and fill every label with them.
 */
interface TraceEvent {
  name: string;
  cat: string;
  ph: "X";
  ts: number;
  dur: number;
  pid: 1;
  tid: number;
}

export interface TraceOptions {
  /** The run's name, which the whole-run event at the top of the main track and the process carry. */
  readonly title: string;
  /** The sentence that says what a span is, if the glossary has one. */
  readonly says: (name: string) => string | undefined;
  /** The most events written: past it the shortest calls are left out, and their time is their parent's own. */
  readonly maxEvents?: number;
}

export interface Trace {
  readonly file: {
    traceEvents: unknown[];
    displayTimeUnit: "ms";
    otherData: Record<string, unknown>;
  };
  /** Calls seen, calls written (the whole-run event not among them), and the shortest duration written, in milliseconds. */
  readonly seen: number;
  readonly kept: number;
  readonly shortestMs: number;
}

/** The most events a trace is allowed by default: speedscope opens a few hundred thousand, slowly. */
export const MAX_TRACE_EVENTS = 150_000;

const MAIN = "main thread";

/**
 * The run as a Chrome trace: every call a complete event (`ph: "X"`) from the span's name, start and duration, in whole
 * microseconds so that a call that ends where the next begins does so exactly, and one track (`tid`) for each stack of calls
 * that nest properly. A call goes on its parent's track where it nests in what is open there, else on the first track it
 * nests in, else on a new one, so work that ran at the same time shows as tracks side by side; a call measured
 * elsewhere (a worker thread, the Bridge's clock) is on a track of its own name. What each span is, in the glossary's
 * words, is in `otherData.says`.
 */
export function chromeTrace(
  events: readonly SpanEvent[],
  { title, says, maxEvents = MAX_TRACE_EVENTS }: TraceOptions,
): Trace {
  const seen = events.length;
  let floor = 0;
  if (seen > maxEvents) {
    const lengths = events
      .map(({ start, end }) => end - start)
      .sort((a, b) => a - b);
    floor = lengths[seen - maxEvents] as number;
  }
  const kept: number[] = [];
  events.forEach((event, at) => {
    if (event.end - event.start >= floor) kept.push(at);
  });
  let begun = Number.POSITIVE_INFINITY;
  let ended = Number.NEGATIVE_INFINITY;
  for (const at of kept) {
    const { start, end } = events[at] as SpanEvent;
    begun = Math.min(begun, start);
    ended = Math.max(ended, end);
  }
  const starts = new Map<number, number>();
  const ends = new Map<number, number>();
  for (const at of kept) {
    const { start, end } = events[at] as SpanEvent;
    starts.set(at, Math.round((start - begun) * 1000));
    ends.set(at, Math.round((end - begun) * 1000));
  }
  const startOf = (at: number) => starts.get(at) as number;
  const endOf = (at: number) => ends.get(at) as number;
  const track = (at: number) => (events[at] as SpanEvent).track ?? MAIN;
  // Earlier first; of two that begin together, the longer (it holds the other), then the one called first.
  kept.sort((a, b) => startOf(a) - startOf(b) || endOf(b) - endOf(a) || a - b);

  interface Lane {
    readonly tid: number;
    readonly open: number[];
  }
  const lanes = new Map<string, Lane[]>();
  const names = new Map<number, string>();
  let tids = 0;
  const newLane = (where: string): Lane => {
    const lane = { tid: ++tids, open: [] };
    const list = lanes.get(where) ?? [];
    list.push(lane);
    lanes.set(where, list);
    names.set(
      lane.tid,
      list.length === 1 ? where : `${where} (at the same time, ${list.length})`,
    );
    return lane;
  };
  newLane(MAIN);
  const laneOf = new Map<number, Lane>();
  const out: TraceEvent[] = [];
  const meant: Record<string, string> = {};
  /** Whether the call nests in what is open on the lane at its start: the ends of those that ended are dropped. */
  const fits = (lane: Lane, start: number, end: number): boolean => {
    while (
      lane.open.length > 0 &&
      (lane.open[lane.open.length - 1] as number) <= start
    )
      lane.open.pop();
    const top = lane.open[lane.open.length - 1];
    return top === undefined || end <= top;
  };
  for (const at of kept) {
    const event = events[at] as SpanEvent;
    const where = track(at);
    const parentLane =
      event.parent >= 0 && track(event.parent) === where
        ? laneOf.get(event.parent)
        : undefined;
    const candidates = [
      ...(parentLane === undefined ? [] : [parentLane]),
      ...(lanes.get(where) ?? []),
    ];
    const lane =
      candidates.find((each) => fits(each, startOf(at), endOf(at))) ??
      newLane(where);
    lane.open.push(endOf(at));
    laneOf.set(at, lane);
    if (!(event.name in meant)) {
      const sentence = says(event.name);
      if (sentence !== undefined) meant[event.name] = sentence;
    }
    out.push({
      name: event.name,
      cat: where === MAIN ? "span" : "measured elsewhere",
      ph: "X",
      ts: startOf(at),
      dur: endOf(at) - startOf(at),
      pid: 1,
      tid: lane.tid,
    });
  }
  const whole: TraceEvent = {
    name: title,
    cat: "run",
    ph: "X",
    ts: 0,
    dur: Math.round((ended - begun) * 1000),
    pid: 1,
    tid: 1,
  };
  const metadata = [
    { name: "process_name", ph: "M", pid: 1, tid: 0, args: { name: title } },
    ...[...names].map(([tid, name]) => ({
      name: "thread_name",
      ph: "M",
      pid: 1,
      tid,
      args: { name },
    })),
  ];
  return {
    file: {
      traceEvents: [...metadata, whole, ...out],
      displayTimeUnit: "ms",
      otherData: {
        title,
        calls: seen,
        written: kept.length,
        ...(floor > 0 && {
          leftOut: `${seen - kept.length} calls shorter than ${floor.toFixed(3)} ms are not drawn; their time is their parent's own`,
        }),
        says: meant,
      },
    },
    seen,
    kept: kept.length,
    shortestMs: floor,
  };
}
