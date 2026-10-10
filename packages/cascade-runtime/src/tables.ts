import {
  canonical,
  CODES,
  type Files,
  fileStem,
  Graph,
  iri,
  MemoryFiles,
  ntriples,
  RDF,
  References,
  Refusal,
  RULE_LIST,
  relative,
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
  values,
} from "./rows.js";

const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const PAV = "http://purl.org/pav/";
const DCAT = "http://www.w3.org/ns/dcat#";
const DCT = "http://purl.org/dc/terms/";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const SPDX = "http://spdx.org/rdf/terms#";
const SHIPS_WITH = `${REC}shipsWith`;
/** Beside a feed, when its watcher last checked each source. */
const WATCHED = "checked.json";
/** How many codes a page of a search shows. */
export const PAGE_SIZE = 50;
/** What follows a version's file stem in the name of its listing, which a search reads. */
export const LISTED = ".listed.json";
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

/** What a names or status series says of a code, from the first series in the order of preference that holds it. */
export interface About {
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
}

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
  /** The package's starter copies, a store an empty one starts from. */
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

/** In the starter copies, what follows a version's file stem in place of `.ttl`: its rows as the feed published them. */
export const PUBLISHED_ROWS = ".nq.gz";

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

/** An app's reference tables: the versions it keeps from its feeds, beside its pods, and the vocabulary's rule list. */
export class Tables {
  readonly #options: TablesOptions;
  #queue: Promise<unknown> = Promise.resolve();
  #started: Promise<void> | undefined;
  readonly #texts = new Map<string, Promise<string>>();
  readonly #listings = new Map<string, Promise<Listed>>();
  readonly #merges = new Map<string, Promise<readonly string[]>>();
  readonly #notations = new Map<string, Promise<ReadonlyMap<string, string>>>();
  readonly #inverses = new Map<
    string,
    Promise<ReadonlyMap<string, readonly string[]>>
  >();
  #kinds: Promise<ReadonlySet<string>> | undefined;

  constructor(options: TablesOptions) {
    this.#options = options;
  }

