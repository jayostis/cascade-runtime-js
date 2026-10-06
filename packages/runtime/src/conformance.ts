import type { Derive } from "./build.js";
import { dataset } from "./dataset.js";
import {
  type Example,
  type Feature,
  featuresOf,
  readFeature,
} from "./features.js";
import { type Files, folderOf, MemoryFiles } from "./files.js";
import { Graph } from "./graph.js";
import type { Importer } from "./importer.js";
import { isKitStory, kitChecks, KIT_CHECKS, KIT_LENS } from "./kit.js";
import { Layout } from "./layout.js";
import {
  type Compiled,
  type Compiling,
  compileStep,
  type Reading,
} from "./phrases.js";
import { blank, iri, literal, ntriples, RDF, type Triple } from "./rdf.js";
import { Replay, type Replayed, titleOf } from "./replay.js";
import type { Shapes } from "./shapes.js";
import type { Performers } from "./step.js";
import type { Store, StoreFactory } from "./store.js";
import type { Step } from "./story.js";
import { peopleOf, type Person, Words } from "./words.js";

const EARL = "http://www.w3.org/ns/earl#";
const DOAP = "http://usefulinc.com/ns/doap#";
const DCT = "http://purl.org/dc/terms/";

export type Outcome = "passed" | "failed" | "inapplicable";

export interface Assertion {
  /** The test's IRI. */
  readonly test: string;
  readonly name: string;
  readonly outcome: Outcome;
  readonly why?: string;
}

export interface ConformanceOptions {
  /** The vocabulary, named by its tree's IRI, which every feature file and the files its steps name are under. */
  readonly vocabulary: Files;
  readonly newStore: StoreFactory;
  /** An empty pod at the address, for an example to be replayed into. */
  readonly newPod: (address: string) => Files;
  readonly importers?: readonly Importer[];
  readonly performers?: Performers;
  readonly derive?: Derive;
  /** The vocabulary's layout, when already read. */
  readonly layout?: Layout;
  /** The vocabulary's shapes, which a kit's check 3 reads; without them, no kit's checks are run. */
  readonly shapes?: Shapes;
  /** The feature files to run, by their paths; every one of the vocabulary when not given. */
  readonly features?: readonly string[];
}

const failure = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** One step of a replay, shared by every example that begins with the steps leading to it. */
interface Node {
  readonly step?: Step;
  readonly children: Map<string, Node>;
  replayed?: Replayed;
  readonly datasets: Map<string, Promise<Store>>;
}

const newNode = (step?: Step): Node => ({
  ...(step === undefined ? {} : { step }),
  children: new Map(),
  datasets: new Map(),
});

/** The replays of one person's pod, from the scripted input beside one feature file. */
interface Root {
  readonly person: Person;
  readonly feature: Feature;
  readonly node: Node;
}

interface Planned {
  readonly example: Example;
  readonly feature: Feature;
  readonly compiled: Compiled;
  /** The node of each of the example's steps, in order. */
  readonly path: readonly Node[];
}

/** Adds a run of steps to a replay tree, sharing the steps it begins with, and gives the node of each. */
function grow(root: Node, steps: readonly Step[]): Node[] {
  const path: Node[] = [];
  let node = root;
  for (const [index, step] of steps.entries()) {
    // A shared step is performed under its position, which every example that shares it gives it alike.
    const { happened } = step;
    const positioned: Step = {
      name: String(index),
      when: step.when,
      happened:
        happened.kind === "matcher" && happened.takes !== undefined
          ? {
              ...happened,
              takes: String(
                steps
                  .slice(0, index)
                  .findLastIndex(({ name }) => name === happened.takes),
              ),
            }
          : happened,
    };
    const key = JSON.stringify([positioned.when, positioned.happened]);
    let child = node.children.get(key);
    if (child === undefined) {
      child = newNode(positioned);
      node.children.set(key, child);
    }
    path.push(child);
    node = child;
  }
  return path;
}

/** Performs each step of the tree once, forking the replay where examples part. */
async function walk(node: Node, replay: Replay): Promise<void> {
  const children = [...node.children.values()];
  for (const [index, child] of children.entries()) {
    const branch = index < children.length - 1 ? await replay.fork() : replay;
    await branch.perform(child.step as Step);
    child.replayed = branch.replayed();
    await walk(child, branch);
  }
}

