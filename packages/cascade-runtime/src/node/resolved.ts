import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve as absolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appTablesSettings,
  type Files,
  importersNamed,
  MemoryFiles,
  OxigraphStore,
  type TablesSettings,
  tablesSettings,
  WasmBridge,
  withTables,
} from "@cascade-runtime/runtime";
import {
  CONFIG_FILE,
  compiledBridge,
  type Components,
  componentsOf,
  findRoot,
  FolderFiles,
  inWorker,
  loadConfiguredAdapters,
  type LocalVocabulary,
  vocabularyOf,
} from "@cascade-runtime/runtime/node";
import { bridgeLoaded, type Parts } from "../pod.js";
import { Tables } from "../tables.js";
import { builderAt, localBuilds, withFiles } from "./builders.js";

export interface ResolvedParts extends Parts {
  /** The vocabulary as a folder, which a kit is replayed from. */
  readonly local: LocalVocabulary;
  /** The tables kept in the folder, started from the starter copies; `tables` is kept in memory. */
  tablesIn(folder: string): Tables;
}

export interface PartsOptions {
  /** The package's starter copies of the feeds' series. */
  readonly starter?: Files;
  /** What reads the feeds, and what a builder downloads with. */
  readonly fetch?: typeof fetch;
  /** The app's settings of its tables, each replacing the package's; a builder's path in them is absolute. */
  readonly tables?: TablesSettings;
}

/** The app's tables settings: its own `cascade-runtime.json` in the folder it runs in, unless that is the package's. */
export async function appSettings(
  folder: string,
  packageConfig: string,
): Promise<TablesSettings> {
  const path = join(folder, CONFIG_FILE);
  if (!existsSync(path) || absolute(path) === absolute(packageConfig))
    return {};
  const settings = appTablesSettings(await readFile(path, "utf8"));
  return settings.builders === undefined
    ? settings
    : {
        ...settings,
        builders: settings.builders.map((builder) =>
          builderAt(builder, dirname(path)),
        ),
      };
}

let configured: TablesSettings = {};
let configuredFetch: typeof fetch | undefined;
let tablesMade = false;

/** Sets the app's tables in code, each setting replacing the package's and the app's file's, before the first pod opens. */
export function configureTables(
  settings: TablesSettings & { readonly fetch?: typeof fetch },
): void {
  if (tablesMade)
    throw new Error(
      "configureTables comes before the first pod opens: the tables are already made",
    );
  const { fetch: fetching, ...rest } = settings;
  const given = tablesSettings(rest, "configureTables");
  configured =
    given.builders === undefined
      ? given
      : {
          ...given,
          builders: given.builders.map((builder) =>
            builderAt(builder, process.cwd()),
          ),
        };
  configuredFetch = fetching;
}

/** The answers of the pod in the folder: a folder of their own, `.answers/<name>`, beside the pod's. */
export function answersBeside(path: string): FolderFiles {
  const folder = absolute(path);
  return new FolderFiles(join(dirname(folder), ".answers", basename(folder)));
}

async function resolve(): Promise<ResolvedParts> {
  const packageFolder = fileURLToPath(new URL("../../../", import.meta.url));
  const starter = join(packageFolder, "components", "tables");
  const carried = join(packageFolder, "components", CONFIG_FILE);
  tablesMade = true;
  const parts = await partsOf(await componentsOf(packageFolder), {
    ...(existsSync(starter) ? { starter: new FolderFiles(starter) } : {}),
    ...(configuredFetch === undefined ? {} : { fetch: configuredFetch }),
    tables: {
      ...(await appSettings(
        process.cwd(),
        existsSync(carried)
          ? carried
          : join(findRoot(packageFolder), CONFIG_FILE),
      )),
      ...configured,
    },
  });
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
export async function partsOf(
  components: Components,
  options: PartsOptions = {},
): Promise<ResolvedParts> {
  const found = await vocabularyOf(components);
  const config = withTables(found.config, options.tables ?? {});
  const local = { ...found, config };
  const { files, layout, build } = local;
  const newStore = () => new OxigraphStore();
  const fetching = withFiles(options.fetch ?? fetch);
  const { feeds, preference, builders } = config.tables;
  const tablesOver = (store: Files, pods?: string): Tables =>
    new Tables({
      files: store,
      feeds,
      vocabulary: files,
      newStore,
      preference,
      fetch: fetching,
      ...(options.starter === undefined ? {} : { starter: options.starter }),
      ...(pods === undefined || builders.length === 0
        ? {}
        : {
            builds: localBuilds(
              builders,
              join(pods, ".builds"),
              local.resolved.folder,
              fetching,
            ),
          }),
    });
  return {
    local,
    vocabulary: files,
    layout,
    build,
    lens: config.lens,
    importers: importersNamed(config.importers),
    tables: tablesOver(new MemoryFiles("urn:cascade:tables/")),
    tablesIn: (folder) =>
      tablesOver(new FolderFiles(absolute(folder)), dirname(absolute(folder))),
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
      if (found !== resolving) return;
      found = undefined;
      tablesMade = false;
    });
  }
  return found;
}
