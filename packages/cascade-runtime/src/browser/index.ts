import * as oxigraphWeb from "oxigraph/web.js";
import {
  BRIDGE_GLUE,
  BRIDGE_WASM,
  type CompiledBridge,
  documentName,
  type Followed,
  importersNamed,
  Layout,
  loadAdapters,
  OxigraphStore,
  parseConfig,
  References,
  repositoryName,
  type Source,
  treeIri,
  vocabularyBuild,
  WasmBridge,
} from "@cascade-runtime/runtime";
import {
  compiledBridge,
  FetchedFiles,
  IndexedDbFiles,
  inWebWorker,
} from "@cascade-runtime/runtime/web";
import {
  bridgeLoaded,
  type Done,
  type Exported,
  type ExportSource,
  type Imported,
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
  Pod,
  Row,
} from "../pod.js";
export * from "../connect/index.js";
export { finishSignIn, popupSignIn, type PopupOptions } from "./sign-in.js";

/** What names a pod's IndexedDB database, before the pod's name. */
const DATABASE = "cascade-pod:";
/** What names the IndexedDB database a pod's answers are kept in, before the pod's name. */
const ANSWERS = "cascade-answers:";
const COMPONENTS = new URL("../../components/", import.meta.url);

interface Packed {
  readonly components: readonly {
    readonly repository: string;
    readonly commit: string;
  }[];
}

async function fetched(path: string): Promise<Response> {
  const url = new URL(path, COMPONENTS);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.href} answered ${response.status}`);
  return response;
}

async function resolve(): Promise<Parts> {
  await (oxigraphWeb as unknown as { default(): Promise<unknown> }).default();
  const [config, packed, runtime] = await Promise.all([
    fetched("cascade-runtime.json").then(async (r) =>
      parseConfig(await r.text()),
    ),
    fetched("packed.json").then((r) => r.json() as Promise<Packed>),
    fetched(import.meta.url).then(async (r) =>
      documentName(new Uint8Array(await r.arrayBuffer())),
    ),
  ]);
  const sources = new Map<string, Source>();
  /** A component the package carries, read by URL and named by its tree, as Node names it; one per repository. */
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
  const vocabulary = carried(config.vocabulary).files;
  const newStore = () => new OxigraphStore();
  const layout = await Layout.read(vocabulary, newStore);
  return {
    vocabulary,
    layout,
    build: await vocabularyBuild(vocabulary, layout),
    lens: config.lens,
    importers: importersNamed(config.importers),
    references: await References.of(vocabulary, TABLES, newStore),
    newStore,
    folder: () => {
      throw new Error("the browser build of cascade-runtime opens no folder");
    },
    answers: {
      runtime,
      at: () => {
        throw new Error("the browser build of cascade-runtime opens no folder");
      },
    },
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
}

let compiled: Promise<CompiledBridge> | undefined;

/** The Bridge's module beside the browser entry, compiled once per page. */
function bridgeCompiled(): Promise<CompiledBridge> {
  if (compiled === undefined) {
    const compiling = compiledBridge(
      new URL(BRIDGE_GLUE, import.meta.url).href,
      new URL(BRIDGE_WASM, import.meta.url).href,
    );
    compiled = compiling;
    compiling.catch(() => {
      if (compiled === compiling) compiled = undefined;
    });
  }
  return compiled;
}

let found: Promise<Parts> | undefined;

function resolved(): Promise<Parts> {
  if (found === undefined) {
    const resolving = resolve();
    found = resolving;
    resolving.catch(() => {
      if (found === resolving) found = undefined;
    });
  }
  return found;
}

/** A pod held in a browser, closing its databases when it is closed. */
class BrowserPod implements Pod {
  readonly #pod: Pod;
  readonly #databases: readonly IndexedDbFiles[];

  constructor(pod: Pod, databases: readonly IndexedDbFiles[]) {
    this.#pod = pod;
    this.#databases = databases;
  }

  get address(): string {
    return this.#pod.address;
  }

  get subject(): string {
    return this.#pod.subject;
  }

  get owner(): string {
    return this.#pod.owner;
  }

  look(exported: string | Exported): Promise<readonly ExportSource[]> {
    return this.#pod.look(exported);
  }

  import(
    exported: string | Exported,
    options?: { aboutSubject?: boolean; match?: boolean },
  ): Promise<Imported> {
    return this.#pod.import(exported, options);
  }

  enter(turtle: string, options?: { match?: boolean }): Promise<Done> {
    return this.#pod.enter(turtle, options);
  }

  judge(turtle: string): Promise<Done> {
    return this.#pod.judge(turtle);
  }

  match(activity?: string): Promise<Done> {
    return this.#pod.match(activity);
  }

  ask(
    question: string | { query: string },
    options?: { lens?: string },
  ): Promise<Row[]> {
    return this.#pod.ask(question, options);
  }

  async close(): Promise<void> {
    try {
      await this.#pod.close();
    } finally {
      for (const database of this.#databases) database.close();
    }
  }
}

/** Copies every file the folder at the URL lists into the database, all or none. */
async function copied(from: string, database: IndexedDbFiles): Promise<void> {
  const published = new FetchedFiles(
    new URL(from, globalThis.location.href).href,
  );
  const paths = await published.list("");
  const files = await Promise.all(
    paths.map(async (path) => {
      const bytes = await published.read(path);
      if (bytes === undefined)
        throw new Error(`${from} lists ${path} but does not serve it`);
      return [path, bytes] as const;
    }),
  );
  await database.writeAll(files);
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
 * published in the folder at that URL, as its `files.json` lists it. A copy that fails leaves no database, unless
 * another copy filled it meanwhile, which it keeps. Its answers are kept in a database of their own,
 * `cascade-answers:<name>`, with its address, subject and title in `pod.json`.
 */
export async function openPod(
  name?: string,
  options: { title?: string; from?: string } = {},
): Promise<Pod> {
  const parts = await resolved();
  const { from, ...rest } = options;
  if (name === undefined)
    return new BrowserPod(await openPodWith(parts, undefined, rest), []);
  const named = DATABASE + name;
  const database = await IndexedDbFiles.open(named, `${named}/`);
  let answers: IndexedDbFiles | undefined;
  let copying = false;
  try {
    if (from !== undefined && (await database.list("")).length === 0) {
      copying = true;
      await copied(from, database);
      copying = false;
    }
    const kept = await IndexedDbFiles.open(
      ANSWERS + name,
      `${ANSWERS}${name}/`,
    );
    answers = kept;
    const pod = await openPodWith(
      {
        ...parts,
        folder: (_path, iri) => ({
          files: iri === undefined ? database : database.at(iri),
          name,
          parent: database,
        }),
        ...(parts.answers === undefined
          ? {}
          : { answers: { runtime: parts.answers.runtime, at: () => kept } }),
      },
      name,
      rest,
    );
    return new BrowserPod(pod, [database, kept]);
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
    [DATABASE, ANSWERS].map((prefix) => IndexedDbFiles.delete(prefix + name)),
  );
}
