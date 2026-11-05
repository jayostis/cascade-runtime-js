import { type Content, Html, markup } from "./html.js";
import {
  frontPageLink,
  noteHref,
  noteLinkOf,
  pageNameOf,
  ruleHref,
} from "./links.js";
import { renderWithHeadings, type TableAddition } from "./markdown.js";
import {
  type Citation,
  claimRows,
  type DecisionNote,
  type DecisionNotes,
  isWhatWeDo,
} from "./spec.js";
import { STYLESHEET } from "./stylesheet.js";

export const DECISIONS_STYLESHEET_FILE = "decisions.css";
export const DECISIONS_INDEX = "index.html";
const README = "decisions/README.md";
/** The folder holding `decisions/`, from a page of it. */
const UP = "../";

const DECISION_STYLES = `
.note { overflow-wrap: anywhere; }
.note h2 { margin: 2.25rem 0 .5rem; padding-top: .5rem; border-top: 1px solid var(--line); }
.note h3 { margin: 1.5rem 0 .25rem; }
.note pre { background: var(--panel); padding: .75rem; overflow-x: auto; border-radius: 4px; }
.note :not(pre) > code { background: var(--panel); padding: 0 .2rem; border-radius: 3px; }
.note table { font-size: .9rem; }
.note tr:target { background: #fff6cc; }
ul.cited { margin: 0; padding-left: 1.1rem; }
.none { color: var(--quiet); }
`;

export interface DecisionOptions {
  readonly decisions: DecisionNotes;
  /** `decisions/README.md` as written. */
  readonly readme: string;
  /** The spec's pages, from a page of `decisions/`, ending in a slash. */
  readonly spec: string;
}

/** A page of the notes' own folder to another: `naming.html`, never the way round through the folder above. */
const sibling = (to: string): string =>
  to.startsWith(`${UP}decisions/`) ? to.slice(`${UP}decisions/`.length) : to;

const ruleLink = (cited: Citation, spec: string): string =>
  cited.number === undefined
    ? `${spec}${pageNameOf(cited.feature)}`
    : ruleHref(cited.feature, cited.number, spec);

function page(
  title: string,
  source: { readonly href: string; readonly path: string },
  main: Content,
): Uint8Array {
  return new TextEncoder().encode(
    markup`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Cascade decision notes</title>
<link rel="stylesheet" href="${DECISIONS_STYLESHEET_FILE}">
</head>
<body>
<nav>
${frontPageLink(1)}
<a href="${DECISIONS_INDEX}">Decision notes</a>
<a href="${UP}spec/index.html">The runtime's rules</a>
</nav>
<main>
<p class="kind"><a href="${source.href}">${source.path}</a> on GitHub, at the commit these pages were built from</p>
<div class="note">
${main}</div>
</main>
</body>
</html>
`.text,
  );
}

/** A note's page in the notes' own folder. */
const pageOf = (path: string): string => sibling(noteHref(path, UP));

/** The cell a Choice row ends with: the rules that cite it, or that none does. */
function citedBy(cited: readonly Citation[], spec: string): Html {
  return cited.length === 0
    ? markup`<span class="none">No rule cites this row.</span>`
    : markup`<ul class="cited">${cited.map((rule) => markup`<li><a href="${ruleLink(rule, spec)}">${rule.name}</a></li>`)}</ul>`;
}

/** Where a link written in the note at `from` goes: a page for a note that has one, else its file or folder on GitHub. */
const linkFrom =
  (from: string, { notes, blob, tree }: DecisionNotes) =>
  (href: string): string | undefined =>
    sibling(
      noteLinkOf(href, from, {
        blob,
        tree,
        notes: UP,
        has: (path) =>
          path === README || notes.some((note) => note.path === path),
      }) ?? "",
    ) || undefined;

