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
  /** The pod as the matcher reads it before the step, built once for the pod as it stands. */
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
