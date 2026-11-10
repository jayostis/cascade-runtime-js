import { Html, markup } from "../html.js";
import { frontPageLink, pageNameOf, ruleHref } from "../links.js";
import {
  declaredDuration,
  declaredFailures,
  readJunit,
  type Described,
  type PackageInfo,
  type Result,
  type TestCase,
} from "../junit.js";
import type { Section } from "../sections.js";
import { STYLESHEET_FILE } from "../site.js";
import {
  ctrfEntry,
  glossaryList,
  glossaryOf,
  type Entry,
  Links,
} from "./glossary.js";
import type { PagesContext, TestRun } from "./context.js";
import { SPEC_FOLDER } from "./spec.js";

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
h3.package { margin: 1.4rem 0 .2rem; }
.package-line { color: var(--quiet); margin: .1rem 0; }
.glossary { margin: .4rem 0; }
.glossary > summary { cursor: pointer; font-weight: 600; }
.glossary dl { margin: .3rem 0; columns: 24rem; }
.glossary dt { font-weight: 600; margin-top: .3rem; break-after: avoid; }
.glossary dd { margin: 0 0 .2rem 1rem; max-width: 70ch; }
.glossary .aliases { font-weight: 400; color: var(--quiet); }
.glossary dt:target { background: var(--panel); }
.what { margin: .3rem 0; max-width: 70ch; }
.source, .said { color: var(--quiet); font-size: .85rem; margin: .2rem 0; }
.said .what { color: inherit; }
details.build { margin-top: 1.4rem; }
details.build > summary { font-weight: 600; }
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

/** The `spec.json` of a package's tests: what its page says first, the order of its capabilities, and what is build. */
interface Spec {
  readonly about?: string;
  readonly capabilities: readonly string[];
  readonly build: readonly string[];
  /** Terms the package's tests use in one sense, defined once on its page. */
  readonly glossary: readonly Entry[];
}

function specOf(raw: unknown, folder: string): Spec {
  const given = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const names = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((one): one is string => typeof one === "string")
      : [];
  return {
    ...(typeof given["about"] === "string" ? { about: given["about"] } : {}),
    capabilities: names(given["capabilities"]),
    build: names(given["build"]),
    glossary: glossaryOf(given["glossary"], folder),
  };
}

/** A describe or a capability, holding levels and cases in the order the report gave them. */
interface Level {
  readonly name: string;
  info?: Described;
  readonly levels: Map<string, Level>;
  readonly entries: (Level | TestCase)[];
  readonly cases: TestCase[];
  /** Whether a case under it failed, and the position of the first case written under it; kept as cases are added. */
  failing: boolean;
  first: string;
}

const isLevel = (entry: Level | TestCase): entry is Level => "levels" in entry;

/** A node:test case's file, as its package and its path under that package's `test/`. */
function placeOf(file: string): string[] {
  const found = /^packages\/([^/]+)\/test\/(.+)$/.exec(file);
  return found === null ? ["", file] : [found[1] ?? "", found[2] ?? ""];
}

/** Where a case is written, as a string that sorts in the order of a file and then its lines. */
const positionOf = (one: TestCase): string =>
  `${one.suite}\0${one.line === undefined ? "~" : String(one.line).padStart(8, "0")}`;

function merged(
  a: Described | undefined,
  b: Described | undefined,
): Described | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const description = a.description ?? b.description;
  const line = a.line ?? b.line;
  return {
    ...(description === undefined ? {} : { description }),
    rules: [...new Set([...a.rules, ...b.rules])],
    ...(line === undefined ? {} : { line }),
  };
}

function levelOf(name: string): Level {
  return {
    name,
    levels: new Map(),
    entries: [],
    cases: [],
    failing: false,
    first: "￿",
  };
}

