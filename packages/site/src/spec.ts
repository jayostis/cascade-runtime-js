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
import { Marked, type Tokens } from "marked";
import type { Ingredient } from "./front-page.js";
import { type Content, escape, Html, markup, shell } from "./html.js";
import {
  anchorOf,
  frontPageLink,
  noteHref,
  noteLinkOf,
  pageNameOf,
  slugOf,
} from "./links.js";
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
  /**
   * The folder of the site that holds `decisions/`, as {@link noteHref} takes it, when the notes have pages there; a rule
   * then links its note's page and row. Without it they link the note on GitHub.
   */
  readonly notes?: string;
}

/** A rule with no note pointer, a Choice row with no rule, or a pointer that names nothing. */
export interface SpecWarning {
  readonly kind:
    | "rule names no note"
    | "row names no rule"
    | "pointer names nothing"
    | "row does not name the rule back"
    | "row is in no table of the page"
    | "no Why paragraph names the row"
    | "two examples share a test"
    | "page name taken"
    | "report";
  readonly where: string;
  readonly what: string;
}

/** One feature's or kit's line of the results table: how many of its examples passed, failed or were not run. */
export interface FeatureResult {
  readonly path: string;
  readonly name: string;
  /** The feature's page among the spec's pages. */
  readonly page: string;
  readonly kit: boolean;
  readonly rules: number;
  /** The rules with no example, which no result can speak for. */
  readonly withoutExample: number;
  readonly passed: number;
  readonly failed: number;
  readonly notRun: number;
  /** A kit's checks after Check 1 (which is its examples), counted apart from the examples; none for a feature. */
  readonly checks?: {
    readonly passed: number;
    readonly failed: number;
    readonly notRun: number;
  };
}

export interface SpecPages {
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** The features and then the kits, each with its tally. */
  readonly features: readonly FeatureResult[];
  readonly warnings: readonly SpecWarning[];
  /** Each rule that says no note rules it, as `runtime/naming.feature N8`. */
  readonly unnoted: readonly string[];
  /** Each Choice row that names no rule but the issue that will write it. */
  readonly waiting: readonly {
    readonly note: string;
    readonly id: string;
    readonly what: string;
  }[];
  /** The decision notes, read once, for the pages that render them. */
  readonly decisions: DecisionNotes;
}

/** A rule whose first sentence names a Choice row. */
export interface Citation {
  /** The rule's feature file, as `runtime/currency.feature`. */
  readonly feature: string;
  /** The rule's number, absent for a rule that has none. */
  readonly number?: string;
  readonly name: string;
}

/** A note's Choice row, and the rules that name it. */
export interface DecisionRow extends ChoiceRow {
  readonly cited: readonly Citation[];
  /** Whether the note's page has a table row for it; false for a row on a line the page renders as text. */
  readonly anchored: boolean;
}

export interface DecisionNote extends Omit<Note, "rows"> {
  readonly rows: readonly DecisionRow[];
}

