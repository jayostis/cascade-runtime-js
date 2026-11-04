// The citation checker: whether a cited record says what is claimed of it, and whether a claim that something is
// absent is backed by what was looked through. A claim names the field it is about (the record's value, status, code,
// name, id, a clinical date of a kind, or words it quotes), and each is compared with that field of the cited record
// only: never a reference range, an interpretation, an update time or a neighbouring record. No Node: the source of a
// citation is a parameter, and the one that reads downloads from disk is `node/downloads.ts`.
import { codeStems } from "./terms.js";

/** Where a citation points: a line of a download, a FHIR resource in one, or a pod entry as a pod's rows name it. */
export type Cite =
  | { readonly file: string; readonly line: number }
  | { readonly file: string; readonly resource: string }
  | { readonly entry: string };

export type DateKind = "when" | "start" | "end" | "recorded";

/** A cited record and what is claimed of it, field by field. A unit is checked only beside a value. */
export interface Claim {
  readonly cite: Cite;
  /** The record's own result: a number as a number, a coded or text result by its code or words. */
  readonly value?: string | number;
  readonly unit?: string;
  /** Its status: final, active, completed, refuted… */
  readonly status?: string;
  /** A code it carries: a LOINC, SNOMED CT, RxNorm, CVX or ICD-10 code. */
  readonly code?: string | number;
  /** Words of its name: the test, condition, drug, vaccine or procedure. */
  readonly name?: string;
  /** Its identifier in its source. */
  readonly id?: string | number;
  /** A date, YYYY-MM-DD, of the kind `dateKind` says: when it happened (the default), started, ended, was recorded. */
  readonly date?: string;
  readonly dateKind?: DateKind;
  /** Words of its text (a report's conclusion, a note, a narrative line), at least two words. */
  readonly quote?: string;
}

/** A record as the checker reads it: each kind of field's values. */
export interface Fields {
  readonly value: readonly string[];
  readonly unit: readonly string[];
  readonly status: readonly string[];
  readonly code: readonly string[];
  readonly name: readonly string[];
  readonly id: readonly string[];
  readonly when: readonly string[];
  readonly start: readonly string[];
  readonly end: readonly string[];
  readonly recorded: readonly string[];
  readonly text: readonly string[];
}

export type Verdict =
  | { readonly ok: true; readonly shows?: string }
  | {
      readonly ok: false;
      readonly reason:
        | "no such record"
        | "not at that line"
        | "says otherwise"
        | "nothing to check"
        | "nothing to check against"
        | "no such field"
        | "no such source"
        | "quote too short";
      /** Each claimed field the record does not hold, as `<field> <claimed>`. */
      readonly missing: readonly string[];
      /** For a line cited, where the file holds a record that does say it: that record's first line. */
      readonly foundAt?: readonly number[];
      /** What the cited record does say, for a reader. */
      readonly shows?: string;
    };

/** The record a citation points at, and for a line, the file's other records. */
export interface Source {
  at(cite: Cite): Promise<Pointed | undefined>;
}

export interface Pointed {
  readonly fields: Fields;
  /** Where the record is from: for a pod entry, the records its values are stated by; for a download, its file. */
  readonly source: readonly string[];
  /** For a line cited, every record of its file with the line it starts on, to say where a claim does hold. */
  readonly others?: readonly {
    readonly line: number;
    readonly fields: Fields;
  }[];
}

/** A claim that a record is absent: what it is (codes and words to look for) and what was looked through. */
export interface Absence {
  readonly what: string;
  readonly coverage: string;
  readonly match: {
    readonly codes?: readonly string[];
    readonly terms?: readonly string[];
    /** Only a record dated on or after this day (YYYY-MM-DD) would count against the absence. */
    readonly after?: string;
  };
  /** The pod arm: the tool call that looked. */
  readonly query?: (Call & { readonly call?: number }) | undefined;
  /** The records arm: the files that were looked through. */
  readonly sources?: readonly string[];
}

/** A tool call as an answer names it. */
export interface Call {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/** A tool call as it ran: whether it answered, and its answer's text. */
export interface Ran extends Call {
  readonly ok: boolean;
  readonly answer: string;
  /** The number the pod command printed with the call's answer, which an absence's query may name. */
  readonly call?: number;
}

/** What a key item says must be absent, which an absence that ties to it is held to, and the kind of record it is. */
export interface Tie {
  readonly codes?: readonly string[];
  readonly terms?: readonly string[];
  readonly after?: string;
  readonly kind?: RecordKind;
}

export type RecordKind =
  "lab" | "immunization" | "procedure" | "condition" | "medication";

/** The kind of record a pod question answers with; undefined for one that answers of several kinds. */
export function kindOfQuestion(question: string): RecordKind | undefined {
  if (/lab results/.test(question)) return "lab";
  if (/immunizations/.test(question)) return "immunization";
  if (/procedures/.test(question)) return "procedure";
  if (/condition/.test(question)) return "condition";
  if (/medication/.test(question)) return "medication";
  return undefined;
}

/**
 * The kind of record a pod tool call answers with; undefined for one that answers of several kinds, as a compact read
 * of every view does: its views each have their own (`kindOfQuestion`), and an absence is held to those of its kind.
 */
export function kindOfCall(call: Call): RecordKind | undefined {
  if (call.tool === "lab_series" || call.tool === "find_changes") return "lab";
  if (call.tool === "timeline") return "medication";
  return kindOfQuestion(String(call.input.question ?? ""));
}

/** The match an absence is held to: its own codes and words, and those of the key item it ties to. */
function heldTo(absence: Absence, tied?: Tie): Absence["match"] {
  const after = absence.match.after ?? tied?.after;
  return {
    codes: [...(absence.match.codes ?? []), ...(tied?.codes ?? [])],
    terms: [...(absence.match.terms ?? []), ...(tied?.terms ?? [])],
    ...(after === undefined ? {} : { after }),
  };
}

const LOINC = /^\d{1,5}-\d$/;

export type Backing =
  | { readonly backed: true }
  | { readonly backed: false; readonly reason: string };

export type Mutable = { -readonly [K in keyof Fields]: string[] };
export const fresh = (): Mutable => ({
  value: [],
  unit: [],
  status: [],
  code: [],
  name: [],
  id: [],
  when: [],
  start: [],
  end: [],
  recorded: [],
  text: [],
});

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** A date written as HL7 digits, ISO or words, as YYYY-MM-DD; undefined when it is none. */
export function isoDate(written: string): string | undefined {
  const text = written.trim();
  const digits = /^(\d{4})(\d{2})(\d{2})(?:\d{4}(?:\d{2})?)?(?!\d)/.exec(text);
  if (digits !== null) return calendar(digits[1]!, digits[2]!, digits[3]!);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso !== null) return calendar(iso[1]!, iso[2]!, iso[3]!);
  const words = /^([A-Za-z]+)\.? (\d{1,2}), (\d{4})$/.exec(text);
  if (words === null) return undefined;
  const at = MONTHS.findIndex((month) =>
    month.startsWith(words[1]!.toLowerCase().slice(0, 3)),
  );
  return at < 0
    ? undefined
    : calendar(
        words[3]!,
        String(at + 1).padStart(2, "0"),
        words[2]!.padStart(2, "0"),
      );
}

