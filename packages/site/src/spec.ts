import {
  featuresOf,
  type Files,
  kitsOf,
  type Outcome,
  OxigraphStore,
  readText,
  readWrittenFeature,
  Union,
  type WrittenExample,
  type WrittenFeature,
  type WrittenRule,
} from "@cascade-runtime/runtime";
import type { Ingredient } from "./front-page.js";
import { type Content, escape, Html, markup } from "./html.js";
import { STYLESHEET } from "./stylesheet.js";

const EARL = "http://www.w3.org/ns/earl#";
const VOCABULARY = "cascade-vocabulary";
export const SPEC_STYLESHEET_FILE = "spec.css";
export const SPEC_INDEX = "index.html";

/** One example's or check's latest result, by its test's IRI relative to the vocabulary's. */
export interface SpecResult {
  readonly outcome: Outcome;
  readonly why?: string;
}

/** What a conformance report says: each test's result, and what the runtime was run with. */
export interface SpecReport {
  readonly results: ReadonlyMap<string, SpecResult>;
  /** The vocabulary's IRI the run read, which each of its tests' IRIs begins with. */
  readonly vocabulary?: string;
  readonly ranWith: readonly Ingredient[];
}

export interface SpecOptions {
  /** The vocabulary, named by the IRI of its tree. */
  readonly vocabulary: Files;
  readonly report: SpecReport;
  /** What the pages were built from, for the index's footer. */
  readonly builtFrom: readonly Ingredient[];
  readonly at: string;
}

/** A rule with no note pointer, a Choice row with no rule, or a pointer that names nothing. */
export interface SpecWarning {
  readonly kind:
    | "rule names no note"
    | "row names no rule"
    | "pointer names nothing"
    | "row does not name the rule back"
    | "no Why paragraph for the row";
  readonly where: string;
  readonly what: string;
}

export interface SpecPages {
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly warnings: readonly SpecWarning[];
}

