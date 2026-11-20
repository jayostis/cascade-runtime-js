import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

/** Every file under `folder`, as paths relative to it with `/`, in name order. */
async function filesUnder(folder: string, at = folder): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(at, { withFileTypes: true }))
    found.push(
      ...(entry.isDirectory()
        ? await filesUnder(folder, join(at, entry.name))
        : [relative(folder, join(at, entry.name)).replaceAll("\\", "/")]),
    );
  return found.sort();
}

/**
 * The sha256 of what a pod's folder holds: each file's path and bytes, in name order, so two folders have the same
 * fingerprint only when they hold the same files with the same content. For a plain pod that is the same statements; an
 * encrypted pod's bytes differ by their random salts, so its fingerprint is of what it holds once opened, not of this.
 */
export async function folderFingerprint(
  folder: string,
): Promise<{ sha256: string; files: number }> {
  const hash = createHash("sha256");
  const files = await filesUnder(folder);
  for (const path of files)
    hash.update(`${path}\n`).update(
      createHash("sha256")
        .update(await readFile(join(folder, path)))
        .digest(),
    );
  return { sha256: hash.digest("hex"), files: files.length };
}
