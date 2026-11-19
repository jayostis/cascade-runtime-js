import { createRequire } from "node:module";
import type { Database } from "../database.js";

/** The bytes of a key `openDatabase` seals a database with. */
export const DATABASE_KEY_BYTES = 32;

interface Binding {
  pragma(text: string, options?: { simple: boolean }): unknown;
  prepare(sql: string): {
    all(...parameters: unknown[]): Record<string, unknown>[];
    get(...parameters: unknown[]): Record<string, unknown> | undefined;
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

/**
 * Opens the database at `path`, or makes it, in write-ahead mode with temporary tables kept in memory. Given a `key`, the
 * file is sealed page by page with ChaCha20-Poly1305 under it, so nothing of what it holds, its journal included, is
 * written in the clear; the key is the file's own random bytes, not a passphrase, so it is used as it is (`kdf_iter=1`).
 * A database opened without its key, or with another, throws at once, and a `key` that is not 32 bytes throws before
 * anything is opened.
 */
export function openDatabase(path: string, key?: Uint8Array): Database {
  if (key !== undefined && key.length !== DATABASE_KEY_BYTES)
    throw new RangeError(
      `a database's key is ${DATABASE_KEY_BYTES} bytes, not ${key.length}`,
    );
  const db = new (binding())(path);
  try {
    if (key !== undefined) {
      db.pragma("cipher='chacha20'");
      db.pragma("kdf_iter=1");
      db.pragma(`hexkey='${Buffer.from(key).toString("hex")}'`);
    }
    db.pragma("journal_mode=WAL");
    db.pragma("temp_store=MEMORY");
  } catch (error) {
    db.close();
    throw error;
  }
  return {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => void db.exec(sql),
    transaction: (work) => db.transaction(work)(),
    close: () => void db.close(),
  };
}
