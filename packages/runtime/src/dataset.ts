import { isRdf } from "./layout.js";
import { iri } from "./rdf.js";
import type { Replayed } from "./replay.js";
import type { Store } from "./store.js";

export const STEPS_GRAPH = "urn:cascade:steps";
export const STEP = "urn:cascade:step:";
export const DERIVED = "urn:cascade:derived:";
const GENERATED = "http://www.w3.org/ns/prov#generated";

/** Adds the lens's derived state, and the files built from it, to a store holding a pod. */
export type Derive = (store: Store, lens: string) => Promise<void>;

/**
 * The pod as it stood after the step, in the store: each RDF file a named graph, named by the pod's address plus its
 * path; what `derive` adds for the lens; and `urn:cascade:steps`, outside the default graph, listing each file new to
 * the pod that each step through this one wrote.
 */
export async function dataset(
  replayed: Replayed,
  through: string,
  lens: string,
  store: Store,
  derive?: Derive,
): Promise<Store> {
  const index = replayed.steps.findIndex(({ step }) => step.name === through);
  if (index < 0) {
    if (replayed.stopped !== undefined) {
      throw new Error(
        `the replay stopped at step ${replayed.stopped.step.name}: ${replayed.stopped.why}`,
      );
    }
    throw new Error(`the story has no step ${through}`);
  }
  const steps = replayed.steps.slice(0, index + 1);
  const address = replayed.story.address;
  for (const { wrote } of steps) {
    for (const path of wrote.filter(isRdf)) {
      const bytes = await replayed.pod.read(path);
      if (bytes === undefined)
        throw new Error(`${address}${path} was written and is gone`);
      await store.loadTurtle(bytes, { graph: address + path });
    }
  }
  await derive?.(store, lens);
  await store.add(
    steps.flatMap(({ step, wrote }) =>
      wrote.map(
        (path) =>
          [iri(STEP + step.name), iri(GENERATED), iri(address + path)] as const,
      ),
    ),
    { graph: STEPS_GRAPH, alone: true },
  );
  return store;
}
