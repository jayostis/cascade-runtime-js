export type Result = "passed" | "failed" | "skipped";

/** What a describe's doc comment says, as the reporter wrote it into the report. */
export interface Described {
  readonly description?: string;
  /** Each `@rule <feature> <id>` tag, as written after `@rule`. */
  readonly rules: readonly string[];
  /** The line of the source the describe is declared on. */
  readonly line?: number;
}

/** A package as the reporter read it beside the tests: its `package.json` and its `test/spec.json`. */
export interface PackageInfo {
  readonly name: string;
  readonly version: string;
  readonly spec?: unknown;
}

/** One test case of a JUnit report. */
export interface TestCase {
  /** The file (node:test) or module (pytest) the case is in. */
  readonly suite: string;
  /** The describe blocks the case sits in, outermost first (node:test); none for pytest. */
  readonly describes: readonly string[];
  /** What each of those describes says of itself, one for each. */
  readonly described: readonly Described[];
  /** The test's own doc comment, and the rules it tags. */
  readonly description?: string;
  readonly rules: readonly string[];
  readonly name: string;
  /** The line of the source the case is declared on, when the report says. */
  readonly line?: number;
  readonly result: Result;
  /** Seconds, when the report says. */
  readonly seconds?: number;
  /** What a failed case said, as the report keeps it. */
  readonly message?: string;
}

const TAG =
  /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi;
const NAMED: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

/**
 * XML text as the two reporters write it. node:test escapes `&` after `"`, so its quote arrives as the text `&quot;`;
 * that reads as the quote, as no test is named for the entity.
 */
function decode(text: string): string {
  return text
    .replace(/&amp;(quot|apos);/g, "&$1;")
    .replace(ENTITY, (whole, decimal, hex, name) => {
      if (name !== undefined) return NAMED[String(name)] ?? whole;
      const code =
        decimal !== undefined ? Number(decimal) : parseInt(String(hex), 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    });
}

function attributesOf(source: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const [, name, double, single] of source.matchAll(ATTRIBUTE))
    found.set(name ?? "", decode(double ?? single ?? ""));
  return found;
}

/** A node:test report names the runner's compiled file; a reader wants the source under `packages/` it came from. */
function sourceOf(file: string): string {
  const path = file.replaceAll("\\", "/");
  const at = path.lastIndexOf("packages/");
  return (at === -1 ? path : path.slice(at)).replace(
    /\/dist\/test\/(.*)\.js$/,
    "/test/$1.ts",
  );
}

interface Building {
  suite: string;
  describes: string[];
  described: Described[];
  description?: string;
  rules: string[];
  name: string;
  line?: number;
  result: Result;
  seconds?: number;
  message?: string;
}

/**
 * The failures node:test counts in the `<!-- fail N -->` comment ending its report, or undefined when there is none (pytest
 * writes no such comment). Its JUnit elements leave out a failure of a test that has subtests, or of a hook, so N can exceed
 * the failed cases the elements list; a test whose subtests failed is itself one of the N, and is listed only as the
 * `testsuite` holding them, which `readJunit` counts.
 */
export function declaredFailures(xml: string): number | undefined {
  const found = /<!--\s*fail\s+(\d+)\s*-->/.exec(xml);
  return found === null ? undefined : Number(found[1]);
}

/** How long node:test says its run took, in milliseconds, from the `<!-- duration_ms N -->` ending its report. */
export function declaredDuration(xml: string): number | undefined {
  const found = /<!--\s*duration_ms\s+([\d.]+)\s*-->/.exec(xml);
  return found === null ? undefined : Number(found[1]);
}

/** The cases of a report, and how many of its `testsuite` elements hold a failed case anywhere below them. */
export interface JunitReport {
  readonly cases: TestCase[];
  /** The packages the run's tests are in, by their folder under `packages/`, when the report names them. */
  readonly packages: ReadonlyMap<string, PackageInfo>;
  readonly failingSuites: number;
}

/**
 * The cases of a JUnit report, in the order written, and the count of its suites that hold a failed case (node counts a
 * test with failed subtests as a failure too). Reads what pytest and node:test write: a case is failed when it holds a
 * `failure` or an `error`, skipped when it holds `skipped`. A case that names its `file` (node:test) is in that file, under
 * the describe blocks it sits in; one that names a `classname` (pytest) is in that module.
 * Throws when the text is no JUnit report or stops before its end.
 */
