import { BuildFailure, CorePod, type Performed } from "./core-pod.js";
import type { Derive } from "./build.js";
import { StoryTime } from "./ids.js";
import type { Files } from "./files.js";
import type { Importer } from "./importer.js";
import type { Layout } from "./layout.js";
import { References } from "./references.js";
import { SavedOutputBridge } from "./saved-output-bridge.js";
import type { StepFile } from "./step.js";
import type { StoreFactory } from "./store.js";
import type { Step, StepKind, Story } from "./story.js";

/** What the replay holds of the story when it performs one of its steps. */
interface StorySide {
  /** The story's own files, which its steps name relative to `folder`. */
  readonly source: Files;
  readonly folder: string;
  readonly vocabulary: Files;
  /** The import or entry session each step before this one made, by the step's name. */
  readonly activities: ReadonlyMap<string, string>;
  /** The time the pod's steps are performed at, which a performer begins at its step's. */
  readonly time: StoryTime;
  readonly newStore: StoreFactory;
  /** The pod of the writer so numbered, the first's 0. */
  readonly writer: (index: number) => CorePod;
}

/** Performs a story's step by turning it into its inputs and calling the pod's step of its kind. */
export type Perform = (
  pod: CorePod,
  step: Step,
  story: StorySide,
) => Promise<Performed>;

export type Performers = Partial<Record<StepKind, Perform>>;

/** The path of a file a step names, within the story's own files. */
function inStory(folder: string, path: string): string {
  return folder === "" ? path : `${folder}/${path}`;
}

/** The pod's step given a file the step names, named in messages by its path in the story; refused when the story has no such file. */
async function withStoryFile(
  pod: CorePod,
  story: StorySide,
  path: string,
  perform: (file: StepFile) => Promise<Performed>,
): Promise<Performed> {
  const at = inStory(story.folder, path);
  const bytes = await story.source.read(at);
  return bytes === undefined
    ? pod.refuse(`${story.source.iri}${at} does not exist`)
    : perform({ bytes, base: story.source.iri + at, name: path });
}

const SETTING = /<urn:cascade:revision-setting:([^>]+)>/g;

/**
 * A judgment's Turtle with each <urn:cascade:revision-setting:{version}> made the one revision that sets the version,
 * where one does: a revision's name depends on its run, so a story cannot write it.
 */
async function revisionsNamed(
  pod: CorePod,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const text = new TextDecoder().decode(bytes);
  const named = new Map<string, string>();
  for (const [placeholder, version = ""] of text.matchAll(SETTING)) {
    if (named.has(placeholder)) continue;
    const { rows } = await pod.select(
      `SELECT ?revision WHERE { ?revision <https://ns.cascadeprotocol.org/cascade#version> <${version}> }`,
    );
    const [only] = rows;
    const revision = only?.get("revision")?.value;
    if (rows.length === 1 && revision !== undefined)
      named.set(placeholder, `<${revision}>`);
  }
  return new TextEncoder().encode(
    text.replace(
      SETTING,
      (placeholder) => named.get(placeholder) ?? placeholder,
    ),
  );
}

/** The step happened when the story says. */
function begun(story: StorySide, step: Step): void {
  story.time.begin(step.when);
}

/** An import: its export's or its download's documents, of any media type, converted by the Bridge output the story saved for them. */
const importSaved: Perform = async (pod, step, story) => {
  const { happened } = step;
  if (happened.kind !== "import") throw new Error("the step is no import");
  const folder = inStory(story.folder, happened.export);
  const converted = inStory(story.folder, happened.converted);
  const bridge = await SavedOutputBridge.of(story.source, {
    export: folder,
    converted,
  });
  const adapter = await bridge.load({
    iri: `${story.source.iri}${converted}/`,
    files: new Map(),
  });
  try {
    begun(story, step);
    return await pod.import(story.source, folder, async () => () => [adapter]);
  } finally {
    await adapter.free();
  }
};

export const PERFORMERS: Performers = {
  creation: (pod, step, story) => {
    begun(story, step);
    return pod.create();
  },
  import: importSaved,
  entry: async (pod, step, story) => {
    const { happened } = step;
    if (happened.kind !== "entry") throw new Error("the step is no entry");
    begun(story, step);
    return withStoryFile(pod, story, happened.file, (entry) =>
      pod.enter(entry),
    );
  },
  judgment: async (pod, step, story) => {
    const { happened } = step;
    if (happened.kind !== "judgment")
      throw new Error("the step is no judgment");
    begun(story, step);
    return withStoryFile(pod, story, happened.file, async (judgment) =>
      pod.judge({
        ...judgment,
        bytes: await revisionsNamed(pod, judgment.bytes),
      }),
    );
  },
  reference: (pod, step, story) => {
    const { happened } = step;
    if (happened.kind !== "reference")
      throw new Error("the step is no reference");
    begun(story, step);
    return pod.reference(happened.name);
  },
  matcher: (pod, step, story) => {
    const { happened } = step;
    if (happened.kind !== "matcher")
      throw new Error("the step is no matcher run");
    begun(story, step);
    if (happened.takes === undefined) return pod.match();
    const activity = story.activities.get(happened.takes);
    // A step that made no import or entry session began no records, so there are none to take.
    return activity === undefined
      ? Promise.resolve({ wrote: [] })
      : pod.match(activity);
  },
  sync: (pod, step, story) => {
    const { happened } = step;
    if (happened.kind !== "sync") throw new Error("the step is no sync");
    begun(story, step);
    return pod.receive(story.writer(happened.from).files);
  },
  open: async (pod, step, story) => {
    const { happened } = step;
    if (happened.kind !== "open") throw new Error("the step is no open");
    begun(story, step);
    return withStoryFile(
      pod,
      story,
      `${happened.tables}references.ttl`,
      async () =>
        pod.open(
          await References.of(
            story.source,
            inStory(story.folder, happened.tables),
            story.newStore,
            story.vocabulary,
          ),
        ),
    );
  },
};

