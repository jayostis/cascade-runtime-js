import { type Database } from "@cascade-runtime/runtime";
import { type Row } from "../perf-rows.js";

/** Every kind of file a pod holds, as the pod's layout places it. */
export const STORED_KINDS = [
  "records",
  "versions",
  "revisions",
  "servers",
  "findings",
  "judgments",
  "matcher-output",
  "references",
  "acts",
  "documents",
  "stored-documents",
  "views",
  "creation-settings",
  "other",
] as const;
export type StoredKind = (typeof STORED_KINDS)[number];

/** The vocabularies a statement's property is counted under. */
export const PREDICATE_VOCABULARIES = [
  "cascade",
  "prov",
  "pav",
  "dct",
  "rdf",
  "other",
] as const;
export type PredicateVocabulary = (typeof PREDICATE_VOCABULARIES)[number];

/** What the files of one kind hold. */
export interface Counted {
  readonly files: number;
  readonly statements: number;
  /** Logical bytes: what the files hold, read back. */
  readonly bytes: number;
}

/** What `pod.db` weighs, where it can be read. */
export interface DatabaseFigures {
  readonly file: number;
  readonly statements?: number;
  readonly terms?: number;
  readonly tables?: number;
  readonly indexes?: number;
  readonly largest?: readonly {
    name: string;
    kind: "table" | "index";
    bytes: number;
  }[];
}

/** Everything counted of one finished pod. */
export interface Stored {
  readonly kinds: Readonly<Record<StoredKind, Counted>>;
  readonly podRecords: number;
  readonly predicates: Readonly<Record<PredicateVocabulary, number>>;
  readonly onDisk: {
    readonly files: number;
    readonly bytes: number;
    readonly blocks: number;
  };
  readonly beside: { readonly files: number; readonly bytes: number };
  readonly database?: DatabaseFigures;
}

const none: Counted = { files: 0, statements: 0, bytes: 0 };

/** The pod in the folder, counted. */
export function storedIn(
  _folder: string,
  _encrypted: boolean,
): Promise<Stored> {
  return Promise.resolve({
    kinds: Object.fromEntries(
      STORED_KINDS.map((kind) => [kind, none]),
    ) as Record<StoredKind, Counted>,
    podRecords: 0,
    predicates: Object.fromEntries(
      PREDICATE_VOCABULARIES.map((each) => [each, 0]),
    ) as Record<PredicateVocabulary, number>,
    onDisk: { files: 0, bytes: 0, blocks: 0 },
    beside: { files: 0, bytes: 0 },
  });
}

/** The rows of one pod's counts, under `stored-<size>[-encrypted]`. */
export function storedRows(
  _name: string,
  _about: string,
  _stored: Stored,
  _entries: number,
): Row[] {
  return [];
}

/** What `pod.db` weighs, from the database and the file's size. */
export function databaseFigures(_db: Database, file: number): DatabaseFigures {
  return { file };
}
