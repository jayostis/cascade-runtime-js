import { differences } from "./compare.js";
import type { Derive } from "./build.js";
import { dataset } from "./dataset.js";
import { type Files, folderOf, readText, relative } from "./files.js";
import type { Importer } from "./importer.js";
import { Layout } from "./layout.js";
import { type ManifestEntry, readManifest, REPLAY_TEST } from "./manifest.js";
import { blank, iri, literal, ntriples, RDF, type Triple } from "./rdf.js";
import { type Replayed, replay } from "./replay.js";
import { parseResults } from "./sparql-results.js";
import type { Performers } from "./step.js";
import type { Store, StoreFactory } from "./store.js";
import { parseStory } from "./story.js";

const EARL = "http://www.w3.org/ns/earl#";
const DOAP = "http://usefulinc.com/ns/doap#";
const DCT = "http://purl.org/dc/terms/";
const LENS = /^queries\/v1-draft\/lenses\/([^/]+)\.rq$/;

export type Outcome = "passed" | "failed" | "inapplicable";

export interface Assertion {
  readonly entry: ManifestEntry;
  readonly outcome: Outcome;
  readonly why?: string;
}

export interface ConformanceOptions {
  /** The vocabulary, named by its tree's IRI, which the manifest and every file it names are under. */
  readonly vocabulary: Files;
  /** The manifest's path in the vocabulary. */
  readonly manifest: string;
  readonly newStore: StoreFactory;
  /** An empty pod at the address, for a story to be replayed into. */
  readonly newPod: (address: string) => Files;
  readonly importers?: readonly Importer[];
  readonly performers?: Performers;
  readonly derive?: Derive;
  /** The vocabulary's layout, when already read. */
  readonly layout?: Layout;
}

function required(
  entry: ManifestEntry,
  key: "story" | "step" | "lens" | "query" | "result",
): string {
  const value = entry[key];
  if (value === undefined) throw new Error(`the entry gives no ${key}`);
  return value;
}

/** Runs every entry of a manifest of replayed stories, replaying each story once and building each dataset once. */
export async function runManifest(
  options: ConformanceOptions,
): Promise<Assertion[]> {
  const { vocabulary } = options;
  let layout: Promise<Layout> | undefined;
  const replays = new Map<string, Promise<Replayed>>();
  const datasets = new Map<string, Promise<Store>>();

  const replayed = (story: string): Promise<Replayed> => {
    let found = replays.get(story);
    if (found === undefined) {
      found = (async () => {
        const parsed = parseStory(await readText(vocabulary, story));
        return replay({
          story: parsed,
          source: vocabulary,
          folder: folderOf(story),
          pod: options.newPod(parsed.address),
          layout: await (layout ??=
            options.layout === undefined
              ? Layout.read(vocabulary, options.newStore)
              : Promise.resolve(options.layout)),
          newStore: options.newStore,
          importers: options.importers,
          performers: options.performers,
        });
      })();
      replays.set(story, found);
    }
    return found;
  };

  const built = async (entry: ManifestEntry): Promise<Store> => {
    const story = relative(vocabulary, required(entry, "story"));
    const lensFile = relative(vocabulary, required(entry, "lens"));
    const lens = LENS.exec(lensFile)?.[1];
    if (lens === undefined || (await vocabulary.read(lensFile)) === undefined) {
      throw new Error(`${lensFile} is no lens's query file`);
    }
    const step = required(entry, "step");
    const key = JSON.stringify([story, step, lens]);
    let found = datasets.get(key);
    if (found === undefined) {
      found = replayed(story).then((done) =>
        dataset(done, step, lens, options.newStore(), options.derive),
      );
      datasets.set(key, found);
    }
    return found;
  };

  const outcome = async (entry: ManifestEntry): Promise<Assertion> => {
    if (!entry.types.includes(REPLAY_TEST)) {
      return {
        entry,
        outcome: "inapplicable",
        why: `${entry.types.join(", ") || "no type"} is no type this runner knows`,
      };
    }
    try {
      const store = await built(entry);
      const query = await readText(
        vocabulary,
        relative(vocabulary, required(entry, "query")),
      );
      const expected = parseResults(
        await readText(
          vocabulary,
          relative(vocabulary, required(entry, "result")),
        ),
      );
      if (typeof expected === "boolean") {
        const found = await store.ask(query);
        return found === expected
          ? { entry, outcome: "passed" }
          : {
              entry,
              outcome: "failed",
              why: `expected ${expected}, found ${found}`,
            };
      }
      const why = differences(expected, await store.select(query));
      return why === undefined
        ? { entry, outcome: "passed" }
        : { entry, outcome: "failed", why };
    } catch (error) {
      return {
        entry,
        outcome: "failed",
        why: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const assertions: Assertion[] = [];
  for (const entry of await readManifest(
    vocabulary,
    options.manifest,
    options.newStore,
  )) {
    assertions.push(await outcome(entry));
  }
  return assertions;
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
  assertions.forEach(({ entry, outcome, why }, index) => {
    const assertion = blank(`assertion${index}`);
    const result = blank(`result${index}`);
    triples.push(
      [assertion, type, iri(`${EARL}Assertion`)],
      [assertion, iri(`${EARL}test`), iri(entry.iri)],
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
