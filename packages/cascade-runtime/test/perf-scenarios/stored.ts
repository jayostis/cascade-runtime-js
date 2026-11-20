import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  type Database,
  EncryptedFiles,
  type Files,
  type Layout,
  type Placement,
  SealedIndex,
} from "@cascade-runtime/runtime";
import { headerIn } from "@cascade-runtime/runtime/node";
import { podKey } from "../../src/encrypted.js";
import { databaseBeside, resolved } from "../../src/node/resolved.js";
import { type Job, type Measured, SECRET } from "../perf-job.js";
import { outputRow, part, type Row, unique } from "../perf-rows.js";

/**
 * Every kind of file a pod holds, as the pod's layout (the vocabulary's `runtime/pod-layout.ttl`) places it. What each is,
 * and whether it counts as the source's data, history, bookkeeping or derived, is said in the glossary's `storedKinds`.
 */
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

const VOCABULARIES: Readonly<Record<string, PredicateVocabulary>> = {
  "https://ns.cascadeprotocol.org/cascade#": "cascade",
  "http://www.w3.org/ns/prov#": "prov",
  "http://purl.org/pav/": "pav",
  "http://purl.org/dc/terms/": "dct",
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#": "rdf",
};

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
/** The properties the layout files a version and a revision by (`cascade:filedWith`). */
const SPECIALIZATION_OF = `${PROV}specializationOf`;
const REVISION_OF = `${CASCADE}revisionOf`;

/** What the files of one kind hold. */
export interface Counted {
  readonly files: number;
  readonly statements: number;
  /** Logical bytes: what the files hold, read back (an encrypted pod's, once opened). */
  readonly bytes: number;
}

/** What `pod.db` weighs, as far as it can be read. */
export interface DatabaseFigures {
  /** The file's size, in bytes. */
  readonly file: number;
  /** The statements and the terms it holds. */
  readonly statements?: number;
  readonly terms?: number;
  /** Bytes its tables and its indexes take, which SQLite's `dbstat` table gives; left out where the build has none. */
  readonly tables?: number;
  readonly indexes?: number;
  /** The largest tables and indexes, largest first. */
  readonly largest?: readonly {
    name: string;
    kind: "table" | "index";
    bytes: number;
  }[];
}

/** Everything counted of one finished pod. */
export interface Stored {
  /** By the kinds of `STORED_KINDS`, the ones the pod has none of at 0. */
  readonly kinds: Readonly<Record<StoredKind, Counted>>;
  /** The files that hold a record's own statements (its type and its source's name for it): not a version, not a revision. */
  readonly podRecords: number;
  /** The statements of version files that link a version to its record. */
  readonly versionLinks: number;
  /** The statements of every file the pod loads, by the vocabulary their property is from. */
  readonly predicates: Readonly<Record<PredicateVocabulary, number>>;
  /** What the folder holds as the disk has it: every file in it, sealed ones included, and the bytes they come to in 4 KiB blocks. */
  readonly onDisk: {
    readonly files: number;
    readonly bytes: number;
    readonly blocks: number;
  };
  /** What is kept beside the pod: its database, its kept build and its kept answers. */
  readonly beside: { readonly files: number; readonly bytes: number };
  /** The pod's database; none for a pod whose database is sealed. */
  readonly database?: DatabaseFigures;
}

/** The blocks a disk allocates in, for the count of what the files come to in whole blocks. */
const BLOCK = 4096;
/** The largest tables and indexes a pod's database row names. */
const LARGEST = 10;
/** The files read at once. */
const AT_ONCE = 64;

/** The files of the pod, read through its sealed index where it has one. */
async function podFiles(
  folder: string,
  encrypted: boolean,
): Promise<{ files: Files; layout: Layout }> {
  const parts = await resolved();
  const { files } = parts.folder(folder);
  if (!encrypted) return { files, layout: parts.layout };
  const header = await headerIn(resolve(folder));
  if (header === undefined) throw new Error(`${folder} holds no pod header`);
  const key = await podKey(
    {
      files,
      header,
      reread: () => headerIn(resolve(folder)),
      held: async () => (await files.list("")).length > 0,
    },
    SECRET,
    parts.derive,
  );
  if (key === undefined) throw new Error(`${folder} did not open`);
  const index = await SealedIndex.open(files, key, {
    laidOut: (path) => parts.layout.uses(path),
  });
  return {
    files: new EncryptedFiles(files, index.key, { index }),
    layout: parts.layout,
  };
}