/** A real calendar day in a plausible range, as YYYY-MM-DD; a number that only looks like one (a code) is none. */
function calendar(
  year: string,
  month: string,
  day: string,
): string | undefined {
  const at = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number(year) >= 1900 &&
    Number(year) <= 2100 &&
    at.getUTCFullYear() === Number(year) &&
    at.getUTCMonth() === Number(month) - 1 &&
    at.getUTCDate() === Number(day)
    ? `${year}-${month}-${day}`
    : undefined;
}

const lower = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The statuses of a record its source withdrew, as a citation may word them. */
const REFUTED = /^(?:refuted|ruled[- ]out)$/;
const codeOf = (written: string) => lower(written).split(/[/#]/).pop() ?? "";

/** Whether a value holds `want` as whole words, not as a fragment of a word. */
function wholeWords(want: string): (value: string) => boolean {
  const before = /^\w/.test(want) ? "(?<!\\w)" : "";
  const after = /\w$/.test(want) ? "(?!\\w)" : "";
  const whole = new RegExp(`${before}${escaped(want)}${after}`);
  return (value) => whole.test(lower(value));
}

/** Whether the record's values of one kind of field hold the claimed one, compared as that kind. */
function holds(
  kind: keyof Fields,
  claimed: string,
  values: readonly string[],
): boolean {
  const want = lower(claimed);
  switch (kind) {
    case "value":
      return values.some((value) =>
        NUMBER.test(want) && NUMBER.test(value.trim())
          ? Number(want) === Number(value)
          : lower(value) === want ||
            (want.length >= 3 &&
              new RegExp(`(^|\\W)${escaped(want)}($|\\W)`).test(lower(value))),
      );
    case "unit":
    case "id":
      return values.some((value) => lower(value) === want);
    case "status": {
      const refuted = values.some((value) => REFUTED.test(codeOf(value)));
      const said = (value: string) =>
        REFUTED.test(codeOf(value)) ? "refuted" : codeOf(value);
      return refuted
        ? REFUTED.test(codeOf(want))
        : values.some((value) => said(value) === said(want));
    }
    case "code":
      return values.some((value) => codeOf(value) === codeOf(want));
    case "name":
      return want.length >= 3 && values.some(wholeWords(want));
    case "text":
      return values.some(wholeWords(want));
    default:
      return values.some((value) => isoDate(value) === isoDate(claimed));
  }
}

/** Each claimed field, the kind of field it is checked against, and how a reader sees it. */
function wantedOf(claim: Claim): [keyof Fields, string, string][] {
  const wanted: [keyof Fields, string, string][] = [];
  if (claim.value !== undefined) {
    wanted.push(["value", String(claim.value), `value ${claim.value}`]);
    if (claim.unit !== undefined)
      wanted.push(["unit", claim.unit, `unit ${claim.unit}`]);
  }
  for (const kind of ["status", "code", "name", "id"] as const) {
    const claimed = claim[kind];
    if (claimed !== undefined)
      wanted.push([kind, String(claimed), `${kind} ${claimed}`]);
  }
  if (claim.date !== undefined && isoDate(claim.date) !== undefined) {
    const kind = claim.dateKind ?? "when";
    wanted.push([
      kind,
      claim.date,
      `${kind === "when" ? "date" : kind} ${claim.date}`,
    ]);
  }
  if (claim.quote !== undefined && claim.quote.trim().split(/\s+/).length >= 2)
    wanted.push(["text", claim.quote, `quote ${claim.quote}`]);
  return wanted;
}

/** What a record says, in one line a reader can check by eye. */
export function summary(fields: Fields): string {
  const parts: string[] = [];
  if (fields.name.length > 0) parts.push(fields.name[0]!);
  if (fields.value.length > 0)
    parts.push(
      `value ${fields.value.slice(0, 2).join(" / ")}${fields.unit[0] ? ` ${fields.unit[0]}` : ""}`,
    );
  if (fields.status.length > 0)
    parts.push(`status ${[...new Set(fields.status)].slice(0, 2).join(", ")}`);
  const dated = (label: string, values: readonly string[]) => {
    const day = values.map(isoDate).find(Boolean);
    if (day !== undefined) parts.push(`${label} ${day}`);
  };
  dated("on", fields.when);
  dated("ended", fields.end);
  if (parts.length === 0 && fields.text.length > 0)
    parts.push(lower(fields.text[0]!).slice(0, 160));
  return parts.join(" · ");
}

/** Whether a citation points at a record whose own fields say what is claimed. */
export async function checkCitation(
  claim: Claim,
  source: Source,
): Promise<Verdict> {
  const wanted = wantedOf(claim);
  if (wanted.length === 0)
    return { ok: false, reason: "nothing to check", missing: [] };
  const pointed = await source.at(claim.cite);
  if (pointed === undefined)
    return { ok: false, reason: "no such record", missing: [] };
  const shows = summary(pointed.fields);
  const missing = wanted
    .filter(([kind, claimed]) => !holds(kind, claimed, pointed.fields[kind]))
    .map(([, , label]) => label);
  if (missing.length === 0) return { ok: true, shows };
  const foundAt = (pointed.others ?? [])
    .filter(({ fields }) =>
      wanted.every(([kind, claimed]) => holds(kind, claimed, fields[kind])),
    )
    .map(({ line }) => line);
  return foundAt.length > 0
    ? { ok: false, reason: "not at that line", missing, foundAt, shows }
    : { ok: false, reason: "says otherwise", missing, shows };
}

function sameInput(a: unknown, b: unknown): boolean {
  if (
    typeof a !== "object" ||
    a === null ||
    typeof b !== "object" ||
    b === null
  )
    return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) =>
      sameInput(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
    )
  );
}

