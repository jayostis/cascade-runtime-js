import { Html, markup } from "../html.js";
import { frontPageLink } from "../links.js";
import {
  declaredDuration,
  declaredFailures,
  readJunit,
  type Result,
  type TestCase,
} from "../junit.js";
import type { Section } from "../sections.js";
import { STYLESHEET_FILE } from "../site.js";
import type { PagesContext, TestRun } from "./context.js";

export const TESTS_FOLDER = "conformance/tests/";
export const TESTS_PAGE = `${TESTS_FOLDER}index.html`;

/** What the section reads of the context. */
export type TestsContext = Pick<PagesContext, "tests">;

interface Suite {
  readonly key: "runtime" | "vocabulary";
  readonly title: string;
  readonly repository: string;
  readonly about: string;
  /** What ran the suite, as CTRF names its tool. */
  readonly tool: string;
  /** Whether its cases are shown as a tree of package, file and describe, or as one table. */
  readonly tree: boolean;
}

const SUITES: readonly Suite[] = [
  {
    key: "runtime",
    title: "The runtime's tests",
    repository: "https://github.com/jayostis/cascade-runtime-js",
    about: "npm test, node:test over every package",
    tool: "node:test",
    tree: true,
  },
  {
    key: "vocabulary",
    title: "The vocabulary's tests",
    repository: "https://github.com/jayostis/cascade-vocabulary",
    about: "pytest over the shapes, queries, kits and features",
    tool: "pytest",
    tree: false,
  },
];

/** Where an agent reads a suite's results: CTRF, beside the page. */
export const ctrfFile = (key: Suite["key"]): string =>
  `${TESTS_FOLDER}${key}.ctrf.json`;

const FAILURE_SHOWN = 400;
const ORDER: Readonly<Record<Result, number>> = {
  failed: 0,
  passed: 1,
  skipped: 1,
};

const STYLES = `
.result { display: inline-block; min-width: 4.2rem; padding: 0 .4rem; border-radius: 3px; text-align: center;
          font: 600 .75rem/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; }
.result.passed { background: #e3f4e8; color: #1d6b35; }
.result.failed { background: #fbe5e5; color: #a3201f; }
.result.skipped { background: var(--panel); color: var(--quiet); }
pre.failure { background: #fdf2f2; white-space: pre-wrap; padding: .5rem; margin: .25rem 0 0; border-radius: 4px; }
td.time { white-space: nowrap; }
td.suite { min-width: 12rem; overflow-wrap: normal; }
td.suite code { overflow-wrap: normal; }
ul.tree { list-style: none; margin: .1rem 0; padding-left: 1.2rem; }
ul.tree.top { padding-left: 0; }
ul.tree li { margin: .15rem 0; }
ul.tree summary { cursor: pointer; }
.counts { color: var(--quiet); font-size: .85rem; margin-left: .4rem; }
.counts .failed { color: #a3201f; font-weight: 600; }
.case .time { color: var(--quiet); font-size: .8rem; margin-left: .4rem; white-space: nowrap; }
`;

/** A path that may wrap after a slash, never inside a name. */
const atSlashes = (path: string): Html =>
  markup`${path.split("/").map((part, at) => markup`${at === 0 ? "" : markup`/<wbr>`}${part}`)}`;

const encoder = new TextEncoder();

const count = (cases: readonly TestCase[], result: Result): number =>
  cases.filter((one) => one.result === result).length;

function seconds(time: number | undefined): string {
  if (time === undefined) return "";
  return time < 1 ? `${Math.round(time * 1000)} ms` : `${time.toFixed(2)} s`;
}

const shown = (message: string): string =>
  message.length > FAILURE_SHOWN
    ? `${message.slice(0, FAILURE_SHOWN)}…`
    : message;

const before = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function ordered(cases: readonly TestCase[]): TestCase[] {
  return [...cases].sort(
    (a, b) =>
      ORDER[a.result] - ORDER[b.result] ||
      before(a.suite, b.suite) ||
      before(a.name, b.name),
  );
}

function runLine(suite: Suite, run: TestRun): Html {
  return markup`<a href="${run.url}">The run</a> of commit <a href="${suite.repository}/commit/${run.commit}"><code>${run.commit.slice(0, 7)}</code></a>, run at <time datetime="${run.at}">${run.at}</time>`;
}

function table(cases: readonly TestCase[]): Html {
  return markup`<table>
<thead><tr><th>suite</th><th>case</th><th>result</th><th>time</th></tr></thead>
<tbody>
${ordered(cases).map(({ suite, name, result, seconds: time, message }) => markup`<tr><td class="suite" data-label="suite"><code>${atSlashes(suite)}</code></td><td data-label="case">${name}${message === undefined ? "" : markup`<pre class="failure">${shown(message)}</pre>`}</td><td data-label="result"><span class="result ${result}">${result}</span></td><td class="time" data-label="time">${seconds(time)}</td></tr>\n`)}</tbody>
</table>`;
}

