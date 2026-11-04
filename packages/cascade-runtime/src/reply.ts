// The reply contract as code: a model's reply held to its schema, and every fact and absence of it checked against the
// sources: the pod's rows and the calls that ran, never the model's own words. A reply about a pod points: each fact
// names an entry and a field, and what a reader sees of it (its value, date, name and source) is read from the pod. A
// reply about downloads copies what a file says, and the copy is checked. No Node; the one source that reads downloads
// from disk is `node/downloads.ts`.
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import {
  type Absence,
  type Backing,
  checkAbsence,
  checkCitation,
  type Claim,
  type DateKind,
  entryHeld,
  type Fields,
  fieldsOf,
  type Held,
  isoDate,
  personHeld,
  podRowsSource,
  type Pointed,
  quoted,
  quoteLongEnough,
  type Ran,
  type Source,
  summary,
  type Tie,
  type Verdict,
} from "./citations.js";
import { type CompactSources, compactSources } from "./compact-read.js";
import {
  COMPACT_QUESTIONS,
  entryOfHandle,
  HANDLE,
  PROVENANCE_QUESTION,
} from "./pod-tools.js";
import {
  FACT_FIELDS,
  recordsReplySchema,
  replySchema,
} from "./reply-schema.js";

/** The field of an entry a fact about a pod rests on. */
export type FactField = (typeof FACT_FIELDS)[number];

/**
 * A fact of a reply about a pod: what an entry says in the model's words, the entry, the one field the point rests on,
 * and the source and words it rests on where it rests on one source or on text. The rest a reader sees of it is the
 * pod's (`FilledFact`).
 */
export interface PodReplyFact {
  readonly says: string;
  readonly cite: { readonly entry: string };
  readonly field: FactField;
  /** For an entry from several sources, the one whose word the point rests on, by its short name in a read's legend. */
  readonly source?: string;
  /** Words of the entry's text, copied exactly. */
  readonly quote?: string;
}

/** A fact of a reply about downloads: what a record says, where it is, and what is claimed of it, field by field. */
export type RecordsReplyFact = Omit<Claim, "cite"> & {
  readonly cite: Claim["cite"];
  readonly says: string;
  readonly provider: string;
};

export type ReplyFact = PodReplyFact | RecordsReplyFact;

/** Whether a fact points at a pod's entry and copies nothing, as a fact of a reply about a pod does. */
export const pointsAtEntry = (fact: ReplyFact): fact is PodReplyFact =>
  "field" in fact;

/** A model's reply to one question: the answer, its short form, and each point with its chain. */
export interface Reply {
  readonly answer: string;
  readonly short: string;
  readonly items: readonly {
    readonly n: number;
    readonly says: string;
    readonly why: string;
    readonly confidence: string;
    readonly facts?: readonly ReplyFact[];
    readonly absences?: readonly Absence[];
    readonly knowledge?: { readonly says: string; readonly guideline?: string };
    readonly links?: readonly {
      readonly from: number;
      readonly to: number;
      readonly says: string;
    }[];
  }[];
  /** Links the model states between facts of different items. */
  readonly links?: readonly {
    readonly from: { readonly item: number; readonly fact: number };
    readonly to: { readonly item: number; readonly fact: number };
    readonly says: string;
  }[];
}

/** Which contract a reply is held to: about a pod (it points), or about downloads (it cites a file and copies). */
export type ReplyContract = "pod" | "records";

let ajv: Ajv2020 | undefined;
const compiled = new Map<ReplyContract, ValidateFunction>();
/** A contract's validator, compiled when a reply is first held to it. */
function validator(contract: ReplyContract): ValidateFunction {
  let validate = compiled.get(contract);
  if (validate === undefined) {
    ajv ??= new Ajv2020({
      allErrors: true,
      strict: false,
      formats: { date: /^\d{4}-\d{2}-\d{2}$/ },
    });
    validate = ajv.compile(
      contract === "pod" ? replySchema : recordsReplySchema,
    );
    compiled.set(contract, validate);
  }
  return validate;
}

