// The compact read: views `ask` offers, in one answer a page at a time, as tab-separated rows. It composes the questions
// `ask` already asks, rewriting their rows only, and mints no query: each question is still asked once, in the
// vocabulary. Every column a view gives is rendered by the same rules, so a column a view gains needs no change here.
import { Refusal } from "@cascade-runtime/runtime/refusal";
import type { Row } from "./pod.js";

/** The question whose rows name each entry's records and the documents they came from. */
export const PROVENANCE_QUESTION = "entry/Where it came from";

/** The most characters one answer of the compact read holds as JSON: under the 30,000 a shell's output is cut at. */
export const PAGE_CHARACTERS = 24_000;

/** A handle: a letter of the entry's view, then the start of the entry's fragment, at least 8 of its 64 hex digits. */
export const HANDLE = /^([A-Z])([0-9a-f]{8,64})$/;
const SHORTEST = 8;
const ENTRY = /^[^#\s]+#([0-9a-f]{64})$/;

/** The letter of the view an entry is named in: the first of its view file's name (`lab-results.ttl#…`, L). */
function letterOf(entry: string): string {
  const file = entry.split("#")[0]!.split("/").pop() ?? "";
  return /[a-z]/i.test(file[0] ?? "") ? file[0]!.toUpperCase() : "E";
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The entry `handle` names among `members`, each an entry with a record merged into it: the one entry whose fragment
 * starts with the handle's digits and whose view has its letter; failing that, a handle minted before a record that
 * sorts first joined the entry, so the entry holding the one record whose name's SHA-256 starts with them (an entry's
 * fragment is the SHA-256 of its least member's name). Undefined when it names none, or more than one.
 */
export async function entryOfHandle(
  handle: string,
  members: readonly { readonly entry: string; readonly record?: string }[],
): Promise<string | undefined> {
  const parts = HANDLE.exec(handle);
  if (parts === null) return undefined;
  const [, letter, digits] = parts as unknown as [string, string, string];
  const only = (found: Iterable<string>) => {
    const one = [...new Set(found)].filter((it) => letterOf(it) === letter);
    return one.length === 1 ? one[0] : undefined;
  };
  const named = only(
    members
      .map(({ entry }) => entry)
      .filter((entry) => ENTRY.exec(entry)?.[1]!.startsWith(digits)),
  );
  if (named !== undefined) return named;
  const holding: string[] = [];
  for (const { entry, record } of members)
    if (record !== undefined && (await sha256(record)).startsWith(digits))
      holding.push(entry);
  return only(holding);
}

/** Each entry's handle: its view's letter and the shortest start of its fragment, at least 8, that no other entry's has. */
function handlesOf(entries: Iterable<string>): Map<string, string> {
  const named = [...new Set(entries)]
    .map((entry) => [entry, ENTRY.exec(entry)?.[1]] as const)
    .filter((it): it is readonly [string, string] => it[1] !== undefined)
    .sort(([, a], [, b]) => a.localeCompare(b));
  const shared = (a = "", b = "") => {
    let at = 0;
    while (at < a.length && a[at] === b[at]) at += 1;
    return at;
  };
  return new Map(
    named.map(([entry, digits], at) => [
      entry,
      `${letterOf(entry)}${digits.slice(
        0,
        Math.max(
          SHORTEST,
          shared(digits, named[at - 1]?.[1]) + 1,
          shared(digits, named[at + 1]?.[1]) + 1,
        ),
      )}`,
    ]),
  );
}

/** One view's part of a page: its question, how many rows it has, where this part starts, how many it shows, and them. */
export interface CompactView {
  readonly question: string;
  readonly total: number;
  readonly offset: number;
  readonly shown: number;
  readonly text: string;
}

/** A page of the compact read; `next`, when the read goes on, is the input that asks for the next page. */
export interface CompactAnswer {
  readonly format: "compact";
  readonly about: string;
  readonly sources: string;
  readonly leftOut?: string;
  readonly views: readonly CompactView[];
  readonly next?: Readonly<Record<string, unknown>>;
}

const ABOUT = `Each view's rows are tab-separated, under a header row: one line per entry, newest first by its first date, undated last. A column no row of the view fills is left out; a row's empty cell is a field it lacks, or a text that says only what the row's earlier cells already say (a source's text restating its values). id is the entry's handle: its view's letter and the start of its entry's name. Cite it as the entry ({"entry": "<handle>"}); give handles to ${PROVENANCE_QUESTION} as entries for each one's records and documents. from names the sources the entry's records came from, as sources lists them; a value given per source starts with the sources that gave it ("S1,S3 active"); "in <handle>" names another entry a record is merged into. A report's results are the handles of their entries. Codes are system:code beside their names. A line break in a text is written \\n. total is how many rows a view has, offset where this page's start, shown how many are here; when next is given the read goes on: ask again with it.`;

const SOURCE =
  /^(\S+)(?: from (\S+?))?(?:, (kept by [^,]+|retrieved \S+))?(?:, written by (.+))?$/;
const IRI =
  /pod:\/\/[^\s;,]+#[0-9a-f]{64}|urn:uuid:[0-9a-f-]{36}|ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}/g;
const CODES: readonly (readonly [RegExp, string])[] = [
  [/https?:\/\/loinc\.org\/(?:rdf\/)?([\w-]+)/g, "loinc:$1"],
  [/https?:\/\/snomed\.info\/id\/(\d+)/g, "snomed:$1"],
  [/https:\/\/ns\.cascadeprotocol\.org\/codes\/([\w-]+)\/([\w.-]+)/g, "$1:$2"],
  [/https:\/\/ns\.cascadeprotocol\.org\/cascade#(\w+)/g, "$1"],
];
const DATE = /^\d{4}-\d{2}/;
/** The sources a part of a cell starts with, when one or more of them said it. */
const SAID_BY = /^S\d+(?:,S\d+)* /;
/** An entry's handle within a cell, whose letters and digits are no words. */
const HANDLES = /\b[A-Z][0-9a-f]{8,64}\b/g;
const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/**
 * The words a text says, each as a row's cells and a source's prose would both write it: a number without its leading
 * zeros, a month's name as its number, and the T, Z and UTC of a time left out, so "March 27, 2025 12:00 UTC" says
 * what 2025-03-27T12:00:00Z does.
 */
function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/\p{L}+|\p{N}+/gu) ?? []).flatMap((word) => {
    if (/^\p{N}+$/u.test(word)) return [word.replace(/^0+(?=\d)/, "")];
    if (["t", "z", "utc"].includes(word)) return [];
    const month = MONTHS.indexOf(word.slice(0, 3));
    return month !== -1 &&
      (word.length === 3 ||
        /^(january|february|march|april|june|july|august|september|sept|october|november|december)$/.test(
          word,
        ))
      ? [String(month + 1)]
      : [word];
  });
}

