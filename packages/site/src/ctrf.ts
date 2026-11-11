import type { Described, Result, TestCase } from "./junit.js";

/** The cases of a CTRF report, and the name of the tool that wrote it. */
export interface CtrfReport {
  readonly cases: TestCase[];
  readonly tool?: string;
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

function caseOf(raw: unknown, at: number): TestCase {
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
  return {
    cases: tests.map(caseOf),
    ...(tool === undefined ? {} : { tool }),
  };
}
