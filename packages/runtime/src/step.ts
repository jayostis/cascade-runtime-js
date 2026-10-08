import type { Files } from "./files.js";
import { Graph } from "./graph.js";
import type { IdsAndTime } from "./ids.js";
import type { Layout } from "./layout.js";
import type { StepWrites } from "./pod.js";
import type { StoreFactory, Union } from "./store.js";

export const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";

/** A step the rules refuse: it writes nothing, and the replay goes on. */
export class Refusal extends Error {
  override readonly name = "Refusal";
}

/** What an import is doing, as it begins each part, with what is done so far. */
export interface ImportProgress {
  readonly part: "loading the adapter" | "converting" | "saving" | "judging";
  /** How many of the part's documents, or of judging's steps, are done, where they are counted. */
  readonly done?: number;
  /** How many there are, where they are counted. */
  readonly of?: number;
}

/** Told of each part of an import as it begins; the import goes on once what it returns settles. */
export type OnProgress = (progress: ImportProgress) => void | Promise<void>;

/** What a step is performed with. */
export interface StepContext {
  /** The pod's address, which every file of it is named from. */
  readonly address: string;
  readonly subject: string;
  /** The pod as the steps before this one left it. */
  readonly pod: Files;
  readonly time: IdsAndTime;
  readonly writes: StepWrites;
  readonly newStore: StoreFactory;
  /** Where the pod files what a step writes. */
  readonly layout: Layout;
  /** The vocabulary, whose queries the matcher runs. */
  readonly vocabulary: Files;
  /**
   * The pod as the matcher reads it before the step, built once for the pod as it stands. The step owns it and may add
   * to it: the pod drops it when the step ends.
   */
  matcherView(): Promise<Union>;
}

/** A file a step is given: an entry's or a person's judgment's Turtle. */
export interface StepFile {
  readonly bytes: Uint8Array;
  /** The IRI its Turtle is parsed against. */
  readonly base: string;
  /** What its refusals and errors call it. */
  readonly name: string;
}

/** A step's file, parsed: Turtle that does not parse refuses the step. */
export async function parseStepFile(
  file: StepFile,
  newStore: StoreFactory,
): Promise<Graph> {
  const store = newStore();
  let triples;
  try {
    triples = await store.parse(file.bytes, file.base);
  } catch (error) {
    throw new Refusal(
      `${file.name} is no Turtle: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return new Graph(triples);
}
