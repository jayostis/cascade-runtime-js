import type { Files } from "./files.js";
import type { IdsAndTime } from "./ids.js";
import type { Importer } from "./importer.js";
import type { Layout } from "./layout.js";
import type { StepWrites } from "./pod.js";
import type { StoreFactory } from "./store.js";
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
  readonly time: IdsAndTime;
  readonly writes: StepWrites;
  readonly newStore: StoreFactory;
  /** Where the pod files what a step writes. */
  readonly layout: Layout;
  /** The importers `cascade-runtime.json` names, in its order. */
  readonly importers: readonly Importer[];
}

export type Perform = (context: StepContext) => Promise<void>;

export type Performers = Partial<Record<StepKind, Perform>>;

/** The path of a file a step names, within the story's own files. */
export function inStory(context: StepContext, path: string): string {
  return context.folder === "" ? path : `${context.folder}/${path}`;
}
