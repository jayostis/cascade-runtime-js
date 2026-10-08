import { fileEntry, fileExport } from "./arrivals.js";
import type { AdaptersOf } from "./bridge.js";
import type { Derive } from "./build.js";
import { addLayout, built, podFiles, podStated } from "./dataset.js";
import { type Files, MemoryFiles, relative, under, writeAll } from "./files.js";
import { fileCreation, fileJudgment, fileReference } from "./filings.js";
import type { IdsAndTime } from "./ids.js";
import type { ExportDocument, Importer } from "./importer.js";
import type { Layout } from "./layout.js";
import { matcherView, runMatcher } from "./matcher.js";
import { documentName } from "./names.js";
import { same, StepWrites } from "./pod.js";
import { ntriples } from "./rdf.js";
import type { References } from "./references.js";
import { Shapes } from "./shapes.js";
import {
  type OnProgress,
  Refusal,
  type StepContext,
  type StepFile,
} from "./step.js";
import { type Rows, type StoreFactory, Union } from "./store.js";

const OPENED = "opened";
const DATASET = "dataset:";
const MATCHER_VIEW = "matcher view";
const REVISION = "revision";

export interface CorePodOptions {
  /** The pod's files, named by its address. */
  readonly pod: Files;
  readonly address: string;
  readonly subject: string;
  /** What the pod's manifest takes as its title. */
  readonly title: string;
  /** The vocabulary, whose queries the matcher and the build run. */
  readonly vocabulary: Files;
  readonly layout: Layout;
  readonly newStore: StoreFactory;
  readonly time: IdsAndTime;
  /** The importers `cascade-runtime.json` names, in its order. */
  readonly importers: readonly Importer[];
  /** The matcher's tables, read when a step first needs them. */
  readonly references: () => Promise<References>;
  /** When given, the files the build writes are rebuilt under the lens after every step and written to the pod. */
  readonly build?: { readonly lens: string; readonly derive: Derive };
}

/** What a step did. */
export interface Performed {
  /** The files new to the pod that it wrote, in the order it wrote them. */
  readonly wrote: readonly string[];
  /** Why the rules refused it; it then wrote nothing. */
  readonly refused?: string;
  /** The import or entry session it made. */
  readonly activity?: string;
}

/** The build after a step failed: the step itself is in the pod, as `performed` says. */
export class BuildFailure extends Error {
  override readonly name = "BuildFailure";

