import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FolderFiles } from "../src/node/folder-files.js";
import { readConfig, resolveVocabulary } from "../src/node/runtime.js";

export const ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

let resolved: Promise<FolderFiles> | undefined;

/** The vocabulary this checkout runs against, resolved once per run as the commands resolve it. */
export function vocabulary(): Promise<FolderFiles> {
  resolved ??= readConfig(ROOT)
    .then((config) => resolveVocabulary(ROOT, config))
    .then((found) => new FolderFiles(found.folder, found.iri));
  return resolved;
}
