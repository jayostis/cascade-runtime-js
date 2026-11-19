import type { Database, DatabaseFunction, Statement } from "./database.js";
import type { Files } from "./files.js";
import type { BuildChange } from "./incremental.js";
import { iri, type Triple, written } from "./rdf.js";
import {
  graphsOfDump,
  heldNt,
  type HeldTriples,
  KeyedStatements,
  ledgerFingerprint,
  ledgerNamed,
  loadStatements,
  PAGE_KEY,
  parsedNt,
  sqlDatabaseFunctions,
  sqlParts,
  sqlStatements,
  STATEMENTS_SCHEMA,
} from "./statements.js";
import type { Union } from "./store.js";

/** The bytes of the key a sealed pod's database is sealed with. */
const KEY_BYTES = 32;
/** Where a pod's database is kept beside it; a sealed pod's is kept under a keyed name of this path. */
export const DATABASE_BESIDE = "pod.db";
/** The path a sealed pod's database's key is kept beside it under a keyed name of, sealed as everything beside it is. */
export const DATABASE_KEY_BESIDE = "pod.db.key";
const VIEWS = "queries/views";
const SCREEN_PARTS = ["tables", "fill", "finish"] as const;
const RUN_PARTS = ["fill", "finish"] as const;
/** The graphs one read of what a step loaded names: a long VALUES block joins in more than linear time. */
const GRAPHS_AT_ONCE = 256;
/** The statistics the screens' statements are planned by, taken once the statements are loaded. */
const ANALYZED = "ANALYZE;";

/**
 * A screen's sort key: one or more conditions, each written ascending, as a kind's digit, hex of its text and '.', or
 * descending, as hex of its text turned to the letters a to p and '~'.
 */
const SORT_KEY = /^(?:[0-3](?:[0-9A-F]{2})*\.|(?:[a-p]{2})*~)+$/;

/** Whether the text is shaped as a screen's sort key, which a list question gives as its `page_key`. */
export function isPageKey(text: string): boolean {
  return SORT_KEY.test(text);
}

/** A page of a list question: how many entries, and the key of the entry it follows; none for the first page. */
export interface PageAsked {
  readonly size: number;
  readonly after?: string;
}

/**
 * A question's rows as its `.sql` gives them from the database: each a term's value by its column, an unbound one left
 * out; for a page of a list question, the key to ask the next page after, none on the last.
 */
export interface DatabaseAnswer {
  readonly rows: Readonly<Record<string, string>>[];
  readonly next?: string;
}

/** The vocabulary's statements schema and each view's screen, the parts of its `.sql`, sorted by path. */
export interface Screens {
  readonly schema: string;
  readonly views: readonly ReadonlyMap<string, string>[];
}

/** What a whole build of a pod's database is made from: a store's dump, the graphs of it kept, and what it was built from. */
export interface WholeBuild extends Screens {
  /** The store's dump; a build on another thread is handed its bytes, and the caller keeps none of them. */
  readonly dump: Uint8Array;
  readonly graphs: readonly string[];
  readonly fingerprint: string;
  /** The key a sealed pod's database is sealed under. */
  readonly key?: Uint8Array;
}

/**
 * The database a pod keeps beside it, `pod.db`, by its path: a cache of the pod's statements and screens that the
 * pod's files can always build again (S4).
 */
export interface BesideDatabase {
  /** Opens the database, or makes it, sealed under the key when one is given, with each function registered. */
  open(options: {
    readonly key?: Uint8Array;
    readonly functions: readonly DatabaseFunction[];
  }): Database;
  /**
   * Builds the database whole into a file of its own and puts it in place of the database, closed, once its ledger is
   * written: off the caller's thread where the platform has threads, so the caller's work goes on meanwhile.
   */
  builtWhole(whole: WholeBuild): Promise<void>;
  /** Removes the database, its write-ahead log and any build of it left part way, so the next open makes it anew. */
  remove(): Promise<void>;
  /** Whether the database is there to open, so that one never built is not made by asking what it holds. */
  exists(): Promise<boolean>;
  /**
   * For a sealed pod, whose database is sealed too: the path beside the pod its key is kept at, a keyed name that
   * says nothing of what it holds, and sealed as everything beside the pod is.
   */
  readonly keyAt?: string;
}