/** The kind a file's place in the layout gives it; a file of a folder that holds records is `records` until its statements say more. */
function kindOfPlace(layout: Layout, path: string): StoredKind {
  if (layout.inStoredBytes(path)) return "stored-documents";
  if (layout.built.some(({ file }) => file === path)) return "views";
  if (layout.placements.some(({ file }) => file === path))
    return "creation-settings";
  const found = layout.placements
    .filter(
      (placement): placement is Placement & { folder: string } =>
        placement.folder !== undefined && path.startsWith(placement.folder),
    )
    .sort((a, b) => b.folder.length - a.folder.length)[0];
  if (found === undefined) return "other";
  if (found.holdsRecords)
    return found.kind === `${CASCADE}Server` ? "servers" : "records";
  switch (found.kind) {
    case `${CASCADE}Subject`:
      return "creation-settings";
    case `${PROV}Activity`:
      return found.forSubjectsOf === `${PROV}invalidated`
        ? "judgments"
        : "acts";
    case `${CASCADE}SyncFromAnotherWriter`:
      return "acts";
    case `${PROV}Entity`:
      return "documents";
    case `${CASCADE}Judgment`:
      return "judgments";
    case `${CASCADE}MatcherJudgmentAssertion`:
      return "matcher-output";
    case `${CASCADE}ReferenceSeries`:
      return "references";
    case `${CASCADE}FindingForReview`:
      return "findings";
    case `${CASCADE}View`:
      return "views";
    default:
      return "other";
  }
}

/** The property of an N-Triples line: its second term, after a subject that is an IRI or a blank node. */
const PROPERTY = /^(?:<[^>]*>|_:\S+) <([^>]*)>/;

const vocabularyOf = (property: string): PredicateVocabulary => {
  for (const [stem, vocabulary] of Object.entries(VOCABULARIES))
    if (property.startsWith(stem)) return vocabulary;
  return "other";
};

/** Every file under `folder`, with its size. */
async function filesUnder(
  folder: string,
): Promise<{ path: string; bytes: number }[]> {
  const found: { path: string; bytes: number }[] = [];
  const walk = async (at: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) await walk(path);
      else found.push({ path, bytes: (await stat(path)).size });
    }
  };
  await walk(folder);
  return found;
}

const totalOf = (files: readonly { bytes: number }[]) => ({
  files: files.length,
  bytes: files.reduce((sum, { bytes }) => sum + bytes, 0),
});

/** What `pod.db` weighs, from the database and the file's size. */
export function databaseFigures(db: Database, file: number): DatabaseFigures {
  const one = (sql: string): number | undefined => {
    try {
      const found = Number(db.prepare(sql).get()?.n);
      return Number.isFinite(found) ? found : undefined;
    } catch {
      return undefined;
    }
  };
  const statements = one("SELECT COUNT(*) AS n FROM quad");
  const terms = one("SELECT COUNT(*) AS n FROM term");
  let split:
    Pick<DatabaseFigures, "tables" | "indexes" | "largest"> | undefined;
  try {
    // A build of SQLite without the `dbstat` table fails here, and the file's size stays the only figure of its weight.
    const weights = db
      .prepare("SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name")
      .all();
    const types = new Map(
      db
        .prepare("SELECT name, type FROM sqlite_master")
        .all()
        .map((row) => [String(row.name), String(row.type)]),
    );
    const objects = weights
      .map((row) => ({
        name: String(row.name),
        kind: types.get(String(row.name)) === "index" ? "index" : "table",
        bytes: Number(row.bytes),
      }))
      .sort((a, b) => b.bytes - a.bytes) as {
      name: string;
      kind: "table" | "index";
      bytes: number;
    }[];
    const of = (kind: "table" | "index") =>
      objects
        .filter((each) => each.kind === kind)
        .reduce((sum, each) => sum + each.bytes, 0);
    split = {
      tables: of("table"),
      indexes: of("index"),
      largest: objects.slice(0, LARGEST),
    };
  } catch {
    split = undefined;
  }
  return {
    file,
    ...(statements !== undefined && { statements }),
    ...(terms !== undefined && { terms }),
    ...split,
  };
}

/** The pod's database as a plain pod keeps it beside it, when it is there and opens; none for a sealed pod, whose database is sealed. */
async function databaseOf(
  folder: string,
  encrypted: boolean,
  beside: string,
): Promise<DatabaseFigures | undefined> {
  if (encrypted) return undefined;
  const opening = await databaseBeside(folder);
  if (!(await opening.exists())) return undefined;
  const db = opening.open({ functions: [] });
  try {
    return databaseFigures(db, (await stat(join(beside, "pod.db"))).size);
  } finally {
    db.close();
  }
}

