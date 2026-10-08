import * as oxigraphWeb from "oxigraph/web.js";
import {
  BRIDGE_GLUE,
  BRIDGE_WASM,
  type CompiledBridge,
  type Followed,
  importersNamed,
  Layout,
  LAYOUT_FILE,
  loadAdapters,
  OxigraphStore,
  parseConfig,
  type Placed,
  readText,
  References,
  repositoryName,
  type RuntimeConfig,
  type Source,
  treeIri,
  type VocabularyBuild,
  vocabularyBuild,
  WasmBridge,
} from "@cascade-runtime/runtime";
import {
  compiledBridge,
  FetchedFiles,
  IndexedDbFiles,
  inWebWorker,
} from "@cascade-runtime/runtime/web";
import { ANSWERS, Answers, DESCRIBED, entryVersion } from "../answers.js";
import {
  bridgeLoaded,
  type Done,
  type Exported,
  type ExportSource,
  type Imported,
  type ImportOptions,
  type KeptPod,
  keptPod,
  openPodWith,
  type Parts,
  type Pod,
  type Row,
  TABLES,
} from "../pod.js";

export type {
  Done,
  Exported,
  ExportSource,
  Imported,
  ImportOptions,
  ImportProgress,
  Pod,
  Row,
} from "../pod.js";
export * from "../connect/index.js";
export { finishSignIn, popupSignIn, type PopupOptions } from "./sign-in.js";

/** What names a pod's IndexedDB database, before the pod's name. */
const DATABASE = "cascade-pod:";
/** What names the IndexedDB database a pod's answers are kept in, before the pod's name. */
const ANSWERS_DATABASE = "cascade-answers:";
const COMPONENTS = new URL("../../components/", import.meta.url);

interface Packed {
  readonly components: readonly {
    readonly repository: string;
    readonly commit: string;
  }[];
  /** None in a `packed.json` packed before the layout travelled in it. */
  readonly layout?: readonly Placed[];
}

