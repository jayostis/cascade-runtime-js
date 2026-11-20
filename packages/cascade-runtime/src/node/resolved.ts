import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve as absolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appTablesSettings,
  type BesideDatabase,
  DATABASE_BESIDE,
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
  archivedFiles,
  argon2id,
  CONFIG_FILE,
  compiledBridge,
  databaseAt,
  type Components,
  componentsOf,
  findRoot,
  FolderFiles,
  inWorker,
  loadSharedAdapters,
  type LocalVocabulary,
  thisRuntime,
  vocabularyOf,
} from "@cascade-runtime/runtime/node";
import { bridgeLoaded, type Parts } from "../pod.js";
import { Tables } from "../tables.js";
import { acceptOptions } from "../options.js";
import { builderAt, localBuilds, withFiles } from "./builders.js";
import { withKeptRows } from "./rowCache.js";

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

/** The folder of what is kept beside the pod in the folder, `.answers/<name>`. */
export function besideFolder(path: string): string {
  const folder = absolute(path);
  return join(dirname(folder), ".answers", basename(folder));
}

/** The answers of the pod in the folder: a folder of their own, `.answers/<name>`, beside the pod's. */
export function answersBeside(path: string): FolderFiles {
  return new FolderFiles(besideFolder(path), undefined, { refuseLinks: true });
}

/** The database of the pod in the folder, in the folder of its answers: `pod.db`, or the path `name` there. */
export function databaseBeside(
  path: string,
  name: string = DATABASE_BESIDE,
): BesideDatabase {
  return databaseAt(join(besideFolder(path), ...name.split("/")));
}

const PACKAGE = fileURLToPath(new URL("../../../", import.meta.url));
const STARTER = join(PACKAGE, "components", "tables");

const carriedStarter = (): PartsOptions =>
  existsSync(STARTER) ? { starter: new FolderFiles(STARTER) } : {};

let installed: Promise<ResolvedParts> | undefined;

/** What a pod is opened with from what the package carries alone, its components and its starter copies, as no app's settings change them; resolved once per process. */
export function installedParts(): Promise<ResolvedParts> {
  if (installed === undefined) {
    const resolving = componentsOf(PACKAGE).then((components) =>
      partsOf(components, carriedStarter()),
    );
    installed = resolving;
    resolving.catch(() => {
      if (installed === resolving) installed = undefined;
    });
  }
  return installed;
}

async function resolve(): Promise<ResolvedParts> {
  const carried = join(PACKAGE, "components", CONFIG_FILE);
  tablesMade = true;
  const parts = await partsOf(await componentsOf(PACKAGE), {
    ...carriedStarter(),
    ...(configuredFetch === undefined ? {} : { fetch: configuredFetch }),
    tables: {
      ...(await appSettings(
        process.cwd(),
        existsSync(carried) ? carried : join(findRoot(PACKAGE), CONFIG_FILE),
      )),
      ...configured,
    },
  });
  const { version } = JSON.parse(
    await readFile(join(PACKAGE, "package.json"), "utf8"),
  ) as { version: string };
  return keptBeside(parts, version, () => builtCode(PACKAGE));
}

/**
 * The parts with what a pod in a folder keeps beside it: its answers, when a packed build of the runtime at a commit
 * computes them, and its build wherever the runtime (N7) and the components it runs are each at a commit, since the
 * build's hash names the runtime by its IRI; a checkout's build under its built code too, which no commit holds, so code
 * built before a pull or a switch of branch keeps no build under the new commit's name. Wherever either is kept, so is the
 * pod's database. A runtime with changes outside a commit keeps none of them.
 */
export async function keptBeside<
  P extends {
    readonly performer: string;
    readonly local: { readonly resolved: { readonly uncommitted?: number } };
  },
>(
  parts: P,
  version: string,
  code: () => Promise<string>,
): Promise<
  P & Pick<Parts, "answers" | "builtBeside" | "builtCode" | "databaseBeside">
