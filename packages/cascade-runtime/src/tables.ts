import {
  CODES,
  contentName,
  type Files,
  fileStem,
  Graph,
  iri,
  ntriples,
  RDF,
  References,
  relative,
  type StoreFactory,
  rowsByCode,
  tableTerms,
  type Term,
  type Triple,
} from "@cascade-runtime/runtime";

const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const DCAT = "http://www.w3.org/ns/dcat#";
const DCT = "http://purl.org/dc/terms/";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const SPDX = "http://spdx.org/rdf/terms#";
const SKOS = "http://www.w3.org/2004/02/skos/core#";
const OWL = "http://www.w3.org/2002/07/owl#";
const SHIPS_WITH = `${REC}shipsWith`;
/** Beside a feed, when its watcher last checked each source. */
const WATCHED = "checked.json";
const SEARCHED_AT_MOST = 50;
const SPECIALIZATION_OF = `${PROV}specializationOf`;
const REVISION_OF = `${PROV}wasRevisionOf`;
const THIS_VERSION = "urn:cascade:this-version";
/** The vocabulary's rule list, which reaches an app with the package. */
export const RULE_LIST = "runtime/rule-list/";
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
  readonly pods: Record<string, readonly string[] | null>;
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

export interface Searched {
  /** The version searched; none when the series is not held. */
  readonly version?: string;
  /** How many codes matched, of which `found` holds the first. */
  readonly total: number;
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
export function versionName(
  series: string,
  previous: string | undefined,
  rows: readonly Triple[],
): Promise<string> {
  return contentName([
    [iri(THIS_VERSION), iri(SPECIALIZATION_OF), iri(series)],
    ...(previous === undefined
      ? []
      : [[iri(THIS_VERSION), iri(REVISION_OF), iri(previous)] as const]),
    ...rows,
  ]);
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

class Unverified extends Error {}

async function gunzipped(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  try {
    return await new Response(stream).text();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new Unverified(`its rows are not gzip: ${error.message}`);
  }
}

/** The N-Quads' triples, each of which must be in the graph named by the version. */
async function rowsOf(
  nquads: string,
  version: string,
  newStore: StoreFactory,
): Promise<Triple[]> {
  const lines: string[] = [];
  for (const line of nquads.split("\n")) {
    if (line.trim() === "") continue;
    const quad = /^(.*)\s<([^<>"\s]*)>\s*\.\s*$/.exec(line);
    if (quad?.[2] !== version)
      throw new Unverified(`a row is outside the graph named ${version}`);
    lines.push(`${quad[1]} .`);
  }
  try {
    return await newStore().parse(lines.join("\n"), version);
  } catch (error) {
    throw new Unverified(
      `its rows are not N-Quads: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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
  readonly #rows = new Map<string, Promise<Triple[]>>();

  constructor(options: TablesOptions) {
    this.#options = options;
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

  /** What the tables say of each code: its name and status, from the first held series of each kind in the order of preference that holds it. */
  async about(codes: readonly string[]): Promise<Map<string, About>> {
    const references = await this.references();
    const terms = await tableTerms(
      this.#options.vocabulary,
      this.#options.newStore,
    );
    const found = new Map<string, { -readonly [K in keyof About]: About[K] }>();
    const fill = async <K extends keyof About>(
      kind: string,
      key: K,
      read: (rows: Graph, code: Term, origin: string) => About[K],
    ): Promise<void> => {
      for (const series of this.#preferred(references, kind)) {
        const left = codes.filter(
          (code) => found.get(code)?.[key] === undefined,
        );
        if (left.length === 0) return;
        const origin = references.fallback(series);
        const rows = new Graph(
          await references.rows(origin, { codes: new Set(left), terms }),
        );
        for (const code of left) {
          const value = read(rows, iri(code), origin);
          if (value === undefined) continue;
          const entry = found.get(code) ?? {};
          entry[key] = value;
          found.set(code, entry);
        }
      }
    };
    const values = (rows: Graph, code: Term, predicate: string) =>
      rows.objects(code, predicate).map(({ value }) => value);
    await fill(`${REC}CodeNames`, "name", (rows, code, origin) => {
      const [label] = values(rows, code, `${SKOS}prefLabel`);
      return label === undefined
        ? undefined
        : { label, altLabels: values(rows, code, `${SKOS}altLabel`), origin };
    });
    await fill(`${REC}CodeStatus`, "status", (rows, code, origin) => {
      const [deprecated] = values(rows, code, `${OWL}deprecated`);
      return deprecated === undefined
        ? undefined
        : {
            deprecated: deprecated === "true",
            replacedBy: values(rows, code, `${DCT}isReplacedBy`),
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

  /** The versions the pod was last opened with; none if it never was, and null if it is to be taken as it is. */
  async openedWith(pod: string): Promise<readonly string[] | null | undefined> {
    return (await this.#held()).pods[pod];
  }

  /**
   * Records that the pod was opened with the versions, or, with null, that its next open takes it as it is; and,
   * given, the name the app opened it by.
   */
  opened(
    pod: string,
    versions: readonly string[] | null,
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
      };
    });
  }

  /** The pods last opened with each version, by the names the app opened them by, sorted. */
  async uses(): Promise<Record<string, string[]>> {
    const { pods, names = {} } = await this.#held();
    const using: Record<string, string[]> = {};
    for (const [pod, versions] of Object.entries(pods)) {
      const name = names[pod];
      if (name === undefined || versions === null) continue;
      for (const version of versions) (using[version] ??= []).push(name);
    }
    for (const named of Object.values(using)) named.sort();
    return using;
  }

  /**
   * The codes in the series' current version that are `text`, as written or as an IRI, or whose name holds it,
   * ignoring case; every code for no text. At most `limit`, in the order of their codes, each with what names and
   * status say of it and, in a mapping series, the codes it maps to.
   */
  async search(
    series: string,
    text: string,
    limit = SEARCHED_AT_MOST,
  ): Promise<Searched> {
    const version = (await this.#index()).objects(iri(series), SHIPS_WITH)[0]
      ?.value;
    if (version === undefined) return { total: 0, found: [] };
    const [rows, { uriSpaces }] = await Promise.all([
      this.#rowsOf(version),
      tableTerms(this.#options.vocabulary, this.#options.newStore),
    ]);
    const notation = (code: string): string =>
      code.slice(uriSpaces.find((space) => code.startsWith(space))?.length);
    const codes = new Set<string>();
    for (const [subject] of rows)
      if (uriSpaces.some((space) => subject.value.startsWith(space)))
        codes.add(subject.value);
    const mapped = new Map<string, Set<string>>();
    const targets = new Set<string>();
    const axioms = new Graph(rows);
    for (const [axiom, , source] of axioms.match(
      undefined,
      `${OWL}annotatedSource`,
    )) {
      codes.add(source.value);
      for (const target of axioms.objects(axiom, `${OWL}annotatedTarget`)) {
        targets.add(target.value);
        mapped.set(
          source.value,
          (mapped.get(source.value) ?? new Set()).add(target.value),
        );
      }
    }
    const about = await this.about([...codes, ...targets]);
    const wanted = text.trim().toLowerCase();
    const named = (code: string): string[] => {
      const name = about.get(code)?.name;
      return name === undefined ? [] : [name.label, ...name.altLabels];
    };
    const matched = [...codes]
      .filter(
        (code) =>
          wanted === "" ||
          code.toLowerCase() === wanted ||
          notation(code).toLowerCase() === wanted ||
          named(code).some((label) => label.toLowerCase().includes(wanted)),
      )
      .sort((a, b) =>
        notation(a).localeCompare(notation(b), "en", { numeric: true }),
      );
    return {
      version,
      total: matched.length,
      found: matched.slice(0, limit).map((code) => ({
        code,
        notation: notation(code),
        about: about.get(code),
        mapsTo: [...(mapped.get(code) ?? [])].sort().map((target) => ({
          code: target,
          notation: notation(target),
          about: about.get(target),
        })),
      })),
    };
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

  /** A held version's rows, read once: a version's rows never change. */
  #rowsOf(version: string): Promise<Triple[]> {
    let rows = this.#rows.get(version);
    if (rows === undefined) {
      rows = this.references().then((references) => references.rows(version));
      rows.catch(() => this.#rows.delete(version));
      this.#rows.set(version, rows);
    }
    return rows;
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

  /** An empty store starts from the starter copies, and again whenever it is emptied, as removing an app's pods does. */
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
        if (bytes !== undefined) await files.write(path, bytes);
      }
    })().finally(() => {
      this.#started = undefined;
    });
    return this.#started;
  }

  async #held(): Promise<Held> {
    await this.#start();
    const bytes = await this.#options.files.read(HELD);
    return bytes === undefined
      ? NOTHING_HELD
      : (JSON.parse(new TextDecoder().decode(bytes)) as Held);
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
      if (
        version?.termType !== "NamedNode" ||
        index.match(version, SPECIALIZATION_OF).length > 0
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
      const previous = catalog.objects(version, REVISION_OF)[0]?.value;
      let rows: Triple[];
      try {
        if ((await sha256(bytes)) !== checksum.value)
          throw new Unverified(
            `its rows do not have the checksum the feed gives`,
          );
        rows = await rowsOf(
          await gunzipped(bytes),
          version.value,
          this.#options.newStore,
        );
        if ((await versionName(series.value, previous, rows)) !== version.value)
          throw new Unverified("its rows and line do not give its name");
      } catch (error) {
        if (!(error instanceof Unverified)) throw error;
        refused.push({ version: version.value, reason: error.message });
        continue;
      }
      const kind = catalog.objects(series, `${REC}tableKind`)[0]?.value ?? "";
      const codes = rowsByCode(
        rows,
        (
          await tableTerms(this.#options.vocabulary, this.#options.newStore)
        ).foundBy.get(kind) ?? [],
      );
      const stem = fileStem(version.value);
      await this.#options.files.write(`${stem}.ttl`, ntriples(rows));
      if (codes !== undefined)
        await this.#options.files.write(stem + CODES, codes);
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