/**
 * A reply with every item numbered: an item's own `n` is kept, one without is numbered by its place, from 1. The one
 * place a reply's numbering is decided; every reader loads a reply through it.
 */
export function numberedReply(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const { items } = value as { items?: unknown };
  if (!Array.isArray(items)) return value;
  return {
    ...value,
    items: items.map((item: unknown, at) =>
      typeof item === "object" && item !== null && !("n" in item)
        ? { n: at + 1, ...item }
        : item,
    ),
  };
}

/** The numbers more than one item of a valid reply carries, as error lines. */
function repeatedNumbers(reply: unknown): string[] {
  const seen = new Set<number>();
  const repeated = new Set<number>();
  for (const item of (numberedReply(reply) as { items: { n: number }[] }).items)
    (seen.has(item.n) ? repeated : seen).add(item.n);
  return [...repeated].map(
    (n) =>
      `/items more than one item has n ${n} (an item without n is numbered by its place)`,
  );
}

/** What a reply about a pod must be that its schema, kept to what structured output takes, cannot say. */
function beyondItsSchema(reply: Reply): string[] {
  const errors: string[] = [];
  const at = (path: string, message: string) =>
    errors.push(`${path} ${message}`);
  if (reply.answer.trim() === "")
    at("/answer", "must NOT have fewer than 1 characters");
  if (reply.short.trim() === "")
    at("/short", "must NOT have fewer than 1 characters");
  if (reply.items.length > 10) at("/items", "must NOT have more than 10 items");
  reply.items.forEach((item, i) => {
    if (item.n !== undefined && item.n < 1) at(`/items/${i}/n`, "must be >= 1");
    if (item.says.trim() === "")
      at(`/items/${i}/says`, "must NOT have fewer than 1 characters");
    (item.absences ?? []).forEach((absence, j) => {
      if (Object.keys(absence.match).length === 0)
        at(
          `/items/${i}/absences/${j}/match`,
          "must NOT have fewer than 1 properties",
        );
      const call = absence.query?.call;
      if (call !== undefined && call < 1)
        at(`/items/${i}/absences/${j}/query/call`, "must be >= 1");
    });
    (item.links ?? []).forEach((link, j) => {
      if (link.from < 0 || link.to < 0)
        at(`/items/${i}/links/${j}`, "must name facts from 0");
    });
  });
  (reply.links ?? []).forEach((link, j) => {
    if (
      link.from.item < 1 ||
      link.to.item < 1 ||
      link.from.fact < 0 ||
      link.to.fact < 0
    )
      at(`/links/${j}`, "must name items from 1 and facts from 0");
  });
  return errors;
}

/** The contract's errors for `value`, one line each; empty when it is a reply. A reply is about a pod unless said. */
export function replyErrors(
  value: unknown,
  contract: ReplyContract = "pod",
): string[] {
  const validate = validator(contract);
  if (!validate(value))
    return (validate.errors ?? []).map(
      (error) => `${error.instancePath || "/"} ${error.message ?? ""}`,
    );
  return [
    ...(contract === "pod" ? beyondItsSchema(value as Reply) : []),
    ...repeatedNumbers(value),
  ];
}

/** What reads a pod's questions: the pod itself, or a pinned build of the runtime asked in its own process. */
export interface PodAsker {
  ask(question: string): Promise<readonly Readonly<Record<string, string>>[]>;
}

/** The question whose rows give each entry's fields, each with the record that states it. */
export const POD_ENTRY_QUESTION = "entry/What it shows";
/** The question whose row gives the person, who has no entry. */
export const POD_PERSON_QUESTION = "pod/The person this pod is about";

/**
 * Every question the checks read a pod with, which a pinned runtime is asked in one process: each entry's fields, the
 * person, and what a whole compact read asks, by which its sources are named.
 */
export const REPLY_QUESTIONS: readonly string[] = [
  ...new Set([
    POD_ENTRY_QUESTION,
    POD_PERSON_QUESTION,
    PROVENANCE_QUESTION,
    ...COMPACT_QUESTIONS,
  ]),
];

