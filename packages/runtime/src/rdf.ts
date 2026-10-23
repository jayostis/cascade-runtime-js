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

/**
 * The IRI of a code in a code system: its URI space followed by the code percent-encoded as SPARQL's ENCODE_FOR_URI
 * does, every character but `A-Z a-z 0-9 - _ . ~` as `%` and two upper-case hexadecimal digits of its UTF-8.
 */
export function codeIri(uriSpace: string, code: string): string {
  return (
    uriSpace +
    encodeURIComponent(code).replace(
      /[!'()*]/g,
      (character) =>
        `%${(character.codePointAt(0) ?? 0).toString(16).toUpperCase()}`,
    )
  );
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
  return lines(triples, written);
}

/**
 * The triples as Turtle, a triple to a line, with every IRI that is the file's own or a node inside it written
 * relative to it (`<>`, `<#…>`), so the file holds no address of its own.
 */
export function relativeTurtle(
  triples: Iterable<Triple>,
  file: string,
): Uint8Array {
  return lines(triples, (term) =>
    term.termType === "NamedNode" &&
    (term.value === file || term.value.startsWith(`${file}#`))
      ? `<${term.value.slice(file.length)}>`
      : written(term),
  );
}

function lines(
  triples: Iterable<Triple>,
  write: (term: Term) => string,
): Uint8Array {
  const found = new Set<string>();
  for (const [subject, predicate, object] of triples)
    found.add(`${write(subject)} ${write(predicate)} ${write(object)} .\n`);
  return new TextEncoder().encode([...found].sort().join(""));
}