async function fetched(path: string): Promise<Response> {
  const url = new URL(path, COMPONENTS);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.href} answered ${response.status}`);
  return response;
}

/** The promise `make` gives, made at the first call and kept; one that fails is made again at the next call. */
function once<T>(make: () => Promise<T>): () => Promise<T> {
  let made: Promise<T> | undefined;
  return () => {
    if (made === undefined) {
      const making = make();
      made = making;
      making.catch(() => {
        if (made === making) made = undefined;
      });
    }
    return made;
  };
}

/** What a pod's kept answers are read with, no engine: the components, the vocabulary, its layout and build, and the runtime's version. */
interface Read {
  readonly config: RuntimeConfig;
  readonly runtime: string;
  readonly vocabulary: FetchedFiles;
  readonly layout: Layout;
  readonly build: VocabularyBuild;
  /** A component the package carries, read by URL and named by its tree, as Node names it; one per repository. */
  carried(followed: Followed): Source;
}

const reading = once(async (): Promise<Read> => {
  const [config, packed, entry] = await Promise.all([
    fetched("cascade-runtime.json").then(async (r) =>
      parseConfig(await r.text()),
    ),
    fetched("packed.json").then((r) => r.json() as Promise<Packed>),
    fetched(import.meta.url).then(
      async (r) => new Uint8Array(await r.arrayBuffer()),
    ),
  ]);
  const sources = new Map<string, Source>();
  const carried = (followed: Followed): Source => {
    const known = sources.get(followed.repository);
    if (known !== undefined) return known;
    const commit = packed.components.find(
      ({ repository }) => repository === followed.repository,
    )?.commit;
    if (commit === undefined)
      throw new Error(
        `the package carries no ${repositoryName(followed)} (${followed.repository})`,
      );
    const iri = treeIri(followed, commit);
    const source = {
      iri,
      files: new FetchedFiles(
        new URL(`${repositoryName(followed)}/${commit}/`, COMPONENTS).href,
        iri,
        {
          pack: new URL(
            `${repositoryName(followed)}/${commit}.json`,
            COMPONENTS,
          ).href,
        },
      ),
    };
    sources.set(followed.repository, source);
    return source;
  };
  if (packed.layout === undefined)
    throw new Error(
      `${new URL("packed.json", COMPONENTS).href} records no layout: it was packed before this runtime, so pack it again`,
    );
  const vocabulary = carried(config.vocabulary).files as FetchedFiles;
  const layout = Layout.of(
    await readText(vocabulary, LAYOUT_FILE),
    packed.layout,
  );
  return {
    config,
    runtime: await entryVersion(entry, packed.components),
    vocabulary,
    layout,
    build: await vocabularyBuild(vocabulary, layout),
    carried,
  };
});

/** The parts, and the runtime's version: everything a pod reads with, and the engine. */
type Resolved = Parts & { readonly runtime: string };

const resolved = once(async (): Promise<Resolved> => {
  const [read] = await Promise.all([
    reading(),
    (oxigraphWeb as unknown as { default(): Promise<unknown> }).default(),
  ]);
  const { config, vocabulary, carried } = read;
  const newStore = () => new OxigraphStore();
  return {
    vocabulary,
    layout: read.layout,
    build: read.build,
    lens: config.lens,
    importers: importersNamed(config.importers),
    references: await References.of(vocabulary, TABLES, newStore),
    newStore,
    folder: () => {
      throw new Error("the browser build of cascade-runtime opens no folder");
    },
    runtime: read.runtime,
    exportAt: (path) =>
      `the browser build of cascade-runtime reads no path, such as ${path}: hand look and import the files the person picked, each by its path`,
    loadBridge: async () =>
      bridgeLoaded(
        new WasmBridge(inWebWorker(await bridgeCompiled())),
        (bridge) =>
          loadAdapters(bridge, config.adapters, async (followed) =>
            carried(followed),
          ),
      ),
  };
});

/** The Bridge's module beside the browser entry, compiled once per page. */
const bridgeCompiled = once((): Promise<CompiledBridge> =>
  compiledBridge(
    new URL(BRIDGE_GLUE, import.meta.url).href,
    new URL(BRIDGE_WASM, import.meta.url).href,
  ),
);

/**
 * Loads the engine and what needs it, and compiles the Bridge, once per page, so that they are ready when a pod first
 * computes: a question whose answer is not kept, an import, an entry. A pod's kept answers are read without them.
 */
export async function warm(): Promise<void> {
  await Promise.all([resolved(), bridgeCompiled()]);
}

/**
 * A frame for the page to paint in, or no wait where nothing is seen: a worker, or a hidden page, whose frames wait
 * until it is shown. A page hidden during the wait ends it by a timer.
 */
function painted(): Promise<void> {
  if (globalThis.document?.visibilityState !== "visible")
    return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
    setTimeout(resolve, 100);
  });
}

/**
 * A pod held in a browser, closing its databases when it is closed. Until it computes, it answers a question by name
 * from its kept answers; anything else opens it with the engine, once, and is handed to it from then on.
 */
class BrowserPod implements Pod {
  readonly #kept: KeptPod | undefined;
  readonly #open: () => Promise<Pod>;
  readonly #databases: readonly IndexedDbFiles[];
  #opened: Pod | undefined;
  #opening: Promise<Pod> | undefined;
  #closed = false;

  constructor(
    open: Pod | (() => Promise<Pod>),
    databases: readonly IndexedDbFiles[],
    kept?: KeptPod,
  ) {
    if (typeof open === "function") this.#open = once(open);
    else {
      this.#opened = open;
      this.#open = () => Promise.resolve(open);
    }
    this.#databases = databases;
    this.#kept = kept;
  }

  /** The pod, opened with the engine; one closed while it opened is closed by `close`. */
  async #pod(): Promise<Pod> {
    if (!this.#closed && this.#opened === undefined) {
      this.#opening = this.#open();
      const opened = await this.#opening;
      if (!this.#closed) this.#opened = opened;
    }
    if (this.#closed || this.#opened === undefined)
      throw new Error(`the pod at ${this.address} is closed`);
    return this.#opened;
  }

  #known(): Pod | KeptPod {
    const known = this.#opened ?? this.#kept;
    if (known === undefined)
      throw new Error("the pod is neither open nor kept");
    return known;
  }

  get address(): string {
    return this.#known().address;
  }

  get subject(): string {
    return this.#known().subject;
  }

  get owner(): string {
    return this.#known().owner;
  }

  async look(exported: string | Exported): Promise<readonly ExportSource[]> {
    return (await this.#pod()).look(exported);
  }

  /** Waits, after each `onProgress`, for a frame the page paints what it was told in. */
  async import(
    exported: string | Exported,
    options: ImportOptions = {},
  ): Promise<Imported> {
    const { onProgress } = options;
    return (await this.#pod()).import(
      exported,
      onProgress === undefined
        ? options
        : {
            ...options,
            onProgress: async (progress) => {
              await onProgress(progress);
              await painted();
            },
          },
    );
  }

  async enter(turtle: string, options?: { match?: boolean }): Promise<Done> {
    return (await this.#pod()).enter(turtle, options);
  }

  async judge(turtle: string): Promise<Done> {
    return (await this.#pod()).judge(turtle);
  }

  async match(activity?: string): Promise<Done> {
    return (await this.#pod()).match(activity);
  }

  async ask(
    question: string | { query: string },
    options: { lens?: string } = {},
  ): Promise<Row[]> {
    if (this.#closed) throw new Error(`the pod at ${this.address} is closed`);
    if (this.#opened === undefined && typeof question === "string") {
      const rows = await this.#kept?.rows(question, options.lens);
      if (rows !== undefined) return rows;
    }
    return (await this.#pod()).ask(question, options);
  }

  async close(): Promise<void> {
    this.#closed = true;
    try {
      const opened =
        this.#opened ?? (await this.#opening?.catch(() => undefined));
      await opened?.close();
    } finally {
      for (const database of this.#databases) database.close();
    }
  }
}

/** The pack published beside the folder at the URL, named after it: `<folder>.pack.json`. */
function packBeside(folder: URL): string {
  const name = folder.pathname.split("/").at(-2) ?? "";
  return new URL(`../${name}.pack.json`, folder).href;
}

/**
 * Copies every file the folder at the URL lists into the database, all or none: from its pack when one is published
 * beside it and reads as one, otherwise file by file as its `files.json` lists them.
 */
async function copied(folder: URL, database: IndexedDbFiles): Promise<void> {
  let published = new FetchedFiles(folder.href, folder.href, {
    pack: packBeside(folder),
  });
  const paths = await published.list("").catch(() => {
    published = new FetchedFiles(folder.href);
    return published.list("");
  });
  const files = await Promise.all(
    paths.map(async (path) => {
      const bytes = await published.read(path);
      if (bytes === undefined)
        throw new Error(`${folder.href} lists ${path} but does not serve it`);
      return [path, bytes] as const;
    }),
  );
  await database.writeAll(files);
}

/** The answers published beside the folder at the URL, `answers.json` and `pod.json`, those there are; a cache, so none on failure. */
async function answersBeside(
  folder: URL,
): Promise<(readonly [string, Uint8Array])[]> {
  const found = await Promise.all(
    [ANSWERS, DESCRIBED].map(async (path) => {
      try {
        const response = await fetch(new URL(`../${path}`, folder));
        return response.ok
          ? [[path, new Uint8Array(await response.arrayBuffer())] as const]
          : [];
      } catch {
        return [];
      }
    }),
  );
  return found.flat();
}

/**
 * Deletes the database a copy failed into, or throws one error saying it is left, with the copy's error as its cause;
 * a connection elsewhere holding it open is a failure, not a wait.
 */
function deleted(name: string, copying: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const left = (why: string) =>
      reject(
        new Error(
          `${(copying as Error)?.message ?? copying}, and the empty database ${name} is left: ${why}`,
          { cause: copying },
        ),
      );
    const deleting = indexedDB.deleteDatabase(name);
    deleting.onsuccess = () => resolve();
    deleting.onerror = () =>
      left(deleting.error?.message ?? "it could not be deleted");
    deleting.onblocked = () =>
      left("it is open elsewhere, and is deleted once that closes");
  });
}

/**
 * The pod in the browser's IndexedDB database `cascade-pod:<name>`, or, with no name, in memory; `options.title` is
 * used only when the pod is new. A missing or empty database is a new pod, or, with `options.from`, a copy of the pod
 * published in the folder at that URL, from its pack `<folder>.pack.json` when one is published beside it, else as its
 * `files.json` lists it, with the answers published beside it in place of any kept before. A copy that fails leaves no database, unless another
 * copy filled it meanwhile, which it keeps. Its answers are kept in a database of their own, `cascade-answers:<name>`,
 * with its address, subject and title in `pod.json`. A pod whose `pod.json` is kept opens without the engine, and
 * answers a question by name from its kept answers until it first computes.
 */
export async function openPod(
  name?: string,
  options: { title?: string; from?: string } = {},
): Promise<Pod> {
  const { from, ...rest } = options;
  if (name === undefined)
    return new BrowserPod(
      await openPodWith(await resolved(), undefined, rest),
      [],
    );
  const read = await reading();
  const named = DATABASE + name;
  const database = await IndexedDbFiles.open(named, `${named}/`);
  let answers: IndexedDbFiles | undefined;
  let copying = false;
  try {
    let held = await database.list("");
    let published: Promise<(readonly [string, Uint8Array])[]> | undefined;
    if (from !== undefined && held.length === 0) {
      const folder = new URL(from, globalThis.location.href);
      published = answersBeside(folder);
      copying = true;
      await IndexedDbFiles.delete(ANSWERS_DATABASE + name);
      await copied(folder, database);
      copying = false;
      held = await database.list("");
    }
    const kept = await IndexedDbFiles.open(
      ANSWERS_DATABASE + name,
      `${ANSWERS_DATABASE}${name}/`,
    );
    answers = kept;
    const carried = (await published) ?? [];
    if (carried.length > 0) await kept.writeAll(carried).catch(() => undefined);
    const open = async () =>
      openPodWith(
        {
          ...(await resolved()),
          folder: (_path, iri) => ({
            files: iri === undefined ? database : database.at(iri),
            name,
          }),
          answers: { runtime: read.runtime, at: () => kept },
        },
        name,
        rest,
      );
    const databases = [database, kept];
    const pod =
      held.length === 0
        ? undefined
        : await keptPod(
            { ...read, lens: read.config.lens },
            database,
            new Answers(kept, read.runtime),
          );
    return pod === undefined
      ? new BrowserPod(await open(), databases)
      : new BrowserPod(open, databases, pod);
  } catch (error) {
    const empty =
      copying &&
      (await database.list("").then(
        (paths) => paths.length === 0,
        () => false,
      ));
    database.close();
    answers?.close();
    if (empty) await deleted(named, error);
    throw error;
  }
}

/** Deletes the pod in the browser's database `cascade-pod:<name>` and its answers, once every connection to them is closed. */
export async function deletePod(name: string): Promise<void> {
  await Promise.all(
    [DATABASE, ANSWERS_DATABASE].map((prefix) =>
      IndexedDbFiles.delete(prefix + name),
    ),
  );
}
