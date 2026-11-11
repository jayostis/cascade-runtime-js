import { readCtrf } from "../ctrf.js";
import { Html, markup } from "../html.js";
import { frontPageLink, pageNameOf, ruleHref } from "../links.js";
import {
  declaredDuration,
  declaredFailures,
  readJunit,
  type Described,
  type JunitReport,
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
import type { PagesContext, Suite, TestRun } from "./context.js";
import { SPEC_FOLDER } from "./spec.js";

export const TESTS_FOLDER = "conformance/tests/";

/** What the section reads of the context. */
export type TestsContext = Pick<PagesContext, "tests">;

/** A suite's repository's name, which names its page's folder and its CTRF file. */
export const nameOf = (suite: Suite): string =>
  suite.repository.slice(suite.repository.indexOf("/") + 1);

/** A suite's page: one per repository, with no index above them. */
export const testsPageOf = (suite: Suite): string =>
  `${TESTS_FOLDER}${nameOf(suite)}/index.html`;

/** Where an agent reads a suite's results: CTRF, beside its page. */
const ctrfFileOf = (suite: Suite): string => `${nameOf(suite)}.ctrf.json`;

/** The hub's own repository's page, which the section always writes. */
const RUNTIME_NAME = "cascade-runtime-js";
const OWN_PAGE = `${TESTS_FOLDER}${RUNTIME_NAME}/index.html`;

const RUNNERS: readonly Suite["runner"][] = [
  "node:test",
  "pytest",
  "vitest",
  "nextest",
  "ctrf",
];

/** The suites of `packages/site/test-suites.json`; throws, naming it, at an entry missing a field or naming no known runner. */
export function suitesOf(raw: unknown): Suite[] {
  if (!Array.isArray(raw)) throw new Error("the suite list is not a list");
  return raw.map((entry: unknown, at) => {
    const given = (
      typeof entry === "object" && entry !== null ? entry : {}
    ) as Record<string, unknown>;
    const text = (key: string): string => {
      const value = given[key];
      if (typeof value !== "string" || value === "")
        throw new Error(`suite ${at + 1} of the list names no ${key}`);
      return value;
    };
    const runner = text("runner");
    if (!RUNNERS.includes(runner as Suite["runner"]))
      throw new Error(
        `suite ${at + 1} of the list names the runner ${runner}, which is not one of ${RUNNERS.join(", ")}`,
      );
    const repository = text("repository");
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository))
      throw new Error(
        `suite ${at + 1} of the list names the repository ${repository}, which is not owner/name`,
      );
    const tests = given["tests"];
    if (
      tests !== undefined &&
      (typeof tests !== "string" || !tests.endsWith("/"))
    )
      throw new Error(
        `suite ${at + 1} of the list names the tests ${String(tests)}, which is not a folder ending in /`,
      );
    const packages = given["packages"];
    if (
      packages !== undefined &&
      (!Array.isArray(packages) ||
        !packages.every((name) => typeof name === "string" && name !== ""))
    )
      throw new Error(
        `suite ${at + 1} of the list names the packages ${JSON.stringify(packages)}, which is not a list of package names`,
      );
    return {
      repository,
      ...(tests === undefined ? {} : { tests }),
      ...(packages === undefined ? {} : { packages: packages as string[] }),
      title: text("title"),
      about: text("about"),
      workflow: text("workflow"),
      artifact: text("artifact"),
      report: text("report"),
      runner: runner as Suite["runner"],
    };
  });
}

const repositoryUrl = (suite: Suite): string =>
  `https://github.com/${suite.repository}`;

/** A suite's title inside a sentence: "the runtime's tests". */
const titleInSentence = (suite: Suite): string =>
  suite.title.replace(/^The /, "the ");

const FAILURE_SHOWN = 400;