export function readJunit(xml: string): JunitReport {
  const text = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const cases: TestCase[] = [];
  const open: string[] = [];
  const suites: string[] = [];
  const suiteIds: number[] = [];
  const suiteNotes: { description?: string; rules: string[]; line?: number }[] =
    [];
  const packages = new Map<string, PackageInfo>();
  const failing = new Set<number>();
  let nextId = 0;
  let building: Building | undefined;
  let roots = 0;

  const finish = (): void => {
    if (building === undefined) return;
    const { message, ...rest } = building;
    cases.push(message ? { ...rest, message } : rest);
    if (building.result === "failed")
      for (const id of suiteIds) failing.add(id);
    building = undefined;
  };
  const close = (tag: string): void => {
    if (tag === "testsuite") {
      suites.pop();
      suiteIds.pop();
      suiteNotes.pop();
    }
    if (tag === "testcase") finish();
  };

  for (const [, closing, tag = "", source = "", selfClosed] of text.matchAll(
    TAG,
  )) {
    if (closing === "/") {
      if (open.pop() !== tag)
        throw new Error(`the report closes <${tag}> where it is not open`);
      close(tag);
      continue;
    }
    if (open.length === 0) {
      if (tag !== "testsuites" && tag !== "testsuite")
        throw new Error(`the report is of <${tag}>, not of test suites`);
      roots += 1;
    }
    const attribute = attributesOf(source);
    if (tag === "testsuite") {
      suites.push(attribute.get("name") ?? "");
      suiteIds.push(nextId++);
      suiteNotes.push({ rules: [] });
    } else if (tag === "testcase") {
      const file = attribute.get("file");
      const inside = suites.filter((suite) => suite !== "");
      const name = attribute.get("name") ?? "";
      const seconds = Number(attribute.get("time"));
      const failure = attribute.get("failure");
      const line = Number(attribute.get("line"));
      // Anonymous suites are dropped from `describes`, and so from their notes.
      const kept = suiteNotes.filter((_, at) => suites[at] !== "");
      building = {
        rules: [],
        described:
          file === undefined
            ? []
            : kept.map(({ description, rules, line: at }) => ({
                ...(description === undefined ? {} : { description }),
                rules,
                ...(at === undefined ? {} : { line: at }),
              })),
        suite:
          file !== undefined
            ? sourceOf(file)
            : (attribute.get("classname") ?? inside.at(-1) ?? ""),
        describes: file !== undefined ? inside : [],
        // pytest-xdist's `loadgroup` appends `@<group>` to every id; it is the worker's, not the test's.
        name: file !== undefined ? name : name.replace(/@\w+$/, ""),
        ...(Number.isInteger(line) && line > 0 ? { line } : {}),
        result: failure === undefined ? "passed" : "failed",
        ...(attribute.has("time") && !Number.isNaN(seconds) ? { seconds } : {}),
        ...(failure === undefined ? {} : { message: failure }),
      };
    } else if (tag === "property") {
      const name = attribute.get("name") ?? "";
      const value = attribute.get("value") ?? "";
      const note = building ?? suiteNotes.at(-1);
      if (note === undefined) {
        if (name.startsWith("package:"))
          try {
            packages.set(name.slice("package:".length), JSON.parse(value));
          } catch {
            // a package line that cannot be read is left off the page
          }
      } else if (name === "description") note.description = value;
      else if (name === "rule") note.rules.push(value);
      else if (name === "line" && building === undefined)
        suiteNotes.at(-1)!.line = Number(value);
    } else if (building !== undefined) {
      if (tag === "failure" || tag === "error") {
        building.result = "failed";
        const message = attribute.get("message");
        if (message !== undefined) building.message = message;
      } else if (tag === "skipped" && building.result === "passed") {
        building.result = "skipped";
      }
    }
    if (selfClosed === "/") close(tag);
    else open.push(tag);
  }
  if (roots === 0) throw new Error("the report holds no test suites");
  if (roots > 1) throw new Error("the report has more than one root");
  if (open.length > 0) throw new Error("the report is cut short");
  return { cases, failingSuites: failing.size, packages };
}
