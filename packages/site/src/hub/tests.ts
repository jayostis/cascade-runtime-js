import { Html, markup } from "../html.js";
import {
  declaredFailures,
  parseJunit,
  type Result,
  type TestCase,
} from "../junit.js";
import type { Section } from "../sections.js";
import { STYLESHEET_FILE } from "../site.js";
import type { PagesContext, TestRun } from "./context.js";

export const TESTS_PAGE = "conformance/tests/index.html";

/** What the section reads of the context. */
export type TestsContext = Pick<PagesContext, "tests">;

interface Suite {
  readonly key: "runtime" | "vocabulary";
  readonly title: string;
  readonly repository: string;
  readonly about: string;
}

const SUITES: readonly Suite[] = [
  {
    key: "runtime",
    title: "The runtime's tests",
    repository: "https://github.com/jayostis/cascade-runtime-js",
    about: "npm test, node:test over every package",
  },
  {
    key: "vocabulary",
    title: "The vocabulary's tests",
    repository: "https://github.com/jayostis/cascade-vocabulary",
    about: "pytest over the shapes, queries, kits and features",
  },
];

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
`;

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

function ordered(cases: readonly TestCase[]): TestCase[] {
  const before = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
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
${ordered(cases).map(({ suite, name, result, seconds: time, message }) => markup`<tr><td data-label="suite"><code>${suite}</code></td><td data-label="case">${name}${message === undefined ? "" : markup`<pre class="failure">${shown(message)}</pre>`}</td><td data-label="result"><span class="result ${result}">${result}</span></td><td class="time" data-label="time">${seconds(time)}</td></tr>\n`)}</tbody>
</table>`;
}

function part(suite: Suite, run: TestRun | undefined): Html {
  const heading = markup`<h2 class="part" id="${suite.key}">${suite.title}</h2>`;
  if (run === undefined)
    return markup`${heading}
<p class="prose">Not available: this build was given no report of the newest run of the ${suite.key}'s tests on <code>main</code>.</p>
`;
  let cases: TestCase[];
  try {
    cases = parseJunit(run.report);
  } catch (error) {
    return markup`${heading}
<p class="prose">${runLine(suite, run)}.</p>
<p class="prose">Not available: the report of that run cannot be read (${error instanceof Error ? error.message : String(error)}).</p>
`;
  }
  const failed = count(cases, "failed");
  const counted = declaredFailures(run.report);
  const unlisted =
    counted !== undefined && counted > failed
      ? markup`<p class="prose"><strong>Failed outside the cases below:</strong> node counts ${counted} ${counted === 1 ? "failure" : "failures"} but the report lists ${failed} failed ${failed === 1 ? "case" : "cases"}. A test with subtests or a hook that failed is left out of the report; <a href="${run.url}">the run's log</a> names it.</p>
`
      : "";
  return markup`${heading}
<p class="prose">${runLine(suite, run)}. ${cases.length} ${cases.length === 1 ? "case" : "cases"}: ${count(cases, "passed")} passed, ${failed} failed, ${count(cases, "skipped")} skipped. <span class="about">${suite.about}.</span></p>
${unlisted}${cases.length === 0 ? "" : table(cases)}`;
}

/**
 * The newest run on `main` of the runtime's tests and the vocabulary's pytest, case by case, under `conformance/tests/`.
 * A suite whose report was not fetched, or cannot be read, says so and the page is written all the same.
 */
export const testsSection: Section<TestsContext> = {
  path: TESTS_PAGE,
  title: "Unit test reports",
  kind: "explore",
  about:
    "the newest run on main of the runtime's tests and the vocabulary's pytest, case by case.",
  source:
    "the JUnit reports of the newest runs on main of cascade-runtime-js and cascade-vocabulary",
  async build(ctx) {
    const reports = await ctx.tests();
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
<main>
<p class="about"><a href="../index.html">Conformance results</a></p>
<h1>Cascade unit test reports</h1>
<p class="prose">The newest run on <code>main</code> of the runtime's tests and of the vocabulary's, each case with its result
and time. Failed cases come first, then every case by file and name.</p>
${SUITES.map((suite) => part(suite, reports[suite.key]))}</main>
</body>
</html>
`.text,
        ),
      ],
    ]);
  },
  async rows() {
    return [];
  },
};
