import * as oxigraphWeb from "oxigraph/web.js";
import {
  BRIDGE_GLUE,
  BRIDGE_WASM,
  type CompiledBridge,
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

/** What names a pod's IndexedDB database, before the pod's name. */
const DATABASE = "cascade-pod:";
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
  const [config, packed] = await Promise.all([
    fetched("cascade-runtime.json").then(async (r) =>
      parseConfig(await r.text()),
    ),
    fetched("packed.json").then((r) => r.json() as Promise<Packed>),
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

/** A pod held in a browser, closing its database when it is closed. */
class BrowserPod implements Pod {
  readonly #pod: Pod;
  readonly #database: IndexedDbFiles | undefined;

  constructor(pod: Pod, database: IndexedDbFiles | undefined) {
    this.#pod = pod;
    this.#database = database;
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
      this.#database?.close();
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
 * The pod in the browser's IndexedDB database `cascade-pod:<name>`, or, with no name, in memory; `options.title` is
 * used only when the pod is new. A missing or empty database is a new pod, or, with `options.from`, a copy of the pod
 * published in the folder at that URL, as its `files.json` lists it.
 */
export async function openPod(
  name?: string,
  options: { title?: string; from?: string } = {},
): Promise<Pod> {
  const parts = await resolved();
  const { from, ...rest } = options;
  if (name === undefined)
    return new BrowserPod(await openPodWith(parts, undefined, rest), undefined);
  const database = await IndexedDbFiles.open(
    DATABASE + name,
    `${DATABASE}${name}/`,
  );
  try {
    if (from !== undefined && (await database.list("")).length === 0)
      await copied(from, database);
    const pod = await openPodWith(
      {
        ...parts,
        folder: (_path, iri) => ({
          files: iri === undefined ? database : database.at(iri),
          name,
          parent: database,
        }),
      },
      name,
      rest,
    );
    return new BrowserPod(pod, database);
  } catch (error) {
    database.close();
    throw error;
  }
}
