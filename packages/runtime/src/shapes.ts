import SHACLValidator from "rdf-validate-shacl";
import factory from "rdf-validate-shacl/src/defaultEnv.js";
import type * as RDFJS from "@rdfjs/types";
import { type Files, readText } from "./files.js";
import type { NamedNode, Term, Triple } from "./rdf.js";
import type { StoreFactory } from "./store.js";

const ONTOLOGIES = "ontologies/";
const SHAPES = ".shapes.ttl";

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

export interface ShapeResult {
  readonly focusNode: Term;
  readonly path: Term | undefined;
  readonly severity: NamedNode;
  readonly sourceShape: Term;
  readonly sourceConstraintComponent: NamedNode;
  readonly message: readonly string[];
}

/** The vocabulary's shapes, and its terms, which a graph is read with so that a subclass's instances are its class's. */
export class Shapes {
  private constructor(
    readonly validator: SHACLValidator,
    readonly terms: readonly Triple[],
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
    return new Shapes(new SHACLValidator(dataset(shapes)), terms);
  }

  /** Each result the shapes give about a node the triples describe, not one they only name; none when they conform. */
  async results(triples: readonly Triple[]): Promise<ShapeResult[]> {
    const described = new Set(triples.map(([s]) => s.value));
    const report = await this.validator.validate(
      dataset([...triples, ...this.terms]),
    );
    return report.results
      .filter(({ focusNode }) => described.has(focusNode.value))
      .map((result) => ({
        focusNode: result.focusNode as Term,
        path: (result.path ?? undefined) as Term | undefined,
        severity: result.severity as NamedNode,
        sourceShape: result.sourceShape as Term,
        sourceConstraintComponent:
          result.sourceConstraintComponent as NamedNode,
        message: result.message.map(({ value }) => value),
      }));
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
