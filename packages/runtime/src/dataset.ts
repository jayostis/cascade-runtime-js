import type { Derive, VocabularyBuild } from "./build.js";
import type { DerivedStep } from "./derive.js";
import type { Files } from "./files.js";
import { type Layout, LAYOUT_GRAPH } from "./layout.js";
import { iri, ntriples, type Term, type Triple } from "./rdf.js";
import type { Replayed } from "./replay.js";
import { type Dataset, type Store, Union } from "./store.js";

export const STEPS_GRAPH = "urn:cascade:steps";
export const STEP = "urn:cascade:step:";
const GENERATED = "http://www.w3.org/ns/prov#generated";
const STORAGE = "http://www.w3.org/ns/pim/space#storage";
const DCT = "http://purl.org/dc/terms/";

/** The layout read with each pod's address as its base, as N-Triples, once per address. */
const writtenLayouts = new WeakMap<Layout, Map<string, Promise<Uint8Array>>>();

export async function addLayout(
  union: Union,
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
    triples = union.store.parse(layout.turtle, address).then(ntriples);
    byAddress.set(address, triples);
  }
  await union.loadTurtle(await triples, LAYOUT_GRAPH);
}

/** The pod's files, in the union, each RDF file a named graph; and what `derive` builds from them at the time given. */
export async function built(
  pod: Files,
  layout: Layout,
  address: string,
  files: readonly string[],
  at: string | undefined,
  title: string,
  lens: string,
  union: Union,
  derive?: Derive,
): Promise<ReadonlyMap<string, readonly Triple[]>> {
  for (const path of files.filter((path) => layout.isRdf(path))) {
    const bytes = await pod.read(path);
    if (bytes === undefined)
      throw new Error(`${address}${path} was written and is gone`);
    await union.loadTurtle(bytes, address + path);
  }
  if (derive === undefined || at === undefined) return new Map();
  return derive(union, lens, { address, at, title });
}

/**
 * The pod as it stood after the step, in the store: each RDF file a named graph, named by the pod's address plus its
 * path; what `derive` adds for the lens; and `urn:cascade:steps`, outside the union, listing each file new to the pod
 * that each step through this one wrote.
 */
export async function dataset(
  replayed: Replayed,
  through: string,
  lens: string,
  store: Store,
  derive?: Derive,
): Promise<Dataset> {
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
  const union = new Union(store);
  await built(
    replayed.pod,
    replayed.layout,
    address,
    steps.flatMap(({ wrote }) => wrote),
    steps.at(-1)?.step.when,
    replayed.title,
    lens,
    union,
    derive,
  );
  await addLayout(union, replayed.layout, address);
  await store.add(
    steps.flatMap(({ step, wrote }) =>
      wrote.map(
        (path) =>
          [iri(STEP + step.name), iri(GENERATED), iri(address + path)] as const,
      ),
    ),
    { graph: STEPS_GRAPH },
  );
  return union;
}

/** A pod read from its own files and built under a lens. */
export interface PodBuild {
  readonly address: string;
  readonly title: string;
  /** Every file of the pod, and each file the build writes that the pod lacks. */
  readonly files: readonly string[];
  readonly store: Dataset;
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

/** What a pod's own files say of it: the address its owner's profile names, and its manifest's title and time. */
export interface PodStated {
  readonly address: string;
  readonly title?: string;
  readonly at?: string;
}

export async function podStated(
  pod: Files,
  layout: Layout,
  store: Store,
): Promise<PodStated> {
  const storage = valueOf(await triplesOf(pod, layout.card, store), STORAGE);
  if (storage?.termType !== "NamedNode")
    throw new Error(`${pod.iri}${layout.card} names no storage for the pod`);
  const manifest = await triplesOf(pod, layout.manifest, store);
  const title = valueOf(manifest, `${DCT}title`)?.value;
  const at = valueOf(manifest, `${DCT}created`)?.value;
  return {
    address: storage.value,
    ...(title === undefined ? {} : { title }),
    ...(at === undefined ? {} : { at }),
  };
}

/**
 * Loads each RDF file of the pod but those the build writes into the union, named by the address plus its path;
 * returns every file the pod holds, as `held` lists them when given.
 */
export async function podFiles(
  pod: Files,
  layout: Layout,
  address: string,
  union: Union,
  held?: readonly string[],
): Promise<readonly string[]> {
  const rebuilt = new Set(layout.rebuilt);
  const listed = held ?? (await pod.list(""));
  const paths = listed.filter(
    (path) => layout.isRdf(path) && !rebuilt.has(path),
  );
  const read = await Promise.all(paths.map((path) => pod.read(path)));
  for (const [index, path] of paths.entries()) {
    const bytes = read[index];
    if (bytes === undefined) throw new Error(`${pod.iri}${path} is gone`);
    try {
      await union.loadTurtle(bytes, address + path);
    } catch (error) {
      throw new Error(`${pod.iri}${path} is no Turtle: ${String(error)}`, {
        cause: error,
      });
    }
  }
  return listed;
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
  const stated = await podStated(pod, layout, store);
  const { address } = stated;
  const title = stated.title ?? otherwise.title;
  const at = stated.at ?? otherwise.at;
  const union = new Union(store);
  const held = await podFiles(pod, layout, address, union);
  const derived = await build.derivations.derive(union, lens);
  const built = await build.files(union, { address, at, title });
  await addLayout(union, layout, address);
  return {
    address,
    title,
    files: [...new Set([...held, ...built.keys()])].sort(),
    store: union,
    derived,
    built,
  };
}