/** The EARL report a conformance run wrote, read. */
export async function readSpecReport(bytes: Uint8Array): Promise<SpecReport> {
  const store = new Union(new OxigraphStore());
  await store.loadTurtle(bytes, "urn:report");
  const used = await store.select(`SELECT ?used ?name ?revision WHERE {
      ?subject a <${EARL}TestSubject> ; <http://purl.org/dc/terms/requires> ?used .
      ?used <http://usefulinc.com/ns/doap#name> ?name ; <http://usefulinc.com/ns/doap#revision> ?revision
    }`);
  const ranWith = used.rows
    .map((row) => ({
      name: row.get("name")?.value ?? "",
      version: (row.get("revision")?.value ?? "").slice(0, 12),
      href: row.get("used")?.value ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const vocabulary = ranWith.find(({ name }) => name === VOCABULARY)?.href;
  const { rows } = await store.select(`PREFIX earl: <${EARL}>
    SELECT ?test ?outcome ?why WHERE {
      ?assertion a earl:Assertion ; earl:test ?test ; earl:result ?result . ?result earl:outcome ?outcome
      OPTIONAL { ?result <http://purl.org/dc/terms/description> ?why }
    }`);
  const results = new Map<string, SpecResult>();
  for (const row of rows) {
    const test = row.get("test")?.value ?? "";
    const why = row.get("why")?.value;
    results.set(
      vocabulary !== undefined && test.startsWith(vocabulary)
        ? test.slice(vocabulary.length)
        : test,
      {
        outcome: (row.get("outcome")?.value ?? "").slice(
          EARL.length,
        ) as Outcome,
        ...(why === undefined ? {} : { why }),
      },
    );
  }
  return {
    results,
    ranWith,
    ...(vocabulary === undefined ? {} : { vocabulary }),
  };
}

interface ChoiceRow {
  readonly thing: string;
  readonly text: string;
  readonly rules: readonly string[];
  readonly issues: readonly string[];
}

interface WhyParagraph {
  readonly lead: string;
  readonly text: string;
}

interface Note {
  readonly path: string;
  readonly title: string;
  readonly rows: readonly ChoiceRow[];
  readonly why: readonly WhyParagraph[];
}

interface Pointer {
  readonly note: string;
  readonly rows: readonly string[];
}

const RULE_NUMBER = /^([A-Z]+\d+|Check \d+)\.\s*/;
const numberOf = (rule: WrittenRule): string | undefined =>
  RULE_NUMBER.exec(rule.name)?.[1];
const anchorOf = (number: string): string =>
  number.toLowerCase().replace(/\s+/g, "-");
const thingKey = (thing: string): string =>
  thing.replaceAll("`", "").trim().toLowerCase();

/** A table row's cells, split at each `|` outside a code span. */
function cellsOf(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let code = false;
  for (const char of line.trim().replace(/^\||\|$/g, "")) {
    if (char === "`") code = !code;
    if (char === "|" && !code) {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function sectionsOf(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let lines: string[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^## (.+)$/.exec(line);
    if (heading !== null) {
      lines = [];
      sections.set(heading[1]?.trim() ?? "", lines);
    } else lines?.push(line);
  }
  return sections;
}

function readNote(
  path: string,
  text: string,
  rules: ReadonlySet<string>,
): Note {
  const sections = sectionsOf(text);
  const rows: ChoiceRow[] = [];
  let previous = "";
  let header = false;
  for (const line of sections.get("Choice") ?? []) {
    const isRow = line.startsWith("|");
    if (isRow && !previous.startsWith("|")) header = true;
    else if (isRow && /^\|[\s|:-]+$/.test(line)) header = false;
    else if (isRow && !header) {
      const cells = cellsOf(line);
      rows.push({
        thing: cells[0] ?? "",
        text: line,
        rules: [
          ...new Set(
            [...line.matchAll(/\b([A-Z]{1,2}\d+)\b/g)]
              .map((match) => match[1] ?? "")
              .filter((number) => rules.has(number)),
          ),
        ],
        issues: [
          ...new Set(
            [...line.matchAll(/(?:#|\/issues\/)(\d+)\b/g)].map(
              (match) => `#${match[1] ?? ""}`,
            ),
          ),
        ],
      });
    }
    previous = line;
  }
  const why = (sections.get("Why") ?? [])
    .join("\n")
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((l) => l.trim())
        .join(" ")
        .trim(),
    )
    .flatMap((paragraph) => {
      const lead = /^\*\*(.+?)\*\*/.exec(paragraph)?.[1];
      return lead === undefined ? [] : [{ lead, text: paragraph }];
    });
  const title = /^# (.+)$/m.exec(text)?.[1]?.trim() ?? path;
  return { path, title, rows, why };
}

/** The notes and rows a rule's description names in its first sentence, or none when it does not begin with one. */
function pointersOf(description: string): {
  readonly pointers: readonly Pointer[];
  readonly rest: string;
} {
  const flat = description.replace(/\s+/g, " ").trim();
  if (!flat.startsWith("decisions/"))
    return { pointers: [], rest: description };
  const end = /\.(\s|$)/.exec(flat.replace(/\.md\b/g, "_md"));
  const sentence = end === null ? flat : flat.slice(0, end.index);
  const pointers = sentence
    .split(/(?=decisions\/)/)
    .flatMap((part): Pointer[] => {
      const note = /^decisions\/[\w.-]+\.md/.exec(part)?.[0];
      return note === undefined
        ? []
        : [
            {
              note,
              rows: [...part.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? ""),
            },
          ];
    });
  return {
    pointers,
    rest: end === null ? "" : flat.slice(end.index + 1).trim(),
  };
}

const STOP = new Set([
  "the",
  "and",
  "from",
  "for",
  "one",
  "with",
  "its",
  "per",
]);
const wordsOf = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? [])
    .filter((word) => !STOP.has(word))
    .map((word) => word.replace(/s$/, ""));

/** The paragraph of the note's Why whose bold lead names most of the row's words. */
function whyOf(note: Note, row: string): WhyParagraph | undefined {
  const wanted = wordsOf(row.replaceAll("`", ""));
  let best: WhyParagraph | undefined;
  let score = 0;
  for (const paragraph of note.why) {
    const lead = new Set(wordsOf(paragraph.lead));
    const found = wanted.filter((word) => lead.has(word)).length;
    if (found > score) {
      best = paragraph;
      score = found;
    }
  }
  return best;
}

/** Markdown's code spans, strong text and links, the rest as text; a relative link is to a file beside the note. */
function inline(text: string, base: string): Html {
  return new Html(
    escape(text)
      .split(/(`[^`]+`|\*\*.+?\*\*|\[[^\]]+\]\([^)]+\))/)
      .map((part) => {
        const code = /^`([^`]+)`$/.exec(part);
        if (code !== null) return `<code>${code[1] ?? ""}</code>`;
        const strong = /^\*\*(.+)\*\*$/.exec(part);
        if (strong !== null) return `<strong>${strong[1] ?? ""}</strong>`;
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
        if (link === null) return part;
        const href = link[2] ?? "";
        return `<a href="${/^[a-z]+:/.test(href) ? href : base + href}">${link[1] ?? ""}</a>`;
      })
      .join(""),
  );
}

const LABEL: Readonly<Record<string, string>> = {
  passed: "pass",
  failed: "fail",
};
const resultClass = (result: SpecResult | undefined): string =>
  result?.outcome === "passed"
    ? "passed"
    : result?.outcome === "failed"
      ? "failed"
      : "not-run";
const badge = (result: SpecResult | undefined): Html =>
  markup`<span class="result ${resultClass(result)}">${LABEL[result?.outcome ?? ""] ?? "not run"}</span>`;

interface Tally {
  passed: number;
  failed: number;
  notRun: number;
}

function tally(results: readonly (SpecResult | undefined)[]): Tally {
  const counted: Tally = { passed: 0, failed: 0, notRun: 0 };
  for (const result of results)
    if (result?.outcome === "passed") counted.passed++;
    else if (result?.outcome === "failed") counted.failed++;
    else counted.notRun++;
  return counted;
}

const tallied = ({ passed, failed, notRun }: Tally): string =>
  `${passed} pass, ${failed} fail, ${notRun} not run`;

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

class Spec {
  readonly warnings: SpecWarning[] = [];
  readonly blob: string;
  readonly #options: SpecOptions;
  readonly #notes: ReadonlyMap<string, Note>;
  readonly features: readonly WrittenFeature[];
  readonly kits: readonly { folder: string; feature: WrittenFeature }[];
  /** Each rule a Choice row's pointer reached, by note and row. */
  readonly #reached = new Map<string, Set<string>>();

  constructor(
    options: SpecOptions,
    notes: ReadonlyMap<string, Note>,
    features: readonly WrittenFeature[],
    kits: readonly { folder: string; feature: WrittenFeature }[],
  ) {
    this.#options = options;
    this.#notes = notes;
    this.features = features;
    this.kits = kits;
    this.blob = options.vocabulary.iri.replace("/tree/", "/blob/");
  }

  result(example: Pick<WrittenExample, "iri">): SpecResult | undefined {
    const { iri } = this.#options.vocabulary;
    return this.#options.report.results.get(
      example.iri.startsWith(iri) ? example.iri.slice(iri.length) : example.iri,
    );
  }

  check(kit: string, number: string): SpecResult | undefined {
    const prefix = `${kit}/#${anchorOf(number)}-`;
    for (const [test, result] of this.#options.report.results)
      if (test.startsWith(prefix)) return result;
    return undefined;
  }

  /** Check 1 of a kit: every example passes. */
  everyExample(feature: WrittenFeature): SpecResult | undefined {
    const counted = tally(
      feature.rules.flatMap(({ examples }) =>
        examples.map((e) => this.result(e)),
      ),
    );
    if (counted.failed > 0)
      return { outcome: "failed", why: `${counted.failed} examples fail` };
    if (counted.notRun > 0) return undefined;
    return { outcome: "passed" };
  }

  #warn(kind: SpecWarning["kind"], where: string, what: string): void {
    this.warnings.push({ kind, where, what });
  }

  /** The rule's pointers, checked against the notes: what to show of each. */
  ruled(feature: WrittenFeature, rule: WrittenRule) {
    const number = numberOf(rule) ?? rule.name;
    const { pointers, rest } = pointersOf(rule.description);
    if (pointers.length === 0)
      this.#warn("rule names no note", feature.path, `${number} names no note`);
    let why: { note: Note; paragraph: WhyParagraph } | undefined;
    const shown: { note: Note | undefined; path: string; rows: string[] }[] =
      [];
    for (const pointer of pointers) {
      const note = this.#notes.get(pointer.note);
      shown.push({ note, path: pointer.note, rows: [...pointer.rows] });
      if (note === undefined) {
        this.#warn(
          "pointer names nothing",
          feature.path,
          `${number} names ${pointer.note}, which is no note`,
        );
        continue;
      }
      for (const named of pointer.rows) {
        const row = note.rows.find(
          (r) => thingKey(r.thing) === thingKey(named),
        );
        if (row === undefined) {
          this.#warn(
            "pointer names nothing",
            feature.path,
            `${number} names row "${named}" of ${pointer.note}, whose Choice has no such row`,
          );
          continue;
        }
        const key = `${note.path}\n${thingKey(row.thing)}`;
        this.#reached.set(
          key,
          (this.#reached.get(key) ?? new Set()).add(number),
        );
        if (row.rules.length > 0 && !row.rules.includes(number))
          this.#warn(
            "row does not name the rule back",
            note.path,
            `row "${row.thing}" names ${row.rules.join(", ")}, not ${number}, which names it`,
          );
        if (why === undefined) {
          const paragraph = whyOf(note, row.thing);
          if (paragraph === undefined)
            this.#warn(
              "no Why paragraph for the row",
              note.path,
              `no paragraph of its Why leads with the words of row "${row.thing}", which ${number} names`,
            );
          else why = { note, paragraph };
        }
      }
    }
    return { number, shown, why, rest };
  }

  /** Each Choice row that names no rule. */
  unruledRows(): void {
    for (const note of this.#notes.values())
      for (const row of note.rows) {
        if (row.rules.length > 0) continue;
        const issues =
          row.issues.length === 0 ? "" : ` (it names ${row.issues.join(", ")})`;
        const by = this.#reached.get(`${note.path}\n${thingKey(row.thing)}`);
        this.#warn(
          "row names no rule",
          note.path,
          `row "${row.thing}" names no rule${issues}${by === undefined ? "" : `, though ${[...by].join(", ")} name${by.size === 1 ? "s" : ""} it`}`,
        );
      }
  }
}

const pageOf = (path: string): string =>
  `${path.startsWith("runtime/") ? path.slice(path.lastIndexOf("/") + 1, -".feature".length) : (path.split("/").at(-2) ?? path)}.html`;

function page(spec: Spec, title: string, main: Content): Uint8Array {
  return new TextEncoder().encode(
    markup`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Cascade runtime rules</title>
<link rel="stylesheet" href="${SPEC_STYLESHEET_FILE}">
</head>
<body>
<nav>
<a href="${SPEC_INDEX}">The rules</a>
${spec.features.map((feature) => markup`<a href="${pageOf(feature.path)}">${feature.name}</a>\n`)}</nav>
<main>
${main}
</main>
</body>
</html>
`.text,
  );
}

function prose(text: string): Html {
  return markup`${text
    .split(/\n\s*\n/)
    .filter((paragraph) => paragraph.trim() !== "")
    .map(
      (paragraph) =>
        markup`<p class="prose">${paragraph.replace(/\s+/g, " ").trim()}</p>\n`,
    )}`;
}

function example(spec: Spec, written: WrittenExample): Html {
  const result = spec.result(written);
  return markup`<details class="example ${resultClass(result)}">
<summary>${badge(result)}${written.name}</summary>
<pre>${written.text}</pre>
${result?.outcome === "failed" && result.why !== undefined ? markup`<pre class="failure">${result.why}</pre>\n` : ""}</details>
`;
}

function examples(spec: Spec, rule: WrittenRule): Html {
  return markup`${rule.examples.map((written) => example(spec, written))}`;
}

function kitChecks(spec: Spec, number: string): Html {
  return markup`<table class="checks">
<thead><tr><th>kit</th><th>result</th></tr></thead>
<tbody>
${spec.kits.map(({ folder, feature }) => {
  const result =
    number === "Check 1"
      ? spec.everyExample(feature)
      : spec.check(folder, number);
  return markup`<tr><td data-label="kit"><a href="${pageOf(feature.path)}">${feature.name}</a></td><td data-label="result">${badge(result)}${result?.outcome === "failed" && result.why !== undefined ? markup`<details><summary>why</summary><pre class="failure">${result.why}</pre></details>` : ""}</td></tr>\n`;
})}</tbody>
</table>
`;
}

function rulesPart(
  spec: Spec,
  feature: WrittenFeature,
  pointed: boolean,
): Html {
  return markup`${feature.rules.map((rule) => {
    const number = numberOf(rule);
    const counted = tally(rule.examples.map((e) => spec.result(e)));
    const ruled = pointed ? spec.ruled(feature, rule) : undefined;
    const id = number === undefined ? undefined : anchorOf(number);
    return markup`<section class="rule"${id === undefined ? "" : markup` id="${id}"`}>
<h2>${rule.name === "" ? "Examples under no rule" : rule.name}</h2>
${
  ruled === undefined
    ? ""
    : ruled.shown.length === 0
      ? markup`<p class="ruled none">No decision note is named by this rule yet.</p>\n`
      : markup`<p class="ruled">Ruled by ${ruled.shown.map(
          ({ note, path, rows }, index) =>
            markup`${index === 0 ? "" : "; "}<a href="${spec.blob}${path}">${note?.title ?? path}</a>${rows.length === 0 ? ", its Why" : markup`, ${rows.length === 1 ? "row" : "rows"} ${rows.map((row, i) => markup`${i === 0 ? "" : ", "}<q>${row}</q>`)}`}`,
        )}</p>\n`
}${prose(ruled === undefined ? rule.description : ruled.rest)}${
      ruled?.why === undefined
        ? ""
        : markup`<blockquote class="why">
<p>${inline(ruled.why.paragraph.text, `${spec.blob}decisions/`)}</p>
<p class="also"><a href="${spec.blob}${ruled.why.note.path}#why">${ruled.why.note.title}</a>: the whole Why, the alternatives that lost and what would change our mind.</p>
</blockquote>
`
    }${rule.examples.length === 0 ? "" : markup`<p class="count">${plural(rule.examples.length, "example")}: ${tallied(counted)}</p>\n`}${examples(spec, rule)}${number?.startsWith("Check ") === true ? kitChecks(spec, number) : ""}</section>
`;
  })}`;
}

function featurePage(spec: Spec, feature: WrittenFeature): Uint8Array {
  const counted = tally(
    feature.rules.flatMap(({ examples: listed }) =>
      listed.map((e) => spec.result(e)),
    ),
  );
  const listed = feature.rules.filter((rule) => numberOf(rule) !== undefined);
  return page(
    spec,
    feature.name,
    markup`<p class="kind"><a href="${spec.blob}${feature.path}">${feature.path}</a></p>
<h1>${feature.name}</h1>
${prose(feature.description)}<p class="count">${plural(feature.rules.length, "rule")}, ${plural(counted.passed + counted.failed + counted.notRun, "example")}: ${tallied(counted)}</p>
<ol class="contents">
${listed.map((rule) => markup`<li><a href="#${anchorOf(numberOf(rule) ?? "")}">${rule.name}</a></li>\n`)}</ol>
${rulesPart(spec, feature, true)}`,
  );
}

function kitPage(
  spec: Spec,
  folder: string,
  feature: WrittenFeature,
  inputs: readonly (readonly [string, number])[],
  expected: readonly string[],
): Uint8Array {
  const checks = spec.features.find((f) =>
    f.rules.some((rule) => numberOf(rule)?.startsWith("Check ") === true),
  );
  const checkRules =
    checks?.rules.filter(
      (rule) => numberOf(rule)?.startsWith("Check ") === true,
    ) ?? [];
  return page(
    spec,
    feature.name,
    markup`<p class="kind"><a href="${spec.blob}${feature.path}">${feature.path}</a></p>
<h1>${feature.name}</h1>
${prose(feature.description)}
<h2 class="part">The result</h2>
<table class="checks">
<thead><tr><th>check</th><th>result</th></tr></thead>
<tbody>
${checkRules.map((rule) => {
  const number = numberOf(rule) ?? "";
  const result =
    number === "Check 1"
      ? spec.everyExample(feature)
      : spec.check(folder, number);
  return markup`<tr><td data-label="check"><a href="${checks === undefined ? "" : pageOf(checks.path)}#${anchorOf(number)}">${rule.name}</a></td><td data-label="result">${badge(result)}${result?.outcome === "failed" && result.why !== undefined ? markup`<details><summary>why</summary><pre class="failure">${result.why}</pre></details>` : ""}</td></tr>\n`;
})}</tbody>
</table>
<h2 class="part">The story</h2>
<details class="example">
<summary>${feature.background.split("\n")[0] ?? ""}</summary>
<pre>${feature.background}</pre>
</details>
<h2 class="part">The scripted input</h2>
<ul class="files">
${inputs.map(([path, count]) => markup`<li><a href="${(path.endsWith("/") ? spec.blob.replace("/blob/", "/tree/") : spec.blob) + folder}/scripted-input/${path}">${path}</a>${count > 1 ? markup` <span class="about">${plural(count, "file")}</span>` : ""}</li>\n`)}</ul>
<h2 class="part">The expected views</h2>
<ul class="files">
${expected.map((path) => markup`<li><a href="${spec.blob}${folder}/expected/${path}">${path}</a></li>\n`)}</ul>
<h2 class="part">The planted cases</h2>
${rulesPart(spec, feature, false)}`,
  );
}

function indexPage(spec: Spec, options: SpecOptions): Uint8Array {
  const row = (feature: WrittenFeature, path: string) => {
    const counted = tally(
      feature.rules.flatMap(({ examples: listed }) =>
        listed.map((e) => spec.result(e)),
      ),
    );
    return markup`<tr><td data-label="feature"><a href="${pageOf(path)}">${feature.name}</a></td><td data-label="rules">${feature.rules.length}</td><td data-label="pass">${counted.passed}</td><td data-label="fail">${counted.failed}</td><td data-label="not run">${counted.notRun}</td></tr>\n`;
  };
  const head = markup`<thead><tr><th>feature</th><th>rules</th><th>pass</th><th>fail</th><th>not run</th></tr></thead>`;
  const footer = (heading: string, listed: readonly Ingredient[]) =>
    listed.length === 0
      ? ""
      : markup`<p class="about">${heading}</p>
<ul class="about">
${listed.map(({ name, version, href }) => markup`<li><a href="${href}">${name} ${version}</a></li>\n`)}</ul>
`;
  return page(
    spec,
    "The rules",
    markup`<h1>The Cascade runtime rules</h1>
<p class="prose">Every rule of cascade-vocabulary's <code>runtime/</code> features, with the decision note and Choice row
that ruled it, a paragraph of the note's reasons, its examples as written, and the reference runtime's latest result for
each, from the EARL report its conformance run wrote. The conformance kits follow: each person's story, its scripted
input, its expected views and its result. Built from the repositories on every run; never edited by hand.</p>
<h2 class="part">The features</h2>
<table>
${head}
<tbody>
${spec.features.map((feature) => row(feature, feature.path))}</tbody>
</table>
<h2 class="part">The kits</h2>
<table>
${head}
<tbody>
${spec.kits.map(({ feature }) => row(feature, feature.path))}</tbody>
</table>
<h2 class="part" id="warnings">Warnings</h2>
<p class="prose">A rule and the Choice row that ruled it name each other (<a href="${spec.blob}decisions/README.md">decisions/README.md</a>).
${plural(spec.warnings.length, "place")} where they do not yet:</p>
<ul class="warnings">
${spec.warnings.map(({ kind, where, what }) => markup`<li><span class="about">${kind}</span> <a href="${spec.blob}${where}">${where}</a>: ${what}</li>\n`)}</ul>
<footer>
<p class="about">Built at <time datetime="${options.at}">${options.at}</time> from:</p>
<ul class="about">
${options.builtFrom.map(({ name, version, href }) => markup`<li><a href="${href}">${name} ${version}</a></li>\n`)}</ul>
${footer("The results are of the run with:", options.report.ranWith)}</footer>`,
  );
}

const SPEC_STYLES = `
.result { display: inline-block; min-width: 4.2rem; margin-right: .6rem; padding: 0 .4rem; border-radius: 3px;
          text-align: center; font: 600 .75rem/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; }
.result.passed { background: #e3f4e8; color: #1d6b35; }
.result.failed { background: #fbe5e5; color: #a3201f; }
.result.not-run { background: var(--panel); color: var(--quiet); }
section.rule { margin: 2rem 0 0; padding: 1rem 0 0; border-top: 1px solid var(--rule); }
.ruled { color: var(--quiet); font-size: .9rem; margin: .25rem 0 .5rem; }
blockquote.why { margin: .75rem 0; padding: .1rem 1rem; border-left: 3px solid var(--rule); max-width: 46rem; }
details.example summary { color: var(--text); }
details.example pre { margin: .25rem 0 .75rem; }
pre.failure { background: #fdf2f2; white-space: pre-wrap; }
ol.contents { columns: 2 22rem; font-size: .9rem; }
ul.warnings { font-size: .9rem; }
footer { margin-top: 3rem; border-top: 1px solid var(--rule); }
`;

/**
 * The spec's pages: an index, a page per feature of `runtime/` and a page per kit, each rule beside the note and
 * Choice row that ruled it and each example beside its latest result; and every place a rule and a row do not name
 * each other, as warnings.
 */
export async function specPages(options: SpecOptions): Promise<SpecPages> {
  const { vocabulary } = options;
  const paths = await featuresOf(vocabulary);
  const features = await Promise.all(
    paths
      .filter((path) => path.startsWith("runtime/"))
      .sort()
      .map((path) => readWrittenFeature(vocabulary, path)),
  );
  const kitFolders = (await kitsOf(vocabulary)).sort();
  const kits = await Promise.all(
    kitFolders.map(async (folder) => ({
      folder,
      feature: await readWrittenFeature(
        vocabulary,
        `${folder}/${folder.slice(folder.lastIndexOf("/") + 1)}.feature`,
      ),
    })),
  );
  const numbers = new Set(
    features.flatMap(({ rules }) =>
      rules.flatMap((rule) => {
        const number = numberOf(rule);
        return number === undefined || number.startsWith("Check ")
          ? []
          : [number];
      }),
    ),
  );
  const notePaths = (await vocabulary.list("decisions"))
    .filter(
      (path) =>
        /^decisions\/[^/]+\.md$/.test(path) && !path.endsWith("/README.md"),
    )
    .sort();
  const notes = new Map(
    await Promise.all(
      notePaths.map(
        async (path) =>
          [
            path,
            readNote(path, await readText(vocabulary, path), numbers),
          ] as const,
      ),
    ),
  );
  const spec = new Spec(options, notes, features, kits);
  const files = new Map<string, Uint8Array>();
  for (const feature of features)
    files.set(pageOf(feature.path), featurePage(spec, feature));
  spec.unruledRows();
  for (const { folder, feature } of kits) {
    const listed = await vocabulary.list(`${folder}/scripted-input`);
    const inputs = new Map<string, number>();
    for (const path of listed) {
      const parts = path
        .slice(folder.length + "/scripted-input/".length)
        .split("/");
      const key =
        parts.length > 2 ? `${parts[0]}/${parts[1]}/` : parts.join("/");
      inputs.set(key, (inputs.get(key) ?? 0) + 1);
    }
    const expected = (await vocabulary.list(`${folder}/expected`))
      .map((path) => path.slice(folder.length + "/expected/".length))
      .sort();
    files.set(
      pageOf(feature.path),
      kitPage(
        spec,
        folder,
        feature,
        [...inputs].sort(([a], [b]) => a.localeCompare(b)),
        expected,
      ),
    );
  }
  files.set(SPEC_INDEX, indexPage(spec, options));
  files.set(
    SPEC_STYLESHEET_FILE,
    new TextEncoder().encode(STYLESHEET + SPEC_STYLES),
  );
  return { files, warnings: spec.warnings };
}
