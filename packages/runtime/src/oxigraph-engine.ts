import * as oxigraph from "oxigraph";

/** A term as an engine gives and takes it, in RDF/JS's shape. */
export interface EngineTerm {
  readonly termType: string;
  readonly value: string;
  readonly language?: string;
  readonly datatype?: EngineTerm;
}

export interface EngineQuad {
  readonly subject: EngineTerm;
  readonly predicate: EngineTerm;
  readonly object: EngineTerm;
  readonly graph: EngineTerm;
}

export interface EngineParseOptions {
  readonly format: string;
  readonly base_iri?: string;
  readonly to_graph_name?: EngineTerm;
  readonly lenient?: boolean;
}

/** The calls `OxigraphStore` makes of an Oxigraph store, as the `oxigraph` package names them. */
export interface EngineStore {
  readonly size: number;
  load(data: string | Uint8Array, options: EngineParseOptions): void;
  /** A SELECT's or a CONSTRUCT's answer in the `results_format` given, which they are always given; an ASK's as a boolean. */
  query(
    query: string,
    options: {
      readonly results_format?: string;
      readonly use_default_graph_as_union?: boolean;
      readonly default_graph?: readonly EngineTerm[];
    },
  ): unknown;
  update(update: string): void;
  dump(options: {
    readonly format: string;
    readonly from_graph_name?: EngineTerm;
  }): string;
  add(quad: EngineQuad): void;
  match(
    subject: EngineTerm | null,
    predicate: EngineTerm | null,
    object: EngineTerm | null,
    graph: EngineTerm | null,
  ): EngineQuad[];
  free?(): void;
}

/** An Oxigraph build: the `oxigraph` package's WebAssembly, or the same Oxigraph built for Node from native/oxigraph. */
export interface OxigraphEngine {
  readonly name: "wasm" | "native";
  namedNode(value: string): EngineTerm;
  blankNode(value: string): EngineTerm;
  literal(
    value: string,
    languageOrDatatype: { readonly language: string } | EngineTerm,
  ): EngineTerm;
  quad(
    subject: EngineTerm,
    predicate: EngineTerm,
    object: EngineTerm,
    graph: EngineTerm,
  ): EngineQuad;
  parse(data: string | Uint8Array, options: EngineParseOptions): EngineQuad[];
  newStore(): EngineStore;
}

/** The `oxigraph` package's WebAssembly build, which runs wherever the runtime does. */
export const wasmOxigraph: OxigraphEngine = {
  name: "wasm",
  namedNode: oxigraph.namedNode,
  blankNode: oxigraph.blankNode,
  literal: (value, languageOrDatatype) =>
    oxigraph.literal(
      value,
      languageOrDatatype as oxigraph.NamedNode | { language: string },
    ),
  quad: (subject, predicate, object, graph) =>
    oxigraph.quad(
      subject as oxigraph.Quad_Subject,
      predicate as oxigraph.Quad_Predicate,
      object as oxigraph.Quad_Object,
      graph as oxigraph.Quad_Graph,
    ),
  parse: (data, options) =>
    oxigraph.parse(data, options as Parameters<typeof oxigraph.parse>[1]),
  newStore: () => new oxigraph.Store() as unknown as EngineStore,
};

let chosen: OxigraphEngine | undefined;
let choose: () => OxigraphEngine = () => wasmOxigraph;

/**
 * The engine a store made without one uses: the one `useOxigraph` named, else the one its chooser returns when a store
 * first asks, else the WebAssembly build. Node's entry names a chooser that prefers the native build where it loads.
 */
export function usedOxigraph(): OxigraphEngine {
  return (chosen ??= choose());
}

/** Makes the engine, or the chooser that returns it when a store first asks, the one every store made later uses. */
export function useOxigraph(
  engine: OxigraphEngine | (() => OxigraphEngine),
): void {
  if (typeof engine === "function") {
    choose = engine;
    chosen = undefined;
  } else chosen = engine;
}
