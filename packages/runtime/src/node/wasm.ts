import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import type { Bridge } from "../bridge.js";
import type { Followed } from "../config.js";
import { type Loaded, loadAdapters } from "../load-adapter.js";
import { counted } from "../probe.js";
import {
  BRIDGE_GLUE as GLUE,
  BRIDGE_WASM as WASM,
  type CompiledBridge,
  type Spawn,
  Waiting,
} from "../wasm-bridge.js";
import {
  BUILD,
  builtAt,
  type Picked,
  pickedBuild,
  releasedBuild,
} from "./bridge-build.js";
import { checkout as gitState } from "./git.js";
import { FolderFiles } from "./folder-files.js";
import type { Components } from "./components.js";
import {
  optionsKey,
  type Resolved,
  type ResolverOptions,
  siblingIn,
} from "./resolver.js";

const PACKAGE = "cascade-bridge-rs";
/** The repository the Bridge's build is read from. */
export const BRIDGE_REPOSITORY =
  "https://github.com/jayostis/cascade-bridge-rs";

export interface BridgePackageFound {
  readonly source: "sibling" | "folder" | "release" | "packed";
  /** The folder holding the built package. */
  readonly folder: string;
  /** The commit it was built from. */
  readonly commit: string;
  readonly dirty: boolean;
  /** The release it was downloaded from. */
  readonly release?: string;
  /** How the release was picked, for a downloaded one. */
  readonly how?: string;
}

interface BuiltFrom {
  readonly commit: string;
  readonly dirty: boolean;
  readonly sources: string;
}

async function builtFrom(folder: string): Promise<BuiltFrom | undefined> {
  try {
    const manifest = JSON.parse(
      await readFile(join(folder, "package.json"), "utf8"),
    ) as { cascadeBridge?: BuiltFrom };
    return manifest.cascadeBridge;
  } catch {
    return undefined;
  }
}

function short(commit: string): string {
  return commit.slice(0, 12);
}

/** The build in a checkout's `package/dist` when it was made from the checkout as it is, or why it was passed over. */
async function checkoutBuild(
  checkout: string,
): Promise<{ dist: string; built: BuiltFrom } | string> {
  const dist = join(checkout, "package", "dist");
  const built = await builtFrom(dist);
  if (built === undefined || !existsSync(join(dist, WASM)))
    return `the checkout ${checkout} holds no build`;
  const sources = await promisify(execFile)(process.execPath, [
    join(checkout, "package", "sources.mjs"),
  ]).then(
    ({ stdout }) => stdout.trim(),
    (error: Error) => error,
  );
  if (sources instanceof Error)
    return `the sources of the checkout ${checkout} could not be read: ${sources.message.split("\n")[0]}`;
  if (sources !== built.sources)
    return `the build in ${dist} is stale: it was made from other sources than the checkout holds`;
  return { dist, built };
}

/**
 * The Bridge's package a run uses: the build of a sibling checkout, then of a checkout handed in, when it was made
 * from the checkout as it is on disk; otherwise the release of the commit the first of them is at, when nothing in it is
 * uncommitted; with neither, the release of the commit {@link pickedBuild} picks, as a counterpart is picked. The run
 * says which, and why a checkout's build was passed over.
 */
export async function findBridgePackage(
  options: ResolverOptions,
  repository: string = BRIDGE_REPOSITORY,
): Promise<BridgePackageFound> {
  const key = JSON.stringify([optionsKey(options), repository]);
  let found = foundPackages.get(key);
  if (found === undefined) {
    const said: string[] = [];
    const pending = findBridgePackageNow(
      { ...options, log: (line) => said.push(line) },
      repository,
    ).then((located) => ({ located, said }));
    found = pending;
    foundPackages.set(key, pending);
    pending.catch(() => {
      if (foundPackages.get(key) === pending) foundPackages.delete(key);
    });
  }
  const { located, said: lines } = await found;
  for (const line of lines) options.log?.(line);
  return located;
}

/** Found once per process for each set of options, as git and the sources of a checkout are read once. */
const foundPackages = new Map<
  string,
  Promise<{ located: BridgePackageFound; said: string[] }>
>();

