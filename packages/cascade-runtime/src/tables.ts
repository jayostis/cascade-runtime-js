import {
  canonical,
  CODES,
  codeIri,
  type Files,
  fileStem,
  Graph,
  iri,
  MemoryFiles,
  ntriples,
  RDF,
  readText,
  References,
  Refusal,
  RULE_LIST,
  relative,
  rowsByCode,
  type StoreFactory,
  tableTerms,
  type Term,
  type Triple,
} from "@cascade-runtime/runtime";
import {
  gunzipped,
  IN_THIS_THREAD,
  LISTING_FORMAT,
  merged,
  type Listed,
  nameOver,
  notation,
  OWL,
  PROV,
  REVISION_OF,
  rowsAbout,
  type Row,
  type RowsWork,
  SKOS,
  SPECIALIZATION_OF,
  termsOfRows,
  values,
} from "./rows.js";
import {
  LISTED,
  PUBLISHED_ROWS,
  StarterFiles,
  versionsIn,
} from "./tables/starter.js";

export { LISTED, PUBLISHED_ROWS } from "./tables/starter.js";

const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const RECORDS = "ontologies/records/v1-draft/records.ttl";
const CLASSIFICATIONS = `${REC}VariantClassifications`;
const PAV = "http://purl.org/pav/";
const DCAT = "http://www.w3.org/ns/dcat#";
const DCT = "http://purl.org/dc/terms/";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const SPDX = "http://spdx.org/rdf/terms#";
const SHIPS_WITH = `${REC}shipsWith`;
const TABLE_KIND = `${REC}tableKind`;
/** Beside a feed, when its watcher last checked each source. */
const WATCHED = "checked.json";
/** The kinds a code's page gives a section of their own, so its generic mappings do not list them. */
const OWN_SECTIONS = [`${REC}PanelMembers`, `${REC}DrugClasses`];
/** The relations of a drug class row, in the order a code's page lists them. */
const RELATIONS = [
  `${REC}establishedPharmacologicClass`,
  `${REC}mechanismOfAction`,
  `${REC}physiologicEffect`,
  `${REC}chemicalStructure`,
];
const NOTATIONS = new Intl.Collator("en", { numeric: true });
/** A panel row's other code, with its place, before `facts` names it. */
interface PlaceOf {
  readonly code: string;
  readonly sequence?: number;
  readonly required?: string;
}
/** A class row, before `facts` names its codes. */
interface ClassOf {
  readonly relation: string;
  readonly class: string;
  readonly through?: string;
}
/** A relation a code has no class for though a different form of its ingredient has one. */
interface WithheldOf {
  readonly relation: string;
  readonly ingredient: string;
}
/** How many codes a page of a search shows. */
export const PAGE_SIZE = 50;
const INDEX = "references.ttl";
/** What the store holds that is not RDF: each feed's last check, the current versions, and each pod's. */
export const HELD = "tables.json";

/** How long the check an open starts may take: a network that stalls must not hold a local pod closed. */
export const CHECK_ON_OPEN_MS = 10_000;

/** What a pod keeps of a series, from the feed's description of it. */
const SERIES_KEPT = [
  `${RDF}type`,
  `${RDFS}label`,
  `${REC}tableKind`,
  `${DCT}license`,
  `${DCT}publisher`,
  `${DCT}bibliographicCitation`,
];
/** What a pod keeps of a version, from the feed's description of it. */
const VERSION_KEPT = [
  SPECIALIZATION_OF,
  `${PAV}version`,
  REVISION_OF,
  `${DCT}issued`,
  `${REC}coversGene`,
];

/** A watcher's last check of a source, as the feed's `checked.json` gives it. */
export interface Watched {
  readonly at: string;
  /** `nothing new` or `new`. */
  readonly found: string;
}

interface FeedChecked {
  readonly checked: string;
  readonly modified?: string;
  /** Each series the feed describes, by its IRI, with the source it is built from. */
  readonly series?: Record<string, string | null>;
  /** Each publisher's name the feed gives, by the publisher's IRI. */
  readonly publishers?: Record<string, string>;
  /** The watcher's last check of each source, by the source's IRI. */
  readonly watched?: Record<string, Watched>;
}

interface Held {
  /** Each feed's last check, by its URL. */
  readonly feeds: Record<string, FeedChecked>;
  /** The version of each held series a pod opened now is given, sorted. */
  readonly current: readonly string[];
  /** The versions each pod was last opened with, the rule list's among them, by the pod's naming base. */
  readonly pods: Record<string, readonly string[]>;
  /** The name the app opened each pod by, by the pod's naming base. */
  readonly names?: Record<string, string>;
}

export interface HeldVersion {
  readonly iri: string;
  /** The publisher's label for it. */
  readonly label?: string;
  readonly issued?: string;
}

/** A series the app holds, as a person reads of it. */
export interface HeldSeries {
  readonly iri: string;
  readonly label: string;
  readonly kind?: string;
  readonly licence?: string;
  readonly publisher?: string;
  /** The publisher's name, when the feed gives it. */
  readonly publisherName?: string;
  /** The credit its publisher asks for. */
  readonly credit?: string;
  /** The version a pod opened now is given. */
  readonly current: HeldVersion;
  /** Every version held, the current one first, then the newest. */
  readonly versions: readonly HeldVersion[];
  readonly feed?: string;
  /** When the feed last changed, as it says. */
  readonly modified?: string;
  /** When this app last read the feed. */
  readonly checked?: string;
  /** The watcher's last check of the series' source; none when the feed does not say. */
  readonly watched?: Watched;
  /** The source the feed says it is built from. */
  readonly source?: string;
}

/** A code as written, and what a names, status or product ingredients series says of it, from the first series in the order of preference that holds it. */
export interface About {
  /** The code as written, without its code system's IRI. */
  readonly notation: string;
  readonly name?: {
    readonly label: string;
    readonly altLabels: readonly string[];
    readonly origin: string;
  };
  readonly status?: {
    readonly deprecated: boolean;
    readonly replacedBy: readonly string[];
    readonly origin: string;
  };
  /**
   * The codes the code maps to in a product ingredients series. A combination maps to its MIN, so two products
   * share an ingredient here only when each maps to the same code, not when one holds the other's ingredient.
   */
  readonly ingredients?: {
    readonly codes: readonly string[];
    readonly origin: string;
  };
}

/** A code a search found in a series. */
export interface Found {
  readonly code: string;
  /** The code as written, without its code system's IRI. */
  readonly notation: string;
  readonly about?: About;
  /** In a mapping series, the codes the code maps to. */
  readonly mapsTo: readonly { code: string; notation: string; about?: About }[];
}

/** A code, as written, with what names and status say of it. */
export interface Coded {
  readonly code: string;
  readonly notation: string;
  readonly about?: About;
}

/** Codes, at most a page of them, and how many there are. */
export interface Codes {
  readonly total: number;
  readonly codes: readonly Coded[];
}

/** Where a fact about a code comes from: a held series and its version. */
export interface Fact {
  readonly series: string;
  readonly version: string;
}

/** Where a code stands in a panel, as the row that puts it there gives it. */
export interface Placed extends Coded {
  /** The `rec:panelSequence` of the row. */
  readonly sequence?: number;
  /** The `rec:observationRequiredInPanel` of the row: `R` for a member the panel requires. */
  readonly required?: string;
}

/** A class a drug is in, by the relation its row gives. */
export interface InClass {
  /** The row's predicate: `rec:establishedPharmacologicClass`, `rec:mechanismOfAction`, `rec:physiologicEffect` or `rec:chemicalStructure`. */
  readonly relation: string;
  readonly class: Coded;
  /** The code the class is on when it is not the code asked of: FDA classes the ingredient or a precise ingredient, not a product. */
  readonly through?: Coded;
}

/**
 * A relation a code has no class for, though the drug classes table classes a different form of its ingredient:
 * RxNorm does not tie the code to that form.
 */
export interface WithheldClass {
  readonly relation: string;
  /** The ingredient a different form of which is classed. */
  readonly ingredient: Coded;
}

