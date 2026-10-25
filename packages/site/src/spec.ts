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
  /** The vocabulary's IRI the run read, ending in a slash, which each of its tests' IRIs begins with. */
  readonly vocabulary?: string;
  readonly ranWith: readonly Ingredient[];
  /** Each test the report holds more than one assertion of, as {@link results} keys it. */
  readonly repeated: readonly string[];
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
    | "no Why paragraph names the row"
    | "two examples share a test"
    | "page name taken"
    | "report";
  readonly where: string;
  readonly what: string;
}

export interface SpecPages {
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly warnings: readonly SpecWarning[];
  /** Each rule that says no note rules it, as `runtime/naming.feature N8`. */
  readonly unnoted: readonly string[];
  /** Each Choice row that names no rule but the issue that will write it. */
  readonly waiting: readonly { readonly note: string; readonly what: string }[];
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
  const named = ranWith.find(({ name }) => name === VOCABULARY)?.href;
  const vocabulary = named === undefined ? undefined : withSlash(named);
  const { rows } = await store.select(`PREFIX earl: <${EARL}>
    SELECT ?assertion ?test ?outcome ?why WHERE {
      ?assertion a earl:Assertion ; earl:test ?test ; earl:result ?result . ?result earl:outcome ?outcome
      OPTIONAL { ?result <http://purl.org/dc/terms/description> ?why }
    }`);
  const results = new Map<string, SpecResult>();
  const assertions = new Map<string, Set<string>>();
  for (const row of rows) {
    const test = row.get("test")?.value ?? "";
    const why = row.get("why")?.value;
    const key =
      vocabulary !== undefined && test.startsWith(vocabulary)
        ? test.slice(vocabulary.length)
        : test;
    const seen = assertions.get(key) ?? new Set();
    seen.add(termKey(row.get("assertion")));
    assertions.set(key, seen);
    const result: SpecResult = {
      outcome: (row.get("outcome")?.value ?? "").slice(EARL.length) as Outcome,
      ...(why === undefined ? {} : { why }),
    };
    const held = results.get(key);
    if (held === undefined || RANK(result) > RANK(held))
      results.set(key, result);
  }
  return {
    results,
    ranWith,
    repeated: [...assertions]
      .filter(([, seen]) => seen.size > 1)
      .map(([key]) => key)
      .sort(),
    ...(vocabulary === undefined ? {} : { vocabulary }),
  };
}

const withSlash = (iri: string): string =>
  iri.endsWith("/") ? iri : `${iri}/`;

/** Of two results for one test, a fail outranks a pass, which outranks anything else. */
const RANK = ({ outcome }: SpecResult): number =>
  outcome === "failed" ? 2 : outcome === "passed" ? 1 : 0;

const termKey = (
  term: { readonly termType: string; readonly value: string } | undefined,
): string => (term === undefined ? "" : `${term.termType}:${term.value}`);

interface ChoiceRow {
  readonly thing: string;
  readonly rules: readonly string[];
  readonly issues: readonly string[];
  /** The paths of the "what we do" cell's code spans, each a file that applies a ruling no runtime rule can. */
  readonly paths: readonly string[];
}

