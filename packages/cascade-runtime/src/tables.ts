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
const SPECIALIZATION_OF = `${PROV}specializationOf`;
const REVISION_OF = `${PROV}wasRevisionOf`;
const THIS_VERSION = "urn:cascade:this-version";
/** The vocabulary's rule list, which reaches an app with the package. */
export const RULE_LIST = "runtime/rule-list/";
const INDEX = "references.ttl";
/** What the store holds that is not RDF: each feed's last check, the current versions, and each pod's. */
export const HELD = "tables.json";

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

interface Held {
  /** Each feed's last check, by its URL. */
  readonly feeds: Record<string, { checked: string; modified?: string }>;
  /** The version of each held series a pod opened now is given, sorted. */
  readonly current: readonly string[];
  /** The versions each pod was last opened with, the rule list's among them, by the pod's naming base. */
  readonly pods: Record<string, readonly string[]>;
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

  constructor(options: TablesOptions) {
    this.#options = options;
  }

  /** Reads each feed and keeps each current version it does not hold that verifies. */
  check(init: RequestInit = {}): Promise<Checked[]> {
    return this.#next(async () => {
      const checked: Checked[] = [];
      for (const feed of this.#options.feeds)
        checked.push(await this.#checkFeed(feed, init));
      return checked;
    });
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

  /** Records that the pod was opened with the versions. */
  opened(pod: string, versions: readonly string[]): Promise<void> {
    return this.#next(async () => {
      const held = await this.#held();
      await this.#write({ ...held, pods: { ...held.pods, [pod]: versions } });
    });
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

  /** An empty store starts from the starter copies. */
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
    })();
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
    const held = await this.#held();
    const modified = catalog.objects(iri(feed), `${DCT}modified`)[0]?.value;
    await this.#write({
      ...held,
      feeds: {
        ...held.feeds,
        [feed]: {
          checked: new Date().toISOString(),
          ...(modified === undefined ? {} : { modified }),
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
