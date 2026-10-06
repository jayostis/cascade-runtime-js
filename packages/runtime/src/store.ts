import type { Term, Triple } from "./rdf.js";

export type Row = ReadonlyMap<string, Term>;

export interface Rows {
  readonly variables: readonly string[];
  readonly rows: readonly Row[];
}

export interface LoadOptions {
  /** The named graph the triples go in, which is also the base their relative IRIs resolve against. */
  readonly graph: string;
  /** When true, the triples are in that graph alone; otherwise they are in the default graph as well. */
  readonly alone?: boolean;
}

/**
 * Runs SPARQL over named graphs. A query reads the default graph, which holds what was loaded or added without
 * `alone`, and every named graph through GRAPH.
 */
export interface Store {
  loadTurtle(turtle: Uint8Array | string, options: LoadOptions): Promise<void>;
  /** The Turtle's triples as it writes them, each literal's lexical form kept, its relative IRIs resolved against `base`. */
  parse(turtle: Uint8Array | string, base: string): Promise<Triple[]>;
  add(triples: Iterable<Triple>, options: LoadOptions): Promise<void>;
  select(query: string): Promise<Rows>;
  ask(query: string): Promise<boolean>;
  construct(query: string): Promise<Triple[]>;
}

export type StoreFactory = () => Store;

/** The query's rows, each the values of its variables in order, an unbound one as "". */
export async function selected(
  store: Store,
  query: string,
): Promise<string[][]> {
  const { rows, variables } = await store.select(query);
  return rows.map((row) =>
    variables.map((variable) => row.get(variable)?.value ?? ""),
  );
}
