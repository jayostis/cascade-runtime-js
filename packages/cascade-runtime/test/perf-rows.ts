import { type Seen } from "@cascade-runtime/runtime/probe";
import { selfTimes } from "./perf-trace.js";

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

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export const fixed = (value: number, places: number): number =>
  Number(value.toFixed(places));

/** A noisy measurement as a row: the median of its samples and their range. */
export function clockRow(
  name: string,
  unit: "s" | "By",
  samples: readonly number[],
  extra: string,
  /**
   * The places kept. Microseconds for a time: a question answered from the database takes under a millisecond, which three
   * places would round to 0. The time of one file asks for nanoseconds.
   */
  places = unit === "s" ? 6 : 0,
): Row {
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

/**
 * The unit of a probe counter, from the counter's own name as the runtime gives it: bytes (`By`) where it ends in
 * `.bytes`, otherwise things (`{count}`). Read before the name becomes a row's (`part` cuts it, `unique` numbers it).
 */
export const unitOfCounter = (counter: string): "By" | "{count}" =>
  counter.endsWith(".bytes") ? "By" : "{count}";

/** A count of work done, of things (`{count}`) unless its unit is given (`By` for bytes). */
export const countRow = (
  name: string,
  value: number,
  extra?: string,
  unit: "By" | "{count}" = "{count}",
): Row => ({
  name,
  unit,
  value,
  kind: "cost",
  ...(extra !== undefined && { extra }),
});

/** Gives each name once: a name taken already is told apart by a number. */
export function unique(taken: Set<string>, name: string): string {
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
        unitOfCounter(name),
      ),
    );
  return rows;
}