/**
 * Builds a pod's database whole on an empty database: each of the dump's graphs that the union reads loaded, statistics
 * taken for the screens' statements to be planned by, and every screen made and filled with every record and entry in
 * scope, in one transaction, so a database stopped part way names no fingerprint.
 */
export function builtWholeIn(
  db: Database,
  whole: Omit<WholeBuild, "key">,
): void {
  db.transaction(() => {
    loadStatements(
      db,
      whole.schema,
      graphsOfDump(whole.dump, new Set(whole.graphs)),
      whole.fingerprint,
    );
    db.exec(ANALYZED);
    for (const part of SCREEN_PARTS)
      for (const view of whole.views) {
        const statements = view.get(part);
        if (statements === undefined) continue;
        for (const text of sqlStatements(statements)) db.prepare(text).run();
      }
  });
}

const decoded = (bytes: Uint8Array | undefined, path: string): string => {
  if (bytes === undefined) throw new Error(`the vocabulary holds no ${path}`);
  return new TextDecoder().decode(bytes);
};

async function screensOf(vocabulary: Files): Promise<Screens> {
  const paths = (await vocabulary.list(VIEWS))
    .filter((path) => path.endsWith(".sql"))
    .sort();
  return {
    schema: decoded(
      await vocabulary.read(STATEMENTS_SCHEMA),
      STATEMENTS_SCHEMA,
    ),
    views: (
      await Promise.all(
        paths.map(async (path) =>
          sqlParts(decoded(await vocabulary.read(path), path)),
        ),
      )
    ).filter((parts) => parts.size > 0),
  };
}

let functions: Promise<DatabaseFunction[]> | undefined;

/**
 * A pod's `pod.db`: the working store's graphs loaded into the vocabulary's statements schema, each screen the
 * vocabulary has a `.sql` for filled, and a ledger naming the fingerprint of the files it was built from. Built whole
 * when it is absent or its ledger names another fingerprint; after a step, kept current by keyed writes of what the
 * step changed. A sealed pod's is sealed under a random key of its own, kept beside the pod sealed with the pod's.
 */
export class PodDatabase {
  readonly #beside: BesideDatabase;
  readonly #screens: Screens;
  readonly #functions: readonly DatabaseFunction[];
  readonly #key: Uint8Array | undefined;
  #db: Database;
  /** Each part run on this connection, its statements compiled the first time it runs and run again as compiled. */
  #compiled = new Map<string, Statement[]>();
  /** Each question's statement, by its `.sql`, prepared on this connection the first time the question is asked. */
  #asked = new Map<string, Statement>();
  /** Whether the connection is closed, for a build whole or for good, so that nothing is asked of it. */
  #shut = false;

  private constructor(
    beside: BesideDatabase,
    screens: Screens,
    functionsGiven: readonly DatabaseFunction[],
    key: Uint8Array | undefined,
    db: Database,
  ) {
    this.#beside = beside;
    this.#screens = screens;
    this.#functions = functionsGiven;
    this.#key = key;
    this.#db = db;
  }

  /**
   * The database beside the pod opened, or made: for a sealed pod under the key kept beside it. Where that key is lost
   * or does not open the database, or the database does not open at all, it is made anew, a sealed pod's under a new
   * key; a key file that cannot be read for another reason throws, and nothing is removed.
   */
  static async opened(
    beside: BesideDatabase,
    besidePod: Files,
    vocabulary: Files,
  ): Promise<PodDatabase> {
    const screens = await screensOf(vocabulary);
    functions ??= sqlDatabaseFunctions();
    const given = await functions;
    const { keyAt } = beside;
    let key: Uint8Array | undefined;
    if (keyAt !== undefined) {
      const kept = await besidePod.read(keyAt);
      key =
        kept?.length === KEY_BYTES
          ? kept
          : await PodDatabase.#newKey(beside, besidePod, keyAt);
    }
    let db: Database;
    try {
      db = beside.open({
        ...(key === undefined ? {} : { key }),
        functions: given,
      });
    } catch {
      if (keyAt === undefined) await beside.remove();
      else key = await PodDatabase.#newKey(beside, besidePod, keyAt);
      db = beside.open({
        ...(key === undefined ? {} : { key }),
        functions: given,
      });
    }
    return new PodDatabase(beside, screens, given, key, db);
  }

