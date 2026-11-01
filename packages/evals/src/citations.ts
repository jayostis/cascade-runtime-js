// The citation checker: whether a cited record says what is claimed of it, and whether a claim that something is
// absent is backed by what was looked through. A claim names the field it is about (the record's value, status, code,
// name, id, a clinical date of a kind, or words it quotes), and each is compared with that field of the cited record
// only: never a reference range, an interpretation, an update time or a neighbouring record. The harness checks
// answers with it; an app can check a model's answer before showing it.
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

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
        | "nothing to check";
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

/** The kind of record a pod tool call answers with; undefined for one that answers of several kinds. */
export function kindOfCall(call: Call): RecordKind | undefined {
  if (call.tool === "lab_series" || call.tool === "find_changes") return "lab";
  if (call.tool === "timeline") return "medication";
  const question = String(call.input.question ?? "");
  if (/lab results/.test(question)) return "lab";
  if (/immunizations/.test(question)) return "immunization";
  if (/procedures/.test(question)) return "procedure";
  if (/conditions/.test(question)) return "condition";
  if (/medication/.test(question)) return "medication";
  return undefined;
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

type Mutable = { -readonly [K in keyof Fields]: string[] };
const fresh = (): Mutable => ({
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
  const digits = /^(\d{4})(\d{2})(\d{2})/.exec(text);
  if (digits !== null) return `${digits[1]}-${digits[2]}-${digits[3]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso !== null) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const words = /^([A-Za-z]+)\.? (\d{1,2}), (\d{4})$/.exec(text);
  if (words === null) return undefined;
  const at = MONTHS.findIndex((month) =>
    month.startsWith(words[1]!.toLowerCase().slice(0, 3)),
  );
  return at < 0
    ? undefined
    : `${words[3]}-${String(at + 1).padStart(2, "0")}-${words[2]!.padStart(2, "0")}`;
}

const lower = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    case "status":
      return values.some((value) => codeOf(value) === codeOf(want));
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
    ...text.matchAll(/\b(\d{4}-\d{2}-\d{2})|\b(\d{8})(?:\d{0,6})(?=[^\d]|$)/g),
  ]
    .map(([whole]) => isoDate(whole))
    .filter((day): day is string => day !== undefined && day >= "1900-01-01");
  return days.sort().pop();
}

/** Whether something mentioning the absence counts against it: it is dated on or after its day, or has no date. */
const countsAgainst = (text: string, match: Absence["match"]) => {
  if (!mentions(text, match)) return false;
  if (match.after === undefined) return true;
  const latest = latestDate(text);
  return latest === undefined || latest >= match.after;
};

/** Whether a tool's answer holds what an absence says is not there: any of its rows, or the whole answer. */
function answerHolds(answer: string, match: Absence["match"]): boolean {
  try {
    const { rows } = JSON.parse(answer) as { rows?: unknown };
    if (Array.isArray(rows))
      return rows.some((row) => countsAgainst(JSON.stringify(row), match));
  } catch {
    // not rows
  }
  return countsAgainst(answer, match);
}

/** Whether a document holds what an absence says is not there: any of its records, or, with no date bound, its text. */
function documentHolds(text: string, match: Absence["match"]): boolean {
  if (match.after === undefined) return mentions(text, match);
  const json = /^\s*[{[]/.test(text);
  const records = json ? jsonRecords(text) : ccdaRecords(text);
  return records.length === 0
    ? countsAgainst(text, match)
    : records.some((it) => countsAgainst(text.slice(it.from, it.to), match));
}

const lookedFor = (absence: Absence) =>
  (absence.match.codes ?? []).length +
    (absence.match.terms ?? []).filter((it) => it.trim() !== "").length >
  0;

/** Whether an answer holds every row there is: not cut at a row limit. */
function whole(answer: string): boolean {
  try {
    const value = JSON.parse(answer) as { total?: unknown; rows?: unknown };
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
  if (answered.some((call) => answerHolds(call.answer, match)))
    return { backed: false, reason: "query found it" };
  return answered.some((call) => whole(call.answer))
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

const asArray = (value: unknown): unknown[] =>
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
    const { code, display } = one as { code?: unknown; display?: unknown };
    push(into.code, code);
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
  for (const tag of tags("code|translation"))
    push(f.code, attribute(tag, "code"));
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
  for (const [, text] of own.matchAll(
    /<(?:\w+:)?text\b[^>]*>([\s\S]*?)<\/(?:\w+:)?text>/g,
  ))
    f.text.push(text!.replace(/<[^>]+>/g, " "));
  return f;
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
const STATUS_WORDS =
  /\b(active|completed|stopped|discontinued|inactive|aborted|expired|resolved|final|refuted|cancelled)\b/gi;

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
  }
  for (const [word] of text.matchAll(STATUS_WORDS))
    f.status.push(word.toLowerCase());
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

interface Span {
  readonly from: number;
  readonly to: number;
  readonly fields: Fields;
}

/** The line, from 1, of the character at `offset`, given each line's start. */
function lineAt(starts: readonly number[], offset: number): number {
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
function ccdaRecords(xml: string): Span[] {
  const spans: Span[] = [];
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
          fields: open.record
            ? ccdaFields(fragment)
            : narrativeFields(fragment),
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
function jsonRecords(text: string): Span[] {
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
    (/^s*[{[]/.test(text) ? jsonRecords(text) : ccdaRecords(text)).length > 0
  );
}

/** The downloads in `folder`, cited by file and line or by FHIR resource; a path out of the folder names nothing. */
export function downloadsSource(folder: string): Source {
  const root = resolve(folder);
  const read = new Map<string, Promise<string | undefined>>();
  const fileText = (file: string) => {
    const path = resolve(root, file);
    const inside = relative(root, path);
    if (inside.startsWith("..") || isAbsolute(inside))
      return Promise.resolve(undefined);
    let found = read.get(path);
    if (found === undefined) {
      found = readFile(path, "utf8").catch(() => undefined);
      read.set(path, found);
    }
    return found;
  };
  return {
    async at(cite) {
      if (!("file" in cite)) return undefined;
      const text = await fileText(cite.file);
      if (text === undefined) return undefined;
      const json = /^\s*[{[]/.test(text);
      if ("resource" in cite) {
        if (!json) return undefined;
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return undefined;
        }
        const named = (it: unknown) => {
          const { resourceType, id } = (it ?? {}) as Record<string, unknown>;
          return `${String(resourceType)}/${String(id)}` === cite.resource;
        };
        const resource = named(parsed)
          ? parsed
          : asArray((parsed as { entry?: unknown }).entry)
              .map((it) => (it as { resource?: unknown }).resource)
              .find(named);
        return resource === undefined
          ? undefined
          : { fields: fhirFields(resource as Record<string, unknown>) };
      }
      const starts = [0];
      for (
        let at = text.indexOf("\n");
        at !== -1;
        at = text.indexOf("\n", at + 1)
      )
        starts.push(at + 1);
      if (
        !Number.isInteger(cite.line) ||
        cite.line < 1 ||
        cite.line > starts.length
      )
        return undefined;
      const from = starts[cite.line - 1]!;
      const to =
        cite.line < starts.length ? starts[cite.line]! - 1 : text.length;
      const records = json ? jsonRecords(text) : ccdaRecords(text);
      const others = records
        .map((it) => ({ line: lineAt(starts, it.from), fields: it.fields }))
        .sort((a, b) => a.line - b.line);
      const holding = records
        .filter((it) => it.from <= to && it.to >= from)
        .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
      if (holding !== undefined) return { fields: holding.fields, others };
      const line = fresh();
      line.text.push(text.slice(from, to).replace(/<[^>]+>/g, " "));
      return { fields: line, others };
    },
  };
}

/** The kind of field each pod field is, by its local name. */
export const POD_FIELDS: Readonly<Record<string, readonly (keyof Fields)[]>> = {
  resultValue: ["value"],
  resultUnit: ["unit"],
  clinicalStatus: ["status"],
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

const MEMBER_PREFIX = /^urn:uuid:\S+ /;

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
        const person = fresh();
        for (const [column, text] of Object.entries(who))
          for (const part of text.split("; ")) {
            const value = part.replace(MEMBER_PREFIX, "");
            if (value !== "")
              for (const kind of POD_FIELDS[column] ?? [])
                person[kind].push(value);
          }
        return { fields: person };
      }
      const fields = fresh();
      for (const row of rows) {
        const name = (row.field ?? "").split(/[#/:]/).pop() ?? "";
        if (row.value === undefined) continue;
        const value =
          name === "lifecycle"
            ? (row.value.split("#").pop() ?? "").replace(/^Medication/, "")
            : row.value;
        for (const kind of POD_FIELDS[name] ?? []) fields[kind].push(value);
      }
      return { fields };
    },
  };
}
