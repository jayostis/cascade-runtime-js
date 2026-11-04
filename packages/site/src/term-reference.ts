import {
  featuresOf,
  type Files,
  Graph,
  type NamedNode,
  OxigraphStore,
  RDF,
  readText,
  readWrittenFeature,
  type Term,
  XSD,
} from "@cascade-runtime/runtime";
import { type Content, Html, markup } from "./html.js";
import { NAMESPACE_HOST, ruleHref, termHref, termId } from "./links.js";
import { STYLESHEET_FILE } from "./site.js";
import { numberOf } from "./spec.js";
import { expanded, LOCAL_NAME, prefixed } from "./terms.js";

/** The term reference's page in the hub's tree; `termHref` links its entries from `terms/`. */
export const TERMS_PAGE = "terms/index.html";
export const TERMS_FOLDER = "terms/";

const ONTOLOGY = "ontologies/cascade.ttl";
const SHAPES = "ontologies/cascade.shapes.ttl";
const QUERIES = "queries";
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
const PROPERTIES = new Set([
  `${OWL}ObjectProperty`,
  `${OWL}DatatypeProperty`,
  `${OWL}AnnotationProperty`,
  `${RDF}Property`,
]);
const LABEL = [`${RDFS}label`, `${SKOS}prefLabel`];
const COMMENT = [`${RDFS}comment`, `${SKOS}definition`];
const SOURCE = [`${DCT}source`, `${RDFS}isDefinedBy`];
const LICENSE = `${DCT}license`;
const SEE_ALSO = `${RDFS}seeAlso`;
const DOMAIN = `${RDFS}domain`;
const RANGE = `${RDFS}range`;
const SUBCLASS = `${RDFS}subClassOf`;
const SUBPROPERTY = `${RDFS}subPropertyOf`;
/** What an entry shows in a field of its own, so its other statements are the rest. */
const SHOWN = new Set([
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

type Kind = "class" | "property" | "thing";

interface Entry {
  readonly iri: string;
  readonly kind: Kind;
  readonly copied: boolean;
}

interface UsedBy {
  readonly queries: Map<string, string[]>;
  readonly rules: Map<string, { href: string; path: string; name: string }[]>;
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
    { href: string; path: string; name: string }[]
  >();
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
            href: ruleHref(path, number, SPEC),
            path,
            name: rule.name,
          });
    }
  }
  return { queries, rules };
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
  readonly #used: UsedBy;
  readonly #nodeShapes: readonly NamedNode[];
  /** The vocabulary's files on GitHub at the commit read, ending in a slash. */
  readonly blob: string;

  constructor(
    ontology: Graph,
    shapes: Graph,
    entries: ReadonlyMap<string, Entry>,
    prefixes: ReadonlyMap<string, string>,
    used: UsedBy,
    tree: string,
  ) {
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
      this.#homes.set(shape.value, classes[0]);
    }
  }

  /** Where each shape's anchor is: the entry of the first class it checks, or undefined for the shapes' own part. */
  readonly #homes = new Map<string, string | undefined>();

  /** The shapes no class's entry holds: those another shape sends a node to. */
  get unhomed(): NamedNode[] {
    return this.#nodeShapes.filter(
      ({ value }) => this.#homes.get(value) === undefined,
    );
  }

  /** The IRI as a prefixed name, by this site's prefixes or the files' own, or else whole. */
  name(iri: string): string {
    const known = prefixed(iri);
    if (known !== undefined) return known;
    for (const [prefix, namespace] of this.#prefixes) {
      const local = iri.slice(namespace.length);
      if (iri.startsWith(namespace) && LOCAL_NAME.test(local))
        return `${prefix}:${local}`;
    }
    return iri;
  }

  /** A term as a name: a link to its entry where it has one, else text. */
  term(iri: string): Html {
    return this.#entries.has(iri) || this.#homes.has(iri)
      ? markup`<a href="${termHref(iri, "")}"><code>${this.name(iri)}</code></a>`
      : markup`<code>${this.name(iri)}</code>`;
  }

  /** An address to follow: its entry, the page itself, or text where it is on the namespace's host. */
  link(iri: string): Html {
    if (this.#entries.has(iri) || this.#homes.has(iri)) return this.term(iri);
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
      .map((shape) => this.shape(shape, this.#homes.get(shape.value) === iri));
  }

  /** The shape whole: what it checks, its whole-node constraints and its property shapes; its anchor where it is at home. */
  shape(shape: NamedNode, home: boolean): Html {
    const wide = this.wide(shape);
    const properties = this.#shapes.objects(shape, `${SH}property`);
    return markup`<div class="shape"${home ? markup` id="${termId(shape.value)}"` : ""}>${this.targets(shape)}${wide.length === 0 ? "" : markup`<p>On the whole node: ${wide.map(([predicate, object], i) => markup`${i === 0 ? "" : "; "}${this.constraint(predicate, object)}`)}${this.said(shape)}</p>\n`}${properties.length === 0 ? "" : markup`<ul>\n${properties.map((p) => this.propertyLine(p))}</ul>\n`}</div>\n`;
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

  /** The values, as names, or what to say when there are none. */
  values(terms: readonly Term[], none: string): Content {
    if (terms.length === 0) return markup`<span class="about">${none}</span>`;
    return terms.map(
      (term, index) =>
        markup`${index === 0 ? "" : ", "}${this.value(this.#ontology, term)}`,
    );
  }

  links(terms: readonly Term[], none: string): Content {
    if (terms.length === 0) return markup`<span class="about">${none}</span>`;
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

  field(name: string, value: Content): Html {
    return markup`<dt>${name}</dt><dd>${value}</dd>\n`;
  }

  entry({ iri, kind }: Entry): Html {
    const label = this.texts(iri, LABEL);
    const comments = this.texts(iri, COMMENT);
    const subject = { termType: "NamedNode", value: iri } as const;
    const rest = this.#ontology
      .match(subject)
      .filter(([, predicate]) => !SHOWN.has(predicate.value));
    const shapes =
      kind === "class"
        ? this.classShapes(iri)
        : kind === "property"
          ? this.propertyShapes(iri)
          : [];
    const queries = this.#used.queries.get(iri) ?? [];
    const rules = this.#used.rules.get(iri) ?? [];
    return markup`<section class="term">
<h3 id="${termId(iri)}"><code>${this.name(iri)}</code>${label.length === 0 ? "" : markup` ${label.join(" / ")}`}</h3>
<p class="iri">${iri}</p>
${comments.length === 0 ? markup`<p class="prose about">No comment says what it is.</p>\n` : comments.map((comment) => markup`<p class="prose">${comment}</p>\n`)}<dl class="layout">
${this.field("Type", this.values(this.objects(iri, [TYPE]), "none stated"))}${
      kind === "class"
        ? [
            this.field(
              "Subclass of",
              this.values(this.objects(iri, [SUBCLASS]), "none stated"),
            ),
            this.field(
              "Domain of",
              this.values(this.pointing(DOMAIN, iri), "no property"),
            ),
            this.field(
              "Range of",
              this.values(this.pointing(RANGE, iri), "no property"),
            ),
          ]
        : kind === "property"
          ? [
              this.field(
                "Domain",
                this.values(this.objects(iri, [DOMAIN]), "none stated"),
              ),
              this.field(
                "Range",
                this.values(this.objects(iri, [RANGE]), "none stated"),
              ),
              this.field(
                "Subproperty of",
                this.values(this.objects(iri, [SUBPROPERTY]), "none stated"),
              ),
            ]
          : ""
    }${
      kind === "thing"
        ? ""
        : this.field(
            "Shapes",
            shapes.length === 0
              ? markup`<span class="about">No shape checks it.</span>`
              : kind === "class"
                ? shapes
                : markup`<ul>\n${shapes}</ul>`,
          )
    }${this.field("Source", this.links(this.objects(iri, SOURCE), "none stated"))}${this.field(
      "License",
      this.links(this.objects(iri, [LICENSE]), "none stated"),
    )}${this.field("See also", this.links(this.objects(iri, [SEE_ALSO]), "none stated"))}${
      rest.length === 0
        ? ""
        : this.field(
            "Also stated",
            markup`<ul>\n${rest.map(([, predicate, object]) => markup`<li>${this.term(predicate.value)} ${this.value(this.#ontology, object)}</li>\n`)}</ul>`,
          )
    }${this.field(
      "Queries",
      queries.length === 0
        ? markup`<span class="about">No query names it.</span>`
        : markup`<ul>\n${queries.map((path) => markup`<li><a href="${this.blob}${encodeURI(path)}">${path}</a></li>\n`)}</ul>`,
    )}${this.field(
      "Rules",
      rules.length === 0
        ? markup`<span class="about">No rule names it.</span>`
        : markup`<ul>\n${rules.map(({ href, path, name }) => markup`<li><a href="${href}">${name}</a> <span class="about">${path}</span></li>\n`)}</ul>`,
    )}</dl>
</section>
`;
  }
}

const GROUPS: readonly {
  id: string;
  title: string;
  about: string;
  holds: (entry: Entry) => boolean;
}[] = [
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
  },
  {
    id: "named-things",
    title: "Named things",
    about:
      "The code systems, kinds of table, concepts and other things the vocabulary names, which a pod's statements point at.",
    holds: ({ kind, copied }) => !copied && kind === "thing",
  },
  {
    id: "copied",
    title: "Terms from other vocabularies",
    about:
      "Terms of PROV-O, PAV, FOAF and other vocabularies that a pod uses, as cascade.ttl declares them, each with its source: their meaning is their source's.",
    holds: ({ copied }) => copied,
  },
];

function kindOf(types: readonly Term[]): Kind {
  if (types.some(({ value }) => CLASSES.has(value))) return "class";
  if (types.some(({ value }) => PROPERTIES.has(value))) return "property";
  return "thing";
}

const parse = async (
  vocabulary: Files,
  path: string,
): Promise<[Graph, string]> => {
  const text = await readText(vocabulary, path);
  return [
    new Graph(
      await new OxigraphStore().parse(text, `${vocabulary.iri}${path}`),
    ),
    text,
  ];
};

/**
 * The term reference: an entry for each term `ontologies/cascade.ttl` declares, this vocabulary's own and those it copies,
 * saying what it is, the shapes that check it, and each query and rule that names it; each entry's heading carries the id
 * `termHref` links.
 */
export async function termReference(vocabulary: Files): Promise<string> {
  const [ontology, ontologyText] = await parse(vocabulary, ONTOLOGY);
  const [shapes, shapesText] = await parse(vocabulary, SHAPES);
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
        copied: !iri.startsWith(CASCADE),
      });
  const prefixes = new Map([
    ...declaredIn(ontologyText),
    ...declaredIn(shapesText),
  ]);
  const used = await usedBy(vocabulary, new Set(entries.keys()));
  const tree = vocabulary.iri;
  const reference = new Reference(
    ontology,
    shapes,
    entries,
    prefixes,
    used,
    tree,
  );
  const sorted = [...entries.values()].sort((a, b) =>
    reference
      .name(a.iri)
      .toLowerCase()
      .localeCompare(reference.name(b.iri).toLowerCase()),
  );
  const grouped = GROUPS.map((group) => ({
    ...group,
    entries: sorted.filter(group.holds),
  }));
  const { unhomed } = reference;
  return markup`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cascade terms</title>
<link rel="stylesheet" href="../${STYLESHEET_FILE}">
</head>
<body>
<nav><a href="../index.html">Cascade pods</a></nav>
<main>
<h1>Cascade terms</h1>
<p class="prose">Every term a Cascade pod carries, as cascade-vocabulary declares it in
<a href="${reference.blob}${ONTOLOGY}">${ONTOLOGY}</a>: what it is, the shapes in
<a href="${reference.blob}${SHAPES}">${SHAPES}</a> that check it, and each query and each rule of the spec that names it.</p>
<p class="prose">A term's IRI is shown as text: the names under https://ns.cascadeprotocol.org/ do not resolve yet, so this
page is where a term is described.</p>
<p class="about">Read from cascade-vocabulary at <a href="${tree}">${tree}</a>; the example pods may have been built from
another commit.</p>
${grouped.map(
  ({ id, title, entries }) =>
    markup`<h3><a href="#${id}">${title}</a></h3>
<p class="terms">${entries.map((entry, index) => markup`${index === 0 ? "" : " · "}<a href="${termHref(entry.iri, "")}">${reference.name(entry.iri)}</a>`)}</p>
`,
)}<h3><a href="#shapes">Shapes other shapes use</a></h3>
${grouped.map(
  ({ id, title, about, entries }) =>
    markup`<h2 class="part" id="${id}">${title}</h2>
<p class="prose">${about}</p>
${entries.length === 0 ? markup`<p class="about">None.</p>\n` : entries.map((entry) => reference.entry(entry))}`,
)}<h2 class="part" id="shapes">Shapes other shapes use</h2>
<p class="prose">The shapes no class's entry shows, which another shape sends a value to with <code>node</code>.</p>
${unhomed.length === 0 ? markup`<p class="about">None.</p>\n` : unhomed.map((shape) => markup`<section class="term">\n<h3><code>${reference.name(shape.value)}</code></h3>\n<p class="iri">${shape.value}</p>\n${reference.shape(shape, true)}</section>\n`)}</main>
</body>
</html>
`.text;
}