/** The pod in the folder, counted: its files by what the layout says they are, their statements, their bytes, and its database. */
export async function storedIn(
  folder: string,
  encrypted: boolean,
): Promise<Stored> {
  const { files, layout } = await podFiles(folder, encrypted);
  const kinds = Object.fromEntries(
    STORED_KINDS.map((kind) => [kind, { files: 0, statements: 0, bytes: 0 }]),
  ) as Record<StoredKind, { files: number; statements: number; bytes: number }>;
  const predicates = Object.fromEntries(
    PREDICATE_VOCABULARIES.map((each) => [each, 0]),
  ) as Record<PredicateVocabulary, number>;
  let podRecords = 0;
  let versionLinks = 0;
  const paths = await files.list("");
  for (let from = 0; from < paths.length; from += AT_ONCE)
    await Promise.all(
      paths.slice(from, from + AT_ONCE).map(async (path) => {
        const bytes = await files.read(path);
        if (bytes === undefined) throw new Error(`${path} is listed and gone`);
        let kind = kindOfPlace(layout, path);
        let statements = 0;
        if (layout.loads(path)) {
          let revision = false;
          let version = false;
          let links = 0;
          for (const line of new TextDecoder().decode(bytes).split("\n")) {
            if (line.trim() === "") continue;
            statements += 1;
            const property = PROPERTY.exec(line)?.[1];
            if (property === undefined) {
              predicates.other += 1;
              continue;
            }
            predicates[vocabularyOf(property)] += 1;
            if (property === REVISION_OF) revision = true;
            else if (property === SPECIALIZATION_OF) {
              version = true;
              links += 1;
            }
          }
          if (kind === "records" || kind === "servers") {
            if (revision) kind = kind === "records" ? "revisions" : kind;
            else if (version) {
              if (kind === "records") {
                kind = "versions";
                versionLinks += links;
              }
            } else podRecords += 1;
          }
        }
        const held = kinds[kind];
        held.files += 1;
        held.statements += statements;
        held.bytes += bytes.length;
      }),
    );
  const disk = await filesUnder(folder);
  const beside = join(dirname(resolve(folder)), ".answers", basename(folder));
  const kept = await filesUnder(beside).catch(() => []);
  const database = await databaseOf(folder, encrypted, beside);
  return {
    kinds,
    podRecords,
    versionLinks,
    predicates,
    onDisk: {
      ...totalOf(disk),
      blocks: disk.reduce(
        (sum, { bytes }) => sum + Math.ceil(bytes / BLOCK) * BLOCK,
        0,
      ),
    },
    beside: totalOf(kept),
    ...(database !== undefined && { database }),
  };
}

/** A pod that has been imported into and closed is counted in a process of its own: the counts are exact, so once is enough. */
export async function measureStored(job: Job): Promise<Measured> {
  return {
    seconds: {},
    parts: {},
    rssBytes: process.memoryUsage.rss(),
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    stored: await storedIn(job.folder, job.encrypted),
  };
}

/**
 * The rows of one pod's counts, under `stored-<size>[-encrypted]`: the source's entries and the pod's records, then the
 * files, statements and bytes of each kind and in all, the properties by vocabulary, and the database.
 */
export function storedRows(
  name: string,
  about: string,
  stored: Stored,
  entries: number,
): Row[] {
  const sum = (pick: (each: Counted) => number) =>
    STORED_KINDS.reduce((total, kind) => total + pick(stored.kinds[kind]), 0);
  const count = (path: string, value: number): Row =>
    outputRow(`${name}/${path}`, value, about);
  const bytes = (path: string, value: number): Row =>
    outputRow(`${name}/${path}`, value, about, "By");
  const rows: Row[] = [
    count("count/entries", entries),
    count("count/pod-records", stored.podRecords),
    count("count/version-links", stored.versionLinks),
    ...STORED_KINDS.map((kind) =>
      count(`files/${kind}`, stored.kinds[kind].files),
    ),
    count(
      "files/all",
      sum((each) => each.files),
    ),
    count("files/on-disk", stored.onDisk.files),
    count("files/beside", stored.beside.files),
    ...STORED_KINDS.map((kind) =>
      count(`statements/${kind}`, stored.kinds[kind].statements),
    ),
    count(
      "statements/all",
      sum((each) => each.statements),
    ),
    ...STORED_KINDS.map((kind) =>
      bytes(`bytes/${kind}`, stored.kinds[kind].bytes),
    ),
    bytes(
      "bytes/all",
      sum((each) => each.bytes),
    ),
    bytes("bytes/on-disk", stored.onDisk.bytes),
    bytes("bytes/in-4k-blocks", stored.onDisk.blocks),
    bytes("bytes/beside", stored.beside.bytes),
    ...PREDICATE_VOCABULARIES.map((each) =>
      count(`predicates/${each}`, stored.predicates[each]),
    ),
  ];
  const { database } = stored;
  if (database !== undefined) {
    rows.push(bytes("database/file", database.file));
    if (database.statements !== undefined)
      rows.push(count("database/statements", database.statements));
    if (database.terms !== undefined)
      rows.push(count("database/terms", database.terms));
    if (database.tables !== undefined)
      rows.push(bytes("database/tables", database.tables));
    if (database.indexes !== undefined)
      rows.push(bytes("database/indexes", database.indexes));
    const taken = new Set<string>();
    for (const object of database.largest ?? [])
      rows.push(
        bytes(
          `database/${unique(taken, part(`${object.kind}-${object.name}`))}`,
          object.bytes,
        ),
      );
  }
  return rows;
}
