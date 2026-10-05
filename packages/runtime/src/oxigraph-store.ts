import * as oxigraph from "oxigraph";
import { blank, iri, literal, type Term, type Triple } from "./rdf.js";
import { parseResults } from "./sparql-results.js";
import type { LoadOptions, Rows, Store } from "./store.js";

const TURTLE = "text/turtle";
const RESULTS_JSON = "application/sparql-results+json";

function fromOxigraph(term: oxigraph.Term): Term {
  switch (term.termType) {
    case "NamedNode":
      return iri(term.value);
    case "BlankNode":
      return blank(term.value);
    case "Literal":
      return term.language
        ? literal(term.value, { language: term.language })
        : literal(term.value, term.datatype.value);
    default:
      throw new Error(
        `Oxigraph gave a ${term.termType} where a triple's term was expected`,
      );
  }
}

function toOxigraph(
  term: Term,
): oxigraph.NamedNode | oxigraph.BlankNode | oxigraph.Literal {
  switch (term.termType) {
    case "NamedNode":
      return oxigraph.namedNode(term.value);
    case "BlankNode":
      return oxigraph.blankNode(term.value);
    case "Literal":
      return term.language
        ? oxigraph.literal(term.value, { language: term.language })
        : oxigraph.literal(term.value, oxigraph.namedNode(term.datatype.value));
  }
}

function graphs(
  options: LoadOptions,
): (oxigraph.NamedNode | oxigraph.DefaultGraph)[] {
  const named = oxigraph.namedNode(options.graph);
  return options.alone ? [named] : [named, oxigraph.defaultGraph()];
}

/** The Store on Oxigraph's JavaScript build. */
export class OxigraphStore implements Store {
  readonly #store = new oxigraph.Store();

  async loadTurtle(
    turtle: Uint8Array | string,
    options: LoadOptions,
  ): Promise<void> {
    const parsed = new oxigraph.Store();
    parsed.load(turtle, { format: TURTLE, base_iri: options.graph });
    const targets = graphs(options);
    for (const quad of parsed.match()) {
      for (const graph of targets) {
        this.#store.add(
          oxigraph.quad(quad.subject, quad.predicate, quad.object, graph),
        );
      }
    }
  }

  async add(triples: Iterable<Triple>, options: LoadOptions): Promise<void> {
    const targets = graphs(options);
    for (const [subject, predicate, object] of triples) {
      for (const graph of targets) {
        this.#store.add(
          oxigraph.quad(
            toOxigraph(subject) as oxigraph.NamedNode | oxigraph.BlankNode,
            oxigraph.namedNode(predicate.value),
            toOxigraph(object),
            graph,
          ),
        );
      }
    }
  }

  async select(query: string): Promise<Rows> {
    const answer = parseResults(
      this.#store.query(query, { results_format: RESULTS_JSON }) as string,
    );
    if (typeof answer === "boolean")
      throw new Error("an ASK query was run as a SELECT");
    return answer;
  }

  async ask(query: string): Promise<boolean> {
    const answer = this.#store.query(query);
    if (typeof answer !== "boolean")
      throw new Error("a query that is no ASK was run as one");
    return answer;
  }

  async construct(query: string): Promise<Triple[]> {
    const answer = this.#store.query(query);
    if (!Array.isArray(answer) || answer.some((item) => item instanceof Map)) {
      throw new Error("a query that is no CONSTRUCT was run as one");
    }
    return (answer as oxigraph.Quad[]).map((quad): Triple => [
      fromOxigraph(quad.subject) as Triple[0],
      fromOxigraph(quad.predicate) as Triple[1],
      fromOxigraph(quad.object),
    ]);
  }
}