/** The describes of `cases` from the `skip`th down, as levels; a case with none further down sits directly in the root. */
function levelsFrom(cases: readonly TestCase[], skip: number): Level {
  const root = levelOf("");
  for (const one of cases) {
    let at = root;
    const position = positionOf(one);
    for (const [index, name] of one.describes.entries()) {
      if (index < skip) continue;
      let next = at.levels.get(name);
      if (next === undefined) {
        next = levelOf(name);
        at.levels.set(name, next);
        at.entries.push(next);
      }
      const info = merged(next.info, one.described[index]);
      if (info !== undefined) next.info = info;
      next.cases.push(one);
      next.failing ||= one.result === "failed";
      if (position < next.first) next.first = position;
      at = next;
    }
    at.entries.push(one);
  }
  return root;
}

const failing = (entry: Level | TestCase): boolean =>
  isLevel(entry) ? entry.failing : entry.result === "failed";

const firstOf = (entry: Level | TestCase): string =>
  isLevel(entry) ? entry.first : positionOf(entry);

/** A level's entries, failures first, then in the order they are written. */
function inOrder(level: Level): (Level | TestCase)[] {
  return level.entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        Number(failing(b.entry)) - Number(failing(a.entry)) ||
        before(firstOf(a.entry), firstOf(b.entry)) ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);
}

function counts(cases: readonly TestCase[]): Html {
  const failed = count(cases, "failed");
  const skipped = count(cases, "skipped");
  return markup`<span class="counts">${count(cases, "passed")} passed${failed === 0 ? "" : markup`, <span class="failed">${failed} failed</span>`}${skipped === 0 ? "" : `, ${skipped} skipped`}</span>`;
}

/** A rule tag, `<feature> <id>`, as the rule on the conformance pages it names. */
function ruleOf(tag: string): { feature: string; id: string; href: string } {
  const [feature = "", ...rest] = tag.split(" ");
  const id = rest.join(" ");
  const path = feature.includes("/")
    ? feature
    : `runtime/${feature.replace(/\.feature$/, "")}.feature`;
  const base = `../../${SPEC_FOLDER}`;
  return {
    feature,
    id,
    href: id === "" ? `${base}${pageNameOf(path)}` : ruleHref(path, id, base),
  };
}

function prose(description: string | undefined, links: Links): Html {
  const paragraphs = (description ?? "")
    .split("\n\n")
    .filter((one) => one !== "");
  return markup`${paragraphs.map((one) => markup`<p class="what">${links.link(one)}</p>\n`)}`;
}

function rulesOf(tags: readonly string[]): Html {
  const rules = tags.map(ruleOf);
  return rules.length === 0
    ? markup``
    : markup`<span class="rules">Rule${rules.length === 1 ? "" : "s"}: ${rules.map(({ feature, id, href }, at) => markup`${at === 0 ? "" : ", "}<a href="${href}">${feature} ${id}</a>`)}.</span> `;
}

/** A case's name linked to its source; a glossary term in it links to its entry, the source link stopping short of it. */
function named(name: string, source: string, links: Links): Html {
  return markup`${links.pieces(name).map((piece) => (typeof piece === "string" ? markup`<a href="${source}">${piece}</a>` : markup`<a href="#${piece.id}">${piece.text}</a>`))}`;
}

function leaf(one: TestCase, suite: Suite, run: TestRun, links: Links): Html {
  const source = `${suite.repository}/blob/${run.commit}/${one.suite}${one.line === undefined ? "" : `#L${one.line}`}`;
  const said =
    one.description === undefined && one.rules.length === 0
      ? ""
      : markup`<div class="said">${prose(one.description, links)}${rulesOf(one.rules)}</div>`;
  return markup`<li class="case"><span class="result ${one.result}">${one.result}</span> ${named(one.name, source, links)}<span class="time">${seconds(one.seconds)}</span>${said}${one.message === undefined ? "" : markup`<pre class="failure">${shown(one.message)}</pre>`}</li>\n`;
}

/** A situation, or a level under one: its description, its rules and what it holds. */
function branch(level: Level, suite: Suite, run: TestRun, links: Links): Html {
  const name = links.link(level.name);
  const said = prose(level.info?.description, links);
  const children = inOrder(level).map((entry) =>
    isLevel(entry)
      ? branch(entry, suite, run, links)
      : leaf(entry, suite, run, links),
  );
  return markup`<li><details${new Html(failing(level) ? " open" : "")}><summary>${name} ${counts(level.cases)}</summary>
${said}${rulesOf(level.info?.rules ?? [])}<ul class="tree">
${children}</ul></details></li>\n`;
}

