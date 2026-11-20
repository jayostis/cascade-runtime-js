import { readdir, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
  archiveDirectory,
  archiveEntryBytes,
  archivedFiles,
} from "../archives.js";
import type { Files } from "../files.js";
import type { Layout } from "../layout.js";
import { FolderFiles } from "./folder-files.js";

/** How many files `unpack` holds in hand at once. */
const AT_ONCE = 256;

/** The bytes of the file at the path in the pod in the folder, held at its own path or in an archive. */
export async function catFile(
  pod: string,
  layout: Layout,
  path: string,
): Promise<Uint8Array> {
  const bytes = await archivedFiles(
    new FolderFiles(pod, undefined, { refuseLinks: true }),
    layout,
  ).read(path);
  if (bytes === undefined)
    throw new Error(`the pod in ${pod} holds no ${path}`);
  return bytes;
}

/**
 * Writes into the folder `to`, which must be empty or absent, every file of the pod in the folder `from`, at its own
 * path or in an archive, as the folder a pod held loose would be; or, for `from` an archive, every file it holds. Reads
 * an archive in the profile `archiveDirectory` reads, and refuses any other. Returns how many files it wrote.
 */
export async function unpack(
  from: string,
  to: string,
  layout: Layout,
): Promise<number> {
  const there = await readdir(to).catch(() => []);
  if (there.length > 0)
    throw new Error(
      `${to} is not empty: unpack writes only into an empty folder`,
    );
  const out = new FolderFiles(to);
  let reading: {
    readonly paths: readonly string[];
    readonly read: (path: string) => Promise<Uint8Array>;
  };
  if ((await stat(from)).isFile()) {
    const host = new FolderFiles(dirname(from));
    const entries = await archiveDirectory(
      host,
      basename(from),
      layout.archivesFolder,
    );
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    reading = {
      paths: [...byPath.keys()].sort(),
      read: (path) =>
        archiveEntryBytes(host, byPath.get(path) as (typeof entries)[number]),
    };
  } else {
    const pod: Files = archivedFiles(
      new FolderFiles(from, undefined, { refuseLinks: true }),
      layout,
    );
    reading = {
      paths: await pod.list(""),
      read: async (path) => {
        const bytes = await pod.read(path);
        if (bytes === undefined) throw new Error(`${path} went from ${from}`);
        return bytes;
      },
    };
  }
  const { paths, read } = reading;
  for (let start = 0; start < paths.length; start += AT_ONCE) {
    const batch = paths.slice(start, start + AT_ONCE);
    const files = await Promise.all(
      batch.map(async (path) => [path, await read(path)] as const),
    );
    await out.writeMany(files);
  }
  return paths.length;
}
