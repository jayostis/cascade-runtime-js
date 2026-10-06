import { basename, dirname, join, resolve as absolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OxigraphStore,
  References,
  WasmBridge,
} from "@cascade-runtime/runtime";
import {
  compiledBridge,
  findBridgePackage,
  findRoot,
  FolderFiles,
  importersNamed,
  inWorker,
  loadConfiguredAdapters,
  type LocalVocabulary,
  localVocabulary,
  type ResolverOptions,
  siblingsOf,
} from "@cascade-runtime/runtime/node";
import type { Parts } from "../pod.js";

/** The matcher's tables every pod is given: those of Alex's kit, alpha test data. */
const TABLES = "conformance/alex-rivera/scripted-input/alex/references/";

export interface ResolvedParts extends Parts {
  /** The vocabulary as a folder, which a kit is replayed from. */
  readonly local: LocalVocabulary;
}

async function resolve(): Promise<ResolvedParts> {
  const root = findRoot(dirname(fileURLToPath(import.meta.url)));
  const local = await localVocabulary(root);
  const { config, files, layout, build } = local;
  const newStore = () => new OxigraphStore();
  const options: ResolverOptions = {
    siblingsIn: await siblingsOf(root),
    cache: join(root, "build", "cache"),
  };
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
        parent: new FolderFiles(dirname(folder)),
      };
    },
    loadBridge: async () => {
      const found = await findBridgePackage(options);
      const bridge = new WasmBridge(
        inWorker(await compiledBridge(found.folder)),
      );
      try {
        const loaded = await loadConfiguredAdapters(
          bridge,
          config.adapters,
          options,
        );
        const adapters = loaded.map(({ adapter }) => adapter);
        return {
          adapters,
          close: async () => {
            await Promise.allSettled(adapters.map((adapter) => adapter.free()));
            bridge.close();
          },
        };
      } catch (error) {
        bridge.close();
        throw error;
      }
    },
  };
}

let found: Promise<ResolvedParts> | undefined;

/** What a pod is opened with, resolved once per process from inside the repository, as every run on main resolves it. */
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
