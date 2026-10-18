import { CODES, type Files, writeAll } from "@cascade-runtime/runtime";
import type { RowsWork } from "../rows.js";

/** In the starter copies, what follows a version's file stem in place of `.ttl`: its rows as the feed published them. */
export const PUBLISHED_ROWS = ".nq.gz";

/** What follows a version's file stem in the name of its listing, which a search reads. */
export const LISTED = ".listed.json";

/** How many of the starter's versions are read ahead while copying. */
export const READ_AHEAD = 3;

const OF_A_VERSION = [PUBLISHED_ROWS, CODES, LISTED];

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
): Promise<(readonly [string, Uint8Array])[]> {
  const read = await Promise.all(
    paths.map(async (path) => [path, await starter.read(path)] as const),
  );
  const files: (readonly [string, Uint8Array])[] = [];
  for (const [path, bytes] of read) {
    if (bytes === undefined) continue;
    files.push(
      path === `${stem}${PUBLISHED_ROWS}`
        ? [`${stem}.ttl`, await work.published(new Uint8Array(bytes))]
        : [path, bytes],
    );
  }
  return files;
}

function settled(promise: Promise<unknown>): Promise<void> {
  return promise.then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Copies the versions into the store: up to READ_AHEAD read ahead, one at a time through `work`, each written in one
 * `writeAll`, at most one write outstanding. The bytes written.
 */
export async function copyVersions(
  store: Files,
  starter: Files,
  work: RowsWork,
  versions: ReadonlyMap<string, readonly string[]>,
): Promise<number> {
  // A version's rows are read once the one before is, and once each write begun before they were asked has ended, so
  // at most two versions' rows are held whole. A version is ahead until its rows' turn comes; then the next is fetched.
  let turn: Promise<void> = Promise.resolve();
  const queued = [...versions];
  const copying: Promise<(readonly [string, Uint8Array])[]>[] = [];
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
    const files = versionFiles(starter, version[0], version[1], {
      ...work,
      published: (bytes) => {
        const rows = turn.then(() => {
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
      writing = writeAll(store, copied);
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