/** What a package's tests do for the app developer: a top-level describe, gathered across the files that hold one. */
interface Capability {
  readonly name: string;
  readonly level: Level;
  readonly info?: Described;
  /** Each file it comes from, with the line its describe starts on there. */
  readonly files: Map<string, number | undefined>;
  readonly cases: TestCase[];
}

function capabilitiesOf(cases: readonly TestCase[]): Capability[] {
  const groups = new Map<string, TestCase[]>();
  for (const one of cases) {
    const name = one.describes[0] ?? placeOf(one.suite)[1] ?? one.suite;
    groups.set(name, [...(groups.get(name) ?? []), one]);
  }
  return [...groups].map(([name, held]) => {
    const files = new Map<string, number | undefined>();
    let info: Described | undefined;
    for (const one of held) {
      const line = one.described[0]?.line;
      const known = files.get(one.suite);
      files.set(
        one.suite,
        known === undefined || (line !== undefined && line < known)
          ? line
          : known,
      );
      info = merged(info, one.described[0]);
    }
    return {
      name,
      level: levelsFrom(held, 1),
      ...(info === undefined ? {} : { info }),
      files,
      cases: held,
    };
  });
}

function capability(
  one: Capability,
  suite: Suite,
  run: TestRun,
  glossary: readonly Entry[],
): Html {
  const links = new Links(glossary);
  const said = prose(one.info?.description, links);
  const children = inOrder(one.level).map((entry) =>
    isLevel(entry)
      ? branch(entry, suite, run, links)
      : leaf(entry, suite, run, links),
  );
  const files = [...one.files].map(([file, line]) => {
    const href = `${suite.repository}/blob/${run.commit}/${file}${line === undefined ? "" : `#L${line}`}`;
    return markup`<a href="${href}">${placeOf(file)[1] ?? file}</a>`;
  });
  return markup`<li class="capability"><details open><summary>${one.name} ${counts(one.cases)}</summary>
${said}<p class="source">${rulesOf(one.info?.rules ?? [])}From ${files.map((link, at) => markup`${at === 0 ? "" : ", "}${link}`)}.</p>
<ul class="tree">
${children}</ul></details></li>\n`;
}

const unreleased = (version: string): boolean =>
  version === "0.0.0" || version.includes("-");

const rankIn = (order: readonly string[], name: string): number => {
  const at = order.indexOf(name);
  return at === -1 ? Infinity : at;
};

/** Capabilities in the order a spec lists them, the unlisted after them by name. */
const arranged = (
  list: readonly Capability[],
  order: readonly string[],
): Capability[] =>
  [...list].sort((a, b) => {
    const [x, y] = [rankIn(order, a.name), rankIn(order, b.name)];
    return x === y ? before(a.name, b.name) : x < y ? -1 : 1;
  });

function packageSection(
  folder: string,
  cases: readonly TestCase[],
  info: PackageInfo | undefined,
  suite: Suite,
  run: TestRun,
): Html {
  const spec = specOf(info?.spec, folder);
  const all = capabilitiesOf(cases);
  const inBuild = (one: Capability): boolean =>
    spec.build.includes(one.name) ||
    [...one.files.keys()].every((file) =>
      spec.build.includes(placeOf(file)[1] ?? file),
    );
  const main = arranged(
    all.filter((one) => !inBuild(one)),
    spec.capabilities,
  );
  const build = arranged(all.filter(inBuild), spec.build);
  const buildCases = build.flatMap((one) => one.cases);
  const line =
    info === undefined
      ? ""
      : markup`<p class="package-line"><code>${info.name}</code> ${info.version} · commit <a href="${suite.repository}/commit/${run.commit}"><code>${run.commit.slice(0, 7)}</code></a>${unreleased(info.version) ? " · unreleased: what main does today, not a compatibility promise" : ""}</p>\n`;
  return markup`<h3 class="package"><code>${folder}</code> ${counts(cases)}</h3>
${line}${spec.about === undefined ? "" : markup`<p class="what">${spec.about}</p>\n`}${spec.glossary.length === 0 ? "" : glossaryList(spec.glossary)}<ul class="tree top">
${main.map((one) => capability(one, suite, run, spec.glossary))}</ul>
${
  build.length === 0
    ? ""
    : markup`<details class="build"${new Html(count(buildCases, "failed") > 0 ? " open" : "")}><summary>Build and packaging ${counts(buildCases)}</summary>
<ul class="tree top">
${build.map((one) => capability(one, suite, run, spec.glossary))}</ul></details>
`
}`;
}

