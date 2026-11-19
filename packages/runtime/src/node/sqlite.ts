import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  type Database,
  type DatabaseFunction,
  DatabaseKeyRefused,
} from "../database.js";
import type { BesideDatabase } from "../pod-database.js";

/** The bytes of a key `openDatabase` seals a database with. */
export const DATABASE_KEY_BYTES = 32;

interface Binding {
  pragma(text: string, options?: { simple: boolean }): unknown;
  key(key: Buffer): number;
  function(
    name: string,
    options: { deterministic: boolean; varargs: boolean },
    apply: (...values: unknown[]) => unknown,
  ): unknown;
  prepare(sql: string): {
    all(...parameters: unknown[]): Record<string, unknown>[];
    iterate(
      ...parameters: unknown[]
    ): IterableIterator<Record<string, unknown>>;
    get(...parameters: unknown[]): Record<string, unknown> | undefined;
    columns(): { name: string }[];
    run(...parameters: unknown[]): { changes: number };
  };
  exec(sql: string): unknown;
  transaction<T>(work: () => T): () => T;
  close(): unknown;
}

type Constructor = new (path: string) => Binding;

let constructor: Constructor | undefined;

/** The binding, loaded when the first database is opened: a run that opens none pays nothing for it. */
function binding(): Constructor {
  const require = createRequire(import.meta.url);
  constructor ??= require("better-sqlite3-multiple-ciphers") as Constructor;
  return constructor;
}

/** What `openDatabase` opens a database with. */
export interface DatabaseOptions {
  /** The 32 random bytes the file is sealed with. */
  readonly key?: Uint8Array;
  readonly functions?: readonly DatabaseFunction[];
}

/** The key is copied once into a buffer the binding reads, and that copy is zeroed as soon as it has. */
function keyed(db: Binding, key: Uint8Array): void {
  db.pragma("cipher='chacha20'");
  db.pragma("kdf_iter=1");
  const copy = Buffer.from(key);
  try {
    db.key(copy);
  } finally {
    copy.fill(0);
  }
}

/**
 * Opens the database at `path`, or makes it, in write-ahead mode with temporary tables kept in memory, with each of
 * `functions` registered for its SQL to call. Given a `key`, the file is sealed page by page with ChaCha20-Poly1305 under
 * it, so nothing of what it holds, its journal included, is written in the clear; the key is the file's own random bytes,
 * not a passphrase, so it is used as it is (`kdf_iter=1`). A database that does not open under the key it is given, or
 * without one, throws `DatabaseKeyRefused` at once, and a `key` that is not 32 bytes throws before anything is opened.
 */
export function openDatabase(
  path: string,
  { key, functions = [] }: DatabaseOptions = {},
): Database {
  if (key !== undefined && key.length !== DATABASE_KEY_BYTES)
    throw new RangeError(
      `a database's key is ${DATABASE_KEY_BYTES} bytes, not ${key.length}`,
    );
  const db = new (binding())(path);
  try {
    if (key !== undefined) keyed(db, key);
    try {
      db.pragma("journal_mode=WAL");
    } catch (error) {
      if ((error as { code?: unknown }).code === "SQLITE_NOTADB")
        throw new DatabaseKeyRefused(path, error);
      throw error;
    }
    db.pragma("temp_store=MEMORY");
    for (const { name, deterministic = false, apply } of functions)
      db.function(name, { deterministic, varargs: true }, apply);
  } catch (error) {
    try {
      db.close();
    } catch {
      // What failed first is what the caller needs to see.
    }
    throw error;
  }
  return {
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        all: (...parameters) => statement.all(...parameters),
        iterate: (...parameters) => statement.iterate(...parameters),
        get: (...parameters) => statement.get(...parameters),
        run: (...parameters) => statement.run(...parameters),
        columns: () => statement.columns().map(({ name }) => name),
      };
    },
    exec: (sql) => void db.exec(sql),
    transaction: (work) => db.transaction(work)(),
    close: () => void db.close(),
  };
}

/** The database at `path` as a pod keeps it beside it: opened by `openDatabase`, and removed with its write-ahead log. */
export function databaseAt(path: string): BesideDatabase {
  return {
    open: (options) => openDatabase(path, options),
    remove: async () => {
      for (const file of [path, `${path}-wal`, `${path}-shm`])
        await rm(file, { force: true });
    },
  };
}
