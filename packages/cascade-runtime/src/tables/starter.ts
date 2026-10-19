import {
  CODES,
  type Files,
  relative,
  writeAll,
} from "@cascade-runtime/runtime";
import type { RowsWork } from "../rows.js";

/** In the starter copies, what follows a version's file stem in place of `.ttl`: its rows as the feed published them. */
export const PUBLISHED_ROWS = ".nq.gz";

/** What follows a version's file stem in the name of its listing, which a search reads. */
export const LISTED = ".listed.json";

/** How many of the starter's versions are read ahead while copying. */
export const READ_AHEAD = 3;

const OF_A_VERSION = [PUBLISHED_ROWS, CODES, LISTED];

/** A version's files as the store keeps them, by path. */
type Copied = (readonly [string, Uint8Array])[];

/** The starter's files of each version, by its file stem: its rows as published, and each file beside them. */
export function versionsIn(paths: readonly string[]): Map<string, string[]> {
  const versions = new Map<string, string[]>();
  for (const path of paths) {
    const suffix = OF_A_VERSION.find((suffix) => path.endsWith(suffix));
    if (suffix === undefined) continue;
    const stem = path.slice(0, -suffix.length);
    versions.set(stem, [...(versions.get(stem) ?? []), path]);
  }
  return versions;
}

/**
 * The store's files of one version from the starter: `<stem>.ttl` from `<stem>.nq.gz` by `work.published`, and every
 * other file of the version as it is.
 */
export async function versionFiles(
  starter: Files,
  stem: string,
  paths: readonly string[],
  work: RowsWork,
): Promise<Copied> {
  const read = await Promise.all(
    paths.map(async (path) => [path, await starter.read(path)] as const),
  );
  const files: Copied = [];
  let rows: Copied[number] | undefined;
  for (const [path, bytes] of read) {
    if (bytes === undefined) continue;
    if (path === `${stem}${PUBLISHED_ROWS}`)
      rows = [`${stem}.ttl`, await work.published(new Uint8Array(bytes))];
    else files.push([path, bytes]);
  }
  if (rows !== undefined) files.push(rows);
  return files;
}

