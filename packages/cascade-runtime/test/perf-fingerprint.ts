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

/** The label of a blank node as the store gives it: up to 32 hex digits (a leading zero is dropped), drawn at random on every run. */
const BLANK = /_:[0-9a-f]{16,32}\b/g;

/**
 * A statements file that names blank nodes, with each label masked and the lines sorted again: the store sorts a file's
 * lines, so the random label decides where each falls, and no numbering of the labels in the order they appear is the
 * same on two runs. Two blank nodes of one file are therefore not told apart from one; a file with none is as it is.
 */
function masked(text: string): string {
  if (!BLANK.test(text)) return text;
  BLANK.lastIndex = 0;
  return text.replace(BLANK, "_:b").split("\n").sort().join("\n");
}

/**
 * The sha256 of what a plain pod's folder holds: each file's path and content, in name order, so two folders have the
 * same fingerprint only when they hold the same files with the same statements, save that the labels of blank nodes
 * (which the judgments' provenance has) are masked (see `masked`). An encrypted pod's files are sealed with a random
 * key and nonces, so no two runs of it have the same bytes: take the fingerprint of a plain pod of the same record.
 *
 * Its limit: masking the labels loses which blank node carries which statements and how blank nodes link, so a
 * difference that only swaps those between two blank nodes of one file is not seen. It is an export for tests only
 * today; the `sha256` of the dataset spec's `statements` row (what is stored) is what will use it, and that row must
 * not be read as proof of identical blank-node structure. A canonical labelling (a hash of each node's neighbourhood)
 * would close the gap and is left until a row needs it.
 */
export async function folderFingerprint(
  folder: string,
): Promise<{ sha256: string; files: number }> {
  const hash = createHash("sha256");
  const files = await filesUnder(folder);
  for (const path of files) {
    const bytes = await readFile(join(folder, path));
    const content = /\.(ttl|nt|nq|trig)$/.test(path)
      ? masked(bytes.toString("utf8"))
      : bytes;
    hash
      .update(`${path}\n`)
      .update(createHash("sha256").update(content).digest());
  }
  return { sha256: hash.digest("hex"), files: files.length };
}
