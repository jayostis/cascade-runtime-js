import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import type { Bridge, LoadedAdapter } from "../bridge.js";
import type { Followed } from "../config.js";
import { type Loaded, loadAdapters } from "../load-adapter.js";
import { counted } from "../probe.js";
import {
  BRIDGE_GLUE as GLUE,
  BRIDGE_WASM as WASM,
  type CompiledBridge,
  type Spawn,
  Waiting,
  WasmBridge,
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
  checkoutStamp,
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
  const identity = JSON.stringify([optionsKey(options), repository]);
  const key = JSON.stringify([
    identity,
    await localStamps(options, repository),
  ]);
  let found = foundPackages.get(key);
  if (found === undefined) {
    // One search under these options is kept: the one before it is let go.
    const before = foundKeys.get(identity);
    if (before !== undefined) foundPackages.delete(before);
    foundKeys.set(identity, key);
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

/** The state of each checkout a package is looked for in: its commit and index (see {@link checkoutStamp}) and its build. */
async function localStamps(
  options: ResolverOptions,
  repository: string,
): Promise<string[]> {
  const checkouts = [
    siblingIn(options.siblingsIn, PACKAGE),
    options.folders?.get(repository),
  ];
  return Promise.all(
    checkouts.map(async (checkout) =>
      checkout === undefined
        ? ""
        : `${await checkoutStamp(checkout)} ${await buildStamp(join(checkout, "package", "dist"))}`,
    ),
  );
}

/**
 * Found once per process for each set of options, as git and the sources of a checkout are read once; again when a
 * checkout's state, as {@link localStamps} reads it, has changed.
 */
const foundKeys = new Map<string, string>();
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
  repository: string = BRIDGE_REPOSITORY,
): Promise<BridgePackageFound> {
  const key = JSON.stringify([cache, repository]);
  let found = released.get(key);
  if (found === undefined) {
    const at = join(cache, PACKAGE);
    const pending = pickedBuild(repository, at).then((picked) =>
      releasedAt(repository, picked, at),
    );
    found = pending;
    released.set(key, pending);
    pending.catch(() => {
      if (released.get(key) === pending) released.delete(key);
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

async function stampOf(path: string): Promise<string> {
  const found = await stat(path).catch(() => undefined);
  return found === undefined ? "-" : `${found.size}:${found.mtimeMs}`;
}

/** The size and time of change of the files of a build: what changes when the Bridge is built again into the folder. */
async function buildStamp(folder: string): Promise<string> {
  return (
    await Promise.all([
      stampOf(join(folder, WASM)),
      stampOf(join(folder, GLUE)),
      stampOf(join(folder, "package.json")),
    ])
  ).join(" ");
}

const compiled = new Map<string, Promise<CompiledBridge>>();
const builtKeys = new Map<string, string>();

/** The package's module, compiled once per process for each folder and build of it. */
export async function compiledBridge(folder: string): Promise<CompiledBridge> {
  const key = `${folder} ${await buildStamp(folder)}`;
  let found = compiled.get(key);
  if (found === undefined) {
    // One build of a folder is kept: the one it was before is let go.
    const before = builtKeys.get(folder);
    if (before !== undefined) compiled.delete(before);
    builtKeys.set(folder, key);
    found = readFile(join(folder, WASM)).then(async (bytes) => ({
      glue: pathToFileURL(join(folder, GLUE)).href,
      module: await WebAssembly.compile(bytes),
    }));
    compiled.set(key, found);
    found.catch(() => {
      if (compiled.get(key) === found) compiled.delete(key);
    });
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
  /** Held by every pod of the process that opened it: its `free()` lets go of nothing, the process's own does. */
  readonly shared?: true;
}

/**
 * Each adapter of cascade-runtime.json, resolved as the vocabulary is and loaded with the files its description lists, with
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
    };
  });
  return loaded.map((each, index) => {
    const resolved = found.get(adapters[index] as Followed);
    if (resolved === undefined)
      throw new Error(`adapter ${index} was loaded but never resolved`);
    return { ...each, resolved };
  });
}

/** Each of the files, under the folder, with its size and time of change, as one digest. */
async function signature(
  folder: string,
  paths: readonly string[],
): Promise<string> {
  const lines = await Promise.all(
    paths.map(async (path) => {
      const found = await stat(join(folder, path)).catch(() => undefined);
      return `${path}:${found?.size}:${found?.mtimeMs}`;
    }),
  );
  return createHash("sha256").update(lines.sort().join("\n")).digest("hex");
}

/** The most instances of one adapter a process runs: a second starts only while the first is busy. */
const INSTANCES = 2;

interface Member {
  loaded: Promise<LoadedAdapter>;
  busy: number;
  /** Let go of: a call that finds it so starts another. */
  freed?: true;
  /** One of those the pool had when it was retired: let go of as its calls end. */
  ending?: true;
  idle?: NodeJS.Timeout;
}

/** How long a retired pool keeps an instance for the pods still holding it, once it has no call. */
const RETIRED_IDLE_MS = 5_000;

/**
 * One adapter in up to {@link INSTANCES} instances, each in a worker of its own, so that a document that takes long or
 * faults holds up or ends only the instance it is on. A call goes to an idle instance, else starts the second, else
 * waits on the one with fewer calls; an instance that fails to load is dropped and its calls go to another. A retired
 * pool (its adapter replaced) lets go of an instance idle at once and of the others as their calls end, but a pod still
 * holding the adapter is served by one instance, started once however many calls arrive, which stays for a few seconds
 * after its last call, so a retired adapter is not reloaded on every call.
 */
export class Pool {
  readonly #members: Member[] = [];
  #retired = false;
  readonly adapter: LoadedAdapter;

  constructor(
    first: LoadedAdapter,
    readonly more: () => Promise<LoadedAdapter>,
    readonly idleMs: number = RETIRED_IDLE_MS,
  ) {
    this.#members.push({ loaded: Promise.resolve(first), busy: 0 });
    this.adapter = {
      accepts: (document) => this.#run((on) => on.accepts(document)),
      convert: (document, options) =>
        this.#run((on) => on.convert(document, options)),
      free: () => Promise.resolve(),
    };
  }

  #pick(): Member {
    const idle = this.#members.find(({ busy }) => busy === 0);
    if (idle !== undefined) return idle;
    if (this.#members.length < (this.#retired ? 1 : INSTANCES)) {
      const member: Member = { busy: 0, loaded: this.more() };
      this.#members.push(member);
      return member;
    }
    return this.#members.reduce((one, other) =>
      other.busy < one.busy ? other : one,
    );
  }

  #drop(member: Member): void {
    const at = this.#members.indexOf(member);
    if (at >= 0) this.#members.splice(at, 1);
  }

  async #run<T>(call: (on: LoadedAdapter) => Promise<T>): Promise<T> {
    let member = this.#pick();
    for (;;) {
      clearTimeout(member.idle);
      member.busy += 1;
      let on: LoadedAdapter;
      try {
        on = await member.loaded;
      } catch (error) {
        member.busy -= 1;
        this.#drop(member);
        const [other] = this.#members;
        if (other === undefined) throw error;
        member = other;
        continue;
      }
      try {
        return await call(on);
      } finally {
        member.busy -= 1;
        if (this.#retired && member.busy === 0)
          if (member.ending) this.#let(member);
          else this.#later(member);
      }
    }
  }

  #later(member: Member): void {
    clearTimeout(member.idle);
    member.idle = setTimeout(() => {
      if (member.busy === 0) this.#let(member);
    }, this.idleMs);
    member.idle.unref();
  }

  #let(member: Member): void {
    clearTimeout(member.idle);
    if (member.freed) return;
    member.freed = true;
    this.#drop(member);
    void member.loaded.then((on) => on.free()).catch(() => undefined);
  }

  /** Lets go of every instance now idle at once, and of the others as their calls end; one a later call starts is kept a few seconds. */
  retire(): void {
    this.#retired = true;
    for (const member of [...this.#members]) {
      member.ending = true;
      if (member.busy === 0) this.#let(member);
    }
  }
}

interface Shared {
  readonly loaded: Loaded;
  /** The build of the Bridge it was loaded by. */
  readonly build: string;
  readonly iri: string;
  readonly pool: Pool;
  /** The files its description lists, and the signature of them as they were when it was loaded. */
  readonly signed: readonly string[];
  readonly signature: string;
  /** The vocabulary the adapter was given, resolved through the components of the pod that loaded it, as it was. */
  readonly vocabulary?: {
    readonly repository: string;
    readonly iri: string;
    readonly folder: string;
    readonly files: readonly string[];
    readonly signature: string;
  };
}

/**
 * One live entry for each adapter folder and vocabulary folder it reads, under one Bridge: a change of the adapter's
 * version, its files, the vocabulary's or the build of the Bridge replaces the entry, and retires the one it replaces.
 */
const shared = new Map<
  string,
  { loading: Promise<Shared>; folder: string; base: string }
>();

/** The entries kept live for one Bridge build and adapter folder, whichever vocabulary folders they read: the most recently used. */
export const LIVE_PER_BASE = 2;

/** Retires the least recently used entries of `base` beyond {@link LIVE_PER_BASE}: idle workers at once, busy ones after their calls. */
function keepRecent(base: string): void {
  const mine = [...shared].filter(([, entry]) => entry.base === base);
  for (const [slot, entry] of mine.slice(0, -LIVE_PER_BASE)) {
    shared.delete(slot);
    void entry.loading.then(
      ({ pool }) => pool.retire(),
      () => undefined,
    );
  }
}

/** How many entries are live for `base`, for the tests. */
export function liveSharedEntries(base?: string): number {
  return [...shared.values()].filter(
    (entry) => base === undefined || entry.base === base,
  ).length;
}

/** The repository of the vocabulary each adapter folder names, once it has been loaded and said: the key of its entries. */
const vocabularies = new Map<string, string>();

/** Ends the workers of every shared adapter, or of those loaded from `folder`; the next load starts them again. */
export async function endSharedAdapters(folder?: string): Promise<void> {
  for (const [slot, entry] of [...shared]) {
    if (folder !== undefined && entry.folder !== folder) continue;
    shared.delete(slot);
    await entry.loading.then(
      ({ pool }) => pool.retire(),
      () => undefined,
    );
  }
}

/**
 * {@link loadConfiguredAdapters}, with each adapter loaded once per process and shared by every later caller, as the
 * same folders of the same Bridge build give the same adapter: a pod that closes lets go of nothing, and the workers
 * holding them stay out of the way of the process ending. What the adapter was given is looked at again on every call,
 * as the caller's own components resolve it (the adapter's folder, and the vocabulary it names) and as it is on disk (by
 * each file's path, size and time of change, and the build of the Bridge); what differs loads again, and the adapter it
 * replaces is ended. A run says which version of each it used on every call.
 */
export async function loadSharedAdapters(
  bridgeFolder: string,
  bridge: WasmBridge,
  adapters: readonly Followed[],
  components: Components,
): Promise<ConfiguredAdapter[]> {
  const build = await buildStamp(bridgeFolder);
  const out: ConfiguredAdapter[] = [];
  for (const followed of adapters) {
    const resolved = await components.resolve(followed);
    const base = [bridgeFolder, resolved.folder].join(" ");
    const repository = vocabularies.get(base);
    const vocabulary =
      repository === undefined
        ? undefined
        : await components.resolve({ repository });
    const found = await sharedAt(
      base,
      `${base} ${vocabulary?.folder ?? ""}`,
      vocabulary,
      build,
      resolved,
      followed,
      bridge.spawn,
      components,
    );
    out.push({
      ...found.loaded,
      adapter: found.pool.adapter,
      resolved,
      shared: true,
    });
  }
  return out;
}

/** The live entry of the slot if it matches what this caller sees, otherwise a new one in its place. */
async function sharedAt(
  base: string,
  slot: string,
  vocabularyNow: Resolved | undefined,
  build: string,
  resolved: Resolved,
  followed: Followed,
  spawn: Spawn,
  components: Components,
): Promise<Shared> {
  for (;;) {
    const entry = shared.get(slot);
    if (entry !== undefined) {
      const found = await entry.loading.catch(() => undefined);
      const vocabulary =
        found?.vocabulary === undefined
          ? undefined
          : (vocabularyNow ??
            (await components.resolve({
              repository: found.vocabulary.repository,
            })));
      const same =
        found !== undefined &&
        found.build === build &&
        found.iri === resolved.iri &&
        found.signature === (await signature(resolved.folder, found.signed)) &&
        (found.vocabulary === undefined ||
          (vocabulary?.iri === found.vocabulary.iri &&
            vocabulary.folder === found.vocabulary.folder &&
            (await signature(vocabulary.folder, found.vocabulary.files)) ===
              found.vocabulary.signature));
      // Another caller may have replaced it while this one looked: this one looks at that one instead.
      if (shared.get(slot) !== entry) continue;
      if (same) {
        // Used now: it moves to the end of the entries, which are retired from the front.
        shared.delete(slot);
        shared.set(slot, entry);
        return found;
      }
      found?.pool.retire();
    }
    const loading = loadFirst(spawn, followed, resolved, components, build);
    const live = { loading, folder: resolved.folder, base };
    shared.set(slot, live);
    keepRecent(base);
    loading.then(
      (made) => {
        // Where the vocabulary was not known, it is now: the entry moves to the slot of its vocabulary's folder.
        const at = `${base} ${made.vocabulary?.folder ?? ""}`;
        if (made.vocabulary !== undefined)
          vocabularies.set(base, made.vocabulary.repository);
        if (at === slot || shared.get(slot) !== live) return;
        shared.delete(slot);
        void shared.get(at)?.loading.then(
          ({ pool }) => pool.retire(),
          () => undefined,
        );
        shared.delete(at);
        shared.set(at, live);
        keepRecent(base);
      },
      () => {
        if (shared.get(slot) === live) shared.delete(slot);
      },
    );
    return loading;
  }
}

/**
 * The adapter described and, when a call first needs it, loaded in an instance of its own. Each repository is resolved
 * once, into `known`, so another instance of the same adapter reads what the first did.
 */
async function loadOne(
  spawn: Spawn,
  followed: Followed,
  components: Components,
  known: Map<string, Resolved>,
): Promise<{ loaded: Loaded; vocabularyAt?: Resolved }> {
  let vocabularyAt: Resolved | undefined;
  const bridge = new WasmBridge(spawn);
  try {
    const [loaded] = await loadAdapters(bridge, [followed], async (each) => {
      let resolved = known.get(each.repository);
      if (resolved === undefined) {
        resolved = await components.resolve(each);
        known.set(each.repository, resolved);
      }
      if (each !== followed) vocabularyAt = resolved;
      return {
        iri: resolved.iri,
        files: new FolderFiles(resolved.folder, resolved.iri),
      };
    });
    if (loaded === undefined) throw new Error("no adapter was loaded");
    return { loaded, ...(vocabularyAt && { vocabularyAt }) };
  } finally {
    bridge.close();
  }
}

async function loadFirst(
  spawn: Spawn,
  followed: Followed,
  resolved: Resolved,
  components: Components,
  build: string,
): Promise<Shared> {
  const known = new Map([[followed.repository, resolved]]);
  const { loaded, vocabularyAt } = await loadOne(
    spawn,
    followed,
    components,
    known,
  );
  const signed = [
    ...new Set([...loaded.description.loadFiles, "ro-crate-metadata.json"]),
  ];
  const given = loaded.description.vocabulary?.files ?? [];
  const repository = loaded.description.vocabulary?.repository;
  return {
    loaded,
    build,
    iri: resolved.iri,
    // The files were signed before the adapter reads them, when its first call needs them: a file edited between the
    // two is read at its new content under the old signature, and the next call loads it again, which errs safe.
    signed,
    signature: await signature(resolved.folder, signed),
    pool: new Pool(
      loaded.adapter,
      async () =>
        (await loadOne(spawn, followed, components, known)).loaded.adapter,
    ),
    ...(vocabularyAt !== undefined &&
      repository !== undefined && {
        vocabulary: {
          repository,
          iri: vocabularyAt.iri,
          folder: vocabularyAt.folder,
          files: given,
          signature: await signature(vocabularyAt.folder, given),
        },
      }),
  };
}
