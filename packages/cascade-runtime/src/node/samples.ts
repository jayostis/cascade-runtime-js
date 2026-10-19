import type { Files } from "@cascade-runtime/runtime";
import type { Components } from "@cascade-runtime/runtime/node";
import type { Pod } from "../pod.js";
import type { Tables } from "../tables.js";

/** What the published samples are made from: the components, the starter copies of the feeds' series, and the version of the browser entry that copies them. */
export interface SampleSource {
  readonly components: Components;
  readonly starter?: Files;
  readonly runtime: string;
}

export interface SampleOptions {
  /** The kits to publish, by name; by default every kit. */
  readonly kits?: readonly string[];
  /** What the page that shows a pod asks the tables of it, kept as `lookups.json`. */
  readonly look?: (pod: Pod, tables: Tables) => Promise<unknown>;
}

export interface Samples {
  /** Every kit the vocabulary carries, by its name, with its title. */
  readonly kits: ReadonlyMap<string, string>;
  /** The version of the browser entry, which every answer kept is kept under. */
  readonly runtime: string;
  /** Each sample's files, by their paths under the samples' root. */
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export async function samplesOf(
  source: SampleSource,
  options: SampleOptions = {},
): Promise<Samples> {
  void options;
  return { kits: new Map(), runtime: source.runtime, files: new Map() };
}
