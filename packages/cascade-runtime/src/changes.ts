import { Refusal } from "@cascade-runtime/runtime";
import { checkInput, type InputSchema } from "./check.js";
import type { Row } from "./pod.js";

/** Fewer results than this on either side of a medication's day is never a change. */
export const MINIMUM_RESULTS = 3;
/** The least score at which a pair with enough results is a change. */
export const MINIMUM_SCORE = 1;
/** How many findings `findChanges` gives unless asked for more. */
export const DEFAULT_LIMIT = 5;

/** What the results on one side of a medication's day came to; the first and last are days. */
export interface FindingSide {
  count: number;
  mean: number;
  min: number;
  max: number;
  first: string;
  last: string;
}

export interface Finding {
  /** Short and stable for the same pod: `start:<RxNorm>:<LOINC>` or `stop:<RxNorm>:<LOINC>`. */
  key: string;
  kind: "after start" | "after stop";
  medication: {
    name: string;
    code?: string;
    notation?: string;
    date: string;
    entry: string;
  };
  test: { code: string; notation?: string; name?: string };
  unit: string;
  direction: "up" | "down" | "not enough results";
  before: FindingSide;
  after: FindingSide;
  /**
   * What was left out of both sides: a value that is not a number, a number in another unit, a result with no full
   * day (a missing or partial date).
   */
  left: { unparsed: number; otherUnit: number; undated: number };
  /** 0 when there are not enough results. */
  score: number;
  /** The pod's lab rows, as `ask` gave them. */
  rows: { before: Row[]; after: Row[]; left: Row[] };
}

export type CompactFinding = Omit<Finding, "rows" | "medication"> & {
  medication: Omit<Finding["medication"], "entry">;
};

export interface ChangeOptions {
  /** One medication, by RxNorm code (bare or IRI) or name. */
  medication?: string;
  /** One test, by LOINC code (bare or IRI). */
  test?: string;
  limit?: number;
}

/** What the changes need of a pod. */
export interface ChangesPod {
  ask(question: string): Promise<Row[]>;
}

const DAY = /^\d{4}-\d{2}-\d{2}/;
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

function dayOf(time: string | undefined): string | undefined {
  return time !== undefined && DAY.test(time) ? time.slice(0, 10) : undefined;
}

