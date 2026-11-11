import type { Described, Result, TestCase } from "./junit.js";

/** The cases of a CTRF report, and the name of the tool that wrote it. */
export interface CtrfReport {
  readonly cases: TestCase[];
  readonly tool?: string;
  /** True when the report says no case was timed: each case's `duration` of 0 is then no time at all, and none is read. */
  readonly unmeasured: boolean;
  /** When the run began and ended, in milliseconds, as `results.summary` gives them. */
  readonly start?: number;
  readonly stop?: number;
}

const RESULTS: Readonly<Record<string, Result>> = {
  passed: "passed",
  failed: "failed",
  skipped: "skipped",
  pending: "skipped",
  other: "skipped",
};

/** What the page writes of a case itself: a source's `extra` of these names is read, not passed through. */
const WRITTEN_HERE = new Set(["levels", "description", "rules"]);

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

function caseOf(raw: unknown, at: number, unmeasured: boolean): TestCase {
  const given = object(raw);
  const name = text(given["name"]);
  if (name === undefined)
    throw new Error(`test ${at + 1} of results.tests has no name`);
  const status = text(given["status"]) ?? "";
  const result = RESULTS[status];
  if (result === undefined)
    throw new Error(
      `test ${at + 1} of results.tests has the status ${status}, which is none of ${Object.keys(RESULTS).join(", ")}`,
    );
  const suite = Array.isArray(given["suite"])
    ? given["suite"].filter((one): one is string => typeof one === "string")
    : [];
  const extra = object(given["extra"]);
  const levels = Array.isArray(extra["levels"]) ? extra["levels"] : [];
  const described: Described[] = suite.map((_, level) => {
    const description = text(object(levels[level])["description"]);
    return {
      ...(description === undefined ? {} : { description }),
      rules: [],
    };
  });
  const passedOn = Object.fromEntries(
    Object.entries(extra).filter(([key]) => !WRITTEN_HERE.has(key)),
  );
  const description = text(extra["description"]);
  const message = text(given["message"]);
  const line = given["line"];
  const duration = given["duration"];
  return {
    file: text(given["filePath"]) ?? "",
    describes: suite,
    described,
    rules: [],
    name,
    result,
    ...(description === undefined ? {} : { description }),
    ...(typeof line === "number" && Number.isInteger(line) && line > 0
      ? { line }
      : {}),
    ...(message === undefined ? {} : { message }),
    ...(!unmeasured && typeof duration === "number" && duration >= 0
      ? { seconds: duration / 1000, milliseconds: duration }
      : {}),
    ...(Object.keys(passedOn).length === 0 ? {} : { extra: passedOn }),
  };
}

/**
 * The cases of a CTRF report (https://ctrf.io), in the order written: each test's `suite` is its levels, outermost first,
 * with what each says of itself in `extra.levels`; `other` and `pending` read as skipped, as a case has three results.
 * Throws when the text is not JSON or holds no `results.tests` list.
 */
export function readCtrf(json: string): CtrfReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `the report is not JSON (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
  const results = object(object(parsed)["results"]);
  const tests = results["tests"];
  if (!Array.isArray(tests))
    throw new Error("the report holds no results.tests list");
  const tool = text(object(results["tool"])["name"]);
  const summary = object(results["summary"]);
  const { start, stop } = summary;
  const unmeasured = object(results["extra"])["caseDurations"] === "unmeasured";
  const timed = typeof start === "number" && typeof stop === "number";
  return {
    cases: tests.map((one, at) => caseOf(one, at, unmeasured)),
    ...(tool === undefined ? {} : { tool }),
    unmeasured,
    ...(timed ? { start, stop } : {}),
  };
}