  /** A new random key, kept beside the pod before anything is sealed under it, the database it cannot open removed. */
  static async #newKey(
    beside: BesideDatabase,
    besidePod: Files,
    keyAt: string,
  ): Promise<Uint8Array> {
    await beside.remove();
    const key = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
    await besidePod.write(keyAt, key);
    return key;
  }

  /**
   * The fingerprint the ledger names, of the files the database was built from; none for one never built whole, and
   * none for one whose ledger does not read, which is built whole again.
   */
  get fingerprint(): string | undefined {
    try {
      return ledgerFingerprint(this.#db);
    } catch {
      return undefined;
    }
  }

  /**
   * Builds the database whole from a store's dump, the pod's under the lens as the build keeps it, into a file of its
   * own put in place of the database once built (`BesideDatabase.builtWhole`), so a database stopped part way is never
   * the one opened. The dump's bytes are handed over: the caller reads none of them after.
   */
  async builtWhole(
    dump: Uint8Array,
    graphs: ReadonlySet<string>,
    fingerprint: string,
  ): Promise<void> {
    this.#shut = true;
    this.#db.close();
    this.#compiled = new Map();
    this.#asked = new Map();
    try {
      await this.#beside.builtWhole({
        ...this.#screens,
        dump,
        graphs: [...graphs],
        fingerprint,
        ...(this.#key === undefined ? {} : { key: this.#key }),
      });
    } finally {
      this.#db = this.#beside.open({
        ...(this.#key === undefined ? {} : { key: this.#key }),
        functions: this.#functions,
      });
      this.#shut = false;
    }
  }

  /**
   * The rows a question's `.sql` gives, asked of the whole pod: a list question's whole list, or, given a page, its
   * first `size` entries after the key, and the key of the last of them when another entry follows; a question that
   * is no list gives all its rows whatever the page. The statement is prepared the first time the question is asked.
   * None while the connection is closed, as during a build whole.
   */
  answer(sql: string, page?: PageAsked): DatabaseAnswer | undefined {
    if (this.#shut) return undefined;
    let statement = this.#asked.get(sql);
    if (statement === undefined) {
      statement = this.#db.prepare(sql);
      this.#asked.set(sql, statement);
    }
    const named = statement.columns();
    const paged = named.at(-1) === PAGE_KEY;
    const columns = paged ? named.slice(0, -1) : named;
    const found = paged
      ? statement.all({
          page_size: page === undefined ? null : page.size + 1,
          after: page?.after ?? null,
        })
      : statement.all();
    const keys = found.map((row) => row[PAGE_KEY]);
    let next: string | undefined;
    let end = found.length;
    if (paged && page !== undefined) {
      const entries = [...new Set(keys)];
      if (entries.length > page.size) {
        const beyond = entries[page.size];
        end = keys.indexOf(beyond);
        next = String(entries[page.size - 1]);
      }
    }
    const rows = found.slice(0, end).map((row) => {
      const values: Record<string, string> = {};
      for (const column of columns) {
        const value = row[column];
        if (value === null || value === undefined) continue;
        if (typeof value !== "string")
          throw new TypeError(
            `the column ${column} gives ${String(value)}, no N-Triples term`,
          );
        values[column] = parsedNt(value).value;
      }
      return values;
    });
    return next === undefined ? { rows } : { rows, next };
  }

  /**
   * Keeps the database current after a step, in one transaction: the subjects the step changed deleted and written
   * again in each graph it changed, each file it loaded written as the union holds it, each screen filled again for
   * what it touched, and the ledger naming the fingerprint. A failure writes nothing, and leaves the ledger naming the
   * fingerprint before the step, so the database is built whole when next kept.
   */
  async applied(
    changes: readonly BuildChange[],
    union: Union,
    fingerprint: string,
  ): Promise<void> {
    const loaded = await graphsHeld(
      union,
      changes.flatMap((change) => ("loaded" in change ? [change.graph] : [])),
    );
    this.#keyed(changes, loaded, fingerprint);
  }

  /**
   * Puts the triples in the graph in place of what it held, as a step's keyed write does, the ledger naming the
   * fingerprint it named: for a file the build writes that no screen reads and that changed outside a step, as the
   * manifest's title, so no screen is filled again. Nothing where the ledger names none, since the database is then
   * built whole when next kept.
   */
  replaced(graph: string, triples: readonly Triple[]): void {
    const fingerprint = this.#shut ? undefined : this.fingerprint;
    if (fingerprint === undefined) return;
    this.#keyed([{ graph, whole: triples }], new Map(), fingerprint, false);
  }

  #keyed(
    changes: readonly BuildChange[],
    loaded: ReadonlyMap<string, [string, string, string][]>,
    fingerprint: string,
    screened = true,
  ): void {
    const db = this.#db;
    db.transaction(() => {
      const keyed = new KeyedStatements(db);
      for (const change of changes) {
        if ("loaded" in change) {
          keyed.removeGraph(change.graph);
          keyed.add(change.graph, loaded.get(change.graph) ?? []);
        } else if ("whole" in change) {
          keyed.removeGraph(change.graph);
          keyed.add(change.graph, held(change.whole));
        } else {
          keyed.removeSubjects(change.graph, change.gone);
          keyed.add(change.graph, held(change.fresh));
        }
      }
      if (screened) {
        keyed.scoped();
        for (const part of RUN_PARTS)
          for (const view of this.#screens.views) this.#ran(view.get(part));
      }
      ledgerNamed(db, fingerprint);
    });
  }

  /**
   * Runs a part's statements in order, each compiled when the part first runs on this connection, once those before it
   * have made what it names, and run again as compiled after.
   */
  #ran(part: string | undefined): void {
    if (part === undefined) return;
    const compiled = this.#compiled.get(part);
    if (compiled !== undefined) {
      for (const statement of compiled) statement.run();
      return;
    }
    const made: Statement[] = [];
    for (const text of sqlStatements(part)) {
      const statement = this.#db.prepare(text);
      statement.run();
      made.push(statement);
    }
    this.#compiled.set(part, made);
  }

  /** Makes the ledger name no fingerprint, so the database is built whole when next kept. */
  forget(): void {
    if (this.fingerprint !== undefined)
      this.#db.prepare("DELETE FROM ledger").run();
  }

  /** Ends the connection, writing back what the write-ahead log holds. */
  close(): void {
    this.#shut = true;
    this.#db.close();
  }
}

