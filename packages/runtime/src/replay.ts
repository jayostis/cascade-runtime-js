import { fileEntry, fileExport } from "./arrivals.js";
import { fileCreation, fileJudgment, fileReference } from "./filings.js";
import { runMatcher } from "./matcher.js";
import type { Derive } from "./build.js";
import { built } from "./dataset.js";
import { StoryTime } from "./ids.js";
import { type Files, MemoryFiles } from "./files.js";
import type { ExportDocument, Importer } from "./importer.js";
import type { Layout } from "./layout.js";
import { StepWrites } from "./pod.js";
import { ntriples } from "./rdf.js";
import { References } from "./references.js";
import { SavedOutputBridge } from "./saved-output-bridge.js";
import { Refusal, type StepContext } from "./step.js";
import type { StoreFactory } from "./store.js";
import type { Step, StepKind, Story } from "./story.js";

/** What the replay holds of the story when it performs one of its steps. */
interface StorySide {
  /** The story's own files, which its steps name relative to `folder`. */
  readonly source: Files;
  readonly folder: string;
  /** The importers `cascade-runtime.json` names, in its order. */
  readonly importers: readonly Importer[];
  /** The import or entry session each step before this one made, by the step's name. */
  readonly activities: ReadonlyMap<string, string>;
}

/** Performs a story's step by calling a step with its inputs; resolves to the import or entry session it made, if it made one. */
export type Perform = (
  context: StepContext,
  step: Step,
  story: StorySide,
) => Promise<string | void>;

export type Performers = Partial<Record<StepKind, Perform>>;

/** The path of a file a step names, within the story's own files. */
function inStory(story: StorySide, path: string): string {
  return story.folder === "" ? path : `${story.folder}/${path}`;
}

/** A file a step names, named in messages by its path in the story. */
async function storyFile(
  story: StorySide,
  path: string,
): Promise<{ bytes: Uint8Array; base: string; name: string }> {
  const at = inStory(story, path);
  const bytes = await story.source.read(at);
  if (bytes === undefined)
    throw new Error(`${story.source.iri}${at} does not exist`);
  return { bytes, base: story.source.iri + at, name: path };
}

/** The tables in the person's folder's `references/`. */
function storyReferences(
  context: StepContext,
  story: StorySide,
): Promise<References> {
  return References.of(
    story.source,
    inStory(story, "references/"),
    context.newStore,
  );
}