async function findBridgePackageNow(
  options: ResolverOptions,
  repository: string,
): Promise<BridgePackageFound> {
  counted("bridge.package.found");
  const passedOver: string[] = [];
  let unbuilt: Picked | undefined;
  const checkouts = [
    ["sibling", siblingIn(options.siblingsIn, PACKAGE)],
    ["folder", options.folders?.get(repository)],
  ] as const;
  for (const [source, checkout] of checkouts) {
    if (checkout === undefined) continue;
    const found = await checkoutBuild(checkout);
    const where =
      source === "sibling"
        ? "the sibling checkout's"
        : "the handed-in checkout's";
    if (typeof found === "string") {
      passedOver.push(found);
      const state =
        unbuilt === undefined ? await gitState(checkout) : undefined;
      if (state === undefined) continue;
      if (state.uncommitted > 0)
        throw new Error(
          `${found}, and its ${state.uncommitted} uncommitted files are in no release: build it with sh package/build.sh, or commit them`,
        );
      unbuilt = {
        commit: state.commit,
        how: `the commit ${checkout} is at`,
      };
      continue;
    }
    options.log?.(
      `${PACKAGE}: ${where} build in ${found.dist}, of ${short(found.built.commit)}${found.built.dirty ? " with uncommitted changes" : ""}${passedOver.map((why) => `; ${why}`).join("")}`,
    );
    return { source, folder: found.dist, ...found.built };
  }
  const at = join(options.cache, PACKAGE);
  const found = await releasedAt(
    repository,
    unbuilt === undefined
      ? await pickedBuild(repository, at)
      : await builtAt(repository, at, unbuilt.commit, unbuilt.how),
    at,
  );
  options.log?.(
    `${PACKAGE}: the release ${found.release}, ${found.how}${passedOver.map((why) => `; ${why}`).join("")}`,
  );
  return found;
}

/** The release of cascade-bridge-rs at the commit {@link pickedBuild} picks for this run, downloaded under `cache`. */
export function releasedBridgePackage(
  cache: string,
): Promise<BridgePackageFound> {
  let found = released.get(cache);
  if (found === undefined) {
    const at = join(cache, PACKAGE);
    const pending = pickedBuild(BRIDGE_REPOSITORY, at).then((picked) =>
      releasedAt(BRIDGE_REPOSITORY, picked, at),
    );
    found = pending;
    released.set(cache, pending);
    pending.catch(() => {
      if (released.get(cache) === pending) released.delete(cache);
    });
  }
  return found;
}

const released = new Map<string, Promise<BridgePackageFound>>();

async function releasedAt(
  repository: string,
  { commit, how }: Picked,
  at: string,
): Promise<BridgePackageFound> {
  const folder = await releasedBuild(repository, commit, at);
  const built = await builtFrom(folder);
  if (built === undefined)
    throw new Error(`${folder} records no commit it was built from`);
  return {
    source: "release",
    folder,
    ...built,
    release: `${BUILD}${commit}`,
    how,
  };
}

/** The Bridge's package a package carries in `nodeModules`, as the build copied it from the release named. */
export async function bundledBridge(
  nodeModules: string,
  release: string,
): Promise<BridgePackageFound> {
  const folder = join(nodeModules, PACKAGE);
  const built = await builtFrom(folder);
  if (built === undefined || !existsSync(join(folder, WASM)))
    throw new Error(`the package carries no ${PACKAGE} in ${nodeModules}`);
  return { source: "packed", folder, ...built, release };
}

const compiled = new Map<string, Promise<CompiledBridge>>();

/** The package's module, compiled once per process for each folder. */
export function compiledBridge(folder: string): Promise<CompiledBridge> {
  let found = compiled.get(folder);
  if (found === undefined) {
    found = readFile(join(folder, WASM)).then(async (bytes) => ({
      glue: pathToFileURL(join(folder, GLUE)).href,
      module: await WebAssembly.compile(bytes),
    }));
    compiled.set(folder, found);
  }
  return found;
}

/** Each instance in a worker thread of its own, which keeps the process alive only while a call waits on it. */
export function inWorker(bridge: CompiledBridge): Spawn {
  return () => {
    counted("bridge.workers");
    const worker = new Worker(new URL("./wasm-worker.js", import.meta.url), {
      workerData: bridge,
    });
    worker.unref();
    const waiting = new Waiting();
    const settled = (): void => {
      if (waiting.size === 0) worker.unref();
    };
    worker.on("message", (message) => {
      waiting.answered(message);
      settled();
    });
    worker.on("error", (error) => waiting.lost(error));
    worker.on("exit", (code) =>
      waiting.lost(new Error(`the worker exited with code ${code}`)),
    );
    return Promise.resolve({
      call: async (request, transfer) => {
        worker.ref();
        try {
          return await waiting.send(
            (message) => worker.postMessage(message, transfer),
            request,
          );
        } finally {
          settled();
        }
      },
      end: () => void worker.terminate(),
    });
  };
}

export interface ConfiguredAdapter extends Loaded {
  readonly resolved: Resolved;
}