/** Whether `text` mentions any of an absence's codes (as a whole code) or words. */
export function mentions(text: string, match: Absence["match"]): boolean {
  const said = text.toLowerCase();
  return (
    (match.codes ?? []).some((code) =>
      new RegExp(`(^|[^\\w.-])${escaped(code.toLowerCase())}($|[^\\w-])`).test(
        said,
      ),
    ) ||
    (match.terms ?? []).some(
      (term) => term.trim() !== "" && said.includes(term.toLowerCase()),
    )
  );
}

/** The latest date a text writes, as YYYY-MM-DD; undefined when it writes none. */
function latestDate(text: string): string | undefined {
  const days = [
    ...text.matchAll(/\b\d{4}-\d{2}-\d{2}|\b\d{8}(?:\d{4}(?:\d{2})?)?(?!\d)/g),
    ...text.matchAll(WORDED_DATE),
  ]
    .map(([whole]) => isoDate(whole))
    .filter((day): day is string => day !== undefined);
  return [...days, ...partialDates(text)].sort().pop();
}

/** The last day of each partial date a text writes (a C-CDA value of YYYY or YYYYMM, an ISO YYYY-MM): it is the whole period, so it may be any day of it. */
function partialDates(text: string): string[] {
  const periods = [
    ...[
      ...text.matchAll(
        /<(?:\w+:)?(?:effectiveTime|time|low|high|center)\b[^>]*?\bvalue="(\d{4})(\d{2})?"/g,
      ),
    ].map(([, year, month]) => [year!, month] as const),
    ...[
      ...text.matchAll(
        /(?<![\d-])(19\d\d|20\d\d|2100)-(0[1-9]|1[0-2])(?![\d-])/g,
      ),
    ].map(([, year, month]) => [year!, month] as const),
  ];
  return periods.flatMap(([year, month]) => {
    if (Number(year) < 1900 || Number(year) > 2100) return [];
    if (month === undefined) return [`${year}-12-31`];
    if (Number(month) < 1 || Number(month) > 12) return [];
    const last = new Date(Date.UTC(Number(year), Number(month), 0));
    return [`${year}-${month}-${String(last.getUTCDate()).padStart(2, "0")}`];
  });
}

/** Whether something mentioning the absence counts against it: it is dated on or after its day, or has no date. */
const countsAgainst = (
  text: string,
  match: Absence["match"],
  dated: string = text,
) => {
  if (!mentions(text, match)) return false;
  if (match.after === undefined) return true;
  const latest = latestDate(dated);
  return latest === undefined || latest >= match.after;
};

/** A status that withdraws a record: what it says was not so, so it is no presence. */
const RETRACTED =
  /^(refuted|ruled[- ]out|entered-in-error|nullified|negated)$/i;

/** A record without what says when it was written or retrieved, not when the clinical thing happened: FHIR meta, a C-CDA author, informant or authenticator. */
function clinicalText(fragment: string, json: boolean): string {
  if (!json)
    return fragment.replace(
      /<((?:\w+:)?(?:author|informant|dataEnterer|authenticator|legalAuthenticator))\b[^>]*>[\s\S]*?<\/\1>/g,
      "",
    );
  try {
    return JSON.stringify(
      JSON.parse(fragment, (key, value: unknown) =>
        key === "meta" ? undefined : value,
      ),
    );
  } catch {
    return fragment;
  }
}

/** The fields of a pod row that say where it came from, not what it records: a retrieval date is not the record's. */
const PROVENANCE = new Set(["entry", "sources"]);

/** A compact read's views, each with its count, where its part starts and how many rows it shows. */
interface CompactPage {
  readonly views: readonly {
    readonly question: string;
    readonly total: number;
    readonly offset: number;
    readonly shown: number;
    readonly text: string;
  }[];
  readonly next?: unknown;
}

/** The page an answer is, when it is one of a compact read. */
function compactPage(answer: string): CompactPage | undefined {
  try {
    const value = JSON.parse(answer) as { views?: unknown };
    return Array.isArray(value.views) ? (value as CompactPage) : undefined;
  } catch {
    return undefined;
  }
}

/** The views of a page an absence is held to: those of its kind, or every one when it is of none. */
const viewsOf = (page: CompactPage, kind: RecordKind | undefined) =>
  page.views.filter(
    ({ question }) => kind === undefined || kindOfQuestion(question) === kind,
  );

/** The cells of a compact view that say where a line came from, not what it records: its handle and its sources. */
const COMPACT_PROVENANCE = new Set(["id", "from"]);
/** An entry's handle, which may spell a word or a number by chance. */
const HANDLES = /\b[A-Z][0-9a-f]{8,64}\b/g;
/** The sources a part of a cell starts with. */
const SAID_BY = /^S\d+(?:,S\d+)*(?: |$)/;

/** The columns whose cells are given per source, which the sources that said a part start. */
const PER_SOURCE = new Set([
  "statuses",
  "narrativeTexts",
  "record",
  "otherRecord",
]);

/**
 * A cell without the handles it names and, in a column given per source, the sources that said it. A cell is said by
 * sources only when every part of it starts with them; a text of its own that starts "S1" is no source.
 */
function withoutHandles(cell: string, column: string): string {
  const parts = cell.split("; ");
  const said =
    PER_SOURCE.has(column) && parts.every((part) => SAID_BY.test(part));
  return (said ? parts.map((part) => part.replace(SAID_BY, "")) : parts)
    .join("; ")
    .replace(HANDLES, " ");
}

/** A compact view's lines, each as its cells by the header's names, its handle and sources left out. */
function compactLines(text: string): Record<string, string>[] {
  const [header = "", ...lines] = text.split("\n");
  const names = header.split("\t");
  return lines.filter(Boolean).map((line) =>
    Object.fromEntries(
      line
        .split("\t")
        .map((cell, at) => [names[at] ?? "", cell] as const)
        .filter(([name, cell]) => cell !== "" && !COMPACT_PROVENANCE.has(name)),
    ),
  );
}

/**
 * Whether a tool's answer holds what an absence says is not there: any of its rows, any line of a compact read's views of
 * the absence's kind (each line read alone, so a date on another line counts for nothing), or the whole answer.
 */
