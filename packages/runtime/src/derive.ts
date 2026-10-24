import { type Files, readText, under } from "./files.js";
import { type Triple, written } from "./rdf.js";
import type { Union } from "./store.js";

export const DERIVED = "urn:cascade:derived:";
export const QUERIES = "queries/";
const CRATE = "ro-crate-metadata.json";
const DERIVATIONS = `${QUERIES}derivations`;
export const LENSES = `${QUERIES}lenses/`;

interface CrateEntity {
  readonly "@id"?: string;
  readonly position?: number;
}

function key(triple: Triple): string {
  return triple.map(written).join(" ");
}

/** What a runtime derives just before the lens that no query can: the Sames M7 leaves as they were across a table version. */
export type Keep = (union: Union) => Promise<readonly Triple[]>;

/** The term `Keep` derives, which only a lens that names it reads. */
const KEPT_TERM = "membersJoinedByCurrentTableVersion";

/** One derivation, or the lens, by its path in the vocabulary, and what it added that the store did not hold. */
export interface DerivedStep {
  readonly path: string;
  readonly added: readonly Triple[];
}

const read = new WeakMap<Files, Promise<Derivations>>();

/** The vocabulary's derivations, read once for each vocabulary. */
export function derivationsOf(vocabulary: Files): Promise<Derivations> {
  let found = read.get(vocabulary);
  if (found === undefined) {
    found = Derivations.of(vocabulary);
    read.set(vocabulary, found);
  }
  return found;
}

/** The vocabulary's derivations and lenses, read once, each with the position its crate gives it. */
export class Derivations {
  readonly #steps: readonly {
    path: string;
    query: string;
    position?: number;
  }[];

  private constructor(
    steps: readonly { path: string; query: string; position?: number }[],
  ) {
    this.#steps = steps;
  }

  static async of(vocabulary: Files): Promise<Derivations> {
    const { "@graph": graph } = JSON.parse(
      await readText(vocabulary, CRATE),
    ) as { "@graph": readonly CrateEntity[] };
    const positions = new Map(
      graph.flatMap(({ "@id": path, position }) =>
        path !== undefined && typeof position === "number"
          ? [[path, position] as const]
          : [],
      ),
    );
    const paths = [
      ...(await vocabulary.list(DERIVATIONS)),
      ...(await vocabulary.list(LENSES)),
    ].filter((path) => path.endsWith(".rq"));
    const steps = await Promise.all(
      paths.map(async (path) => {
        const position = positions.get(path);
        if (position === undefined && under(DERIVATIONS, path))
          throw new Error(`${CRATE} gives ${path} no position`);
        return { path, query: await readText(vocabulary, path), position };
      }),
    );
    return new Derivations(steps);
  }

  /** The lens's derivations, the lens among them, in the order their positions give. */
  for(lens: string): readonly { path: string; query: string }[] {
    const lensFile = `${LENSES}${lens}.rq`;
    const found = this.#steps.find(({ path }) => path === lensFile);
    if (found === undefined)
      throw new Error(`the vocabulary has no lens ${lens}`);
    if (found.position === undefined)
      throw new Error(`${CRATE} gives ${lensFile} no position`);
    return this.#steps
      .filter(({ path }) => under(DERIVATIONS, path) || path === lensFile)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }

  /**
   * Runs the lens's derivations in turn over the union, each adding to `urn:cascade:derived:<lens>`, and so to the
   * union, what it constructs that the union did not already hold; returns what each added. What `keep` gives is
   * added just before a lens that reads it, as the lens's. Given `last`, the path of one of them, stops after it.
   */
  async derive(
    union: Union,
    lens: string,
    keep?: Keep,
    last?: string,
  ): Promise<DerivedStep[]> {
    const steps = this.for(lens);
    const through =
      last === undefined
        ? steps.length
        : steps.findIndex(({ path }) => path === last) + 1;
    if (through === 0) throw new Error(`the vocabulary has no ${last}`);
    const added: DerivedStep[] = [];
    for (const { path, query } of steps.slice(0, through)) {
      const kept =
        keep !== undefined && under(LENSES, path) && query.includes(KEPT_TERM)
          ? await keep(union)
          : [];
      if (kept.length > 0) await union.add(kept, DERIVED + lens);
      const constructed = await union.construct(query);
      const held = await union.holds(constructed);
      const seen = new Set<string>();
      const fresh = constructed.filter((triple, at) => {
        if (held[at]) return false;
        const written = key(triple);
        if (seen.has(written)) return false;
        seen.add(written);
        return true;
      });
      await union.add(fresh, DERIVED + lens);
      added.push({ path, added: [...kept, ...fresh] });
    }
    return added;
  }
}