const STYLES = `
:root { --ok: #14672d; --ok-bg: #e1f3e6; --bad: #a3201f; --bad-bg: #fbe5e5; --mono: ui-monospace, SFMono-Regular, Consolas, monospace; }
@media (prefers-color-scheme: dark) {
  :root { --ok: #86e3a4; --ok-bg: #16351f; --bad: #ffa8a4; --bad-bg: #431a1a; }
}
[hidden] { display: none !important; }
button:focus-visible, summary:focus-visible, input:focus-visible, a:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
.result { display: inline-flex; align-items: center; gap: .3rem; font: 600 .8rem/1.4 var(--mono); white-space: nowrap; }
.result .icon, .badge .icon { display: inline-grid; place-items: center; width: 1.3rem; height: 1.3rem; border-radius: 50%;
                              font-size: .8rem; line-height: 1; flex: none; }
.badge .icon { width: auto; height: auto; }
.result.passed .icon { background: var(--ok-bg); color: var(--ok); }
.result.skipped .icon { background: var(--panel); color: var(--quiet); border: 1px solid var(--rule); }
.result.failed { background: var(--bad-bg); color: var(--bad); border-radius: 999px; padding: 0 .55rem 0 .1rem; }
.result.passed .label, .result.skipped .label { position: absolute; width: 1px; height: 1px; overflow: hidden;
                                                 clip: rect(0 0 0 0); white-space: nowrap; }
.badge { display: inline-flex; align-items: center; gap: .25rem; padding: 0 .5rem; border-radius: 999px;
         font: 600 .75rem/1.5 var(--mono); white-space: nowrap; background: var(--panel); color: var(--quiet); }
.badge.passed { background: var(--ok-bg); color: var(--ok); }
.badge.failed { background: var(--bad-bg); color: var(--bad); }
.counts { display: inline-flex; flex-wrap: wrap; gap: .25rem; vertical-align: middle; }
.summary-bar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1rem;
               padding: .5rem .75rem; margin: .25rem 0 .75rem; background: var(--panel); border: 1px solid var(--rule);
               border-radius: 8px; }
.summary-bar .run { color: var(--quiet); font-size: .85rem; }
.summary-bar .run code { color: var(--text); }
.summary-bar .tag { border: 1px solid var(--rule); border-radius: 999px; padding: 0 .45rem; font-size: .75rem; }
.summary-bar .tallies { display: flex; flex-wrap: wrap; gap: .3rem; }
.summary-bar .duration { color: var(--quiet); font: .8rem/1.4 var(--mono); font-variant-numeric: tabular-nums; }
.controls { display: flex; flex-wrap: wrap; gap: .4rem; margin-left: auto; }
.controls button { font: 600 .8rem/1.4 system-ui, sans-serif; padding: .2rem .7rem; border-radius: 6px; cursor: pointer;
                   color: var(--text); background: var(--bg, #fff); border: 1px solid var(--rule); }
.controls button:hover { background: var(--line); }
.controls button[aria-pressed="true"] { background: var(--bad-bg); color: var(--bad); border-color: var(--bad); }
.failures-only [data-result="passed"], .failures-only [data-result="skipped"], .failures-only [data-failed="0"] { display: none; }
.no-failures { display: none; color: var(--ok); font-weight: 600; }
.failures-only .no-failures { display: block; }
pre.failure { background: var(--bad-bg); color: var(--text); border-left: 3px solid var(--bad); white-space: pre-wrap;
              padding: .5rem .75rem; margin: .35rem 0 0; border-radius: 4px; overflow-x: auto; }
.time { color: var(--quiet); font: .8rem/1.4 var(--mono); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
ul.tree { list-style: none; margin: .1rem 0 .1rem .55rem; padding: 0 0 0 .9rem; border-left: 1px solid var(--line); }
ul.tree.top { margin-left: 0; padding-left: 0; border-left: 0; }
ul.tree li { margin: .2rem 0; }
ul.tree summary, li.capability > details > summary { cursor: pointer; list-style: none; display: flex; flex-wrap: wrap;
                                                     align-items: baseline; gap: .1rem .5rem; color: var(--text); }
summary::-webkit-details-marker { display: none; }
ul.tree summary::before, details.build > summary::before, .glossary > summary::before {
  content: "\\25B8"; color: var(--quiet); display: inline-block; width: 1em; transition: transform .1s; }
details[open] > summary::before { transform: rotate(90deg); }
summary { list-style: none; }
dfn { font-style: normal; }
.level-name { font-weight: 600; }
li.case { display: grid; grid-template-columns: auto 1fr auto; align-items: baseline; column-gap: .5rem; }
li.case > .said, li.case > pre.failure, li.case > .skip-reason { grid-column: 2 / -1; }
.skip-reason { margin: 0; color: var(--quiet); font-size: .9em; overflow-wrap: anywhere; }
li.case .name { overflow-wrap: anywhere; }
li.capability { list-style: none; margin: .75rem 0; border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; }
li.capability > details { margin: 0; }
li.capability > details > summary { padding: .55rem .8rem; background: var(--panel); }
li.capability > details > :not(summary) { margin-left: .8rem; margin-right: .8rem; }
li.capability > details > ul.tree { margin: .4rem .8rem .6rem 1rem; }
.cap-name { font-size: 1.1rem; font-weight: 700; }
.api { font: .85rem/1.4 var(--mono); color: var(--quiet); overflow-wrap: anywhere; }
.what { margin: .3rem 0; max-width: 70ch; color: var(--quiet); }
.source, .said { color: var(--quiet); font-size: .85rem; margin: .3rem 0; }
.said .what { color: inherit; }
.rules { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: .25rem; margin-right: .6rem; }
.rules .label, .source .label { color: var(--quiet); font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; }
a.chip { display: inline-block; padding: 0 .5rem; border-radius: 999px; background: var(--panel); border: 1px solid var(--rule);
         font: .75rem/1.5 var(--mono); text-decoration: none; }
a.chip:hover, a.src:hover { text-decoration: underline; }
a.src { color: var(--quiet); font-size: .8rem; }
section.pkg { margin: 1.4rem 0 0; }
h3.package { margin: 0 0 .2rem; display: flex; flex-wrap: wrap; align-items: baseline; gap: .2rem .6rem; }
.package-line { color: var(--quiet); margin: .1rem 0; }
.glossary { margin: .6rem 0; border: 1px solid var(--rule); border-radius: 8px; padding: .5rem .8rem; }
.glossary > summary { font-weight: 600; color: var(--text); }
.glossary-filter { display: block; box-sizing: border-box; width: 100%; max-width: 22rem; margin: .5rem 0; padding: .3rem .6rem;
                   font: inherit; color: var(--text); background: var(--bg, #fff); border: 1px solid var(--rule); border-radius: 6px; }
.glossary dl { margin: .3rem 0; display: grid; grid-template-columns: minmax(8rem, 14rem) 1fr; gap: .3rem 1.2rem; font-size: .9rem; }
.glossary dt { font-weight: 600; }
.glossary dd { margin: 0; max-width: 70ch; overflow-wrap: anywhere; }
.glossary .aliases { font-weight: 400; color: var(--quiet); }
.glossary dt:target { background: var(--panel); }
.glossary .none-match { color: var(--quiet); }
details.build { margin-top: 1.4rem; }
details.build > summary { font-weight: 600; color: var(--text); }
@media (max-width: 40rem) {
  .glossary dl { grid-template-columns: 1fr; gap: 0; }
  .glossary dd { margin-bottom: .5rem; }
  .controls { margin-left: 0; }
  li.case { grid-template-columns: auto 1fr; }
  li.case > .time { grid-column: 2; text-align: left; }
  ul.tree { padding-left: .6rem; }
  li.capability > details > :not(summary) { margin-left: .5rem; margin-right: .5rem; }
  li.capability > details > ul.tree { margin: .4rem .5rem .6rem .6rem; }
}
`;

