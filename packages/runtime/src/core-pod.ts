import { fileEntry, fileExport } from "./arrivals.js";
import type { LoadedAdapter } from "./bridge.js";
import type { Derive } from "./build.js";
import { built } from "./dataset.js";
import { type Files, MemoryFiles, relative, under } from "./files.js";
import { fileCreation, fileJudgment, fileReference } from "./filings.js";
import type { IdsAndTime } from "./ids.js";
import type { ExportDocument, Importer } from "./importer.js";
import type { Layout } from "./layout.js";
import { matcherView, runMatcher } from "./matcher.js";
import { same, StepWrites } from "./pod.js";
import { ntriples } from "./rdf.js";
import type { References } from "./references.js";
import { Refusal, type StepContext, type StepFile } from "./step.js";
import type { Rows, StoreFactory } from "./store.js";

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
 * not held is looked for in the pod, so a step never writes over one that reached the pod another way.
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
    (await this.#listed()).add(path);
    return bytes;
  }

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const bytes = await this.#held(relative(this, pathOrIri));
    return bytes === undefined ? undefined : new Uint8Array(bytes);
  }

  async write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    const path = relative(this, pathOrIri);
    const held = await this.#held(path);
    if (held !== undefined && same(held, bytes)) return;
    await this.#pod.write(path, bytes);
    this.#bytes.set(path, new Uint8Array(bytes));
    (await this.#listed()).add(path);
  }

  async list(folder: string): Promise<string[]> {
    const prefix = relative(this, folder);
    return [...(await this.#listed())]
      .filter((path) => under(prefix, path))
      .sort();
  }
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

  constructor(options: CorePodOptions) {
    this.#options = { ...options, pod: new HeldFiles(options.pod) };
  }

  get files(): Files {
    return this.#options.pod;
  }

  /** The pod's creation (A13). */
  create(): Promise<Performed> {
    return this.#step(fileCreation);
  }

  /**
   * An export's arrival: its documents, as the first importer that reads the folder finds them, each converted by the
   * first adapter that accepts it (A1 to A11, A14).
   */
  import(
    exported: Pick<Files, "read" | "list">,
    folder: string,
    adapters: readonly LoadedAdapter[],
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
      return fileExport(context, documents, adapters);
    });
  }

  /** An entry (A12). */
  enter(entry: StepFile): Promise<Performed> {
    return this.#step((context) => fileEntry(context, entry));
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
    return (await matcherView(this.#options)).select(query);
  }

  /** A pod that stands where this one does, over a copy of its files, with its own time. */
  async fork(time: IdsAndTime): Promise<CorePod> {
    const fork = new CorePod({
      ...this.#options,
      pod: await copied(this.#options.pod),
      time,
    });
    fork.#references = this.#references;
    return fork;
  }

  #tables(): Promise<References> {
    this.#references ??= this.#options.references();
    return this.#references;
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
      });
      const wrote = await writes.commit(options.pod);
      performed =
        typeof activity === "string" ? { wrote, activity } : { wrote };
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      performed = { wrote: [], refused: error.message };
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
    const made = await built(
      pod,
      layout,
      address,
      files,
      at,
      title,
      build.lens,
      newStore(),
      build.derive,
    );
    for (const [path, triples] of made)
      await pod.write(path, ntriples(triples));
  }
}
