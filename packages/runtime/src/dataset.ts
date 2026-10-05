import type { Derive } from "./build.js";
import type { Files } from "./files.js";
import { type Layout, LAYOUT_GRAPH } from "./layout.js";
import { iri, type Triple } from "./rdf.js";
import type { Replayed, ReplayedStep } from "./replay.js";
import type { Store } from "./store.js";

export const STEPS_GRAPH = "urn:cascade:steps";
export const STEP = "urn:cascade:step:";
const GENERATED = "http://www.w3.org/ns/prov#generated";

/** The pod as the steps left it, in the store, each RDF file a named graph; and what `derive` builds from it. */
export async function built(
  pod: Files,
  layout: Layout,
  address: string,
  steps: readonly ReplayedStep[],
  title: string,
  lens: string,
  store: Store,
  derive?: Derive,
): Promise<ReadonlyMap<string, readonly Triple[]>> {
  const files = steps.flatMap(({ wrote }) => wrote);
  for (const path of files.filter((path) => layout.isRdf(path))) {
    const bytes = await pod.read(path);
    if (bytes === undefined)
      throw new Error(`${address}${path} was written and is gone`);
    await store.loadTurtle(bytes, { graph: address + path });
  }
  const at = steps.at(-1)?.step.when;
  if (derive === undefined || at === undefined) return new Map();
  return derive(store, lens, { address, at, title });
}

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
  await built(
    replayed.pod,
    replayed.layout,
    address,
    steps,
    replayed.title,
    lens,
    store,
    derive,
  );
  await store.add(await store.parse(replayed.layout.turtle, address), {
    graph: LAYOUT_GRAPH,
  });
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
