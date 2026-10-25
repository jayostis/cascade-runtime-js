import { iri, type Term, type Triple, written } from "./rdf.js";

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
  /** A store of its own holding every graph this one lists, each blank node under the label it has here. */
  copy(): Promise<Store>;
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

/**
 * A union over another's store, changed for a while and then put back: each graph it first drops or changes is read as
 * the store holds it, and `restore` drops every graph changed and adds back what each held. A triple added names its
 * blank node by its label, so each blank node put back is the node it was, where a load would name it afresh. A graph
 * of the union that held nothing is named again, so the store lists the graphs the union does. Once restored, the union
 * is never read or changed again.
 */
export class RestorableUnion extends Union {
  readonly #before = new Map<
    string,
    { readonly triples: readonly Triple[]; readonly inUnion: boolean }
  >();
  #added = 0;
  #moved = 0;
  #restored = false;

  /** The quads the store has had removed and added again, or added and removed, by the restores so far. */
  get moved(): number {
    return this.#moved;
  }

  #open(): void {
    if (this.#restored)
      throw new Error("the union was restored and is used again");
  }

  async #keep(graph: string): Promise<void> {
    this.#open();
    if (this.#before.has(graph)) return;
    this.#before.set(graph, {
      triples: await this.store.construct(
        `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH ${written(iri(graph))} { ?s ?p ?o } }`,
        new Set(),
      ),
      inUnion: this.graphs.has(graph),
    });
  }

  override async loadTurtle(
    turtle: Uint8Array | string,
    graph: string,
  ): Promise<void> {
    await this.#keep(graph);
    await super.loadTurtle(turtle, graph);
  }

  override async add(triples: Iterable<Triple>, graph: string): Promise<void> {
    await this.#keep(graph);
    const all = [...triples];
    this.#added += all.length;
    await super.add(all, graph);
  }

  override async drop(graph: string): Promise<void> {
    await this.#keep(graph);
    await super.drop(graph);
  }

  override async removeSubjects(
    graph: string,
    subjects: Iterable<string>,
  ): Promise<void> {
    await this.#keep(graph);
    await super.removeSubjects(graph, subjects);
  }

  override async select(query: string): Promise<Rows> {
    this.#open();
    return super.select(query);
  }

  override async ask(query: string): Promise<boolean> {
    this.#open();
    return super.ask(query);
  }

  override async construct(query: string): Promise<Triple[]> {
    this.#open();
    return super.construct(query);
  }

  override async holds(triples: readonly Triple[]): Promise<boolean[]> {
    this.#open();
    return super.holds(triples);
  }

  /** Puts the store back as it held each graph changed, and retires the union. */
  async restore(): Promise<void> {
    this.#open();
    this.#restored = true;
    this.#moved += this.#added;
    for (const [graph, { triples, inUnion }] of this.#before) {
      await this.store.drop(graph);
      if (triples.length > 0) await this.store.add(triples, { graph });
      else if (inUnion) await this.store.loadTurtle("", { graph });
      this.#moved += triples.length;
    }
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