/** The bare code of an IRI an adapter built from it: its last `/` or `#` segment, URI-decoded. */
function notationOf(iri: string | undefined): string | undefined {
  if (iri === undefined || iri === "") return undefined;
  const last = iri.split(/[/#]/).pop() ?? "";
  if (last === "") return undefined;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function byDay(a: { day: string }, b: { day: string }) {
  return a.day < b.day ? -1 : a.day > b.day ? 1 : 0;
}

interface Result {
  day: string;
  row: Row;
  value: number | undefined;
  unit: string;
}

interface Event {
  kind: Finding["kind"];
  day: string;
  row: Row;
}

function sideOf(results: readonly Result[]): FindingSide {
  if (results.length === 0)
    return { count: 0, mean: 0, min: 0, max: 0, first: "", last: "" };
  const values = results.map(({ value }) => value!);
  return {
    count: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    first: results[0]!.day,
    last: results[results.length - 1]!.day,
  };
}

function squares(results: readonly Result[], mean: number) {
  return results.reduce((sum, { value }) => sum + (value! - mean) ** 2, 0);
}

/**
 * The difference of the means over the pooled sample standard deviation, floored at 1% of the before mean's
 * magnitude so constant values do not divide by zero.
 */
function scoreOf(before: readonly Result[], after: readonly Result[]) {
  const a = sideOf(before);
  const b = sideOf(after);
  const pooled = Math.sqrt(
    (squares(before, a.mean) + squares(after, b.mean)) /
      (a.count + b.count - 2),
  );
  const spread = Math.max(pooled, Math.abs(a.mean) * 0.01, Number.EPSILON);
  return Math.abs(b.mean - a.mean) / spread;
}

function named(row: Row, wanted: string): boolean {
  const code = row.code;
  return (
    code === wanted ||
    notationOf(code) === wanted ||
    (row.medication ?? "").toLowerCase() === wanted.toLowerCase()
  );
}

/** A test's dated results, oldest first; and, per test, the rows with no full day, which no series can place. */
function results(rows: readonly Row[]): {
  byTest: Map<string, Result[]>;
  undated: Map<string, Row[]>;
} {
  const byTest = new Map<string, Result[]>();
  const undated = new Map<string, Row[]>();
  for (const row of rows) {
    if (row.code === undefined) continue;
    const day = dayOf(row.performed);
    if (day === undefined) {
      undated.set(row.code, [...(undated.get(row.code) ?? []), row]);
      continue;
    }
    const value =
      row.value !== undefined && DECIMAL.test(row.value.trim())
        ? Number(row.value)
        : undefined;
    const group = byTest.get(row.code) ?? [];
    group.push({ day, row, value, unit: row.unit ?? "" });
    byTest.set(row.code, group);
  }
  for (const group of byTest.values()) group.sort(byDay);
  return { byTest, undated };
}

function unitOf(numeric: readonly Result[]): string {
  const counts = new Map<string, number>();
  for (const { unit } of numeric) counts.set(unit, (counts.get(unit) ?? 0) + 1);
  let chosen = "";
  let most = 0;
  for (const [unit, count] of counts)
    if (count > most) {
      chosen = unit;
      most = count;
    }
  return chosen;
}

function pair(
  event: Event,
  test: string,
  series: readonly Result[],
  undated: readonly Row[],
) {
  const before = series.filter(({ day }) => day <= event.day);
  const after = series.filter(({ day }) => day > event.day);
  if (before.length === 0 || after.length === 0) return undefined;
  const numeric = [...before, ...after].filter(
    ({ value }) => value !== undefined,
  );
  if (numeric.length === 0) return undefined;
  const unit = unitOf(numeric);
  const same = (result: Result) =>
    result.value !== undefined && result.unit === unit;
  const kept = { before: before.filter(same), after: after.filter(same) };
  const unparsed = [...before, ...after].filter(
    ({ value }) => value === undefined,
  );
  const otherUnit = numeric.filter(({ unit: other }) => other !== unit);
  const first = kept.before;
  const second = kept.after;
  const enough =
    first.length >= MINIMUM_RESULTS && second.length >= MINIMUM_RESULTS;
  const score = enough ? scoreOf(first, second) : 0;
  const sideBefore = sideOf(first);
  const sideAfter = sideOf(second);
  const direction: Finding["direction"] = !enough
    ? "not enough results"
    : sideAfter.mean > sideBefore.mean
      ? "up"
      : "down";
  const notation = notationOf(event.row.code);
  const testNotation = notationOf(test);
  const name = event.row.medication ?? "";
  const label = notation ?? name;
  const testName = series.find(({ row }) => row.test)?.row.test;
  const finding: Finding = {
    key: `${event.kind === "after start" ? "start" : "stop"}:${label}:${testNotation ?? test}`,
    kind: event.kind,
    medication: {
      name,
      ...(event.row.code ? { code: event.row.code } : {}),
      ...(notation ? { notation } : {}),
      date: event.day,
      entry: event.row.entry ?? "",
    },
    test: {
      code: test,
      ...(testNotation ? { notation: testNotation } : {}),
      ...(testName ? { name: testName } : {}),
    },
    unit,
    direction,
    before: sideBefore,
    after: sideAfter,
    left: {
      unparsed: unparsed.length,
      otherUnit: otherUnit.length,
      undated: undated.length,
    },
    score,
    rows: {
      before: first.map(({ row }) => row),
      after: second.map(({ row }) => row),
      left: [
        ...[...unparsed, ...otherUnit].sort(byDay).map(({ row }) => row),
        ...undated,
      ],
    },
  };
  return finding;
}

/**
 * A drug's entries as one therapy, keyed as a finding's key is: the earliest start and the latest end, so yearly
 * renewals of one drug are one start, not as many as there are renewals. The first entry with the earliest start
 * stands for it.
 */
function therapies(medications: readonly Row[]) {
  const byDrug = new Map<
    string,
    { row: Row; started?: string; ended?: string }
  >();
  for (const row of medications) {
    const label = notationOf(row.code) ?? row.medication ?? "";
    const started = dayOf(row.started);
    const ended = dayOf(row.ended);
    const kept = byDrug.get(label);
    if (kept === undefined) {
      byDrug.set(label, {
        row,
        ...(started ? { started } : {}),
        ...(ended ? { ended } : {}),
      });
      continue;
    }
    if (started && (kept.started === undefined || started < kept.started)) {
      kept.started = started;
      kept.row = row;
    }
    if (ended && (kept.ended === undefined || ended > kept.ended))
      kept.ended = ended;
  }
  return [...byDrug.values()];
}

/**
 * What changed in the results after each medication started or stopped, from the rows of `pod/My medication history`
 * and `pod/My lab results`: every medication's day against every test with results on both sides of it. A result on
 * the day is before it. Changes come first, by score; then pairs with too few results; at most `options.limit`.
 *
 * @throws Refusal when `options` names a medication or a test the rows do not hold.
 */
export function changesIn(
  medications: readonly Row[],
  labs: readonly Row[],
  options: ChangeOptions = {},
): Finding[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  if (!(limit >= 1))
    throw new Refusal(`limit must be at least 1, not ${String(limit)}`);
  const { byTest: series, undated } = results(labs);
  let chosen = medications;
  if (options.medication !== undefined) {
    const wanted = options.medication;
    chosen = medications.filter((row) => named(row, wanted));
    if (chosen.length === 0)
      throw new Refusal(`no medication ${wanted} in the pod`);
  }
  let tests = [...series.keys()];
  if (options.test !== undefined) {
    const wanted = options.test;
    tests = tests.filter(
      (code) => code === wanted || notationOf(code) === wanted,
    );
    if (tests.length === 0) throw new Refusal(`no test ${wanted} in the pod`);
  }
  const found = new Map<string, Finding>();
  for (const { row, started, ended } of therapies(chosen)) {
    const events: Event[] = [];
    if (started) events.push({ kind: "after start", day: started, row });
    if (ended) events.push({ kind: "after stop", day: ended, row });
    for (const event of events)
      for (const test of tests) {
        const finding = pair(
          event,
          test,
          series.get(test)!,
          undated.get(test) ?? [],
        );
        if (finding !== undefined) found.set(finding.key, finding);
      }
  }
  const all = [...found.values()];
  const changes = all
    .filter(
      ({ direction, score }) =>
        direction !== "not enough results" && score >= MINIMUM_SCORE,
    )
    .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  const thin = all
    .filter(({ direction }) => direction === "not enough results")
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  return [...changes, ...thin].slice(0, limit);
}

/** The findings of a pod: `changesIn` over what the pod's questions give. */
export async function findChanges(
  pod: ChangesPod,
  options: ChangeOptions = {},
): Promise<Finding[]> {
  const [medications, labs] = await Promise.all([
    pod.ask("pod/My medication history"),
    pod.ask("pod/My lab results"),
  ]);
  return changesIn(medications, labs, options);
}

/** A finding without its rows and entry IRIs: tens of tokens, reached again by its `key`. */
export function compact(finding: Finding): CompactFinding {
  const {
    key,
    kind,
    medication,
    test,
    unit,
    direction,
    before,
    after,
    left,
    score,
  } = finding;
  const { name, code, notation, date } = medication;
  return {
    key,
    kind,
    medication: {
      name,
      ...(code ? { code } : {}),
      ...(notation ? { notation } : {}),
      date,
    },
    test,
    unit,
    direction,
    before,
    after,
    left,
    score,
  };
}

export interface LabSeries {
  test: { code: string; notation?: string; name?: string };
  results: { date: string; value: number; unit: string }[];
  left: { unparsed: number; undated: number };
}

/**
 * One test's results as day, number and unit, oldest first.
 *
 * @throws Refusal when the rows hold no such test.
 */
export function labSeriesIn(labs: readonly Row[], test: string): LabSeries {
  const { byTest: series, undated } = results(labs);
  const code = [...series.keys()].find(
    (each) => each === test || notationOf(each) === test,
  );
  if (code === undefined) throw new Refusal(`no test ${test} in the pod`);
  const all = series.get(code)!;
  const notation = notationOf(code);
  const name = all.find(({ row }) => row.test)?.row.test;
  return {
    test: {
      code,
      ...(notation ? { notation } : {}),
      ...(name ? { name } : {}),
    },
    results: all
      .filter(({ value }) => value !== undefined)
      .map(({ day, value, unit }) => ({ date: day, value: value!, unit })),
    left: {
      unparsed: all.filter(({ value }) => value === undefined).length,
      undated: (undated.get(code) ?? []).length,
    },
  };
}

export async function labSeries(
  pod: ChangesPod,
  test: string,
): Promise<LabSeries> {
  return labSeriesIn(await pod.ask("pod/My lab results"), test);
}

export interface TimelineEntry {
  name: string;
  code?: string;
  notation?: string;
  status?: string;
  started?: string;
  ended?: string;
}

/** Each medication with its start and end, by start. */
export function timelineIn(medications: readonly Row[]): TimelineEntry[] {
  const timed = medications.map((row): TimelineEntry => {
    const notation = notationOf(row.code);
    return {
      name: row.medication ?? "",
      ...(row.code ? { code: row.code } : {}),
      ...(notation ? { notation } : {}),
      ...(row.status ? { status: row.status } : {}),
      ...(dayOf(row.started) ? { started: dayOf(row.started) } : {}),
      ...(dayOf(row.ended) ? { ended: dayOf(row.ended) } : {}),
    };
  });
  return timed.sort((a, b) =>
    (a.started ?? "9999") < (b.started ?? "9999")
      ? -1
      : (a.started ?? "9999") > (b.started ?? "9999")
        ? 1
        : a.name < b.name
          ? -1
          : 1,
  );
}

export async function timeline(pod: ChangesPod): Promise<TimelineEntry[]> {
  return timelineIn(await pod.ask("pod/My medication history"));
}

export { checkInput, type InputSchema };

/** The shape MCP, WebMCP and CopilotKit share. */
export interface ChangeTool {
  name: string;
  description: string;
  inputSchema: InputSchema;
  /** @throws Refusal when the input is bad, or names a medication or a test the pod does not hold. */
  execute(input: unknown): Promise<unknown>;
}

const MEDICATION = "An RxNorm code (bare or an IRI) or the medication's name.";
const TEST = "A LOINC code, bare or an IRI.";

/** The tools over one pod. */
export function changeTools(pod: ChangesPod): ChangeTool[] {
  const tool = (
    name: string,
    description: string,
    inputSchema: InputSchema,
    run: (input: Record<string, unknown>) => Promise<unknown>,
  ): ChangeTool => ({
    name,
    description,
    inputSchema,
    async execute(input) {
      checkInput(inputSchema, input);
      return run(input as Record<string, unknown>);
    },
  });
  return [
    tool(
      "find_changes",
      "What changed in a person's lab results after a medication started or stopped, strongest first. States what changed, never why.",
      {
        type: "object",
        properties: {
          medication: { type: "string", description: MEDICATION },
          test: { type: "string", description: TEST },
          limit: {
            type: "integer",
            description: "At most this many findings; 5 if left out.",
            minimum: 1,
            maximum: 20,
          },
        },
        additionalProperties: false,
      },
      async (input) =>
        (await findChanges(pod, input as ChangeOptions)).map(compact),
    ),
    tool(
      "finding_rows",
      "The lab rows behind a finding, by the key find_changes gave it.",
      {
        type: "object",
        properties: {
          key: { type: "string", description: "A finding's key." },
        },
        required: ["key"],
        additionalProperties: false,
      },
      async ({ key }) => {
        const found = (
          await findChanges(pod, { limit: Number.MAX_SAFE_INTEGER })
        ).find((each) => each.key === key);
        if (found === undefined) throw new Refusal(`no finding ${String(key)}`);
        return found.rows;
      },
    ),
    tool(
      "lab_series",
      "One test's results over time: day, number and unit, with what was left out counted.",
      {
        type: "object",
        properties: { test: { type: "string", description: TEST } },
        required: ["test"],
        additionalProperties: false,
      },
      ({ test }) => labSeries(pod, test as string),
    ),
    tool(
      "timeline",
      "Each medication with the day it started and the day it ended.",
      { type: "object", properties: {}, additionalProperties: false },
      () => timeline(pod),
    ),
  ];
}
