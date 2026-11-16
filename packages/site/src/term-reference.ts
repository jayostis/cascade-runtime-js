import {
  featuresOf,
  type Files,
  Graph,
  type NamedNode,
  OxigraphStore,
  RDF,
  readText,
  RULE_LIST,
  readWrittenFeature,
  type Term,
  XSD,
} from "@cascade-runtime/runtime";
import { type Chrome, type Content, Html, markup, shell } from "./html.js";
import {
  NAMESPACE_HOST,
  ruleHref,
  termHref,
  termId,
  termPage,
} from "./links.js";
import { STYLESHEET_FILE } from "./site.js";
import { numberOf } from "./spec.js";
import { expanded, LOCAL_NAME, PROPERTY_TYPES, prefixed } from "./terms.js";

/** The term reference's page in the hub's tree; `termHref` links its entries from `terms/`. */
export const TERMS_PAGE = "terms/index.html";
export const TERMS_FOLDER = "terms/";
/** The Bridge's own vocabulary, beside the term reference so a page of one reaches the other by its file name. */
export const BRIDGE_TERMS_PAGE = "terms/bridge.html";
/** The shapes no term's page shows, in a folder of their own so the page's address is `terms/shapes/`. */
export const TERMS_SHAPES_PAGE = `${TERMS_FOLDER}shapes/index.html`;
export const BRIDGE_SHAPES_PAGE = `${TERMS_FOLDER}bridge-shapes/index.html`;

const ONTOLOGY = "ontologies/cascade.ttl";
const SHAPES = "ontologies/cascade.shapes.ttl";
const LAYOUT = "runtime/pod-layout.ttl";
const QUERIES = "queries";
const NOTES = "decisions";
/** A list of queries or rules longer than this is folded behind a summary. */
const FOLD_AFTER = 10;
/** The spec's pages, from this page. */
const SPEC = "../spec/";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL = "http://www.w3.org/2002/07/owl#";
const SKOS = "http://www.w3.org/2004/02/skos/core#";
const DCT = "http://purl.org/dc/terms/";
const SH = "http://www.w3.org/ns/shacl#";
const TYPE = `${RDF}type`;

const CLASSES = new Set([`${OWL}Class`, `${RDFS}Class`]);
const LABEL = [`${RDFS}label`, `${SKOS}prefLabel`];
const COMMENT = [`${RDFS}comment`, `${SKOS}definition`];
const SOURCE = [`${DCT}source`, `${RDFS}isDefinedBy`];
const LICENSE = `${DCT}license`;
const SEE_ALSO = `${RDFS}seeAlso`;
const DOMAIN = `${RDFS}domain`;
const RANGE = `${RDFS}range`;
const SUBCLASS = `${RDFS}subClassOf`;
const SUBPROPERTY = `${RDFS}subPropertyOf`;
const IN_SCHEME = `${SKOS}inScheme`;
/** What an entry shows in a field of its own, so its other statements are the rest. */
const SHOWN = new Set([
  IN_SCHEME,
  TYPE,
  ...LABEL,
  ...COMMENT,
  ...SOURCE,
  LICENSE,
  SEE_ALSO,
  DOMAIN,
  RANGE,
  SUBCLASS,
  SUBPROPERTY,
]);
/** What a shape says that is not a constraint: its targets, its property shapes, where it came from. */
const NOT_A_CONSTRAINT = new Set([
  TYPE,
  `${SH}targetClass`,
  `${SH}targetSubjectsOf`,
  `${SH}targetObjectsOf`,
  `${SH}targetNode`,
  `${SH}property`,
  `${SH}message`,
  `${SH}severity`,
  `${DCT}source`,
  `${DCT}license`,
  ...LABEL,
  ...COMMENT,
]);

/** What a vocabulary is called, by the prefix this site gives its names. */
const SOURCE_NAMES: Readonly<Record<string, string>> = {
  dcat: "DCAT",
  dct: "Dublin Core Terms",
  foaf: "FOAF",
  ldp: "LDP",
  oa: "Web Annotation",
  obo: "OBO",
  org: "the Organization ontology",
  owl: "OWL",
  pav: "PAV",
  pim: "Solid PIM",
  prov: "PROV-O",
  rdf: "RDF",
  rdfs: "RDF Schema",
  semapv: "SEMAPV",
  skos: "SKOS",
  solid: "Solid terms",
  sssom: "SSSOM",
  void: "VoID",
  xsd: "XML Schema",
};
const SOLID_FOR_CLASS = "http://www.w3.org/ns/solid/terms#forClass";
const HOLDS_RECORDS = `${CASCADE}holdsRecords`;
const ACTIVITY = "http://www.w3.org/ns/prov#Activity";
/** An abbreviation whose full stop does not end a sentence. */
const ABBREVIATED = /\b(?:e\.g|i\.e|etc|vs|cf)$/i;

/** The comment up to the full stop that ends its first sentence. */
function firstSentence(comment: string): string {
  for (const stop of comment.matchAll(/[.!?](?=\s|$)/g))
    if (!ABBREVIATED.test(comment.slice(0, stop.index)))
      return comment.slice(0, stop.index + 1);
  return comment;
}

/** The longest a class's gloss on the index is, its closing "…" counted. */
export const GLOSS_LIMIT = 100;

/** A comment's first sentence cut at its first colon or semicolon, or at a word before GLOSS_LIMIT, and closed with "…" when cut. */
export function gloss(comment: string): string {
  const sentence = firstSentence(comment).trim();
  const stop = sentence.search(/[:;](?=\s)/);
  const head = stop === -1 ? sentence : sentence.slice(0, stop);
  if (head.length <= GLOSS_LIMIT)
    return stop === -1 ? head : `${head.trimEnd()}…`;
  const room = head.slice(0, GLOSS_LIMIT - 1);
  const word = room.slice(0, room.lastIndexOf(" ") + 1 || room.length);
  return `${word.replace(/[\s,.:;]+$/, "")}…`;
}

type Kind = "class" | "property" | "thing";

interface Entry {
  readonly iri: string;
  readonly kind: Kind;
  readonly copied: boolean;
}

/** A rule of a feature file whose text writes a query's path. */
export interface RuleNaming {
  readonly path: string;
  readonly number: string;
  readonly name: string;
}

/** A decision note whose text writes a query's path. */
export interface NoteNaming {
  readonly path: string;
  readonly title: string;
}

export interface QueryNaming {
  readonly rules: RuleNaming[];
  readonly notes: NoteNaming[];
}

interface UsedBy {
  readonly queries: Map<string, string[]>;
  readonly rules: Map<string, { path: string; number: string; name: string }[]>;
  /** For each query's path, the rules and decision notes that write it. */
  readonly naming: Map<string, QueryNaming>;
}