interface Document {
  author?: string;
  retrieved?: string;
  kind?: string;
  /** The import that brought it, which with its author makes its source. */
  from?: string;
}

/** The rows of the compact read's questions, rewritten: handles for entries, sources for records and documents. */
class Rewriter {
  readonly handles: Map<string, string>;
  readonly #recordEntry = new Map<string, string>();
  readonly #recordDocument = new Map<string, string>();
  readonly #documents = new Map<string, Document>();
  readonly #sourceOf = new Map<string, string>();
  /** The entries with a row in this read, whose rows a cell need not restate. */
  readonly shown: Set<string>;
  readonly legend: string;

  constructor(provenance: readonly Row[], views: readonly (readonly Row[])[]) {
    const document = (iri: string) =>
      this.#documents.get(iri) ?? this.#documents.set(iri, {}).get(iri)!;
    for (const row of provenance) {
      if (row.record !== undefined && row.entry !== undefined)
        this.#recordEntry.set(row.record, row.entry);
      if (row.record !== undefined && row.document !== undefined)
        this.#recordDocument.set(row.record, row.document);
      if (row.document === undefined) continue;
      const it = document(row.document);
      it.author ??= row.hospital;
      it.retrieved ??= row.retrieved?.slice(0, 10);
      it.kind ??= row.importLabel;
      it.from ??= row.import;
    }
    for (const rows of views)
      for (const row of rows)
        for (const part of (row.sources ?? "").split("; ")) {
          const [, record, iri, how, writtenBy] = SOURCE.exec(part) ?? [];
          if (record === undefined || iri === undefined) continue;
          if (!this.#recordDocument.has(record))
            this.#recordDocument.set(record, iri);
          const it = document(iri);
          it.author ??= writtenBy;
          if (how?.startsWith("retrieved "))
            it.retrieved ??= how.slice(
              "retrieved ".length,
              "retrieved ".length + 10,
            );
        }
    const sources = new Map<string, string[]>();
    for (const [iri, it] of this.#documents) {
      const key = [
        it.author ?? "",
        it.retrieved ?? "",
        it.kind ?? "",
        it.from ?? iri,
      ].join("\t");
      sources.set(key, [...(sources.get(key) ?? []), iri]);
    }
    const lines: string[] = ["source\twritten by\tretrieved\timport\tdocument"];
    [...sources]
      .sort(
        ([a, x], [b, y]) => a.localeCompare(b) || x[0]!.localeCompare(y[0]!),
      )
      .forEach(([key, iris], at) => {
        const handle = `S${at + 1}`;
        for (const iri of iris) this.#sourceOf.set(iri, handle);
        const [author, retrieved, kind] = key.split("\t");
        lines.push(
          [
            handle,
            author,
            retrieved,
            kind,
            iris.length === 1
              ? iris[0]!.replace(/^ni:\/\/\/sha-256;/, "").slice(0, 8)
              : `${iris.length} documents`,
          ].join("\t"),
        );
      });
    this.legend = lines.join("\n");
    this.handles = handlesOf([
      ...provenance.flatMap(({ entry }) => entry ?? []),
      ...views.flat().flatMap(({ entry }) => entry ?? []),
    ]);
    this.shown = new Set(views.flat().flatMap(({ entry }) => entry ?? []));
  }

  #source(iri: string): string | undefined {
    return this.#sourceOf.get(this.#recordDocument.get(iri) ?? iri);
  }

