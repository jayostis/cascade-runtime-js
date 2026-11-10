import { existsSync, readFileSync } from "node:fs";
import { SourceMap } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { junit } from "node:test/reporters";
import { fileURLToPath } from "node:url";

/**
 * node:test's JUnit report, each `testcase` also given the `line` of the TypeScript source it is declared on, and that
 * source as its `file`, so the published page can link a case to its line. node's reporter writes no line, and the
 * runner sees only the transpiled file; its source map says where the case was written.
 *
 * The leading doc comment of each describe and each test is its description. It is written as a `<properties>` entry of
 * the `testsuite` or `testcase`: `description` is the prose, a `rule` is each `@rule <feature> <id>` tag, and `line` is
 * where a describe is declared. Each package a test is in is a `package:<folder>` property of the root: JSON of its name,
 * its version and its `test/spec.json`, so a page built later reads the package as the run saw it.
 */
const MARK = "test@L";
/** Invisible, and in no test's name: it carries an entry's number through node's reporter, which writes only names. */
const SEPARATOR = "⁣";
const maps = new Map();
const sources = new Map();
const notes = [];
const packages = new Map();

function mapOf(file) {
  if (!maps.has(file)) {
    let map;
    try {
      map = new SourceMap(JSON.parse(readFileSync(`${file}.map`, "utf8")));
    } catch {
      map = undefined;
    }
    maps.set(file, map);
  }
  return maps.get(file);
}

function located({ file, line, column }) {
  if (file === undefined || line === undefined) return undefined;
  const path = file.startsWith("file:") ? fileURLToPath(file) : file;
  const origin = mapOf(path)?.findOrigin(line, column ?? 1);
  if (origin === undefined || !("lineNumber" in origin)) return undefined;
  const source = origin.fileName.startsWith("file:")
    ? fileURLToPath(origin.fileName)
    : resolve(dirname(path), origin.fileName);
  return { file: source, line: origin.lineNumber };
}

function linesOf(file) {
  if (!sources.has(file)) {
    try {
      sources.set(file, readFileSync(file, "utf8").split(/\r?\n/));
    } catch {
      sources.set(file, []);
    }
  }
  return sources.get(file);
}

/** The doc comment ending on the line above the 1-based `line`, as its prose and its `@rule` tags. */
export function docOf(lines, line) {
  const end = line - 2;
  if (!lines[end]?.trim().endsWith("*/")) return { rules: [] };
  let start = end;
  while (start >= 0 && !lines[start].includes("/*")) start -= 1;
  if (start < 0 || !lines[start].trim().startsWith("/**")) return { rules: [] };
  const rules = [];
  const paragraphs = [[]];
  for (const raw of lines.slice(start, end + 1)) {
    const body = raw
      .trim()
      .replace(/^\/\*\*/, "")
      .replace(/\*\/$/, "")
      .replace(/^\*\s?/, "")
      .trim();
    const rule = /^@rule\s+(.+)$/.exec(body);
    if (rule !== null) rules.push(rule[1].trim().replace(/\s+/g, " "));
    else if (body.startsWith("@")) continue;
    else if (body === "") paragraphs.push([]);
    else paragraphs.at(-1).push(body);
  }
  const description = paragraphs
    .filter((words) => words.length > 0)
    .map((words) => words.join(" "))
    .join("\n\n");
  return description === "" ? { rules } : { description, rules };
}

function notePackageOf(source) {
  let at = dirname(source);
  while (!existsSync(join(at, "package.json"))) {
    const up = dirname(at);
    if (up === at) return;
    at = up;
  }
  const folder = basename(at);
  if (packages.has(folder)) return;
  const { name, version } = JSON.parse(
    readFileSync(join(at, "package.json"), "utf8"),
  );
  let spec;
  try {
    spec = JSON.parse(readFileSync(join(at, "test", "spec.json"), "utf8"));
  } catch {
    spec = undefined;
  }
  packages.set(folder, { name, version, ...(spec ? { spec } : {}) });
}

const escape = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\n", "&#10;");

const property = (name, value) =>
  `<property name="${name}" value="${escape(value)}"/>`;

const NAMED = new Set([
  "test:enqueue",
  "test:dequeue",
  "test:start",
  "test:pass",
  "test:fail",
]);
const numbers = new Map();

/**
 * node pairs a test's start with its result by name, so every event of a test carries the same marked name; a suite is
 * known as one only when its result arrives.
 */
function numberOfNote(data, at) {
  const key = JSON.stringify([at.file, at.line, data.column, data.name]);
  if (!numbers.has(key)) {
    const { description, rules } = docOf(linesOf(at.file), at.line);
    numbers.set(
      key,
      notes.push({
        ...(description === undefined ? {} : { description }),
        rules,
        at: at.line,
        suite: false,
      }),
    );
  }
  return numbers.get(key);
}

async function* withLines(source) {
  for await (const event of source) {
    const { data } = event;
    const at = NAMED.has(event.type) ? located(data) : undefined;
    if (at === undefined) {
      yield event;
      continue;
    }
    notePackageOf(at.file);
    const number = numberOfNote(data, at);
    const result = event.type === "test:pass" || event.type === "test:fail";
    const suite = data.details?.type === "suite";
    if (suite) notes[number - 1].suite = true;
    yield {
      ...event,
      data: {
        ...data,
        name: `${data.name}${SEPARATOR}${number}${SEPARATOR}`,
        ...(result ? { file: at.file } : {}),
        ...(result && data.classname === undefined && !suite
          ? { classname: `${MARK}${at.line}` }
          : {}),
      },
    };
  }
}

function propertiesOf(number) {
  const { description, rules, at, suite } = notes[number - 1];
  const list = [
    ...(description === undefined
      ? []
      : [property("description", description)]),
    ...rules.map((rule) => property("rule", rule)),
    ...(suite ? [property("line", String(at))] : []),
  ];
  return list.length === 0 ? "" : `<properties>${list.join("")}</properties>`;
}

const ATTRIBUTES = String.raw`((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*`;

function annotated(xml) {
  return xml
    .replace(
      new RegExp(
        String.raw`<testsuite name="([^"]*?)${SEPARATOR}(\d+)${SEPARATOR}"${ATTRIBUTES}>`,
        "g",
      ),
      (_, name, number, rest) =>
        `<testsuite name="${name}"${rest}>${propertiesOf(Number(number))}`,
    )
    .replace(
      new RegExp(
        String.raw`<testcase name="([^"]*?)${SEPARATOR}(\d+)${SEPARATOR}"${ATTRIBUTES}(/?)>`,
        "g",
      ),
      (_, name, number, rest, closed) =>
        propertiesOf(Number(number)) === ""
          ? `<testcase name="${name}"${rest}${closed}>`
          : `<testcase name="${name}"${rest}>${propertiesOf(Number(number))}${closed === "/" ? "</testcase>" : ""}`,
    )
    .replace(
      /classname="test@L(\d+)"/g,
      (_, line) => `classname="test" line="${line}"`,
    )
    .replace(
      "<testsuites>",
      () =>
        `<testsuites>${
          packages.size === 0
            ? ""
            : `<properties>${[...packages]
                .map(([folder, info]) =>
                  property(`package:${folder}`, JSON.stringify(info)),
                )
                .join("")}</properties>`
        }`,
    );
}

export default async function* junitWithLines(source) {
  let xml = "";
  for await (const chunk of junit(withLines(source))) xml += chunk;
  yield annotated(xml);
}