function settled(promise: Promise<unknown>): Promise<void> {
  return promise.then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Copies the versions: each version's files made by `copy`, up to READ_AHEAD read ahead, its rows one at a time through
 * the `work` it is given; each version's files given to `write` at once, at most one write outstanding. The bytes
 * written.
 */
export async function copyVersions(
  work: RowsWork,
  versions: ReadonlyMap<string, readonly string[]>,
  copy: (
    stem: string,
    paths: readonly string[],
    work: RowsWork,
  ) => Promise<Copied>,
  write: (files: Copied) => Promise<void>,
): Promise<number> {
  // A version's rows are read once the one before is, and once each write begun before they were asked has ended, so
  // at most two versions' rows are held whole. A version is ahead until its rows' turn comes; then the next is fetched.
  let turn: Promise<void> = Promise.resolve();
  const queued = [...versions];
  const copying: Promise<Copied>[] = [];
  let failed = false;
  const readNext = (): void => {
    const version = queued.shift();
    if (version === undefined || failed) return;
    let ahead = true;
    const behind = (): void => {
      if (!ahead) return;
      ahead = false;
      readNext();
    };
    const files = copy(version[0], version[1], {
      ...work,
      published: (bytes) => {
        const rows = turn.then(() => {
          if (failed) throw new Error("the copy was cut short");
          behind();
          return work.published(bytes);
        });
        turn = settled(rows);
        return rows;
      },
    });
    void files.then(behind, () => {
      failed = true;
    });
    copying.push(files);
  };
  for (let read = 0; read < READ_AHEAD; read += 1) readNext();
  let writing: Promise<void> = Promise.resolve();
  let written = 0;
  try {
    for (let files = copying.shift(); files; files = copying.shift()) {
      const copied = await files;
      await writing;
      writing = write(copied);
      turn = Promise.all([turn, settled(writing)]).then(() => undefined);
      for (const [, bytes] of copied) written += bytes.byteLength;
    }
    await writing;
  } catch (error) {
    failed = true;
    await settled(writing);
    throw error;
  }
  return written;
}

function fileIn(files: Copied, path: string): Uint8Array | undefined {
  return files.find(([each]) => each === path)?.[1];
}

/** The stem of a version's file in the store, and the starter's file it comes from; undefined for any other path. */
function carriedAs(path: string): { stem: string; from: string } | undefined {
  if (path.endsWith(".ttl"))
    return {
      stem: path.slice(0, -".ttl".length),
      from: `${path.slice(0, -".ttl".length)}${PUBLISHED_ROWS}`,
    };
  const suffix = [CODES, LISTED].find((suffix) => path.endsWith(suffix));
  return suffix === undefined
    ? undefined
    : { stem: path.slice(0, -suffix.length), from: path };
}

/**
 * A store read through to the starter copies: a version's file the store lacks and the starter carries is copied in
 * with the rest of its version on first read, and kept. The index and HELD are never read through.
 */
export class StarterFiles implements Files {
  readonly iri: string;
  readonly #store: Files;
  readonly #starter: Files;
  readonly #work: RowsWork;
  #carried: Promise<Map<string, string[]>> | undefined;
  /** Each version being copied, by its stem, until its files are written: what reads and `copyAll` share. */
  readonly #copies = new Map<string, Promise<Copied>>();
  /** Each version a read has copied since `copyAll` last found the store without it, so `copyAll` copies it no more. */
  readonly #readThrough = new Set<string>();

  constructor(store: Files, starter: Files, work: RowsWork) {
    this.iri = store.iri;
    this.#store = store;
    this.#starter = starter;
    this.#work = work;
  }

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const path = relative(this, pathOrIri);
    const kept = await this.#store.read(path);
    if (kept !== undefined) return kept;
    const carried = carriedAs(path);
    if (carried === undefined) return undefined;
    const paths = (await this.#versions()).get(carried.stem);
    if (paths === undefined || !paths.includes(carried.from)) return undefined;
    const shared = await this.#copies.get(carried.stem)?.catch(() => undefined);
    return shared === undefined
      ? this.#copiedHere(carried.stem, paths, path)
      : fileIn(shared, path);
  }

  write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    return this.#store.write(pathOrIri, bytes);
  }

  writeAll(files: Iterable<readonly [string, Uint8Array]>): Promise<void> {
    return writeAll(this.#store, [...files]);
  }

  list(folder: string): Promise<string[]> {
    return this.#store.list(folder);
  }

  /**
   * Copies every version the starter carries and the store lacks, as `copyVersions` does: the bytes written. Only the
   * versions of the stems given when there are any, so a version the store's index does not name is never fetched.
   */
  async copyAll(stems?: ReadonlySet<string>): Promise<number> {
    const [carried, held] = await Promise.all([
      this.#versions(),
      this.#store.list(""),
    ]);
    const kept = new Set(held);
    const missing = new Map(
      [...carried].filter(
        ([stem]) =>
          !kept.has(`${stem}.ttl`) && (stems === undefined || stems.has(stem)),
      ),
    );
    for (const stem of missing.keys()) this.#readThrough.delete(stem);
    const began = new Map<string, Promise<Copied>>();
    const forget = (stem: string): void => {
      if (this.#copies.get(stem) === began.get(stem)) this.#copies.delete(stem);
    };
    try {
      return await copyVersions(
        this.#work,
        missing,
        (stem, paths, work) => {
          const shared = this.#copies.get(stem);
          if (shared !== undefined) return shared.then(() => []);
          if (this.#readThrough.has(stem)) return Promise.resolve([]);
          const files = versionFiles(this.#starter, stem, paths, work);
          began.set(stem, files);
          this.#share(stem, files);
          return files;
        },
        async (files) => {
          try {
            await writeAll(this.#store, files);
          } finally {
            for (const [path] of files)
              if (path.endsWith(".ttl")) forget(path.slice(0, -".ttl".length));
          }
        },
      );
    } finally {
      for (const stem of began.keys()) forget(stem);
    }
  }

  /** The file, from its version copied and written by this read, or from the store when it was written meanwhile. */
  async #copiedHere(
    stem: string,
    paths: readonly string[],
    path: string,
  ): Promise<Uint8Array | undefined> {
    const meanwhile = await this.#store.read(path);
    if (meanwhile !== undefined) return meanwhile;
    for (let shared = this.#copies.get(stem); shared;) {
      const files = await shared.catch(() => undefined);
      if (files !== undefined) return fileIn(files, path);
      shared = this.#copies.get(stem);
    }
    const files = versionFiles(this.#starter, stem, paths, this.#work);
    this.#share(stem, files);
    try {
      await writeAll(this.#store, await files);
      this.#readThrough.add(stem);
    } finally {
      if (this.#copies.get(stem) === files) this.#copies.delete(stem);
    }
    return fileIn(await files, path);
  }

  /** Makes the copy the one reads and `copyAll` share, until it is written or rejected. */
  #share(stem: string, files: Promise<Copied>): void {
    this.#copies.set(stem, files);
    files.catch(() => {
      if (this.#copies.get(stem) === files) this.#copies.delete(stem);
    });
  }

  #versions(): Promise<Map<string, string[]>> {
    const versions = (this.#carried ??= this.#starter
      .list("")
      .then(versionsIn));
    versions.catch(() => {
      if (this.#carried === versions) this.#carried = undefined;
    });
    return versions;
  }
}
