import type { Files } from "./files.js";
import type { IdsAndTime } from "./ids.js";
import type { Layout } from "./layout.js";
import type { StepWrites } from "./pod.js";
import type { StoreFactory } from "./store.js";

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
}
