import * as oxigraph from "oxigraph";
import { blank, iri, literal, type Term, type Triple, written } from "./rdf.js";
import { queried } from "./probe.js";
import { parseResults } from "./sparql-results.js";
import {
  type GraphFile,
  type LoadOptions,
  NotTurtle,
  type Rows,
  type Store,
} from "./store.js";

const TURTLE = "text/turtle";
const N_TRIPLES = "application/n-triples";
const RESULTS_JSON = "application/sparql-results+json";
/** The subjects one removal binds: Oxigraph's JavaScript build joins a long VALUES block in more than linear time. */
const SUBJECTS_AT_ONCE = 256;

/** Frees what Oxigraph holds in its WebAssembly memory for each object now, rather than when the object is collected. */
function free(...objects: readonly unknown[]): void {
  for (const object of objects)
    (object as { free?: () => void } | undefined)?.free?.();
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

/** What each escape of an N-Triples string stands for, but `\u` and `\U`. */
const ESCAPED: Readonly<Record<string, string>> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  '"': '"',
  "'": "'",
  "\\": "\\",
};

/** Where a blank node's label or a language tag ends. */
const ENDS = new Set([" ", "\t", "\r", "\n"]);

/** The triples of N-Triples as Oxigraph writes them: a triple a line, every IRI absolute. */
export function nTriples(text: string): Triple[] {
  const triples: Triple[] = [];
  let at = 0;
  /** The next backslash at or after `at`, looked for again only once passed: a text with none is scanned once. */
  let slash = text.indexOf("\\");
  /** The next double quote at or after `at`, looked for again only once passed, as `slash` is. */
  let quote = text.indexOf('"');
  const fail = (): never => {
    throw new Error(
      `Oxigraph wrote N-Triples this cannot read, at ${at}: ${text.slice(at, at + 80)}`,
    );
  };
  const skip = (characters: ReadonlySet<string>): void => {
    while (at < text.length && characters.has(text[at] as string)) at += 1;
  };
  const word = (): string => {
    const start = at;
    while (at < text.length && !ENDS.has(text[at] as string)) at += 1;
    return text.slice(start, at);
  };
  const until = (end: string): string => {
    const found = text.indexOf(end, at);
    if (found < 0) fail();
    const value = text.slice(at, found);
    at = found + end.length;
    return value;
  };
  const term = (): Term => {
    skip(ENDS);
    if (text[at] === "<") {
      at += 1;
      return iri(until(">"));
    }
    if (text.startsWith("_:", at)) {
      at += 2;
      return blank(word());
    }
    if (text[at] !== '"') fail();
    at += 1;
    let value = "";
    for (;;) {
      if (quote >= 0 && quote < at) quote = text.indexOf('"', at);
      if (slash >= 0 && slash < at) slash = text.indexOf("\\", at);
      if (quote < 0) fail();
      if (slash < 0 || quote < slash) {
        value += text.slice(at, quote);
        at = quote + 1;
        break;
      }
      value += text.slice(at, slash);
      const kind = text[slash + 1] as string;
      if (kind === "u" || kind === "U") {
        const digits = kind === "u" ? 4 : 8;
        value += String.fromCodePoint(
          Number.parseInt(text.slice(slash + 2, slash + 2 + digits), 16),
        );
        at = slash + 2 + digits;
      } else {
        value += ESCAPED[kind] ?? fail();
        at = slash + 2;
      }
    }
    if (text[at] === "@") {
      at += 1;
      const [language = ""] = word().split("--");
      return literal(value, { language });
    }
    if (text.startsWith("^^<", at)) {
      at += 3;
      return literal(value, until(">"));
    }
    return literal(value);
  };
  for (;;) {
    skip(ENDS);
    if (at >= text.length) return triples;
    const subject = term();
    const predicate = term();
    const object = term();
    skip(ENDS);
    if (
      text[at] !== "." ||
      subject.termType === "Literal" ||
      predicate.termType !== "NamedNode"
    )
      fail();
    at += 1;
    triples.push([subject, predicate, object] as Triple);
  }
}

const TRIG = "application/trig";
/** The bytes of Turtle one TriG call reads at most, past the file that reaches it: a call that fails reads them again. */
const BLOCKS_AT_ONCE = 4 * 1024 * 1024;
const BLOCK_END = new TextEncoder().encode("\n}\n");
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const REFUSED_IN_IRI = new Set(
  [...'<>"{}|^`\\'].map((character) => character.charCodeAt(0)),
);

/** Whether TriG can name the graph as it is written: an absolute IRI with none of the characters an IRI reference refuses. */
function namesABlock(graph: string): boolean {
  if (!SCHEME.test(graph)) return false;
  for (let index = 0; index < graph.length; index += 1) {
    const code = graph.charCodeAt(index);
    if (code <= 0x20 || REFUSED_IN_IRI.has(code)) return false;
  }
  return true;
}