/** `PREFIX p: <iri>` or `@prefix p: <iri> .`, as Turtle and SPARQL declare one. */
const DECLARED = /(?:@prefix|PREFIX)\s+([A-Za-z][\w.-]*)?:\s*<([^>]*)>/gi;
/** In a query, an IRI in brackets, a string or a comment: what a prefixed name is never read inside. */
const QUERY_TOKEN =
  /<([^<>"{}|^`\\\s]*)>|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|#[^\n]*/g;
/** A prefixed name, not part of a longer name, an address or a variable. */
const PREFIXED_NAME =
  /(?<![\w.:\-?$/#])([A-Za-z][\w.-]*)?:([A-Za-z_\d](?:[\w.-]*[\w-])?)/g;
const BRACKETED = /<([^<>"{}|^`\\\s]*)>/g;
const ADDRESS = /https?:\/\/[^\s<>"'`()[\]{}|\\^]+/g;

function declaredIn(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, prefix, namespace] of text.matchAll(DECLARED))
    found.set(prefix ?? "", namespace ?? "");
  return found;
}

/** Each IRI a query names, in brackets or by a prefix it declares; its strings and comments name none. */
export function namedInQuery(text: string): Set<string> {
  const prefixes = declaredIn(text);
  const named = new Set<string>();
  const rest = text.replace(QUERY_TOKEN, (_token, iri: string | undefined) => {
    if (iri !== undefined) named.add(iri);
    return " ";
  });
  for (const [, prefix, local] of rest.matchAll(PREFIXED_NAME)) {
    const namespace = prefixes.get(prefix ?? "");
    if (namespace !== undefined && local !== undefined)
      named.add(`${namespace}${local}`);
  }
  return named;
}

/** Each IRI prose names: in brackets, as an address, or by a prefix this site knows. */
export function namedInText(text: string): Set<string> {
  const named = new Set<string>();
  for (const [, iri] of text.matchAll(BRACKETED)) named.add(iri ?? "");
  for (const [address] of text.matchAll(ADDRESS))
    named.add(address.replace(/[.,;:]+$/, ""));
  for (const [, prefix, local] of text.matchAll(PREFIXED_NAME)) {
    const iri = expanded(prefix ?? "", local ?? "");
    if (iri !== undefined) named.add(iri);
  }
  return named;
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const held = map.get(key);
  if (held === undefined) map.set(key, [value]);
  else held.push(value);
}

async function usedBy(
  vocabulary: Files,
  terms: ReadonlySet<string>,
): Promise<UsedBy> {
  const queries = new Map<string, string[]>();
  const paths = (await vocabulary.list(QUERIES))
    .filter((path) => path.endsWith(".rq"))
    .sort();
  for (const path of paths)
    for (const iri of namedInQuery(await readText(vocabulary, path)))
      if (terms.has(iri)) pushTo(queries, iri, path);
  const rules = new Map<
    string,
    { path: string; number: string; name: string }[]
  >();
  const naming = new Map<string, QueryNaming>(
    paths.map((path) => [path, { rules: [], notes: [] }]),
  );
  const writing = (text: string): string[] => {
    const flat = text.replace(/\s+/g, " ");
    return paths.filter((path) => flat.includes(path));
  };
  for (const path of (await featuresOf(vocabulary)).sort()) {
    const feature = await readWrittenFeature(vocabulary, path);
    for (const rule of feature.rules) {
      const number = numberOf(rule);
      if (number === undefined) continue;
      const text = [
        rule.name,
        rule.description,
        ...rule.examples.map(({ text }) => text),
      ].join("\n");
      for (const iri of namedInText(text))
        if (terms.has(iri))
          pushTo(rules, iri, {
            number,
            path,
            name: rule.name,
          });
      for (const written of writing(text))
        naming.get(written)?.rules.push({ path, number, name: rule.name });
    }
  }
  for (const path of (await vocabulary.list(NOTES))
    .filter((note) => note.endsWith(".md"))
    .sort()) {
    const text = await readText(vocabulary, path);
    const title = /^# +(.+)$/m.exec(text)?.[1]?.trim() ?? path;
    for (const written of writing(text))
      naming.get(written)?.notes.push({ path, title });
  }
  return { queries, rules, naming };
}

const used = new WeakMap<Files, Promise<UsedBy>>();

/**
 * What names each term and each query, read once for a vocabulary: the term reference and the query pages share it. The
 * cache is per `Files` object, which is assumed not to change after it is first read.
 */
function usedByOnce(
  vocabulary: Files,
  terms: ReadonlySet<string>,
): Promise<UsedBy> {
  const held = used.get(vocabulary);
  if (held !== undefined) return held;
  const made = usedBy(vocabulary, terms);
  used.set(vocabulary, made);
  return made;
}

const isString = (term: Term): boolean =>
  term.termType === "Literal" &&
  (term.datatype.value === `${XSD}string` ||
    term.datatype.value === `${RDF}langString`);

/** The page, from what is read: the ontology, its shapes and what names their terms. */
class Reference {
  readonly #ontology: Graph;
  readonly #shapes: Graph;
  readonly #entries: ReadonlyMap<string, Entry>;
  readonly #prefixes: ReadonlyMap<string, string>;
  readonly #used: UsedBy | undefined;
  readonly #nodeShapes: readonly NamedNode[];
  readonly #tree: string;
  /** The vocabulary's files on GitHub at the commit read, ending in a slash. */
  readonly blob: string;

  constructor(
    ontology: Graph,
    shapes: Graph,
    entries: ReadonlyMap<string, Entry>,
    prefixes: ReadonlyMap<string, string>,
    used: UsedBy | undefined,
    tree: string,
    /** The folder of term pages from the page being written: `""` on the index, `../` on a term's page, `../../` on a property's. */
    public base: string,
    /** The index page's file name in the folder of term pages, and its title. */
    readonly index: string,
    readonly title: string,
    /** The page of the shapes no entry holds, in the folder of term pages. */
    readonly shapesPage: string,
  ) {
    this.#tree = tree;
    this.blob = tree.includes("/tree/")
      ? tree.replace("/tree/", "/blob/")
      : tree;
    this.#ontology = ontology;
    this.#shapes = shapes;
    this.#entries = entries;
    this.#prefixes = prefixes;
    this.#used = used;
    const named = new Map<string, NamedNode>();
    for (const [subject, predicate, object] of shapes.triples)
      if (
        subject.termType === "NamedNode" &&
        ((predicate.value === TYPE && object.value === `${SH}NodeShape`) ||
          predicate.value === `${SH}targetClass` ||
          predicate.value === `${SH}targetSubjectsOf` ||
          predicate.value === `${SH}property`)
      )
        named.set(subject.value, subject);
    this.#nodeShapes = [...named.values()]
      .filter(({ value }) => !entries.has(value))
      .sort((a, b) => this.name(a.value).localeCompare(this.name(b.value)));
    for (const shape of this.#nodeShapes) {
      const classes = shapes
        .objects(shape, `${SH}targetClass`)
        .map(({ value }) => value)
        .filter((iri) => entries.get(iri)?.kind === "class")
        .sort((a, b) => this.name(a).localeCompare(this.name(b)));
      const properties = shapes
        .objects(shape, `${SH}targetSubjectsOf`)
        .map(({ value }) => value)
        .filter((iri) => entries.get(iri)?.kind === "property")
        .sort((a, b) => this.name(a).localeCompare(this.name(b)));
      this.#homes.set(shape.value, classes[0] ?? properties[0]);
    }
  }

  /** Where each shape's anchor is: the entry of the first class it checks, else of the first property whose subjects it checks, or undefined for the shapes' own part. */
  readonly #homes = new Map<string, string | undefined>();

  /** The shapes no entry holds: those reached by another shape's node, and those whose class or property has no entry. */
  get unhomed(): NamedNode[] {
    return this.#nodeShapes.filter(
      ({ value }) => this.#homes.get(value) === undefined,
    );
  }

  /** The IRI as a prefixed name, by this site's prefixes or the files' own, or else whole. */
  name(iri: string): string {
    const file = this.#file(iri);
    if (file !== undefined) return file;
    const known = prefixed(iri);
    if (known !== undefined) return known;
    for (const [prefix, namespace] of this.#prefixes) {
      const local = iri.slice(namespace.length);
      if (iri.startsWith(namespace) && LOCAL_NAME.test(local))
        return `${prefix}:${local}`;
    }
    return iri;
  }

  /** A name a file of the vocabulary gives with a relative IRI, as `file#Name` (or the file's own name), else undefined. */
  #file(iri: string): string | undefined {
    if (!iri.startsWith(this.#tree)) return undefined;
    return iri.slice(this.#tree.length).replace(/^.*\//, "");
  }

  /** Whether a file of the vocabulary names the IRI relatively, as `file#Name`, so it has no address of its own to show. */
  relative(iri: string): boolean {
    return this.#file(iri) !== undefined;
  }

  /** The id an anchor of the IRI has: a shape of a file as `file#Name`, else the term's. */
  id(iri: string): string {
    return this.#file(iri) ?? termId(iri);
  }

  /**
   * Where a link to the IRI goes from this page: a term's page, a shape another shape sends a value to on the page of
   * the entry it is at home on, else on the page of the shapes no entry holds; a shape of a file at home on the index.
   */
  #href(iri: string): string {
    const file = this.#file(iri);
    const unhomed = this.#homes.has(iri) && this.#homes.get(iri) === undefined;
    if (file !== undefined)
      return `${unhomed ? `${this.base}${this.shapesPage}` : this.base === "" ? "" : `${this.base}${this.index}`}#${encodeURIComponent(file)}`;
    if (this.#entries.has(iri)) return this.page(iri);
    const home = this.#homes.get(iri);
    return home === undefined
      ? `${this.base}${this.shapesPage}#${termId(iri)}`
      : `${this.page(home)}#${termId(iri)}`;
  }

  /** The ids of the shapes no entry holds, which the index no longer holds. */
  get movedIds(): string[] {
    return ["shapes", ...this.unhomed.map(({ value }) => this.id(value))];
  }

  /**
   * The entries in groups under a heading each, by what `split` names: the class a property is said of, the scheme or
   * class a named thing is of, the prefix of a term copied from elsewhere. A group of the odd ones out comes last.
   */
  split(
    entries: readonly Entry[],
    split: "domain" | "scheme" | "prefix",
  ): { title: string; code: boolean; entries: Entry[] }[] {
    const groups = new Map<string, { code: boolean; entries: Entry[] }>();
    for (const entry of entries) {
      const { title, code } = this.#heading(entry, split);
      const held = groups.get(title) ?? { code, entries: [] };
      groups.set(title, held);
      held.entries.push(entry);
    }
    return [...groups]
      .map(([title, { code, entries }]) => ({ title, code, entries }))
      .sort(
        (a, b) =>
          Number(!a.code) - Number(!b.code) || a.title.localeCompare(b.title),
      );
  }

  #heading(
    { iri }: Entry,
    split: "domain" | "scheme" | "prefix",
  ): { title: string; code: boolean } {
    const named = (terms: readonly Term[]): string[] =>
      terms
        .filter(({ termType }) => termType === "NamedNode")
        .map(({ value }) => this.name(value))
        .sort();
    if (split === "domain") {
      const domains = named(this.objects(iri, [DOMAIN]));
      return domains.length === 1
        ? { title: domains[0] as string, code: true }
        : { title: "Said of many kinds", code: false };
    }
    if (split === "scheme") {
      const [scheme] = named(this.objects(iri, [IN_SCHEME]));
      if (scheme !== undefined) return { title: scheme, code: true };
      const [type] = named(
        this.objects(iri, [TYPE]).filter(
          ({ value }) => value !== `${OWL}NamedIndividual`,
        ),
      );
      return type === undefined
        ? { title: "Named on their own", code: false }
        : { title: type, code: true };
    }
    const prefix = this.name(iri).split(":")[0] ?? "";
    return /^[A-Za-z][\w.-]*$/.test(prefix) && this.name(iri) !== iri
      ? { title: prefix, code: true }
      : { title: "Other", code: false };
  }

  /** The address of the entry's page from the page being written. */
  page(iri: string): string {
    return termHref(
      iri,
      this.base,
      this.#entries.get(iri)?.kind === "property",
    );
  }

  /** The empty anchors of the shapes at home on the entry, which the index keeps so an old link to a shape lands on its term's row. */
  anchors(iri: string): Html {
    return markup`${this.#nodeShapes
      .filter((shape) => this.#homes.get(shape.value) === iri)
      .map((shape) => markup`<span id="${this.id(shape.value)}"></span>`)}`;
  }

  /** A term as a name: a link to its entry where it has one, else text. */
  term(iri: string): Html {
    return this.#entries.has(iri) || this.#homes.has(iri)
      ? markup`<a href="${this.#href(iri)}"><code>${this.name(iri)}</code></a>`
      : markup`<code>${this.name(iri)}</code>`;
  }

  /** An address to follow: its entry, the page itself, or text where it is on the namespace's host. */
  link(iri: string): Html {
    if (this.#entries.has(iri) || this.#homes.has(iri)) return this.term(iri);
    if (this.#file(iri) !== undefined) return this.term(iri);
    if (/^https?:\/\//i.test(iri) && !NAMESPACE_HOST.test(iri))
      return markup`<a href="${iri}">${iri}</a>`;
    return markup`<code>${iri}</code>`;
  }

  /** A value as the files write it: a list in parentheses, a blank node's statements in brackets. */
  value(graph: Graph, term: Term, seen = new Set<string>()): Html {
    if (term.termType === "NamedNode") return this.term(term.value);
    if (term.termType === "Literal") {
      if (term.value.includes("\n"))
        return markup`<pre><code>${term.value.trim()}</code></pre>`;
      return markup`<code>${isString(term) ? JSON.stringify(term.value) : term.value}</code>`;
    }
    if (seen.has(term.value)) return markup`<code>[…]</code>`;
    const inner = new Set([...seen, term.value]);
    const items = this.list(graph, term);
    if (items !== undefined)
      return markup`( ${items.map((item, index) => markup`${index === 0 ? "" : " "}${this.value(graph, item, inner)}`)} )`;
    return markup`[ ${this.statements(graph, term, new Set(), inner)} ]`;
  }

  /** The members of an RDF list, or undefined when the node is not one. */
  list(graph: Graph, node: Term): Term[] | undefined {
    const items: Term[] = [];
    let at: Term = node;
    while (at.termType === "BlankNode") {
      const first = graph.objects(at, `${RDF}first`);
      const rest = graph.objects(at, `${RDF}rest`);
      if (first.length !== 1 || rest.length !== 1) return undefined;
      items.push(first[0] as Term);
      at = rest[0] as Term;
    }
    return at.termType === "NamedNode" && at.value === `${RDF}nil`
      ? items
      : undefined;
  }

  /** A node's statements, each predicate once with its values: SHACL's by their local names. */
  statements(
    graph: Graph,
    node: Term,
    leaving: ReadonlySet<string>,
    seen = new Set<string>(),
  ): Html {
    const byPredicate = new Map<string, Term[]>();
    for (const [, predicate, object] of graph.match(node))
      if (!leaving.has(predicate.value))
        pushTo(byPredicate, predicate.value, object);
    return markup`${[...byPredicate].map(
      ([predicate, objects], index) =>
        markup`${index === 0 ? "" : "; "}${predicate === TYPE ? "a" : predicate.startsWith(SH) ? predicate.slice(SH.length) : this.name(predicate)} ${objects.map((object, i) => markup`${i === 0 ? "" : ", "}${this.value(graph, object, seen)}`)}`,
    )}`;
  }

  /** What the shapes say of the node: its message and, when it is not a violation, its severity. */
  said(node: Term): Html {
    const message =
      this.#shapes
        .objects(node, `${SH}message`)
        .find(
          (term) => term.termType === "Literal" && term.language === "en",
        ) ?? this.#shapes.objects(node, `${SH}message`)[0];
    const severity = this.#shapes
      .objects(node, `${SH}severity`)
      .find((term) => term.value !== `${SH}Violation`);
    return markup`${severity === undefined ? "" : markup` <span class="about">${severity.value.slice(SH.length).toLowerCase()}</span>`}${message === undefined ? "" : markup` <q>${message.value}</q>`}`;
  }

  /** The IRIs a path reaches: the property, the one it is the inverse of, each of a sequence. */
  pathsIn(path: Term): Set<string> {
    if (path.termType === "NamedNode") return new Set([path.value]);
    return new Set(
      this.#shapes
        .closure(path)
        .flatMap(([, , object]) =>
          object.termType === "NamedNode" && object.value !== `${RDF}nil`
            ? [object.value]
            : [],
        ),
    );
  }

  /** The IRIs the paths of a property shape reach. */
  pathsOf(propertyShape: Term): Set<string> {
    return new Set(
      this.#shapes
        .objects(propertyShape, `${SH}path`)
        .flatMap((path) => [...this.pathsIn(path)]),
    );
  }

  /** The IRIs the paths inside a whole-node constraint reach. */
  pathsUnder(constraint: Term): Set<string> {
    if (constraint.termType !== "BlankNode") return new Set();
    return new Set(
      this.#shapes
        .closure(constraint)
        .filter(([, predicate]) => predicate.value === `${SH}path`)
        .flatMap(([, , path]) => [...this.pathsIn(path)]),
    );
  }

  key(predicate: string): string {
    if (predicate === TYPE) return "a";
    return predicate.startsWith(SH)
      ? predicate.slice(SH.length)
      : this.name(predicate);
  }

  names(terms: readonly Term[]): Html {
    return markup`${terms.map((term, index) => markup`${index === 0 ? "" : ", "}${this.term(term.value)}`)}`;
  }

  /** A property shape as a line, led by its path, or by where it is when it is shown on its property's entry. */
  propertyLine(propertyShape: Term, lead?: Html): Html {
    const paths = this.#shapes.objects(propertyShape, `${SH}path`);
    const shown =
      lead ??
      markup`${paths.map((path, index) => markup`${index === 0 ? "" : ", "}${this.value(this.#shapes, path)}`)}`;
    return markup`<li>${shown}: ${this.statements(this.#shapes, propertyShape, new Set([`${SH}path`, `${SH}message`, `${SH}severity`]))}${this.said(propertyShape)}</li>\n`;
  }

  /** A shape's own constraints, those not on one property. */
  wide(shape: NamedNode): [NamedNode, Term][] {
    return this.#shapes
      .match(shape)
      .filter(([, predicate]) => !NOT_A_CONSTRAINT.has(predicate.value))
      .map(([, predicate, object]) => [predicate, object]);
  }

  constraint(predicate: NamedNode, object: Term): Html {
    return markup`${this.key(predicate.value)} ${this.value(this.#shapes, object)}`;
  }

  /** The shape, what it checks, and where it was copied from. */
  targets(shape: NamedNode): Html {
    const classes = this.#shapes.objects(shape, `${SH}targetClass`);
    const subjectsOf = this.#shapes.objects(shape, `${SH}targetSubjectsOf`);
    const sources = this.#shapes.objects(shape, `${DCT}source`);
    const parts = [
      ...(classes.length === 0 ? [] : [markup`each ${this.names(classes)}`]),
      ...(subjectsOf.length === 0
        ? []
        : [markup`the subject of any ${this.names(subjectsOf)}`]),
    ];
    return markup`<p><code>${this.name(shape.value)}</code> checks ${parts.length === 0 ? "what another shape sends it" : parts.map((part, i) => markup`${i === 0 ? "" : ", and "}${part}`)}.${sources.length === 0 ? "" : markup` <span class="about">Source: ${sources.map((s, i) => markup`${i === 0 ? "" : ", "}${this.link(s.value)}`)}</span>`}</p>\n`;
  }

  /** The shapes that target the class, each whole. */
  classShapes(iri: string): Html[] {
    return this.#nodeShapes
      .filter((shape) =>
        this.#shapes
          .objects(shape, `${SH}targetClass`)
          .some((target) => target.value === iri),
      )
      .map((shape) => this.table(shape, this.#homes.get(shape.value) === iri));
  }

  /** The shape whole: what it checks, its whole-node constraints and its property shapes; its anchor where it is at home. */
  shape(shape: NamedNode, home: boolean): Html {
    const wide = this.wide(shape);
    const properties = this.#shapes.objects(shape, `${SH}property`);
    return markup`<div class="shape"${home ? markup` id="${this.id(shape.value)}"` : ""}>${this.targets(shape)}${wide.length === 0 ? "" : markup`<p>On the whole node: ${wide.map(([predicate, object], i) => markup`${i === 0 ? "" : "; "}${this.constraint(predicate, object)}`)}${this.said(shape)}</p>\n`}${properties.length === 0 ? "" : markup`<ul>\n${properties.map((p) => this.propertyLine(p))}</ul>\n`}</div>\n`;
  }

  /** The shapes at home on the property's entry, each whole. */
  homedOn(iri: string): Html[] {
    return this.#nodeShapes
      .filter((shape) => this.#homes.get(shape.value) === iri)
      .map((shape) => this.shape(shape, true));
  }

  #byProperty: Map<string, Html[]> | undefined;

  /**
   * Each line the shapes give the property: a property shape on its path, a whole-node constraint that names it, or a
   * shape that checks whatever it is said of. Made once for every property.
   */
  propertyShapes(iri: string): Html[] {
    if (this.#byProperty === undefined) {
      const lines = new Map<string, Html[]>();
      for (const shape of this.#nodeShapes) {
        const classes = this.#shapes.objects(shape, `${SH}targetClass`);
        const where = markup`<code>${this.name(shape.value)}</code>${classes.length === 0 ? "" : markup`, on each ${this.names(classes)}`}`;
        const named = new Set<string>();
        for (const propertyShape of this.#shapes.objects(
          shape,
          `${SH}property`,
        )) {
          const line = this.propertyLine(propertyShape, where);
          for (const path of this.pathsOf(propertyShape)) {
            pushTo(lines, path, line);
            named.add(path);
          }
        }
        for (const [predicate, object] of this.wide(shape)) {
          const line = markup`<li>${where}, on the whole node: ${this.constraint(predicate, object)}${this.said(shape)}</li>\n`;
          for (const path of this.pathsUnder(object)) {
            pushTo(lines, path, line);
            named.add(path);
          }
        }
        for (const target of this.#shapes.objects(
          shape,
          `${SH}targetSubjectsOf`,
        ))
          if (!named.has(target.value))
            pushTo(
              lines,
              target.value,
              markup`<li>${where}, on the subject of any statement of it.</li>\n`,
            );
      }
      this.#byProperty = lines;
    }
    return this.#byProperty.get(iri) ?? [];
  }

  texts(iri: string, predicates: readonly string[]): string[] {
    const subject = { termType: "NamedNode", value: iri } as const;
    return predicates.flatMap((predicate) => {
      const values = this.#ontology
        .objects(subject, predicate)
        .filter((term) => term.termType === "Literal");
      const english = values.filter((term) => term.language === "en");
      return (english.length > 0 ? english : values).map(({ value }) => value);
    });
  }

  objects(iri: string, predicates: readonly string[]): Term[] {
    const subject = { termType: "NamedNode", value: iri } as const;
    return predicates.flatMap((predicate) =>
      this.#ontology.objects(subject, predicate),
    );
  }

  /** The values, as names. */
  values(terms: readonly Term[]): Content {
    return terms.map(
      (term, index) =>
        markup`${index === 0 ? "" : ", "}${this.value(this.#ontology, term)}`,
    );
  }

  links(terms: readonly Term[]): Content {
    return terms.map(
      (term, index) =>
        markup`${index === 0 ? "" : ", "}${term.termType === "NamedNode" ? this.link(term.value) : this.value(this.#ontology, term)}`,
    );
  }

  /** The terms whose statement of the predicate has this one as its value. */
  pointing(predicate: string, iri: string): Term[] {
    return this.#ontology
      .subjects(predicate, { termType: "NamedNode", value: iri })
      .filter((subject) => this.#entries.has(subject.value))
      .sort((a, b) => this.name(a.value).localeCompare(this.name(b.value)));
  }

  /** A list behind a summary of its length when it is longer than FOLD_AFTER. */
  folded(count: number, noun: string, list: Html): Html {
    return count > FOLD_AFTER
      ? markup`<details><summary>${count} ${noun}</summary>\n${list}</details>`
      : list;
  }

  field(name: string, value: Content): Html {
    return markup`<dt>${name}</dt><dd>${value}</dd>\n`;
  }

  /** A field of names, or nothing when there are none. */
  listed(name: string, terms: readonly Term[]): Html | "" {
    return terms.length === 0 ? "" : this.field(name, this.values(terms));
  }

  /** A field of links, or nothing when there are none. */
  linked(name: string, terms: readonly Term[]): Html | "" {
    return terms.length === 0 ? "" : this.field(name, this.links(terms));
  }

  /** The vocabulary a copied term is from, by its name's prefix as this site knows it. */
  sourceName(iri: string): string {
    const prefix = prefixed(iri)?.split(":")[0];
    return (
      (prefix === undefined ? undefined : SOURCE_NAMES[prefix]) ??
      prefix ??
      this.objects(iri, SOURCE)[0]?.value ??
      iri
    );
  }

  /** What an entry says where its comment would be: the comment, or that there is none yet, or where a copy is from. */
  definition({ iri, copied }: Entry): Html | Html[] {
    const comments = this.texts(iri, COMMENT);
    if (comments.length > 0)
      return comments.map(
        (comment) => markup`<p class="prose">${comment}</p>\n`,
      );
    return copied
      ? markup`<p class="prose about">from ${this.sourceName(iri)}</p>\n`
      : markup`<p class="prose about">No definition yet.</p>\n`;
  }

  /** A class of the index: its label, and under it its name and a short gloss of its comment, the whole first sentence on hover. */
  summary(entry: Entry): Html {
    const { iri } = entry;
    const label = this.texts(iri, LABEL)[0];
    const [comment] = this.texts(iri, COMMENT);
    const short = comment === undefined ? undefined : gloss(comment);
    const whole = comment === undefined ? "" : firstSentence(comment).trim();
    return markup`<li id="${termId(iri)}">${this.anchors(iri)}<a href="${this.page(iri)}">${label ?? this.name(iri)}</a><span class="about"><code>${this.name(iri)}</code> ${short === undefined ? "No definition yet." : markup`<span class="gloss"${short === whole ? "" : markup` title="${whole}"`}>${short}</span>`}</span></li>\n`;
  }

  /** The classes below the class, however far. */
  below(iri: string): Set<string> {
    const found = new Set<string>();
    const queue = [iri];
    for (let next = queue.pop(); next !== undefined; next = queue.pop())
      for (const sub of this.#ontology.subjects(SUBCLASS, {
        termType: "NamedNode",
        value: next,
      }))
        if (!found.has(sub.value)) {
          found.add(sub.value);
          queue.push(sub.value);
        }
    return found;
  }

  /** How many of a value a property shape allows, in words, or "" when it says nothing. */
  count(propertyShape: Term): string {
    const number = (predicate: string): string | undefined =>
      this.#shapes.objects(propertyShape, `${SH}${predicate}`)[0]?.value;
    const min = number("minCount");
    const max = number("maxCount");
    if (min === undefined && max === undefined) return "";
    if (min !== undefined && min === max) return `exactly ${min}`;
    if (max === undefined) return `at least ${min}`;
    if (min === undefined || min === "0") return `at most ${max}`;
    return `${min} to ${max}`;
  }

  /** A property shape as a row: its property, the value type it takes, how many, and what it says when it is not met. */
  row(propertyShape: Term): Html {
    const of = (...names: string[]): Term[] =>
      names.flatMap((name) =>
        this.#shapes.objects(propertyShape, `${SH}${name}`),
      );
    const types = of("datatype", "class", "node", "nodeKind");
    const shown = new Set(
      [
        "path",
        "message",
        "severity",
        "minCount",
        "maxCount",
        "datatype",
        "class",
        "node",
        "nodeKind",
      ].map((name) => `${SH}${name}`),
    );
    const others = this.#shapes
      .match(propertyShape)
      .some(([, predicate]) => !shown.has(predicate.value));
    return markup`<tr><td data-label="Property">${of("path").map((path, index) => markup`${index === 0 ? "" : ", "}${this.value(this.#shapes, path)}`)}</td><td data-label="Value type">${this.names(types)}${others ? markup`${types.length === 0 ? "" : " "}${this.statements(this.#shapes, propertyShape, shown)}` : ""}</td><td data-label="How many">${this.count(propertyShape)}</td><td data-label="When it is not met">${this.said(propertyShape)}</td></tr>\n`;
  }

  /** The shape whole, as a table of its properties; its anchor where it is at home. */
  table(shape: NamedNode, home: boolean): Html {
    const wide = this.wide(shape);
    const properties = this.#shapes.objects(shape, `${SH}property`);
    return markup`<div class="shape"${home ? markup` id="${this.id(shape.value)}"` : ""}>${this.targets(shape)}${
      properties.length === 0
        ? ""
        : markup`<table>
<thead><tr><th>Property</th><th>Value type</th><th>How many</th><th>When it is not met</th></tr></thead>
<tbody>
${properties.map((property) => this.row(property))}</tbody></table>
`
    }${wide.length === 0 ? "" : markup`<p>On the whole node: ${wide.map(([predicate, object], i) => markup`${i === 0 ? "" : "; "}${this.constraint(predicate, object)}`)}${this.said(shape)}</p>\n`}</div>\n`;
  }

  /** What the term is stated to belong to and what belongs with it, where it is in a scheme or is one. */
  scheme(iri: string): Html[] {
    const schemes = this.objects(iri, [IN_SCHEME]);
    const members = this.pointing(IN_SCHEME, iri);
    return [
      ...(schemes.length === 0
        ? []
        : [
            this.field("In the scheme", this.links(schemes)),
            ...schemes.map((scheme) => {
              const others = this.pointing(IN_SCHEME, scheme.value).filter(
                ({ value }) => value !== iri,
              );
              return others.length === 0
                ? markup``
                : this.field(
                    `Other members of ${this.name(scheme.value)}`,
                    this.folded(
                      others.length,
                      "members",
                      markup`<p class="terms">${others.map((member, at) => markup`${at === 0 ? "" : " · "}${this.term(member.value)}`)}</p>`,
                    ),
                  );
            }),
          ]),
      ...(members.length === 0
        ? []
        : [
            this.field(
              "Members",
              this.folded(
                members.length,
                "members",
                markup`<p class="terms">${members.map((member, at) => markup`${at === 0 ? "" : " · "}${this.term(member.value)}`)}</p>`,
              ),
            ),
          ]),
    ];
  }

  #lists: Map<string, Map<string, Set<string>>> | undefined;

  /** The properties whose `sh:in` list holds the named thing, each with every value of its lists. */
  listsOf(iri: string): [property: string, values: Set<string>][] {
    if (this.#lists === undefined) {
      const found = new Map<string, Map<string, Set<string>>>();
      for (const shape of this.#shapes.subjects(`${SH}in`)) {
        const paths = this.#shapes
          .objects(shape, `${SH}path`)
          .filter(({ termType }) => termType === "NamedNode");
        const values = this.#shapes
          .objects(shape, `${SH}in`)
          .flatMap((head) => this.list(this.#shapes, head) ?? [])
          .filter(({ termType }) => termType === "NamedNode");
        for (const { value: path } of paths)
          for (const { value } of values) {
            const properties = found.get(value) ?? new Map();
            found.set(value, properties);
            const held = properties.get(path) ?? new Set();
            properties.set(path, held);
            for (const each of values) held.add(each.value);
          }
      }
      this.#lists = found;
    }
    return [...(this.#lists.get(iri) ?? [])].sort(([a], [b]) =>
      this.name(a).localeCompare(this.name(b)),
    );
  }

  /** The names, but the one left out, as the links of a paragraph, folded when there are many. */
  others(iris: Iterable<string>, leaving: string, noun: string): Html | "" {
    const rest = [...iris]
      .filter((iri) => iri !== leaving)
      .sort((a, b) => this.name(a).localeCompare(this.name(b)));
    return rest.length === 0
      ? ""
      : this.folded(
          rest.length,
          noun,
          markup`<p class="terms">${rest.map((iri, at) => markup`${at === 0 ? "" : " · "}${this.term(iri)}`)}</p>`,
        );
  }

  /**
   * What a named thing sits beside when no scheme holds it: the properties whose `sh:in` list allows it, with the other values
   * of each list, and the other instances of each class it is an instance of, but "a named individual", which says nothing.
   */
  neighbours(iri: string): Html[] {
    const lists = this.listsOf(iri);
    const classes = this.objects(iri, [TYPE]).filter(
      ({ termType, value }) =>
        termType === "NamedNode" && value !== `${OWL}NamedIndividual`,
    );
    const field = (name: string, rest: Html | ""): Html | "" =>
      rest === "" ? "" : this.field(name, rest);
    return [
      ...(lists.length === 0
        ? []
        : [
            this.field(
              "Allowed value of",
              lists.map(
                ([property], at) =>
                  markup`${at === 0 ? "" : ", "}${this.term(property)}`,
              ),
            ),
          ]),
      ...lists.map(([property, values]) =>
        field(
          `Other values of ${this.name(property)}`,
          this.others(values, iri, "values"),
        ),
      ),
      ...classes.map(({ value: type }) =>
        field(
          `Other instances of ${this.name(type)}`,
          this.others(
            this.#ontology
              .subjects(TYPE, { termType: "NamedNode", value: type })
              .filter(({ value }) => this.#entries.has(value))
              .map(({ value }) => value),
            iri,
            "instances",
          ),
        ),
      ),
    ].filter((one): one is Html => one !== "");
  }

  /** What `terms.json` says of an entry. */
  fields({ iri, kind, copied }: Entry): Record<string, unknown> {
    const values = (predicates: readonly string[]): string[] =>
      this.objects(iri, predicates).map(({ value }) => value);
    return {
      id: termId(iri),
      iri,
      name: this.name(iri),
      kind,
      copied,
      page: termPage(iri, kind === "property"),
      label: this.texts(iri, LABEL)[0] ?? null,
      comment: this.texts(iri, COMMENT)[0] ?? null,
      type: values([TYPE]),
      subClassOf: values([SUBCLASS]),
      subPropertyOf: values([SUBPROPERTY]),
      domain: values([DOMAIN]),
      range: values([RANGE]),
      inScheme: values([IN_SCHEME]),
      source: values(SOURCE),
      license: values([LICENSE]),
      seeAlso: values([SEE_ALSO]),
    };
  }

  /**
   * The page of one term: what it is, the shape that checks it, then, closed, where it comes from and what uses it. A
   * property's page is a folder deeper than the others', so every address on it climbs one level more.
   */
  entry(entry: Entry, chrome: Chrome): string {
    const base = this.base;
    if (entry.kind === "property") this.base = `../${base}`;
    try {
      return this.#entry(entry, chrome, entry.kind === "property" ? "../" : "");
    } finally {
      this.base = base;
    }
  }

  #entry(entry: Entry, chrome: Chrome, deeper: string): string {
    const { iri, kind } = entry;
    const label = this.texts(iri, LABEL);
    const subject = { termType: "NamedNode", value: iri } as const;
    const rest = this.#ontology
      .match(subject)
      .filter(([, predicate]) => !SHOWN.has(predicate.value));
    const shapes = kind === "property" ? this.propertyShapes(iri) : [];
    const homed = kind === "property" ? this.homedOn(iri) : [];
    const tables = kind === "class" ? this.classShapes(iri) : [];
    const queries = this.#used?.queries.get(iri) ?? [];
    const rules = this.#used?.rules.get(iri) ?? [];
    const open = [
      this.listed("Type", this.objects(iri, [TYPE])),
      ...(kind === "class"
        ? [
            this.listed("Domain of", this.pointing(DOMAIN, iri)),
            this.listed("Range of", this.pointing(RANGE, iri)),
          ]
        : kind === "property"
          ? [
              this.listed("Domain", this.objects(iri, [DOMAIN])),
              this.listed("Range", this.objects(iri, [RANGE])),
              this.listed("Subproperty of", this.objects(iri, [SUBPROPERTY])),
            ]
          : [...this.scheme(iri), ...this.neighbours(iri)]),
      shapes.length + homed.length === 0
        ? ""
        : this.field(
            "Shapes",
            markup`${shapes.length === 0 ? "" : markup`<ul>\n${shapes}</ul>\n`}${homed}`,
          ),
    ].filter((field) => field !== "");
    const closed = [
      kind === "class"
        ? this.listed("Subclass of", this.objects(iri, [SUBCLASS]))
        : "",
      this.linked("Source", this.objects(iri, SOURCE)),
      this.linked("License", this.objects(iri, [LICENSE])),
      this.linked("See also", this.objects(iri, [SEE_ALSO])),
      rest.length === 0
        ? ""
        : this.field(
            "Also stated",
            markup`<ul>\n${rest.map(([, predicate, object]) => markup`<li>${this.term(predicate.value)} ${this.value(this.#ontology, object)}</li>\n`)}</ul>`,
          ),
      queries.length === 0
        ? ""
        : this.field(
            "Queries",
            this.folded(
              queries.length,
              "queries",
              markup`<ul>\n${queries.map((path) => markup`<li><a href="${this.blob}${encodeURI(path)}">${path}</a></li>\n`)}</ul>`,
            ),
          ),
      rules.length === 0
        ? ""
        : this.field(
            "Rules",
            this.folded(
              rules.length,
              "rules",
              markup`<ul>\n${rules.map(({ path, number, name }) => markup`<li><a href="${ruleHref(path, number, `${this.base}${SPEC}`)}">${name}</a> <span class="about">${path}</span></li>\n`)}</ul>`,
            ),
          ),
    ].filter((field) => field !== "");
    const name = this.name(iri);
    return shell({
      chrome,
      title: name,
      stylesheet: `${deeper}../../${STYLESHEET_FILE}`,
      hubRoot: `${deeper}../../`,
      nav: markup`<a href="${deeper}../../index.html">Cascade Protocol reference</a> · <a href="${deeper}../${this.index}">${this.title}</a>\n`,
      main: markup`<section class="term">
<h1 id="${termId(iri)}"><code>${name}</code>${label.length === 0 ? "" : markup` ${label.join(" / ")}`}</h1>
<p class="iri">${iri}</p>
${this.definition(entry)}${open.length === 0 ? "" : markup`<dl class="layout">\n${open}</dl>\n`}${tables}${closed.length === 0 ? "" : markup`<details>\n<summary>Where it comes from and what uses it</summary>\n<dl class="layout">\n${closed}</dl>\n</details>\n`}</section>
`,
    }).text;
  }
}

interface Group {
  readonly id: string;
  readonly title: string;
  readonly about: string;
  readonly holds: (entry: Entry) => boolean;
  /** What the group's list is folded into groups by; none leaves it a list. */
  readonly split?: "domain" | "scheme" | "prefix";
}

const GROUPS: readonly Group[] = [
  {
    id: "classes",
    title: "Classes",
    about: "What a thing in a pod is.",
    holds: ({ kind, copied }) => !copied && kind === "class",
  },
  {
    id: "properties",
    title: "Properties",
    about: "What a pod says of a thing.",
    holds: ({ kind, copied }) => !copied && kind === "property",
    split: "domain",
  },
  {
    id: "named-things",
    title: "Named things",
    about:
      "The code systems, kinds of table, concepts and other things the vocabulary names, which a pod's statements point at.",
    holds: ({ kind, copied }) => !copied && kind === "thing",
    split: "scheme",
  },
  {
    id: "copied",
    title: "Terms from other vocabularies",
    about:
      "Terms of PROV-O, PAV, FOAF and other vocabularies that a pod uses, as cascade.ttl declares them, each with its source: their meaning is their source's.",
    holds: ({ copied }) => copied,
    split: "prefix",
  },
];

function kindOf(types: readonly Term[]): Kind {
  if (types.some(({ value }) => CLASSES.has(value))) return "class";
  if (types.some(({ value }) => PROPERTY_TYPES.has(value))) return "property";
  return "thing";
}

const parsed = new WeakMap<Files, Map<string, Promise<[Graph, string]>>>();

/** A Turtle file of the vocabulary, read once. The cache is per `Files` object, which is assumed not to change. */
function parse(vocabulary: Files, path: string): Promise<[Graph, string]> {
  const held = parsed.get(vocabulary) ?? new Map();
  parsed.set(vocabulary, held);
  const read =
    held.get(path) ??
    (async (): Promise<[Graph, string]> => {
      const text = await readText(vocabulary, path);
      return [
        new Graph(
          await new OxigraphStore().parse(text, `${vocabulary.iri}${path}`),
        ),
        text,
      ];
    })();
  held.set(path, read);
  return read;
}

/** Files read as one graph, each parsed against its own address so a relative IRI names the file it is in, and their text. */
async function parseAll(
  vocabulary: Files,
  ...paths: readonly [string, ...string[]]
): Promise<[Graph, string]> {
  const read = await Promise.all(paths.map((path) => parse(vocabulary, path)));
  return [
    new Graph(read.flatMap(([graph]) => graph.triples)),
    read.map(([, text]) => text).join("\n"),
  ];
}

/** The terms the ontology declares, each with the entry the page gives it. */
function entriesOf(ontology: Graph, own: string): Map<string, Entry> {
  const typed = new Map<string, Term[]>();
  for (const [subject, predicate, object] of ontology.triples)
    if (subject.termType === "NamedNode" && predicate.value === TYPE)
      pushTo(typed, subject.value, object);
  const entries = new Map<string, Entry>();
  for (const [iri, types] of typed)
    if (!types.some(({ value }) => value === `${OWL}Ontology`))
      entries.set(iri, {
        iri,
        kind: kindOf(types),
        copied: !iri.startsWith(own),
      });
  return entries;
}

/**
 * What the query pages read of the vocabulary beside the queries themselves: the IRIs of the terms the term reference
 * has an entry for, and each query's path with the rules and decision notes that write it. Read once, shared with
 * `termReference()`.
 */
export async function queryFacts(vocabulary: Files): Promise<{
  readonly terms: ReadonlySet<string>;
  /** The terms that are properties, whose pages are in `properties/`. */
  readonly properties: ReadonlySet<string>;
  readonly naming: ReadonlyMap<string, QueryNaming>;
  /** The label of each class a matcher rule applies to, by the rule's query path, from the vocabulary's rule lists. */
  readonly appliesTo: ReadonlyMap<string, readonly string[]>;
}> {
  const [ontology] = await parse(vocabulary, ONTOLOGY);
  const entries = entriesOf(ontology, CASCADE);
  const terms = new Set(entries.keys());
  return {
    terms,
    properties: new Set(
      [...entries.values()]
        .filter(({ kind }) => kind === "property")
        .map(({ iri }) => iri),
    ),
    naming: (await usedByOnce(vocabulary, terms)).naming,
    appliesTo: await appliesToOf(vocabulary, ontology),
  };
}

/**
 * The label of each class each matcher rule applies to, by the rule's query path, over every version of the rule list: a
 * rule of the current version is in the rows of an older one too, and a version may add a class to it.
 */
async function appliesToOf(
  vocabulary: Files,
  ontology: Graph,
): Promise<Map<string, string[]>> {
  const label = (iri: string): string => {
    const subject = { termType: "NamedNode", value: iri } as const;
    const found = LABEL.flatMap((predicate) =>
      ontology
        .objects(subject, predicate)
        .filter((term) => term.termType === "Literal"),
    );
    const named = found.find((term) => term.language === "en") ?? found[0];
    return named?.value ?? prefixed(iri) ?? iri;
  };
  const classes = new Map<string, Set<string>>();
  for (const path of (await vocabulary.list(RULE_LIST))
    .filter((file) => file.endsWith(".ttl"))
    .sort()) {
    const [rows] = await parse(vocabulary, path);
    for (const row of rows.subjects(`${CASCADE}queryPath`)) {
      const query = rows.objects(row, `${CASCADE}queryPath`)[0]?.value;
      if (query === undefined) continue;
      const key = `${QUERIES}/${query}`;
      const held = classes.get(key) ?? new Set<string>();
      classes.set(key, held);
      for (const { value } of rows.objects(row, `${CASCADE}appliesToClass`))
        held.add(label(value));
    }
  }
  return new Map(
    [...classes].map(([path, labels]) => [path, [...labels].sort()]),
  );
}

/** What tells the term reference of one vocabulary from another's: where it is read, how it is worded and what it is checked by. */
interface Source {
  readonly ontology: string;
  readonly shapes: readonly [string, ...string[]];
  /** The namespace the vocabulary is its own in; a term outside it is one copied from another vocabulary. */
  readonly namespace: string;
  /** Whether queries and rules are read from the files, which the Bridge's vocabulary has none of. */
  readonly used: boolean;
  /** The file that places each class in a pod; where there is one, the page opens on an index of the classes. */
  readonly layout?: string;
  readonly title: string;
  /** The file of the index page in the folder of term pages. */
  readonly index: string;
  /** The page of the shapes no entry holds, in the folder of term pages. */
  readonly shapesPage: string;
  readonly groups: readonly Group[];
  readonly lead: (blob: string, tree: string) => Html;
}

/** The vocabulary read for one page: `base` is the folder of term pages from the page being written. */
async function load(vocabulary: Files, source: Source, base: string) {
  const [ontology, ontologyText] = await parse(vocabulary, source.ontology);
  const [shapes, shapesText] = await parseAll(vocabulary, ...source.shapes);
  const entries = entriesOf(ontology, source.namespace);
  const prefixes = new Map([
    ...declaredIn(ontologyText),
    ...declaredIn(shapesText),
  ]);
  const used = source.used
    ? await usedByOnce(vocabulary, new Set(entries.keys()))
    : undefined;
  const reference = new Reference(
    ontology,
    shapes,
    entries,
    prefixes,
    used,
    vocabulary.iri,
    base,
    source.index,
    source.title,
    source.shapesPage,
  );
  const sorted = [...entries.values()].sort((a, b) =>
    reference
      .name(a.iri)
      .toLowerCase()
      .localeCompare(reference.name(b.iri).toLowerCase()),
  );
  return { reference, sorted };
}

async function referencePage(
  vocabulary: Files,
  chrome: Chrome,
  source: Source,
): Promise<string> {
  const { reference, sorted } = await load(vocabulary, source, "");
  const grouped = source.groups.map((group) => ({
    ...group,
    entries: sorted.filter(group.holds),
  }));
  const { unhomed } = reference;
  const list = (entries: readonly Entry[]): Html =>
    markup`<p class="terms">${entries.map((entry, index) => markup`${index === 0 ? "" : " · "}<a id="${termId(entry.iri)}" href="${reference.page(entry.iri)}">${reference.name(entry.iri)}</a>${reference.anchors(entry.iri)}`)}</p>\n`;
  const names = (groups: typeof grouped): Html =>
    markup`${groups.map(
      ({ id, title, about, entries, split }) =>
        markup`<h2 id="${id}">${title}</h2>
<p class="prose">${about}</p>
${split === undefined ? list(entries) : reference.split(entries, split).map((group) => markup`<details class="group">\n<summary>${group.code ? markup`<code>${group.title}</code>` : group.title} <span class="about">${group.entries.length}</span></summary>\n${list(group.entries)}</details>\n`)}`,
    )}`;
  const index = async (): Promise<Html> => {
    const holding = new Set<string>();
    if (source.layout !== undefined) {
      const [layout] = await parse(vocabulary, source.layout);
      for (const [placement, predicate, object] of layout.triples)
        if (predicate.value === HOLDS_RECORDS && object.value === "true")
          for (const forClass of layout.objects(placement, SOLID_FOR_CLASS))
            holding.add(forClass.value);
    }
    const acts = reference.below(ACTIVITY);
    const own = sorted.filter(
      ({ kind, copied }) => kind === "class" && !copied,
    );
    const classes: readonly [string, string, readonly Entry[]][] = [
      [
        "what-a-pod-holds",
        "What a pod holds",
        own.filter(({ iri }) => holding.has(iri)),
      ],
      [
        "acts",
        "Acts",
        own.filter(({ iri }) => !holding.has(iri) && acts.has(iri)),
      ],
      [
        "other-classes",
        "Other classes",
        own.filter(({ iri }) => !holding.has(iri) && !acts.has(iri)),
      ],
    ];
    return markup`<span id="classes"></span>${classes.map(
      ([id, title, entries]) =>
        markup`<h2 id="${id}">${title}</h2>
${entries.length === 0 ? markup`<p class="about">None.</p>\n` : markup`<ul class="classes">\n${entries.map((entry) => reference.summary(entry))}</ul>\n`}`,
    )}${names(grouped.filter(({ id }) => id !== "classes"))}`;
  };
  const opening = source.layout === undefined ? names(grouped) : await index();
  return shell({
    chrome,
    title: source.title,
    stylesheet: `../${STYLESHEET_FILE}`,
    hubRoot: "../",
    nav: markup`<a href="../index.html">Cascade Protocol reference</a>\n`,
    main: markup`<h1>${source.title}</h1>
${source.lead(reference.blob, vocabulary.iri)}${opening}<p class="prose"><a href="${source.shapesPage}">Shapes other shapes use</a> (${unhomed.length}): the shapes no term's page shows are on a page of their own.</p>
`,
    after: markup`<script>${new Html(termsScript(source.shapesPage, reference.movedIds))}</script>\n`,
  }).text;
}

/** The page of the shapes no term's page shows: each in full, with the ids the index used to hold them at. */
async function shapesPageOf(
  vocabulary: Files,
  chrome: Chrome,
  source: Source,
): Promise<string> {
  const { reference } = await load(vocabulary, source, "../");
  const { unhomed } = reference;
  return shell({
    chrome,
    title: `${source.title}: shapes other shapes use`,
    stylesheet: `../../${STYLESHEET_FILE}`,
    hubRoot: "../../",
    nav: markup`<a href="../../index.html">Cascade Protocol reference</a> · <a href="../${source.index}">${source.title}</a>\n`,
    main: markup`<h1 id="shapes">Shapes other shapes use</h1>
<p class="prose">The shapes no term's page shows: those another shape sends a value to with <code>node</code>, and those whose class or property has no page.</p>
${unhomed.length === 0 ? markup`<p class="about">None.</p>\n` : unhomed.map((shape) => markup`<section class="term">\n<h2 id="${reference.id(shape.value)}"><code>${reference.name(shape.value)}</code></h2>\n${reference.relative(shape.value) ? "" : markup`<p class="iri">${shape.value}</p>\n`}${reference.shape(shape, false)}</section>\n`)}`,
  }).text;
}

/**
 * The index's script: a link to a shape's old anchor goes to the shapes' page, and a link to a name inside a folded group
 * opens the groups round it and scrolls to it.
 */
function termsScript(shapesPage: string, moved: readonly string[]): string {
  const json = (value: unknown): string =>
    JSON.stringify(value).replace(/</g, "\\u003c");
  return [
    "(function () {",
    `var MOVED = ${json(moved)};`,
    `var SHAPES = ${json(shapesPage)};`,
    "function wanted() {",
    "  try { return decodeURIComponent(location.hash.slice(1)); } catch (e) { return ''; }",
    "}",
    "function show() {",
    "  var id = wanted();",
    "  if (id === '') return;",
    "  var target = document.getElementById(id);",
    "  if (target === null) {",
    "    if (MOVED.indexOf(id) >= 0) location.replace(SHAPES + location.hash);",
    "    return;",
    "  }",
    "  var folded = false;",
    "  for (var up = target.parentElement; up !== null; up = up.parentElement)",
    "    if (up.tagName === 'DETAILS') { up.open = true; folded = true; }",
    "  if (folded) target.scrollIntoView();",
    "}",
    "show();",
    "window.addEventListener('hashchange', show);",
    "})();",
  ].join("\n");
}

/** Each term's page, by its path in the folder of term pages, but the terms `skip` holds. */
async function termPagesOf(
  vocabulary: Files,
  chrome: Chrome,
  source: Source,
  skip: ReadonlySet<string> = new Set(),
): Promise<Map<string, string>> {
  const { reference, sorted } = await load(vocabulary, source, "../");
  return new Map(
    sorted
      .filter(({ iri }) => !skip.has(iri))
      .map((entry) => [
        termPage(entry.iri, entry.kind === "property"),
        reference.entry(entry, chrome),
      ]),
  );
}

/** Each term of the vocabulary's page, by its path in the folder of term pages. */
export const termPages = (
  vocabulary: Files,
  chrome: Chrome,
): Promise<Map<string, string>> =>
  termPagesOf(vocabulary, chrome, CASCADE_SOURCE);

/** `terms.json`: every term the vocabulary declares, with the fields its page shows. */
export async function termsJson(vocabulary: Files): Promise<string> {
  const { reference, sorted } = await load(vocabulary, CASCADE_SOURCE, "");
  return `${JSON.stringify({ terms: sorted.map((entry) => reference.fields(entry)) }, null, 1)}\n`;
}

/** The files of the vocabulary that `terms/` offers tools whole, by name in that folder. */
export const TERM_FILES: readonly [name: string, path: string][] = [
  ["cascade.ttl", ONTOLOGY],
  ["cascade.shapes.ttl", SHAPES],
];
export const TERMS_JSON = "terms/terms.json";

const CASCADE_SOURCE: Source = {
  ontology: ONTOLOGY,
  shapes: [SHAPES],
  namespace: CASCADE,
  used: true,
  layout: LAYOUT,
  title: "Cascade terms",
  index: "index.html",
  shapesPage: TERMS_SHAPES_PAGE.slice(TERMS_FOLDER.length),
  groups: GROUPS,
  lead: (
    blob,
    tree,
  ) => markup`<p class="prose">Every term a Cascade pod carries, as cascade-vocabulary declares it in
<a href="${blob}${ONTOLOGY}">${ONTOLOGY}</a>: what it is, the shapes in
<a href="${blob}${SHAPES}">${SHAPES}</a> that check it, and each query and each rule of the spec that names it. Each
term has a page of its own.
The terms of the Bridge, which judges an adapter, are on <a href="bridge.html">their own page</a>.</p>
<p class="prose">A term's IRI is shown as text: the names under https://ns.cascadeprotocol.org/ do not resolve yet, so this
page is where a term is described.</p>
<p class="about">For tools: <a href="terms.json">terms.json</a> has every term's fields, and
${TERM_FILES.map(([name], index) => markup`${index === 0 ? "" : " and "}<a href="${name}">${name}</a>`)} are the vocabulary's files as built.</p>
<p class="about">Read from cascade-vocabulary at <a href="${tree}">${tree}</a>; the example pods may have been built from
another commit.</p>
`,
};

/**
 * The term reference's index: every term as a link to its page, this vocabulary's own and those it copies, the classes with
 * a line of what each is; each row carries the id the term's old anchor had.
 */
export const termReference = (vocabulary: Files, chrome: Chrome) =>
  referencePage(vocabulary, chrome, CASCADE_SOURCE);

/** The shapes no term's page shows, each in full, on a page of their own beside the index. */
export const termShapes = (vocabulary: Files, chrome: Chrome) =>
  shapesPageOf(vocabulary, chrome, CASCADE_SOURCE);

const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const BRIDGE_ONTOLOGY = "vocab/bridge.ttl";
const BRIDGE_SHAPES = "shapes";

/**
 * The Bridge's term reference, from cascade-bridge-spec: an entry for each term `vocab/bridge.ttl` declares, the Bridge's own
 * and those of other vocabularies it declares as its own, saying what it is and the shapes of `shapes/` that use it. It is
 * the term reference's page made over the Bridge's files, so an entry reads as one there does.
 */
export async function bridgeTermReference(
  bridgeSpec: Files,
  chrome: Chrome,
): Promise<string> {
  return referencePage(bridgeSpec, chrome, await bridgeSource(bridgeSpec));
}

/** The Bridge's shapes no term's page shows, each in full, on a page of their own. */
export async function bridgeTermShapes(
  bridgeSpec: Files,
  chrome: Chrome,
): Promise<string> {
  return shapesPageOf(bridgeSpec, chrome, await bridgeSource(bridgeSpec));
}

/** The pages of the Bridge's terms, by path in the folder of term pages, but the terms `skip` holds, which the term reference describes. */
export async function bridgeTermPages(
  bridgeSpec: Files,
  chrome: Chrome,
  skip: ReadonlySet<string>,
): Promise<Map<string, string>> {
  return termPagesOf(bridgeSpec, chrome, await bridgeSource(bridgeSpec), skip);
}

async function bridgeSource(bridgeSpec: Files): Promise<Source> {
  const [first, ...rest] = (await bridgeSpec.list(BRIDGE_SHAPES))
    .filter((path) => path.endsWith(".shapes.ttl"))
    .sort();
  if (first === undefined)
    throw new Error(`${bridgeSpec.iri} has no shapes under ${BRIDGE_SHAPES}/`);
  const shapes: readonly [string, ...string[]] = [first, ...rest];
  return {
    ontology: BRIDGE_ONTOLOGY,
    shapes,
    namespace: BRIDGE,
    used: false,
    title: "Cascade Bridge terms",
    index: "bridge.html",
    shapesPage: BRIDGE_SHAPES_PAGE.slice(TERMS_FOLDER.length),
    groups: [
      {
        id: "classes",
        title: "Classes",
        about:
          "What a Bridge, an adapter and a test of either are made of, and the kinds of test and of failure.",
        holds: ({ kind, copied }) => !copied && kind === "class",
      },
      {
        id: "properties",
        title: "Properties",
        about:
          "What an adapter, a test case, a result and a record's finding say.",
        holds: ({ kind, copied }) => !copied && kind === "property",
        split: "domain",
      },
      {
        id: "named-things",
        title: "Named things",
        about:
          "The profiles, verdicts, schemes and concepts the Bridge names, which an adapter or a test case points at.",
        holds: ({ kind, copied }) => !copied && kind === "thing",
        split: "scheme",
      },
      {
        id: "copied",
        title: "Terms from other vocabularies",
        about:
          "Terms of other vocabularies that the Bridge declares as its own, such as Web Annotation's, each with where it is defined.",
        holds: ({ copied }) => copied,
        split: "prefix",
      },
    ],
    lead: (
      blob,
      tree,
    ) => markup`<p class="prose">The Bridge's own vocabulary, as cascade-bridge-spec declares it in
<a href="${blob}${BRIDGE_ONTOLOGY}">${BRIDGE_ONTOLOGY}</a>: the test types, verdicts, gap and accounting terms that an adapter and an
engine are judged by, and the shapes in
${shapes.map((path, index) => markup`${index === 0 ? "" : index === shapes.length - 1 ? ", and " : ", "}<a href="${blob}${path}">${path}</a>`)}
that use each.</p>
<p class="prose">The terms a pod carries are on <a href="index.html">the term reference</a>. The Bridge's draft namespace
does not resolve yet either, so this page is where a term is described.</p>
<p class="about">Read from cascade-bridge-spec at <a href="${tree}">${tree}</a>.</p>
`,
  };
}