export interface ReplayedStep extends Performed {
  readonly step: Step;
}

/** A story replayed into a pod, as far as the runtime can perform its steps. */
export interface Replayed {
  /** The runtime that performed its acts (N7). */
  readonly runtime: string;
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
  /** The runtime performing its acts, as N7 names it. */
  readonly runtime: string;
  /** The tables the pod is given, instead of the story's own `references/`. */
  readonly references?: () => Promise<References>;
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

/** Where a fork of a replay stands. */
interface Standing {
  /** The pod of each writer, the first's first. */
  readonly pods: readonly CorePod[];
  readonly time: StoryTime;
  readonly steps: readonly ReplayedStep[];
  readonly stopped: Replayed["stopped"];
}

/** A story being replayed step by step, which can be forked to replay two ways from where it stands. */
export class Replay {
  readonly #options: ReplayOptions;
  readonly #pods: CorePod[];
  readonly #time: StoryTime;
  readonly #steps: ReplayedStep[];
  readonly #activities: Map<string, string>;
  #stopped: Replayed["stopped"];

  constructor(options: ReplayOptions, standing?: Standing) {
    this.#options = options;
    this.#time = standing?.time ?? new StoryTime();
    this.#pods = standing === undefined ? [] : [...standing.pods];
    this.#pods[0] ??= new CorePod({
      pod: options.pod,
      address: options.story.address,
      subject: options.story.subject,
      title: options.title,
      vocabulary: options.vocabulary,
      layout: options.layout,
      newStore: options.newStore,
      time: this.#time,
      importers: options.importers ?? [],
      runtime: options.runtime,
      references:
        options.references ??
        (() =>
          References.of(
            options.source,
            inStory(options.folder, "references/"),
            options.newStore,
          )),
      ...(options.build === undefined ? {} : { build: options.build }),
    });
    const steps = standing?.steps ?? [];
    this.#steps = [...steps];
    this.#activities = new Map(
      steps.flatMap(({ step, activity }) =>
        activity === undefined ? [] : [[step.name, activity] as const],
      ),
    );
    this.#stopped = standing?.stopped;
  }

  /** Performs the step, unless the replay stopped at one it could not perform. */
  async perform(step: Step): Promise<void> {
    if (this.#stopped !== undefined) return;
    const options = this.#options;
    const writer = step.writer ?? 0;
    if (step.happened.kind === "writer") {
      this.#pods[writer] = await (this.#pods[0] as CorePod).newWriter();
      this.#record(step, { wrote: [] });
      return;
    }
    const pod = this.#pods[writer];
    if (pod === undefined) throw new Error(`the pod has no writer ${writer}`);
    const perform = (options.performers ?? PERFORMERS)[step.happened.kind];
    if (perform === undefined) {
      this.#stopped = {
        step,
        why: `this runtime cannot yet perform a step of kind ${step.happened.kind}`,
      };
      return;
    }
    let performed: Performed;
    try {
      performed = await perform(pod, step, {
        source: options.source,
        folder: options.folder,
        vocabulary: options.vocabulary,
        activities: this.#activities,
        time: this.#time,
        newStore: options.newStore,
        writer: (index) => {
          const found = this.#pods[index];
          if (found === undefined)
            throw new Error(`the pod has no writer ${index}`);
          return found;
        },
      });
    } catch (error) {
      if (error instanceof BuildFailure) {
        this.#record(step, error.performed);
        throw error;
      }
      this.#stopped = {
        step,
        why: error instanceof Error ? error.message : String(error),
      };
      return;
    }
    this.#record(step, performed);
  }

  #record(step: Step, performed: Performed): void {
    if (performed.activity !== undefined)
      this.#activities.set(step.name, performed.activity);
    this.#steps.push({ step, ...performed });
  }

  /** A replay that stands where this one does, over a copy of each writer's pod. */
  async fork(): Promise<Replay> {
    const time = new StoryTime();
    const pods: CorePod[] = [];
    for (const pod of this.#pods) pods.push(await pod.fork(time));
    return new Replay(this.#options, {
      pods,
      time,
      steps: this.#steps,
      stopped: this.#stopped,
    });
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
      runtime: this.#options.runtime,
      pod: (this.#pods[this.#steps.at(-1)?.step.writer ?? 0] as CorePod).files,
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