interface WhyParagraph {
  /** The Choice rows the paragraph names right after its bold lead, as `(row "version")`. */
  readonly rows: readonly string[];
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
/** The sentence a rule opens with when no note rules it (decisions/README.md). */
const NO_NOTE = /^No note rules this\.\s*/;
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
  const lines = sections.get("Choice") ?? [];
  const SEPARATOR = /^\|[\s|:-]+$/;
  // A table's header is the row above its separator; a table broken by a line is the one above it continued.
  let ruling = -1;
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("|") || SEPARATOR.test(line)) continue;
    if (SEPARATOR.test(lines[index + 1] ?? "")) {
      ruling = cellsOf(line).findIndex(
        (cell) => cell.toLowerCase() === "what we do",
      );
      continue;
    }
    if (ruling < 0) continue;
    const cells = cellsOf(line);
    const done = cells[ruling] ?? "";
    rows.push({
      thing: cells[0] ?? "",
      rules: [
        ...new Set(
          [...done.matchAll(/\b(Check |[A-Z]{1,2})(\d+)(?: to \1(\d+))?\b/g)]
            .flatMap(([, letters = "", from = "", to = from]) =>
              Array.from(
                { length: Math.max(0, Number(to) - Number(from)) + 1 },
                (_, at) => `${letters}${Number(from) + at}`,
              ),
            )
            .filter((number) => rules.has(number)),
        ),
      ],
      paths: [
        ...new Set(
          [...done.matchAll(/`([^`]+)`/g)]
            .map((match) => match[1] ?? "")
            .filter((path) => /^[\w. -]+(\/[\w. -]+)+$/.test(path)),
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
    .flatMap((paragraph): WhyParagraph[] => {
      const led =
        /^(\*\*.+?\*\*)\s*\((rows? (?:"[^"]*"|“[^”]*”|[^)"“])*)\)\s*/.exec(
          paragraph,
        );
      if (led === null) return [];
      return [
        {
          rows: quoted(led[2] ?? ""),
          text: `${led[1] ?? ""} ${paragraph.slice(led[0].length)}`,
        },
      ];
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
  // The sentence ends at a full stop outside quotes that is not a note's ".md".
  let end = flat.length;
  let quote = "";
  for (let at = 0; at < flat.length; at++) {
    const char = flat[at] ?? "";
    if (quote === "" && (char === '"' || char === "“"))
      quote = char === "“" ? "”" : '"';
    else if (quote !== "" && char === quote) quote = "";
    else if (
      quote === "" &&
      char === "." &&
      !flat.startsWith(".md", at) &&
      /\s/.test(flat[at + 1] ?? " ")
    ) {
      end = at;
      break;
    }
  }
  const pointers = flat
    .slice(0, end)
    .split(/(?=decisions\/)/)
    .flatMap((part): Pointer[] => {
      const note = /^decisions\/[\w.-]+\.md/.exec(part)?.[0];
      return note === undefined ? [] : [{ note, rows: quoted(part) }];
    });
  return { pointers, rest: flat.slice(end + 1).trim() };
}

/** Each string quoted in the text, in straight or curly double quotes. */
const quoted = (text: string): string[] =>
  [...text.matchAll(/"([^"]+)"|“([^”]+)”/g)].map((m) => m[1] ?? m[2] ?? "");

/**
 * The paragraph of the note's Why that names the row right after its bold lead, as
 * `**Why content names a version.** (row "version") Many servers…`; none until a note does.
 */
function whyOf(note: Note, row: string): WhyParagraph | undefined {
  return note.why.find(({ rows }) =>
    rows.some((named) => thingKey(named) === thingKey(row)),
  );
}

/**
 * Markdown's code spans, strong text and links, the rest as text. A relative link is to a file beside the note, `#…`
 * to a place in it; a link that is not then http or https is left as its text.
 */
function inline(text: string, base: string, note: string): Html {
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
        const resolved = /^[a-z][a-z0-9+.-]*:/i.test(href)
          ? href
          : href.startsWith("#")
            ? note + href
            : base + href;
        return /^https?:\/\//i.test(resolved)
          ? `<a href="${resolved}">${link[1] ?? ""}</a>`
          : (link[1] ?? "");
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
  /** Each path a Choice row names that is a file of the vocabulary. */
  readonly #files: ReadonlySet<string>;
  /** Each path a Choice row names in a folder of the vocabulary that holds no such file. */
  readonly #missing: ReadonlySet<string>;
  /** Each rule that says no note rules it, as `runtime/naming.feature N8`. */
  readonly unnoted: string[] = [];
  /** Each Choice row that names no rule but the issue that will write it. */
  readonly waiting: { readonly note: string; readonly what: string }[] = [];

  constructor(
    options: SpecOptions,
    notes: ReadonlyMap<string, Note>,
    features: readonly WrittenFeature[],
    kits: readonly { folder: string; feature: WrittenFeature }[],
    files: {
      readonly found: ReadonlySet<string>;
      readonly missing: ReadonlySet<string>;
    },
  ) {
    this.#files = files.found;
    this.#missing = files.missing;
    this.#options = options;
    this.#notes = notes;
    this.features = features;
    this.kits = kits;
    const { iri } = options.vocabulary;
    this.blob = iri.includes("/tree/") ? iri.replace("/tree/", "/blob/") : iri;
    this.tree = iri;
  }

  readonly tree: string;
  /** Each feature file's page, where it is not the one its name gives. */
  readonly pages = new Map<string, string>();

  pageOf(path: string): string {
    return this.pages.get(path) ?? pageNameOf(path);
  }

  result(example: Pick<WrittenExample, "iri">): SpecResult | undefined {
    const { iri } = this.#options.vocabulary;
    const { results } = this.#options.report;
    return example.iri.startsWith(iri)
      ? (results.get(example.iri.slice(iri.length)) ?? results.get(example.iri))
      : results.get(example.iri);
  }

  /** What keeps the report's results from joining the pages, as warnings on the index. */
  joined(): void {
    const { report, vocabulary } = this.#options;
    if (report.results.size === 0) return;
    for (const test of report.repeated)
      this.#warn(
        "report",
        test,
        "the report holds more than one result for this test; the worst is shown",
      );
    if (report.vocabulary === undefined)
      this.#warn(
        "report",
        "",
        `the report names no ${VOCABULARY} it was run with`,
      );
    else if (report.vocabulary !== vocabulary.iri)
      this.#warn(
        "report",
        "",
        `the report was run with ${report.vocabulary}, the pages are built from ${vocabulary.iri}`,
      );
    const all = [...this.features, ...this.kits.map(({ feature }) => feature)];
    if (
      all.every(({ rules }) =>
        rules.every(({ examples }) =>
          examples.every((e) => this.result(e) === undefined),
        ),
      )
    )
      this.#warn(
        "report",
        "",
        "no result of the report joins an example of the pages",
      );
    for (const feature of all) {
      const seen = new Set<string>();
      for (const { examples } of feature.rules)
        for (const { iri, name } of examples) {
          if (seen.has(iri))
            this.#warn(
              "two examples share a test",
              feature.path,
              `more than one example is "${name}"`,
            );
          seen.add(iri);
        }
    }
  }

  warn(kind: SpecWarning["kind"], where: string, what: string): void {
    this.#warn(kind, where, what);
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
    if (counted.notRun > 0 || counted.passed === 0) return undefined;
    return { outcome: "passed" };
  }

  #warn(kind: SpecWarning["kind"], where: string, what: string): void {
    this.warnings.push({ kind, where, what });
  }

  /** The rule's pointers, checked against the notes: what to show of each. */
  ruled(feature: WrittenFeature, rule: WrittenRule) {
    const number = numberOf(rule) ?? rule.name;
    const flat = rule.description.replace(/\s+/g, " ").trim();
    const unnoted = NO_NOTE.exec(flat);
    const { pointers, rest } =
      unnoted === null
        ? pointersOf(rule.description)
        : { pointers: [], rest: flat.slice(unnoted[0].length) };
    if (unnoted !== null) this.unnoted.push(`${feature.path} ${number}`);
    else if (pointers.length === 0)
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
              "no Why paragraph names the row",
              note.path,
              `no paragraph of its Why names row "${row.thing}", which ${number} names`,
            );
          else why = { note, paragraph };
        }
      }
    }
    return { number, shown, why, rest, unnoted: unnoted !== null };
  }

  /**
   * Each Choice row that names no rule, no file that applies it and no issue that will write its rule, and each file a
   * row names that the vocabulary does not hold.
   */
  unruledRows(): void {
    for (const note of this.#notes.values())
      for (const row of note.rows) {
        for (const path of row.paths)
          if (this.#missing.has(path))
            this.#warn(
              "pointer names nothing",
              note.path,
              `row "${row.thing}" names ${path}, which is no file`,
            );
        if (row.rules.length > 0) continue;
        if (row.paths.some((path) => this.#files.has(path))) continue;
        if (row.issues.length > 0) {
          this.waiting.push({
            note: note.path,
            what: `row "${row.thing}" waits on ${row.issues.join(", ")}`,
          });
          continue;
        }
        const by = this.#reached.get(`${note.path}\n${thingKey(row.thing)}`);
        this.#warn(
          "row names no rule",
          note.path,
          `row "${row.thing}" names no rule${by === undefined ? "" : `, though ${[...by].join(", ")} name${by.size === 1 ? "s" : ""} it`}`,
        );
      }
  }
}

const pageNameOf = (path: string): string =>
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
${spec.features.map((feature) => markup`<a href="${spec.pageOf(feature.path)}">${feature.name}</a>\n`)}</nav>
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
  return markup`<tr><td data-label="kit"><a href="${spec.pageOf(feature.path)}">${feature.name}</a></td><td data-label="result">${badge(result)}${result?.outcome === "failed" && result.why !== undefined ? markup`<details><summary>why</summary><pre class="failure">${result.why}</pre></details>` : ""}</td></tr>\n`;
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
    : ruled.unnoted
      ? markup`<p class="ruled none">No decision note rules this: it is mechanics every runtime follows alike.</p>\n`
      : ruled.shown.length === 0
        ? markup`<p class="ruled none">No decision note is named by this rule yet.</p>\n`
        : markup`<p class="ruled">Ruled by ${ruled.shown.map(
            ({ note, path, rows }, index) =>
              markup`${index === 0 ? "" : "; "}<a href="${spec.blob}${path}">${note?.title ?? path}</a>${rows.length === 0 ? ", its Why" : markup`, ${rows.length === 1 ? "row" : "rows"} ${rows.map((row, i) => markup`${i === 0 ? "" : ", "}<q>${row}</q>`)}`}`,
          )}</p>\n`
}${prose(ruled === undefined ? rule.description : ruled.rest)}${
      ruled === undefined
        ? ""
        : ruled.why === undefined
          ? ruled.shown
              .filter(({ note }) => note !== undefined)
              .map(
                ({ note }) =>
                  markup`<p class="also">Why: <a href="${spec.blob}${note?.path ?? ""}#why">${note?.title ?? ""}</a>, with the alternatives that lost and what would change our mind.</p>\n`,
              )
          : markup`<blockquote class="why">
<p>${inline(ruled.why.paragraph.text, `${spec.blob}decisions/`, `${spec.blob}${ruled.why.note.path}`)}</p>
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
  return markup`<tr><td data-label="check"><a href="${checks === undefined ? "" : spec.pageOf(checks.path)}#${anchorOf(number)}">${rule.name}</a></td><td data-label="result">${badge(result)}${result?.outcome === "failed" && result.why !== undefined ? markup`<details><summary>why</summary><pre class="failure">${result.why}</pre></details>` : ""}</td></tr>\n`;
})}</tbody>
</table>
<h2 class="part">The story</h2>
<details class="example">
<summary>${feature.background.split("\n")[0] ?? ""}</summary>
<pre>${feature.background}</pre>
</details>
<h2 class="part">The scripted input</h2>
<ul class="files">
${inputs.map(([path, count]) => markup`<li><a href="${(path.endsWith("/") ? spec.tree : spec.blob) + folder}/scripted-input/${path}">${path}</a>${count > 1 ? markup` <span class="about">${plural(count, "file")}</span>` : ""}</li>\n`)}</ul>
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
    return markup`<tr><td data-label="feature"><a href="${spec.pageOf(path)}">${feature.name}</a></td><td data-label="rules">${feature.rules.length}</td><td data-label="pass">${counted.passed}</td><td data-label="fail">${counted.failed}</td><td data-label="not run">${counted.notRun}</td></tr>\n`;
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
${spec.warnings.map(({ kind, where, what }) => markup`<li><span class="about">${kind}</span> ${where === "" ? "" : markup`<a href="${spec.blob}${where}">${where}</a>: `}${what}</li>\n`)}</ul>
<p class="prose">${plural(spec.unnoted.length, "rule says", "rules say")} no note rules it, and ${plural(spec.waiting.length, "Choice row waits", "Choice rows wait")} on the issue that will write its rule:</p>
<ul class="warnings">
${spec.unnoted.map((rule) => markup`<li><span class="about">no note rules it</span> ${rule}</li>\n`)}${spec.waiting.map(({ note, what }) => markup`<li><span class="about">waits on an issue</span> <a href="${spec.blob}${note}">${note}</a>: ${what}</li>\n`)}</ul>
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
        return number === undefined ? [] : [number];
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
  const spec = new Spec(
    options,
    notes,
    features,
    kits,
    await filesNamed(
      vocabulary,
      [...notes.values()].flatMap(({ rows }) =>
        rows.flatMap(({ paths }) => paths),
      ),
    ),
  );
  const taken = new Set([
    SPEC_INDEX,
    ...features.map(({ path }) => pageNameOf(path)),
  ]);
  for (const { folder, feature } of kits) {
    const name = pageNameOf(feature.path);
    if (!taken.has(name)) continue;
    spec.pages.set(feature.path, `kit-${name}`);
    spec.warn(
      "page name taken",
      folder,
      `the kit's page would be ${name}, a feature's, so it is kit-${name}`,
    );
  }
  spec.joined();
  const files = new Map<string, Uint8Array>();
  for (const feature of features)
    files.set(spec.pageOf(feature.path), featurePage(spec, feature));
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
      spec.pageOf(feature.path),
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
  return {
    files,
    warnings: spec.warnings,
    unnoted: spec.unnoted,
    waiting: spec.waiting,
  };
}

/**
 * Of the paths the Choice rows name, those the vocabulary holds, and those in a folder of it that holds no such file;
 * a path whose first folder the vocabulary has not is a pod's or another repository's, and neither.
 */
async function filesNamed(
  vocabulary: Files,
  paths: readonly string[],
): Promise<{ found: Set<string>; missing: Set<string> }> {
  const folders = new Map<string, Set<string>>();
  const found = new Set<string>();
  const missing = new Set<string>();
  for (const path of new Set(paths)) {
    const folder = path.slice(0, path.indexOf("/"));
    let held = folders.get(folder);
    if (held === undefined) {
      held = new Set(await vocabulary.list(folder));
      folders.set(folder, held);
    }
    if (held.has(path)) found.add(path);
    else if (held.size > 0) missing.add(path);
  }
  return { found, missing };
}