/** The runtime's cases as the page reads them: each package, with its capabilities in the order its spec gives. */
function tree(
  cases: readonly TestCase[],
  packages: ReadonlyMap<string, PackageInfo>,
  suite: Suite,
  run: TestRun,
): Html {
  const byPackage = new Map<string, TestCase[]>();
  for (const one of cases) {
    const folder = placeOf(one.suite)[0] ?? "";
    byPackage.set(folder, [...(byPackage.get(folder) ?? []), one]);
  }
  const order = [...byPackage].sort(
    ([a, held], [b, other]) =>
      Number(other.some((c) => c.result === "failed")) -
        Number(held.some((c) => c.result === "failed")) || before(a, b),
  );
  return markup`${order.map(([folder, held]) => packageSection(folder, held, packages.get(folder), suite, run))}`;
}

/** What each level above a case, and the case, say of themselves, with their rules as links, for an agent reading CTRF. */
function extraOf(one: TestCase): { extra?: unknown } {
  const levels = one.describes.map((name, at) => {
    const info = one.described[at];
    return {
      name,
      ...(info?.description === undefined
        ? {}
        : { description: info.description }),
      ...(info === undefined || info.rules.length === 0
        ? {}
        : { rules: info.rules.map(ruleOf) }),
    };
  });
  const rules = one.rules.map(ruleOf);
  const extra = {
    ...(levels.length === 0 ? {} : { levels }),
    ...(one.description === undefined ? {} : { description: one.description }),
    ...(rules.length === 0 ? {} : { rules }),
  };
  return Object.keys(extra).length === 0 ? {} : { extra };
}

/** The glossary of each package that has one, for an agent reading CTRF. */
function extraOfGlossaries(
  suite: Suite,
  packages: ReadonlyMap<string, PackageInfo>,
): { extra?: unknown } {
  if (!suite.tree) return {};
  const glossary: Record<string, unknown[]> = {};
  for (const [folder, info] of packages) {
    const entries = specOf(info.spec, folder).glossary;
    if (entries.length > 0) glossary[folder] = entries.map(ctrfEntry);
  }
  return Object.keys(glossary).length === 0 ? {} : { extra: { glossary } };
}

/** A suite's results as CTRF (https://ctrf.io), each case with the describes it sits in as its suite. */
function ctrf(
  suite: Suite,
  run: TestRun,
  cases: readonly TestCase[],
  report: string,
  failedOutside: number,
  packages: ReadonlyMap<string, PackageInfo>,
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
    ...extraOfGlossaries(suite, packages),
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
          ...(suite.tree ? extraOf(one) : {}),
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
  let packages: ReadonlyMap<string, PackageInfo>;
  try {
    ({ cases, failingSuites, packages } = readJunit(run.report));
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
        ? tree(cases, packages, suite, run)
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
      packages,
    ),
  };
}

/**
 * The newest run on `main` of the runtime's tests and the vocabulary's pytest, case by case, under `conformance/tests/`:
 * the runtime's as a tree of package, capability and situation, each case linked to its line at the commit run; the vocabulary's
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
a tree of package, capability and situation, each with what it is for and each case linked to its source; the vocabulary's as one table.
Failures come first within a capability, and the levels that hold one are open.</p>
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