/** Wires the controls the markup carries hidden: without script they stay hidden and everything stays shown. */
const SCRIPT = `
document.querySelectorAll("[data-controls]").forEach(function (c) { c.hidden = false; });
document.addEventListener("click", function (event) {
  var button = event.target.closest && event.target.closest("button[data-action]");
  if (!button) return;
  var part = button.closest("[data-part]");
  var action = button.getAttribute("data-action");
  if (action === "expand-all" || action === "collapse-all")
    part.querySelectorAll("details:not(.glossary)").forEach(function (d) { d.open = action === "expand-all"; });
  if (action === "failures-only") {
    var on = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(on));
    part.classList.toggle("failures-only", on);
    if (on)
      part.querySelectorAll("[data-failed]:not([data-failed='0']) > details").forEach(function (d) { d.open = true; });
  }
});
document.querySelectorAll("input[data-glossary-filter]").forEach(function (input) {
  input.hidden = false;
  var box = input.closest("details");
  var empty = box.querySelector(".none-match");
  input.addEventListener("input", function () {
    var needle = input.value.trim().toLowerCase();
    var shown = 0;
    box.querySelectorAll("dt").forEach(function (dt) {
      var dd = dt.nextElementSibling;
      var hit = needle === "" || (dt.textContent + " " + dd.textContent).toLowerCase().indexOf(needle) !== -1;
      dt.hidden = dd.hidden = !hit;
      if (hit) shown++;
    });
    empty.hidden = shown !== 0;
  });
});
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

const before = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function runLine(suite: Suite, run: TestRun): Html {
  return markup`<a href="${run.url}">The run</a> of commit <a href="${repositoryUrl(suite)}/commit/${run.commit}"><code>${run.commit.slice(0, 7)}</code></a>, run at <time datetime="${run.at}">${run.at}</time>`;
}

const ICON: Readonly<Record<Result, string>> = {
  passed: "✓",
  failed: "✗",
  skipped: "○",
};

/** A result as a coloured icon with its word, which a passed or skipped case leaves to a reader who cannot see the icon. */
const status = (result: Result): Html =>
  markup`<span class="result ${result}"><span class="icon" aria-hidden="true">${ICON[result]}</span> <span class="label">${result}</span></span>`;

/** A count of cases with one result, as a pill. */
const badge = (result: Result, n: number): Html =>
  markup`<span class="badge ${result}" data-status="${result}" data-count="${String(n)}"><span class="icon" aria-hidden="true">${ICON[result]}</span> ${String(n)} ${result}</span>`;

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

/**
 * A case's file as its package and its path under that package's tests: a package of the runtime's `packages/`, or else
 * the whole repository (`""`), its path read under the test folder its suite names, or `test/` or `tests/`.
 */
function placeOf(file: string, suite: Suite): string[] {
  const found =
    suite.tests === undefined && nameOf(suite) === RUNTIME_NAME
      ? /^packages\/([^/]+)\/test\/(.+)$/.exec(file)
      : null;
  if (found !== null) return [found[1] ?? "", found[2] ?? ""];
  const folder = suite.tests;
  return [
    "",
    folder !== undefined && file.startsWith(folder)
      ? file.slice(folder.length)
      : file.replace(/^tests?\//, ""),
  ];
}

/** Where a case is written, as a string that sorts in the order of a file and then its lines. */
const positionOf = (one: TestCase): string =>
  `${one.file}\0${one.line === undefined ? "~" : String(one.line).padStart(8, "0")}`;

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
  return markup`<span class="counts">${badge("passed", count(cases, "passed"))}${failed === 0 ? "" : badge("failed", failed)}${skipped === 0 ? "" : badge("skipped", skipped)}</span>`;
}

/** A rule tag, `<feature> <id>`, as the rule on the conformance pages it names. */
function ruleOf(tag: string): { feature: string; id: string; href: string } {
  const [feature = "", ...rest] = tag.split(" ");
  const id = rest.join(" ");
  const path = feature.includes("/")
    ? feature
    : `runtime/${feature.replace(/\.feature$/, "")}.feature`;
  const base = `../../../${SPEC_FOLDER}`;
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
    : markup`<span class="rules"><span class="label">Rule${rules.length === 1 ? "" : "s"}</span> ${rules.map(({ feature, id, href }) => markup`<a class="chip" href="${href}">${feature} ${id}</a> `)}</span> `;
}

/** A case's name linked to its source; a glossary term in it links to its entry, the source link stopping short of it. */
function named(name: string, source: string, links: Links): Html {
  return markup`${links.pieces(name).map((piece) => (typeof piece === "string" ? markup`<a href="${source}">${piece}</a>` : markup`<a href="#${piece.id}">${piece.text}</a>`))}`;
}

function leaf(one: TestCase, suite: Suite, run: TestRun, links: Links): Html {
  const source = `${repositoryUrl(suite)}/blob/${run.commit}/${one.file}${one.line === undefined ? "" : `#L${one.line}`}`;
  const said =
    one.description === undefined && one.rules.length === 0
      ? ""
      : markup`<div class="said">${prose(one.description, links)}${rulesOf(one.rules)}</div>`;
  return markup`<li class="case" data-result="${one.result}">${status(one.result)} <span class="name">${named(one.name, source, links)}</span><span class="time">${seconds(one.seconds)}</span>${said}${one.message === undefined ? "" : one.result === "skipped" ? markup`<p class="skip-reason">${shown(one.message)}</p>` : markup`<pre class="failure">${shown(one.message)}</pre>`}</li>\n`;
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
  return markup`<li data-failed="${String(count(level.cases, "failed"))}"><details${new Html(failing(level) ? " open" : "")}><summary><span class="level-name">${name}</span> ${counts(level.cases)}</summary>
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

