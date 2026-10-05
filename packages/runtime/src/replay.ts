import { fileEntry, fileImport } from "./arrivals.js";
import { fileJudgment, fileReference } from "./filings.js";
import { type Derive, typeIndex } from "./build.js";
import { built } from "./dataset.js";
import type { Files } from "./files.js";
import { StoryTime } from "./ids.js";
import type { Importer } from "./importer.js";
import { BUILT, FOLDERS, fanned } from "./layout.js";
import { StepWrites } from "./pod.js";
import { iri, ntriples, RDF } from "./rdf.js";
import { type Perform, type Performers, REC, Refusal } from "./step.js";
import type { StoreFactory } from "./store.js";
import type { Step, Story } from "./story.js";

/** Rule A13: the pod's creation writes the subject as a rec:Subject, and the type index that lists the views. */
export const fileCreation: Perform = (context) => {
  const subject = context.story.subject;
  context.writes.add(
    fanned(FOLDERS.subject, subject),
    ntriples([[iri(subject), iri(`${RDF}type`), iri(`${REC}Subject`)]]),
  );
  context.writes.add(
    BUILT.typeIndex,
    ntriples(typeIndex(context.story.address)),
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
  readonly pod: Files;
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
