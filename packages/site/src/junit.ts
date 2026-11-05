export type Result = "passed" | "failed" | "skipped";

/** One test case of a JUnit report. */
export interface TestCase {
  /** The file (node:test) or module (pytest) the case is in. */
  readonly suite: string;
  readonly name: string;
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
  name: string;
  result: Result;
  seconds?: number;
  message?: string;
}

/**
 * The cases of a JUnit report, in the order written. Reads what pytest and node:test write: a case is failed when it holds a
 * `failure` or an `error`, skipped when it holds `skipped`. A case that names its `file` (node:test) is in that file, and
 * the describe blocks it sits in are part of its name; one that names a `classname` (pytest) is in that module.
 * Throws when the text is no JUnit report or stops before its end.
 */
export function parseJunit(xml: string): TestCase[] {
  const text = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const cases: TestCase[] = [];
  const open: string[] = [];
  const suites: string[] = [];
  let building: Building | undefined;
  let roots = 0;

  const finish = (): void => {
    if (building === undefined) return;
    const { message, ...rest } = building;
    cases.push(message ? { ...rest, message } : rest);
    building = undefined;
  };
  const close = (tag: string): void => {
    if (tag === "testsuite") suites.pop();
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
    } else if (tag === "testcase") {
      const file = attribute.get("file");
      const inside = suites.filter((suite) => suite !== "");
      const name = attribute.get("name") ?? "";
      const seconds = Number(attribute.get("time"));
      const failure = attribute.get("failure");
      building = {
        suite:
          file !== undefined
            ? sourceOf(file)
            : (attribute.get("classname") ?? inside.at(-1) ?? ""),
        name: file !== undefined ? [...inside, name].join(" › ") : name,
        result: failure === undefined ? "passed" : "failed",
        ...(attribute.has("time") && !Number.isNaN(seconds) ? { seconds } : {}),
        ...(failure === undefined ? {} : { message: failure }),
      };
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
  return cases;
}
