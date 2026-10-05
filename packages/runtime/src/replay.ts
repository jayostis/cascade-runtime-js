import type { Files } from "./files.js";
import { StoryTime } from "./ids.js";
import { FOLDERS, fanned } from "./layout.js";
import { StepWrites } from "./pod.js";
import { iri, ntriples, RDF } from "./rdf.js";
import type { Step, StepKind, Story } from "./story.js";

export const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";

/** A step the rules refuse: it writes nothing, and the replay goes on. */
export class Refusal extends Error {
  override readonly name = "Refusal";
}

/** What a step is performed with. */
export interface StepContext {
  readonly story: Story;
  readonly step: Step;
  /** The story's own files, which its steps name relative to `folder`. */
  readonly source: Files;
  readonly folder: string;
  /** The pod as the steps before this one left it. */
  readonly pod: Files;
  readonly time: StoryTime;
  readonly writes: StepWrites;
}

export type Perform = (context: StepContext) => Promise<void>;

export type Performers = Partial<Record<StepKind, Perform>>;

/** Rule A13: the pod's creation writes the subject as a rec:Subject. */
export const fileCreation: Perform = (context) => {
  const subject = context.story.subject;
  context.writes.add(
    fanned(FOLDERS.subject, subject),
    ntriples([[iri(subject), iri(`${RDF}type`), iri(`${REC}Subject`)]]),
  );
  return Promise.resolve();
};

export const PERFORMERS: Performers = { creation: fileCreation };

export interface ReplayedStep {
  readonly step: Step;
  /** The files new to the pod that the step wrote, in the order it wrote them. */
  readonly wrote: readonly string[];
  readonly refused?: string;
}

/** A story replayed into a pod, as far as the runtime can perform its steps. */
export interface Replayed {
  readonly story: Story;
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
  readonly performers?: Performers;
}

export async function replay(options: ReplayOptions): Promise<Replayed> {
  const performers = options.performers ?? PERFORMERS;
  const time = new StoryTime();
  const steps: ReplayedStep[] = [];
  for (const step of options.story.steps) {
    const perform = performers[step.happened.kind];
    if (perform === undefined) {
      return {
        story: options.story,
        pod: options.pod,
        steps,
        stopped: {
          step,
          why: `this runtime cannot yet perform a step of kind ${step.happened.kind}`,
        },
      };
    }
    time.begin(step.when);
    const writes = new StepWrites();
    try {
      await perform({ ...options, step, time, writes });
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      steps.push({ step, wrote: [], refused: error.message });
      continue;
    }
    steps.push({ step, wrote: await writes.commit(options.pod) });
  }
  return { story: options.story, pod: options.pod, steps };
}
