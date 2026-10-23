import {
  iri,
  type BlankNode,
  type NamedNode,
  type Term,
  type Triple,
  written,
} from "./rdf.js";
import type { Store } from "./store.js";

const SH = "http://www.w3.org/ns/shacl#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SUBCLASS_OF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const CLASSES = new Set([
  "http://www.w3.org/2000/01/rdf-schema#Class",
  "http://www.w3.org/2002/07/owl#Class",
]);
const VALIDATORS = new Set(
  ["validator", "nodeValidator", "propertyValidator"].map((name) => SH + name),
);
const PRE_BOUND = new Set(["this", "currentShape", "shapesGraph"]);
const NOT_PRE_BINDABLE = new Set(["VALUES", "MINUS", "SERVICE"]);

/** A result of one SPARQL-based constraint, as the core constraints' results are given. */
export interface SparqlResult {
  readonly focusNode: Term;
  readonly path: Term | undefined;
  readonly severity: NamedNode;
  readonly sourceShape: Term;
  readonly sourceConstraintComponent: NamedNode;
  readonly message: readonly string[];
}

export interface SparqlConstraint {
  readonly shape: NamedNode | BlankNode;
  readonly classes: readonly string[];
  readonly subjectsOf: readonly string[];
  readonly objectsOf: readonly string[];
  readonly nodes: readonly Term[];
  readonly prologue: string;
  readonly select: readonly Token[];
  readonly messages: readonly string[];
  readonly severity: NamedNode;
}

type Token =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "variable";
      readonly name: string;
      readonly projected: boolean;
    };

function refuse(why: string): never {
  throw new Error(`The runtime does not run this SHACL-SPARQL: ${why}`);
}

class Graph {
  readonly #bySubject = new Map<string, Triple[]>();
  readonly #objects = new Set<string>();

  constructor(readonly triples: readonly Triple[]) {
    for (const triple of triples) {
      const key = written(triple[0]);
      const known = this.#bySubject.get(key);
      if (known === undefined) this.#bySubject.set(key, [triple]);
      else known.push(triple);
      this.#objects.add(written(triple[2]));
    }
  }