const Byte = {
  Tab: 0x09,
  Newline: 0x0a,
  Return: 0x0d,
  Space: 0x20,
  Quote: 0x22,
  Hash: 0x23,
  Apostrophe: 0x27,
  Dot: 0x2e,
  Colon: 0x3a,
  Less: 0x3c,
  Greater: 0x3e,
  At: 0x40,
  Backslash: 0x5c,
  Underscore: 0x5f,
  OpenBrace: 0x7b,
  CloseBrace: 0x7d,
} as const;

const isWhite = (byte: number): boolean =>
  byte === Byte.Space ||
  byte === Byte.Tab ||
  byte === Byte.Newline ||
  byte === Byte.Return;
const isLetter = (byte: number): boolean =>
  (byte | 0x20) >= 0x61 && (byte | 0x20) <= 0x7a;
/** A byte that may continue a word, so that `prefix` or `base` before it is no keyword. */
const inWord = (byte: number | undefined): boolean =>
  byte !== undefined &&
  (isLetter(byte) ||
    (byte >= 0x30 && byte <= 0x39) ||
    byte === Byte.Underscore ||
    byte === 0x2d ||
    byte === Byte.Colon ||
    byte === Byte.Dot ||
    byte >= 0x80);

/** Whether the bytes at `at` spell the word, in either case, with no word byte after it. */
function keywordAt(bytes: Uint8Array, at: number, word: string): boolean {
  for (let index = 0; index < word.length; index += 1)
    if (((bytes[at + index] ?? 0) | 0x20) !== word.charCodeAt(index))
      return false;
  return !inWord(bytes[at + word.length]);
}

/** Whether an IRI's scheme and its colon start at `at`: an IRI without one is relative. */
function schemeAt(bytes: Uint8Array, at: number): boolean {
  if (!isLetter(bytes[at] ?? 0)) return false;
  for (let index = at + 1; index < bytes.length; index += 1) {
    const byte = bytes[index] as number;
    if (byte === Byte.Colon) return true;
    if (
      !isLetter(byte) &&
      !(byte >= 0x30 && byte <= 0x39) &&
      byte !== 0x2b &&
      byte !== 0x2d &&
      byte !== Byte.Dot
    )
      return false;
  }
  return false;
}

/**
 * Whether the Turtle reads inside a TriG graph block, among other files' blocks, as it reads alone: it labels no blank
 * node, which TriG shares across a document's blocks; it has no directive and no relative IRI, which TriG reads against
 * the document; it has no brace and no long string, and its last statement is ended, so nothing of it runs on past its
 * block. What only might be one of these makes the file read alone, as any file may be.
 */