function* held(triples: readonly Triple[]): HeldTriples {
  for (const [subject, predicate, object] of triples)
    yield [heldNt(subject), heldNt(predicate), heldNt(object)];
}

/** Each graph's triples as the union's store holds them, its blank nodes under the store's own labels, read in batches. */
async function graphsHeld(
  union: Union,
  graphs: readonly string[],
): Promise<Map<string, [string, string, string][]>> {
  const found = new Map<string, [string, string, string][]>(
    graphs.map((graph) => [graph, []]),
  );
  for (let start = 0; start < graphs.length; start += GRAPHS_AT_ONCE) {
    const named = graphs
      .slice(start, start + GRAPHS_AT_ONCE)
      .map((graph) => written(iri(graph)))
      .join(" ");
    const { rows } = await union.select(
      `SELECT ?g ?s ?p ?o WHERE { VALUES ?g { ${named} } GRAPH ?g { ?s ?p ?o } }`,
    );
    for (const row of rows) {
      const [g, s, p, o] = ["g", "s", "p", "o"].map((name) => row.get(name));
      if (
        g === undefined ||
        s === undefined ||
        p === undefined ||
        o === undefined
      )
        continue;
      found.get(g.value)?.push([heldNt(s), heldNt(p), heldNt(o)]);
    }
  }
  return found;
}