  objects(subject: Term, predicate: string): Term[] {
    return (this.#bySubject.get(written(subject)) ?? [])
      .filter(([, p]) => p.value === predicate)
      .map(([, , o]) => o);
  }

  isObject(term: Term): boolean {
    return this.#objects.has(written(term));
  }

  isTrue(subject: Term, predicate: string): boolean {
    return this.objects(subject, predicate).some(
      (o) =>
        o.termType === "Literal" && (o.value === "true" || o.value === "1"),
    );
  }
}

/**
 * The shapes without their SPARQL-based constraints, and those constraints, each checked to be one the runtime runs:
 * an `sh:select` on a node shape reached only by its own targets, not using `$shapesGraph`.
 */
export function takeSparqlConstraints(shapes: readonly Triple[]): {
  readonly rest: Triple[];
  readonly constraints: SparqlConstraint[];
} {
  const graph = new Graph(shapes);
  const constraints: SparqlConstraint[] = [];
  for (const [subject, predicate, object] of shapes) {
    if (VALIDATORS.has(predicate.value))
      refuse(
        `${written(subject)} is a SPARQL-based constraint component, which is not run`,
      );
    if (predicate.value !== `${SH}sparql`) continue;
    const constraint = read(graph, subject, object);
    if (constraint !== undefined) constraints.push(constraint);
  }
  return {
    rest: shapes.filter(([, p]) => p.value !== `${SH}sparql`),
    constraints,
  };
}

function read(
  graph: Graph,
  shape: NamedNode | BlankNode,
  node: Term,
): SparqlConstraint | undefined {
  const name = written(shape);
  if (graph.objects(shape, `${SH}path`).length > 0)
    refuse(`${name} is a property shape with sh:sparql`);
  if (graph.isObject(shape))
    refuse(
      `${name} has sh:sparql and another shape uses it, so its targets are not all its focus nodes`,
    );
  if (
    graph.objects(shape, `${SH}target`).length > 0 ||
    graph.objects(shape, RDF_TYPE).some(({ value }) => CLASSES.has(value))
  )
    refuse(`${name} has sh:sparql and a target other than SHACL Core's four`);
  const [select, ...more] = graph.objects(node, `${SH}select`);
  if (
    more.length > 0 ||
    select?.termType !== "Literal" ||
    graph.objects(node, `${SH}ask`).length > 0
  )
    refuse(`a constraint of ${name} has no single sh:select`);
  if (graph.isTrue(shape, `${SH}deactivated`)) return undefined;
  if (graph.isTrue(node, `${SH}deactivated`)) return undefined;

  const { tokens, keywords } = tokenize(select.value);
  for (const [index, token] of tokens.entries()) {
    if (token.kind !== "variable") continue;
    if (token.name === "shapesGraph")
      refuse(`a constraint of ${name} uses $shapesGraph`);
    if (
      PRE_BOUND.has(token.name) &&
      /\bAS\s*$/i.test(textBefore(tokens, index))
    )
      refuse(`a constraint of ${name} assigns the pre-bound ?${token.name}`);
  }
  for (const keyword of keywords)
    if (NOT_PRE_BINDABLE.has(keyword))
      refuse(`a constraint of ${name} uses ${keyword}`);
  if (
    shape.termType === "BlankNode" &&
    tokens.some((t) => t.kind === "variable" && t.name === "currentShape")
  )
    refuse(`a constraint of blank shape ${name} uses $currentShape`);

  const [severity] = [
    ...graph.objects(node, `${SH}severity`),
    ...graph.objects(shape, `${SH}severity`),
  ];
  return {
    shape,
    classes: graph.objects(shape, `${SH}targetClass`).map(({ value }) => value),
    subjectsOf: graph
      .objects(shape, `${SH}targetSubjectsOf`)
      .map(({ value }) => value),
    objectsOf: graph
      .objects(shape, `${SH}targetObjectsOf`)
      .map(({ value }) => value),
    nodes: graph.objects(shape, `${SH}targetNode`),
    prologue: prologue(graph, node, name),
    select: substitute(tokens, "currentShape", shape),
    messages: graph.objects(node, `${SH}message`).map(({ value }) => value),
    severity:
      severity?.termType === "NamedNode" ? severity : iri(`${SH}Violation`),
  };
}

function prologue(graph: Graph, node: Term, name: string): string {
  const declared = new Map<string, string>();
  for (const declaring of graph.objects(node, `${SH}prefixes`))
    for (const declaration of graph.objects(declaring, `${SH}declare`)) {
      const [prefix] = graph.objects(declaration, `${SH}prefix`);
      const [namespace] = graph.objects(declaration, `${SH}namespace`);
      if (prefix === undefined || namespace === undefined)
        refuse(`a prefix declaration of ${name} lacks its prefix or namespace`);
      const known = declared.get(prefix.value);
      if (known !== undefined && known !== namespace.value)
        refuse(`${name} declares the prefix ${prefix.value} twice`);
      declared.set(prefix.value, namespace.value);
    }
  return [...declared]
    .map(([prefix, namespace]) => `PREFIX ${prefix}: <${namespace}>\n`)
    .join("");
}

function textBefore(tokens: readonly Token[], index: number): string {
  const before = tokens[index - 1];
  return before?.kind === "text" ? before.text : "";
}

/**
 * The query as text and variables, each variable marked when it stands alone in a SELECT's projection; strings,
 * IRIs and comments are text, so a `?` or `$` inside them is no variable; with each keyword, upper-cased.
 */
function tokenize(query: string): { tokens: Token[]; keywords: string[] } {
  const tokens: Token[] = [];
  const keywords: string[] = [];
  let text = "";
  let projecting = false;
  let depth = 0;
  let at = 0;
  const word = /[A-Za-z_]\w*/y;
  const variable = /[?$]([\p{L}\p{N}_·]+)/uy;
  const iriRef = /<[^<>"{}|^`\\\s]*>/y;
  const string =
    /"""[\s\S]*?(?<!\\)"""|'''[\s\S]*?(?<!\\)'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/y;
  const comment = /#[^\n]*/y;
  const match = (pattern: RegExp): string | undefined => {
    pattern.lastIndex = at;
    return pattern.exec(query)?.[0];
  };
  while (at < query.length) {
    const found = match(variable);
    if (found !== undefined) {
      tokens.push({ kind: "text", text });
      text = "";
      tokens.push({
        kind: "variable",
        name: found.slice(1),
        projected: projecting && depth === 0,
      });
      at += found.length;
      continue;
    }
    const literal = match(iriRef) ?? match(string) ?? match(comment);
    if (literal !== undefined) {
      text += literal;
      at += literal.length;
      continue;
    }
    const keyword = match(word);
    if (keyword !== undefined) {
      const upper = keyword.toUpperCase();
      if (query[at - 1] !== ":" && query[at + keyword.length] !== ":")
        keywords.push(upper);
      if (upper === "SELECT") {
        projecting = true;
        depth = 0;
      } else if (depth === 0 && (upper === "WHERE" || upper === "FROM"))
        projecting = false;
      text += keyword;
      at += keyword.length;
      continue;
    }
    const character = query[at];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "{") projecting = false;
    text += character;
    at += 1;
  }
  tokens.push({ kind: "text", text });
  return { tokens, keywords };
}

/** The query with a pre-bound variable replaced by its value, kept as a variable of its projection. */
function substitute(
  tokens: readonly Token[],
  name: string,
  value: Term,
): Token[] {
  return tokens.map((token) =>
    token.kind !== "variable" || token.name !== name
      ? token
      : {
          kind: "text",
          text: token.projected
            ? `(${written(value)} AS ?${name})`
            : written(value),
        },
  );
}

function text(tokens: readonly Token[]): string {
  return tokens
    .map((token) => (token.kind === "text" ? token.text : `?${token.name}`))
    .join("");
}

/**
 * Each result of the constraints about a focus node `described` holds, each constraint's `sh:select` run once per
 * focus node with `$this` pre-bound to it, over the union `union` of the store.
 */
export async function runSparqlConstraints(
  constraints: readonly SparqlConstraint[],
  store: Store,
  union: ReadonlySet<string>,
  described: ReadonlySet<string>,
): Promise<SparqlResult[]> {
  const results: SparqlResult[] = [];
  for (const constraint of constraints) {
    for (const focus of await focusNodes(constraint, store, union)) {
      if (!described.has(focus.value)) continue;
      if (focus.termType === "BlankNode")
        refuse(
          `a blank node is a focus node of ${written(constraint.shape)}, and $this cannot be pre-bound to one`,
        );
      const query =
        constraint.prologue +
        text(substitute(constraint.select, "this", focus));
      for (const row of (await store.select(query, union)).rows) {
        const failure = row.get("failure");
        if (failure?.termType === "Literal" && failure.value === "true")
          throw new Error(
            `${written(constraint.shape)}'s SPARQL constraint reported a failure on ${written(focus)}`,
          );
        const message = row.get("message");
        results.push({
          focusNode: focus,
          path: row.get("path"),
          severity: constraint.severity,
          sourceShape: constraint.shape,
          sourceConstraintComponent: iri(`${SH}SPARQLConstraintComponent`),
          message:
            message !== undefined
              ? [message.value]
              : constraint.messages.map((template) =>
                  template.replace(
                    /\{[?$]([\p{L}\p{N}_·]+)\}/gu,
                    (whole, name: string) =>
                      (name === "this" ? focus : row.get(name))?.value ?? whole,
                  ),
                ),
        });
      }
    }
  }
  return results;
}

async function focusNodes(
  constraint: SparqlConstraint,
  store: Store,
  union: ReadonlySet<string>,
): Promise<Term[]> {
  const found = new Map<string, Term>(
    constraint.nodes.map((node) => [written(node), node]),
  );
  const patterns = [
    ...constraint.classes.map(
      (kind) =>
        `{ ?this <${RDF_TYPE}>/<${SUBCLASS_OF}>* ${written(iri(kind))} }`,
    ),
    ...constraint.subjectsOf.map((p) => `{ ?this ${written(iri(p))} [] }`),
    ...constraint.objectsOf.map((p) => `{ [] ${written(iri(p))} ?this }`),
  ];
  if (patterns.length > 0) {
    const { rows } = await store.select(
      `SELECT DISTINCT ?this WHERE { ${patterns.join(" UNION ")} }`,
      union,
    );
    for (const row of rows) {
      const node = row.get("this");
      if (node !== undefined) found.set(written(node), node);
    }
  }
  return [...found.values()];
}
