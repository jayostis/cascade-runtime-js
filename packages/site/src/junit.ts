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
  /** The file the case is in, from the repository's root with `/` (nextest: the test binary, unless a property names it). */
  readonly suite: string;
  /** The levels the case sits in, outermost first: describes, classes or modules, as its runner's dialect reads them. */
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

/**
 * A node:test report names the file from where the tests ran, or, in a report written before it did, the whole path; a
 * reader wants the source under `packages/` it came from.
 */
function sourceOf(file: string): string {
  const path = file.replaceAll("\\", "/");
  const at = path.lastIndexOf("packages/");
  return (at === -1 ? path : path.slice(at)).replace(
    /\/dist\/test\/(.*)\.js$/,
    "/test/$1.ts",
  );
}

/** What wrote a report, as its root says: pytest, vitest and nextest name themselves there; node:test does not. */
type Runner = "node:test" | "pytest" | "vitest" | "nextest";

function runnerOf(tag: string, name: string): Runner {
  if (name.startsWith("pytest")) return "pytest";
  if (tag === "testsuites" && name.startsWith("vitest")) return "vitest";
  if (tag === "testsuites" && name === "nextest-run") return "nextest";
  return "node:test";
}

/** What a level or a case says of itself: from a node:test `testsuite`'s properties, or a case's `describe:N:*`. */
interface Note {
  description?: string;
  rules: string[];
  line?: number;
}

/** A case as its runner placed it, before its properties name it: its file, its levels, its name and its line. */
interface Placed {
  readonly file: string;
  readonly levels: readonly string[];
  readonly name: string;
  readonly line?: number;
}

const lineOf = (value: string | undefined): number | undefined => {
  const line = Number(value);
  return value !== undefined && Number.isInteger(line) && line > 0
    ? line
    : undefined;
};

/**
 * pytest's `classname` is the module's dotted path and then each class the test is in. xunit1 also writes the file and
 * the 0-based line; xunit2 writes neither, so there the classes are the segments from the first capitalised one.
 */
function placedByPytest(attribute: ReadonlyMap<string, string>): Placed {
  const segments = (attribute.get("classname") ?? "")
    .split(".")
    .filter((one) => one !== "");
  const file = attribute.get("file")?.replaceAll("\\", "/");
  const module = file?.replace(/\.py$/, "").split("/");
  let at = segments.findIndex((one) => /^[A-Z]/.test(one));
  if (at === -1) at = segments.length;
  if (
    module !== undefined &&
    segments.slice(0, module.length).join(".") === module.join(".")
  )
    at = module.length;
  const line = Number(attribute.get("line"));
  return {
    file: file ?? (at === 0 ? "" : `${segments.slice(0, at).join("/")}.py`),
    levels: segments.slice(at),
    // pytest-xdist's `loadgroup` appends `@<group>` to every id; it is the worker's, not the test's.
    name: (attribute.get("name") ?? "").replace(/@[^@\]]+$/, ""),
    ...(attribute.has("line") && Number.isInteger(line) && line >= 0
      ? { line: line + 1 }
      : {}),
  };
}

/** Where a case sits by its runner's own attributes; `suites` are the named `testsuite`s around it. */
function placedBy(
  runner: Runner,
  attribute: ReadonlyMap<string, string>,
  suites: readonly string[],
): Placed {
  const name = attribute.get("name") ?? "";
  const line = lineOf(attribute.get("line"));
  const classname = attribute.get("classname") ?? "";
  if (runner === "pytest") return placedByPytest(attribute);
  if (runner === "vitest") {
    const parts = name.split(" > ");
    return {
      file: (attribute.get("file") ?? classname).replaceAll("\\", "/"),
      levels: parts.slice(0, -1),
      name: parts.at(-1) ?? "",
      ...(line === undefined ? {} : { line }),
    };
  }
  if (runner === "nextest") {
    const parts = name.split("::");
    return {
      file: classname,
      // Rust's convention puts a module's tests in `mod tests`, which is no level a reader wants.
      levels: parts.slice(0, -1).filter((part) => part !== "tests"),
      name: parts.at(-1) ?? "",
    };
  }
  return {
    file: sourceOf(attribute.get("file") ?? classname),
    levels: suites,
    name,
    ...(line === undefined ? {} : { line }),
  };
}

interface Building {
  readonly attribute: ReadonlyMap<string, string>;
  /** The named `testsuite`s around the case, and what each says of itself. */
  readonly suites: readonly string[];
  readonly notes: readonly Note[];
  readonly properties: [string, string][];
  result: Result;
  message?: string;
}