/** An import: its export's documents, converted by the Bridge output the story saved for them. */
const importSaved: Perform = async (context, { happened }, story) => {
  if (happened.kind !== "import") throw new Error("the step is no import");
  const folder = inStory(story, happened.export);
  const converted = inStory(story, happened.converted);
  let documents: readonly ExportDocument[] | undefined;
  for (const importer of story.importers) {
    try {
      documents = await importer.documents(story.source, folder);
    } catch (error) {
      throw new Refusal(
        `${folder}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (documents !== undefined) break;
  }
  if (documents === undefined)
    throw new Error(
      `no importer of ${story.importers.map((importer) => importer.name).join(", ") || "none"} reads ${folder}`,
    );
  const bridge = await SavedOutputBridge.of(story.source, {
    export: folder,
    converted,
  });
  const adapter = await bridge.load({
    iri: `${story.source.iri}${converted}/`,
    files: new Map(),
  });
  try {
    return await fileExport(context, documents, [adapter]);
  } finally {
    await adapter.free();
  }
};

export const PERFORMERS: Performers = {
  creation: fileCreation,
  import: importSaved,
  entry: async (context, { happened }, story) => {
    if (happened.kind !== "entry") throw new Error("the step is no entry");
    return fileEntry(context, await storyFile(story, happened.file));
  },
  judgment: async (context, { happened }, story) => {
    if (happened.kind !== "judgment")
      throw new Error("the step is no judgment");
    await fileJudgment(context, await storyFile(story, happened.file));
  },
  reference: async (context, { happened }, story) => {
    if (happened.kind !== "reference")
      throw new Error("the step is no reference");
    await fileReference(
      context,
      await storyReferences(context, story),
      happened.name,
    );
  },
  matcher: async (context, { happened }, story) => {
    if (happened.kind !== "matcher")
      throw new Error("the step is no matcher run");
    const references = await storyReferences(context, story);
    if (happened.takes === undefined) return runMatcher(context, references);
    const activity = story.activities.get(happened.takes);
    // A step that made no import or entry session began no records, so there are none to take.
    if (activity !== undefined)
      return runMatcher(context, references, activity);
  },
};

export interface ReplayedStep {
  readonly step: Step;
  /** The files new to the pod that the step wrote, in the order it wrote them. */
  readonly wrote: readonly string[];
  readonly refused?: string;
  /** The import or entry session the step made. */
  readonly activity?: string;
}

/** A story replayed into a pod, as far as the runtime can perform its steps. */
export interface Replayed {
  readonly story: Story;
  /** What a pod's manifest takes as its title: the name the source's crate gives the story's folder, or else the folder's own. */
  readonly title: string;
  readonly layout: Layout;
  readonly pod: Files;
  readonly steps: readonly ReplayedStep[];
  /** The step the replay stopped at, and why, when it could not perform it. */
  readonly stopped?: { readonly step: Step; readonly why: string };
}

export interface ReplayOptions {
  /** The pod's address and subject, and the steps to replay, in order. */
  readonly story: Story;
  readonly source: Files;
  /** The vocabulary, whose queries the matcher runs. */
  readonly vocabulary: Files;
  /** The folder within `source` the steps name their files under, without a trailing slash. */
  readonly folder: string;
  /** What a pod's manifest takes as its title. */
  readonly title: string;
  /** An empty pod at the story's address: a story is replayed from the pod's creation. */
  readonly pod: Files;
  readonly layout: Layout;
  readonly newStore: StoreFactory;
  readonly importers?: readonly Importer[];
  readonly performers?: Performers;
  /** When given, the files the build writes are rebuilt under the lens after every step and written to the pod. */
  readonly build?: { readonly lens: string; readonly derive: Derive };
}

/** The name the source's crate gives the folder, or else the folder's own. */
export async function titleOf(source: Files, folder: string): Promise<string> {
  const bytes = await source.read("ro-crate-metadata.json");
  if (bytes !== undefined) {
    const crate = JSON.parse(new TextDecoder().decode(bytes)) as {
      "@graph"?: readonly { "@id"?: unknown; name?: unknown }[];
    };
    const name = crate["@graph"]?.find(
      (entity) => entity["@id"] === `${folder}/`,
    )?.name;
    if (typeof name === "string" && name !== "") return name;
  }
  return (
    (folder || new URL(source.iri).pathname)
      .replace(/\/$/, "")
      .split("/")
      .at(-1) ?? ""
  );
}

/** A copy of the pod's files, in memory, to replay one way while the pod is replayed another. */
async function copied(pod: Files): Promise<Files> {
  const copy = new MemoryFiles(pod.iri);
  for (const path of await pod.list("")) {
    const bytes = await pod.read(path);
    if (bytes !== undefined) await copy.write(path, bytes);
  }
  return copy;
}

/** A story being replayed step by step, which can be forked to replay two ways from where it stands. */
export class Replay {
  readonly #options: ReplayOptions;
  readonly #pod: Files;
  readonly #steps: ReplayedStep[];
  readonly #activities: Map<string, string>;
  #stopped: Replayed["stopped"];

  constructor(
    options: ReplayOptions,
    pod: Files = options.pod,
    steps: readonly ReplayedStep[] = [],
    stopped?: Replayed["stopped"],
  ) {
    this.#options = options;
    this.#pod = pod;
    this.#steps = [...steps];
    this.#activities = new Map(
      steps.flatMap(({ step, activity }) =>
        activity === undefined ? [] : [[step.name, activity] as const],
      ),
    );
    this.#stopped = stopped;
  }

  /** Performs the step, unless the replay stopped at one it could not perform. */
  async perform(step: Step): Promise<void> {
    if (this.#stopped !== undefined) return;
    const options = this.#options;
    const perform = (options.performers ?? PERFORMERS)[step.happened.kind];
    if (perform === undefined) {
      this.#stopped = {
        step,
        why: `this runtime cannot yet perform a step of kind ${step.happened.kind}`,
      };
      return;
    }
    const time = new StoryTime();
    time.begin(step.when);
    const writes = new StepWrites();
    try {
      const activity = await perform(
        {
          address: options.story.address,
          subject: options.story.subject,
          pod: this.#pod,
          time,
          writes,
          newStore: options.newStore,
          layout: options.layout,
          vocabulary: options.vocabulary,
        },
        step,
        {
          source: options.source,
          folder: options.folder,
          importers: options.importers ?? [],
          activities: this.#activities,
        },
      );
      const wrote = await writes.commit(this.#pod);
      if (typeof activity === "string") {
        this.#activities.set(step.name, activity);
        this.#steps.push({ step, wrote, activity });
      } else this.#steps.push({ step, wrote });
    } catch (error) {
      if (!(error instanceof Refusal)) {
        this.#stopped = {
          step,
          why: error instanceof Error ? error.message : String(error),
        };
        return;
      }
      this.#steps.push({ step, wrote: [], refused: error.message });
    }
    if (options.build !== undefined) {
      const files = await built(
        this.#pod,
        options.layout,
        options.story.address,
        this.#steps,
        options.title,
        options.build.lens,
        options.newStore(),
        options.build.derive,
      );
      for (const [path, triples] of files)
        await this.#pod.write(path, ntriples(triples));
    }
  }

  /** A replay that stands where this one does, over a copy of its pod. */
  async fork(): Promise<Replay> {
    return new Replay(
      this.#options,
      await copied(this.#pod),
      this.#steps,
      this.#stopped,
    );
  }

  /** The replay as it stands. Every file a step wrote stays as it was written, so a later step never changes it. */
  replayed(): Replayed {
    return {
      story: {
        ...this.#options.story,
        steps: this.#steps.map(({ step }) => step),
      },
      title: this.#options.title,
      layout: this.#options.layout,
      pod: this.#pod,
      steps: [...this.#steps],
      ...(this.#stopped === undefined ? {} : { stopped: this.#stopped }),
    };
  }
}

export async function replay(options: ReplayOptions): Promise<Replayed> {
  const replaying = new Replay(options);
  for (const step of options.story.steps) await replaying.perform(step);
  return replaying.replayed();
}
