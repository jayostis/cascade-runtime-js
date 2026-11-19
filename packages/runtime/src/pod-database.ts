import {
  type Database,
  type DatabaseFunction,
  DatabaseKeyRefused,
} from "./database.js";
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
  sqlDatabaseFunctions,
  sqlParts,
  STATEMENTS_SCHEMA,
} from "./statements.js";
import type { Union } from "./store.js";

/** The bytes of the key a sealed pod's database is sealed with. */
const KEY_BYTES = 32;
/** Where a pod's database is kept beside it. */
export const DATABASE_BESIDE = "pod.db";
/** Where a sealed pod's database's key is kept beside it, sealed as everything beside it is. */
export const DATABASE_KEY_BESIDE = "pod.db.key";
const VIEWS = "queries/views";
const SCREEN_PARTS = ["tables", "fill", "finish"] as const;
const RUN_PARTS = ["fill", "finish"] as const;
/** The graphs one read of what a step loaded names: a long VALUES block joins in more than linear time. */
const GRAPHS_AT_ONCE = 256;

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
  /** Removes the database and its write-ahead log, so the next open makes it anew. */
  remove(): Promise<void>;
  /** Whether the pod is sealed, and so the database too, under a key of its own kept sealed beside the pod. */
  readonly sealed?: boolean;
}

/** The vocabulary's statements schema and each view's screen, the parts of its `.sql`, sorted by path. */
interface Screens {
  readonly schema: string;
  readonly views: readonly ReadonlyMap<string, string>[];
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
  readonly #besidePod: Files;
  readonly #screens: Screens;
  readonly #functions: readonly DatabaseFunction[];
  #key: Uint8Array | undefined;
  #db: Database;

  private constructor(
    beside: BesideDatabase,
    besidePod: Files,
    screens: Screens,
    functionsGiven: readonly DatabaseFunction[],
    key: Uint8Array | undefined,
    db: Database,
  ) {
    this.#beside = beside;
    this.#besidePod = besidePod;
    this.#screens = screens;
    this.#functions = functionsGiven;
    this.#key = key;
    this.#db = db;
  }

  /**
   * The database beside the pod opened, or made: for a sealed pod under the key kept beside it, and where that key is
   * lost, or does not open the database, under a new one, the database made anew.
   */
  static async opened(
    beside: BesideDatabase,
    besidePod: Files,
    vocabulary: Files,
  ): Promise<PodDatabase> {
    const screens = await screensOf(vocabulary);
    functions ??= sqlDatabaseFunctions();
    const given = await functions;
    let key: Uint8Array | undefined;
    if (beside.sealed === true) {
      const kept = await besidePod
        .read(DATABASE_KEY_BESIDE)
        .catch(() => undefined);
      key =
        kept?.length === KEY_BYTES
          ? kept
          : await PodDatabase.#newKey(beside, besidePod);
    }
    let db: Database;
    try {
      db = beside.open({
        ...(key === undefined ? {} : { key }),
        functions: given,
      });
    } catch (error) {
      if (!(error instanceof DatabaseKeyRefused)) throw error;
      key =
        beside.sealed === true
          ? await PodDatabase.#newKey(beside, besidePod)
          : undefined;
      if (key === undefined) await beside.remove();
      db = beside.open({
        ...(key === undefined ? {} : { key }),
        functions: given,
      });
    }
    return new PodDatabase(beside, besidePod, screens, given, key, db);
  }

  /** A new random key, kept beside the pod before anything is sealed under it, the database it cannot open removed. */
  static async #newKey(
    beside: BesideDatabase,
    besidePod: Files,
  ): Promise<Uint8Array> {
    await beside.remove();
    const key = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
    await besidePod.write(DATABASE_KEY_BESIDE, key);
    return key;
  }

  /** The fingerprint the ledger names, of the files the database was built from; none for one never built whole. */
  get fingerprint(): string | undefined {
    return ledgerFingerprint(this.#db);
  }

  /**
   * Builds the database whole from a store's dump, the pod's under the lens as the build keeps it: each of its graphs
   * the union reads loaded, every screen made and filled with every record and entry in scope, and the ledger naming the
   * fingerprint, in one transaction, so a database stopped part way names none and is built whole again.
   */
  async builtWhole(
    dump: Uint8Array,
    graphs: ReadonlySet<string>,
    fingerprint: string,
  ): Promise<void> {
    this.#db.close();
    await this.#beside.remove();
    this.#db = this.#beside.open({
      ...(this.#key === undefined ? {} : { key: this.#key }),
      functions: this.#functions,
    });
    const db = this.#db;
    db.transaction(() => {
      loadStatements(
        db,
        this.#screens.schema,
        graphsOfDump(dump, graphs),
        fingerprint,
      );
      for (const part of SCREEN_PARTS)
        for (const view of this.#screens.views) db.exec(view.get(part) ?? "");
    });
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
      keyed.scoped();
      for (const part of RUN_PARTS)
        for (const view of this.#screens.views) db.exec(view.get(part) ?? "");
      ledgerNamed(db, fingerprint);
    });
  }

  /** Makes the ledger name no fingerprint, so the database is built whole when next kept. */
  forget(): void {
    if (this.fingerprint !== undefined)
      this.#db.prepare("DELETE FROM ledger").run();
  }

  /** Ends the connection, writing back what the write-ahead log holds. */
  close(): void {
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
