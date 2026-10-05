export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const XSD_STRING = `${XSD}string`;
export const RDF_LANG_STRING = `${RDF}langString`;

export interface NamedNode {
  readonly termType: "NamedNode";
  readonly value: string;
}

export interface BlankNode {
  readonly termType: "BlankNode";
  readonly value: string;
}

export interface Literal {
  readonly termType: "Literal";
  readonly value: string;
  readonly language: string;
  readonly datatype: NamedNode;
}

export type Term = NamedNode | BlankNode | Literal;

export type Triple = readonly [
  subject: NamedNode | BlankNode,
  predicate: NamedNode,
  object: Term,
];

export function iri(value: string): NamedNode {
  return { termType: "NamedNode", value };
}

export function blank(value: string): BlankNode {
  return { termType: "BlankNode", value };
}

export function literal(
  value: string,
  datatypeOrLanguage?: string | { language: string },
): Literal {
  if (typeof datatypeOrLanguage === "object") {
    return {
      termType: "Literal",
      value,
      language: datatypeOrLanguage.language,
      datatype: iri(RDF_LANG_STRING),
    };
  }
  return {
    termType: "Literal",
    value,
    language: "",
    datatype: iri(datatypeOrLanguage ?? XSD_STRING),
  };
}

function quoted(text: string): string {
  const escaped = text
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r");
  return `"${escaped}"`;
}

/** The term as N-Triples writes it, which is also how two terms are told equal. */
export function written(term: Term): string {
  switch (term.termType) {
    case "NamedNode":
      return `<${term.value}>`;
    case "BlankNode":
      return `_:${term.value}`;
    case "Literal":
      if (term.language) return `${quoted(term.value)}@${term.language}`;
      if (term.datatype.value === XSD_STRING) return quoted(term.value);
      return `${quoted(term.value)}^^<${term.datatype.value}>`;
  }
}

/** The triples as N-Triples, which every Turtle reader also reads. */
export function ntriples(triples: Iterable<Triple>): Uint8Array {
  const lines = new Set<string>();
  for (const [subject, predicate, object] of triples) {
    lines.add(
      `${written(subject)} ${written(predicate)} ${written(object)} .\n`,
    );
  }
  return new TextEncoder().encode([...lines].sort().join(""));
}
