import * as oxigraph from "oxigraph";
import { blank, iri, literal, type Term, type Triple, written } from "./rdf.js";
import { parseResults } from "./sparql-results.js";
import type { LoadOptions, Rows, Store } from "./store.js";

const TURTLE = "text/turtle";
const N_TRIPLES = "application/n-triples";
const RESULTS_JSON = "application/sparql-results+json";
/** The subjects one removal binds: Oxigraph's JavaScript build joins a long VALUES block in more than linear time. */
const SUBJECTS_AT_ONCE = 256;

/** Frees what Oxigraph holds in its WebAssembly memory for each object now, rather than when the object is collected. */
function free(...objects: readonly unknown[]): void {
  for (const object of objects) (object as { free?: () => void }).free?.();
}

function fromOxigraph(term: oxigraph.Term): Term {
  try {
    switch (term.termType) {
      case "NamedNode":
        return iri(term.value);
      case "BlankNode":
        return blank(term.value);
      case "Literal": {
        if (term.language)
          return literal(term.value, { language: term.language });
        const datatype = term.datatype;
        try {
          return literal(term.value, datatype.value);
        } finally {
          free(datatype);
        }
      }
      default:
        throw new Error(
          `Oxigraph gave a ${term.termType} where a triple's term was expected`,
        );
    }
  } finally {
    free(term);
  }
}

/** The quad's triple, the quad and its terms freed. */
function tripleOf(quad: oxigraph.Quad): Triple {
  try {
    return [
      fromOxigraph(quad.subject) as Triple[0],
      fromOxigraph(quad.predicate) as Triple[1],
      fromOxigraph(quad.object),
    ];
  } finally {
    free(quad);
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
    case "Literal": {
      if (term.language)
        return oxigraph.literal(term.value, { language: term.language });
      const datatype = oxigraph.namedNode(term.datatype.value);
      try {
        return oxigraph.literal(term.value, datatype);
      } finally {
        free(datatype);
      }
    }
  }
}

/** The Store on Oxigraph's JavaScript build. */
export class OxigraphStore implements Store {
  #oxigraph: oxigraph.Store | undefined;
  readonly #graphs = new Set<string>();

  /** Made on first use, so a store only parsed with holds nothing in Oxigraph's memory. */
  get #store(): oxigraph.Store {
    return (this.#oxigraph ??= new oxigraph.Store());
  }

  /** Frees what the store holds in Oxigraph's memory now, rather than when it is collected. */
  free(): void {
    free(this.#oxigraph);
    this.#oxigraph = undefined;
    this.#graphs.clear();
  }

  [Symbol.dispose](): void {
    this.free();
  }

  /**
   * Oxigraph reads the union of every graph it holds about as fast as one graph, and a union it is given as a list
   * many times slower, so a union naming every graph held is read as the former.
   */
  #query(
    query: string,
    union: ReadonlySet<string>,
    options: { results_format?: string } = {},
  ): ReturnType<oxigraph.Store["query"]> {
    let named: oxigraph.NamedNode[] | undefined;
    for (const graph of this.#graphs)
      if (!union.has(graph)) {
        named = [...union].map((graph) => oxigraph.namedNode(graph));
        break;
      }
    try {
      return this.#store.query(query, {
        ...options,
        ...(named === undefined
          ? { use_default_graph_as_union: true }
          : { default_graph: named }),
      });
    } finally {
      free(...(named ?? []));
    }
  }

  async loadTurtle(
    turtle: Uint8Array | string,
    options: LoadOptions,
  ): Promise<void> {
    const graph = oxigraph.namedNode(options.graph);
    try {
      this.#store.load(turtle, {
        format: TURTLE,
        base_iri: options.graph,
        to_graph_name: graph,
      });
    } finally {
      free(graph);
    }
    this.#graphs.add(options.graph);
  }

  async parse(turtle: Uint8Array | string, base: string): Promise<Triple[]> {
    return oxigraph
      .parse(turtle, { format: TURTLE, base_iri: base })
      .map(tripleOf);
  }

  async add(triples: Iterable<Triple>, options: LoadOptions): Promise<void> {
    const graph = oxigraph.namedNode(options.graph);
    const ground: string[] = [];
    let any = false;
    try {
      for (const triple of triples) {
        any = true;
        const [subject, predicate, object] = triple;
        if (
          subject.termType !== "BlankNode" &&
          object.termType !== "BlankNode"
        ) {
          ground.push(`${triple.map(written).join(" ")} .\n`);
          continue;
        }
        const terms = [
          toOxigraph(subject),
          oxigraph.namedNode(predicate.value),
          toOxigraph(object),
        ] as const;
        const quad = oxigraph.quad(
          terms[0] as oxigraph.NamedNode | oxigraph.BlankNode,
          terms[1],
          terms[2],
          graph,
        );
        this.#store.add(quad);
        free(quad, ...terms);
      }
      if (ground.length > 0) {
        this.#store.load(ground.join(""), {
          format: N_TRIPLES,
          to_graph_name: graph,
        });
      }
    } finally {
      free(graph);
    }
    if (any) this.#graphs.add(options.graph);
  }

  async drop(graph: string): Promise<void> {
    if (this.#oxigraph === undefined) return;
    this.#oxigraph.update(`DROP SILENT GRAPH ${written(iri(graph))}`);
    this.#graphs.delete(graph);
  }

  async removeSubjects(
    graph: string,
    subjects: Iterable<string>,
  ): Promise<void> {
    if (this.#oxigraph === undefined) return;
    const all = [...new Set(subjects)];
    const named = written(iri(graph));
    for (let start = 0; start < all.length; start += SUBJECTS_AT_ONCE) {
      const values = all
        .slice(start, start + SUBJECTS_AT_ONCE)
        .map((subject) => written(iri(subject)))
        .join(" ");
      this.#oxigraph.update(
        `DELETE { GRAPH ${named} { ?s ?p ?o } } WHERE { GRAPH ${named} { VALUES ?s { ${values} } ?s ?p ?o } }`,
      );
    }
  }

  async select(query: string, union: ReadonlySet<string>): Promise<Rows> {
    const answer = parseResults(
      this.#query(query, union, { results_format: RESULTS_JSON }) as string,
    );
    if (typeof answer === "boolean")
      throw new Error("an ASK query was run as a SELECT");
    return answer;
  }

  async ask(query: string, union: ReadonlySet<string>): Promise<boolean> {
    const answer = this.#query(query, union);
    if (typeof answer !== "boolean")
      throw new Error("a query that is no ASK was run as one");
    return answer;
  }

  async holds(
    triples: readonly Triple[],
    union: ReadonlySet<string>,
  ): Promise<boolean[]> {
    return triples.map(([subject, predicate, object]) => {
      const terms = [
        toOxigraph(subject),
        oxigraph.namedNode(predicate.value),
        toOxigraph(object),
      ] as const;
      const quads = this.#store.match(
        terms[0] as oxigraph.NamedNode | oxigraph.BlankNode,
        terms[1],
        terms[2],
        null,
      );
      const held = quads.some((quad) => {
        const graph = quad.graph;
        try {
          return graph.termType === "NamedNode" && union.has(graph.value);
        } finally {
          free(graph);
        }
      });
      free(...terms, ...quads);
      return held;
    });
  }

  async construct(
    query: string,
    union: ReadonlySet<string>,
  ): Promise<Triple[]> {
    const answer = this.#query(query, union);
    if (!Array.isArray(answer) || answer.some((item) => item instanceof Map)) {
      throw new Error("a query that is no CONSTRUCT was run as one");
    }
    return (answer as oxigraph.Quad[]).map(tripleOf);
  }
}