/** A case from where its runner placed it, then named, placed and described by its properties, which win. */
function caseOf(runner: Runner, building: Building): TestCase {
  const { attribute, properties, result, message } = building;
  const place = placedBy(runner, attribute, building.suites);
  const one = (key: string): string | undefined =>
    properties.findLast(([name]) => name === key)?.[1];
  const all = (key: string): string[] =>
    properties.filter(([name]) => name === key).map(([, value]) => value);
  const described = place.levels.map((_, at): Described => {
    const note = runner === "node:test" ? building.notes[at] : undefined;
    const description =
      one(`describe:${at + 1}:description`) ?? note?.description;
    const line = lineOf(one(`describe:${at + 1}:line`)) ?? note?.line;
    return {
      ...(description === undefined ? {} : { description }),
      rules: [...(note?.rules ?? []), ...all(`describe:${at + 1}:rule`)],
      ...(line === undefined ? {} : { line }),
    };
  });
  const description = one("description");
  const line = lineOf(one("line")) ?? place.line;
  const seconds = Number(attribute.get("time"));
  return {
    suite: one("file") ?? place.file,
    describes: place.levels.map(
      (name, at) => one(`describe:${at + 1}:title`) ?? name,
    ),
    described,
    ...(description === undefined ? {} : { description }),
    rules: all("rule"),
    name: one("title") ?? place.name,
    ...(line === undefined ? {} : { line }),
    result,
    ...(attribute.has("time") && !Number.isNaN(seconds) ? { seconds } : {}),
    ...(message ? { message } : {}),
  };
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
 * test with failed subtests as a failure too). A case is failed when it holds a `failure` or an `error`, skipped when it
 * holds `skipped`. The runner is read from the report's root, and each places a case in its own way:
 * - node:test: in its `file`, under the named `testsuite`s around it, at its `line`;
 * - pytest: in its `file`, or its module's, under each class its `classname` names after the module, at its 0-based `line`
 *   plus one;
 * - vitest: in its `file` or `classname`, under each describe its `name` joins with ` > `;
 * - nextest: in its test binary, under each module of its `name`'s `::` path but `tests`.
 * A case's properties then win: `title`, `file`, `line`, `description` and each `rule` are its own, and `describe:N:title`,
 * `:description`, `:rule` and `:line` are the Nth level's above it, counted from the outermost.
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
  const suiteNotes: Note[] = [];
  const packages = new Map<string, PackageInfo>();
  const failing = new Set<number>();
  let nextId = 0;
  let building: Building | undefined;
  let roots = 0;
  let runner: Runner = "node:test";

  const finish = (): void => {
    if (building === undefined) return;
    cases.push(caseOf(runner, building));
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

  for (const found of text.matchAll(TAG)) {
    const [whole, closing, tag = "", source = "", selfClosed] = found;
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
    if (open.length === 0) runner = runnerOf(tag, attribute.get("name") ?? "");
    if (tag === "testsuite") {
      // pytest before 7 wrote a root with no name, around one testsuite named for it.
      if (
        open.length === 1 &&
        attribute.get("name") === "pytest" &&
        attribute.has("timestamp")
      )
        runner = "pytest";
      suites.push(attribute.get("name") ?? "");
      suiteIds.push(nextId++);
      suiteNotes.push({ rules: [] });
    } else if (tag === "testcase") {
      const failure = attribute.get("failure");
      building = {
        attribute,
        // Anonymous suites are no level, and so their notes are none.
        suites: suites.filter((suite) => suite !== ""),
        notes: suiteNotes.filter((_, at) => suites[at] !== ""),
        properties: [],
        result: failure === undefined ? "passed" : "failed",
        ...(failure === undefined ? {} : { message: failure }),
      };
    } else if (tag === "property") {
      const name = attribute.get("name") ?? "";
      const value = attribute.get("value") ?? "";
      const note = suiteNotes.at(-1);
      if (building !== undefined) building.properties.push([name, value]);
      else if (note === undefined) {
        if (name.startsWith("package:"))
          try {
            packages.set(name.slice("package:".length), JSON.parse(value));
          } catch {
            // a package line that cannot be read is left off the page
          }
      } else if (name === "description") note.description = value;
      else if (name === "rule") note.rules.push(value);
      else if (name === "line") {
        const line = lineOf(value);
        if (line !== undefined) note.line = line;
      }
    } else if (building !== undefined) {
      if (tag === "failure" || tag === "error") {
        building.result = "failed";
        // nextest writes what failed only as the element's text.
        const after = found.index + whole.length;
        const end = text.indexOf(`</${tag}>`, after);
        const message =
          attribute.get("message") ??
          (selfClosed === "/" || end === -1
            ? undefined
            : decode(text.slice(after, end)).trim());
        if (message) building.message = message;
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