  /**
   * The kinds something the app runs reads: the kind a row of the vocabulary's rule list names, and names and status,
   * which views read. A series of any other kind is neither kept nor packed.
   */
  #kindsRead(): Promise<ReadonlySet<string>> {
    this.#kinds ??= (async () => {
      const { vocabulary, newStore } = this.#options;
      const kinds = new Set([`${REC}CodeNames`, `${REC}CodeStatus`]);
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
    return this.#kinds;
  }

  /** Runs the local builders, then reads each feed and keeps each current version it does not hold that verifies. */
  check(init: RequestInit = {}): Promise<Checked[]> {
    return this.#next(async () => {
      const { feeds, builds } = this.#options;
      const built = (await builds?.run(init)) ?? new Map();
      const checked: Checked[] = [];
      for (const feed of [...feeds, ...(builds?.feeds ?? [])])
        checked.push(withBuilt(await this.#checkFeed(feed, init), built));
      // Listed now, so a version the starter copies brought is quick on its first view too.
      const kept = new Set(await this.#options.files.list(""));
      for (const [, , version] of (await this.#index()).match(
        undefined,
        SHIPS_WITH,
      ))
        if (!kept.has(`${stemOf(version.value)}${LISTED}`))
          this.#listed(version.value).catch(() => undefined);
      return checked;
    });
  }

  /** What the tables say of each code: its name and status, from the first held series of each kind in the order of preference that holds it. */
  async about(codes: readonly string[]): Promise<Map<string, About>> {
    const references = await this.references();
    const found = new Map<string, { -readonly [K in keyof About]: About[K] }>();
    const fill = async <K extends keyof About>(
      kind: string,
      key: K,
      read: (rows: Row[], origin: string) => About[K],
    ): Promise<void> => {
      for (const series of this.#preferred(references, kind)) {
        const left = codes.filter(
          (code) => found.get(code)?.[key] === undefined,
        );
        if (left.length === 0) return;
        const origin = references.fallback(series);
        const text = await this.#text(origin);
        for (const code of left) {
          const value = read(rowsAbout(text, code), origin);
          if (value === undefined) continue;
          const entry = found.get(code) ?? {};
          entry[key] = value;
          found.set(code, entry);
        }
      }
    };
    await fill(`${REC}CodeNames`, "name", (rows, origin) => {
      const [label] = values(rows, `${SKOS}prefLabel`);
      return label === undefined
        ? undefined
        : { label, altLabels: values(rows, `${SKOS}altLabel`), origin };
    });
    await fill(`${REC}CodeStatus`, "status", (rows, origin) => {
      const [deprecated] = values(rows, `${OWL}deprecated`);
      return deprecated === undefined
        ? undefined
        : {
            deprecated: deprecated === "true",
            replacedBy: values(rows, `${DCT}isReplacedBy`),
            origin,
          };
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

  /** The tables a pod is given now. */
  async references(): Promise<References> {
    await this.#start();
    const { files, vocabulary, newStore } = this.#options;
    return References.of(new TablesFiles(files, vocabulary), "", newStore);
  }

  /** The version of each held series a pod opened now is given. */
  async current(): Promise<readonly string[]> {
    return (await this.#held()).current;
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
    const [index, held] = await Promise.all([this.#index(), this.#held()]);
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

  /** What every held series says of the code, or each of `among`, from its current version. */
  async facts(code: string, among?: readonly string[]): Promise<Facts> {
    const [references, index, { uriSpaces }] = await Promise.all([
      this.references(),
      this.#index(),
      tableTerms(this.#options.vocabulary, this.#options.newStore),
    ]);
    const current = (series: string): string | undefined =>
      among !== undefined && !among.includes(series)
        ? undefined
        : index.objects(iri(series), SHIPS_WITH)[0]?.value;
    const held = (kind: string): Fact[] =>
      this.#preferred(references, kind).flatMap((series) => {
        const version = current(series);
        return version === undefined ? [] : [{ series, version }];
      });
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
        index
          .subjects(SHIPS_WITH)
          .map(({ value }) => value)
          .filter(
            (series) =>
              references.kindOf(series) !== `${REC}CodeNames` &&
              references.kindOf(series) !== `${REC}CodeStatus`,
          )
          .flatMap((series) => {
            const version = current(series);
            return version === undefined ? [] : [mapped({ series, version })];
          }),
      ).then((each) => each.flat()),
    ]);
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
    const about = await this.about([
      code,
      ...status.flatMap(({ replacedBy }) => replacedBy),
      ...mappings.flatMap(({ mapsTo, mappedFrom }) => [
        ...mapsTo.flatMap((target) => [target.code, ...target.alongside.codes]),
        ...mappedFrom.codes,
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
    return {
      ...coded(code),
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
    };
  }

  /** The current version of each series given that the app holds. */
  async #versionsOf(series: string | readonly string[]): Promise<string[]> {
    const index = await this.#index();
    return (typeof series === "string" ? [series] : series).flatMap(
      (each) => index.objects(iri(each), SHIPS_WITH)[0]?.value ?? [],
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

  /** A held version's N-Triples, read once: a version's rows never change. */
  #text(version: string): Promise<string> {
    return once(this.#texts, version, async () =>
      new TextDecoder().decode(await this.#rows(version)),
    );
  }

  /** A held version's N-Triples as they are kept. */
  async #rows(version: string): Promise<Uint8Array<ArrayBuffer>> {
    const bytes = await new TablesFiles(
      this.#options.files,
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
      const { files } = this.#options;
      const path = `${stemOf(version)}${LISTED}`;
      const [bytes, { uriSpaces }] = await Promise.all([
        files.read(path),
        tableTerms(this.#options.vocabulary, this.#options.newStore),
      ]);
      try {
        const kept = JSON.parse(
          new TextDecoder().decode(bytes),
        ) as Partial<Listed> | null;
        if (
          kept?.format === LISTING_FORMAT &&
          JSON.stringify(kept.uriSpaces) === JSON.stringify(uriSpaces) &&
          Array.isArray(kept.codes) &&
          typeof kept.mapsTo === "object" &&
          kept.mapsTo !== null &&
          typeof kept.names === "object" &&
          kept.names !== null &&
          Object.values(kept.names).every((names) => typeof names === "string")
        )
          return kept as Listed;
      } catch {
        // listed again below
      }
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
      this.#preferred(references, `${REC}CodeNames`).map(
        async (series) =>
          (await this.#listed(references.fallback(series))).names,
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
   * An empty store starts from the starter copies, and again whenever it is emptied, as removing an app's pods does.
   * A version's rows come as published and are written as its N-Triples, with no engine, so a first visit draws
   * before one loads; what is held is written last, so a start cut short starts again.
   */
  #start(): Promise<void> {
    this.#started ??= (async () => {
      const { files, starter } = this.#options;
      if (starter === undefined || (await files.read(HELD)) !== undefined)
        return;
      const paths = await starter.list("");
      for (const path of [
        ...paths.filter((path) => path !== HELD),
        ...paths.filter((path) => path === HELD),
      ]) {
        const bytes = await starter.read(path);
        if (bytes === undefined) continue;
        if (path.endsWith(PUBLISHED_ROWS))
          await files.write(
            `${path.slice(0, -PUBLISHED_ROWS.length)}.ttl`,
            await (this.#options.work ?? IN_THIS_THREAD).published(
              new Uint8Array(bytes),
            ),
          );
        else await files.write(path, bytes);
      }
    })().finally(() => {
      this.#started = undefined;
    });
    return this.#started;
  }

  async #held(): Promise<Held> {
    await this.#start();
    const bytes = await this.#options.files.read(HELD);
    if (bytes === undefined) return NOTHING_HELD;
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

  #write(held: Held): Promise<void> {
    return this.#options.files.write(
      HELD,
      new TextEncoder().encode(`${JSON.stringify(held, null, 2)}\n`),
    );
  }

  async #index(): Promise<Graph> {
    const bytes = await this.#options.files.read(INDEX);
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
      await this.#options.files.write(`${stem}.ttl`, rows.text);
      if (rows.codes !== undefined)
        await this.#options.files.write(stem + CODES, rows.codes);
      await this.#options.files.write(stem + LISTED, rows.listed);
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
      await this.#options.files.write(INDEX, ntriples(index.triples));
      if (held !== undefined) {
        this.#texts.delete(held.value);
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
      current: index
        .match(undefined, `${REC}shipsWith`)
        .map(([, , version]) => version.value)
        .sort(),
    });
    return { feed, kept, ...(later === undefined ? {} : { later }), refused };
  }
}

/**
 * The starter copies: the store a check of the feeds keeps now, each version's rows in it as the feed published them
 * (`PUBLISHED_ROWS`) in place of its N-Triples, so they are carried at their published size.
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
    if (path.endsWith(LISTED)) continue;
    const rows = published.get(path);
    if (rows !== undefined)
      await write(`${path.slice(0, -".ttl".length)}${PUBLISHED_ROWS}`, rows);
    else await write(path, (await store.read(path))!);
  }
  return checked;
}
