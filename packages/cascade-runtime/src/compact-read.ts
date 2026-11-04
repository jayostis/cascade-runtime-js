// The compact read: views `ask` offers, in one answer a page at a time, as tab-separated rows. It composes the questions
// `ask` already asks, rewriting their rows only, and mints no query: each question is still asked once, in the
// vocabulary. Every column a view gives is rendered by the same rules, so a column a view gains needs no change here.
import type { Row } from "./pod.js";
import {
  type CompactAnswer,
  type CompactInput,
  type CompactView,
  COMPACT_QUESTIONS,
  entriesNamed,
  handlesOf,
  PAGE_CHARACTERS,
  PROVENANCE_QUESTION,
} from "./pod-tools.js";

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

/** The column of each record's own text; the one column whose parts are left out when they say no more than the row. */
const NARRATIVE_TEXTS = "narrativeTexts";
/** Where one record's part of a cell ends: the next part starts with a record, so a "; " inside a text does not end it. */
const RECORD = /; (?=urn:)/;
/** The tail of a record's label that says when it was received, which a source's text does not. */
const RECEIVED = / · received .*$/;

/** The words of a part without the sources that said it and the handles it names. */
const wordsIn = (part: string) =>
  wordsOf(part.replace(SAID_BY, "").replace(HANDLES, " "));

/** The words a row's cells say: those of a row as a whole, and those each source gave. */
class Said {
  readonly #whole = new Set<string>();
  readonly #by = new Map<string, Set<string>>();

  /** Add the words of `part` to its sources, or to the row as a whole when no source said it. */
  add(part: string, wholeRow = true): void {
    const sources = sourcesOf(part);
    if (sources.length === 0 && !wholeRow) return;
    for (const word of wordsIn(part)) {
      if (sources.length === 0) this.#whole.add(word);
      for (const source of sources) {
        const own =
          this.#by.get(source) ?? this.#by.set(source, new Set()).get(source)!;
        own.add(word);
      }
    }
  }

  /** Whether a part has two or more words of letters, and every word of it is one its own sources said or the row says. */
  restated(part: string): boolean {
    const words = wordsIn(part);
    const sources = sourcesOf(part);
    return (
      words.filter((word) => /\p{L}/u.test(word)).length >= 2 &&
      words.every((word) =>
        sources.length === 0
          ? this.#whole.has(word)
          : sources.every(
              (source) =>
                this.#whole.has(word) || this.#by.get(source)?.has(word),
            ),
      )
    );
  }
}

/** The sources a part of a cell starts with. */
const sourcesOf = (part: string) =>
  SAID_BY.exec(part)?.[0].trim().split(",") ?? [];

/**
 * A record's label without its kind, the name of its author and when it was received or the document it came from,
 * which its handle and the sources give: `kind · name · author · document` or `kind · name · author` once received is cut.
 */
function plainLabel(label: string): string {
  const segments = label.replace(RECEIVED, "").split(" · ");
  return (
    segments.length >= 4
      ? segments.slice(1, -2)
      : segments.length >= 3
        ? segments.slice(1, -1)
        : segments
  ).join(" · ");
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
  /** Who wrote each source's documents, by its short name. */
  readonly writtenBy = new Map<string, string>();

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
        if (author) this.writtenBy.set(handle, author);
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

  /** The short name of the source a record or document is from. */
  sourceOf(iri: string): string | undefined {
    return this.#sourceOf.get(this.#recordDocument.get(iri) ?? iri);
  }

  /** `text` with every name of an entry, record or document it holds as its handle, and every code as system:code. */
  text(text: string): string {
    return CODES.reduce(
      (it, [code, short]) => it.replace(code, short),
      text,
    ).replace(IRI, (iri) => this.handles.get(iri) ?? this.sourceOf(iri) ?? iri);
  }

  /**
   * A cell's parts: each part a value names an entry, record or document by is rewritten, parts of one value from
   * several sources made one. The value is cut where `apart` says, which is "; " unless a part may hold one.
   */
  cell(
    value: string,
    entry: string | undefined,
    apart: string | RegExp = "; ",
  ): string[] {
    const bySaid = new Map<string, string[]>();
    value.split(apart).forEach((part, at) => {
      const [first = "", rest = ""] = part.split(/ (.*)/s);
      const handle = this.handles.get(first);
      const source = first.startsWith("urn:") ? this.sourceOf(first) : undefined;
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
    return [...bySaid].map(([said, it]) =>
      said.startsWith("\u0000")
        ? it[0]!
        : `${inOrder(it)}${said === "" ? "" : ` ${said}`}`,
    );
  }

  /** The sources of a row's records, as `sources` names them. */
  from(value: string): string {
    return inOrder(
      [...value.matchAll(IRI)].flatMap(([iri]) => this.sourceOf(iri) ?? []),
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
    const said = new Said();
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
      const label = row[`${column}Label`];
      // A record is told by its source and its own label, which says what that source wrote of it.
      const named =
        label !== undefined && /^urn:\S+$/.test(value)
          ? `${value} ${plainLabel(label)}`
          : value;
      const narrative = column === NARRATIVE_TEXTS;
      const written = rewrite.cell(named, row.entry, narrative ? RECORD : "; ");
      const parts =
        label !== undefined && /\b(urn|pod|ni|https?):/.test(written.join(" "))
          ? [label]
          : written;
      const shown = narrative
        ? parts.filter((part) => !said.restated(part))
        : parts;
      // A value the row gives for all its sources and each source gives for itself is a merge of theirs, and a
      // status is one no source can be assumed to share: it counts only for the source that states it.
      const merged =
        row[`${column}es`] !== undefined ||
        row[`${column}s`] !== undefined ||
        /status/i.test(column);
      for (const part of shown) said.add(part, !merged);
      if (shown.length > 0) own.set(column, oneLine(shown.join("; ")));
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

/** The sources of a pod's records as a whole compact read names them: each record's source and who wrote it. */
export interface CompactSources {
  /** The short name (`S3`) of the source a record is from; undefined for a record of no document the read names. */
  of(record: string): string | undefined;
  /** Who wrote a source's documents, by its short name. */
  writtenBy(source: string): string | undefined;
}

/** The sources a whole compact read of a pod names, read from the questions that read asks. */
export async function compactSources(
  ask: (question: string) => Promise<readonly Row[]>,
): Promise<CompactSources> {
  const [provenance, ...views] = await Promise.all(
    [PROVENANCE_QUESTION, ...COMPACT_QUESTIONS].map(ask),
  );
  const rewrite = new Rewriter(provenance!, views);
  return {
    of: (record) => rewrite.sourceOf(record),
    writtenBy: (source) => rewrite.writtenBy.get(source),
  };
}
