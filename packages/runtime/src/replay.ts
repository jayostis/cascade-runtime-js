import { fileEntry, fileImport } from "./arrivals.js";
import { fileJudgment, fileReference } from "./filings.js";
import { runMatcher } from "./matcher.js";
import type { Derive } from "./build.js";
import { built } from "./dataset.js";
import { StoryTime } from "./ids.js";
import { type Files, MemoryFiles } from "./files.js";
import type { Importer } from "./importer.js";
import type { Layout } from "./layout.js";
import { StepWrites } from "./pod.js";
import { iri, ntriples, RDF } from "./rdf.js";
import { type Perform, type Performers, REC, Refusal } from "./step.js";
import type { StoreFactory } from "./store.js";
import type { Step, Story } from "./story.js";

/**
 * Rule A13: the pod's creation writes the subject as a rec:Subject, the owner's profile, saying who the owner is and
 * where the pod's root and the preferences file are, and the preferences file, saying where the type index is.
 */
export const fileCreation: Perform = (context) => {
  const { layout, story, writes } = context;
  const { subject, address } = story;
  const type = iri(`${RDF}type`);
  writes.add(
    layout.place(`${REC}Subject`).path(subject),
    ntriples([[iri(subject), type, iri(`${REC}Subject`)]]),
  );
  const owner = iri(`${address}${layout.card}#me`);
  const preferences = iri(address + layout.preferences);
  writes.add(
    layout.card,
    ntriples([
      [owner, type, iri(`${FOAF}Person`)],
      [owner, type, iri(`${PROV}Person`)],
      [owner, iri(`${PIM}storage`), iri(address)],
      [owner, iri(`${PIM}preferencesFile`), preferences],
    ]),
  );
  writes.add(
    layout.preferences,
    ntriples([
      [preferences, type, iri(`${PIM}ConfigurationFile`)],
      [owner, iri(`${SOLID}privateTypeIndex`), iri(address + layout.typeIndex)],
    ]),
  );
  return Promise.resolve();
};

export const PERFORMERS: Performers = {
  creation: fileCreation,
  import: fileImport,
  entry: fileEntry,
  judgment: fileJudgment,
  reference: fileReference,
  matcher: runMatcher,
};
const FOAF = "http://xmlns.com/foaf/0.1/";
const PROV = "http://www.w3.org/ns/prov#";
const PIM = "http://www.w3.org/ns/pim/space#";
const SOLID = "http://www.w3.org/ns/solid/terms#";

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
      const activity = await perform({
        ...options,
        story: {
          ...options.story,
          steps: [...this.#steps.map(({ step: done }) => done), step],
        },
        pod: this.#pod,
        importers: options.importers ?? [],
        step,
        time,
        writes,
        activities: this.#activities,
      });
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
