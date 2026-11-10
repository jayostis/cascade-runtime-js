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
td.suite { min-width: 12rem; overflow-wrap: normal; }
td.suite code { overflow-wrap: normal; }
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
.level-name { font-weight: 600; }
li.case { display: grid; grid-template-columns: auto 1fr auto; align-items: baseline; column-gap: .5rem; }
li.case > .said, li.case > pre.failure { grid-column: 2 / -1; }
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
.glossary dl { margin: .3rem 0; display: grid; grid-template-columns: minmax(8rem, max-content) 1fr; gap: .35rem 1.2rem; }
.glossary dt { font-weight: 600; }
.glossary dd { margin: 0; max-width: 70ch; }
.glossary .aliases { font-weight: 400; color: var(--quiet); }
.glossary dt:target { background: var(--panel); }
.glossary .none-match { color: var(--quiet); }
details.build { margin-top: 1.4rem; }
details.build > summary { font-weight: 600; color: var(--text); }
table.cases td.time { text-align: right; font-family: var(--mono); font-variant-numeric: tabular-nums; color: var(--quiet); white-space: nowrap; }
@media (max-width: 40rem) {
  .glossary dl { grid-template-columns: 1fr; gap: 0; }
  .glossary dd { margin-bottom: .5rem; }
  .controls { margin-left: 0; }
  li.case { grid-template-columns: auto 1fr; }
  li.case > .time { grid-column: 2; text-align: left; }
  ul.tree { padding-left: .6rem; }
  li.capability > details > :not(summary) { margin-left: .5rem; margin-right: .5rem; }
  li.capability > details > ul.tree { margin: .4rem .5rem .6rem .6rem; }
  table.cases td.time { text-align: left; }
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

function table(cases: readonly TestCase[]): Html {
  return markup`<table class="cases">
<thead><tr><th>suite</th><th>case</th><th>result</th><th>time</th></tr></thead>
<tbody>
${ordered(cases).map(({ suite, name, result, seconds: time, message }) => markup`<tr data-result="${result}"><td class="suite" data-label="suite"><code>${atSlashes(suite)}</code></td><td data-label="case">${name}${message === undefined ? "" : markup`<pre class="failure">${shown(message)}</pre>`}</td><td data-label="result">${status(result)}</td><td class="time" data-label="time">${seconds(time)}</td></tr>\n`)}</tbody>
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
  return markup`<span class="counts">${badge("passed", count(cases, "passed"))}${failed === 0 ? "" : badge("failed", failed)}${skipped === 0 ? "" : badge("skipped", skipped)}</span>`;
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
    : markup`<span class="rules"><span class="label">Rule${rules.length === 1 ? "" : "s"}</span> ${rules.map(({ feature, id, href }) => markup`<a class="chip" href="${href}">${feature} ${id}</a> `)}</span> `;
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
  return markup`<li class="case" data-result="${one.result}">${status(one.result)} <span class="name">${named(one.name, source, links)}</span><span class="time">${seconds(one.seconds)}</span>${said}${one.message === undefined ? "" : markup`<pre class="failure">${shown(one.message)}</pre>`}</li>\n`;
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
    const href = `${suite.repository}/blob/${run.commit}/${file}${line === undefined ? "" : `#L${line}`}`;
    return markup`<a class="src" href="${href}">${placeOf(file)[1] ?? file}</a>`;
  });
  return markup`<li class="capability" data-failed="${String(count(one.cases, "failed"))}"><details open><summary>${title(one.name)} ${counts(one.cases)}</summary>
${said}<p class="source">${rulesOf(one.info?.rules ?? [])}<span class="label">Source</span> ${files.map((link, at) => markup`${at === 0 ? "" : ", "}${link}`)}</p>
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
  milliseconds: number,
): Html {
  const known = packages.size > 0 ? packagesOf(packages) : markup``;
  const controls = suite.tree
    ? markup`<button type="button" data-action="expand-all">Expand all</button><button type="button" data-action="collapse-all">Collapse all</button>`
    : markup``;
  return markup`<div class="summary-bar" role="group" aria-label="Summary of the ${suite.key}'s tests">
${known}<span class="run">commit <a href="${suite.repository}/commit/${run.commit}"><code>${run.commit.slice(0, 7)}</code></a></span>
<span class="tallies">${badge("passed", count(cases, "passed"))}${badge("failed", count(cases, "failed"))}${badge("skipped", count(cases, "skipped"))}</span>
<span class="duration" title="run time">${seconds(milliseconds / 1000)}</span>
<span class="controls" data-controls hidden>${controls}<button type="button" data-action="failures-only" aria-pressed="false">Failures only</button></span>
</div>
`;
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
  const milliseconds =
    declaredDuration(run.report) ??
    cases.reduce((sum, one) => sum + (one.seconds ?? 0) * 1000, 0);
  const none =
    failed === 0 && !hidden
      ? markup`<p class="no-failures">No failures.</p>\n`
      : "";
  return {
    html: markup`<section data-part="${suite.key}">
${heading}
${summaryBar(suite, run, cases, packages, milliseconds)}<p class="prose">${runLine(suite, run)}. ${cases.length} ${cases.length === 1 ? "case" : "cases"}: ${count(cases, "passed")} passed, ${failed} failed, ${count(cases, "skipped")} skipped. <span class="about">${suite.about}.</span> For an agent: <a href="${suite.key}.ctrf.json"><code>${suite.key}.ctrf.json</code></a>.</p>
${unlisted}${none}${shownCases}</section>
`,
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
<script>${new Html(SCRIPT)}</script>
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
