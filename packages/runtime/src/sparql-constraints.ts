import {
  blank,
  iri,
  type BlankNode,
  type NamedNode,
  type Term,
  type Triple,
  written,
} from "./rdf.js";
import { Refusal } from "./refusal.js";
import type { Store, StoreFactory } from "./store.js";

const SH = "http://www.w3.org/ns/shacl#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDF_TYPE = `${RDF}type`;
const SUBCLASS_OF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const CLASSES = new Set([
  "http://www.w3.org/2000/01/rdf-schema#Class",
  "http://www.w3.org/2002/07/owl#Class",
]);
const VALIDATORS = new Set(
  ["validator", "nodeValidator", "propertyValidator"].map((name) => SH + name),
);
const USES_SHAPE = new Set(
  ["node", "property", "qualifiedValueShape", "not"].map((name) => SH + name),
);
const USES_SHAPES = new Set(["and", "or", "xone"].map((name) => SH + name));
const PRE_BOUND = new Set(["this", "currentShape", "shapesGraph"]);
const NOT_PRE_BINDABLE = new Set(["VALUES", "MINUS", "SERVICE"]);
const ENDS_MODIFIER = new Set(["HAVING", "LIMIT", "OFFSET", "VALUES"]);
const ANY_FOCUS = iri("urn:cascade:shacl-sparql:focus-node");
const SKOLEM = "urn:cascade:shacl-sparql:blank-node:";
const TERMS = "urn:cascade:shacl-sparql:terms";
let graphs = 0;

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

/**
 * Where a pre-bound variable stands, which decides what replaces it: alone in a SELECT's projection it is dropped
 * (`placeholder` when nothing else is projected), alone in GROUP BY or ORDER BY it is bracketed, in BOUND it is true.
 */
type Role = "plain" | "projected" | "placeholder" | "modifier" | "bound";

type Variable = {
  readonly kind: "variable";
  readonly name: string;
  readonly role: Role;
  readonly placeholder?: string;
};

type Token = { readonly kind: "text"; readonly text: string } | Variable;

function refuse(why: string): never {
  throw new Refusal(`The runtime does not run this SHACL-SPARQL: ${why}`);
}

class Graph {
  readonly #bySubject = new Map<string, Triple[]>();
  readonly #byObject = new Map<string, Triple[]>();