function capabilitiesOf(
  cases: readonly TestCase[],
  suite: Suite,
): Capability[] {
  const groups = new Map<string, TestCase[]>();
  for (const one of cases) {
    const name = one.describes[0] ?? placeOf(one.file, suite)[1] ?? one.file;
    groups.set(name, [...(groups.get(name) ?? []), one]);
  }
  return [...groups].map(([name, held]) => {
    const files = new Map<string, number | undefined>();
    let info: Described | undefined;
    for (const one of held) {
      const line = one.described[0]?.line;
      const known = files.get(one.file);
      files.set(
        one.file,
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

/** A capability's name, and the API names after its ` · `, which are code. */
function title(name: string): Html {
  const [main = name, ...api] = name.split(" · ");
  return markup`<span class="cap-name">${main}</span>${api.length === 0 ? "" : markup` <span class="api">${api.join(" · ")}</span>`}`;
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
    const href = `${repositoryUrl(suite)}/blob/${run.commit}/${file}${line === undefined ? "" : `#L${line}`}`;
    return markup`<a class="src" href="${href}">${placeOf(file, suite)[1] ?? file}</a>`;
  });
  return markup`<li class="capability" data-failed="${String(count(one.cases, "failed"))}"><details open><summary>${title(one.name)} ${counts(one.cases)}</summary>
${said}<p class="source">${rulesOf(one.info?.rules ?? [])}<span class="label">Source</span> ${files.map((link, at) => markup`${at === 0 ? "" : ", "}${link}`)}</p>
<ul class="tree">
${children}</ul></details></li>\n`;
}

const unreleased = (version: string): boolean =>
  version === "0.0.0" || version.includes("-");

/** Names in the order a list gives them, the unlisted after them by name. */
const byRank =
  (order: readonly string[]) =>
  (a: string, b: string): number => {
    const rank = (name: string): number => {
      const at = order.indexOf(name);
      return at === -1 ? Infinity : at;
    };
    const [x, y] = [rank(a), rank(b)];
    return x === y ? before(a, b) : x < y ? -1 : 1;
  };

/** Capabilities in the order a spec lists them, the unlisted after them by name. */
const arranged = (
  list: readonly Capability[],
  order: readonly string[],
): Capability[] => {
  const ranked = byRank(order);
  return [...list].sort((a, b) => ranked(a.name, b.name));
};

/** The spec of a package's tests: the one its report carries, or for the repository's own, its artifact's `spec.json`. */
function specFor(
  folder: string,
  packages: ReadonlyMap<string, PackageInfo>,
  suite: Suite,
  run: TestRun,
): Spec {
  const given =
    folder === nameOf(suite)
      ? (run.spec ?? packages.get(folder)?.spec)
      : packages.get(folder)?.spec;
  return specOf(given, folder);
}

function packageSection(
  folder: string,
  cases: readonly TestCase[],
  info: PackageInfo | undefined,
  spec: Spec,
  suite: Suite,
  run: TestRun,
): Html {
  const all = capabilitiesOf(cases, suite);
  const inBuild = (one: Capability): boolean =>
    spec.build.includes(one.name) ||
    [...one.files.keys()].every((file) =>
      spec.build.includes(placeOf(file, suite)[1] ?? file),
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
      : markup`<p class="package-line"><code>${info.name}</code> ${info.version} · commit <a href="${repositoryUrl(suite)}/commit/${run.commit}"><code>${run.commit.slice(0, 7)}</code></a>${unreleased(info.version) ? " · unreleased: what main does today, not a compatibility promise" : ""}</p>\n`;
  return markup`<section class="pkg" data-failed="${String(count(cases, "failed"))}">
<h3 class="package"><code>${folder}</code> ${counts(cases)}</h3>
${line}${spec.about === undefined ? "" : markup`<p class="what">${spec.about}</p>\n`}${spec.glossary.length === 0 ? "" : glossaryList(spec.glossary)}<ul class="tree top">
${main.map((one) => capability(one, suite, run, spec.glossary))}</ul>
${
  build.length === 0
    ? ""
    : markup`<details class="build"${new Html(count(buildCases, "failed") > 0 ? " open" : "")}><summary>Build and packaging ${counts(buildCases)}</summary>
<ul class="tree top">
${build.map((one) => capability(one, suite, run, spec.glossary))}</ul></details>
`
}</section>
`;
}

/** The packages a run covered as the bar names them: the one, or how many and the version they share. */
function packagesOf(packages: ReadonlyMap<string, PackageInfo>): Html {
  const all = [...packages.values()];
  const versions = [...new Set(all.map((one) => one.version))];
  const first = all[0];
  if (first === undefined) return markup``;
  const which =
    all.length === 1
      ? markup`<code>${first.name}</code>`
      : markup`<span title="${all.map((one) => one.name).join(", ")}">${String(all.length)} packages</span>`;
  const version =
    versions.length === 1 ? (versions[0] ?? "") : "versions differ";
  return markup`<span class="run">${which} <code>${version}</code></span>${all.some((one) => unreleased(one.version)) ? markup`<span class="run tag">unreleased</span>` : ""}`;
}

/** What stays at the top while the part scrolls: the run, the counts, how long it took, and the controls, which script reveals. */
function summaryBar(
  suite: Suite,
  run: TestRun,
  cases: readonly TestCase[],
  packages: ReadonlyMap<string, PackageInfo>,
  milliseconds: number | undefined,
): Html {
  const known = packages.size > 0 ? packagesOf(packages) : markup``;
  return markup`<div class="summary-bar" role="group" aria-label="Summary of ${titleInSentence(suite)}">
${known}<span class="run">commit <a href="${repositoryUrl(suite)}/commit/${run.commit}"><code>${run.commit.slice(0, 7)}</code></a></span>
<span class="tallies">${badge("passed", count(cases, "passed"))}${count(cases, "failed") === 0 ? "" : badge("failed", count(cases, "failed"))}${badge("skipped", count(cases, "skipped"))}</span>
${
  milliseconds === undefined
    ? ""
    : markup`<span class="duration" title="run time">${seconds(milliseconds / 1000)}</span>
`
}<span class="controls" data-controls hidden><button type="button" data-action="expand-all">Expand all</button><button type="button" data-action="collapse-all">Collapse all</button><button type="button" data-action="failures-only" aria-pressed="false">Failures only</button></span>
</div>
`;
}

/** A repository's cases by package: the runtime's `packages/`, or one, the repository itself, named for it. */
function byPackage(
  cases: readonly TestCase[],
  suite: Suite,
): Map<string, TestCase[]> {
  const found = new Map<string, TestCase[]>();
  for (const one of cases) {
    const folder = placeOf(one.file, suite)[0] || nameOf(suite);
    found.set(folder, [...(found.get(folder) ?? []), one]);
  }
  return found;
}

/** A suite's cases as the page reads them: each package, with its capabilities in the order its spec gives. */
function packageSections(
  cases: readonly TestCase[],
  packages: ReadonlyMap<string, PackageInfo>,
  suite: Suite,
  run: TestRun,
): Html {
  const listed = byRank(suite.packages ?? []);
  const order = [...byPackage(cases, suite)].sort(
    ([a, held], [b, other]) =>
      Number(other.some((c) => c.result === "failed")) -
        Number(held.some((c) => c.result === "failed")) || listed(a, b),
  );
  return markup`${order.map(([folder, held]) => packageSection(folder, held, packages.get(folder), specFor(folder, packages, suite, run), suite, run))}`;
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
    ...one.extra,
    ...(levels.length === 0 ? {} : { levels }),
    ...(one.description === undefined ? {} : { description: one.description }),
    ...(rules.length === 0 ? {} : { rules }),
  };
  return Object.keys(extra).length === 0 ? {} : { extra };
}

/** The glossary of each package that has one, for an agent reading CTRF. */
function extraOfGlossaries(
  suite: Suite,
  run: TestRun,
  cases: readonly TestCase[],
  packages: ReadonlyMap<string, PackageInfo>,
): { extra?: unknown } {
  const glossary: Record<string, unknown[]> = {};
  const folders = new Set([
    ...packages.keys(),
    ...byPackage(cases, suite).keys(),
  ]);
  for (const folder of folders) {
    const entries = specFor(folder, packages, suite, run).glossary;
    if (entries.length > 0) glossary[folder] = entries.map(ctrfEntry);
  }
  return Object.keys(glossary).length === 0 ? {} : { extra: { glossary } };
}

/** A suite's results as CTRF (https://ctrf.io), each case with the describes it sits in as its suite. */
function ctrf(
  suite: Suite,
  run: TestRun,
  cases: readonly TestCase[],
  timing: CtrfTiming,
  duration: number | undefined,
  failedOutside: number,
  packages: ReadonlyMap<string, PackageInfo>,
  tool: string,
  unmeasured: boolean,
): unknown {
  const runAt = Date.parse(run.at);
  // The producer's own start and stop are kept as given; without them the run's time stands in, spanning the cases' time.
  // Only an unmeasured report has no time to span, and CTRF 0.2.0 still needs a start and a stop.
  const lasted =
    suite.runner === "ctrf" ? (duration ?? 0) : Math.round(duration ?? 0);
  const span =
    timing.start !== undefined && timing.stop !== undefined
      ? {
          start: timing.start,
          stop: timing.stop,
          duration: timing.stop - timing.start,
        }
      : unmeasured
        ? {
            start: Number.isNaN(runAt) ? 0 : runAt,
            stop: Number.isNaN(runAt) ? 0 : runAt,
          }
        : {
            start: Number.isNaN(runAt) ? 0 : runAt,
            stop: (Number.isNaN(runAt) ? 0 : runAt) + lasted,
            duration: lasted,
          };
  return {
    reportFormat: "CTRF",
    specVersion: "0.2.0",
    timestamp: run.at,
    generatedBy: "cascade-runtime-js packages/site",
    ...extraOfGlossaries(suite, run, cases, packages),
    results: {
      tool: { name: tool },
      ...(unmeasured ? { extra: { caseDurations: "unmeasured" } } : {}),
      summary: {
        tests: cases.length,
        passed: count(cases, "passed"),
        failed: count(cases, "failed") + failedOutside,
        skipped: count(cases, "skipped"),
        pending: 0,
        other: 0,
        ...span,
      },
      tests: cases.map((one) => ({
        name: one.name,
        status: one.result,
        duration: one.milliseconds ?? Math.round((one.seconds ?? 0) * 1000),
        ...(one.describes.length === 0 ? {} : { suite: [...one.describes] }),
        ...extraOf(one),
        filePath: one.file,
        ...(one.line === undefined ? {} : { line: one.line }),
        ...(one.message === undefined ? {} : { message: one.message }),
      })),
      environment: {
        repositoryUrl: repositoryUrl(suite),
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

/** What a CTRF report says of its tool and of its time; a runner's report says neither. */
interface CtrfTiming {
  readonly tool?: string;
  readonly unmeasured?: boolean;
  readonly start?: number;
  readonly stop?: number;
}

/** The cases of a run's report, read as its suite's runner writes it; a `ctrf` suite's report is already CTRF. */
function casesOf(suite: Suite, run: TestRun): JunitReport & CtrfTiming {
  if (suite.runner !== "ctrf") return readJunit(run.report);
  const { cases, tool, unmeasured, start, stop } = readCtrf(run.report);
  return {
    cases,
    packages: new Map(),
    failingSuites: 0,
    ...(tool === undefined ? {} : { tool }),
    unmeasured,
    ...(start === undefined || stop === undefined ? {} : { start, stop }),
  };
}

/** What a suite's page shows of its run: the summary, the counts and the tree, or why there is none. */
function part(suite: Suite, run: TestRun | undefined): Part {
  if (run === undefined)
    return {
      html: markup`<p class="prose">Not available: this build was given no report of the newest run of ${titleInSentence(suite)} on <code>main</code>.</p>
`,
    };
  let cases: TestCase[];
  let failingSuites: number;
  let packages: ReadonlyMap<string, PackageInfo>;
  let timing: CtrfTiming;
  try {
    ({ cases, failingSuites, packages, ...timing } = casesOf(suite, run));
  } catch (error) {
    return {
      html: markup`<p class="prose">${runLine(suite, run)}.</p>
<p class="prose">Not available: the report of that run cannot be read (${error instanceof Error ? error.message : String(error)}).</p>
`,
    };
  }
  const failed = count(cases, "failed");
  // Only node:test's XML declares failures and a duration outside its cases.
  const counted =
    suite.runner === "ctrf" ? undefined : declaredFailures(run.report);
  // failingSuites includes describe suites holding a failed case, which node does not count in its failures; the threshold stays so that it never alarms falsely.
  const hidden = counted !== undefined && counted > failed + failingSuites;
  const unlisted =
    counted !== undefined && hidden
      ? markup`<p class="prose"><strong>Failed outside the cases below:</strong> node counts ${counted} ${counted === 1 ? "failure" : "failures"} but the report lists ${failed} failed ${failed === 1 ? "case" : "cases"}${failingSuites === 0 ? "" : markup` and ${failingSuites} ${failingSuites === 1 ? "test" : "tests"} holding them`}. A test with subtests or a hook that failed is left out of the report; <a href="${run.url}">the run's log</a> names it.</p>
`
      : "";
  const shownCases =
    cases.length === 0 ? "" : packageSections(cases, packages, suite, run);
  // A CTRF report whose cases were not timed has a run time only where it gives its start and stop.
  const milliseconds: number | undefined =
    timing.start !== undefined && timing.stop !== undefined
      ? timing.stop - timing.start
      : timing.unmeasured === true
        ? undefined
        : ((suite.runner === "ctrf"
            ? undefined
            : declaredDuration(run.report)) ??
          cases.reduce((sum, one) => sum + (one.seconds ?? 0) * 1000, 0));
  const none =
    failed === 0 && !hidden
      ? markup`<p class="no-failures">No failures.</p>\n`
      : "";
  return {
    html: markup`${summaryBar(suite, run, cases, packages, milliseconds)}<p class="prose">${runLine(suite, run)}. ${cases.length} ${cases.length === 1 ? "case" : "cases"}: ${count(cases, "passed")} passed, ${failed} failed, ${count(cases, "skipped")} skipped. <span class="about">${suite.about}.</span> For an agent: <a href="${ctrfFileOf(suite)}"><code>${ctrfFileOf(suite)}</code></a>.</p>
${unlisted}${none}${shownCases}`,
    ctrf: ctrf(
      suite,
      run,
      cases,
      timing,
      milliseconds,
      counted !== undefined && hidden ? counted - failed : 0,
      packages,
      timing.tool ?? suite.runner,
      timing.unmeasured === true,
    ),
  };
}

function page(suite: Suite, shown: Part): Html {
  const name = nameOf(suite);
  return markup`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${suite.title} · Cascade unit test reports</title>
<link rel="stylesheet" href="../../../${STYLESHEET_FILE}">
<style>${new Html(STYLES)}</style>
</head>
<body>
<nav>
${frontPageLink(3)}
<a href="../../index.html">Conformance results</a></nav>
<main>
<h1>${suite.title}</h1>
<p class="prose">The newest run on <code>main</code> of the tests of <a href="${repositoryUrl(suite)}"><code>${name}</code></a>, read as a
tree of package, capability and situation, each with what it is for and each case linked to its source.
Failures come first within a capability, and the levels that hold one are open.</p>
<section data-part="${name}" id="${name}">
${shown.html}</section>
</main>
<script>${new Html(SCRIPT)}</script>
</body>
</html>
`;
}

/**
 * The newest run on `main` of each listed repository's tests, case by case, each on its own page under
 * `conformance/tests/<repository>/`, with no index above them: a tree of package, capability and situation, each case linked
 * to its line at the commit run. Each suite's results are also written as CTRF beside its page, for an agent. A suite
 * whose report was not fetched, or cannot be read, says so and its page is written all the same.
 */
export const testsSection: Section<TestsContext> = {
  path: OWN_PAGE,
  title: "Unit test reports",
  want: "conformance",
  about:
    "the newest run on main of each Cascade repository's unit tests, case by case, a page for each.",
  source:
    "the JUnit reports of the newest runs on main of each repository packages/site/test-suites.json lists",
  async build(ctx) {
    const files = new Map<string, Uint8Array>();
    for (const { suite, run } of await ctx.tests()) {
      const shown = part(suite, run);
      files.set(testsPageOf(suite), encoder.encode(page(suite, shown).text));
      if (shown.ctrf !== undefined)
        files.set(
          `${TESTS_FOLDER}${nameOf(suite)}/${ctrfFileOf(suite)}`,
          encoder.encode(`${JSON.stringify(shown.ctrf, null, 2)}\n`),
        );
    }
    return files;
  },
  async rows(ctx) {
    return (await ctx.tests()).map(({ suite }) => ({
      href: `${TESTS_FOLDER}${nameOf(suite)}/`,
      label: suite.title,
      about: `the newest run on main, case by case: ${suite.about}.`,
    }));
  },
};