function answerHolds(
  answer: string,
  match: Absence["match"],
  kind: RecordKind | undefined,
): boolean {
  const page = compactPage(answer);
  if (page !== undefined)
    return viewsOf(page, kind).some(({ text }) =>
      compactLines(text).some(
        (line) =>
          !RETRACTED.test(line.status ?? "") &&
          countsAgainst(
            Object.entries(line)
              .map(([column, cell]) => withoutHandles(cell, column))
              .join("\t"),
            match,
          ),
      ),
    );
  try {
    const { rows } = JSON.parse(answer) as { rows?: unknown };
    if (Array.isArray(rows))
      return rows.some((row) => {
        const own = Object.fromEntries(
          Object.entries((row ?? {}) as Record<string, unknown>).filter(
            ([name]) => !PROVENANCE.has(name),
          ),
        );
        return (
          !RETRACTED.test(String(own.status ?? "")) &&
          countsAgainst(JSON.stringify(own), match)
        );
      });
  } catch {
    // not rows
  }
  return countsAgainst(answer, match);
}

/** Whether a document holds what an absence says is not there: any of its records, or, with no date bound, its text; a withdrawn record holds nothing. */
function documentHolds(text: string, match: Absence["match"]): boolean {
  const json = /^\s*[{[]/.test(text);
  const records = json ? jsonRecords(text) : ccdaRecords(text);
  const withdrawn = records.filter((it) =>
    it.fields.status.some((status) => RETRACTED.test(status)),
  );
  if (match.after === undefined) {
    let kept = "";
    let at = 0;
    for (const { from, to } of withdrawn.sort((x, y) => x.from - y.from)) {
      if (from < at) continue;
      kept += text.slice(at, from);
      at = to;
    }
    return mentions(kept + text.slice(at), match);
  }
  const live = records.filter((it) => !withdrawn.includes(it));
  return records.length === 0
    ? countsAgainst(text, match)
    : live.some((it) => {
        const fragment = text.slice(it.from, it.to);
        return countsAgainst(fragment, match, clinicalText(fragment, json));
      });
}

const lookedFor = (absence: Absence) =>
  (absence.match.codes ?? []).length +
    (absence.match.terms ?? []).filter((it) => it.trim() !== "").length >
  0;

/** A compact call's input without the row its page starts at: all the pages of one read share the rest. */
const readOf = ({ offset: _, ...rest }: Call["input"]) => rest;

/** The calls that ran the pages of the one compact read a query began: the same tool and input but for the row a page starts at. */
function pagesOf(ran: readonly Ran[], query: Call): Ran[] {
  const read = readOf(query.input);
  return ran.filter(
    (call) =>
      call.ok &&
      call.tool === query.tool &&
      sameInput(readOf(call.input), read) &&
      compactPage(call.answer) !== undefined,
  );
}

/**
 * Whether the pages of one compact read hold every row of the views of the absence's kind, each from its first row to
 * its last with no gap; for an absence of no kind, every page of the read from its start to the one with no next.
 */
function readWhole(
  calls: readonly Ran[],
  kind: RecordKind | undefined,
): boolean {
  if (calls.some(({ input }) => input.entries !== undefined)) return false;
  const pages = calls
    .map((call) => ({
      page: compactPage(call.answer)!,
      from: Number(call.input.offset ?? 0),
    }))
    .sort((a, b) => a.from - b.from)
    .filter(({ from }, at, all) => from !== all[at - 1]?.from);
  const counted = pages.every(({ page }) =>
    page.views.every(({ shown, text }) => compactLines(text).length === shown),
  );
  if (pages.length === 0 || !counted) return false;
  if (kind === undefined)
    return (
      pages[0]!.from === 0 &&
      pages.every(
        ({ page }, at) =>
          (page.next as { offset?: unknown } | undefined)?.offset ===
          pages[at + 1]?.from,
      )
    );
  const parts = new Map<string, { from: number; to: number }[]>();
  const totals = new Map<string, number>();
  for (const { page } of pages)
    for (const { question, total, offset, shown } of viewsOf(page, kind)) {
      parts.set(question, [
        ...(parts.get(question) ?? []),
        { from: offset, to: offset + shown },
      ]);
      totals.set(question, total);
    }
  return (
    parts.size > 0 &&
    [...parts].every(([question, held]) => {
      let end = 0;
      for (const part of held.sort((a, b) => a.from - b.from)) {
        if (part.from > end) return false;
        end = Math.max(end, part.to);
      }
      return end === totals.get(question);
    })
  );
}

/** Whether an answer that is not of a compact read holds every row there is: not cut at a row limit, nor to the entries it asked for. */
function whole(call: Ran): boolean {
  if (call.input.entries !== undefined) return false;
  try {
    const value = JSON.parse(call.answer) as {
      total?: unknown;
      rows?: unknown;
    };
    return !(
      typeof value.total === "number" &&
      Array.isArray(value.rows) &&
      value.total > value.rows.length
    );
  } catch {
    return true;
  }
}

/**
 * The calls an absence's query names: those of its tool and input, and when it names a call by number, only that
 * call, which must be one of them. A number the log does not hold for that query names nothing; it never widens to
 * the other calls.
 */
export function callsFor<T extends Call & { readonly call?: number }>(
  calls: readonly T[],
  query: Call & { readonly call?: number },
): T[] {
  return calls.filter(
    (it) =>
      it.tool === query.tool &&
      sameInput(it.input, query.input) &&
      (query.call === undefined || it.call === query.call),
  );
}

/**
 * Whether a pod's absence is backed: it says what it looks for and what it covered, its query ran and answered (a
 * refusal backs nothing), nothing in the answer matches, and the answer is whole, not cut at a row limit.
 */
export function checkAbsence(
  absence: Absence,
  ran: readonly Ran[],
  tied?: Tie,
): Backing {
  const { query } = absence;
  const match = heldTo(absence, tied);
  const codes = match.codes ?? [];
  const kind =
    tied?.kind ??
    (codes.length > 0 && codes.every((code) => LOINC.test(code))
      ? "lab"
      : undefined);
  if (!lookedFor(absence))
    return { backed: false, reason: "nothing to look for" };
  if (absence.coverage.trim() === "")
    return { backed: false, reason: "no coverage" };
  if (query === undefined) return { backed: false, reason: "no query" };
  const asked = kindOfCall(query);
  if (kind !== undefined && asked !== undefined && asked !== kind)
    return { backed: false, reason: "a question of another kind" };
  const calls = callsFor(ran, query);
  if (calls.length === 0)
    return {
      backed: false,
      reason: query.call === undefined ? "query not run" : "no such call",
    };
  const answered = calls.filter((call) => call.ok);
  if (answered.length === 0) return { backed: false, reason: "query refused" };
  const compact = answered.some(
    (call) => compactPage(call.answer) !== undefined,
  );
  const read = compact ? pagesOf(ran, query) : answered;
  if (read.some((call) => answerHolds(call.answer, match, kind)))
    return { backed: false, reason: "query found it" };
  return (compact ? readWhole(read, kind) : read.some(whole))
    ? { backed: true }
    : { backed: false, reason: "query cut short" };
}

/**
 * Whether a records absence is backed: it says what it looks for and what it covered, names its sources, each was
 * read (`read`), and none of them holds what it says is absent.
 */
export async function checkRecordsAbsence(
  absence: Absence,
  read: readonly string[],
  text: (file: string) => Promise<string>,
  all: readonly string[],
  tied?: Tie,
): Promise<Backing> {
  const match = heldTo(absence, tied);
  if (!lookedFor(absence))
    return { backed: false, reason: "nothing to look for" };
  if (absence.coverage.trim() === "")
    return { backed: false, reason: "no coverage" };
  const sources = absence.sources ?? all;
  const left = all.filter((file) => !sources.includes(file));
  if (left.length > 0)
    return { backed: false, reason: `sources leave out: ${left.join(", ")}` };
  const unread = sources.filter((file) => !read.includes(file));
  if (unread.length > 0)
    return { backed: false, reason: `source not read: ${unread.join(", ")}` };
  const holding: string[] = [];
  for (const file of sources)
    if (documentHolds(await text(file), match)) holding.push(file);
  return holding.length > 0
    ? { backed: false, reason: `records hold it: ${holding.join(", ")}` }
    : { backed: true };
}

// ---- Reading records ----------------------------------------------------------------------------------------------

export const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];
const str = (value: unknown) =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean"
    ? String(value)
    : undefined;
const push = (into: string[], value: unknown) => {
  const text = str(value);
  if (text !== undefined) into.push(text);
};

/** What the pod's compact read calls a code system, by how a FHIR coding (its URL) or a C-CDA code (its OID) names it. */
const SYSTEMS: Readonly<Record<string, string>> = {
  "http://loinc.org": "loinc",
  "2.16.840.1.113883.6.1": "loinc",
  [`${new URL(codeStems.SNOMEDCT).origin}/sct`]: "snomed",
  "2.16.840.1.113883.6.96": "snomed",
  "http://www.nlm.nih.gov/research/umls/rxnorm": "rxnorm",
  "2.16.840.1.113883.6.88": "rxnorm",
  "http://hl7.org/fhir/sid/cvx": "cvx",
  "2.16.840.1.113883.12.292": "cvx",
  "http://hl7.org/fhir/sid/icd-10-cm": "icd10cm",
  "2.16.840.1.113883.6.90": "icd10cm",
  "http://www.ama-assn.org/go/cpt": "cpt",
  "2.16.840.1.113883.6.12": "cpt",
};

/**
 * A code, and beside it system:code as the compact read writes it when the record names its system, so a claim may carry
 * either; a system the record does not name, or one not listed, gives no second form.
 */
function pushCode(into: string[], code: unknown, system: unknown): void {
  push(into, code);
  const bare = str(code);
  const name = SYSTEMS[(str(system) ?? "").replace(/\/$/, "")];
  if (bare !== undefined && name !== undefined) into.push(`${name}:${bare}`);
}

/** A pod's code IRI as the compact read shows it: system:code; undefined for a value that is no code IRI. */
function shownCode(iri: string): string | undefined {
  const plain = iri.replace(/^https:/, "http:");
  for (const [name, stem] of Object.entries(codeStems)) {
    const prefix = stem.replace(/^https:/, "http:");
    if (!plain.startsWith(prefix)) continue;
    const code = plain.slice(prefix.length);
    if (code === "" || code.includes("/")) return undefined;
    const own = /\/codes\/([^/]+)\/$/.exec(stem)?.[1];
    return `${own ?? SHOWN_AS[name] ?? name.toLowerCase()}:${code}`;
  }
  return undefined;
}

/** What the compact read calls a code system whose stem does not end in its name. */
const SHOWN_AS: Readonly<Record<string, string>> = { SNOMEDCT: "snomed" };

/** A CodeableConcept's codes into `code`, and its text and displays into each of `kinds`. */
function concept(
  into: Mutable,
  kinds: readonly ("value" | "name" | "status")[],
  value: unknown,
): void {
  const { text, coding } = (value ?? {}) as {
    text?: unknown;
    coding?: unknown;
  };
  for (const kind of kinds) push(into[kind], text);
  for (const one of asArray(coding)) {
    const { code, display, system } = one as {
      code?: unknown;
      display?: unknown;
      system?: unknown;
    };
    pushCode(into.code, code, system);
    for (const kind of kinds) {
      push(into[kind], display);
      if (kind !== "name") push(into[kind], code);
    }
  }
}

/** A FHIR resource's fields: its value[x], status, codes, names, ids, clinical dates and text; never meta or ranges. */
export function fhirFields(r: Record<string, unknown>): Fields {
  const f = fresh();
  const values = (holder: Record<string, unknown>) => {
    const { value, unit, code } = (holder.valueQuantity ?? {}) as Record<
      string,
      unknown
    >;
    push(f.value, value);
    push(f.unit, unit);
    push(f.unit, code);
    if (holder.valueCodeableConcept !== undefined)
      concept(f, ["value"], holder.valueCodeableConcept);
    for (const key of [
      "valueString",
      "valueBoolean",
      "valueInteger",
      "valueDateTime",
    ])
      push(f.value, holder[key]);
  };
  values(r);
  for (const component of asArray(r.component))
    values(component as Record<string, unknown>);
  push(f.status, r.status);
  for (const key of ["clinicalStatus", "verificationStatus"])
    concept(f, ["status"], r[key]);
  for (const key of ["code", "medicationCodeableConcept", "vaccineCode"])
    concept(f, ["name"], r[key]);
  for (const name of asArray(r.name)) {
    const { text, family, given } = (name ?? {}) as Record<string, unknown>;
    for (const part of [text, family, ...asArray(given)]) push(f.name, part);
    const whole = [...asArray(given), family]
      .map(str)
      .filter(Boolean)
      .join(" ");
    if (whole !== "") f.name.push(whole);
  }
  push(f.id, r.id);
  push(f.value, r.gender);
  push(f.value, r.deceasedBoolean);
  push(f.end, r.deceasedDateTime);
  for (const identifier of asArray(r.identifier))
    push(f.id, (identifier as { value?: unknown }).value);
  for (const key of [
    "effectiveDateTime",
    "performedDateTime",
    "occurrenceDateTime",
    "onsetDateTime",
    "authoredOn",
    "birthDate",
  ])
    push(f.when, r[key]);
  for (const key of ["onsetDateTime", "authoredOn"]) push(f.start, r[key]);
  const period = (value: unknown) =>
    (value ?? {}) as { start?: unknown; end?: unknown };
  for (const key of ["effectivePeriod", "performedPeriod", "onsetPeriod"]) {
    const { start, end } = period(r[key]);
    push(f.when, start);
    push(f.start, start);
    push(f.end, end);
  }
  const validity = period(
    (r.dispenseRequest as { validityPeriod?: unknown } | undefined)
      ?.validityPeriod,
  );
  push(f.start, validity.start);
  push(f.end, validity.end);
  push(f.end, r.abatementDateTime);
  push(f.end, period(r.abatementPeriod).end);
  for (const key of ["recordedDate", "authoredOn", "issued", "dateAsserted"])
    push(f.recorded, r[key]);
  push(f.text, r.conclusion);
  push(f.text, r.valueString);
  push(f.text, r.description);
  push(f.text, r.patientInstruction);
  for (const key of ["dosageInstruction", "dosage"])
    for (const dose of asArray(r[key])) {
      const { text, patientInstruction } = (dose ?? {}) as Record<
        string,
        unknown
      >;
      push(f.text, text);
      push(f.text, patientInstruction);
    }
  for (const reaction of asArray(r.reaction)) {
    const { description, note } = (reaction ?? {}) as Record<string, unknown>;
    push(f.text, description);
    for (const one of asArray(note))
      push(f.text, (one as { text?: unknown }).text);
  }
  for (const note of asArray(r.note))
    push(f.text, (note as { text?: unknown }).text);
  const div = str((r.text as { div?: unknown } | undefined)?.div);
  if (div !== undefined) f.text.push(div.replace(/<[^>]+>/g, " "));
  return f;
}

const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** A C-CDA entry's fields, its reference ranges left out: value, unit, statusCode, codes, names, ids, times, text. */
export function ccdaFields(xml: string): Fields {
  const f = fresh();
  const own = xml.replace(
    /<(\w+:)?referenceRange\b[\s\S]*?<\/(\w+:)?referenceRange>/g,
    "",
  );
  const tags = (name: string) =>
    [...own.matchAll(new RegExp(`<(?:\\w+:)?(?:${name})\\b[^>]*>`, "g"))].map(
      ([tag]) => tag,
    );
  for (const tag of tags("value")) {
    for (const name of ["value", "code", "displayName"])
      push(f.value, attribute(tag, name));
    push(f.unit, attribute(tag, "unit"));
  }
  for (const [, text] of own.matchAll(
    /<(?:\w+:)?value\b[^>]*>([^<]+)<\/(?:\w+:)?value>/g,
  ))
    f.value.push(text!.trim());
  for (const tag of tags("statusCode")) push(f.status, attribute(tag, "code"));
  if (attribute(/^<[^>]*>/.exec(own)?.[0] ?? "", "negationInd") === "true")
    f.status.push("negated");
  for (const tag of tags("code|translation"))
    pushCode(f.code, attribute(tag, "code"), attribute(tag, "codeSystem"));
  for (const tag of tags("\\w+")) push(f.name, attribute(tag, "displayName"));
  for (const [, text] of own.matchAll(
    /<(?:\w+:)?(?:originalText|name)\b[^>]*>([^<]+)</g,
  ))
    f.name.push(text!.trim());
  for (const tag of tags("id")) push(f.id, attribute(tag, "extension"));
  for (const tag of tags("effectiveTime|birthTime"))
    push(f.when, attribute(tag, "value"));
  for (const tag of tags("low")) {
    push(f.when, attribute(tag, "value"));
    push(f.start, attribute(tag, "value"));
  }
  for (const tag of tags("high")) push(f.end, attribute(tag, "value"));
  for (const [, time] of own.matchAll(AUTHOR_TIME)) push(f.recorded, time);
  for (const [, text] of own.matchAll(
    /<(?:\w+:)?text\b[^>]*>([\s\S]*?)<\/(?:\w+:)?text>/g,
  ))
    f.text.push(text!.replace(/<[^>]+>/g, " "));
  return f;
}

/** The time an author of a C-CDA entry or document wrote it. */
const AUTHOR_TIME =
  /<(?:\w+:)?author\b[^>]*>(?:\s*<(?:\w+:)?(?!time\b)\w+\b[^>]*\/>)*\s*<(?:\w+:)?time\b[^>]*\bvalue="([^"]*)"/g;

