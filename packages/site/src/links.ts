import { markup } from "./html.js";
import { prefixed } from "./terms.js";

/** The host whose names do not resolve, on either scheme, with or without a path or port; no page links it. */
export const NAMESPACE_HOST =
  /^https?:\/\/ns\.cascadeprotocol\.org(?:[:/?#]|$)/i;

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
 * A term's page in the folder of term pages: `prefix/Name.html` for a term in a namespace this site knows, else
 * `other/` and the IRI as a slug. A property's is in `properties/` of that folder, so `cascade:Subject` and
 * `cascade:subject` are two files on a disk that ignores case.
 */
export function termPage(iri: string, property = false): string {
  const name = prefixed(iri);
  const kind = property ? "properties/" : "";
  if (name === undefined) return `other/${kind}${slugOf(iri)}.html`;
  const at = name.indexOf(":");
  return `${name.slice(0, at)}/${kind}${name.slice(at + 1)}.html`;
}

/**
 * A link to a term's page, `base` being the folder of term pages: `terms/` from the front page, `""` from the term
 * reference's own page, `../` from another term's page (`../../` from a property's), an absolute address from a site
 * built outside the hub; `property` is whether the term is a property.
 */
export function termHref(iri: string, base: string, property = false): string {
  return `${away(base)}${termPage(iri, property)}`;
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

const LONGEST = 120;
/** Names Windows will not give a file, whatever its extension. */
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/;
/** How many hex digits of an IRI's digest tell apart the things that share a slug, at the least. */
const SHORTEST = 8;
/** An address that tells things apart by a digest: the slug, then `--`, then hex digits. */
const DIGESTED = /^(.*)--[0-9a-f]+\.html$/;

/**
 * A name as a slug: lowercase ASCII letters and digits, runs of anything else one hyphen, none at either end, so never
 * two in a row; with `longest`, at most that many characters, cut at a hyphen where there is one.
 */
export function slugOf(name: string, longest = Infinity): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= longest) return slug;
  const cut = slug.slice(0, longest + 1);
  const at = cut.lastIndexOf("-");
  return at > 0 ? cut.slice(0, at) : slug.slice(0, longest);
}

async function digestOf(iri: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(iri),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The slug a thing's page is named by, `longest` at most: its name's, or its fallback's when its name gives none. */
function pageSlug(thing: Named, longest: number): string {
  const named = slugOf(thing.name, longest);
  const slug = named === "" ? slugOf(thing.fallback, longest) : named;
  return RESERVED.test(slug)
    ? `${slug}-${slugOf(thing.fallback, longest)}`
    : slug;
}

/**
 * Each thing's page, by its IRI: `<folder>/<slug>.html`, the slug its name's, or its fallback's when its name gives
 * none, cut at 120 characters unless things whose full slugs differ would then share one. Things of one folder that still
 * share a slug each get `--` and the first hex digits of their IRI's SHA-256, eight or as many more as tell them apart;
 * a slug never holds `--`, so no such name is another thing's. Nothing but the things themselves decides an address,
 * never their order. A thing given twice keeps its first folder and name. The plain `<slug>.html` of things that share
 * one is for a page that lists them, see `sharedPageOf`.
 */
export async function addressesOf(
  things: readonly Named[],
): Promise<Map<string, string>> {
  const seen = new Set<string>();
  const once = things.filter(({ iri }) => !seen.has(iri) && seen.add(iri));
  const cut = new Map<string, Named[]>();
  for (const thing of once) {
    const key = `${thing.folder}/${pageSlug(thing, LONGEST)}`;
    cut.set(key, [...(cut.get(key) ?? []), thing]);
  }
  const sharing = new Map<string, Named[]>();
  for (const [key, group] of cut) {
    const full = group.map(
      (thing) => `${thing.folder}/${pageSlug(thing, Infinity)}`,
    );
    const apart = group.length > 1 && new Set(full).size === group.length;
    group.forEach((thing, at) => {
      const each = apart ? (full[at] ?? key) : key;
      sharing.set(each, [...(sharing.get(each) ?? []), thing]);
    });
  }
  const addresses = new Map<string, string>();
  for (const [key, group] of sharing) {
    if (group.length === 1) {
      addresses.set(group[0]?.iri ?? "", `${key}.html`);
      continue;
    }
    const digests = await Promise.all(
      group.map(async ({ iri }) => [iri, await digestOf(iri)] as const),
    );
    let length = SHORTEST;
    while (
      new Set(digests.map(([, digest]) => digest.slice(0, length))).size <
      digests.length
    )
      length += 1;
    for (const [iri, digest] of digests)
      addresses.set(iri, `${key}--${digest.slice(0, length)}.html`);
  }
  return addresses;
}

/** The vocabulary's folder of queries, with its slash. */
export const QUERIES_FOLDER = "queries/";

/** Where a query's path places it: its kind, for a named question the kind of thing it is about, and its name, its file's less `.rq`. */
export function queryPlace(path: string): {
  readonly group: string;
  readonly subject?: string;
  readonly name: string;
} {
  const parts = path.slice(QUERIES_FOLDER.length).split("/");
  const name = (parts.at(-1) ?? path).replace(/\.rq$/, "");
  const group = parts.length === 1 ? name : (parts[0] ?? name);
  const subject = parts[1];
  return group === "questions" && parts.length > 2 && subject !== undefined
    ? { group, subject, name }
    : { group, name };
}

/**
 * Each query's page from the site's root, by its path in the vocabulary: `queries/<kind>/<slug>.html`, a named question's
 * under its subject. Every query of the vocabulary is given, for one whose slug another shares is told apart.
 */
export function queryAddresses(
  paths: readonly string[],
): Promise<Map<string, string>> {
  return addressesOf(
    paths.map((path) => {
      const { group, subject, name } = queryPlace(path);
      return {
        iri: path,
        folder: `${QUERIES_FOLDER}${group}${subject === undefined ? "" : `/${subject}`}`,
        name,
        fallback: path,
      };
    }),
  );
}

/** The plain address the page that lists the things sharing a name has, for the address of one of them; none for an address that is alone. */
export function sharedPageOf(address: string): string | undefined {
  const shared = DIGESTED.exec(address)?.[1];
  return shared === undefined ? undefined : `${shared}.html`;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const NOTE_PATH = /^decisions\/([^/]+)\.md$/;

/**
 * A link to a file of the vocabulary, `path` being its path there. `base` is either the address of the vocabulary's files
 * on GitHub at the commit the pages were built from, which gives the file itself, or the folder of this site that holds
 * `decisions/` (`""`, `../`), which gives a decision note's page: `decisions/x.md` is `decisions/x.html` and
 * `decisions/README.md` is `decisions/index.html`. This site has pages for the notes alone.
 */
export function noteHref(path: string, base: string): string {
  const bare = path.replace(/^\/+/, "");
  if (SCHEME.test(base)) return `${away(base).replace(/\/*$/, "/")}${bare}`;
  const name = NOTE_PATH.exec(bare)?.[1];
  if (name === undefined)
    throw new Error(`${path} is no decision note, and only those have a page`);
  return `${base.replace(/(?<=.)\/*$/, "/")}decisions/${name === "README" ? "index" : name}.html`;
}

/** Where the files a link written in a note may point to are: GitHub's, and the pages of the notes when this site has them. */
export interface NoteLinks {
  /** The vocabulary's files at the commit built, ending in a slash. */
  readonly blob: string;
  /** The vocabulary's folders at the commit built, ending in a slash. */
  readonly tree: string;
  /** The folder of this site that holds `decisions/`, as {@link noteHref} takes it; absent when the notes have no pages. */
  readonly notes?: string;
  /** Whether a note has a page; a link to one that has none keeps its address on GitHub. Absent: every note has one. */
  readonly has?: (path: string) => boolean;
}

/**
 * Where a link written in the note at `from` points, `from` being the note's path in the vocabulary: a link to another
 * note is to its page when `notes` is given, any other relative link is to the file (or folder) on GitHub, an absolute one
 * is as written for http, https and mailto, and any other scheme has no address. A link to a place in the note itself
 * (`#why`) is not for this to resolve.
 */
export function noteLinkOf(
  href: string,
  from: string,
  { blob, tree, notes, has }: NoteLinks,
): string | undefined {
  const bare = [...href].filter((char) => char > " ").join("");
  if (SCHEME.test(bare))
    return /^(?:https?|mailto):/i.test(bare) ? href : undefined;
  const { pathname, search, hash } = new URL(
    href,
    `https://vocabulary.invalid/${from}`,
  );
  const path = pathname.slice(1);
  if (notes !== undefined && NOTE_PATH.test(path) && (has?.(path) ?? true))
    return `${noteHref(path, notes)}${hash}`;
  return `${path.endsWith("/") ? tree : blob}${path}${search}${hash}`;
}

export const FRONT_PAGE = "index.html";

/** The link back to the front page from a page `depth` folders below it, for the first place in its header. */
export const frontPageLink = (depth: number) =>
  markup`<a href="${"../".repeat(depth)}${FRONT_PAGE}">Cascade Protocol reference</a>`;
