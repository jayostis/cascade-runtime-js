import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import type { Bridge } from "../bridge.js";
import { type Followed, repositoryName } from "../config.js";
import { commitPin, type Loaded, loadAdapter } from "../load-adapter.js";
import { type CompiledBridge, type Spawn, Waiting } from "../wasm-bridge.js";
import { BUILD, latestBuild, releasedBuild } from "./bridge-build.js";
import { FolderFiles } from "./folder-files.js";
import {
  type Resolved,
  type ResolverOptions,
  resolve,
  siblingIn,
} from "./resolver.js";

const PACKAGE = "cascade-bridge-rs";
/** The repository whose main the Bridge's build is followed on. */
export const BRIDGE_REPOSITORY =
  "https://github.com/jayostis/cascade-bridge-rs";
const BRANCH = "main";
const GLUE = "cascade_bridge.js";
const WASM = "cascade_bridge_bg.wasm";

export interface BridgePackageFound {
  readonly source: "sibling" | "folder" | "release";
  /** The folder holding the built package. */
  readonly folder: string;
  /** The commit it was built from. */
  readonly commit: string;
  readonly dirty: boolean;
  /** The release it was downloaded from, for a build of main. */
  readonly release?: string;
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
 * from the checkout as it is on disk; otherwise the release cascade-bridge-rs published for the newest commit of its
 * main that has one. The run says which, and why a checkout's build was passed over.
 */
export async function findBridgePackage(
  options: ResolverOptions,
): Promise<BridgePackageFound> {
  const passedOver: string[] = [];
  const checkouts = [
    ["sibling", siblingIn(options.siblingsIn, PACKAGE)],
    ["folder", options.folders?.get(BRIDGE_REPOSITORY)],
  ] as const;
  for (const [source, checkout] of checkouts) {
    if (checkout === undefined) continue;
    const found = await checkoutBuild(checkout);
    if (typeof found === "string") {
      passedOver.push(found);
      continue;
    }
    const where =
      source === "sibling"
        ? "the sibling checkout's"
        : "the handed-in checkout's";
    options.log?.(
      `${PACKAGE}: ${where} build in ${found.dist}, of ${short(found.built.commit)}${found.built.dirty ? " with uncommitted changes" : ""}${passedOver.map((why) => `; ${why}`).join("")}`,
    );
    return { source, folder: found.dist, ...found.built };
  }
  const cache = join(options.cache, PACKAGE);
  const commit = await latestBuild(BRIDGE_REPOSITORY, BRANCH, cache);
  const folder = await releasedBuild(BRIDGE_REPOSITORY, commit, cache);
  const built = await builtFrom(folder);
  if (built === undefined)
    throw new Error(`${folder} records no commit it was built from`);
  const release = `${BUILD}${commit}`;
  options.log?.(
    `${PACKAGE}: the release ${release}, the newest build of ${BRANCH}${passedOver.map((why) => `; ${why}`).join("")}`,
  );
  return { source: "release", folder, ...built, release };
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
 * the vocabulary at the commit it pins. The run says which version of each it used.
 */
export async function loadConfiguredAdapters(
  bridge: Bridge,
  adapters: readonly Followed[],
  options: ResolverOptions,
): Promise<ConfiguredAdapter[]> {
  const loaded: ConfiguredAdapter[] = [];
  try {
    for (const followed of adapters)
      loaded.push(await loadConfigured(bridge, followed, options));
  } catch (error) {
    await Promise.allSettled(loaded.map(({ adapter }) => adapter.free()));
    throw error;
  }
  return loaded;
}

async function loadConfigured(
  bridge: Bridge,
  followed: Followed,
  options: ResolverOptions,
): Promise<ConfiguredAdapter> {
  const resolved = await resolve(followed, options);
  const adapter = await loadAdapter(
    bridge,
    {
      iri: resolved.iri,
      files: new FolderFiles(resolved.folder, resolved.iri),
      whole: true,
    },
    async (vocabularyPin) => {
      if (vocabularyPin === undefined)
        throw new Error(
          `${repositoryName(followed)} names vocabulary files but pins no vocabulary`,
        );
      const vocabulary = await resolve(commitPin(vocabularyPin), {
        ...options,
        log: (line) =>
          options.log?.(
            `the vocabulary ${repositoryName(followed)} pins, ${line}`,
          ),
      });
      return {
        iri: vocabulary.iri,
        files: new FolderFiles(vocabulary.folder, vocabulary.iri),
      };
    },
  );
  return { ...adapter, resolved };
}