  constructor(readonly triples: readonly Triple[]) {
    for (const triple of triples) {
      for (const [index, key] of [
        [this.#bySubject, written(triple[0])],
        [this.#byObject, written(triple[2])],
      ] as const) {
        const known = index.get(key);
        if (known === undefined) index.set(key, [triple]);
        else known.push(triple);
      }
    }
  }

  objects(subject: Term, predicate: string): Term[] {
    return (this.#bySubject.get(written(subject)) ?? [])
      .filter(([, p]) => p.value === predicate)
      .map(([, , o]) => o);
  }

  pointing(object: Term): readonly Triple[] {
    return this.#byObject.get(written(object)) ?? [];
  }

  isTrue(subject: Term, predicate: string): boolean {
    return this.objects(subject, predicate).some(
      (o) =>
        o.termType === "Literal" && (o.value === "true" || o.value === "1"),
    );
  }

  /** Whether another shape uses `shape`, through a parameter that takes a shape or a list of shapes. */
  isUsed(shape: Term): boolean {
    for (const [, predicate] of this.pointing(shape))
      if (USES_SHAPE.has(predicate.value)) return true;
    for (const [member, predicate] of this.pointing(shape)) {
      if (predicate.value !== `${RDF}first`) continue;
      let list: Term = member;
      for (const seen = new Set<string>(); !seen.has(written(list));) {
        seen.add(written(list));
        const pointing = this.pointing(list);
        if (pointing.some(([, p]) => USES_SHAPES.has(p.value))) return true;
        const previous = pointing.find(([, p]) => p.value === `${RDF}rest`);
        if (previous === undefined) break;
        list = previous[0];
      }
    }
    return false;
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

/** Refuses a constraint whose query, pre-bound as it will be, does not parse. */
export async function checkSparqlConstraints(
  constraints: readonly SparqlConstraint[],
  newStore: StoreFactory,
): Promise<void> {
  const store = newStore();
  for (const constraint of constraints) {
    try {
      await store.select(query(constraint, ANY_FOCUS), new Set());
    } catch (error) {
      refuse(
        `a constraint of ${written(constraint.shape)} does not parse once $this is pre-bound: ${(error as Error).message}`,
      );
    }
  }
}

function read(
  graph: Graph,
  shape: NamedNode | BlankNode,
  node: Term,
): SparqlConstraint | undefined {
  const name = written(shape);
  if (graph.objects(shape, `${SH}path`).length > 0)
    refuse(`${name} is a property shape with sh:sparql`);
  if (graph.isUsed(shape))
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

  const { tokens, keywords } = tokenize(select.value, name);
  for (const keyword of keywords)
    if (NOT_PRE_BINDABLE.has(keyword))
      refuse(`a constraint of ${name} uses ${keyword}`);
  if (
    shape.termType === "BlankNode" &&
    tokens.some((t) => t.kind === "variable" && t.name === "currentShape")
  )
    refuse(`a constraint of blank shape ${name} uses $currentShape`);

  const [severity] = graph.objects(shape, `${SH}severity`);
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
    messages: [
      ...graph.objects(node, `${SH}message`),
      ...graph.objects(shape, `${SH}message`),
    ].map(({ value }) => value),
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

interface Projection {
  readonly depth: number;
  readonly nested: boolean;
  returnsThis: boolean;
  returnsMore: boolean;
  readonly dropped: number[];
}

/**
 * The query as text and variables, read by SPARQL's lexical grammar so that a `?` or `$` inside a string, an IRI or a
 * comment is no variable and a keyword inside a prefixed name is no keyword, each pre-bound variable given its role;
 * with each keyword, upper-cased. A `<` after an operand inside brackets is an operator, as SPARQL's parsers read it.
 * A sub-select that does not return `$this` is refused, as is assigning a pre-bound variable.
 */
function tokenize(
  query: string,
  name: string,
): { tokens: Token[]; keywords: string[] } {
  const tokens: Token[] = [];
  const keywords: string[] = [];
  const brackets: string[] = [];
  let text = "";
  let at = 0;
  let afterOperand = false;
  let previousWord = "";
  let projection: Projection | undefined;
  let selects = 0;
  let modifier: number | undefined;
  let modifierNext = false;
  const variable = /[?$]([\p{L}\p{N}\p{M}_\p{Pc}\u00B7]+)/uy;
  const iriRef = /<[^<>"{}|^`\\ \p{Cc}]*>/uy;
  const string =
    /"""(?:(?:"|"")?(?:[^"\\]|\\[\s\S]))*"""|'''(?:(?:'|'')?(?:[^'\\]|\\[\s\S]))*'''|"(?:[^"\\\n\r]|\\[\s\S])*"|'(?:[^'\\\n\r]|\\[\s\S])*'/y;
  const comment = /#[^\n\r]*/y;
  const prefixedName =
    /(?:[\p{L}_][\p{L}\p{N}_.\-·]*)?:(?:(?:[\p{L}\p{N}_:%\-·.]|\\.)*(?:[\p{L}\p{N}_:%\-·]|\\.))?/uy;
  const word = /[\p{L}_][\p{L}\p{N}_]*/uy;
  const closing = /\s*\)/y;
  const match = (pattern: RegExp): string | undefined => {
    pattern.lastIndex = at;
    return pattern.exec(query)?.[0];
  };
  const projecting = (): Projection | undefined =>
    projection !== undefined && brackets.length === projection.depth
      ? projection
      : undefined;
  const close = (open: Projection): void => {
    if (open.nested && !open.returnsThis)
      refuse(
        `a sub-select of a constraint of ${name} does not return $this, so $this cannot be pre-bound in it`,
      );
    const [first] = open.dropped;
    if (!open.returnsMore && first !== undefined) {
      let n = selects;
      while (query.includes(`pre_bound_${n}`)) n += 1;
      tokens[first] = {
        ...(tokens[first] as Variable),
        role: "placeholder",
        placeholder: `pre_bound_${n}`,
      };
    }
    projection = undefined;
  };

  while (at < query.length) {
    const found = match(variable);
    if (found !== undefined) {
      const variableName = found.slice(1);
      at += found.length;
      let role: Role = "plain";
      const open = projecting();
      if (PRE_BOUND.has(variableName)) {
        if (variableName === "shapesGraph")
          refuse(`a constraint of ${name} uses $shapesGraph`);
        if (previousWord === "AS")
          refuse(
            `a constraint of ${name} assigns the pre-bound ?${variableName}`,
          );
        const bound = /(?<![\w:])BOUND\s*\(\s*$/iu.exec(text);
        closing.lastIndex = at;
        if (open !== undefined) {
          role = "projected";
          open.dropped.push(tokens.length + 1);
          if (variableName === "this") open.returnsThis = true;
        } else if (modifier !== undefined && brackets.length === modifier)
          role = "modifier";
        else if (bound !== null && closing.exec(query) !== null) {
          role = "bound";
          text = text.slice(0, bound.index);
          at = closing.lastIndex;
        }
      } else if (open !== undefined) open.returnsMore = true;
      tokens.push({ kind: "text", text });
      text = "";
      tokens.push({ kind: "variable", name: variableName, role });
      afterOperand = true;
      previousWord = "";
      continue;
    }
    const character = query[at]!;
    const operator =
      character === "<" && brackets.at(-1) === "(" && afterOperand;
    const literal =
      (operator ? undefined : match(iriRef)) ??
      (character === '"' || character === "'"
        ? (match(string) ??
          refuse(`a constraint of ${name} has an unterminated string`))
        : undefined) ??
      match(prefixedName);
    if (literal !== undefined) {
      text += literal;
      at += literal.length;
      afterOperand = true;
      previousWord = "";
      continue;
    }
    const remark = match(comment);
    if (remark !== undefined) {
      text += remark;
      at += remark.length;
      continue;
    }
    const keyword = match(word);
    if (keyword !== undefined) {
      const upper = keyword.toUpperCase();
      keywords.push(upper);
      const open = projecting();
      if (upper === "SELECT") {
        projection = {
          depth: brackets.length,
          nested: selects > 0,
          returnsThis: false,
          returnsMore: false,
          dropped: [],
        };
        selects += 1;
      } else if ((upper === "WHERE" || upper === "FROM") && open) close(open);
      else if (upper === "BY" && modifierNext) modifier = brackets.length;
      else if (ENDS_MODIFIER.has(upper)) modifier = undefined;
      modifierNext = upper === "GROUP" || upper === "ORDER";
      afterOperand = upper === "TRUE" || upper === "FALSE";
      previousWord = upper;
      text += keyword;
      at += keyword.length;
      continue;
    }
    const open = projecting();
    if (character === "{") {
      if (open !== undefined) close(open);
      brackets.push(character);
    } else if (character === "(" || character === "[") {
      if (character === "(" && open !== undefined) open.returnsMore = true;
      brackets.push(character);
    } else if (character === ")" || character === "]" || character === "}") {
      brackets.pop();
      if (modifier !== undefined && brackets.length < modifier)
        modifier = undefined;
    } else if (character === "*" && open !== undefined) {
      open.returnsThis = true;
      open.returnsMore = true;
    }
    if (!/\s/u.test(character)) {
      afterOperand = /[\d)\]]/u.test(character);
      previousWord = "";
    }
    text += character;
    at += 1;
  }
  if (projection !== undefined) close(projection);
  tokens.push({ kind: "text", text });
  return { tokens, keywords };
}

/** The query with a pre-bound variable replaced by its value, as its role allows. */
function substitute(
  tokens: readonly Token[],
  name: string,
  value: Term,
): Token[] {
  return tokens.map((token): Token => {
    if (token.kind !== "variable" || token.name !== name) return token;
    switch (token.role) {
      case "projected":
        return { kind: "text", text: "" };
      case "placeholder":
        return { kind: "text", text: `(1 AS ?${token.placeholder})` };
      case "modifier":
        return { kind: "text", text: `(${written(value)})` };
      case "bound":
        return { kind: "text", text: "true" };
      case "plain":
        return { kind: "text", text: written(value) };
    }
  });
}

function query(constraint: SparqlConstraint, focus: Term): string {
  return (
    constraint.prologue +
    substitute(constraint.select, "this", focus)
      .map((token) => (token.kind === "text" ? token.text : `?${token.name}`))
      .join("")
  );
}

function skolem(term: Term): Term {
  return term.termType === "BlankNode"
    ? iri(SKOLEM + encodeURIComponent(term.value))
    : term;
}

function unskolem(term: Term): Term {
  return term.termType === "NamedNode" && term.value.startsWith(SKOLEM)
    ? blank(decodeURIComponent(term.value.slice(SKOLEM.length)))
    : term;
}

function skolemised(triples: readonly Triple[]): Triple[] {
  return triples.map(([s, p, o]): Triple => [
    skolem(s) as Triple[0],
    p,
    skolem(o),
  ]);
}

/** A store holding the terms, which each graph a SPARQL constraint is run on joins while it runs. */
export async function termsStore(
  terms: readonly Triple[],
  newStore: StoreFactory,
): Promise<Store> {
  const store = newStore();
  await store.add(skolemised(terms), { graph: TERMS });
  return store;
}

/**
 * Each result of the constraints about a focus node the triples describe, each constraint's `sh:select` run once per
 * focus node with `$this` pre-bound to it, over the triples, put in a graph of the terms' store while they run, and
 * the terms; a blank node is given to the query as an IRI standing for it.
 */
export async function runSparqlConstraints(
  constraints: readonly SparqlConstraint[],
  triples: readonly Triple[],
  terms: readonly Triple[],
  store: () => Promise<Store>,
): Promise<SparqlResult[]> {
  const described = new Set(triples.map(([subject]) => written(subject)));
  const all = [...triples, ...terms];
  const runs = constraints
    .map((constraint) => ({
      constraint,
      focus: focusNodes(constraint, all, described),
    }))
    .filter(({ focus }) => focus.length > 0);
  if (runs.length === 0) return [];
  const held = await store();
  const graph = `urn:cascade:shacl-sparql:validated:${(graphs += 1)}`;
  await held.add(skolemised(triples), { graph });
  try {
    return await run(runs, held, new Set([TERMS, graph]));
  } finally {
    await held.drop(graph);
  }
}

async function run(
  runs: readonly { constraint: SparqlConstraint; focus: readonly Term[] }[],
  store: Store,
  union: ReadonlySet<string>,
): Promise<SparqlResult[]> {
  const results: SparqlResult[] = [];
  for (const { constraint, focus } of runs) {
    const shape = written(constraint.shape);
    for (const node of focus) {
      let answer;
      try {
        answer = await store.select(query(constraint, skolem(node)), union);
      } catch {
        refuse(
          `a constraint of ${shape} could not run on one of its focus nodes`,
        );
      }
      for (const row of answer.rows) {
        const value = (name: string): Term | undefined => {
          if (name === "this") return node;
          const bound = row.get(name);
          return bound === undefined ? undefined : unskolem(bound);
        };
        const failure = row.get("failure");
        if (failure?.termType === "Literal" && failure.value === "true")
          throw new Refusal(
            `${shape}'s SPARQL constraint reported a failure on one of its focus nodes`,
          );
        const message = row.get("message");
        results.push({
          focusNode: node,
          path: value("path"),
          severity: constraint.severity,
          sourceShape: constraint.shape,
          sourceConstraintComponent: iri(`${SH}SPARQLConstraintComponent`),
          message:
            constraint.messages.length === 0 && message !== undefined
              ? [message.value]
              : constraint.messages.map((template) =>
                  template.replace(
                    /\{[?$]([\p{L}\p{N}_·]+)\}/gu,
                    (whole, name: string) => value(name)?.value ?? whole,
                  ),
                ),
        });
      }
    }
  }
  return results;
}

/** The constraint's focus nodes the triples describe: its shape's targets, a subclass's instances its class's. */
function focusNodes(
  constraint: SparqlConstraint,
  triples: readonly Triple[],
  described: ReadonlySet<string>,
): Term[] {
  const found = new Map<string, Term>();
  const add = (term: Term): void => {
    const key = written(term);
    if (described.has(key)) found.set(key, term);
  };
  constraint.nodes.forEach(add);
  const subjectsOf = new Set(constraint.subjectsOf);
  const objectsOf = new Set(constraint.objectsOf);
  const classes = new Set(constraint.classes);
  if (classes.size > 0) {
    const subclasses = new Map<string, string[]>();
    for (const [subclass, predicate, kind] of triples)
      if (predicate.value === SUBCLASS_OF)
        subclasses.set(kind.value, [
          ...(subclasses.get(kind.value) ?? []),
          subclass.value,
        ]);
    for (const kind of classes)
      for (const subclass of subclasses.get(kind) ?? []) classes.add(subclass);
  }
  for (const [subject, predicate, object] of triples) {
    if (subjectsOf.has(predicate.value)) add(subject);
    if (objectsOf.has(predicate.value)) add(object);
    if (
      predicate.value === RDF_TYPE &&
      object.termType === "NamedNode" &&
      classes.has(object.value)
    )
      add(subject);
  }
  return [...found.values()];
}