> {
  const clean = parts.local.resolved.uncommitted === 0;
  if (clean && /-commit-[0-9a-f]+$/.test(version))
    return {
      ...parts,
      answers: { runtime: version, at: answersBeside },
      databaseBeside,
    };
  return clean && !parts.performer.includes("#")
    ? {
        ...parts,
        builtBeside: answersBeside,
        builtCode: await code(),
        databaseBeside,
      }
    : parts;
}

/**
 * The SHA-256, in hex, of the code a checkout's package in the folder runs: each file built under `dist/src` of it and of
 * each package of the checkout it depends on, by name, its source maps and declarations aside.
 */
export async function builtCode(folder: string): Promise<string> {
  const packages = dirname(absolute(folder));
  const named = new Map<string, { folder: string; depends: string[] }>();
  for (const entry of await readdir(packages, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const at = join(packages, entry.name);
    const manifest = await readFile(join(at, "package.json"), "utf8").catch(
      () => undefined,
    );
    if (manifest === undefined) continue;
    const { name, dependencies } = JSON.parse(manifest) as {
      name?: string;
      dependencies?: Record<string, string>;
    };
    if (name !== undefined)
      named.set(name, { folder: at, depends: Object.keys(dependencies ?? {}) });
  }
  const own = [...named.values()].find(
    (found) => absolute(found.folder) === absolute(folder),
  );
  const runs = new Set<string>();
  const reach = (found: { folder: string; depends: string[] } | undefined) => {
    if (found === undefined || runs.has(found.folder)) return;
    runs.add(found.folder);
    for (const name of found.depends) reach(named.get(name));
  };
  reach(own);
  const found = (
    await Promise.all(
      [...runs].map(async (at) =>
        (
          await readdir(join(at, "dist", "src"), {
            recursive: true,
            withFileTypes: true,
          }).catch(() => [])
        )
          .filter(
            (entry) =>
              entry.isFile() &&
              !entry.name.endsWith(".map") &&
              !entry.name.endsWith(".d.ts"),
          )
          .map((entry) => join(entry.parentPath, entry.name)),
      ),
    )
  ).flat();
  // Named and ordered by a path written with "/", so one pod synced between operating systems keeps its build.
  const paths = found
    .map((path) => ({
      path,
      named: path.slice(packages.length).split(sep).join("/"),
    }))
    .sort((a, b) => (a.named < b.named ? -1 : a.named > b.named ? 1 : 0));
  const read = await Promise.all(paths.map(({ path }) => readFile(path)));
  const hash = createHash("sha256");
  for (const [index, { named }] of paths.entries()) {
    hash.update(named);
    hash.update(new Uint8Array([0]));
    hash.update(read[index] as Uint8Array);
    hash.update(new Uint8Array([0]));
  }
  return hash.digest("hex");
}

/** What a pod is opened with over the components, folders on disk; nothing is kept. */
export async function partsOf(
  components: Components,
  options: PartsOptions = {},
): Promise<ResolvedParts> {
  acceptOptions("partsOf", options, {
    starter: true,
    fetch: true,
    tables: true,
  });
  const found = await vocabularyOf(components);
  const config = withTables(found.config, options.tables ?? {});
  const local = { ...found, config };
  const { files, layout, build } = local;
  const newStore = () => new OxigraphStore();
  const fetching = withFiles(withKeptRows(options.fetch ?? fetch));
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
    performer: await thisRuntime(),
    vocabulary: files,
    layout,
    build,
    lens: config.lens,
    importers: importersNamed(config.importers),
    tables: tablesOver(new MemoryFiles("urn:cascade:tables/")),
    tablesIn: (folder) =>
      tablesOver(new FolderFiles(absolute(folder)), dirname(absolute(folder))),
    newStore,
    derive: argon2id,
    folder: (path, iri) => {
      const folder = absolute(path);
      return {
        files: archivedFiles(
          new FolderFiles(folder, iri, { refuseLinks: true }),
          layout,
        ),
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
        (bridge) =>
          loadSharedAdapters(found.folder, bridge, config.adapters, components),
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