/**
 * The entry a cite names: its IRI as given, or the entry a compact read's handle names, looked up among the entries
 * `entry/What it shows` gives and the records merged into each (`entryOfHandle`).
 */
export function podEntryNamed(pod: PodAsker) {
  let all: Promise<readonly Readonly<Record<string, string>>[]> | undefined;
  return async (cited: string) => {
    if (!HANDLE.test(cited)) return cited;
    all ??= pod.ask(POD_ENTRY_QUESTION);
    return entryOfHandle(
      cited,
      (await all).flatMap(({ entry, from }) =>
        entry === undefined
          ? []
          : [{ entry, ...(from === undefined ? {} : { record: from }) }],
      ),
    );
  };
}

/** The rows `entry/What it shows` gives of the entry a cite names: each field, its value and the record it is from. */
export function podEntryRows(pod: PodAsker) {
  let all: Promise<readonly Readonly<Record<string, string>>[]> | undefined;
  const named = podEntryNamed(pod);
  return async (cited: string) => {
    all ??= pod.ask(POD_ENTRY_QUESTION);
    const entry = await named(cited);
    const rows = (await all).filter((row) => row.entry === entry);
    return rows.length === 0 ? undefined : rows;
  };
}

/** The row `pod/The person this pod is about` gives, which names no entry: the person is cited by its subject IRI. */
export function podPersonRows(pod: PodAsker) {
  let all: Promise<readonly Readonly<Record<string, string>>[]> | undefined;
  return () => (all ??= pod.ask(POD_PERSON_QUESTION));
}

/**
 * What `checkReply` reads, which says the contract a reply is held to: the pod for a reply about a pod, the downloads
 * for one about downloads; and the calls that ran and what an absence is held to beyond its own words.
 */
export type ReplyChecking = ReplyCheckingBeyondSources &
  (
    | {
        /** Reads the pod's questions: the reply is about the pod, and each fact is read from the entry it names. */
        readonly ask: PodAsker["ask"];
        readonly files?: undefined;
        readonly copied?: undefined;
      }
    | {
        /**
         * Reads the pod's questions for a reply written before facts pointed: it copies what an entry says, citing the
         * entry by its IRI, and is held to the contract that copies. For an answer a recorded run was given.
         */
        readonly ask: PodAsker["ask"];
        readonly files?: Source;
        readonly copied: true;
      }
    | {
        readonly ask?: undefined;
        /** Where a citation of a file and line or resource is read, such as `downloadsSource(folder)`: the reply is about downloads. */
        readonly files: Source;
        readonly copied?: undefined;
      }
  );

interface ReplyCheckingBeyondSources {
  /** The tool calls that produced the reply, which an absence's query names. */
  readonly ran: readonly Ran[];
  /** What an absence is also held to: the codes, words, kind and date of what must be absent. */
  readonly tie?: (absence: Absence) => Tie | undefined;
  /** Backs an absence otherwise than by the calls that ran, as a reply about files does: by the files looked through. */
  readonly backing?: (
    absence: Absence,
    tie: Tie | undefined,
  ) => Backing | Promise<Backing>;
}

/** The record a citation pointed at: its own fields and where it is from. */
export type CitedRecord = Pick<Pointed, "fields" | "source">;

/**
 * What the pod holds of the entry a fact about a pod names, as a reader is shown it: never the model's words. Of the
 * named source only, when the fact names one; each part present only when the entry holds it.
 */
export interface FilledFact {
  /** The entry, by its IRI; the person, by its subject IRI. */
  readonly entry: string;
  /** Its name: the test, condition, drug, vaccine, procedure or document. */
  readonly label?: string;
  /** Its own result, with its unit. */
  readonly value?: string;
  /** Its day, YYYY-MM-DD: of the kind the fact names when it names a date, else when it happened. */
  readonly date?: string;
  readonly dateKind?: DateKind;
  /** The named field's values, each once, as the pod holds them. */
  readonly held: readonly string[];
  /** The sources they are from, each by its short name in a whole compact read and who wrote it: "S3 Fernhill Family Clinic". */
  readonly sources: readonly string[];
}