export function readsInABlock(turtle: Uint8Array): boolean {
  if (turtle[0] === 0xef) return false;
  let previous: number = Byte.Newline;
  let last: number = Byte.Dot;
  for (let at = 0; at < turtle.length; at += 1) {
    const byte = turtle[at] as number;
    switch (byte) {
      case Byte.Hash:
        while (
          at < turtle.length &&
          turtle[at] !== Byte.Newline &&
          turtle[at] !== Byte.Return
        )
          at += 1;
        previous = Byte.Newline;
        continue;
      case Byte.Less:
        if (!schemeAt(turtle, at + 1)) return false;
        for (at += 1; turtle[at] !== Byte.Greater; at += 1) {
          const inside = turtle[at];
          if (
            inside === undefined ||
            inside === Byte.Newline ||
            inside === Byte.OpenBrace ||
            inside === Byte.CloseBrace
          )
            return false;
        }
        break;
      case Byte.Quote:
      case Byte.Apostrophe:
        if (turtle[at + 1] === byte && turtle[at + 2] === byte) return false;
        for (at += 1; turtle[at] !== byte; at += 1) {
          const inside = turtle[at];
          if (
            inside === undefined ||
            inside === Byte.Newline ||
            inside === Byte.Return
          )
            return false;
          if (inside === Byte.Backslash) at += 1;
        }
        break;
      case Byte.At:
        if (previous !== Byte.Quote && previous !== Byte.Apostrophe)
          return false;
        break;
      case Byte.Colon:
        if (previous === Byte.Underscore) return false;
        break;
      case Byte.OpenBrace:
      case Byte.CloseBrace:
        return false;
      default:
        // A dot before the word ends a statement, so `.PREFIX` is a directive, not the end of a name.
        if (
          (!inWord(previous) || previous === Byte.Dot) &&
          (keywordAt(turtle, at, "prefix") || keywordAt(turtle, at, "base"))
        )
          return false;
    }
    const ended = turtle[at] as number;
    if (!isWhite(ended)) last = ended;
    previous = ended;
  }
  return last === Byte.Dot;
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
  #freed = false;

  /** Made on first use, so a store only parsed with holds nothing in Oxigraph's memory. */
  get #store(): oxigraph.Store {
    if (this.#freed) throw new Error("the store was freed and is read again");
    return (this.#oxigraph ??= new oxigraph.Store());
  }

  /** Frees what the store holds in Oxigraph's memory now, rather than when it is collected; it is never read again. */
  free(): void {
    free(this.#oxigraph);
    this.#oxigraph = undefined;
    this.#graphs.clear();
    this.#freed = true;
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
      return queried(() =>
        this.#store.query(query, {
          ...options,
          ...(named === undefined
            ? { use_default_graph_as_union: true }
            : { default_graph: named }),
        }),
      );
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

  /**
   * Oxigraph spends about as long on each call as on the bytes of a small file, so the files whose Turtle reads the
   * same inside a TriG graph block are read in one call, each in a block named by its graph, and each other file alone.
   * A call that fails is undone and its files read alone, so the file that is no Turtle is the one refused.
   */
  async loadFiles(files: readonly GraphFile[]): Promise<void> {
    const blocks: GraphFile[] = [];
    const named = new Set<string>();
    let size = 0;
    const flush = async (): Promise<void> => {
      if (blocks.length === 0) return;
      const batch = blocks.splice(0);
      named.clear();
      size = 0;
      await this.#loadBlocks(batch);
    };
    for (const file of files) {
      if (
        !this.#graphs.has(file.graph) &&
        !named.has(file.graph) &&
        namesABlock(file.graph) &&
        readsInABlock(file.turtle)
      ) {
        blocks.push(file);
        named.add(file.graph);
        size += file.turtle.length;
        if (size >= BLOCKS_AT_ONCE) await flush();
        continue;
      }
      await flush();
      await this.#loadAlone(file);
    }
    await flush();
  }

  async #loadBlocks(files: readonly GraphFile[]): Promise<void> {
    const encoder = new TextEncoder();
    const parts = files.flatMap(({ graph, turtle }) => [
      encoder.encode(`<${graph}> {\n`),
      turtle,
      BLOCK_END,
    ]);
    const trig = new Uint8Array(
      parts.reduce((sum, part) => sum + part.length, 0),
    );
    let at = 0;
    for (const part of parts) {
      trig.set(part, at);
      at += part.length;
    }
    try {
      this.#store.load(trig, { format: TRIG });
    } catch {
      for (const { graph } of files) await this.drop(graph);
      for (const file of files) await this.#loadAlone(file);
      return;
    }
    for (const { graph } of files) this.#graphs.add(graph);
  }

  async #loadAlone({ graph, turtle }: GraphFile): Promise<void> {
    try {
      await this.loadTurtle(turtle, { graph });
    } catch (error) {
      throw new NotTurtle(graph, error);
    }
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

  /**
   * Each graph read out as Oxigraph's N-Triples before this store is freed, so the new one fills the memory it held:
   * the lines without a blank node loaded as Oxigraph wrote them, without checks, and the others added a triple at a
   * time, since a load names its blank nodes afresh.
   */
  async renewed(): Promise<Store> {
    const renewed = new OxigraphStore();
    const store = this.#oxigraph;
    const graphs: { graph: string; ground: string; blank: string }[] = [];
    for (const graph of this.#graphs) {
      renewed.#graphs.add(graph);
      if (store === undefined) continue;
      const name = oxigraph.namedNode(graph);
      let dumped: string;
      try {
        dumped = store.dump({ format: N_TRIPLES, from_graph_name: name });
      } finally {
        free(name);
      }
      if (!dumped.includes("_:")) {
        graphs.push({ graph, ground: dumped, blank: "" });
        continue;
      }
      const ground: string[] = [];
      const blank: string[] = [];
      for (const line of dumped.split("\n"))
        if (line !== "") (line.includes("_:") ? blank : ground).push(line);
      graphs.push({
        graph,
        ground: ground.length === 0 ? "" : `${ground.join("\n")}\n`,
        blank: blank.length === 0 ? "" : `${blank.join("\n")}\n`,
      });
    }
    this.free();
    try {
      await renewed.#fill(graphs);
    } catch (error) {
      renewed.free();
      throw error;
    }
    return renewed;
  }

  async #fill(
    graphs: readonly { graph: string; ground: string; blank: string }[],
  ): Promise<void> {
    for (const { graph, ground, blank } of graphs) {
      if (ground !== "") {
        const name = oxigraph.namedNode(graph);
        try {
          this.#store.load(ground, {
            format: N_TRIPLES,
            to_graph_name: name,
            lenient: true,
          });
        } finally {
          free(name);
        }
      }
      if (blank !== "") await this.add(nTriples(blank), { graph });
    }
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

  /**
   * Read as Oxigraph writes the triples in N-Triples, one string: as an array of quads each would be an object in its
   * WebAssembly memory until freed, and a large answer would grow that memory a step at a time, V8 collecting the whole
   * heap at each step.
   */
  async construct(
    query: string,
    union: ReadonlySet<string>,
  ): Promise<Triple[]> {
    const answer = this.#query(query, union, { results_format: N_TRIPLES });
    if (typeof answer !== "string")
      throw new Error("a query that is no CONSTRUCT was run as one");
    return nTriples(answer);
  }
}
