import { type Files, readText, under } from "./files.js";
import { type Triple, written } from "./rdf.js";
import type { Store } from "./store.js";

export const DERIVED = "urn:cascade:derived:";
export const QUERIES = "queries/v1-draft/";
const CRATE = "ro-crate-metadata.json";
const DERIVATIONS = `${QUERIES}derivations`;
const LENSES = `${QUERIES}lenses/`;

interface CrateEntity {
  readonly "@id"?: string;
  readonly position?: number;
}

function key(triple: Triple): string {
  return triple.map(written).join(" ");
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
   * Runs the lens's derivations in turn over the store's default graph, each adding what it constructs that the store
   * did not already hold, and puts all they added in `urn:cascade:derived:<lens>` as well; returns those triples.
   */
  async derive(store: Store, lens: string): Promise<Triple[]> {
    const { rows } = await store.select("SELECT ?s ?p ?o WHERE { ?s ?p ?o }");
    const held = new Set(
      rows.map((row) =>
        ["s", "p", "o"]
          .map((name) => {
            const term = row.get(name);
            if (term === undefined)
              throw new Error("a triple of the default graph lacks a term");
            return written(term);
          })
          .join(" "),
      ),
    );
    const added: Triple[] = [];
    for (const { query } of this.for(lens)) {
      const fresh: Triple[] = [];
      for (const triple of await store.construct(query)) {
        if (held.has(key(triple))) continue;
        held.add(key(triple));
        fresh.push(triple);
      }
      await store.add(fresh, { graph: DERIVED + lens });
      added.push(...fresh);
    }
    return added;
  }
}