  constructor(
    readonly performed: Performed,
    cause: unknown,
  ) {
    super(
      `the build after the step failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

/**
 * The pod's files as listed once, each read from the pod once and then held, which holds while the pod is written
 * only through them: a write goes through to the pod, but not one giving a file the bytes it already holds. A file
 * not held is looked for in the pod, so a step never writes over one that reached the pod another way; it is held,
 * but not listed.
 */
class HeldFiles implements Files {
  readonly #pod: Files;
  readonly #bytes = new Map<string, Uint8Array>();
  #paths: Promise<Set<string>> | undefined;

  constructor(pod: Files) {
    this.#pod = pod;
  }

  get iri(): string {
    return this.#pod.iri;
  }

  #listed(): Promise<Set<string>> {
    if (this.#paths === undefined) {
      const listing = this.#pod.list("").then((paths) => new Set(paths));
      this.#paths = listing;
      listing.catch(() => {
        if (this.#paths === listing) this.#paths = undefined;
      });
    }
    return this.#paths;
  }

  async #held(path: string): Promise<Uint8Array | undefined> {
    const held = this.#bytes.get(path);
    if (held !== undefined) return held;
    const bytes = await this.#pod.read(path);
    if (bytes === undefined) return undefined;
    this.#bytes.set(path, bytes);
    return bytes;
  }

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const bytes = await this.#held(relative(this, pathOrIri));
    return bytes === undefined ? undefined : new Uint8Array(bytes);
  }

  write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    return this.writeAll([[pathOrIri, bytes]]);
  }

  /**
   * Writes, in one `writeAll` on the pod, each file it does not hold with the same bytes; held once all are written.
   * When the write fails, what is held is dropped and read from the pod again, which may hold some of them.
   */
  async writeAll(
    files: Iterable<readonly [string, Uint8Array]>,
  ): Promise<void> {
    const changed: [string, Uint8Array][] = [];
    for (const [pathOrIri, bytes] of files) {
      const path = relative(this, pathOrIri);
      const held = await this.#held(path);
      if (held === undefined || !same(held, bytes))
        changed.push([path, new Uint8Array(bytes)]);
    }
    if (changed.length === 0) return;
    const listed = await this.#listed();
    try {
      await writeAll(this.#pod, changed);
    } catch (error) {
      this.#paths = undefined;
      this.#bytes.clear();
      throw error;
    }
    for (const [path, bytes] of changed) {
      this.#bytes.set(path, bytes);
      listed.add(path);
    }
  }

  async list(folder: string): Promise<string[]> {
    const prefix = relative(this, folder);
    return [...(await this.#listed())]
      .filter((path) => under(prefix, path))
      .sort();
  }
}

/** The hash of the pod's address, the files it holds but those the build writes, and its manifest's bytes; nothing is parsed. */
export async function podRevision(
  pod: Files,
  layout: Layout,
  address: string,
): Promise<string> {
  const rebuilt = new Set(layout.rebuilt);
  const listing = new TextEncoder().encode(
    JSON.stringify([
      address,
      (await pod.list("")).filter((path) => !rebuilt.has(path)).sort(),
    ]),
  );
  const manifest = (await pod.read(layout.manifest)) ?? new Uint8Array();
  const bytes = new Uint8Array(listing.length + manifest.length);
  bytes.set(listing);
  bytes.set(manifest, listing.length);
  return documentName(bytes);
}

/** A copy of the pod's files, in memory. */
async function copied(pod: Files): Promise<Files> {
  const copy = new MemoryFiles(pod.iri);
  for (const path of await pod.list("")) {
    const bytes = await pod.read(path);
    if (bytes !== undefined) await copy.write(path, bytes);
  }
  return copy;
}

/**
 * A pod over the four interfaces, performing each step of the rules with its inputs: a step writes all it writes or,
 * refused, nothing, and with a build the views and the other files the build writes are rebuilt after it.
 */
export class CorePod {
  readonly #options: CorePodOptions;
  #references: Promise<References> | undefined;
  #readShapes: Promise<Shapes> | undefined;
  /** What is built of the pod as it stands, by what it is; a step drops it all. */
  #kept = new Map<string, Promise<unknown>>();

  /** `opened`, when given, holds the pod's files as `podFiles` loads them, and becomes the dataset of the lens first asked. */
  constructor(options: CorePodOptions, opened?: Union) {
    this.#options = { ...options, pod: new HeldFiles(options.pod) };
    if (opened !== undefined) this.#kept.set(OPENED, Promise.resolve(opened));
  }

  get files(): Files {
    return this.#options.pod;
  }

  /**
   * The pod as an ask reads it under the lens: its files but those the build writes, the files the build writes, the
   * lens's derived state and the layout, each a graph of a store of its own.
   */
  dataset(lens: string): Promise<Union> {
    return this.#held(`${DATASET}${lens}`, async () => {
      const { pod, layout, address, title, newStore, time, build } =
        this.#options;
      const opened = this.#kept.get(OPENED) as Promise<Union> | undefined;
      this.#kept.delete(OPENED);
      const union = (await opened) ?? new Union(newStore());
      if (opened === undefined) await podFiles(pod, layout, address, union);
      if (build === undefined) {
        for (const path of layout.rebuilt.filter((path) =>
          layout.isRdf(path),
        )) {
          const bytes = await pod.read(path);
          if (bytes !== undefined)
            await union.loadTurtle(bytes, address + path);
        }
      } else {
        const at = (await podStated(pod, layout, union.store)).at ?? time.now();
        await build.derive(union, lens, { address, at, title });
      }
      await addLayout(union, layout, address);
      return union;
    });
  }

  /**
   * The pod's revision, as `podRevision` names it. Any step that writes changes it, and so does a refused one, whose
   * build writes the manifest again.
   */
  revision(): Promise<string> {
    return this.#held(REVISION, () => {
      const { pod, layout, address } = this.#options;
      return podRevision(pod, layout, address);
    });
  }

  /** Drops what is kept; the pod builds again when next read. */
  close(): void {
    this.#kept = new Map();
  }

  /** The pod's creation (A13). */
  create(): Promise<Performed> {
    return this.#step(fileCreation);
  }

  /**
   * An export's or a download's arrival: its documents, as the first importer that reads the path finds them, each
   * converted by the first adapter of its media type that accepts it (A1 to A11, A14). The adapters are asked for only
   * once an importer reads the path. `onProgress` is told as loading the adapter, each conversion and saving begin.
   */
  import(
    exported: Pick<Files, "read" | "list">,
    folder: string,
    adapters: () => Promise<AdaptersOf>,
    onProgress?: OnProgress,
  ): Promise<Performed> {
    const { importers } = this.#options;
    return this.#step(async (context) => {
      let documents: readonly ExportDocument[] | undefined;
      for (const importer of importers) {
        try {
          documents = await importer.documents(exported, folder);
        } catch (error) {
          throw new Refusal(
            `${folder}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (documents !== undefined) break;
      }
      if (documents === undefined)
        throw new Refusal(
          `no importer of ${importers.map((importer) => importer.name).join(", ") || "none"} reads ${folder}`,
        );
      await onProgress?.({ part: "loading the adapter" });
      const activity = await fileExport(
        context,
        documents,
        await adapters(),
        onProgress,
      );
      await onProgress?.({ part: "saving" });
      return activity;
    });
  }

  /** An entry (A12), refused where its statements break the vocabulary's shapes. */
  enter(entry: StepFile): Promise<Performed> {
    return this.#step(async (context) =>
      fileEntry(context, entry, await this.#shapes()),
    );
  }

  /** A person's judgment, filed as it is (N10). */
  judge(judgment: StepFile): Promise<Performed> {
    return this.#step((context) => fileJudgment(context, judgment));
  }

  /** A step refused before the pod is given its inputs: it writes nothing, and the build is rebuilt as after any step. */
  refuse(why: string): Promise<Performed> {
    return this.#step(() => Promise.reject(new Refusal(why)));
  }

  /** A reference version's arrival. */
  reference(version: string): Promise<Performed> {
    return this.#step(async (context) =>
      fileReference(context, await this.#tables(), version),
    );
  }

  /** A matcher run taking the import or entry session given, or, given none, a recheck (M7). */
  match(activity?: string): Promise<Performed> {
    return this.#step(async (context) =>
      runMatcher(context, await this.#tables(), activity),
    );
  }

  /** The query's rows over the pod as the matcher reads it: its RDF files but those the build writes, and the everyday lens's derived state. */
  async select(query: string): Promise<Rows> {
    return (await this.#matcherView()).select(query);
  }

  #matcherView(): Promise<Union> {
    return this.#held(MATCHER_VIEW, () => matcherView(this.#options));
  }

  /** What is kept under the key, or what `make` builds, kept until a step unless it fails. */
  #held<T>(key: string, make: () => Promise<T>): Promise<T> {
    const kept = this.#kept;
    const found = kept.get(key) as Promise<T> | undefined;
    if (found !== undefined) return found;
    const making = make();
    kept.set(key, making);
    making.catch(() => {
      if (kept.get(key) === making) kept.delete(key);
    });
    return making;
  }

  /** A pod that stands where this one does, over a copy of its files, with its own time. */
  async fork(time: IdsAndTime): Promise<CorePod> {
    const fork = new CorePod({
      ...this.#options,
      pod: await copied(this.#options.pod),
      time,
    });
    fork.#references = this.#references;
    if (this.#readShapes !== undefined) fork.#holdShapes(this.#readShapes);
    return fork;
  }

  #tables(): Promise<References> {
    this.#references ??= this.#options.references();
    return this.#references;
  }

  #shapes(): Promise<Shapes> {
    return (
      this.#readShapes ??
      this.#holdShapes(
        Shapes.read(this.#options.vocabulary, this.#options.newStore),
      )
    );
  }

  /** Holds a read of the shapes until it fails, so a failed read is tried again. */
  #holdShapes(reading: Promise<Shapes>): Promise<Shapes> {
    this.#readShapes = reading;
    reading.catch(() => {
      if (this.#readShapes === reading) this.#readShapes = undefined;
    });
    return reading;
  }

  async #step(
    perform: (context: StepContext) => Promise<string | void>,
  ): Promise<Performed> {
    const options = this.#options;
    const at = options.build === undefined ? undefined : options.time.now();
    const writes = new StepWrites();
    let performed: Performed;
    try {
      const activity = await perform({
        address: options.address,
        subject: options.subject,
        pod: options.pod,
        time: options.time,
        writes,
        newStore: options.newStore,
        layout: options.layout,
        vocabulary: options.vocabulary,
        matcherView: () => this.#matcherView(),
      });
      const wrote = await writes.commit(options.pod);
      performed =
        typeof activity === "string" ? { wrote, activity } : { wrote };
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      performed = { wrote: [], refused: error.message };
    } finally {
      this.#kept = new Map();
    }
    if (options.build !== undefined) {
      try {
        await this.#rebuild(options.build, at);
      } catch (error) {
        throw new BuildFailure(performed, error);
      }
    }
    return performed;
  }

  async #rebuild(
    build: NonNullable<CorePodOptions["build"]>,
    at: string | undefined,
  ): Promise<void> {
    const { pod, layout, address, title, newStore } = this.#options;
    const rebuilt = new Set(layout.rebuilt);
    const files = (await pod.list("")).filter((path) => !rebuilt.has(path));
    const union = new Union(newStore());
    const made = await built(
      pod,
      layout,
      address,
      files,
      at,
      title,
      build.lens,
      union,
      build.derive,
    );
    await writeAll(
      pod,
      [...made].map(([path, triples]) => [path, ntriples(triples)] as const),
    );
    await addLayout(union, layout, address);
    this.#kept.set(DATASET + build.lens, Promise.resolve(union));
  }
}
