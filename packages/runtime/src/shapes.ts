import SHACLValidator from "rdf-validate-shacl";
import factory from "rdf-validate-shacl/src/defaultEnv.js";
import type * as RDFJS from "@rdfjs/types";
import { type Files, readText } from "./files.js";
import { blank, iri, literal, type Term, type Triple, written } from "./rdf.js";
import {
  checkSparqlConstraints,
  runSparqlConstraints,
  termsStore,
  type SparqlConstraint,
  type SparqlResult,
  takeSparqlConstraints,
} from "./sparql-constraints.js";
import type { Store, StoreFactory } from "./store.js";

const ONTOLOGIES = "ontologies/";
const SHAPES = ".shapes.ttl";
const SUBCLASS_OF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

function term(value: Term): RDFJS.Quad_Object {
  switch (value.termType) {
    case "NamedNode":
      return factory.namedNode(value.value);
    case "BlankNode":
      return factory.blankNode(value.value);
    case "Literal":
      return factory.literal(
        value.value,
        value.language || factory.namedNode(value.datatype.value),
      );
  }
}

function fromRdfjs(value: RDFJS.Term): Term {
  switch (value.termType) {
    case "NamedNode":
      return iri(value.value);
    case "BlankNode":
      return blank(value.value);
    case "Literal":
      return value.language
        ? literal(value.value, { language: value.language })
        : literal(value.value, value.datatype.value);
    default:
      throw new Error(`a validation result names a ${value.termType}`);
  }
}

export type ShapeResult = SparqlResult;

/** The vocabulary's shapes, and its terms, which a graph is read with so that a subclass's instances are its class's. */
export class Shapes {
  #termsStore: Promise<Store> | undefined;
  #subclassTriples: readonly Triple[] | undefined;
  #typeTriples: ReadonlyMap<string, readonly Triple[]> | undefined;
  readonly #validators = new Map<string, SHACLValidator>();

  private constructor(
    readonly validator: SHACLValidator,
    readonly sparql: readonly SparqlConstraint[],
    readonly terms: readonly Triple[],
    readonly newStore: StoreFactory,
    readonly shapeTriples: readonly Triple[],
  ) {}

  /**
   * The shapes the vocabulary's ontology files give. What a set of files parses to is parsed once for the process,
   * by their paths and text: each read gets a validator and stores of its own, so no use of one shows in another.
   */
  static async read(
    vocabulary: Files,
    newStore: StoreFactory,
  ): Promise<Shapes> {
    const sources: [string, string][] = [];
    for (const path of await vocabulary.list(ONTOLOGIES))
      if (path.endsWith(".ttl"))
        sources.push([path, await readText(vocabulary, path)]);
    const key = JSON.stringify([vocabulary.iri, sources]);
    let reading = parsed.get(key);
    if (reading === undefined) {
      reading = parseShapes(sources, vocabulary, newStore);
      parsed.set(key, reading);
      reading.catch(() => {
        if (parsed.get(key) === reading) parsed.delete(key);
      });
    }
    const { rest, constraints, terms } = await reading;
    return new Shapes(
      new SHACLValidator(dataset(rest)),
      constraints,
      terms,
      newStore,
      rest,
    );
  }