/** A level of the tree: a package, a file or a describe, holding levels and cases in the order the report gave them. */
interface Level {
  readonly name: string;
  readonly depth: number;
  readonly levels: Map<string, Level>;
  readonly entries: (Level | TestCase)[];
  readonly cases: TestCase[];
  /** Whether a case under it failed, and the first line any case under it is written on; kept as cases are added. */
  failing: boolean;
  firstLine: number;
}

const isLevel = (entry: Level | TestCase): entry is Level => "levels" in entry;

/** A node:test case's file, as its package and its path under that package's `test/`. */
function placeOf(file: string): string[] {
  const found = /^packages\/([^/]+)\/test\/(.+)$/.exec(file);
  return found === null ? ["", file] : [found[1] ?? "", found[2] ?? ""];
}

function levelOf(name: string, depth: number): Level {
  return {
    name,
    depth,
    levels: new Map(),
    entries: [],
    cases: [],
    failing: false,
    firstLine: Infinity,
  };
}

function grow(cases: readonly TestCase[]): Level {
  const root = levelOf("", 0);
  for (const one of cases) {
    let at = root;
    at.cases.push(one);
    for (const name of [...placeOf(one.suite), ...one.describes]) {
      let next = at.levels.get(name);
      if (next === undefined) {
        next = levelOf(name, at.depth + 1);
        at.levels.set(name, next);
        at.entries.push(next);
      }
      next.cases.push(one);
      next.failing ||= one.result === "failed";
      next.firstLine = Math.min(next.firstLine, one.line ?? Infinity);
      at = next;
    }
    at.entries.push(one);
  }
  return root;
}

const failing = (entry: Level | TestCase): boolean =>
  isLevel(entry) ? entry.failing : entry.result === "failed";

const firstLine = (entry: Level | TestCase): number =>
  isLevel(entry) ? entry.firstLine : (entry.line ?? Infinity);

/**
 * A level's entries, failures first. Packages and files then go by name; describes and cases by the line they are written
 * on, so a file reads in the order its author wrote it, and in the report's order where no line is given.
 */
function inOrder(level: Level): (Level | TestCase)[] {
  const byName = level.depth < 2;
  return level.entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        Number(failing(b.entry)) - Number(failing(a.entry)) ||
        (byName && isLevel(a.entry) && isLevel(b.entry)
          ? before(a.entry.name, b.entry.name)
          : firstLine(a.entry) - firstLine(b.entry) || 0) ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);
}

function counts(cases: readonly TestCase[]): Html {
  const failed = count(cases, "failed");
  const skipped = count(cases, "skipped");
  return markup`<span class="counts">${count(cases, "passed")} passed${failed === 0 ? "" : markup`, <span class="failed">${failed} failed</span>`}${skipped === 0 ? "" : `, ${skipped} skipped`}</span>`;
}

function leaf(one: TestCase, suite: Suite, run: TestRun): Html {
  const source = `${suite.repository}/blob/${run.commit}/${one.suite}${one.line === undefined ? "" : `#L${one.line}`}`;
  return markup`<li class="case"><span class="result ${one.result}">${one.result}</span> <a href="${source}">${one.name}</a><span class="time">${seconds(one.seconds)}</span>${one.message === undefined ? "" : markup`<pre class="failure">${shown(one.message)}</pre>`}</li>\n`;
}

function branch(level: Level, suite: Suite, run: TestRun): Html {
  const children = inOrder(level).map((entry) =>
    isLevel(entry) ? branch(entry, suite, run) : leaf(entry, suite, run),
  );
  if (level.depth === 0) return markup`<ul class="tree top">\n${children}</ul>`;
  const name =
    level.depth <= 2 ? markup`<code>${level.name}</code>` : level.name;
  const open = level.depth === 1 || failing(level) ? " open" : "";
  return markup`<li><details${new Html(open)}><summary>${name} ${counts(level.cases)}</summary>
<ul class="tree">
${children}</ul></details></li>\n`;
}

/** A suite's results as CTRF (https://ctrf.io), each case with the describes it sits in as its suite. */
function ctrf(
  suite: Suite,
  run: TestRun,
  cases: readonly TestCase[],
  report: string,
  failedOutside: number,
): unknown {
  const start = Date.parse(run.at);
  const duration =
    declaredDuration(report) ??
    cases.reduce((sum, one) => sum + (one.seconds ?? 0) * 1000, 0);
  return {
    reportFormat: "CTRF",
    specVersion: "0.2.0",
    timestamp: run.at,
    generatedBy: "cascade-runtime-js packages/site",
    results: {
      tool: { name: suite.tool },
      summary: {
        tests: cases.length,
        passed: count(cases, "passed"),
        failed: count(cases, "failed") + failedOutside,
        skipped: count(cases, "skipped"),
        pending: 0,
        other: 0,
        start: Number.isNaN(start) ? 0 : start,
        stop: Number.isNaN(start) ? 0 : start + Math.round(duration),
      },
      tests: cases.map((one) => {
        const names = suite.tree ? one.describes : [one.suite];
        return {
          name: one.name,
          status: one.result,
          duration: Math.round((one.seconds ?? 0) * 1000),
          ...(names.length === 0 ? {} : { suite: [...names] }),
          ...(suite.tree ? { filePath: one.suite } : {}),
          ...(one.line === undefined ? {} : { line: one.line }),
          ...(one.message === undefined ? {} : { message: one.message }),
        };
      }),
      environment: {
        repositoryUrl: suite.repository,
        commit: run.commit,
        buildUrl: run.url,
        branchName: "main",
      },
    },
  };
}