/** A fact, its verdict, the record it cited when there is one, and for a fact about a pod, what the pod holds of it. */
export interface CheckedFact {
  readonly fact: ReplyFact;
  readonly verdict: Verdict;
  readonly record?: CitedRecord;
  readonly filled?: FilledFact;
}

/** An absence and whether what it says was looked through backs it. */
export interface CheckedAbsence {
  readonly absence: Absence;
  readonly backing: Backing;
}

/** An item of a reply by its number, with each of its facts and absences checked. */
export interface CheckedItem {
  readonly n: number;
  readonly facts: readonly CheckedFact[];
  readonly absences: readonly CheckedAbsence[];
}

/** A reply checked: the contract's errors (and nothing else when there are any), or the reply numbered and its items checked. */
export interface CheckedReply {
  readonly errors: readonly string[];
  readonly reply?: Reply;
  readonly items: readonly CheckedItem[];
}

/** The claim a fact about downloads makes, without its words: what the checker compares with the record. */
const claimOf = ({
  says: _says,
  provider: _provider,
  ...claim
}: RecordsReplyFact): Claim => claim;

/** The kind of field each field a fact may name is checked as. */
const KIND: Readonly<Record<FactField, keyof Fields>> = {
  value: "value",
  status: "status",
  code: "code",
  name: "name",
  id: "id",
  date: "when",
  start: "start",
  end: "end",
  recorded: "recorded",
  text: "text",
};
const DATES: readonly DateKind[] = ["when", "start", "end", "recorded"];

const once = <T>(values: readonly T[]) => [...new Set(values)];
const bySourceNumber = (a: string, b: string) =>
  Number(a.slice(1)) - Number(b.slice(1));

/**
 * A fact about a pod against what the pod holds of its entry: the named source is one of the entry's, the named field
 * is held (by that source, when one is named; a value of the entry as a whole is every source's), and a quote is words
 * of its text. What it holds comes back filled, for a reader, whatever the verdict.
 */
function pointedAt(
  fact: PodReplyFact,
  entry: string,
  held: readonly Held[],
  sources: CompactSources,
): Omit<CheckedFact, "fact"> {
  const sourceOf = ({ record }: Held) =>
    record === undefined ? undefined : sources.of(record);
  const named = fact.source;
  const known =
    named === undefined || held.some((it) => sourceOf(it) === named);
  const theirs =
    named === undefined || !known
      ? held
      : held.filter((it) => it.record === undefined || sourceOf(it) === named);
  const fields = fieldsOf(theirs);
  const kind = KIND[fact.field];
  const values = once(fields[kind]);
  const value = fields.value[0];
  const dateKind = DATES.includes(kind as DateKind)
    ? (kind as DateKind)
    : DATES.find((each) => fields[each].some((it) => isoDate(it)));
  const date =
    dateKind === undefined
      ? undefined
      : fields[dateKind].map(isoDate).find(Boolean);
  const filled: FilledFact = {
    entry,
    ...(fields.name[0] === undefined ? {} : { label: fields.name[0] }),
    ...(value === undefined
      ? {}
      : {
          value:
            fields.unit[0] === undefined ? value : `${value} ${fields.unit[0]}`,
        }),
    ...(date === undefined ? {} : { date, dateKind: dateKind! }),
    held: values,
    sources: once(theirs.flatMap((it) => sourceOf(it) ?? []))
      .sort(bySourceNumber)
      .map((source) =>
        [source, sources.writtenBy(source)].filter(Boolean).join(" "),
      ),
  };
  const shows = summary(fields);
  const verdict: Verdict = !known
    ? {
        ok: false,
        reason: "no such source",
        missing: [`source ${named}`],
        shows,
      }
    : values.length === 0
      ? {
          ok: false,
          reason: "no such field",
          missing: [
            named === undefined ? fact.field : `${fact.field} from ${named}`,
          ],
          shows,
        }
      : fact.quote !== undefined && !quoted(fact.quote, fields.text)
        ? {
            ok: false,
            reason: "says otherwise",
            missing: [`quote ${fact.quote}`],
            shows,
          }
        : fact.quote !== undefined && !quoteLongEnough(fact.quote, fields.text)
          ? {
              ok: false,
              reason: "quote too short",
              missing: [`quote ${fact.quote}`],
              shows,
            }
          : fact.field === "text" && fact.quote === undefined
            ? {
                ok: false,
                reason: "nothing to check",
                missing: ["quote"],
                shows,
              }
            : { ok: true, shows };
  return {
    verdict,
    record: {
      fields,
      source: once(theirs.flatMap(({ record }) => record ?? [])),
    },
    filled,
  };
}

