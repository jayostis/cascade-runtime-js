import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Layout } from "../src/layout.js";
import { FolderFiles } from "../src/node/folder-files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
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

let read: Promise<Layout> | undefined;

/** The vocabulary's pod layout, read once per run. */
export function layout(): Promise<Layout> {
  read ??= vocabulary().then((files) =>
    Layout.read(files, () => new OxigraphStore()),
  );
  return read;
}
