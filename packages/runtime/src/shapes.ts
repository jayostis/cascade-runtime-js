import SHACLValidator from "rdf-validate-shacl";
import factory from "rdf-validate-shacl/src/defaultEnv.js";
import type * as RDFJS from "@rdfjs/types";
import { type Files, readText } from "./files.js";
import { blank, iri, literal, type Term, type Triple } from "./rdf.js";
import {
  runSparqlConstraints,
  type SparqlConstraint,
  type SparqlResult,
  takeSparqlConstraints,
} from "./sparql-constraints.js";
import type { StoreFactory } from "./store.js";

const ONTOLOGIES = "ontologies/";
const SHAPES = ".shapes.ttl";
const VALIDATED = "urn:cascade:validated";

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
  private constructor(
    readonly validator: SHACLValidator,
    readonly sparql: readonly SparqlConstraint[],
    readonly terms: readonly Triple[],
    readonly newStore: StoreFactory,
  ) {}

  static async read(
    vocabulary: Files,
    newStore: StoreFactory,
  ): Promise<Shapes> {
    const store = newStore();
    const shapes: Triple[] = [];
    const terms: Triple[] = [];
    for (const path of await vocabulary.list(ONTOLOGIES)) {
      if (!path.endsWith(".ttl")) continue;
      const triples = await store.parse(
        await readText(vocabulary, path),
        vocabulary.iri + path,
      );
      (path.endsWith(SHAPES) ? shapes : terms).push(...triples);
    }
    const { rest, constraints } = takeSparqlConstraints(shapes);
    return new Shapes(
      new SHACLValidator(dataset(rest)),
      constraints,
      terms,
      newStore,
    );
  }

  /** Each result the shapes give about a node the triples describe, not one they only name; none when they conform. */
  async results(triples: readonly Triple[]): Promise<ShapeResult[]> {
    const described = new Set(triples.map(([s]) => s.value));
    const report = await this.validator.validate(
      dataset([...triples, ...this.terms]),
    );
    const results: ShapeResult[] = report.results
      .filter(({ focusNode }) => described.has(focusNode.value))
      .map((result) => ({
        focusNode: fromRdfjs(result.focusNode),
        path: result.path ? fromRdfjs(result.path) : undefined,
        severity: iri(result.severity.value),
        sourceShape: fromRdfjs(result.sourceShape),
        sourceConstraintComponent: iri(result.sourceConstraintComponent.value),
        message: result.message.map(({ value }) => value),
      }));
    if (this.sparql.length === 0) return results;
    const store = this.newStore();
    await store.add([...triples, ...this.terms], { graph: VALIDATED });
    return [
      ...results,
      ...(await runSparqlConstraints(
        this.sparql,
        store,
        new Set([VALIDATED]),
        described,
      )),
    ];
  }

  /** Each result, as a line naming its focus node, its path and its message. */
  async violations(triples: readonly Triple[]): Promise<string[]> {
    return (await this.results(triples))
      .map(
        (result) =>
          `${result.focusNode.value} ${result.path?.value ?? ""}: ${result.message.join(" ") || result.sourceConstraintComponent.value}`,
      )
      .sort();
  }
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
