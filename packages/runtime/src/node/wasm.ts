import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import type { Bridge } from "../bridge.js";
import { type Pin, repositoryName } from "../config.js";
import { commitPin, type Loaded, loadAdapter } from "../load-adapter.js";
import { type CompiledBridge, type Spawn, Waiting } from "../wasm-bridge.js";
import { FolderFiles } from "./folder-files.js";
import { type Resolved, resolve } from "./resolver.js";

const PACKAGE = "cascade-bridge-rs";
const GLUE = "cascade_bridge.js";
const WASM = "cascade_bridge_bg.wasm";

export interface BridgePackageFound {
  readonly source: "sibling" | "pin";
  /** The folder holding the built package. */
  readonly folder: string;
  /** The commit it was built from. */
  readonly commit: string;
  readonly dirty: boolean;
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

/**
 * The Bridge's package a run uses: a sibling checkout's build when it was made from the checkout as it is on disk,
 * otherwise the pin in package.json. The run says which, and why a sibling's build was passed over.
 */
export async function findBridgePackage(
  siblingsIn: string,
  log?: (line: string) => void,
): Promise<BridgePackageFound> {
  const checkout = join(siblingsIn, PACKAGE);
  const dist = join(checkout, "package", "dist");
  let passedOver: string | undefined;
  if (existsSync(checkout)) {
    const built = await builtFrom(dist);
    if (built === undefined || !existsSync(join(dist, WASM))) {
      passedOver = `the sibling checkout ${checkout} holds no build`;
    } else {
      const { stdout } = await promisify(execFile)(process.execPath, [
        join(checkout, "package", "sources.mjs"),
      ]);
      if (stdout.trim() === built.sources) {
        log?.(
          `${PACKAGE}: the sibling checkout's build in ${dist}, of ${short(built.commit)}${built.dirty ? " with uncommitted changes" : ""}`,
        );
        return { source: "sibling", folder: dist, ...built };
      }
      passedOver = `the build in ${dist} is stale: it was made from other sources than the checkout holds`;
    }
  }
  const folder = fileURLToPath(new URL(".", import.meta.resolve(PACKAGE)));
  const pinned = await builtFrom(folder);
  if (pinned === undefined)
    throw new Error(`${folder} records no commit it was built from`);
  log?.(
    `${PACKAGE}: the pin, ${short(pinned.commit)}${passedOver === undefined ? "" : `; ${passedOver}`}`,
  );
  return { source: "pin", folder, ...pinned };
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

export interface PinnedAdapterOptions {
  readonly siblingsIn: string;
  readonly folders?: ReadonlyMap<string, string>;
  readonly cache: string;
  readonly log?: (line: string) => void;
}

export interface PinnedAdapter extends Loaded {
  readonly resolved: Resolved;
}

/**
 * Each adapter of cascade-runtime.json, resolved as the vocabulary is and loaded with every file of its folder, with
 * the vocabulary at the commit it pins. The run says which version of each it used.
 */
export async function loadPinnedAdapters(
  bridge: Bridge,
  adapters: readonly Pin[],
  options: PinnedAdapterOptions,
): Promise<PinnedAdapter[]> {
  const loaded: PinnedAdapter[] = [];
  for (const pin of adapters) {
    const resolved = await resolve(pin, options);
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
            `${repositoryName(pin)} names vocabulary files but pins no vocabulary`,
          );
        const vocabulary = await resolve(commitPin(vocabularyPin), {
          ...options,
          log: (line) =>
            options.log?.(
              `the vocabulary ${repositoryName(pin)} pins, ${line}`,
            ),
        });
        return {
          iri: vocabulary.iri,
          files: new FolderFiles(vocabulary.folder, vocabulary.iri),
        };
      },
    );
    loaded.push({ ...adapter, resolved });
  }
  return loaded;
}