/** The author time of a C-CDA document's header, which every entry without an author of its own takes. */
function documentTime(xml: string): string | undefined {
  const body = xml.search(/<(?:\w+:)?(?:component|structuredBody)\b/);
  return [
    ...(body < 0 ? xml : xml.slice(0, body)).matchAll(AUTHOR_TIME),
  ][0]?.[1];
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
const plain = (xml: string) =>
  xml
    .replace(/<[^>]+>/g, " ")
    .replace(
      /&(amp|lt|gt|quot|apos);/g,
      (_all, name: string) => ENTITIES[name] ?? "",
    )
    .replace(/\s+/g, " ")
    .trim();

const WORDED_DATE =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}|\b\d{4}-\d{2}-\d{2}\b/g;
/**
 * What ends the words before "ruled out" when the clause does not say it was: a negator or a modal, then at most
 * "not", "yet", "have", "has", "had", "be", "been" or "to".
 */
const NOT_RULED_OUT =
  /(?:\b(?:not|never|yet|cannot|unable to|should|must|needs? to|to|could|can|may|might|will|would)|n't)(?:\s+(?:not|yet|have|has|had|be|been|to))*\s*$/i;
const STATUS_WORDS =
  /\b(active|completed|stopped|discontinued|inactive|aborted|expired|resolved|final|refuted|ruled out|cancelled|nullified|entered[- ]in[- ]error)\b/gi;

/**
 * A line of a document's narrative, a table row or a list item: its cells (a cell holding one number, with or without
 * a unit, is a value; a range is not), its words, the dates it writes (from or started, a start; stopped, discontinued
 * or ended, an end), its status words and its id.
 */
export function narrativeFields(xml: string): Fields {
  const f = fresh();
  const text = plain(xml);
  f.text.push(text);
  const cells = [
    ...xml.matchAll(/<(?:\w+:)?td\b[^>]*>([\s\S]*?)<\/(?:\w+:)?td>/g),
  ].map(([, cell]) => plain(cell!));
  for (const cell of cells) {
    f.name.push(cell);
    const number = /^(-?\d+(?:\.\d+)?)(?:\s+([^\s(]+))?(?:\s*\(.*\))?$/.exec(
      cell,
    );
    if (number !== null) {
      f.value.push(number[1]!);
      if (number[2] !== undefined) f.unit.push(number[2]);
    } else if (!/\d\s*-\s*\d/.test(cell))
      f.value.push(cell.replace(/\s*\(.*\)$/, ""));
  }
  for (const [, content] of xml.matchAll(
    /<(?:\w+:)?content\b[^>]*>([\s\S]*?)<\/(?:\w+:)?content>/g,
  ))
    f.name.push(plain(content!));
  if (cells.length === 0) {
    f.name.push(text);
    // A result written as prose ("eGFR (CKD-EPI 2021) 61 mL/min/{1.73_m2}, reference >=60 …"): the numbers with a unit
    // before its reference range are its value; the range and the dates after it are not.
    const result = text.split(/\breference\b/i)[0]!;
    for (const [, number, unit] of result.matchAll(
      /(?<![\w.])(-?\d+(?:\.\d+)?)\s+([A-Za-z%[{][^\s,;()]*)/g,
    )) {
      if (
        /^(January|February|March|April|May|June|July|August|September|October|November|December)$/.test(
          unit!,
        )
      )
        continue;
      f.value.push(number!);
      f.unit.push(unit!);
    }
  }
  for (const match of text.matchAll(WORDED_DATE)) {
    f.when.push(match[0]);
    const before = text
      .slice(Math.max(0, match.index - 24), match.index)
      .toLowerCase();
    if (/(from|started|since|start date)\s*$/.test(before))
      f.start.push(match[0]);
    if (
      /(stopped|discontinued|ended|until|expired|end date)\s*(on\s*)?$/.test(
        before,
      )
    )
      f.end.push(match[0]);
    if (
      /(?<![\w-])(?<!\b(?:not|never|no)\s+)(reported|recorded|documented)\s*(on\s*)?,?\s*$/.test(
        before,
      )
    )
      f.recorded.push(match[0]);
  }
  for (const segment of cells.length > 0 ? cells : [text])
    for (const match of segment.matchAll(STATUS_WORDS)) {
      const before = segment.slice(0, match.index).split(/[;.]/).pop()!;
      const after = segment.slice(match.index + match[0].length);
      if (
        (/^ruled out$/i.test(match[0])
          ? NOT_RULED_OUT.test(before)
          : /\b(not|no|never|without)\b/i.test(before)) ||
        /^[\s:?\-(=]*(none|no|not|nil|n\/a|false)(?!\w)/i.test(after)
      )
        continue;
      f.status.push(match[0].toLowerCase().replace(/[- ]/g, "-"));
    }
  const id = /\sID="([^"]+)"/.exec(xml)?.[1];
  if (id !== undefined) f.id.push(id);
  return f;
}

/** The elements of a narrative a line of it is: a table row, a list item, a paragraph. */
const NARRATIVE_ELEMENTS = new Set(["tr", "item", "paragraph"]);

/** The elements a C-CDA entry is, when an entry or an organizer's component holds them. */
const RECORD_ELEMENTS = new Set([
  "observation",
  "substanceAdministration",
  "procedure",
  "act",
  "encounter",
  "supply",
]);

export interface Span {
  readonly from: number;
  readonly to: number;
  readonly fields: Fields;
}

/** The line, from 1, of the character at `offset`, given each line's start. */
export function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** A C-CDA document's records: each entry's act, and each result of an organizer, with its span. */
export function ccdaRecords(xml: string): Span[] {
  const spans: Span[] = [];
  const written = documentTime(xml);
  const recorded = (fields: Fields): Fields =>
    fields.recorded.length > 0 || written === undefined
      ? fields
      : { ...fields, recorded: [written] };
  const stack: {
    name: string;
    from: number;
    record: boolean;
    narrative: boolean;
  }[] = [];
  for (const match of xml.matchAll(
    /<!--[\s\S]*?-->|<(\/?)(?:\w+:)?(\w+)\b[^>]*?(\/?)>/g,
  )) {
    const [whole, closing, name, selfClosing] = match;
    if (name === undefined || whole.startsWith("<?")) continue;
    if (closing === "/") {
      const open = stack.pop();
      if (open?.record === true || open?.narrative === true) {
        const to = match.index + whole.length;
        const fragment = xml.slice(open.from, to);
        spans.push({
          from: open.from,
          to,
          fields: recorded(
            open.record ? ccdaFields(fragment) : narrativeFields(fragment),
          ),
        });
      }
      continue;
    }
    if (selfClosing === "/") continue;
    const parent = stack[stack.length - 1]?.name;
    stack.push({
      name,
      from: match.index,
      record:
        ((RECORD_ELEMENTS.has(name) &&
          (parent === "entry" || parent === "component")) ||
          name === "patientRole") &&
        !stack.some((it) => it.record),
      narrative:
        NARRATIVE_ELEMENTS.has(name) &&
        !stack.some((it) => it.record || it.narrative),
    });
  }
  return spans;
}

/** A JSON file's FHIR resources, each with its span: the objects that carry a resourceType other than Bundle. */
export function jsonRecords(text: string): Span[] {
  const spans: Span[] = [];
  const stack: number[] = [];
  let inString = false;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (inString) {
      if (char === "\\") at++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") stack.push(at);
    else if (char === "}") {
      const from = stack.pop();
      if (from === undefined) continue;
      const body = text.slice(from, at + 1);
      if (!body.includes('"resourceType"')) continue;
      try {
        const value = JSON.parse(body) as Record<string, unknown>;
        if (
          typeof value.resourceType === "string" &&
          value.resourceType !== "Bundle"
        )
          spans.push({ from, to: at + 1, fields: fhirFields(value) });
      } catch {
        // not a whole object
      }
    }
  }
  return spans;
}

/** Whether a download holds any record (a FHIR resource, a C-CDA entry or narrative line): a file that could hold what an absence says is not there. */
export function holdsRecords(text: string): boolean {
  return (
    (/^\s*[{[]/.test(text) ? jsonRecords(text) : ccdaRecords(text)).length > 0
  );
}

/** The kind of field each pod field is, by its local name. */
export const POD_FIELDS: Readonly<Record<string, readonly (keyof Fields)[]>> = {
  resultValue: ["value"],
  resultUnit: ["unit"],
  clinicalStatus: ["status"],
  verificationStatus: ["status"],
  workflowStatus: ["status"],
  lifecycle: ["status"],
  prescribedOrReported: ["status"],
  testCode: ["code"],
  snomedCode: ["code"],
  icd10Code: ["code"],
  rxNormCode: ["code"],
  ndcCode: ["code"],
  vaccineCode: ["code"],
  allergenCode: ["code"],
  testName: ["name"],
  conditionName: ["name"],
  drugName: ["name"],
  procedureName: ["name"],
  vaccineName: ["name"],
  allergen: ["name"],
  resultClinicallyRelevantTime: ["when"],
  procedureDate: ["when"],
  vaccinationOccurrenceTime: ["when"],
  onsetDate: ["when", "start"],
  prescriptionWrittenDate: ["when", "start", "recorded"],
  medicationUseStartDate: ["when", "start"],
  medicationUseEndDate: ["end"],
  abatementDate: ["end"],
  reportName: ["name"],
  reportCode: ["code"],
  reportCodeInOtherSystem: ["code"],
  reportConclusionCode: ["code"],
  reportEffectiveTime: ["when"],
  reportIssuedTime: ["recorded"],
  reportConclusion: ["text"],
  dosage: ["text"],
  noteOrDocumentType: ["code"],
  noteOrDocumentTypeInOtherSystem: ["code"],
  noteOrDocumentTypeName: ["name"],
  noteOrDocumentTitle: ["name"],
  noteOrDocumentContentStatus: ["status"],
  noteOrDocumentDate: ["when"],
  narrativeText: ["text"],
  reactionManifestationText: ["text"],
  reactionManifestationCode: ["code"],
  geneSymbol: ["name"],
  medicationCodeInOtherSystem: ["code"],
  userSelectedCode: ["code"],
  dispensePreparedTime: ["when"],
  dispenseHandedOverTime: ["when"],
  clinvarVariationId: ["id"],
  hgvsCodingDnaExpression: ["code"],
  interpretedDate: ["when"],
  dateOfBirth: ["when"],
  dateOfDeath: ["end"],
  administrativeGender: ["value"],
  deceased: ["value"],
};

/** Pod fields no claim can be checked against: links among records, ranges, interpretations and categories. */
export const POD_NOT_CHECKABLE: readonly string[] = [
  "type",
  "leadMember",
  "mergedFrom",
  "statusFrom",
  "dateFrom",
  "medicationUseStartDateFrom",
  "prescriptionWrittenDateFrom",
  "referenceRange",
  "resultInterpretationCode",
  "reportCategory",
  "allergySeverity",
  "allergyCriticality",
  "wasAttributedTo",
  "authorizingPrescription",
  "acmgClassification",
  "variantInterpreted",
  "RO_0002351",
];

const MEMBER_PREFIX = /^(urn:uuid:\S+) /;

/** A value a pod holds of an entry or of the person: the kind of field it is, and the record that states it, if one does. */
export interface Held {
  readonly kind: keyof Fields;
  readonly value: string;
  /** The member record that states it; none for a value of the entry as a whole, such as a merged result. */
  readonly record?: string;
}

/** What an entry's rows of `entry/What it shows` hold, value by value. */
export function entryHeld(
  rows: readonly Readonly<Record<string, string>>[],
): Held[] {
  const held: Held[] = [];
  for (const row of rows) {
    const name = (row.field ?? "").split(/[#/:]/).pop() ?? "";
    if (row.value === undefined) continue;
    const value =
      name === "lifecycle"
        ? (row.value.split("#").pop() ?? "").replace(/^Medication/, "")
        : row.value;
    const by =
      row.from === undefined || row.from === "" ? {} : { record: row.from };
    for (const kind of POD_FIELDS[name] ?? []) {
      held.push({ kind, value, ...by });
      const shown = kind === "code" ? shownCode(value) : undefined;
      if (shown !== undefined) held.push({ kind: "code", value: shown, ...by });
    }
  }
  return held;
}

/** What the person's row of `pod/The person this pod is about` holds: each part of a column is "<record> <value>". */
export function personHeld(row: Readonly<Record<string, string>>): Held[] {
  const held: Held[] = [];
  for (const [column, text] of Object.entries(row))
    for (const part of text.split("; ")) {
      const value = part.replace(MEMBER_PREFIX, "");
      const record = MEMBER_PREFIX.exec(part)?.[1];
      if (value !== "")
        for (const kind of POD_FIELDS[column] ?? [])
          held.push({
            kind,
            value,
            ...(record === undefined ? {} : { record }),
          });
    }
  return held;
}

/** The fields the values `held` give, by kind. */
export function fieldsOf(held: readonly Held[]): Fields {
  const fields = fresh();
  for (const { kind, value } of held) fields[kind].push(value);
  return fields;
}

/** Whether `quote` is words of one of `texts`, whole words, as a quote's check reads it. */
export const quoted = (quote: string, texts: readonly string[]): boolean =>
  quote.trim() !== "" && holds("text", quote, texts);

/** The fewest words a quote shows anything with, unless the text it is found in is shorter. */
export const QUOTE_WORDS = 3;
const wordsIn = (text: string) => text.match(/\S+/g)?.length ?? 0;

/** Whether a quote found in one of `texts` is three words, or all of a text of fewer. */
export const quoteLongEnough = (
  quote: string,
  texts: readonly string[],
): boolean =>
  texts.some(
    (text) =>
      quoted(quote, [text]) &&
      wordsIn(quote) >= Math.min(QUOTE_WORDS, wordsIn(text)),
  );

/**
 * A pod's entries, each read by `rowsOf` as rows of a field and its value; undefined for an entry there is not. The
 * person has no entry: `personRows` gives the person's row, and a cite of its subject IRI is checked against its
 * own columns, each value being "<source record> <value>" joined by "; ".
 */
export function podRowsSource(
  rowsOf: (
    entry: string,
  ) => Promise<readonly Readonly<Record<string, string>>[] | undefined>,
  personRows?: () => Promise<readonly Readonly<Record<string, string>>[]>,
): Source {
  return {
    async at(cite) {
      if (!("entry" in cite)) return undefined;
      const rows = await rowsOf(cite.entry);
      if (rows === undefined || rows.length === 0) {
        const who = (await personRows?.())?.find(
          (row) => row.subject === cite.entry,
        );
        if (who === undefined) return undefined;
        return {
          fields: fieldsOf(personHeld(who)),
          source: [
            ...new Set(
              Object.values(who).flatMap((text) =>
                text
                  .split("; ")
                  .flatMap((part) => MEMBER_PREFIX.exec(part)?.[1] ?? []),
              ),
            ),
          ],
        };
      }
      return {
        fields: fieldsOf(entryHeld(rows)),
        source: [
          ...new Set(
            rows.flatMap(({ from }) =>
              from === undefined || from === "" ? [] : [from],
            ),
          ),
        ],
      };
    },
  };
}