/**
 * Each adapter of cascade-runtime.json, resolved as the vocabulary is and loaded with every file of its folder, with
 * the vocabulary it reads, resolved the same way. The run says which version of each it used.
 */
export async function loadConfiguredAdapters(
  bridge: Bridge,
  adapters: readonly Followed[],
  components: Components,
): Promise<ConfiguredAdapter[]> {
  const found = new Map<Followed, Resolved>();
  const loaded = await loadAdapters(bridge, adapters, async (followed) => {
    const resolved = await components.resolve(followed);
    found.set(followed, resolved);
    return {
      iri: resolved.iri,
      files: new FolderFiles(resolved.folder, resolved.iri),
      whole: true,
    };
  });
  return loaded.map((each, index) => {
    const resolved = found.get(adapters[index] as Followed);
    if (resolved === undefined)
      throw new Error(`adapter ${index} was loaded but never resolved`);
    return { ...each, resolved };
  });
}

/** Each file's path, size and time of last change, as one digest: what changes when a file under the folder does. */
async function signature(
  folder: string,
  only?: readonly string[],
): Promise<string> {
  const paths =
    only ??
    (await readdir(folder, { recursive: true, withFileTypes: true }))
      .filter(
        (entry) =>
          !entry.isDirectory() && !entry.parentPath.split(sep).includes(".git"),
      )
      .map((entry) =>
        join(entry.parentPath, entry.name).slice(folder.length + 1),
      );
  const lines = await Promise.all(
    paths.map(async (path) => {
      const found = await stat(join(folder, path)).catch(() => undefined);
      return `${path}:${found?.size}:${found?.mtimeMs}`;
    }),
  );
  return createHash("sha256").update(lines.sort().join("\n")).digest("hex");
}

interface Shared {
  readonly loaded: Loaded;
  /** The vocabulary files the adapter was given, as they were. */
  readonly vocabulary?: {
    readonly folder: string;
    readonly files: readonly string[];
    readonly signature: string;
  };
}

const shared = new Map<string, Promise<Shared>>();

/**
 * {@link loadConfiguredAdapters}, with each adapter loaded once per process into the Bridge of the first caller and
 * shared by every later one, as the same folders of the same Bridge build give the same adapter: a pod that closes lets
 * go of nothing, and the worker holding them stays out of the way of the process ending. An adapter's folder or its
 * vocabulary files that changed on disk (by path, size and time of change) are loaded again.
 */
export async function loadSharedAdapters(
  bridgeFolder: string,
  bridge: Bridge,
  adapters: readonly Followed[],
  components: Components,
): Promise<ConfiguredAdapter[]> {
  const out: ConfiguredAdapter[] = [];
  for (const followed of adapters) {
    const resolved = await components.resolve(followed);
    const key = [
      bridgeFolder,
      resolved.iri,
      resolved.folder,
      await signature(resolved.folder),
    ].join(" ");
    let entry = shared.get(key);
    if (entry !== undefined) {
      const found = await entry.catch(() => undefined);
      const vocabulary = found?.vocabulary;
      if (
        found === undefined ||
        (vocabulary !== undefined &&
          (await signature(vocabulary.folder, vocabulary.files)) !==
            vocabulary.signature)
      ) {
        if (shared.get(key) === entry) shared.delete(key);
        entry = undefined;
      }
    }
    if (entry === undefined) {
      const loading = loadFirst(bridge, followed, components);
      entry = loading;
      shared.set(key, loading);
      loading.catch(() => {
        if (shared.get(key) === loading) shared.delete(key);
      });
    }
    const { loaded } = await entry;
    out.push({
      ...loaded,
      adapter: { ...loaded.adapter, free: () => Promise.resolve() },
      resolved,
    });
  }
  return out;
}

async function loadFirst(
  bridge: Bridge,
  followed: Followed,
  components: Components,
): Promise<Shared> {
  let vocabularyAt: Resolved | undefined;
  const [loaded] = await loadAdapters(bridge, [followed], async (each) => {
    const resolved = await components.resolve(each);
    if (each !== followed) vocabularyAt = resolved;
    return {
      iri: resolved.iri,
      files: new FolderFiles(resolved.folder, resolved.iri),
      whole: true,
    };
  });
  if (loaded === undefined) throw new Error("no adapter was loaded");
  const files = loaded.description.vocabulary?.files ?? [];
  return {
    loaded,
    ...(vocabularyAt !== undefined && {
      vocabulary: {
        folder: vocabularyAt.folder,
        files,
        signature: await signature(vocabularyAt.folder, files),
      },
    }),
  };
}
