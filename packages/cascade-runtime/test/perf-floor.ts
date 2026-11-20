import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";

/**
 * The floor of a fresh import: the same input loaded as plainly as SQL can. Read the gzipped Bundle and parse it, flatten
 * each resource to one row of a table of its resource type (a scalar is a column, anything nested is its JSON text), and
 * insert the rows into a SQLite file in one transaction. It does no mapping to the Cascade vocabulary, keeps no
 * provenance, matches nothing, derives no views and writes no pod files, so what an import takes beyond it is
 * everything the import does besides loading rows.
 */

export type SqlValue = string | number | null;

export interface FlatTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly SqlValue[])[];
}

interface Entry {
  readonly resource?: object;
}

/** A table's rows while they are read: a cell for each column the row has. */
interface Reading {
  readonly columns: Map<string, number>;
  readonly cells: Map<string, SqlValue>[];
}

const cellOf = (value: unknown): SqlValue =>
  value === null || value === undefined
    ? null
    : typeof value === "boolean"
      ? Number(value)
      : typeof value === "string" || typeof value === "number"
        ? value
        : JSON.stringify(value);

/** One table for each resource type the entries hold, its columns in the order they were first seen. */
export function flatten(
  entries: readonly Entry[],
): ReadonlyMap<string, FlatTable> {
  const reading = new Map<string, Reading>();
  for (const { resource } of entries) {
    if (resource === undefined) continue;
    const { resourceType: type, ...fields } = resource as Record<
      string,
      unknown
    >;
    if (typeof type !== "string") continue;
    let table = reading.get(type);
    if (table === undefined) {
      table = { columns: new Map(), cells: [] };
      reading.set(type, table);
    }
    const cells = new Map<string, SqlValue>();
    for (const [name, value] of Object.entries(fields)) {
      if (!table.columns.has(name)) table.columns.set(name, table.columns.size);
      cells.set(name, cellOf(value));
    }
    table.cells.push(cells);
  }
  return new Map(
    [...reading].map(([type, { columns, cells }]) => {
      const names = [...columns.keys()];
      return [
        type,
        {
          columns: names,
          rows: cells.map((row) => names.map((name) => row.get(name) ?? null)),
        },
      ];
    }),
  );
}

/** What loading a Bundle took, in seconds for each stage, and what went in. */
export interface Loaded {
  readonly parse: number;
  readonly flatten: number;
  readonly insert: number;
  /** Rows inserted: resources with a type. */
  readonly rows: number;
  /** Entries the Bundle holds. */
  readonly records: number;
  readonly tables: number;
  /** The sha256 of the uncompressed Bundle, taken after the clock stopped, for the caller to check against its manifest. */
  readonly sha256: string;
}

interface Binding {
  exec(sql: string): unknown;
  prepare(sql: string): { run(...values: SqlValue[]): unknown };
  transaction<T>(work: () => T): () => T;
  close(): unknown;
}

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** The SQLite the runtime keeps its database in, which the runtime's package already depends on. */
const sqlite = (): new (file: string) => Binding =>
  createRequire(import.meta.url)("better-sqlite3-multiple-ciphers") as new (
    file: string,
  ) => Binding;

/** Loads the gzipped Bundle at `bundle` into a new SQLite file at `database`, which is removed first when it exists. */
export async function loadPlainly(
  bundle: string,
  database: string,
): Promise<Loaded> {
  const Database = sqlite();
  await rm(database, { force: true });
  const started = performance.now();
  const bytes = gunzipSync(await readFile(bundle));
  const { entry = [] } = JSON.parse(new TextDecoder().decode(bytes)) as {
    entry?: Entry[];
  };
  const parsed = performance.now();
  const tables = flatten(entry);
  const flattened = performance.now();
  const db = new Database(database);
  let rows = 0;
  try {
    db.transaction(() => {
      for (const [type, { columns, rows: each }] of tables) {
        const names = columns.map(quoted).join(", ");
        db.exec(`CREATE TABLE ${quoted(type)} (${names})`);
        const insert = db.prepare(
          `INSERT INTO ${quoted(type)} (${names}) VALUES (${columns.map(() => "?").join(", ")})`,
        );
        for (const row of each) insert.run(...row);
        rows += each.length;
      }
    })();
  } finally {
    db.close();
  }
  const inserted = performance.now();
  return {
    parse: (parsed - started) / 1000,
    flatten: (flattened - parsed) / 1000,
    insert: (inserted - flattened) / 1000,
    rows,
    records: entry.length,
    tables: tables.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
