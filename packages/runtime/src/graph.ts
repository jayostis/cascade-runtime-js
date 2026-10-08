import { type Term, type Triple, written } from "./rdf.js";
import type { StoreFactory } from "./store.js";

type Subject = Triple[0];

/** A graph's triples in memory, each once. */
export class Graph {
  readonly triples: readonly Triple[];
  /** The triples by their subject, as `written` gives it. */
  readonly #bySubject = new Map<string, Triple[]>();

  constructor(triples: Iterable<Triple>) {
    const unique = new Map<string, Triple>();
    for (const triple of triples)
      unique.set(triple.map(written).join(" "), triple);
    this.triples = [...unique.values()];
    for (const triple of this.triples) {
      const subject = written(triple[0]);
      const held = this.#bySubject.get(subject);
      if (held === undefined) this.#bySubject.set(subject, [triple]);
      else held.push(triple);
    }
  }

  /** The triples matching each term given; an undefined term matches any. */
  match(subject?: Term, predicate?: string, object?: Term): Triple[] {
    const from =
      subject === undefined
        ? this.triples
        : (this.#bySubject.get(written(subject)) ?? []);
    return from.filter(
      ([, p, o]) =>
        (predicate === undefined || p.value === predicate) &&
        (object === undefined || written(o) === written(object)),
    );
  }

  objects(subject: Term, predicate: string): Term[] {
    return this.match(subject, predicate).map(([, , o]) => o);
  }

  subjects(predicate: string, object?: Term): Subject[] {
    const found = new Map<string, Subject>();
    for (const [s] of this.match(undefined, predicate, object))
      found.set(written(s), s);
    return [...found.values()];
  }

  /** The node's triples, and those of every blank node they lead to. */
  closure(node: Term): Triple[] {
    const found: Triple[] = [];
    const seen = new Set<string>();
    const visit = (from: Term): void => {
      if (seen.has(written(from))) return;
      seen.add(written(from));
      for (const triple of this.match(from)) {
        found.push(triple);
        if (triple[2].termType === "BlankNode") visit(triple[2]);
      }
    };
    visit(node);
    return found;
  }
}

/** The Turtle as a graph, as it writes it: no literal is rewritten, as a store would. */
export async function parseGraph(
  turtle: Uint8Array,
  base: string,
  newStore: StoreFactory,
): Promise<Graph> {
  return new Graph(await newStore().parse(turtle, base));
}