  /** `text` with every name of an entry, record or document it holds as its handle, and every code as system:code. */
  text(text: string): string {
    return CODES.reduce(
      (it, [code, short]) => it.replace(code, short),
      text,
    ).replace(IRI, (iri) => this.handles.get(iri) ?? this.#source(iri) ?? iri);
  }

  /** A cell: each part a value names an entry, record or document by is rewritten, parts of one value from several sources made one. */
  cell(value: string, entry: string | undefined): string {
    const bySaid = new Map<string, string[]>();
    value.split("; ").forEach((part, at) => {
      const [first = "", rest = ""] = part.split(/ (.*)/s);
      const handle = this.handles.get(first);
      const source = first.startsWith("urn:") ? this.#source(first) : undefined;
      if (source === undefined) {
        bySaid.set(`\u0000${at}`, [
          handle === undefined
            ? this.text(part)
            : this.shown.has(first) || rest === ""
              ? handle
              : `${handle} ${this.text(rest)}`,
        ]);
        return;
      }
      const holder = this.#recordEntry.get(first);
      const said = [
        ...(entry !== undefined && holder !== undefined && holder !== entry
          ? [`in ${this.handles.get(holder) ?? holder}`]
          : []),
        ...(rest === "" ? [] : [this.text(rest)]),
      ].join(" ");
      const sources = bySaid.get(said) ?? bySaid.set(said, []).get(said)!;
      if (!sources.includes(source)) sources.push(source);
    });
    return [...bySaid]
      .map(([said, it]) =>
        said.startsWith("\u0000")
          ? it[0]!
          : `${inOrder(it)}${said === "" ? "" : ` ${said}`}`,
      )
      .join("; ");
  }

  /** The sources of a row's records, as `sources` names them. */
  from(value: string): string {
    return inOrder(
      [...value.matchAll(IRI)].flatMap(([iri]) => this.#source(iri) ?? []),
    );
  }
}

/** Sources by their number, each once, as one cell lists them. */
const inOrder = (sources: readonly string[]) =>
  [...new Set(sources)]
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .join(",");

/** A cell's value on one line: a tab is a space, a line break `\n`. */
const oneLine = (value: string) =>
  value.replace(/\r/g, "").replace(/\t/g, " ").trim().replace(/\n/g, "\\n");

/** A view's rows as header and lines, in date order, with the entry each line is of. */
function rendered(
  rows: readonly Row[],
  rewrite: Rewriter,
): { header: string; lines: { line: string; entry?: string }[] } {
  const order: string[] = [];
  const cells = rows.map((row) => {
    const own = new Map<string, string>();
    const said = new Set<string>();
    let previous = -1;
    for (const [column, value] of Object.entries(row)) {
      const at = order.indexOf(column);
      if (at === -1) order.splice((previous += 1), 0, column);
      else previous = at;
      if (value === undefined || value === "") continue;
      if (["entry", "subject", "sources"].includes(column)) continue;
      if (column.endsWith("Label") && row[column.slice(0, -5)] !== undefined)
        continue;
      if (/(Low|High)$/.test(column) && row[column.replace(/(Low|High)$/, "")])
        continue;
      let text = rewrite.cell(value, row.entry);
      const label = row[`${column}Label`];
      if (label !== undefined && /\b(urn|pod|ni|https?):/.test(text))
        text = label;
      const parts = text.split("; ").filter((part) => {
        const words = wordsOf(part.replace(SAID_BY, "").replace(HANDLES, " "));
        return !(
          words.filter((word) => /\p{L}/u.test(word)).length >= 2 &&
          words.every((word) => said.has(word))
        );
      });
      for (const part of parts)
        for (const word of wordsOf(
          part.replace(SAID_BY, "").replace(HANDLES, " "),
        ))
          said.add(word);
      if (parts.length > 0) own.set(column, oneLine(parts.join("; ")));
    }
    own.set(
      "id",
      row.entry === undefined
        ? (row.subject ?? "")
        : (rewrite.handles.get(row.entry) ?? row.entry),
    );
    if (row.sources !== undefined) own.set("from", rewrite.from(row.sources));
    const dated = Object.entries(row).find(
      ([column, value]) =>
        !["entry", "subject", "sources"].includes(column) &&
        DATE.test(value ?? ""),
    )?.[1];
    return { own, dated, entry: row.entry };
  });
  const columns = [
    "id",
    ...order.filter(
      (column) =>
        column !== "id" &&
        column !== "from" &&
        cells.some(({ own }) => own.has(column)),
    ),
    ...(cells.some(({ own }) => own.get("from")) ? ["from"] : []),
  ];
  const lines = cells.map(({ own, dated, entry }) => ({
    line: columns.map((column) => own.get(column) ?? "").join("\t"),
    after: columns
      .slice(1)
      .map((column) => own.get(column) ?? "")
      .join("\t"),
    dated,
    entry,
  }));
  lines.sort(
    (a, b) =>
      (a.dated === b.dated
        ? 0
        : a.dated === undefined
          ? 1
          : b.dated === undefined
            ? -1
            : b.dated.localeCompare(a.dated)) ||
      a.after.localeCompare(b.after) ||
      (a.entry ?? "").localeCompare(b.entry ?? ""),
  );
  return {
    header: columns.join("\t"),
    lines: lines.map(({ line, entry }) =>
      entry === undefined ? { line } : { line, entry },
    ),
  };
}

/** What the compact read is asked: its questions in order, where a page starts and the entries it is cut to. */
export interface CompactInput {
  readonly questions: readonly string[];
  /** The views it leaves out, each beside the view that holds every one of its entries. */
  readonly leftOut?: Readonly<Record<string, string>>;
  readonly offset?: number;
  readonly entries?: readonly string[];
  /** The input a page's `next` repeats, beside its offset. */
  readonly again: Readonly<Record<string, unknown>>;
}

/** The entries `wanted` names, each by its IRI or its handle among `members`. @throws Refusal for one that names none. */
export async function entriesNamed(
  wanted: readonly string[],
  members: readonly Row[],
): Promise<Set<string>> {
  const pairs = members.flatMap(({ entry, record }) =>
    entry === undefined
      ? []
      : [{ entry, ...(record === undefined ? {} : { record }) }],
  );
  const found = new Set<string>();
  for (const each of wanted) {
    const entry = HANDLE.test(each) ? await entryOfHandle(each, pairs) : each;
    if (entry === undefined)
      throw new Refusal(`no entry of the pod has the handle ${each}`);
    found.add(entry);
  }
  return found;
}

/**
 * A page of the compact read: from `offset`, counted in rows over every view in order, as many rows as fit in
 * `PAGE_CHARACTERS`, each view on it with its count, where its part starts and how many it shows; a view with no rows
 * stands where it falls. A row longer than a page has a page of its own.
 */
export async function compactRead(
  ask: (question: string) => Promise<readonly Row[]>,
  input: CompactInput,
): Promise<CompactAnswer> {
  const [provenance, ...answers] = await Promise.all(
    [PROVENANCE_QUESTION, ...input.questions].map(ask),
  );
  const wanted =
    input.entries === undefined
      ? undefined
      : await entriesNamed(input.entries, provenance!);
  const views = answers.map((rows) =>
    wanted === undefined
      ? rows
      : rows.filter(({ entry }) => entry !== undefined && wanted.has(entry)),
  );
  const rewrite = new Rewriter(provenance!, views);
  const all = views.map((rows, at) => ({
    question: input.questions[at]!,
    ...rendered(rows, rewrite),
  }));
  const leftOut =
    input.leftOut === undefined || Object.keys(input.leftOut).length === 0
      ? undefined
      : `Left out, as every entry of each is in another view: ${Object.entries(
          input.leftOut,
        )
          .map(([subset, whole]) => `${subset} (in ${whole})`)
          .join("; ")}.`;
  const page = {
    format: "compact" as const,
    about: ABOUT,
    sources: rewrite.legend,
    ...(leftOut === undefined ? {} : { leftOut }),
    views: [] as CompactView[],
  };
  const from = input.offset ?? 0;
  const rows = all.reduce((sum, { lines }) => sum + lines.length, 0);
  const next = (offset: number) => ({ ...input.again, offset });
  const size = (text: string) => JSON.stringify(text).length - 2;
  let used =
    JSON.stringify(page).length + JSON.stringify({ next: next(rows) }).length;
  // A view with no rows stands at the row after the views before it: on the page that holds that row, or on the last.
  let pending: CompactView[] = [];
  let start = 0;
  let to = from;
  for (const { question, header, lines } of all) {
    const end = start + lines.length;
    if (end <= from && !(lines.length === 0 && start === from)) {
      start = end;
      continue;
    }
    const offset = Math.max(0, from - start);
    const cost =
      JSON.stringify({ question, total: lines.length, offset, shown: 0 })
        .length +
      12 +
      size(header);
    if (used + cost > PAGE_CHARACTERS && to > from) break;
    used += cost;
    if (lines.length === 0) {
      pending.push({ question, total: 0, offset: 0, shown: 0, text: "" });
      continue;
    }
    const shown: string[] = [];
    for (let at = offset; at < lines.length; at += 1) {
      const more = size(`\n${lines[at]!.line}`);
      if (used + more > PAGE_CHARACTERS && to > from) break;
      used += more;
      shown.push(lines[at]!.line);
      to += 1;
    }
    if (shown.length === 0) break;
    page.views.push(...pending, {
      question,
      total: lines.length,
      offset,
      shown: shown.length,
      text: [header, ...shown].join("\n"),
    });
    pending = [];
    start = end;
    if (offset + shown.length < lines.length) break;
  }
  if (to === rows) page.views.push(...pending);
  return to < rows ? { ...page, next: next(to) } : page;
}