/** The vocabulary's decision notes, with the rules that cite each Choice row. */
export interface DecisionNotes {
  readonly notes: readonly DecisionNote[];
  /** The vocabulary's files and folders on GitHub at the commit built, each ending in a slash. */
  readonly blob: string;
  readonly tree: string;
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

export interface ChoiceRow {
  readonly thing: string;
  /** The row's anchor on its note's page: `row-` and the thing's slug, a number added to a slug the note's earlier row has. */
  readonly id: string;
  readonly rules: readonly string[];
  readonly issues: readonly string[];
  /** The paths of the "what we do" cell's code spans, each a file that applies a ruling no runtime rule can. */
  readonly paths: readonly string[];
}

export interface WhyParagraph {
  /** The Choice rows the paragraph names right after its bold lead, as `(row "version")`. */
  readonly rows: readonly string[];
  readonly text: string;
}

export interface Note {
  readonly path: string;
  /** The note as written. */
  readonly text: string;
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
/** The rule's number, `R19` or `Check 3`, as its heading's anchor is made from, or undefined for a rule with none. */
export const numberOf = (rule: WrittenRule): string | undefined =>
  RULE_NUMBER.exec(rule.name)?.[1];
/** What makes two Choice rows' names one: their text, lower case, without code marks. */
export const thingKey = (thing: string): string =>
  thing.replaceAll("`", "").trim().toLowerCase();

/**
 * A table row's cells, split at each `|` outside a code span; an escaped `|` is one, in a code span too, as Markdown
 * renders it.
 */
function cellsOf(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let code = false;
  for (const char of line.trim().replace(/^\||\|$/g, "")) {
    if (char === "`") code = !code;
    if (char === "|" && cell.endsWith("\\")) cell = `${cell.slice(0, -1)}|`;
    else if (char === "|" && !code) {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

/** The first cells of each Choice table of a note as Markdown renders it: a "what we do" table under `## Choice`. */
function choiceTables(text: string): string[][] {
  const marked = new Marked({ gfm: true });
  const tables: string[][] = [];
  let section = "";
  marked.walkTokens(marked.lexer(text), (token) => {
    if (token.type === "heading" && (token as Tokens.Heading).depth === 2)
      section = (token as Tokens.Heading).text.trim();
    else if (token.type === "table" && section === "Choice") {
      const { header, rows } = token as Tokens.Table;
      if (header.some(({ text: cell }) => isWhatWeDo(cell)))
        tables.push(rows.map(([first]) => first?.text ?? ""));
    }
  });
  return tables;
}

/** Whether a table's header cell heads the column that says what the runtime does. */
export const isWhatWeDo = (cell: string): boolean =>
  cell.trim().toLowerCase() === "what we do";

/**
 * The Choice row each first cell of a table is, none for a cell no row has: a row goes to the first cell that has its
 * name, once. `claimed` holds the rows taken by the tables before, and takes these.
 */
export function claimRows<Row extends { id: string; thing: string }>(
  rows: readonly Row[],
  firstCells: readonly string[],
  claimed: Set<string>,
): (Row | undefined)[] {
  return firstCells.map((cell) => {
    const row = rows.find(
      ({ id, thing }) => !claimed.has(id) && thingKey(thing) === thingKey(cell),
    );
    if (row !== undefined) claimed.add(row.id);
    return row;
  });
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

/**
 * The rule numbers a "what we do" cell names: those inside parentheses, as `(M7)` or `(`runtime/currency.feature`, C2)`,
 * those in a clause beside a `.feature` pointer, those after the word rule (`rule M7`) and those a prose clause
 * possesses (`M14's`). A bare `C1` elsewhere, and any code after `conformance-review` or `item` or `lean`, is a step of a
 * review, a lean or an item of another list, and names no rule.
 */
export function rulesNamedIn(cell: string): string[] {
  const named = cell.replace(
    /\b(?:conformance-review|item|lean)\s+(?:item\s+)?(?:Check |[A-Z]{1,2})\d+/g,
    "",
  );
  const pointed = [
    ...[...named.matchAll(/\(([^()]*)\)/g)].map((match) => match[1] ?? ""),
    ...named
      .replace(/\([^()]*\)/g, ";")
      .split(";")
      .filter((clause) => clause.includes(".feature")),
    ...[...named.matchAll(/\brules?\s+(?:Check |[A-Z]{1,2})\d+/g)].map(
      ([match]) => match,
    ),
    ...[...named.matchAll(/\b(?:Check |[A-Z]{1,2})\d+(?='s\b)/g)].map(
      ([match]) => match,
    ),
  ];
  return pointed
    .flatMap((text) => [
      ...text.matchAll(/\b(Check |[A-Z]{1,2})(\d+)(?: to \1(\d+))?\b/g),
    ])
    .flatMap(([, letters = "", from = "", to = from]) =>
      Array.from(
        { length: Math.max(0, Number(to) - Number(from)) + 1 },
        (_, at) => `${letters}${Number(from) + at}`,
      ),
    );
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
    const base = `row-${slugOf(cells[0] ?? "") || "row"}`;
    let id = base;
    for (let again = 2; rows.some((row) => row.id === id); again++)
      id = `${base}-${again}`;
    rows.push({
      thing: cells[0] ?? "",
      id,
      rules: [...new Set(rulesNamedIn(done))].filter((number) =>
        rules.has(number),
      ),
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
  return { path, text, title, rows, why };
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
 * Markdown's code spans, strong text and links, the rest as text. `resolve` gives a link's address from what the note
 * wrote; a link it gives none for is left as its text.
 */
function inline(
  text: string,
  resolve: (href: string) => string | undefined,
): Html {
  return new Html(
    text
      .split(/(`[^`]+`|\*\*.+?\*\*|\[[^\]]+\]\([^)]+\))/)
      .map((part) => {
        const code = /^`([^`]+)`$/.exec(part);
        if (code !== null) return `<code>${escape(code[1] ?? "")}</code>`;
        const strong = /^\*\*(.+)\*\*$/.exec(part);
        if (strong !== null)
          return `<strong>${escape(strong[1] ?? "")}</strong>`;
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
        if (link === null) return escape(part);
        const to = resolve(link[2] ?? "");
        return to === undefined
          ? escape(link[1] ?? "")
          : `<a href="${escape(to)}">${escape(link[1] ?? "")}</a>`;
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
  /** Each rule a Choice row's pointer reached, by note and row's anchor. */
  readonly #reached = new Map<string, Map<string, Citation>>();
  /** Each path a Choice row names that is a file of the vocabulary. */
  readonly #files: ReadonlySet<string>;
  /** Each path a Choice row names in a folder of the vocabulary that holds no such file. */
  readonly #missing: ReadonlySet<string>;
  /** Each rule that says no note rules it, as `runtime/naming.feature N8`. */
  readonly unnoted: string[] = [];
  /** Each Choice row that names no rule but the issue that will write it. */
  readonly waiting: {
    readonly note: string;
    readonly id: string;
    readonly what: string;
  }[] = [];
  /** Each Choice row the note's page has no table row for, by note and row's anchor. */
  readonly #unanchored = new Set<string>();

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
    this.notes = options.notes;
    for (const note of notes.values()) {
      const claimed = new Set<string>();
      for (const cells of choiceTables(note.text))
        claimRows(note.rows, cells, claimed);
      for (const { id, thing } of note.rows) {
        if (claimed.has(id)) continue;
        this.#unanchored.add(`${note.path}\n${id}`);
        this.#warn(
          "row is in no table of the page",
          note.path,
          `row "${thing}" has no row in the table the page renders, so a rule links the note without the row`,
        );
      }
    }
  }

  readonly tree: string;
  readonly notes: string | undefined;

  /** The address of a note: its page when the notes have them and this is one, else the file on GitHub. */
  noteHref(path: string): string {
    const page =
      this.notes !== undefined &&
      (this.#notes.has(path) || path === "decisions/README.md");
    return noteHref(path, page ? (this.notes ?? "") : this.blob);
  }

  /** The address of a note's Choice row: its anchor on the note's page, or the note alone where the page has no row for it. */
  rowHref(path: string, id: string): string {
    const anchored =
      this.notes !== undefined && !this.#unanchored.has(`${path}\n${id}`);
    return `${this.noteHref(path)}${anchored ? `#${id}` : ""}`;
  }

  /** Where a link the note at `from` wrote goes. */
  linkFrom(from: string, href: string): string | undefined {
    return href.startsWith("#")
      ? `${this.noteHref(from)}${href}`
      : noteLinkOf(href, from, {
          blob: this.blob,
          tree: this.tree,
          ...(this.notes === undefined ? {} : { notes: this.notes }),
          has: (path) =>
            this.#notes.has(path) || path === "decisions/README.md",
        });
  }

  /** The notes read, each Choice row with the rules that cite it. */
  decisions(): DecisionNotes {
    return {
      blob: this.blob,
      tree: this.tree,
      notes: [...this.#notes.values()].map((note) => ({
        ...note,
        rows: note.rows.map((row) => ({
          ...row,
          cited: [
            ...(this.#reached.get(`${note.path}\n${row.id}`)?.values() ?? []),
          ],
          anchored: !this.#unanchored.has(`${note.path}\n${row.id}`),
        })),
      })),
    };
  }
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

  /** The result of each of a kit's checks after Check 1, which is its examples. */
  kitCheckResults(folder: string): (SpecResult | undefined)[] {
    return this.features
      .flatMap(({ rules }) => rules)
      .map(numberOf)
      .filter(
        (number) =>
          number?.startsWith("Check ") === true && number !== "Check 1",
      )
      .map((number) => this.check(folder, number ?? ""));
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
    const shown: {
      note: Note | undefined;
      path: string;
      rows: { name: string; id?: string }[];
    }[] = [];
    for (const pointer of pointers) {
      const note = this.#notes.get(pointer.note);
      const rows = pointer.rows.map((name): { name: string; id?: string } => {
        const id = note?.rows.find(
          (r) => thingKey(r.thing) === thingKey(name),
        )?.id;
        return id === undefined ||
          this.#unanchored.has(`${pointer.note}\n${id}`)
          ? { name }
          : { name, id };
      });
      shown.push({ note, path: pointer.note, rows });
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
        const key = `${note.path}\n${row.id}`;
        const cited = this.#reached.get(key) ?? new Map<string, Citation>();
        cited.set(`${feature.path}\n${number}`, {
          feature: feature.path,
          ...(numberOf(rule) === undefined ? {} : { number }),
          name: rule.name,
        });
        this.#reached.set(key, cited);
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
            id: row.id,
            what: `row "${row.thing}" waits on ${row.issues.join(", ")}`,
          });
          continue;
        }
        const by = this.#reached.get(`${note.path}\n${row.id}`);
        this.#warn(
          "row names no rule",
          note.path,
          `row "${row.thing}" names no rule${by === undefined ? "" : `, though ${[...by.values()].map(({ number, name }) => number ?? name).join(", ")} name${by.size === 1 ? "s" : ""} it`}`,
        );
      }
  }
}

function page(spec: Spec, title: string, main: Content): Uint8Array {
  return new TextEncoder().encode(
    shell({
      title: markup`${title} · Cascade runtime rules`,
      stylesheet: SPEC_STYLESHEET_FILE,
      nav: markup`${frontPageLink(1)}
<a href="${SPEC_INDEX}">The rules</a>
${spec.features.map((feature) => markup`<a href="${spec.pageOf(feature.path)}">${feature.name}</a>\n`)}`,
      main: markup`${main}\n`,
    }).text,
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
              markup`${index === 0 ? "" : "; "}<a href="${spec.noteHref(path)}">${note?.title ?? path}</a>${rows.length === 0 ? ", its Why" : markup`, ${rows.length === 1 ? "row" : "rows"} ${rows.map(({ name, id }, i) => markup`${i === 0 ? "" : ", "}${spec.notes === undefined || id === undefined ? markup`<q>${name}</q>` : markup`<a href="${spec.noteHref(path)}#${id}"><q>${name}</q></a>`}`)}`}`,
          )}</p>\n`
}${prose(ruled === undefined ? rule.description : ruled.rest)}${
      ruled === undefined
        ? ""
        : ruled.why === undefined
          ? ruled.shown
              .filter(({ note }) => note !== undefined)
              .map(
                ({ note }) =>
                  markup`<p class="also">Why: <a href="${spec.noteHref(note?.path ?? "")}#why">${note?.title ?? ""}</a>, with the alternatives that lost and what would change our mind.</p>\n`,
              )
          : markup`<blockquote class="why">
<p>${inline(ruled.why.paragraph.text, (href) => spec.linkFrom(ruled.why?.note.path ?? "", href))}</p>
<p class="also"><a href="${spec.noteHref(ruled.why.note.path)}#why">${ruled.why.note.title}</a>: the whole Why, the alternatives that lost and what would change our mind.</p>
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

function featureResult(
  spec: Spec,
  feature: WrittenFeature,
  kit: string | undefined,
): FeatureResult {
  const counted = tally(
    feature.rules.flatMap(({ examples: listed }) =>
      listed.map((e) => spec.result(e)),
    ),
  );
  return {
    path: feature.path,
    name: feature.name,
    page: spec.pageOf(feature.path),
    kit: kit !== undefined,
    rules: feature.rules.length,
    withoutExample: feature.rules.filter(
      ({ examples }) => examples.length === 0,
    ).length,
    passed: counted.passed,
    failed: counted.failed,
    notRun: counted.notRun,
    ...(kit === undefined ? {} : { checks: tally(spec.kitCheckResults(kit)) }),
  };
}

/** The table of each feature's rules and results, whose links to the pages begin with `base`. The spec's index and the conformance page both show it. */
export function resultsTable(
  listed: readonly FeatureResult[],
  base: string,
): Html {
  const checked = listed.some(({ checks }) => checks !== undefined);
  return markup`<table class="results">
<thead><tr><th>feature</th><th>rules</th><th>rules with no example</th><th>examples pass</th><th>examples fail</th><th>examples not run</th>${checked ? markup`<th>checks pass</th><th>checks fail</th><th>checks not run</th>` : ""}</tr></thead>
<tbody>
${listed.map(({ name, page, rules, withoutExample, passed, failed, notRun, checks }) => markup`<tr><td data-label="feature"><a href="${base}${page}">${name}</a></td><td data-label="rules">${rules}</td><td data-label="rules with no example">${withoutExample}</td>${passed + failed + notRun === 0 ? markup`<td data-label="examples" colspan="3" class="about">no example</td>` : markup`<td data-label="examples pass">${passed}</td><td data-label="examples fail">${failed}</td><td data-label="examples not run">${notRun}</td>`}${checked ? markup`<td data-label="checks pass">${checks?.passed ?? ""}</td><td data-label="checks fail">${checks?.failed ?? ""}</td><td data-label="checks not run">${checks?.notRun ?? ""}</td>` : ""}</tr>\n`)}</tbody>
</table>`;
}

/** The repositories a run was made with, as a list under a heading; nothing when it names none. */
export const ranWithList = (
  heading: string,
  listed: readonly Ingredient[],
): Html =>
  listed.length === 0
    ? markup``
    : markup`<p class="about">${heading}</p>
<ul class="about">
${listed.map(({ name, version, href }) => markup`<li><a href="${href}">${name} ${version}</a></li>\n`)}</ul>
`;

function indexPage(
  spec: Spec,
  options: SpecOptions,
  results: readonly FeatureResult[],
): Uint8Array {
  return page(
    spec,
    "The rules",
    markup`<h1>The Cascade runtime rules</h1>
<p class="prose">Every rule of cascade-vocabulary's <code>runtime/</code> features, with the decision note and Choice row
that ruled it, a paragraph of the note's reasons, its examples as written, and the reference runtime's latest result for
each, from the EARL report its conformance run wrote. The conformance kits follow: each person's story, its scripted
input, its expected views and its result. Built from the repositories on every run; never edited by hand.</p>
<h2 class="part">The features</h2>
${resultsTable(
  results.filter(({ kit }) => !kit),
  "",
)}
<h2 class="part">The kits</h2>
${resultsTable(
  results.filter(({ kit }) => kit),
  "",
)}
<h2 class="part" id="warnings">Warnings</h2>
<p class="prose">A rule and the Choice row that ruled it name each other (<a href="${spec.noteHref("decisions/README.md")}">decisions/README.md</a>).
${plural(spec.warnings.length, "place")} where they do not yet:</p>
<ul class="warnings">
${spec.warnings.map(({ kind, where, what }) => markup`<li><span class="about">${kind}</span> ${where === "" ? "" : markup`<a href="${spec.noteHref(where)}">${where}</a>: `}${what}</li>\n`)}</ul>
<p class="prose">${plural(spec.unnoted.length, "rule says", "rules say")} no note rules it, and ${plural(spec.waiting.length, "Choice row waits", "Choice rows wait")} on the issue that will write its rule:</p>
<ul class="warnings">
${spec.unnoted.map((rule) => markup`<li><span class="about">no note rules it</span> ${rule}</li>\n`)}${spec.waiting.map(({ note, id, what }) => markup`<li><span class="about">waits on an issue</span> <a href="${spec.rowHref(note, id)}">${note}</a>: ${what}</li>\n`)}</ul>
<footer>
<p class="about">Built at <time datetime="${options.at}">${options.at}</time> from:</p>
<ul class="about">
${options.builtFrom.map(({ name, version, href }) => markup`<li><a href="${href}">${name} ${version}</a></li>\n`)}</ul>
${ranWithList("The results are of the run with:", options.report.ranWith)}</footer>`,
  );
}

const SPEC_STYLES = `
.result { display: inline-block; min-width: 4.2rem; margin-right: .6rem; padding: 0 .4rem; border-radius: 3px;
          text-align: center; font: 600 .75rem/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; }
.result.passed { background: #e3f4e8; color: #1d6b35; }
.result.failed { background: #fbe5e5; color: #a3201f; }
.result.not-run { background: var(--paper); color: var(--muted); }
section.rule { margin: 2rem 0 0; padding: 1rem 0 0; border-top: 1px solid var(--rule); }
.ruled { color: var(--muted); font-size: .9rem; margin: .25rem 0 .5rem; }
blockquote.why { margin: .75rem 0; padding: .1rem 1rem; border-left: 3px solid var(--rule); max-width: 46rem; }
details.example summary { color: var(--ink); }
details.example pre { margin: .25rem 0 .75rem; }
pre.failure { background: #fdf2f2; white-space: pre-wrap; }
ol.contents { columns: 2 22rem; font-size: .9rem; }
ul.warnings { font-size: .9rem; }
main footer { margin-top: 3rem; border-top: 1px solid var(--rule); }
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
  const results = [
    ...spec.features.map((feature) => featureResult(spec, feature, undefined)),
    ...spec.kits.map(({ folder, feature }) =>
      featureResult(spec, feature, folder),
    ),
  ];
  files.set(SPEC_INDEX, indexPage(spec, options, results));
  files.set(
    SPEC_STYLESHEET_FILE,
    new TextEncoder().encode(STYLESHEET + SPEC_STYLES),
  );
  return {
    files,
    features: results,
    warnings: spec.warnings,
    unnoted: spec.unnoted,
    waiting: spec.waiting,
    decisions: spec.decisions(),
  };
}

/**
 * Of the paths the Choice rows name, those the vocabulary holds, and those in a folder of it that holds no such file;
 * a path whose first folder the vocabulary has not is a pod's or another repository's, and neither.
 */
export async function filesNamed(
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
