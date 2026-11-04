// The reply contract as code: a model's reply held to its schema, and every citation and absence of it checked against
// the sources: the pod's rows and the calls that ran, never the model's own words. No Node; the one source that reads
// downloads from disk is `node/downloads.ts`.
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  type Absence,
  type Backing,
  checkAbsence,
  checkCitation,
  type Claim,
  type Pointed,
  podRowsSource,
  type Ran,
  type Source,
  type Tie,
  type Verdict,
} from "./citations.js";
import { entryOfHandle, HANDLE } from "./pod-tools.js";
import { replySchema } from "./reply-schema.js";

/** A fact of a reply: what a record says in the model's words, where it is, and what is claimed of it, field by field. */
export type ReplyFact = Omit<Claim, "cite"> & {
  readonly cite: Claim["cite"];
  readonly says: string;
  readonly provider: string;
};

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

const validator = new Ajv2020({ allErrors: true, strict: false }).compile(
  replySchema,
);

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

/** The contract's errors for `value`, one line each; empty when it is a reply. */
export function replyErrors(value: unknown): string[] {
  if (!validator(value))
    return (validator.errors ?? []).map(
      (error) => `${error.instancePath || "/"} ${error.message ?? ""}`,
    );
  return repeatedNumbers(value);
}

/** What reads a pod's questions: the pod itself, or a pinned build of the runtime asked in its own process. */
export interface PodAsker {
  ask(question: string): Promise<readonly Readonly<Record<string, string>>[]>;
}

/** The question whose rows give each entry's fields, each with the record that states it. */
export const POD_ENTRY_QUESTION = "entry/What it shows";
/** The question whose row gives the person, who has no entry. */
export const POD_PERSON_QUESTION = "pod/The person this pod is about";

/** Every question the checks read a pod with, which a pinned runtime is asked in one process. */
export const REPLY_QUESTIONS: readonly string[] = [
  POD_ENTRY_QUESTION,
  POD_PERSON_QUESTION,
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

/** What `checkReply` reads: the pod, the calls that ran, the downloads and what an absence is held to beyond its own words. */
export interface ReplyChecking {
  /** Reads the pod's questions; the citations of a pod's entries are checked against its rows. */
  readonly ask?: PodAsker["ask"];
  /** The tool calls that produced the reply, which an absence's query names. */
  readonly ran: readonly Ran[];
  /** Where a citation of a file and line or resource is read, such as `downloadsSource(folder)` from `cascade-runtime`. */
  readonly files?: Source;
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

/** A fact, its verdict, and the record it cited, when there is one and a claim to check it by. */
export interface CheckedFact {
  readonly fact: ReplyFact;
  readonly verdict: Verdict;
  readonly record?: CitedRecord;
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

/** The claim a fact makes, without its words: what the checker compares with the record. */
const claimOf = ({
  says: _says,
  provider: _provider,
  ...claim
}: ReplyFact): Claim => claim;

/**
 * Holds a reply to the contract, then every fact's citation to the record it cites and every absence to what was looked
 * through. A reply that breaks the contract is checked for nothing.
 */
export async function checkReply(
  value: unknown,
  checking: ReplyChecking,
): Promise<CheckedReply> {
  const errors = replyErrors(value);
  if (errors.length > 0) return { errors, items: [] };
  const reply = numberedReply(value) as Reply;
  const { ask, ran, files, tie, backing } = checking;
  const entries =
    ask === undefined
      ? undefined
      : podRowsSource(
          podEntryRows({ ask: (question) => ask(question) }),
          podPersonRows({ ask: (question) => ask(question) }),
        );
  const pointed: Pointed[] = [];
  const watching = (source: Source): Source => ({
    async at(cite) {
      const found = await source.at(cite);
      if (found !== undefined) pointed.push(found);
      return found;
    },
  });
  const items: CheckedItem[] = [];
  for (const point of reply.items) {
    const facts: CheckedFact[] = [];
    for (const fact of point.facts ?? []) {
      const source = "entry" in fact.cite ? entries : files;
      pointed.length = 0;
      const verdict =
        source === undefined
          ? {
              ok: false as const,
              reason: "no such record" as const,
              missing: [],
            }
          : await checkCitation(claimOf(fact), watching(source));
      facts.push({
        fact,
        verdict,
        ...(pointed[0] === undefined
          ? {}
          : {
              record: { fields: pointed[0].fields, source: pointed[0].source },
            }),
      });
    }
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
