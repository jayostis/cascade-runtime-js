import { fileEntry, fileImport } from "./arrivals.js";
import { fileJudgment, fileReference } from "./filings.js";
import type { Derive } from "./build.js";
import { built } from "./dataset.js";
import type { Files } from "./files.js";
import { StoryTime } from "./ids.js";
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
}

/** A story replayed into a pod, as far as the runtime can perform its steps. */
export interface Replayed {
  readonly story: Story;
  /** The name of the story's folder, which a pod's manifest takes as its title. */
  readonly title: string;
  readonly layout: Layout;
  readonly pod: Files;
  readonly steps: readonly ReplayedStep[];
  /** The step the replay stopped at, and why, when it could not perform it. */
  readonly stopped?: { readonly step: Step; readonly why: string };
}

export interface ReplayOptions {
  readonly story: Story;
  readonly source: Files;
  /** The story's folder within `source`, without a trailing slash. */
  readonly folder: string;
  /** An empty pod at the story's address: a story is replayed from the pod's creation. */
  readonly pod: Files;
  readonly layout: Layout;
  readonly newStore: StoreFactory;
  readonly importers?: readonly Importer[];
  readonly performers?: Performers;
  /** When given, the files the build writes are rebuilt under the lens after every step and written to the pod. */
  readonly build?: { readonly lens: string; readonly derive: Derive };
}

export async function replay(options: ReplayOptions): Promise<Replayed> {
  const performers = options.performers ?? PERFORMERS;
  const importers = options.importers ?? [];
  const time = new StoryTime();
  const steps: ReplayedStep[] = [];
  const title =
    (options.folder || new URL(options.source.iri).pathname)
      .replace(/\/$/, "")
      .split("/")
      .at(-1) ?? "";
  const replayed = (stopped?: Replayed["stopped"]): Replayed => ({
    story: options.story,
    title,
    layout: options.layout,
    pod: options.pod,
    steps,
    ...(stopped === undefined ? {} : { stopped }),
  });
  for (const step of options.story.steps) {
    const perform = performers[step.happened.kind];
    if (perform === undefined) {
      return replayed({
        step,
        why: `this runtime cannot yet perform a step of kind ${step.happened.kind}`,
      });
    }
    time.begin(step.when);
    const writes = new StepWrites();
    try {
      await perform({ ...options, importers, step, time, writes });
      steps.push({ step, wrote: await writes.commit(options.pod) });
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      steps.push({ step, wrote: [], refused: error.message });
    }
    if (options.build !== undefined) {
      const files = await built(
        options.pod,
        options.layout,
        options.story.address,
        steps,
        title,
        options.build.lens,
        options.newStore(),
        options.build.derive,
      );
      for (const [path, triples] of files)
        await options.pod.write(path, ntriples(triples));
    }
  }
  return replayed();
}
