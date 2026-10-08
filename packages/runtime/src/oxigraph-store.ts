import * as oxigraph from "oxigraph";
import { blank, iri, literal, type Term, type Triple, written } from "./rdf.js";
import { parseResults } from "./sparql-results.js";
import type { LoadOptions, Rows, Store } from "./store.js";

const TURTLE = "text/turtle";
const N_TRIPLES = "application/n-triples";
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

/** The Store on Oxigraph's JavaScript build. */
export class OxigraphStore implements Store {
  readonly #store = new oxigraph.Store();
  readonly #graphs = new Set<string>();

  /**
   * Oxigraph reads the union of every graph it holds about as fast as one graph, and a union it is given as a list
   * many times slower, so a union naming every graph held is read as the former.
   */
  #over(
    union: ReadonlySet<string>,
  ):
    | { use_default_graph_as_union: true }
    | { default_graph: oxigraph.NamedNode[] } {
    for (const graph of this.#graphs)
      if (!union.has(graph))
        return {
          default_graph: [...union].map((graph) => oxigraph.namedNode(graph)),
        };
    return { use_default_graph_as_union: true };
  }

  async loadTurtle(
    turtle: Uint8Array | string,
    options: LoadOptions,
  ): Promise<void> {
    this.#store.load(turtle, {
      format: TURTLE,
      base_iri: options.graph,
      to_graph_name: oxigraph.namedNode(options.graph),
    });
    this.#graphs.add(options.graph);
  }

  async parse(turtle: Uint8Array | string, base: string): Promise<Triple[]> {
    return oxigraph
      .parse(turtle, { format: TURTLE, base_iri: base })
      .map((quad): Triple => [
        fromOxigraph(quad.subject) as Triple[0],
        fromOxigraph(quad.predicate) as Triple[1],
        fromOxigraph(quad.object),
      ]);
  }

  async add(triples: Iterable<Triple>, options: LoadOptions): Promise<void> {
    const graph = oxigraph.namedNode(options.graph);
    const ground: string[] = [];
    let any = false;
    for (const triple of triples) {
      any = true;
      const [subject, predicate, object] = triple;
      if (subject.termType !== "BlankNode" && object.termType !== "BlankNode") {
        ground.push(`${triple.map(written).join(" ")} .\n`);
        continue;
      }
      this.#store.add(
        oxigraph.quad(
          toOxigraph(subject) as oxigraph.NamedNode | oxigraph.BlankNode,
          oxigraph.namedNode(predicate.value),
          toOxigraph(object),
          graph,
        ),
      );
    }
    if (ground.length > 0) {
      this.#store.load(ground.join(""), {
        format: N_TRIPLES,
        to_graph_name: graph,
      });
    }
    if (any) this.#graphs.add(options.graph);
  }

  async select(query: string, union: ReadonlySet<string>): Promise<Rows> {
    const answer = parseResults(
      this.#store.query(query, {
        results_format: RESULTS_JSON,
        ...this.#over(union),
      }) as string,
    );
    if (typeof answer === "boolean")
      throw new Error("an ASK query was run as a SELECT");
    return answer;
  }

  async ask(query: string, union: ReadonlySet<string>): Promise<boolean> {
    const answer = this.#store.query(query, this.#over(union));
    if (typeof answer !== "boolean")
      throw new Error("a query that is no ASK was run as one");
    return answer;
  }

  async construct(
    query: string,
    union: ReadonlySet<string>,
  ): Promise<Triple[]> {
    const answer = this.#store.query(query, this.#over(union));
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
