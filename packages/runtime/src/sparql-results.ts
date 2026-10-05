import { blank, iri, literal, type Term } from "./rdf.js";
import type { Row, Rows } from "./store.js";

interface JsonTerm {
  type: "uri" | "bnode" | "literal" | "typed-literal";
  value: string;
  "xml:lang"?: string;
  datatype?: string;
}

interface JsonResults {
  head?: { vars?: string[] };
  results?: { bindings: Record<string, JsonTerm>[] };
  boolean?: boolean;
}

function term(value: JsonTerm): Term {
  switch (value.type) {
    case "uri":
      return iri(value.value);
    case "bnode":
      return blank(value.value);
    case "literal":
    case "typed-literal":
      if (value["xml:lang"] !== undefined)
        return literal(value.value, { language: value["xml:lang"] });
      return literal(value.value, value.datatype);
    default:
      throw new Error(
        `a SPARQL result holds a term of type ${String((value as JsonTerm).type)}`,
      );
  }
}

/** The rows, or the boolean, a SPARQL 1.1 Query Results JSON document holds. */
export function parseResults(json: string): Rows | boolean {
  const results = JSON.parse(json) as JsonResults;
  if (typeof results.boolean === "boolean") return results.boolean;
  if (!results.results)
    throw new Error("a SPARQL JSON result with neither a boolean nor results");
  return {
    variables: results.head?.vars ?? [],
    rows: results.results.bindings.map(
      (binding): Row =>
        new Map(
          Object.entries(binding).map(([name, value]) => [name, term(value)]),
        ),
    ),
  };
}