/**
 * Holds a reply to its contract, then every fact to the record it names and every absence to what was looked through.
 * A reply about a pod (`ask` given) is held to the contract that points, and each fact comes back filled from the pod;
 * one about downloads (`files` given) to the contract that copies. A reply that breaks its contract is checked for nothing.
 */
export async function checkReply(
  value: unknown,
  checking: ReplyChecking,
): Promise<CheckedReply> {
  const { ask, ran, files, tie, backing } = checking;
  if (ask === undefined && files === undefined)
    throw new Error(
      "checkReply needs `ask` (a reply about a pod) or `files` (a reply about downloads); it was given neither",
    );
  const copies = checking.copied === true || ask === undefined;
  const errors = replyErrors(value, copies ? "records" : "pod");
  if (errors.length > 0) return { errors, items: [] };
  const reply = numberedReply(value) as Reply;
  const pod = ask === undefined ? undefined : { ask };
  const rowsOf = pod === undefined ? undefined : podEntryRows(pod);
  const entries =
    pod === undefined || !copies
      ? undefined
      : podRowsSource(rowsOf!, podPersonRows(pod));
  const person = pod === undefined ? undefined : podPersonRows(pod);
  let named: Promise<CompactSources> | undefined;
  const pointed: Pointed[] = [];
  const watching = (source: Source): Source => ({
    async at(cite) {
      const found = await source.at(cite);
      if (found !== undefined) pointed.push(found);
      return found;
    },
  });
  const checkFact = async (
    fact: ReplyFact,
  ): Promise<Omit<CheckedFact, "fact">> => {
    if (pointsAtEntry(fact) && rowsOf !== undefined && person !== undefined) {
      const cited = fact.cite.entry;
      const rows = await rowsOf(cited);
      const who =
        rows === undefined
          ? (await person()).find((row) => row.subject === cited)
          : undefined;
      if (rows === undefined && who === undefined)
        return {
          verdict: {
            ok: false,
            reason: "no such record",
            missing: [`entry ${cited}`],
          },
        };
      named ??= compactSources(ask!);
      return pointedAt(
        fact,
        rows?.[0]?.entry ?? cited,
        rows === undefined ? personHeld(who!) : entryHeld(rows),
        await named,
      );
    }
    const source = pointsAtEntry(fact)
      ? undefined
      : "entry" in fact.cite
        ? entries
        : files;
    if (source === undefined)
      return {
        verdict: {
          ok: false,
          reason: "nothing to check against",
          missing: [],
        },
      };
    pointed.length = 0;
    const verdict = await checkCitation(
      claimOf(fact as RecordsReplyFact),
      watching(source),
    );
    return {
      verdict,
      ...(pointed[0] === undefined
        ? {}
        : {
            record: { fields: pointed[0].fields, source: pointed[0].source },
          }),
    };
  };
  const items: CheckedItem[] = [];
  for (const point of reply.items) {
    const facts: CheckedFact[] = [];
    for (const fact of point.facts ?? [])
      facts.push({ fact, ...(await checkFact(fact)) });
    const absences: CheckedAbsence[] = [];
    for (const absence of point.absences ?? []) {
      const tied = tie?.(absence);
      absences.push({
        absence,
        backing:
          backing === undefined
            ? checkAbsence(absence, ran, tied)
            : await backing(absence, tied),
      });
    }
    items.push({ n: point.n, facts, absences });
  }
  return { errors: [], reply, items };
}