/** Everything the held tables say of a code, each fact with its series and version. */
export interface Facts extends Coded {
  /** From each names series that names it, in the order of preference. */
  readonly names: readonly (Fact & {
    readonly label: string;
    readonly altLabels: readonly string[];
  })[];
  /** From each status series that holds it, in the order of preference. */
  readonly status: readonly (Fact & {
    readonly deprecated: boolean;
    readonly replacedBy: readonly Coded[];
  })[];
  /**
   * From each mapping series that maps it or maps to it: the codes it maps to, each with the other codes mapped to
   * that one, and the codes mapped to it.
   */
  readonly mappings: readonly (Fact & {
    readonly mapsTo: readonly (Coded & { readonly alongside: Codes })[];
    readonly mappedFrom: Codes;
  })[];
  /** From each variant classifications series whose current version holds it as a row's subject, in the order of preference. */
  readonly classifications: readonly (Fact & ClassificationRow)[];
  /**
   * From each panel members series whose current version holds it: the members the code has as a panel, by their
   * sequence, and the panels that have it as a member, by their codes, at most a page of them.
   */
  readonly panels: readonly (Fact & {
    readonly members: readonly Placed[];
    readonly heldBy: {
      readonly total: number;
      readonly panels: readonly Placed[];
    };
  })[];
  /**
   * From each drug classes series whose current version holds a row on the code, on its own precise ingredient or on
   * its ingredient, or on a different form of its ingredient: each class by its relation, and each relation the code has
   * no class for though a different form of its ingredient has one.
   */
  readonly classes: readonly (Fact & {
    readonly in: readonly InClass[];
    readonly withheld: readonly WithheldClass[];
  })[];
  /** The code's own page at its code system's publisher, from the vocabulary's page template; none when the code system has none. */
  readonly page?: { readonly href: string; readonly system: string };
}

/** A variant as a page asks about it: an entry's codes, as `pod/My genetic variants` gives them. */
export interface VariantAsked {
  /** `genomics:geneSymbol`. */
  readonly gene?: string;
  /** The `genomics:hgvsCDot` literals. */
  readonly hgvs: readonly string[];
  /** The `genomics:clinvarVariationId` literals. */
  readonly variations: readonly string[];
}

/** A concept and the words a person reads it by. */
export interface Concept {
  readonly iri: string;
  readonly label: string;
}

/** What a variant classifications row says of a variation. */
export interface ClassificationRow {
  /** The row's subject. */
  readonly variation: string;
  readonly classification: readonly Concept[];
  readonly reviewStatus?: Concept;
  /** An `xsd:date`. */
  readonly lastEvaluated?: string;
  readonly contributingSubmitters?: number;
  readonly submitters?: number;
}

/** What the app's current version of a held variant classifications series says of a variant. */
export type WhatClinVarSays =
  | { readonly found: "no series" }
  | {
      readonly found: "not covered";
      readonly series: string;
      readonly version: string;
      readonly genes: readonly string[];
    }
  | {
      readonly found: "not found";
      readonly series: string;
      readonly version: string;
    }
  | {
      readonly found: "rows";
      readonly series: string;
      readonly version: string;
      /** Exactly one row. */
      readonly rows: readonly ClassificationRow[];
    };

export interface Searched {
  /** The version searched, when one series is; none when the series is not held. */
  readonly version?: string;
  /** How many codes matched, of which `found` holds a page. */
  readonly total: number;
  /** How many matched codes come before the page. */
  readonly offset: number;
  /** How many codes a page holds. */
  readonly size: number;
  readonly found: readonly Found[];
}

const NOTHING_HELD: Held = { feeds: {}, current: [], pods: {} };

function heldOf(bytes: Uint8Array): Held {
  const held = JSON.parse(new TextDecoder().decode(bytes)) as Held;
  return {
    ...held,
    pods: Object.fromEntries(
      Object.entries(held.pods).filter(([, versions]) =>
        Array.isArray(versions),
      ),
    ),
  };
}

/** What a check of one feed did. */
export interface Checked {
  readonly feed: string;
  /** The versions it kept. */
  readonly kept: readonly string[];
  /** Why the feed or a version could not be read now, to be tried later. */
  readonly later?: string;
  /** The versions that did not verify, which were not kept, each with why. */
  readonly refused: readonly { version: string; reason: string }[];
}

export interface TablesOptions {
  /** Where the versions are kept. */
  readonly files: Files;
  readonly feeds: readonly string[];
  /** The vocabulary, whose rule list every pod is given. */
  readonly vocabulary: Files;
  readonly newStore: StoreFactory;
  /** The package's starter copies: what an empty store starts from, and where a version it lacks is first read from. */
  readonly starter?: Files;
  readonly fetch?: typeof fetch;
  /** For each table kind's IRI, the series a person reads it from, first first. */
  readonly preference?: Readonly<Record<string, readonly string[]>>;
  /** The builders run locally, whose feeds are read after `feeds`. */
  readonly builds?: LocalBuilds;
  /** What reads a version's rows whole; in this thread, otherwise. */
  readonly work?: RowsWork;
}

/** Builders run on this machine, each writing a feed of its own. */
export interface LocalBuilds {
  /** Each builder's feed, in the order the builders are named. */
  readonly feeds: readonly string[];
  /** Runs every builder; what kept one from building, by its feed. */
  run(
    init: RequestInit,
  ): Promise<ReadonlyMap<string, Omit<Checked, "feed" | "kept">>>;
}

/** A version's name (N12): over its series, the version it revises and its rows. */
export async function versionName(
  series: string,
  previous: string | undefined,
  rows: readonly Triple[],
): Promise<string> {
  if (rows.some((triple) => triple.some((t) => t.termType === "BlankNode")))
    throw new Error("content to be named holds a blank node");
  const text = await canonical(rows);
  return nameOver(
    text.split("\n").filter((line) => line !== ""),
    series,
    previous,
  );
}

function only(graph: Graph, subject: Term, kept: readonly string[]): Triple[] {
  return graph
    .match(subject)
    .filter(
      ([, predicate, object]) =>
        kept.includes(predicate.value) && object.termType !== "BlankNode",
    );
}

/** The version each series of the tables ships with, the rule list's among them, sorted. */
export function shipped(references: References): string[] {
  return references.index
    .match(undefined, `${REC}shipsWith`)
    .map(([, , version]) => version.value)
    .sort();
}

/** The version each series of a kind ships with, in the references: what a pod opened with them is given, sorted. */
export function currentOf(references: References): string[] {
  return currentIn(references.index);
}

/** The version each series of a kind ships with in the index, sorted: the rule list's series has no kind. */
function currentIn(index: Graph): string[] {
  return index
    .match(undefined, SHIPS_WITH)
    .filter(([series]) => ofAKind(index, series))
    .map(([, , version]) => version.value)
    .sort();
}

function ofAKind(index: Graph, series: Term): boolean {
  return index.objects(series, TABLE_KIND).length > 0;
}

/** The feed that last described the series. */
function feedOf(held: Held, series: string): string | undefined {
  return Object.entries(held.feeds).find(
    ([, checked]) => checked.series?.[series] !== undefined,
  )?.[0];
}

/** The watcher's checks in a feed's `checked.json`, by source; none when it is not one. */
function watchedIn(bytes: Uint8Array): Record<string, Watched> | undefined {
  try {
    const { checked } = JSON.parse(new TextDecoder().decode(bytes)) as {
      checked?: Record<string, { at?: unknown; found?: unknown }>;
    };
    if (typeof checked !== "object" || checked === null) return undefined;
    return Object.fromEntries(
      Object.entries(checked).flatMap(([source, { at, found }]) =>
        typeof at === "string" && typeof found === "string"
          ? [[source, { at, found }]]
          : [],
      ),
    );
  } catch {
    return undefined;
  }
}

/** The check of a builder's feed with what kept the builder from building, if anything did. */
function withBuilt(
  checked: Checked,
  built: ReadonlyMap<string, Omit<Checked, "feed" | "kept">>,
): Checked {
  const run = built.get(checked.feed);
  if (run === undefined) return checked;
  const later = run.later ?? checked.later;
  return {
    ...checked,
    ...(later === undefined ? {} : { later }),
    refused: [...run.refused, ...checked.refused],
  };
}

/** Whether the line of `prov:wasRevisionOf` the catalog gives from `version` reaches `held`. */
function descends(catalog: Graph, version: Term, held: string): boolean {
  const seen = new Set<string>();
  for (
    let at: Term | undefined = version;
    at !== undefined && !seen.has(at.value);
    at = catalog.objects(at, REVISION_OF)[0]
  ) {
    if (at.value === held) return true;
    seen.add(at.value);
  }
  return false;
}

/** What `make` gives for the key, made at the first call and kept; one that fails is made again at the next. */
function once<T>(
  made: Map<string, Promise<T>>,
  key: string,
  make: () => Promise<T>,
): Promise<T> {
  let found = made.get(key);
  if (found === undefined) {
    found = make();
    found.catch(() => made.delete(key));
    made.set(key, found);
  }
  return found;
}

