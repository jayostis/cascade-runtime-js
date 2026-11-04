import { prefixed } from "./terms.js";

/** The host whose names do not resolve, on either scheme, with or without a path or port; no page links it. */
const NAMESPACE_HOST = /^https?:\/\/ns\.cascadeprotocol\.org(?:[:/?#]|$)/i;

function away(where: string): string {
  if (NAMESPACE_HOST.test(where))
    throw new Error(
      `${where} is on ns.cascadeprotocol.org, which does not resolve; link a page of this site`,
    );
  return where;
}

/** A rule's number as the anchor of its heading: `R19` is `r19`, `Check 3` is `check-3`. */
export const anchorOf = (number: string): string =>
  number.toLowerCase().replace(/\s+/g, "-");

/** The page a feature file is shown on: a runtime feature by its name, a kit's by its folder's. */
export const pageNameOf = (path: string): string =>
  `${path.startsWith("runtime/") ? path.slice(path.lastIndexOf("/") + 1, -".feature".length) : (path.split("/").at(-2) ?? path)}.html`;

/**
 * The id of a term on the term reference's page: `prefix:name` for a term in a namespace this site knows, so
 * `foaf:name` and `cascade:name` are two anchors, else the whole IRI.
 */
export const termId = (iri: string): string => prefixed(iri) ?? iri;

/**
 * A link to a term on the term reference's page, `base` being that page's address: `terms/` from the front page, `""` from
 * the page itself, an absolute address from a site built outside the hub.
 */
export function termHref(iri: string, base: string): string {
  return `${away(base)}#${prefixed(iri) ?? encodeURIComponent(iri)}`;
}

/** A link to a rule on its feature's page, `base` being the folder of the spec's pages with its slash, `spec/` or `""`. */
export function ruleHref(path: string, number: string, base: string): string {
  return `${away(base)}${pageNameOf(path)}#${anchorOf(number)}`;
}

/** A thing a pod site gives a page: its IRI, the folder its kind's pages are in, its name, and the name it falls back to. */
export interface Named {
  readonly iri: string;
  readonly folder: string;
  readonly name: string;
  readonly fallback: string;
}

export async function addressesOf(
  _things: readonly Named[],
): Promise<Map<string, string>> {
  return new Map();
}

/**
 * A link to a note of the vocabulary, `path` being its path in the vocabulary and `blob` the address of the vocabulary's
 * files on GitHub at the commit the pages were built from. A page of this site replaces it when decisions have one.
 */
export function noteHref(path: string, blob: string): string {
  return `${away(blob).replace(/\/*$/, "/")}${path.replace(/^\/+/, "")}`;
}