/** A replay as an example names its steps: one that takes the same steps under other labels shares it. */
function named(
  replayed: Replayed | undefined,
  names: readonly string[] | undefined,
): Replayed | undefined {
  if (replayed === undefined || names === undefined) return replayed;
  const steps = replayed.steps.map((done, index) => ({
    ...done,
    step: { ...done.step, name: names[index] ?? done.step.name },
  }));
  const { stopped } = replayed;
  return {
    ...replayed,
    story: { ...replayed.story, steps: steps.map(({ step }) => step) },
    steps,
    ...(stopped === undefined
      ? {}
      : {
          stopped: {
            ...stopped,
            step: {
              ...stopped.step,
              name: names[steps.length] ?? stopped.step.name,
            },
          },
        }),
  };
}

/** A store built only once something reads it; parsing needs none. */
class LazyStore implements Store {
  #made: Promise<Store> | undefined;
  readonly #make: () => Promise<Store>;
  readonly #parser: Store;

  constructor(make: () => Promise<Store>, parser: Store) {
    this.#make = make;
    this.#parser = parser;
  }

  #store(): Promise<Store> {
    this.#made ??= this.#make();
    return this.#made;
  }

  async loadTurtle(...args: Parameters<Store["loadTurtle"]>) {
    return (await this.#store()).loadTurtle(...args);
  }

  parse(...args: Parameters<Store["parse"]>) {
    return this.#parser.parse(...args);
  }

  async add(...args: Parameters<Store["add"]>) {
    return (await this.#store()).add(...args);
  }

  async select(...args: Parameters<Store["select"]>) {
    return (await this.#store()).select(...args);
  }

  async ask(...args: Parameters<Store["ask"]>) {
    return (await this.#store()).ask(...args);
  }

  async construct(...args: Parameters<Store["construct"]>) {
    return (await this.#store()).construct(...args);
  }
}

const ruleOf = (example: Example): string =>
  example.rule === undefined ? "" : `${example.rule}: `;

class Run {
  readonly #options: ConformanceOptions;
  readonly layout: Layout;
  readonly #references = new Map<string, Promise<Graph>>();
  readonly #handles = new Map<string, ReturnType<typeof Words.handlesOf>>();

  constructor(options: ConformanceOptions, layout: Layout) {
    this.#options = options;
    this.layout = layout;
  }

  compiling(people: ReadonlyMap<string, Person>): Compiling {
    const { vocabulary, newStore } = this.#options;
    return {
      vocabulary,
      people,
      references: (person) => {
        let found = this.#references.get(person.folder);
        if (found === undefined) {
          const path = `${person.folder}/references/references.ttl`;
          found = (async () => {
            const bytes = await vocabulary.read(path);
            return new Graph(
              bytes === undefined
                ? []
                : await newStore().parse(bytes, vocabulary.iri + path),
            );
          })();
          this.#references.set(person.folder, found);
        }
        return found;
      },
    };
  }

  async compile(
    steps: readonly Example["steps"][number][],
    compiling: Compiling,
  ): Promise<Compiled> {
    const compiled: Compiled = { steps: [], checks: [] };
    for (const step of steps) await compileStep(compiled, step, compiling);
    if (compiled.person === undefined)
      throw new Error("no step creates the example's pod");
    return compiled;
  }

  /** The pod as it stood at the node, under the lens, its steps named as the example names them. */
  dataset(node: Node, lens: string, names?: readonly string[]): Promise<Store> {
    const key = JSON.stringify([lens, names]);
    let found = node.datasets.get(key);
    if (found === undefined) {
      const replayed = named(node.replayed, names);
      found =
        replayed === undefined
          ? Promise.reject(new Error("the step was not replayed"))
          : replayed.stopped !== undefined
            ? Promise.reject(
                new Error(
                  `the replay stopped at step ${replayed.stopped.step.name}: ${replayed.stopped.why}`,
                ),
              )
            : dataset(
                replayed,
                replayed.steps.at(-1)?.step.name ?? "",
                lens,
                this.#options.newStore(),
                this.#options.derive,
              );
      found.catch(() => undefined);
      node.datasets.set(key, found);
    }
    return found;
  }

  async replayAll(roots: Iterable<Root>): Promise<void> {
    const options = this.#options;
    for (const { person, feature, node } of roots) {
      await walk(
        node,
        new Replay({
          story: {
            address: person.address,
            subject: person.subject,
            steps: [],
          },
          source: options.vocabulary,
          vocabulary: options.vocabulary,
          folder: person.folder,
          title: await titleOf(options.vocabulary, feature.folder),
          pod: options.newPod(person.address),
          layout: this.layout,
          newStore: options.newStore,
          importers: options.importers ?? [],
          ...(options.performers === undefined
            ? {}
            : { performers: options.performers }),
        }),
      );
    }
  }

  async #reading(planned: Planned, node: Node, lens: string): Promise<Reading> {
    const { feature, compiled } = planned;
    const vocabulary = this.#options.vocabulary;
    const replayed = named(
      node.replayed,
      compiled.steps.map(({ name }) => name),
    );
    if (replayed === undefined) throw new Error("the example was not replayed");
    if (replayed.stopped !== undefined)
      throw new Error(
        `the replay stopped at step ${replayed.stopped.step.name}: ${replayed.stopped.why}`,
      );
    const store = new LazyStore(
      () =>
        this.dataset(
          node,
          lens,
          replayed.steps.map(({ step }) => step.name),
        ),
      this.#options.newStore(),
    );
    const person = compiled.person as Person;
    let handles = this.#handles.get(feature.folder);
    if (handles === undefined) {
      handles = Words.handlesOf(vocabulary, feature.folder);
      this.#handles.set(feature.folder, handles);
    }
    const handled = await handles;
    return {
      store,
      replayed,
      person,
      vocabulary,
      folder: feature.folder,
      layout: this.layout,
      words: new Words({
        store,
        replayed,
        vocabulary,
        person,
        people: new Map([[person.name, person]]),
        folder: feature.folder,
        ...(handled === undefined ? {} : { handles: handled }),
      }),
    };
  }

  async outcome(planned: Planned): Promise<Assertion> {
    const { example, compiled, path } = planned;
    const named = { test: example.iri, name: example.name };
    const at = compiled.at ?? {
      index: compiled.steps.length - 1,
      lens: "everyday",
    };
    const node = path[at.index];
    let reading: Reading;
    try {
      if (node === undefined)
        throw new Error("the example takes no step to read the pod after");
      reading = await this.#reading(planned, node, at.lens);
    } catch (error) {
      return {
        ...named,
        outcome: "failed",
        why: `${ruleOf(example)}${failure(error)}`,
      };
    }
    for (const { text, check } of compiled.checks) {
      let why: string | undefined;
      try {
        why = await check(reading);
      } catch (error) {
        why = failure(error);
      }
      if (why !== undefined)
        return {
          ...named,
          outcome: "failed",
          why: `${ruleOf(example)}Then ${text}\n${why}`,
        };
    }
    return { ...named, outcome: "passed" };
  }
}

/**
 * Runs every example of the vocabulary's feature files, replaying each run of steps the examples share once, and each
 * kit's checks 2 to 5 over one replay of its story: one assertion per example and per check.
 */
export async function runConformance(
  options: ConformanceOptions,
): Promise<Assertion[]> {
  const { vocabulary } = options;
  const layout =
    options.layout ?? (await Layout.read(vocabulary, options.newStore));
  const run = new Run(options, layout);
  const results = new Map<string, Assertion>();
  const plans: Planned[] = [];
  const roots = new Map<string, Root>();
  const kits: {
    feature: Feature;
    person: Person;
    names: string[];
    path: Node[];
  }[] = [];
  const rootOf = (person: Person, feature: Feature): Node => {
    let root = roots.get(person.folder);
    if (root === undefined) {
      root = { person, feature, node: newNode() };
      roots.set(person.folder, root);
    }
    return root.node;
  };
  const kitFailed = (folder: string, why: string): void => {
    for (const check of Object.values(KIT_CHECKS)) {
      const test = `${vocabulary.iri}${folder}/#${check}`;
      results.set(test, { test, name: check, outcome: "failed", why });
    }
  };

  for (const path of options.features ?? (await featuresOf(vocabulary))) {
    let feature: Feature;
    try {
      feature = await readFeature(vocabulary, path);
    } catch (error) {
      const test = vocabulary.iri + path;
      results.set(test, {
        test,
        name: path,
        outcome: "failed",
        why: failure(error),
      });
      if (isKitStory(path) && options.shapes !== undefined)
        kitFailed(folderOf(path), failure(error));
      continue;
    }
    let people: Map<string, Person>;
    try {
      people = await peopleOf(
        vocabulary,
        feature.folder,
        async (turtle, base) =>
          new Graph(await options.newStore().parse(turtle, base)),
      );
    } catch (error) {
      for (const example of feature.examples)
        results.set(example.iri, {
          test: example.iri,
          name: example.name,
          outcome: "failed",
          why: `${ruleOf(example)}${failure(error)}`,
        });
      if (isKitStory(feature.path) && options.shapes !== undefined)
        kitFailed(feature.folder, failure(error));
      continue;
    }
    const compiling = run.compiling(people);
    for (const example of feature.examples) {
      try {
        const compiled = await run.compile(example.steps, compiling);
        const person = compiled.person as Person;
        plans.push({
          example,
          feature,
          compiled,
          path: grow(rootOf(person, feature), compiled.steps),
        });
        results.set(example.iri, {
          test: example.iri,
          name: example.name,
          outcome: "inapplicable",
        });
      } catch (error) {
        results.set(example.iri, {
          test: example.iri,
          name: example.name,
          outcome: "failed",
          why: `${ruleOf(example)}${failure(error)}`,
        });
      }
    }
    if (isKitStory(feature.path) && options.shapes !== undefined) {
      try {
        const story = await run.compile(feature.background, compiling);
        const person = story.person as Person;
        kits.push({
          feature,
          person,
          names: story.steps.map(({ name }) => name),
          path: grow(rootOf(person, feature), story.steps),
        });
      } catch (error) {
        kitFailed(feature.folder, failure(error));
      }
    }
  }

  await run.replayAll(roots.values());
  for (const planned of plans)
    results.set(planned.example.iri, await run.outcome(planned));
  for (const { feature, person, names, path } of kits) {
    const node = path.at(-1);
    try {
      const replayed = named(node?.replayed, names);
      if (node === undefined || replayed === undefined)
        throw new Error(`${feature.path} tells no story`);
      for (const assertion of await kitChecks({
        vocabulary,
        kit: feature.folder,
        folder: person.folder,
        replayed,
        final: await run.dataset(node, KIT_LENS, names),
        layout,
        shapes: options.shapes as Shapes,
      }))
        results.set(assertion.test, assertion);
    } catch (error) {
      kitFailed(feature.folder, failure(error));
    }
  }
  return [...results.values()];
}

/** The EARL report of the assertions, with the runtime as the subject, as N-Triples. */
export function earl(
  assertions: readonly Assertion[],
  runtime: string,
): Uint8Array {
  const subject = blank("runtime");
  const type = iri(`${RDF}type`);
  const triples: Triple[] = [
    [subject, type, iri(`${EARL}TestSubject`)],
    [subject, iri(`${DOAP}name`), literal(runtime)],
  ];
  assertions.forEach(({ test, outcome, why }, index) => {
    const assertion = blank(`assertion${index}`);
    const result = blank(`result${index}`);
    triples.push(
      [assertion, type, iri(`${EARL}Assertion`)],
      [assertion, iri(`${EARL}test`), iri(test)],
      [assertion, iri(`${EARL}subject`), subject],
      [assertion, iri(`${EARL}mode`), iri(`${EARL}automatic`)],
      [assertion, iri(`${EARL}result`), result],
      [result, type, iri(`${EARL}TestResult`)],
      [result, iri(`${EARL}outcome`), iri(EARL + outcome)],
    );
    if (why !== undefined)
      triples.push([result, iri(`${DCT}description`), literal(why)]);
  });
  return ntriples(triples);
}

/** The pod an example's steps, or a feature's background, make: whose it is and what happens to it. */
export async function storyOf(
  vocabulary: Files,
  feature: Feature,
  steps: readonly Example["steps"][number][],
  newStore: StoreFactory,
  layout: Layout,
): Promise<{ readonly person: Person; readonly steps: readonly Step[] }> {
  const run = new Run(
    { vocabulary, newStore, newPod: (address) => new MemoryFiles(address) },
    layout,
  );
  const people = await peopleOf(
    vocabulary,
    feature.folder,
    async (turtle, base) => new Graph(await newStore().parse(turtle, base)),
  );
  const compiled = await run.compile(steps, run.compiling(people));
  return { person: compiled.person as Person, steps: compiled.steps };
}
