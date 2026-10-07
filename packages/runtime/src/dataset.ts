import type { Derive, VocabularyBuild } from "./build.js";
import type { DerivedStep } from "./derive.js";
import type { Files } from "./files.js";
import { type Layout, LAYOUT_GRAPH } from "./layout.js";
import { iri, ntriples, type Term, type Triple } from "./rdf.js";
import type { Replayed } from "./replay.js";
import type { Store } from "./store.js";

export const STEPS_GRAPH = "urn:cascade:steps";
export const STEP = "urn:cascade:step:";
const GENERATED = "http://www.w3.org/ns/prov#generated";
const STORAGE = "http://www.w3.org/ns/pim/space#storage";
const DCT = "http://purl.org/dc/terms/";

/** The layout read with each pod's address as its base, as N-Triples, once per address. */
const writtenLayouts = new WeakMap<Layout, Map<string, Promise<Uint8Array>>>();

async function addLayout(
  store: Store,
  layout: Layout,
  address: string,
): Promise<void> {
  let byAddress = writtenLayouts.get(layout);
  if (byAddress === undefined) {
    byAddress = new Map();
    writtenLayouts.set(layout, byAddress);
  }
  let triples = byAddress.get(address);
  if (triples === undefined) {
    triples = store.parse(layout.turtle, address).then(ntriples);
    byAddress.set(address, triples);
  }
  await store.loadTurtle(await triples, { graph: LAYOUT_GRAPH });
}

/**
 * The pod's files, in the store, each RDF file a named graph; and what `derive` builds from them at the time given,
 * writing again each view among the files `held` though it holds no entry now.
 */
export async function built(
  pod: Files,
  layout: Layout,
  address: string,
  files: readonly string[],
  at: string | undefined,
  title: string,
  lens: string,
  store: Store,
  held: readonly string[],
  derive?: Derive,
): Promise<ReadonlyMap<string, readonly Triple[]>> {
  for (const path of files.filter((path) => layout.isRdf(path))) {
    const bytes = await pod.read(path);
    if (bytes === undefined)
      throw new Error(`${address}${path} was written and is gone`);
    await store.loadTurtle(bytes, { graph: address + path });
  }
  if (derive === undefined || at === undefined) return new Map();
  return derive(store, lens, { address, at, title, files: held });
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
  const index = replayed.steps.findLastIndex(
    ({ step }) => step.name === through,
  );
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
  const files = steps.flatMap(({ wrote }) => wrote);
  await built(
    replayed.pod,
    replayed.layout,
    address,
    files,
    steps.at(-1)?.step.when,
    replayed.title,
    lens,
    store,
    files,
    derive,
  );
  await addLayout(store, replayed.layout, address);
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

/** A pod read from its own files and built under a lens. */
export interface PodBuild {
  readonly address: string;
  readonly title: string;
  /** Every file of the pod, and each file the build writes that the pod lacks. */
  readonly files: readonly string[];
  readonly store: Store;
  readonly derived: readonly DerivedStep[];
  /** The files the build wrote again, which the store holds in place of the pod's copies. */
  readonly built: ReadonlyMap<string, readonly Triple[]>;
}

async function triplesOf(
  pod: Files,
  path: string,
  store: Store,
): Promise<readonly Triple[] | undefined> {
  const bytes = await pod.read(path);
  return bytes === undefined ? undefined : store.parse(bytes, pod.iri + path);
}

function valueOf(
  triples: readonly Triple[] | undefined,
  predicate: string,
): Term | undefined {
  return triples?.find(([, p]) => p.value === predicate)?.[2];
}

/**
 * A pod as a folder holds it, in the store: each RDF file but those the build writes a named graph, by the address its
 * owner's profile names plus its path; the lens's derived state; the files the build writes, written again for the
 * time and title the pod's manifest gives, or else those given; and the layout.
 */
export async function podDataset(
  pod: Files,
  layout: Layout,
  build: VocabularyBuild,
  lens: string,
  store: Store,
  otherwise: { readonly title: string; readonly at: string },
): Promise<PodBuild> {
  const storage = valueOf(await triplesOf(pod, layout.card, store), STORAGE);
  if (storage?.termType !== "NamedNode")
    throw new Error(`${pod.iri}${layout.card} names no storage for the pod`);
  const address = storage.value;
  const manifest = await triplesOf(pod, layout.manifest, store);
  const title = valueOf(manifest, `${DCT}title`)?.value ?? otherwise.title;
  const at = valueOf(manifest, `${DCT}created`)?.value ?? otherwise.at;
  const rebuilt = new Set(layout.rebuilt);
  const held = await pod.list("");
  for (const path of held.filter(
    (path) => layout.isRdf(path) && !rebuilt.has(path),
  )) {
    const bytes = await pod.read(path);
    if (bytes === undefined) throw new Error(`${pod.iri}${path} is gone`);
    try {
      await store.loadTurtle(bytes, { graph: address + path });
    } catch (error) {
      throw new Error(`${pod.iri}${path} is no Turtle: ${String(error)}`, {
        cause: error,
      });
    }
  }
  const derived = await build.derivations.derive(store, lens);
  const built = await build.files(store, { address, at, title, files: held });
  await addLayout(store, layout, address);
  return {
    address,
    title,
    files: [...new Set([...held, ...built.keys()])].sort(),
    store,
    derived,
    built,
  };
}
