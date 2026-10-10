import {
  type CodeSystem,
  inUtc,
  type Literal,
  RDF,
  type Term,
  type Triple,
  written,
  XSD,
} from "@cascade-runtime/runtime";

export const COPY = "pod/";
export const STATED = "pod/Which file states each thing";
export const CALLED = "pod/What everything is called";
const TYPE = `${RDF}type`;

const PREFIXES: Readonly<Record<string, string>> = {
  bridge: "https://ns.cascadeprotocol.org/bridge/v1-draft#",
  cascade: "https://ns.cascadeprotocol.org/core/v1#",
  clinical: "https://ns.cascadeprotocol.org/clinical/v1#",
  dct: "http://purl.org/dc/terms/",
  foaf: "http://xmlns.com/foaf/0.1/",
  health: "https://ns.cascadeprotocol.org/health/v1#",
  jdg: "https://ns.cascadeprotocol.org/judgments/v1-draft#",
  ldp: "http://www.w3.org/ns/ldp#",
  npx: "http://purl.org/nanopub/x/",
  pav: "http://purl.org/pav/",
  pim: "http://www.w3.org/ns/pim/space#",
  prov: "http://www.w3.org/ns/prov#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  rec: "https://ns.cascadeprotocol.org/records/v1-draft#",
  solid: "http://www.w3.org/ns/solid/terms#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
};
const LOCAL_NAME = /^[A-Za-z](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?$/;

/** The IRI as prefix:name, or undefined. */
export function prefixed(iri: string): string | undefined {
  for (const [prefix, namespace] of Object.entries(PREFIXES)) {
    const local = iri.slice(namespace.length);
    if (iri.startsWith(namespace) && LOCAL_NAME.test(local))
      return `${prefix}:${local}`;
  }
  return undefined;
}

/** The label of the first registered code system whose URI space the IRI starts with, and the code after it, or undefined. */
export function code(
  iri: string,
  codeSystems: readonly CodeSystem[],
): [system: string, code: string] | undefined {
  const found = codeSystems.find(({ uriSpace }) => iri.startsWith(uriSpace));
  return found && [found.label, iri.slice(found.uriSpace.length)];
}

/** A literal as the site shows it: a time in UTC to the minute, anything else as written. */
export function shown(literal: Literal): string {
  if (literal.datatype.value !== `${XSD}dateTime`) return literal.value;
  const zoned = /(Z|[+-]\d\d:\d\d)$/.test(literal.value)
    ? literal.value
    : `${literal.value}Z`;
  try {
    const utc = inUtc(zoned);
    return `${utc.slice(0, 10)} ${utc.slice(11, 16)} UTC`;
  } catch {
    return literal.value;
  }
}

/** Each term the statements write, a type's class or else the predicate, with how many write it. */
export function terms(added: readonly Triple[]): [Term, number][] {
  const counted = new Map<string, [Term, number]>();
  for (const [, predicate, value] of added) {
    const term = predicate.value === TYPE ? value : predicate;
    const key = written(term);
    counted.set(key, [term, (counted.get(key)?.[1] ?? 0) + 1]);
  }
  return [...counted.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, found]) => found);
}
