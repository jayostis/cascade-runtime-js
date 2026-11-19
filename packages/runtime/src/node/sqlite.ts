import { mkdirSync } from "node:fs";
import { access, mkdir, open, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { Worker } from "node:worker_threads";
import {
  type Database,
  type DatabaseFunction,
  DatabaseKeyRefused,
} from "../database.js";
import type { BesideDatabase, WholeBuild } from "../pod-database.js";

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
  /**
   * A file a build writes once and that is put in place only when whole, so a stop part way loses nothing: kept with no
   * journal and no syncs, and with half a gigabyte of page cache, in place of write-ahead mode.
   */
  readonly building?: boolean;
}

/** The page cache of a build, in KiB: the indexes of a large pod's statements are sorted in it rather than on disk. */
const BUILDING_CACHE_KIB = 524_288;

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
  { key, functions = [], building = false }: DatabaseOptions = {},
): Database {
  if (key !== undefined && key.length !== DATABASE_KEY_BYTES)
    throw new RangeError(
      `a database's key is ${DATABASE_KEY_BYTES} bytes, not ${key.length}`,
    );
  const db = new (binding())(path);
  try {
    if (key !== undefined) keyed(db, key);
    try {
      db.pragma(building ? "journal_mode=OFF" : "journal_mode=WAL");
    } catch (error) {
      if ((error as { code?: unknown }).code === "SQLITE_NOTADB")
        throw new DatabaseKeyRefused(path, error);
      throw error;
    }
    db.pragma("temp_store=MEMORY");
    if (building) {
      db.pragma("synchronous=OFF");
      db.pragma(`cache_size=-${BUILDING_CACHE_KIB}`);
    }
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

/** What the worker that builds a pod's database whole is given: the file to build, and what to build it from. */
export interface WholeBuildJob {
  readonly path: string;
  readonly whole: WholeBuild;
}

/** What that worker answers once the file is built and closed, or why it was not. */
export interface WholeBuildDone {
  readonly error?: string;
}

/** A file and the two a connection in write-ahead mode keeps beside it. */
const withLogs = (path: string): string[] => [
  path,
  `${path}-wal`,
  `${path}-shm`,
];

async function removed(paths: readonly string[]): Promise<void> {
  for (const file of paths) await rm(file, { force: true });
}

/** Flushes the file or folder at the path to its disk, as a build written with synchronous=OFF needs before its rename is relied on. */
async function synced(path: string, flags: "r" | "r+"): Promise<void> {
  const handle = await open(path, flags);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** The bytes handed to another thread: moved where they are a buffer of their own, else a copy of them moved. */
function moved(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const { buffer } = bytes;
  return buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === buffer.byteLength
    ? (bytes as Uint8Array<ArrayBuffer>)
    : bytes.slice();
}

/** The whole build run in a worker of its own, the dump moved to it; settles once the worker has ended. */
function builtInWorker(job: WholeBuildJob): Promise<void> {
  const dump = moved(job.whole.dump);
  return new Promise((resolve, reject) => {
    let done: WholeBuildDone | undefined;
    const worker = new Worker(
      new URL("./pod-database-worker.js", import.meta.url),
      {
        workerData: { ...job, whole: { ...job.whole, dump } },
        transferList: [dump.buffer],
      },
    );
    worker.once("message", (answer: WholeBuildDone) => (done = answer));
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (done?.error !== undefined) reject(new Error(done.error));
      else if (done === undefined || code !== 0)
        reject(new Error(`the build's worker ended with ${code}, unfinished`));
      else resolve();
    });
  });
}

/**
 * The database at `path` as a pod keeps it beside it: opened by `openDatabase`, in a folder made for it where there is
 * none; built whole in a worker into a file beside it, `<path>-build`, renamed over it once built, closed and flushed to
 * disk, and removed if that fails; and removed with its write-ahead log and any build left part way.
 */
export function databaseAt(path: string): BesideDatabase {
  const building = `${path}-build`;
  return {
    open: (options) => {
      mkdirSync(dirname(path), { recursive: true });
      return openDatabase(path, options);
    },
    builtWhole: async (whole) => {
      await removed([building]);
      await mkdir(dirname(path), { recursive: true });
      try {
        await builtInWorker({ path: building, whole });
        await synced(building, "r+");
        await removed(withLogs(path));
        await rename(building, path);
      } catch (error) {
        await removed([building]).catch(() => undefined);
        throw error;
      }
      if (process.platform !== "win32") await synced(dirname(path), "r");
    },
    remove: () => removed([...withLogs(path), building]),
    exists: () =>
      access(path).then(
        () => true,
        () => false,
      ),
  };
}