interface Part {
  readonly html: Html;
  /** The suite's CTRF, when its report could be read. */
  readonly ctrf?: unknown;
}

function part(suite: Suite, run: TestRun | undefined): Part {
  const heading = markup`<h2 class="part" id="${suite.key}">${suite.title}</h2>`;
  if (run === undefined)
    return {
      html: markup`${heading}
<p class="prose">Not available: this build was given no report of the newest run of the ${suite.key}'s tests on <code>main</code>.</p>
`,
    };
  let cases: TestCase[];
  let failingSuites: number;
  try {
    ({ cases, failingSuites } = readJunit(run.report));
  } catch (error) {
    return {
      html: markup`${heading}
<p class="prose">${runLine(suite, run)}.</p>
<p class="prose">Not available: the report of that run cannot be read (${error instanceof Error ? error.message : String(error)}).</p>
`,
    };
  }
  const failed = count(cases, "failed");
  const counted = declaredFailures(run.report);
  // failingSuites includes describe suites holding a failed case, which node does not count in its failures; the threshold stays so that it never alarms falsely.
  const hidden = counted !== undefined && counted > failed + failingSuites;
  const unlisted =
    counted !== undefined && hidden
      ? markup`<p class="prose"><strong>Failed outside the cases below:</strong> node counts ${counted} ${counted === 1 ? "failure" : "failures"} but the report lists ${failed} failed ${failed === 1 ? "case" : "cases"}${failingSuites === 0 ? "" : markup` and ${failingSuites} ${failingSuites === 1 ? "test" : "tests"} holding them`}. A test with subtests or a hook that failed is left out of the report; <a href="${run.url}">the run's log</a> names it.</p>
`
      : "";
  const shownCases =
    cases.length === 0
      ? ""
      : suite.tree
        ? branch(grow(cases), suite, run)
        : table(cases);
  return {
    html: markup`${heading}
<p class="prose">${runLine(suite, run)}. ${cases.length} ${cases.length === 1 ? "case" : "cases"}: ${count(cases, "passed")} passed, ${failed} failed, ${count(cases, "skipped")} skipped. <span class="about">${suite.about}.</span> For an agent: <a href="${suite.key}.ctrf.json"><code>${suite.key}.ctrf.json</code></a>.</p>
${unlisted}${shownCases}`,
    ctrf: ctrf(
      suite,
      run,
      cases,
      run.report,
      counted !== undefined && hidden ? counted - failed : 0,
    ),
  };
}

/**
 * The newest run on `main` of the runtime's tests and the vocabulary's pytest, case by case, under `conformance/tests/`:
 * the runtime's as a tree of package, file and describe, each case linked to its line at the commit run; the vocabulary's
 * as one table. Each suite's results are also written as CTRF beside the page, for an agent.
 * A suite whose report was not fetched, or cannot be read, says so and the page is written all the same.
 */
export const testsSection: Section<TestsContext> = {
  path: TESTS_PAGE,
  title: "Unit test reports",
  want: "conformance",
  about:
    "the newest run on main of the runtime's tests and the vocabulary's pytest, case by case.",
  source:
    "the JUnit reports of the newest runs on main of cascade-runtime-js and cascade-vocabulary",
  async build(ctx) {
    const reports = await ctx.tests();
    const parts = SUITES.map((suite) => ({
      suite,
      ...part(suite, reports[suite.key]),
    }));
    const written = parts.filter((one) => one.ctrf !== undefined);
    return new Map([
      [
        TESTS_PAGE,
        encoder.encode(
          markup`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cascade unit test reports</title>
<link rel="stylesheet" href="../../${STYLESHEET_FILE}">
<style>${new Html(STYLES)}</style>
</head>
<body>
<nav>
${frontPageLink(2)}
<a href="../index.html">Conformance results</a></nav>
<main>
<h1>Cascade unit test reports</h1>
<p class="prose">The newest run on <code>main</code> of the runtime's tests and of the vocabulary's. The runtime's read as
a tree of package, file and describe, each case linked to its source; the vocabulary's as one table. Failures come first,
and the levels that hold one are open.</p>
${parts.map(({ html }) => html)}</main>
</body>
</html>
`.text,
        ),
      ],
      ...written.map(
        ({ suite, ctrf: results }) =>
          [
            ctrfFile(suite.key),
            encoder.encode(`${JSON.stringify(results, null, 2)}\n`),
          ] as const,
      ),
    ]);
  },
  async rows() {
    return [
      {
        href: TESTS_FOLDER,
        label: "Unit test reports",
        about:
          "the newest run on main of the runtime's tests and the vocabulary's pytest, case by case.",
      },
    ];
  },
};