  /** Each result the shapes give about a node the triples describe, not one they only name; none when they conform. */
  async results(triples: readonly Triple[]): Promise<ShapeResult[]> {
    const described = new Set(triples.map(([s]) => written(s)));
    const report = await this.validator.validate(
      dataset([...triples, ...this.terms]),
    );
    const results: ShapeResult[] = report.results
      .filter(({ focusNode }) => described.has(written(fromRdfjs(focusNode))))
      .map(shapeResult);
    return [
      ...results,
      ...(await runSparqlConstraints(
        this.sparql,
        triples,
        this.terms,
        () => (this.#termsStore ??= termsStore(this.terms, this.newStore)),
      )),
    ];
  }

  /**
   * Each result the one shape `shape` gives about a node the triples describe, over the triples, the vocabulary's
   * subclass statements and the types it gives to the IRIs the triples name (an agent it types, such as
   * `cascade:CascadeMatcher`) alone: what `results` gives for that shape, without the validator running every other
   * shape over every term. A shape that names another shape is read with it.
   */
  async resultsOf(
    shape: string,
    triples: readonly Triple[],
  ): Promise<ShapeResult[]> {
    const described = new Set(triples.map(([s]) => written(s)));
    const validator = this.#validatorOf(shape);
    const typed = this.#typesBySubject;
    const named = new Set<string>();
    for (const [s, , o] of triples) {
      if (s.termType === "NamedNode") named.add(s.value);
      if (o.termType === "NamedNode") named.add(o.value);
    }
    const report = await validator.validate(
      dataset([
        ...triples,
        ...this.#subclasses,
        ...[...named].flatMap((name) => typed.get(name) ?? []),
      ]),
    );
    const results: ShapeResult[] = report.results
      .filter(({ focusNode }) => described.has(written(fromRdfjs(focusNode))))
      .map(shapeResult);
    const own = this.sparql.filter(({ shape: named }) => named.value === shape);
    return [
      ...results,
      ...(own.length === 0
        ? []
        : await runSparqlConstraints(
            own,
            triples,
            this.terms,
            () => (this.#termsStore ??= termsStore(this.terms, this.newStore)),
          )),
    ];
  }

  #validatorOf(shape: string): SHACLValidator {
    let validator = this.#validators.get(shape);
    if (validator === undefined) {
      validator = new SHACLValidator(
        dataset(closure(this.shapeTriples, shape)),
      );
      this.#validators.set(shape, validator);
    }
    return validator;
  }

  get #typesBySubject(): ReadonlyMap<string, readonly Triple[]> {
    if (this.#typeTriples === undefined) {
      const types = new Map<string, Triple[]>();
      for (const triple of this.terms) {
        if (triple[1].value !== RDF_TYPE || triple[0].termType !== "NamedNode")
          continue;
        const held = types.get(triple[0].value);
        if (held === undefined) types.set(triple[0].value, [triple]);
        else held.push(triple);
      }
      this.#typeTriples = types;
    }
    return this.#typeTriples;
  }

  get #subclasses(): readonly Triple[] {
    return (this.#subclassTriples ??= this.terms.filter(
      ([, p]) => p.value === SUBCLASS_OF,
    ));
  }

  /** Each result, as a line naming its focus node, its path and its message. */
  async resultLines(triples: readonly Triple[]): Promise<string[]> {
    return (await this.results(triples))
      .map(
        (result) =>
          `${result.focusNode.value} ${result.path?.value ?? ""}: ${result.message.join(" ") || result.sourceConstraintComponent.value}`,
      )
      .sort();
  }
}

interface ParsedShapes {
  readonly rest: readonly Triple[];
  readonly constraints: readonly SparqlConstraint[];
  readonly terms: readonly Triple[];
}

const parsed = new Map<string, Promise<ParsedShapes>>();

async function parseShapes(
  sources: readonly (readonly [string, string])[],
  vocabulary: Files,
  newStore: StoreFactory,
): Promise<ParsedShapes> {
  const store = newStore();
  const shapes: Triple[] = [];
  const terms: Triple[] = [];
  for (const [path, text] of sources) {
    const triples = await store.parse(text, vocabulary.iri + path);
    (path.endsWith(SHAPES) ? shapes : terms).push(...triples);
  }
  const { rest, constraints } = takeSparqlConstraints(shapes);
  await checkSparqlConstraints(constraints, newStore);
  return { rest, constraints, terms };
}

function shapeResult(
  result: Awaited<ReturnType<SHACLValidator["validate"]>>["results"][number],
): ShapeResult {
  return {
    focusNode: fromRdfjs(result.focusNode),
    path: result.path ? fromRdfjs(result.path) : undefined,
    severity: iri(result.severity.value),
    sourceShape: fromRdfjs(result.sourceShape),
    sourceConstraintComponent: iri(result.sourceConstraintComponent.value),
    message: result.message.map(({ value }) => value),
  };
}

/** The triples of the shape `root`, and of every blank node and shape it names, which stand alone as a shapes graph. */
function closure(all: readonly Triple[], root: string): Triple[] {
  const bySubject = new Map<string, Triple[]>();
  for (const triple of all) {
    const key = written(triple[0]);
    const held = bySubject.get(key);
    if (held === undefined) bySubject.set(key, [triple]);
    else held.push(triple);
  }
  const taken: Triple[] = [];
  const seen = new Set<string>();
  const queue = [written(iri(root))];
  for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
    if (seen.has(key)) continue;
    seen.add(key);
    for (const triple of bySubject.get(key) ?? []) {
      taken.push(triple);
      const object = triple[2];
      if (object.termType !== "Literal") queue.push(written(object));
    }
  }
  return taken;
}

function dataset(triples: readonly Triple[]): RDFJS.DatasetCore {
  return factory.dataset(
    triples.map(([s, p, o]) =>
      factory.quad(
        term(s) as RDFJS.Quad_Subject,
        factory.namedNode(p.value),
        term(o),
      ),
    ),
  );
}