/** The stem of a held version's files; a version named by no file is refused. */
function stemOf(version: string): string {
  try {
    return fileStem(version);
  } catch (error) {
    throw new Refusal(
      `the tables hold ${version}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** One file of the rule list and the store as one folder, as `References` reads it: the store first. */
class TablesFiles implements Files {
  readonly iri: string;

  constructor(
    readonly store: Files,
    readonly vocabulary: Files,
  ) {
    this.iri = store.iri;
  }

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const path = relative(this, pathOrIri);
    if (path !== INDEX)
      return (
        (await this.store.read(path)) ??
        (await this.vocabulary.read(RULE_LIST + path))
      );
    const parts = [
      await this.vocabulary.read(RULE_LIST + INDEX),
      await this.store.read(INDEX),
    ].flatMap((bytes) =>
      bytes === undefined ? [] : [new TextDecoder().decode(bytes)],
    );
    return new TextEncoder().encode(parts.join("\n"));
  }

  write(): Promise<void> {
    return Promise.reject(new Error("a pod's tables are written by a check"));
  }

  async list(folder: string): Promise<string[]> {
    return [...(await this.store.list(folder)), INDEX];
  }
}

/** A listing kept beside a version, when it is one of this shape over these URI spaces. */
function keptListing(
  bytes: Uint8Array,
  uriSpaces: readonly string[],
): Listed | undefined {
  let kept: Partial<Listed> | null;
  try {
    kept = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as Partial<Listed> | null;
  } catch {
    return undefined;
  }
  return kept?.format === LISTING_FORMAT &&
    JSON.stringify(kept.uriSpaces) === JSON.stringify(uriSpaces) &&
    Array.isArray(kept.codes) &&
    typeof kept.mapsTo === "object" &&
    kept.mapsTo !== null &&
    typeof kept.names === "object" &&
    kept.names !== null &&
    Object.values(kept.names).every((names) => typeof names === "string")
    ? (kept as Listed)
    : undefined;
}

/** An app's reference tables: the versions it keeps from its feeds, beside its pods, and the vocabulary's rule list. */
export class Tables {
  readonly #options: TablesOptions;
  /** The store, read through to the starter copies when there are some. */
  readonly #files: Files;
  readonly #starterFiles: StarterFiles | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #started: Promise<void> | undefined;
  #written = 0;
  readonly #listings = new Map<string, Promise<Listed>>();
  readonly #merges = new Map<string, Promise<readonly string[]>>();
  readonly #notations = new Map<string, Promise<ReadonlyMap<string, string>>>();
  readonly #inverses = new Map<
    string,
    Promise<ReadonlyMap<string, readonly string[]>>
  >();
  #references: Promise<References> | undefined;
  #concepts: Promise<ReadonlyMap<string, string>> | undefined;
  #kinds: Promise<ReadonlySet<string>> | undefined;

  constructor(options: TablesOptions) {
    this.#options = options;
    this.#starterFiles =
      options.starter === undefined
        ? undefined
        : new StarterFiles(
            options.files,
            options.starter,
            options.work ?? IN_THIS_THREAD,
          );
    this.#files = this.#starterFiles ?? options.files;
  }

  /**
   * The kinds something the app runs reads: the kind a row of the vocabulary's rule list names, and the kinds the
   * vocabulary marks as read by pages. A series of any other kind is neither kept nor packed.
   */
  #kindsRead(): Promise<ReadonlySet<string>> {
    this.#kinds ??= (async () => {
      const { vocabulary, newStore } = this.#options;
      const kinds = new Set(
        (await tableTerms(vocabulary, newStore)).readByPages,
      );
      for (const path of await vocabulary.list(RULE_LIST)) {
        const bytes = path.endsWith(".ttl")
          ? await vocabulary.read(path)
          : undefined;
        if (bytes === undefined) continue;
        for (const [, predicate, object] of await newStore().parse(
          bytes,
          vocabulary.iri + path,
        ))
          if (predicate.value === `${REC}tableKind`) kinds.add(object.value);
      }
      return kinds;
    })();
    const p = this.#kinds;
    p.catch(() => {
      if (this.#kinds === p) this.#kinds = undefined;
    });
    return p;
  }

  /** Runs the local builders, then reads each feed and keeps each current version it does not hold that verifies. */
  check(init: RequestInit = {}): Promise<Checked[]> {
    return this.#next(async () => {
      const { feeds, builds } = this.#options;
      const built = (await builds?.run(init)) ?? new Map();
      const checked: Checked[] = [];
      for (const feed of [...feeds, ...(builds?.feeds ?? [])])
        checked.push(withBuilt(await this.#checkFeed(feed, init), built));
      return checked;
    });
  }

  /**
   * Copies into the store every version of the package's tables it lacks, which a first use of each reads through to
   * anyway; a copy cut short goes on from where it stopped. The bytes written, or 0 when the store held them already.
   */
  async start(): Promise<number> {
    const before = this.#written;
    await this.#start();
    const copied = (await this.#starterFiles?.copyAll()) ?? 0;
    return this.#written - before + copied;
  }

  /**
   * What the tables say of each code: how it is written, and its name, status and ingredients from the first held
   * series of each kind in the order of preference that holds it. Every code asked is answered, with the rest absent
   * when no table says it.
   */
  async about(codes: readonly string[]): Promise<Map<string, About>> {
    const [references, { uriSpaces }] = await Promise.all([
      this.references(),
      tableTerms(this.#options.vocabulary, this.#options.newStore),
    ]);
    const found = new Map<string, { -readonly [K in keyof About]: About[K] }>(
      codes.map((code) => [code, { notation: notation(uriSpaces, code) }]),
    );
    const fill = async <K extends Exclude<keyof About, "notation">>(
      kind: string,
      key: K,
      reading: (origin: string) => Promise<(code: string) => About[K]>,
    ): Promise<void> => {
      for (const series of this.#preferred(references, kind)) {
        const left = codes.filter(
          (code) => found.get(code)?.[key] === undefined,
        );
        if (left.length === 0) return;
        const read = await reading(references.fallback(series));
        for (const code of left) {
          const value = read(code);
          if (value === undefined) continue;
          found.get(code)![key] = value;
        }
      }
    };
    const fromRows =
      <K extends Exclude<keyof About, "notation">>(
        read: (rows: Row[], origin: string) => About[K],
      ) =>
      async (origin: string) => {
        const text = await this.#text(origin);
        return (code: string) => read(rowsAbout(text, code), origin);
      };
    await fill(
      `${REC}CodeNames`,
      "name",
      fromRows<"name">((rows, origin) => {
        const [label] = values(rows, `${SKOS}prefLabel`);
        return label === undefined
          ? undefined
          : { label, altLabels: values(rows, `${SKOS}altLabel`), origin };
      }),
    );
    await fill(
      `${REC}CodeStatus`,
      "status",
      fromRows<"status">((rows, origin) => {
        const [deprecated] = values(rows, `${OWL}deprecated`);
        return deprecated === undefined
          ? undefined
          : {
              deprecated: deprecated === "true",
              replacedBy: values(rows, `${DCT}isReplacedBy`),
              origin,
            };
      }),
    );
    // A mapping row is named by a urn:uuid, so the rows about a code are found in the version's listing.
    await fill(`${REC}ProductIngredients`, "ingredients", async (origin) => {
      const { mapsTo } = await this.#listed(origin);
      return (code) =>
        Object.hasOwn(mapsTo, code) && mapsTo[code]!.length > 0
          ? { codes: mapsTo[code]!, origin }
          : undefined;
    });
    return found;
  }

  /** The held series of the kind: those the order of preference names first, in its order, then the others. */
  #preferred(references: References, kind: string): string[] {
    const held = references.seriesOfKind(kind);
    const named = (this.#options.preference?.[kind] ?? []).filter((series) =>
      held.includes(series),
    );
    return [...named, ...held.filter((series) => !named.includes(series))];
  }

  /** The current version of each held series of the kind, or of those of them `among` names, in the order of preference. */
  #currentOf(
    references: References,
    kind: string,
    among?: readonly string[],
  ): Fact[] {
    return this.#preferred(references, kind)
      .filter((series) => among === undefined || among.includes(series))
      .map((series) => ({ series, version: references.fallback(series) }));
  }

  /** The tables a pod is given now. */
  async references(): Promise<References> {
    await this.#start();
    const { vocabulary, newStore } = this.#options;
    const references = (this.#references ??= References.of(
      new TablesFiles(this.#files, vocabulary),
      "",
      newStore,
      undefined,
      { canonical: true },
    ));
    references.catch(() => {
      if (this.#references === references) this.#references = undefined;
    });
    return references;
  }

  /**
   * The version of each held series a pod opened now is given. An empty store answers from the starter copies it starts
   * from, without waiting for them to be copied, so a pod's kept answers are read on a first visit before they are.
   */
  async current(): Promise<readonly string[]> {
    const bytes = await this.#readable(HELD);
    return bytes === undefined ? [] : heldOf(bytes).current;
  }

  /** The versions the pod was last opened with; none if it never was. */
  async openedWith(pod: string): Promise<readonly string[] | undefined> {
    return (await this.#held()).pods[pod];
  }

  /**
   * Records that the pod was opened with the versions and, given, the name the app opened it by.
   */
  opened(
    pod: string,
    versions: readonly string[],
    name?: string,
  ): Promise<void> {
    return this.#next(async () => {
      const held = await this.#held();
      await this.#write({
        ...held,
        pods: { ...held.pods, [pod]: versions },
        ...(name === undefined
          ? {}
          : { names: { ...held.names, [pod]: name } }),
      });
    });
  }

  /** Records the name the app opens the pod by, when it is not the one recorded. */
  async named(pod: string, name: string): Promise<void> {
    if ((await this.#held()).names?.[pod] === name) return;
    await this.#next(async () => {
      const held = await this.#held();
      await this.#write({ ...held, names: { ...held.names, [pod]: name } });
    });
  }

  /** Each series the app holds, in the order of its feeds and then by label. */
  async held(): Promise<HeldSeries[]> {
    const held = await this.#held();
    let references = await this.references();
    // What is held names the current versions after each index written, so another app on the store has changed the
    // index when they differ.
    if (
      JSON.stringify(currentOf(references)) !== JSON.stringify(held.current)
    ) {
      this.#forgetIndex();
      references = await this.references();
    }
    const { index } = references;
    return this.#ordered(index, held).map((series) => {
      const one = (subject: Term, predicate: string): string | undefined =>
        index.objects(subject, predicate)[0]?.value;
      const version = (of: Term): HeldVersion => ({
        iri: of.value,
        label: one(of, `${PAV}version`),
        issued: one(of, `${DCT}issued`),
      });
      const [current] = index.objects(series, SHIPS_WITH);
      const versions = index
        .subjects(SPECIALIZATION_OF, series)
        .filter((each) => each.value !== current?.value)
        .map(version)
        .sort((a, b) => (b.issued ?? "").localeCompare(a.issued ?? ""));
      const feed = feedOf(held, series.value);
      const checked = feed === undefined ? undefined : held.feeds[feed];
      const source = checked?.series?.[series.value];
      const publisher = one(series, `${DCT}publisher`);
      return {
        iri: series.value,
        label: one(series, `${RDFS}label`) ?? series.value,
        kind: one(series, `${REC}tableKind`),
        licence: one(series, `${DCT}license`),
        publisher,
        publisherName:
          publisher === undefined
            ? undefined
            : checked?.publishers?.[publisher],
        credit: one(series, `${DCT}bibliographicCitation`),
        current: version(current ?? series),
        versions: [version(current ?? series), ...versions],
        feed,
        modified: checked?.modified,
        checked: checked?.checked,
        watched:
          source === undefined || source === null
            ? undefined
            : checked?.watched?.[source],
        source: source ?? undefined,
      };
    });
  }

  /** The pods last opened with each version, by the names the app opened them by, sorted. */
  async uses(): Promise<Record<string, string[]>> {
    const { pods, names = {} } = await this.#held();
    const using: Record<string, string[]> = {};
    for (const [pod, versions] of Object.entries(pods)) {
      const name = names[pod];
      if (name === undefined) continue;
      for (const version of versions) (using[version] ??= []).push(name);
    }
    for (const named of Object.values(using)) named.sort();
    return using;
  }

  /**
   * The codes in the current version of the series, or of each of several, that are `text`, as written or as an IRI,
   * or whose name holds it, ignoring case; every code for no text. In the order of their codes, `PAGE_SIZE` a page,
   * the page numbered `page` from 1, each with what names and status say of it and, in a mapping series, the codes it
   * maps to.
   */
  async search(
    series: string | readonly string[],
    text: string,
    page = 1,
  ): Promise<Searched> {
    const versions = await this.#versionsOf(series);
    if (versions.length === 0)
      return { total: 0, offset: 0, size: PAGE_SIZE, found: [] };
    const [listings, codes, { uriSpaces }] = await Promise.all([
      Promise.all(versions.map((version) => this.#listed(version))),
      this.#codes(versions),
      tableTerms(this.#options.vocabulary, this.#options.newStore),
    ]);
    const wanted = text.trim().toLowerCase();
    const names = wanted === "" ? undefined : await this.#names();
    const matched =
      names === undefined
        ? codes
        : codes.filter(
            (code) =>
              names
                .find((each) => Object.hasOwn(each, code))
                ?.[code]?.includes(wanted) === true ||
              (code.slice(-wanted.length).toLowerCase() === wanted &&
                (code.toLowerCase() === wanted ||
                  notation(uriSpaces, code).toLowerCase() === wanted)),
          );
    const offset =
      Number.isInteger(page) && page > 1 ? (page - 1) * PAGE_SIZE : 0;
    const shown = matched.slice(offset, offset + PAGE_SIZE);
    const mapsTo = (code: string): readonly string[] => [
      ...new Set(
        listings.flatMap(({ mapsTo }) =>
          Object.hasOwn(mapsTo, code) ? mapsTo[code]! : [],
        ),
      ),
    ];
    const about = await this.about([...shown, ...shown.flatMap(mapsTo)]);
    return {
      ...(versions.length === 1 ? { version: versions[0] } : {}),
      total: matched.length,
      offset,
      size: PAGE_SIZE,
      found: shown.map((code) => ({
        code,
        notation: notation(uriSpaces, code),
        about: about.get(code),
        mapsTo: mapsTo(code).map((target) => ({
          code: target,
          notation: notation(uriSpaces, target),
          about: about.get(target),
        })),
      })),
    };
  }

  /**
   * The code written so in the current versions of the series, a code they list or one they map to, from the first
   * series that holds one; none when they hold none.
   */
  async codeNamed(
    series: string | readonly string[],
    written: string,
  ): Promise<string | undefined> {
    for (const version of await this.#versionsOf(series)) {
      const code = (await this.#notationsIn(version)).get(written);
      if (code !== undefined) return code;
    }
    return undefined;
  }

  /**
   * For each code, the ingredients a different form of which the current drug classes versions class, where the code
   * reaches no class of that relation: RxNorm does not tie the code to that form. A code with none is left out.
   */
  async classedElsewhere(
    codes: readonly string[],
  ): Promise<Map<string, string[]>> {
    const references = await this.references();
    const [held, ingredients] = [
      this.#currentOf(references, `${REC}DrugClasses`),
      this.#currentOf(references, `${REC}ProductIngredients`),
    ];
    const found = new Map<string, string[]>();
    for (const code of codes) {
      const elsewhere = new Set(
        (await this.#classes(code, held, ingredients)).flatMap(({ withheld }) =>
          withheld.map(({ ingredient }) => ingredient),
        ),
      );
      if (elsewhere.size > 0) found.set(code, [...elsewhere].sort());
    }
    return found;
  }

  /** What every held series says of the code, or each of `among`, from its current version. */
  async facts(code: string, among?: readonly string[]): Promise<Facts> {
    const [references, { uriSpaces, foundBy, codeSystems }] = await Promise.all(
      [
        this.references(),
        tableTerms(this.#options.vocabulary, this.#options.newStore),
      ],
    );
    const held = (kind: string): Fact[] =>
      this.#currentOf(references, kind, among);
    const rowsOf = (kind: string) =>
      Promise.all(
        held(kind).map(async (fact) => ({
          fact,
          rows: rowsAbout(await this.#text(fact.version), code),
        })),
      );
    const page = (codes: readonly string[]) => ({
      total: codes.length,
      codes: codes.slice(0, PAGE_SIZE),
    });
    const mapped = async ({ series, version }: Fact) => {
      const [{ mapsTo }, from] = await Promise.all([
        this.#listed(version),
        this.#mappedFrom(version),
      ]);
      const others = (target: string): string[] =>
        (from.get(target) ?? []).filter((each) => each !== code);
      const targets = Object.hasOwn(mapsTo, code) ? mapsTo[code]! : [];
      // A code that maps to itself lists the codes mapped to it beside itself, once.
      const sources = targets.includes(code) ? [] : others(code);
      return targets.length === 0 && sources.length === 0
        ? []
        : [
            {
              series,
              version,
              mapsTo: targets.map((target) => ({
                code: target,
                alongside: page(
                  others(target).filter((each) => each !== target),
                ),
              })),
              mappedFrom: page(sources),
            },
          ];
    };
    const [named, statuses, mappings] = await Promise.all([
      rowsOf(`${REC}CodeNames`),
      rowsOf(`${REC}CodeStatus`),
      Promise.all(
        references.index
          .subjects(SHIPS_WITH)
          .filter((series) => ofAKind(references.index, series))
          .map(({ value }) => value)
          .filter(
            (series) =>
              (among === undefined || among.includes(series)) &&
              !OWN_SECTIONS.includes(references.kindOf(series) ?? "") &&
              foundBy
                .get(references.kindOf(series) ?? "")
                ?.includes(`${OWL}annotatedSource`),
          )
          .map((series) =>
            mapped({ series, version: references.fallback(series) }),
          ),
      ).then((each) => each.flat()),
    ]);
    // Only a variation is a row's subject; a version's rows are not read for any other code.
    const clinvar = codeSystems.find(({ iri }) => iri === `${REC}ClinVar`);
    const classifications = (
      await Promise.all(
        (clinvar !== undefined && code.startsWith(clinvar.uriSpace)
          ? held(CLASSIFICATIONS)
          : []
        ).map(async (fact) => {
          const rows = rowsAbout(await this.#text(fact.version), code);
          return rows.length === 0
            ? []
            : [{ ...fact, ...(await this.#classification(code, rows)) }];
        }),
      )
    ).flat();
    const names = named.flatMap(({ fact, rows }) => {
      const [label] = values(rows, `${SKOS}prefLabel`);
      return label === undefined
        ? []
        : [{ ...fact, label, altLabels: values(rows, `${SKOS}altLabel`) }];
    });
    const status = statuses.flatMap(({ fact, rows }) => {
      const [deprecated] = values(rows, `${OWL}deprecated`);
      return deprecated === undefined
        ? []
        : [
            {
              ...fact,
              deprecated: deprecated === "true",
              replacedBy: values(rows, `${DCT}isReplacedBy`),
            },
          ];
    });
    // A panel and a class are the code's whatever source's page asks: a medication's classes are MED-RT's, not RxNorm's.
    const anywhere = (kind: string): Fact[] =>
      this.#currentOf(references, kind);
    const [panels, classes] = await Promise.all([
      this.#panels(code, anywhere(`${REC}PanelMembers`)),
      this.#classes(
        code,
        anywhere(`${REC}DrugClasses`),
        anywhere(`${REC}ProductIngredients`),
      ),
    ]);
    const about = await this.about([
      code,
      ...status.flatMap(({ replacedBy }) => replacedBy),
      ...mappings.flatMap(({ mapsTo, mappedFrom }) => [
        ...mapsTo.flatMap((target) => [target.code, ...target.alongside.codes]),
        ...mappedFrom.codes,
      ]),
      ...panels.flatMap(({ members, heldBy }) => [
        ...members.map(({ code }) => code),
        ...heldBy.panels.map(({ code }) => code),
      ]),
      ...classes.flatMap(({ in: each, withheld }) => [
        ...each.flatMap(({ class: of, through }) =>
          through === undefined ? [of] : [of, through],
        ),
        ...withheld.map(({ ingredient }) => ingredient),
      ]),
    ]);
    const coded = (each: string): Coded => ({
      code: each,
      notation: notation(uriSpaces, each),
      about: about.get(each),
    });
    const codes = ({ total, codes }: { total: number; codes: string[] }) => ({
      total,
      codes: codes.map(coded),
    });
    const system = codeSystems.find(({ uriSpace }) =>
      code.startsWith(uriSpace),
    );
    return {
      ...coded(code),
      ...(system?.pageTemplate !== undefined && {
        page: {
          href: system.pageTemplate.replace("{code}", () =>
            code.slice(system.uriSpace.length),
          ),
          system: system.label,
        },
      }),
      names,
      status: status.map((fact) => ({
        ...fact,
        replacedBy: fact.replacedBy.map(coded),
      })),
      mappings: mappings.map((fact) => ({
        ...fact,
        mapsTo: fact.mapsTo.map((target) => ({
          ...coded(target.code),
          alongside: codes(target.alongside),
        })),
        mappedFrom: codes(fact.mappedFrom),
      })),
      classifications,
      panels: panels.map((fact) => ({
        ...fact,
        members: fact.members.map(({ code, ...place }) => ({
          ...coded(code),
          ...place,
        })),
        heldBy: {
          total: fact.heldBy.total,
          panels: fact.heldBy.panels.map(({ code, ...place }) => ({
            ...coded(code),
            ...place,
          })),
        },
      })),
      classes: classes.map((fact) => ({
        ...fact,
        in: fact.in.map(({ relation, class: of, through }) => ({
          relation,
          class: coded(of),
          ...(through !== undefined && { through: coded(through) }),
        })),
        withheld: fact.withheld.map(({ relation, ingredient }) => ({
          relation,
          ingredient: coded(ingredient),
        })),
      })),
    };
  }

  /**
   * In each panel members version, the rows that have the code as their panel, by their sequence, and as their member,
   * by their panel's notation. Rows are read by predicate, which a listing drops.
   */
  async #panels(
    code: string,
    held: readonly Fact[],
  ): Promise<
    (Fact & {
      members: PlaceOf[];
      heldBy: { total: number; panels: PlaceOf[] };
    })[]
  > {
    const { uriSpaces } = await tableTerms(
      this.#options.vocabulary,
      this.#options.newStore,
    );
    return (
      await Promise.all(
        held.map(async (fact) => {
          const [index, text] = await Promise.all([
            this.#codesIn(fact.version),
            this.#text(fact.version),
          ]);
          const members: PlaceOf[] = [];
          const holding: PlaceOf[] = [];
          for (const subject of index.get(code) ?? []) {
            const rows = rowsAbout(text, subject);
            const [panel] = values(rows, `${OWL}annotatedSource`);
            const [member] = values(rows, `${OWL}annotatedTarget`);
            const [sequence] = values(rows, `${REC}panelSequence`);
            const [required] = values(rows, `${REC}observationRequiredInPanel`);
            const place = {
              ...(sequence !== undefined && { sequence: Number(sequence) }),
              ...(required !== undefined && { required }),
            };
            if (panel === code && member !== undefined)
              members.push({ code: member, ...place });
            if (member === code && panel !== undefined)
              holding.push({ code: panel, ...place });
          }
          const byNotation = (a: PlaceOf, b: PlaceOf): number =>
            NOTATIONS.compare(
              notation(uriSpaces, a.code),
              notation(uriSpaces, b.code),
            ) || (a.sequence ?? 0) - (b.sequence ?? 0);
          members.sort(
            (a, b) =>
              (a.sequence ?? Infinity) - (b.sequence ?? Infinity) ||
              byNotation(a, b),
          );
          holding.sort(byNotation);
          return members.length === 0 && holding.length === 0
            ? []
            : [
                {
                  ...fact,
                  members,
                  heldBy: {
                    total: holding.length,
                    panels: holding.slice(0, PAGE_SIZE),
                  },
                },
              ];
        }),
      )
    ).flat();
  }

  /**
   * In each drug classes version, the classes of the code, by `tables/medication-classes-through-precise-ingredients.rq`'s
   * rule, relation by relation, for each ingredient a product ingredients version maps the code to: a class row on the
   * code itself is its class; else the classes of its own precise ingredients that are forms of that ingredient, when
   * one or more bear a row of the relation; else, in a version that states precise ingredients, the ingredient's own.
   * Nothing else: a relation the code reaches no class for, though a different form of its ingredient bears one, is
   * withheld, naming the ingredient, for RxNorm does not tie the code to that form. Only a version that states precise
   * ingredients says that: one that states none is silent on forms, so it withholds nothing.
   */
  async #classes(
    code: string,
    held: readonly Fact[],
    ingredients: readonly Fact[],
  ): Promise<(Fact & { in: ClassOf[]; withheld: WithheldOf[] })[]> {
    if (held.length === 0) return [];
    const maps = await Promise.all(
      ingredients.map(async ({ version }) => {
        const [{ mapsTo, precise }, from] = await Promise.all([
          this.#listed(version),
          this.#mappedFrom(version),
        ]);
        return {
          mapsTo,
          precise,
          from,
          stating: Object.keys(precise).length > 0,
        };
      }),
    );
    return (
      await Promise.all(
        held.map(async (fact) => {
          const [index, text] = await Promise.all([
            this.#codesIn(fact.version),
            this.#text(fact.version),
          ]);
          const classesOf = (on: string): Map<string, Set<string>> => {
            const byRelation = new Map<string, Set<string>>();
            for (const subject of index.get(on) ?? []) {
              const rows = rowsAbout(text, subject);
              const [relation] = values(rows, `${OWL}annotatedProperty`);
              const [target] = values(rows, `${OWL}annotatedTarget`);
              if (relation !== undefined && target !== undefined)
                byRelation.set(
                  relation,
                  (byRelation.get(relation) ?? new Set()).add(target),
                );
            }
            return byRelation;
          };
          // The step a class was reached at (0 the code, 1 its own precise ingredient, 2 the ingredient) and the code it is on.
          const found = new Map<string, { step: number; of: ClassOf }>();
          const keep = (
            relation: string,
            target: string,
            step: number,
            on: string,
          ): void => {
            const key = `${relation} ${target}`;
            const before = found.get(key);
            if (
              before === undefined ||
              step < before.step ||
              (step === before.step && on < (before.of.through ?? code))
            )
              found.set(key, {
                step,
                of: {
                  relation,
                  class: target,
                  ...(step > 0 && { through: on }),
                },
              });
          };
          const mine = classesOf(code);
          for (const [relation, targets] of mine)
            for (const target of targets) keep(relation, target, 0, code);
          // A different form of an ingredient that bears a relation's rows, by the relation.
          const elsewhere = new Map<string, Set<string>>();
          for (const { mapsTo, precise, from, stating } of maps)
            for (const ingredient of Object.hasOwn(mapsTo, code)
              ? mapsTo[code]!
              : []) {
              const forms = (
                Object.hasOwn(precise, code) ? precise[code]! : []
              ).filter((form) => mapsTo[form]?.includes(ingredient));
              const own = classesOf(ingredient);
              const bearing = forms.map(
                (form) => [form, classesOf(form)] as const,
              );
              const othersBear = new Set(
                (from.get(ingredient) ?? [])
                  .filter((other) => other !== code && other !== ingredient)
                  .flatMap((other) => [...classesOf(other).keys()]),
              );
              for (const relation of RELATIONS) {
                if (mine.has(relation)) continue;
                const by = bearing.filter(([, classes]) =>
                  classes.has(relation),
                );
                if (by.length > 0)
                  for (const [form, classes] of by)
                    for (const target of classes.get(relation)!)
                      keep(relation, target, 1, form);
                else if (stating && own.has(relation))
                  for (const target of own.get(relation)!)
                    keep(relation, target, 2, ingredient);
                else if (stating && othersBear.has(relation))
                  elsewhere.set(
                    relation,
                    (elsewhere.get(relation) ?? new Set()).add(ingredient),
                  );
              }
            }
          const reached = new Set(
            [...found.values()].map(({ of }) => of.relation),
          );
          const withheld = new Map<string, WithheldOf>();
          for (const [relation, ingredients] of elsewhere)
            if (!reached.has(relation))
              for (const ingredient of ingredients)
                withheld.set(`${relation} ${ingredient}`, {
                  relation,
                  ingredient,
                });
          const each = [...found.values()]
            .map(({ of }) => of)
            .sort(
              (a, b) =>
                RELATIONS.indexOf(a.relation) - RELATIONS.indexOf(b.relation) ||
                a.class.localeCompare(b.class),
            );
          const left = [...withheld.values()].sort(
            (a, b) =>
              RELATIONS.indexOf(a.relation) - RELATIONS.indexOf(b.relation),
          );
          return each.length === 0 && left.length === 0
            ? []
            : [{ ...fact, in: each, withheld: left }];
        }),
      )
    ).flat();
  }

  /**
   * The codes, then their ingredients and their own precise ingredients in each of the product ingredients versions:
   * the codes a class of the codes may be on.
   */
  async #classedOn(
    codes: readonly string[],
    versions: readonly string[],
  ): Promise<Set<string>> {
    const on = new Set(codes);
    for (const version of versions) {
      const { mapsTo, precise } = await this.#listed(version);
      for (const code of codes)
        for (const each of [
          ...(Object.hasOwn(mapsTo, code) ? mapsTo[code]! : []),
          ...(Object.hasOwn(precise, code) ? precise[code]! : []),
        ])
          on.add(each);
    }
    return on;
  }

  /**
   * The panels the current version of each panel members series lists the code in, at most a page of them by their
   * codes, with the sequence and requirement of the row that lists it, and how many there are in all; a series that
   * lists it in none is left out.
   */
  async inPanels(
    code: string,
  ): Promise<(Fact & { total: number; panels: readonly Placed[] })[]> {
    const references = await this.references();
    const held = this.#currentOf(references, `${REC}PanelMembers`);
    const found = (await this.#panels(code, held)).filter(
      ({ heldBy }) => heldBy.total > 0,
    );
    const about = await this.about(
      found.flatMap(({ heldBy }) => heldBy.panels.map((each) => each.code)),
    );
    return found.map(({ series, version, heldBy }) => ({
      series,
      version,
      total: heldBy.total,
      panels: heldBy.panels.map(({ code: panel, ...place }) => ({
        code: panel,
        notation: about.get(panel)!.notation,
        about: about.get(panel),
        ...place,
      })),
    }));
  }

  /**
   * The rows `tables/panel-results.rq` reads of a panel: in the current version of each panel members series, the rows
   * that list a member of the panel or of a panel nested in it, however deep, each with the descriptions of the version
   * and its series. The rows of the panels that list the panel, or list a member of it, are left out: the query is
   * asked of this panel alone.
   */
  async panelRows(
    panel: string,
  ): Promise<{ version: string; rows: Triple[]; description: Triple[] }[]> {
    const references = await this.references();
    const terms = await tableTerms(
      this.#options.vocabulary,
      this.#options.newStore,
    );
    const versions = this.#currentOf(references, `${REC}PanelMembers`).map(
      ({ version }) => version,
    );
    return Promise.all(
      versions.map(async (version) => {
        await this.#codesIn(version);
        const nested = new Set([panel]);
        const seen = new Set<string>();
        const rows: Triple[] = [];
        for (let level = [panel]; level.length > 0;) {
          const bySubject = new Map<string, Triple[]>();
          for (const triple of await references.rows(version, {
            codes: new Set(level),
            terms,
          }))
            bySubject.set(triple[0].value, [
              ...(bySubject.get(triple[0].value) ?? []),
              triple,
            ]);
          level = [];
          for (const [subject, triples] of bySubject) {
            const objectOf = (property: string): string | undefined =>
              triples.find(([, each]) => each.value === property)?.[2].value;
            const source = objectOf(`${OWL}annotatedSource`);
            const member = objectOf(`${OWL}annotatedTarget`);
            if (
              source === undefined ||
              !nested.has(source) ||
              seen.has(subject)
            )
              continue;
            seen.add(subject);
            rows.push(...triples);
            if (member !== undefined && !nested.has(member)) {
              nested.add(member);
              level.push(member);
            }
          }
        }
        return {
          version,
          rows,
          description: [
            ...references.description(version),
            ...references.description(references.seriesOf(version) ?? ""),
          ],
        };
      }),
    );
  }

  /**
   * The rows a walk from these codes to their drug classes can read, for
   * `tables/medication-classes-through-precise-ingredients.rq`: in the current version of each drug classes series the
   * rows of the codes, their ingredients and their own precise ingredients, the only codes a class of theirs may be on;
   * in the current version of each product ingredients series the rows of those codes, and one precise ingredient row
   * where the version holds any, which says the version states them. Each comes with the descriptions of the version
   * and its series. A superset of what the query joins; the query says what is a class of what.
   */
  async reached(
    codes: readonly string[],
  ): Promise<{ version: string; rows: Triple[]; description: Triple[] }[]> {
    const references = await this.references();
    const terms = await tableTerms(
      this.#options.vocabulary,
      this.#options.newStore,
    );
    const current = (kind: string): string[] =>
      this.#currentOf(references, kind).map(({ version }) => version);
    const ingredients = current(`${REC}ProductIngredients`);
    const on = await this.#classedOn(codes, ingredients);
    const read = async (version: string, among: ReadonlySet<string>) => {
      // The rows are found by an index beside them, which is made now if the version came without one.
      await this.#codesIn(version);
      return {
        version,
        rows: await references.rows(version, { codes: among, terms }),
        description: [
          ...references.description(version),
          ...references.description(references.seriesOf(version) ?? ""),
        ],
      };
    };
    return Promise.all([
      ...ingredients.map(async (version) => {
        const [stating] = Object.keys((await this.#listed(version)).precise);
        return read(
          version,
          stating === undefined ? on : new Set(on).add(stating),
        );
      }),
      ...current(`${REC}DrugClasses`).map((version) => read(version, on)),
    ]);
  }

  /**
   * What the app's current version of the first held variant classifications series that covers the variant's gene says
   * of the variant. The row is found as rule R13 finds it: through the variant's ClinVar IDs when it has any, through
   * its HGVS expressions only when it has none; one row answers, none or several are "not found".
   */
  async variantClassification(variant: VariantAsked): Promise<WhatClinVarSays> {
    const [references, { codeSystems }] = await Promise.all([
      this.references(),
      tableTerms(this.#options.vocabulary, this.#options.newStore),
    ]);
    const held = this.#currentOf(references, CLASSIFICATIONS).map((fact) => ({
      ...fact,
      genes: references.index
        .objects(iri(fact.version), `${REC}coversGene`)
        .map(({ value }) => value),
    }));
    const [first] = held;
    if (first === undefined) return { found: "no series" };
    const stem = (system: string): string => {
      const found = codeSystems.find((each) => each.iri === `${REC}${system}`);
      if (found === undefined)
        throw new Error(
          `the vocabulary registers no code system rec:${system}`,
        );
      return found.uriSpace;
    };
    const codes =
      variant.variations.length > 0
        ? variant.variations.map((each) => codeIri(stem("ClinVar"), each))
        : variant.hgvs.map((each) => codeIri(stem("HGVS"), each));
    const answer = async (
      one: (typeof held)[number],
    ): Promise<WhatClinVarSays> => {
      const index = await this.#codesIn(one.version);
      const subjects = new Set(codes.flatMap((code) => index.get(code) ?? []));
      const [subject, ...others] = subjects;
      const { series, version } = one;
      if (subject === undefined || others.length > 0)
        return { found: "not found", series, version };
      return {
        found: "rows",
        series,
        version,
        rows: [
          await this.#classification(
            subject,
            rowsAbout(await this.#text(version), subject),
          ),
        ],
      };
    };
    const read = async (
      among: readonly (typeof held)[number][],
    ): Promise<WhatClinVarSays | undefined> => {
      for (const one of among) {
        const answered = await answer(one);
        if (answered.found === "rows") return answered;
      }
      return undefined;
    };
    if (variant.gene === undefined)
      return (
        (await read(held)) ?? {
          found: "not found",
          series: first.series,
          version: first.version,
        }
      );
    const covering = held.find(({ genes }) => genes.includes(variant.gene!));
    if (covering !== undefined) return answer(covering);
    const unnamed = await read(held.filter(({ genes }) => genes.length === 0));
    if (unnamed !== undefined) return unnamed;
    const stating = held.find(({ genes }) => genes.length > 0);
    return stating === undefined
      ? { found: "not found", series: first.series, version: first.version }
      : {
          found: "not covered",
          series: stating.series,
          version: stating.version,
          genes: [...stating.genes].sort(),
        };
  }

  /** Each concept's `skos:prefLabel`, else `rdfs:label`, in the vocabulary's records ontology; a concept with neither is left out. */
  async labels(concepts: readonly string[]): Promise<Map<string, string>> {
    const known = await this.#labelled();
    return new Map(
      concepts.flatMap((concept) => {
        const label = known.get(concept);
        return label === undefined ? [] : [[concept, label] as const];
      }),
    );
  }

  #labelled(): Promise<ReadonlyMap<string, string>> {
    this.#concepts ??= (async () => {
      const { vocabulary, newStore } = this.#options;
      const graph = new Graph(
        await newStore().parse(
          await readText(vocabulary, RECORDS),
          vocabulary.iri + RECORDS,
        ),
      );
      const labels = new Map<string, string>();
      for (const predicate of [`${SKOS}prefLabel`, `${RDFS}label`])
        for (const [subject, , label] of graph.match(undefined, predicate))
          if (!labels.has(subject.value))
            labels.set(subject.value, label.value);
      return labels;
    })();
    const p = this.#concepts;
    p.catch(() => {
      if (this.#concepts === p) this.#concepts = undefined;
    });
    return p;
  }

  /** A variant classifications row, read from the lines of its subject. */
  async #classification(
    variation: string,
    rows: readonly Row[],
  ): Promise<ClassificationRow> {
    const classes = values(rows, `${REC}clinvarClassification`);
    const [status] = values(rows, `${REC}clinvarReviewStatus`);
    const [evaluated] = values(rows, `${REC}lastEvaluated`);
    const [contributing] = values(rows, `${REC}contributingSubmitters`);
    const [submitters] = values(rows, `${REC}submitters`);
    const named = await this.labels([...classes, ...(status ? [status] : [])]);
    const concept = (each: string): Concept => ({
      iri: each,
      label: named.get(each) ?? each,
    });
    return {
      variation,
      classification: classes.map(concept),
      ...(status === undefined ? {} : { reviewStatus: concept(status) }),
      ...(evaluated === undefined ? {} : { lastEvaluated: evaluated }),
      ...(contributing === undefined
        ? {}
        : { contributingSubmitters: Number(contributing) }),
      ...(submitters === undefined ? {} : { submitters: Number(submitters) }),
    };
  }

  /**
   * In a version, the row subjects each code finds, as the index `rowsByCode` wrote beside it; when that is missing or
   * was built for other properties, made from its lines and kept beside it, as a listing is. Read once, by `References`.
   */
  async #codesIn(
    version: string,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const { vocabulary, newStore } = this.#options;
    const [references, { foundBy }] = await Promise.all([
      this.references(),
      tableTerms(vocabulary, newStore),
    ]);
    const by =
      foundBy.get(
        references.kindOf(references.seriesOf(version) ?? "") ?? "",
      ) ?? [];
    const kept = await references.codes(version, by);
    if (kept !== undefined) return kept;
    const made = rowsByCode(termsOfRows(await references.text(version)), by);
    if (made === undefined) return new Map();
    await this.#files.write(`${stemOf(version)}${CODES}`, made);
    return (await references.codes(version, by)) ?? new Map();
  }

  /** The current version of each series given that the app holds. */
  async #versionsOf(series: string | readonly string[]): Promise<string[]> {
    const { index } = await this.references();
    return (typeof series === "string" ? [series] : series).flatMap((each) =>
      ofAKind(index, iri(each))
        ? (index.objects(iri(each), SHIPS_WITH)[0]?.value ?? [])
        : [],
    );
  }

  /** The codes the versions list, as one list in the order of their notations; made once for the versions. */
  #codes(versions: readonly string[]): Promise<readonly string[]> {
    return once(this.#merges, versions.join(" "), async () => {
      const [listings, { uriSpaces }] = await Promise.all([
        Promise.all(versions.map((version) => this.#listed(version))),
        tableTerms(this.#options.vocabulary, this.#options.newStore),
      ]);
      return merged(
        listings.map(({ codes }) => codes),
        uriSpaces,
      );
    });
  }

  /** In a version, each code it lists or maps to, by its notation, the first listed for a notation; made once. */
  #notationsIn(version: string): Promise<ReadonlyMap<string, string>> {
    return once(this.#notations, version, async () => {
      const [{ codes, mapsTo }, { uriSpaces }] = await Promise.all([
        this.#listed(version),
        tableTerms(this.#options.vocabulary, this.#options.newStore),
      ]);
      const named = new Map<string, string>();
      for (const code of [...codes, ...Object.values(mapsTo).flat()]) {
        const written = notation(uriSpaces, code);
        if (!named.has(written)) named.set(written, code);
      }
      return named;
    });
  }

  /** In a mapping version, the codes mapped to each code; made once. */
  #mappedFrom(
    version: string,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    return once(this.#inverses, version, async () => {
      const from = new Map<string, string[]>();
      const { codes, mapsTo } = await this.#listed(version);
      for (const code of codes)
        for (const target of Object.hasOwn(mapsTo, code) ? mapsTo[code]! : []) {
          const sources = from.get(target) ?? [];
          sources.push(code);
          from.set(target, sources);
        }
      return from;
    });
  }

  /** A held version's N-Triples, read once, by `References`: a version's rows never change. */
  async #text(version: string): Promise<string> {
    return (await this.references()).text(version);
  }

  /** A held version's N-Triples as they are kept. */
  async #rows(version: string): Promise<Uint8Array<ArrayBuffer>> {
    const bytes = await new TablesFiles(
      this.#files,
      this.#options.vocabulary,
    ).read(`${stemOf(version)}.ttl`);
    if (bytes === undefined)
      throw new Refusal(`the tables hold no rows for ${version}`);
    return new Uint8Array(bytes);
  }

  /**
   * A held version's listing, read once: as a check kept it beside the version, or, when it did not, as listed from
   * its rows and then kept there.
   */
  #listed(version: string): Promise<Listed> {
    return once(this.#listings, version, async () => {
      const files = this.#files;
      const path = `${stemOf(version)}${LISTED}`;
      const [bytes, { uriSpaces }] = await Promise.all([
        files.read(path),
        tableTerms(this.#options.vocabulary, this.#options.newStore),
      ]);
      const kept =
        bytes === undefined ? undefined : keptListing(bytes, uriSpaces);
      if (kept !== undefined) return kept;
      const listed = await (this.#options.work ?? IN_THIS_THREAD).listed(
        await this.#rows(version),
        uriSpaces,
      );
      await files.write(path, listed);
      return JSON.parse(new TextDecoder().decode(listed)) as Listed;
    });
  }

  /** Each names series' listing of its codes' names, in the order of preference. */
  async #names(): Promise<Listed["names"][]> {
    const references = await this.references();
    return Promise.all(
      this.#currentOf(references, `${REC}CodeNames`).map(
        async ({ version }) => (await this.#listed(version)).names,
      ),
    );
  }

  /** The series the store holds, in the order of the feeds that describe them, and then by label. */
  #ordered(index: Graph, held: Held): Term[] {
    const { feeds } = this.#options;
    const place = (series: Term): number => {
      const at = feeds.indexOf(feedOf(held, series.value) ?? "");
      return at < 0 ? feeds.length : at;
    };
    const label = (series: Term): string =>
      index.objects(series, `${RDFS}label`)[0]?.value ?? series.value;
    return index
      .subjects(SHIPS_WITH)
      .filter((series) => ofAKind(index, series))
      .sort((a, b) => place(a) - place(b) || label(a).localeCompare(label(b)));
  }

  #next<T>(call: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      await this.#start();
      return call();
    };
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  /**
   * An empty store starts from the starter copies' index and what they hold, and again whenever it is emptied, as
   * removing an app's pods does; their versions are read through on first use. What is held is written last, so a
   * start cut short starts again.
   */
  #start(): Promise<void> {
    this.#started ??= (async () => {
      const { files, starter } = this.#options;
      const empty = (await files.read(HELD)) === undefined;
      if (empty) this.#forgetIndex();
      if (starter === undefined || !empty) return;
      const paths = await starter.list("");
      const ofVersions = new Set([...versionsIn(paths).values()].flat());
      for (const path of [
        ...paths.filter((path) => !ofVersions.has(path) && path !== HELD),
        ...paths.filter((path) => path === HELD),
      ]) {
        const bytes = await starter.read(path);
        if (bytes === undefined) continue;
        await files.write(path, bytes);
        this.#written += bytes.byteLength;
      }
      this.#forgetIndex();
    })().finally(() => {
      this.#started = undefined;
    });
    return this.#started;
  }

  async #held(): Promise<Held> {
    await this.#start();
    const bytes = await this.#files.read(HELD);
    return bytes === undefined ? NOTHING_HELD : heldOf(bytes);
  }

  #write(held: Held): Promise<void> {
    return this.#files.write(
      HELD,
      new TextEncoder().encode(`${JSON.stringify(held, null, 2)}\n`),
    );
  }

  async #index(): Promise<Graph> {
    return this.#graph(await this.#files.read(INDEX));
  }

  /** Drops what was read of the store's index, once it is written. */
  #forgetIndex(): void {
    this.#references = undefined;
  }

  /** The store's file at `path`, or, while the store holds nothing, the starter copy it starts from. */
  async #readable(path: string): Promise<Uint8Array | undefined> {
    const { files, starter } = this.#options;
    const held = (await files.read(HELD)) !== undefined;
    return held || starter === undefined
      ? files.read(path)
      : starter.read(path);
  }

  async #graph(bytes: Uint8Array | undefined): Promise<Graph> {
    return new Graph(
      bytes === undefined
        ? []
        : await this.#options.newStore().parse(bytes, this.#options.files.iri),
    );
  }

  async #checkFeed(feed: string, init: RequestInit): Promise<Checked> {
    const fetching = this.#options.fetch ?? fetch;
    const kept: string[] = [];
    const refused: { version: string; reason: string }[] = [];
    const answer = async (
      url: string,
    ): Promise<Uint8Array<ArrayBuffer> | string> => {
      try {
        const response = await fetching(url, init);
        return response.ok
          ? new Uint8Array(await response.arrayBuffer())
          : `${url} answered ${response.status}`;
      } catch (error) {
        return `${url} could not be read: ${error instanceof Error ? error.message : String(error)}`;
      }
    };
    const answered = await answer(feed);
    if (typeof answered === "string")
      return { feed, kept, later: answered, refused };
    let catalog: Graph;
    try {
      catalog = new Graph(await this.#options.newStore().parse(answered, feed));
    } catch (error) {
      return {
        feed,
        kept,
        later: `${feed} is not Turtle: ${error instanceof Error ? error.message : String(error)}`,
        refused,
      };
    }
    let index = await this.#index();
    let later: string | undefined;
    for (const series of catalog.subjects(
      `${RDF}type`,
      iri(`${REC}ReferenceSeries`),
    )) {
      const [version] = catalog.objects(series, `${DCAT}hasCurrentVersion`);
      const kind = catalog.objects(series, `${REC}tableKind`)[0]?.value ?? "";
      if (
        version?.termType !== "NamedNode" ||
        index.match(version, SPECIALIZATION_OF).length > 0 ||
        !(await this.#kindsRead()).has(kind)
      )
        continue;
      const [held] = index.objects(series, `${REC}shipsWith`);
      if (held !== undefined && !descends(catalog, version, held.value)) {
        refused.push({
          version: version.value,
          reason: `it does not descend from ${held.value}, the version of its series held`,
        });
        continue;
      }
      const [distribution] = catalog.objects(version, `${DCAT}distribution`);
      const [url] =
        distribution === undefined
          ? []
          : catalog.objects(distribution, `${DCAT}downloadURL`);
      const [checksum] =
        distribution === undefined
          ? []
          : catalog
              .objects(distribution, `${SPDX}checksum`)
              .flatMap((sum) => catalog.objects(sum, `${SPDX}checksumValue`));
      if (url === undefined || checksum === undefined) {
        refused.push({
          version: version.value,
          reason: "the feed gives no download URL and checksum for it",
        });
        continue;
      }
      const bytes = await answer(url.value);
      if (typeof bytes === "string") {
        later = bytes;
        continue;
      }
      const terms = await tableTerms(
        this.#options.vocabulary,
        this.#options.newStore,
      );
      const rows = await (this.#options.work ?? IN_THIS_THREAD).verified({
        bytes,
        checksum: checksum.value,
        version: version.value,
        series: series.value,
        previous: catalog.objects(version, REVISION_OF)[0]?.value,
        foundBy: terms.foundBy.get(kind) ?? [],
        uriSpaces: terms.uriSpaces,
      });
      if ("refused" in rows) {
        refused.push({ version: version.value, reason: rows.refused });
        continue;
      }
      const stem = fileStem(version.value);
      await this.#files.write(`${stem}.ttl`, rows.text);
      if (rows.codes !== undefined)
        await this.#files.write(stem + CODES, rows.codes);
      await this.#files.write(stem + LISTED, rows.listed);
      index = new Graph([
        ...index.triples.filter(
          ([subject, predicate]) =>
            !(
              subject.value === series.value &&
              [...SERIES_KEPT, `${REC}shipsWith`].includes(predicate.value)
            ),
        ),
        ...only(catalog, series, SERIES_KEPT),
        [series, iri(`${REC}shipsWith`), version],
        [version, iri(`${RDF}type`), iri(`${PROV}Entity`)],
        ...only(catalog, version, VERSION_KEPT),
        ...catalog
          .match(undefined, REVISION_OF)
          .filter(
            ([earlier]) =>
              catalog.match(earlier, SPECIALIZATION_OF, series).length > 0,
          ),
      ]);
      await this.#files.write(INDEX, ntriples(index.triples));
      this.#forgetIndex();
      await this.#write({ ...(await this.#held()), current: currentIn(index) });
      if (held !== undefined) {
        this.#listings.delete(held.value);
        this.#inverses.delete(held.value);
        this.#notations.delete(held.value);
        for (const key of this.#merges.keys())
          if (key.split(" ").includes(held.value)) this.#merges.delete(key);
      }
      kept.push(version.value);
    }
    const watched = await answer(new URL(WATCHED, feed).href);
    const held = await this.#held();
    const modified = catalog.objects(iri(feed), `${DCT}modified`)[0]?.value;
    await this.#write({
      ...held,
      feeds: {
        ...held.feeds,
        [feed]: {
          checked: new Date().toISOString(),
          ...(modified === undefined ? {} : { modified }),
          series: Object.fromEntries(
            catalog
              .subjects(`${RDF}type`, iri(`${REC}ReferenceSeries`))
              .map((series) => [
                series.value,
                catalog.objects(series, `${DCT}source`)[0]?.value ?? null,
              ]),
          ),
          publishers: Object.fromEntries(
            catalog
              .match(undefined, `${DCT}publisher`)
              .flatMap(([, , publisher]) =>
                catalog
                  .objects(publisher, `${RDFS}label`)
                  .slice(0, 1)
                  .map((label) => [publisher.value, label.value]),
              ),
          ),
          watched:
            (typeof watched === "string" ? undefined : watchedIn(watched)) ??
            held.feeds[feed]?.watched,
        },
      },
      current: currentIn(index),
    });
    return { feed, kept, ...(later === undefined ? {} : { later }), refused };
  }
}

/**
 * The starter copies: the store a check of the feeds keeps now, each version's rows in it as the feed published them
 * (`PUBLISHED_ROWS`) in place of its N-Triples, so they are carried at their published size, and its listing for
 * search beside it, so a new app lists nothing.
 */
export async function writeStarterCopies(
  options: Pick<TablesOptions, "feeds" | "vocabulary" | "newStore"> & {
    readonly fetch?: typeof fetch;
  },
  write: (path: string, bytes: Uint8Array) => Promise<void>,
): Promise<Checked[]> {
  const published = new Map<string, Uint8Array>();
  const fetching = options.fetch ?? fetch;
  const store = new MemoryFiles("urn:cascade:starter-tables/");
  const checked = await new Tables({
    ...options,
    files: store,
    fetch: async (input, init) => {
      const response = await fetching(input, init);
      if (!response.ok) return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const nquads = await gunzipped(bytes).catch(() => "");
        const [, version] = / <([^<>]*)> \.$/m.exec(nquads) ?? [];
        if (version !== undefined)
          published.set(`${fileStem(version)}.ttl`, bytes);
      }
      return new Response(bytes, { status: response.status });
    },
  }).check({ cache: "no-cache" });
  for (const path of await store.list("")) {
    const rows = published.get(path);
    if (rows !== undefined)
      await write(`${path.slice(0, -".ttl".length)}${PUBLISHED_ROWS}`, rows);
    else await write(path, (await store.read(path))!);
  }
  return checked;
}
