import type { Term, Triple } from "./rdf.js";

export type Row = ReadonlyMap<string, Term>;

export interface Rows {
  readonly variables: readonly string[];
  readonly rows: readonly Row[];
}

export interface LoadOptions {
  /** The named graph the triples go in, which is also the base their relative IRIs resolve against. */
  readonly graph: string;
}

/**
 * Holds named graphs and runs SPARQL over them: a query's default graph is the union of the graphs it is given, and
 * GRAPH reads every graph the store holds.
 */
export interface Store {
  loadTurtle(turtle: Uint8Array | string, options: LoadOptions): Promise<void>;
  /** The Turtle's triples as it writes them, each literal's lexical form kept, its relative IRIs resolved against `base`. */
  parse(turtle: Uint8Array | string, base: string): Promise<Triple[]>;
  add(triples: Iterable<Triple>, options: LoadOptions): Promise<void>;
  /** Removes a graph and its triples. */
  drop(graph: string): Promise<void>;
  /** Removes from the graph every triple whose subject is one of the IRIs. */
  removeSubjects(graph: string, subjects: Iterable<string>): Promise<void>;
  select(query: string, union: ReadonlySet<string>): Promise<Rows>;
  ask(query: string, union: ReadonlySet<string>): Promise<boolean>;
  construct(query: string, union: ReadonlySet<string>): Promise<Triple[]>;
  /** For each triple, whether a graph of the union holds it. */
  holds(
    triples: readonly Triple[],
    union: ReadonlySet<string>,
  ): Promise<boolean[]>;
  /** A store of its own holding the graphs given, as this one holds them. */
  copy(graphs: ReadonlySet<string>): Promise<Store>;
  /** Releases what the store holds; a store freed is never read again. */
  free?(): void;
}

export type StoreFactory = () => Store;

/** A dataset as a query reads it: a default graph and named graphs. */
export interface Dataset {
  select(query: string): Promise<Rows>;
  ask(query: string): Promise<boolean>;
  construct(query: string): Promise<Triple[]>;
}

/**
 * A store read with the union of some of its graphs as the default graph. A graph loaded or added to through it joins
 * the union.
 */
export class Union implements Dataset {
  readonly #graphs: Set<string>;

  constructor(
    readonly store: Store,
    graphs: Iterable<string> = [],
  ) {
    this.#graphs = new Set(graphs);
  }

  get graphs(): ReadonlySet<string> {
    return this.#graphs;
  }

  async loadTurtle(turtle: Uint8Array | string, graph: string): Promise<void> {
    await this.store.loadTurtle(turtle, { graph });
    this.#graphs.add(graph);
  }

  async add(triples: Iterable<Triple>, graph: string): Promise<void> {
    await this.store.add(triples, { graph });
    this.#graphs.add(graph);
  }

  /** Removes a graph and its triples, and takes it out of the union. */
  async drop(graph: string): Promise<void> {
    await this.store.drop(graph);
    this.#graphs.delete(graph);
  }

  /** Removes from the graph every triple whose subject is one of the IRIs. */
  removeSubjects(graph: string, subjects: Iterable<string>): Promise<void> {
    return this.store.removeSubjects(graph, subjects);
  }

  select(query: string): Promise<Rows> {
    return this.store.select(query, this.#graphs);
  }

  ask(query: string): Promise<boolean> {
    return this.store.ask(query, this.#graphs);
  }

  construct(query: string): Promise<Triple[]> {
    return this.store.construct(query, this.#graphs);
  }

  holds(triples: readonly Triple[]): Promise<boolean[]> {
    return this.store.holds(triples, this.#graphs);
  }
}

/** The query's rows, each the values of its variables in order, an unbound one as "". */
export async function selected(
  dataset: Dataset,
  query: string,
): Promise<string[][]> {
  const { rows, variables } = await dataset.select(query);
  return rows.map((row) =>
    variables.map((variable) => row.get(variable)?.value ?? ""),
  );
}
