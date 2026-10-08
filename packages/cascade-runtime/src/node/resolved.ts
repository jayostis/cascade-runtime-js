import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve as absolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  importersNamed,
  OxigraphStore,
  References,
  WasmBridge,
} from "@cascade-runtime/runtime";
import {
  compiledBridge,
  type Components,
  componentsOf,
  FolderFiles,
  inWorker,
  loadConfiguredAdapters,
  type LocalVocabulary,
  vocabularyOf,
} from "@cascade-runtime/runtime/node";
import { bridgeLoaded, type Parts, TABLES } from "../pod.js";

export interface ResolvedParts extends Parts {
  /** The vocabulary as a folder, which a kit is replayed from. */
  readonly local: LocalVocabulary;
}

/** The answers of the pod in the folder: a folder of their own, `.answers/<name>`, beside the pod's. */
export function answersBeside(path: string): FolderFiles {
  const folder = absolute(path);
  return new FolderFiles(join(dirname(folder), ".answers", basename(folder)));
}

async function resolve(): Promise<ResolvedParts> {
  const packageFolder = fileURLToPath(new URL("../../../", import.meta.url));
  const parts = await partsOf(await componentsOf(packageFolder));
  const { version } = JSON.parse(
    await readFile(join(packageFolder, "package.json"), "utf8"),
  ) as { version: string };
  const stored =
    /-commit-[0-9a-f]+$/.test(version) &&
    parts.local.resolved.uncommitted === 0;
  return stored
    ? { ...parts, answers: { runtime: version, at: answersBeside } }
    : parts;
}

/** What a pod is opened with over the components, folders on disk; nothing is kept. */
export async function partsOf(components: Components): Promise<ResolvedParts> {
  const local = await vocabularyOf(components);
  const { config, files, layout, build } = local;
  const newStore = () => new OxigraphStore();
  return {
    local,
    vocabulary: files,
    layout,
    build,
    lens: config.lens,
    importers: importersNamed(config.importers),
    references: await References.of(files, TABLES, newStore),
    newStore,
    folder: (path, iri) => {
      const folder = absolute(path);
      return {
        files: new FolderFiles(folder, iri),
        name: basename(folder),
      };
    },
    exportAt: (path) => {
      const at = absolute(path);
      return { files: new FolderFiles(dirname(at)), name: basename(at) };
    },
    loadBridge: async () => {
      const found = await components.bridge();
      return bridgeLoaded(
        new WasmBridge(inWorker(await compiledBridge(found.folder))),
        (bridge) => loadConfiguredAdapters(bridge, config.adapters, components),
      );
    },
  };
}

let found: Promise<ResolvedParts> | undefined;

/** What a pod is opened with, resolved once per process: from what the package carries, or in the repository as every run on main resolves it. */
export function resolved(): Promise<ResolvedParts> {
  if (found === undefined) {
    const resolving = resolve();
    found = resolving;
    resolving.catch(() => {
      if (found === resolving) found = undefined;
    });
  }
  return found;
}