function notePage(
  note: DecisionNote,
  { decisions, spec }: Pick<DecisionOptions, "decisions" | "spec">,
): Uint8Array {
  const claimed = new Set<string>();
  const { html } = renderWithHeadings(note.text, {
    link: linkFrom(note.path, decisions),
    reserved: note.rows.filter(({ anchored }) => anchored).map(({ id }) => id),
    table: (header, firstCells, section): TableAddition | undefined => {
      if (section !== "Choice" || !header.some(isWhatWeDo)) return undefined;
      const rows = claimRows(note.rows, firstCells, claimed);
      return {
        heading: "Rules that cite it",
        ids: rows.map((row) => row?.id),
        cells: rows.map((row) =>
          row === undefined ? new Html("") : citedBy(row.cited, spec),
        ),
      };
    },
  });
  return page(
    note.title,
    { href: noteHref(note.path, decisions.blob), path: note.path },
    html,
  );
}

/**
 * The README's opening and its "The notes" section, then every other section: a reader who came for the decisions meets the
 * list of notes before the format a note is written in.
 */
function listFirst(readme: string): readonly [string, string] {
  const heading = /^## The notes[ \t]*$/m.exec(readme);
  if (heading === null) return [readme, ""];
  const end = readme.slice(heading.index + 1).search(/^## /m);
  const stop = end < 0 ? readme.length : heading.index + 1 + end;
  const first = readme.search(/^## /m);
  return [
    readme.slice(0, first) + readme.slice(heading.index, stop),
    readme.slice(first, heading.index) + readme.slice(stop),
  ];
}

function indexPage({
  decisions,
  readme,
}: Pick<DecisionOptions, "decisions" | "readme">): Uint8Array {
  const render = (source: string): Html =>
    renderWithHeadings(source, { link: linkFrom(README, decisions) }).html;
  const [opening, format] = listFirst(readme);
  const plain = (thing: string): string => thing.replaceAll("`", "");
  return page(
    "Decision notes",
    { href: noteHref(README, decisions.blob), path: README },
    markup`${render(opening)}<h2 id="every-note">Every note, and the rows no rule cites</h2>
<p class="prose">A rule names the Choice row that ruled it in its first sentence, and the note's row lists the rules that name it.
A row no rule cites is listed here and says so on its note's page: its ruling is applied by a file other than a runtime
rule, or by a rule that has yet to be written, or by none.</p>
<table>
<thead><tr><th>note</th><th>rows</th><th>cited by a rule</th><th>cited by none</th></tr></thead>
<tbody>
${decisions.notes.map((note) => {
  const none = note.rows.filter(({ cited }) => cited.length === 0);
  return markup`<tr><td data-label="note"><a href="${pageOf(note.path)}">${note.title}</a></td><td data-label="rows">${note.rows.length}</td><td data-label="cited by a rule">${note.rows.length - none.length}</td><td data-label="cited by none">${none.map(({ id, thing, anchored }, at) => markup`${at === 0 ? "" : ", "}<a href="${pageOf(note.path)}${anchored ? `#${id}` : ""}">${plain(thing)}</a>`)}</td></tr>\n`;
})}</tbody>
</table>
${render(format)}`,
  );
}

/**
 * The decision notes as pages, by path from the folder that holds them: `index.html` from the README, a page per note,
 * and the stylesheet. Each Choice row is an anchor listing the rules that cite it, linked to the spec's pages at `spec`;
 * each link between notes that exist goes to a page, and any other relative link to the file at the commit built. A Choice
 * row the page has no table row for is anchored nowhere; the spec's warnings say so.
 */
export function decisionPages(
  options: DecisionOptions,
): ReadonlyMap<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const note of options.decisions.notes)
    files.set(pageOf(note.path), notePage(note, options));
  files.set(DECISIONS_INDEX, indexPage(options));
  files.set(
    DECISIONS_STYLESHEET_FILE,
    new TextEncoder().encode(STYLESHEET + DECISION_STYLES),
  );
  return files;
}
