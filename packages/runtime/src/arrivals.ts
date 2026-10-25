import type { Reported } from "@cascade-runtime/fhir-pull";
import {
  type AdaptersOf,
  type BridgeDocument,
  isBridgeError,
  type LoadedAdapter,
} from "./bridge.js";
import { Graph, parseGraph } from "./graph.js";
import type { ExportDocument } from "./importer.js";
import { LAYOUT_GRAPH, type Layout, type Placement } from "./layout.js";
import {
  canonical,
  contentName,
  documentName,
  enteredRecordName,
  findingName,
  inUtc,
  normalisedBaseUrl,
  serverName,
  THIS_REVISION,
  THIS_VERSION,
} from "./names.js";
import type { StepWrites } from "./pod.js";
import {
  iri,
  literal,
  type NamedNode,
  ntriples,
  RDF,
  type Term,
  type Triple,
  written,
  XSD,
} from "./rdf.js";
import {
  type OnProgress,
  parseStepFile,
  CASCADE,
  Refusal,
  type StepContext,
  type StepFile,
} from "./step.js";
import type { Shapes } from "./shapes.js";
import { podFiles } from "./dataset.js";
import { DERIVED, derivationsOf, QUERIES } from "./derive.js";
import { type Dataset, type StoreFactory, Union } from "./store.js";

const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const TYPE = `${RDF}type`;
const SPECIALIZATION_OF = `${PROV}specializationOf`;
const ARRIVED_AS = `${BRIDGE}arrivedAs`;
const GENERATED_BY = `${PROV}wasGeneratedBy`;
const STARTED = `${PROV}startedAtTime`;
const USED = `${PROV}used`;
const DATE_TIME = `${XSD}dateTime`;
const HAS_SELECTOR = "http://www.w3.org/ns/oa#hasSelector";
const DRAFT = /^urn:cascade:output-(\d+)$/;
const OBSERVED_AS_OF = `${CASCADE}observedAsOf`;
const DERIVED_FROM = `${PROV}wasDerivedFrom`;
const CURRENT_REVISIONS = `${QUERIES}derivations/current-revisions.rq`;
const LADDER_LENS = "everyday";
const SERVER = `${CASCADE}Server`;
const SERVER_BASE_URL = `${CASCADE}serverBaseUrl`;
const OA = "http://www.w3.org/ns/oa#";
const FINDING = `${CASCADE}FindingForReview`;
const OLDER_STATES = `${CASCADE}SourceReportedOlderStates`;
const CONTRADICTED = `${CASCADE}contradictedEarlierRevision`;
const CLOCK_BEHIND = `${CASCADE}ClockBehind`;
const DAYS_BEHIND = `${CASCADE}writerClockBehindByAtLeastDays`;
const THIS_FINDING = "urn:cascade:this-finding";
const DAY = 86_400_000;

/** One arrival of a record, as a revision would carry it (runtime/rules.md, N4). */
interface Arrival {
  readonly record: NamedNode;
  readonly place: Placement;
  readonly recordTriples: readonly Triple[];
  readonly version: NamedNode;
  readonly versionTriples: readonly Triple[];
  /**
   * Every statement on the arrival but `bridge:arrivedAs` and `prov:wasGeneratedBy`, made about
   * `urn:cascade:this-revision`, with its selector's node as `urn:cascade:this-revision#selector`.
   */
  readonly statements: readonly Triple[];
  /** The start of the import or the session, as an `xsd:dateTime`. */
  readonly at: string;
  /** When the source was observed saying the arrival's state (`cascade:observedAsOf`). */
  readonly observedAsOf: Term;
  /** The import or the session. */
  readonly by: string;
  /**
   * Whether its observation time is the writer's own clock: an entry's or a connect's, an act's start, or the retrieval
   * time of a live pull that names no transmitter.
   */
  readonly writersClock: boolean;
  /**
   * Of an arrival from a live pull (a document retrieved on a date that answers as of no other instant), the source it
   * is one with another pull of: its transmitter's IRI, or "" when it names none. Undefined for any other arrival, and
   * for a transmitter no IRI names, which is one with no other pull.
   */
  readonly pullSource?: string;
  /** Of a live pull that names no transmitter, the writer's own, when it was retrieved. */
  readonly retrievedByWriter?: string;
}

/** What a document says of how it was reached. */
interface Reached {
  readonly retrieved?: string;
  readonly answered: boolean;
  /** Its transmitter's IRI, "" when it names none, undefined when no one IRI names its transmitter. */
  readonly transmitter: string | undefined;
}

function reachedIn(graph: Graph, document: Term): Reached {
  const transmitters = graph
    .objects(document, `${PROV}qualifiedAttribution`)
    .filter(
      (via) =>
        graph.match(via, `${PROV}hadRole`, iri(`${CASCADE}TransmitterRole`))
          .length > 0,
    )
    .flatMap((via) => graph.objects(via, `${PROV}agent`));
  const [transmitter] = transmitters;
  return {
    ...(graph.objects(document, `${PAV}retrievedOn`).map(({ value }) => ({
      retrieved: value,
    }))[0] ?? {}),
    answered: graph.objects(document, `${CASCADE}answeredAsOf`).length > 0,
    transmitter:
      transmitter === undefined
        ? ""
        : transmitter.termType === "NamedNode" && transmitters.length === 1
          ? transmitter.value
          : undefined,
  };
}

/** The source a live pull is one with another of, as `Arrival.pullSource` gives it. */
function pullSourceOf(reached: Reached): string | undefined {
  return reached.retrieved !== undefined && !reached.answered
    ? reached.transmitter
    : undefined;
}

/** The whole days by which `earlier` precedes `later`, two xsd:dateTime values. */
function daysBefore(earlier: string, later: string): number {
  return Math.floor((Date.parse(later) - Date.parse(earlier)) / DAY);
}

/** One revision as the pod held it before the step. */
interface Held {
  readonly revision: string;
  readonly changed?: string;
}

/** A record an import found its source reporting at an older state: the revision holding it, and those it contradicts. */
interface WentBack {
  readonly older: string;
  readonly contradicted: readonly string[];
}

/** What the arrival states of itself by the property, as its revision will. */
function statedOnRevision(
  arrival: Arrival,
  property: string,
): string | undefined {
  return arrival.statements.find(
    ([s, p]) => s.value === THIS_REVISION && p.value === property,
  )?.[2].value;
}

function key(triple: Triple): string {
  return triple.map(written).join(" ");
}

function renamed(
  triples: Iterable<Triple>,
  from: Term,
  to: NamedNode,
): Triple[] {
  const swap = <T extends Term>(term: T): T | NamedNode =>
    term.termType === from.termType && term.value === from.value ? to : term;
  return [...triples].map(
    ([s, p, o]) => [swap(s), p, swap(o)] as unknown as Triple,
  );
}

/** The triples with the placeholder, and every node inside it (`<placeholder>#…`), under the name. */
function renamedWithin(
  triples: Iterable<Triple>,
  placeholder: string,
  name: string,
): Triple[] {
  const swap = <T extends Term>(term: T): T | NamedNode =>
    term.termType === "NamedNode" &&
    (term.value === placeholder || term.value.startsWith(`${placeholder}#`))
      ? iri(name + term.value.slice(placeholder.length))
      : term;
  return [...triples].map(
    ([s, p, o]) => [swap(s), p, swap(o)] as unknown as Triple,
  );
}

/** The arrival's selectors: each node, blank or named, that `oa:hasSelector` gives it. */
function selectorsOf(graph: Graph, arrival: Term): Term[] {
  return graph
    .objects(arrival, HAS_SELECTOR)
    .filter(({ termType }) => termType !== "Literal");
}

/** The arrival's statements as a revision carries them: its selector's node, with its statements, named inside the revision. */
function revisionStatements(graph: Graph, arrival: Term): Triple[] {
  const placeholder = iri(THIS_REVISION);
  const selector = iri(`${THIS_REVISION}#selector`);
  return graph
    .match(arrival)
    .filter(([, p]) => p.value !== ARRIVED_AS && p.value !== GENERATED_BY)
    .flatMap(([, p, o]): Triple[] =>
      p.value === HAS_SELECTOR && o.termType !== "Literal"
        ? [
            [placeholder, p, selector],
            ...renamed(graph.closure(o), o, selector),
          ]
        : [[placeholder, p, o]],
    );
}

/** The arrival's statements as the named revision carries them, its selector's node `<revision>#selector` (N4). */
export function arrivalInRevision(
  graph: Graph,
  arrival: Term,
  revision: string,
): Triple[] {
  return renamedWithin(
    revisionStatements(graph, arrival),
    THIS_REVISION,
    revision,
  );
}

/** The arrival's selectors' nodes and every blank node inside them: a revision carries a selector as `<revision>#selector`, the blank nodes under it as they are. */
export function selectorNodes(graph: Graph, arrival: Term): Set<string> {
  return new Set(
    selectorsOf(graph, arrival).flatMap((selector) => [
      written(selector),
      ...graph
        .closure(selector)
        .flatMap(([, , o]) => (o.termType === "BlankNode" ? [written(o)] : [])),
    ]),
  );
}

/** The name of a version's or a revision's content (N3, N4); content that cannot be named is refused. */
async function named(
  triples: readonly Triple[],
  where: string,
): Promise<NamedNode> {
  try {
    return iri(await contentName(triples));
  } catch (error) {
    throw new Refusal(
      `${where}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Where the layout files a record of the node's type; a type it files nowhere is refused (A14). */
function recordPlace(
  layout: Layout,
  graph: Graph,
  record: Term,
  where: string,
): { place: Placement; kind: NamedNode } {
  const filed = graph
    .objects(record, TYPE)
    .filter(
      (kind): kind is NamedNode =>
        kind.termType === "NamedNode" &&
        layout.records(kind.value) !== undefined,
    );
  const places = new Set(filed.map((kind) => layout.records(kind.value)));
  const [kind] = filed;
  const [place] = places;
  if (kind === undefined || place === undefined)
    throw new Refusal(
      `${where}: ${record.value} is of no type the pod files: ${graph
        .objects(record, TYPE)
        .map((type) => type.value)
        .join(", ")}`,
    );
  if (places.size > 1)
    throw new Refusal(
      `${where}: ${record.value} is of types the pod files apart`,
    );
  return { place, kind };
}

/** Frees what the union's store holds in Oxigraph's memory now, rather than when it is collected. */
function freed(union: Union): void {
  (union.store as { free?: () => void }).free?.();
}

/** What an arrival is told apart by: its version, its source version and its source change time. */
function held(version: string, source?: string, changed?: string): string {
  return [version, source ?? "", changed ?? ""].join("\u0000");
}

/** Each record's revisions as the pod holds them, and the revisions a step adds after them. */
export class Revisions {
  /** Each record's heads: its revisions that none revises, one unless two writers revised it apart. */
  readonly #heads = new Map<
    string,
    readonly {
      readonly revision: string;
      readonly version: string;
      readonly observed?: string;
    }[]
  >();
  /** Each record's revisions as the pod held them before the step. */
  readonly #before = new Map<string, Held[]>();
  /** The revision holding what each record's arrivals are told apart by, as `held` keys it. */
  readonly #holding = new Map<string, Map<string, string>>();
  /** What each document the pod holds says of how it was reached, read once a step needs it. */
  readonly #reached = new Map<string, Reached>();
  /** The document each revision the pod held before the step was derived from. */
  readonly #documents = new Map<string, string>();
  /** Each revision the step wrote whose observation times show the writer's clock behind, and by how many whole days. */
  readonly clockBehind: { readonly revision: string; readonly days: number }[] =
    [];
  /** Each record's versions, and what its revisions are told apart by. */
  readonly #versions = new Map<string, Set<string>>();
  readonly #held = new Map<string, Set<string>>();
  /** The pod's files holding each record and its revisions. */
  readonly #recordFiles = new Map<string, Set<string>>();
  readonly #files: [string, Uint8Array][] = [];
  /** The files the step holds for each record it revised, until `write`: the record's and its new revisions'. */
  readonly #pending = new Map<string, [string, Uint8Array][]>();
  /** Each record's current version as the ladder picks it, read when an arrival needs it; dropped once the record is revised. */
  readonly #current = new Map<string, string | undefined>();
  /** The judgments, acts and documents every reading of the ladder reads, loaded once a step needs them. */
  #shared: Promise<Union> | undefined;

  private constructor(
    readonly layout: Layout,
    readonly context: Pick<
      StepContext,
      "pod" | "newStore" | "layout" | "vocabulary" | "address" | "lastSnapshot"
    >,
  ) {}

  /**
   * Read from the records' files in the dataset the pod keeps, which names each file by the pod's address plus its
   * path; else from the records' files loaded into a store of their own.
   */
  static async of(
    context: Pick<
      StepContext,
      | "pod"
      | "newStore"
      | "layout"
      | "vocabulary"
      | "address"
      | "lastSnapshot"
      | "keptDataset"
    >,
  ): Promise<Revisions> {
    const { pod, layout } = context;
    const folders = layout.recordPlacements.map(({ folder }) => folder ?? "");
    const kept = await context.keptDataset();
    let dataset: Dataset;
    let base: string;
    let inRecords = "";
    if (kept === undefined) {
      const union = new Union(context.newStore());
      const listed = await Promise.all(
        folders.map((folder) => pod.list(folder)),
      );
      await podFiles(pod, layout, pod.iri, union, listed.flat());
      dataset = union;
      base = pod.iri;
    } else {
      dataset = kept;
      base = context.address;
      const under = folders.map(
        (folder) =>
          `STRSTARTS(STR(?file), "${base}${folder === "" || folder.endsWith("/") ? folder : `${folder}/`}")`,
      );
      const outside = [
        ...layout.rebuilt.map((path) => base + path),
        LAYOUT_GRAPH,
      ]
        .map((graph) => `<${graph}>`)
        .join(", ");
      inRecords = `FILTER ((${under.join(" || ")}) && ?file NOT IN (${outside}))`;
    }
    const [{ rows }, { rows: files }] = await Promise.all([
      dataset.select(`
        PREFIX cascade: <${CASCADE}>
        PREFIX prov: <${PROV}>
        PREFIX pav: <${PAV}>
        SELECT DISTINCT ?revision ?record ?version ?previous ?sourceVersion ?changed ?observed ?document WHERE {
          GRAPH ?file {
            ?revision a cascade:Revision ; cascade:revisionOf ?record ; cascade:version ?version .
            OPTIONAL { ?revision prov:wasRevisionOf ?previous }
            OPTIONAL { ?revision pav:version ?sourceVersion }
            OPTIONAL { ?revision pav:lastUpdateOn ?changed }
            OPTIONAL { ?revision cascade:observedAsOf ?observed }
            OPTIONAL { ?revision prov:wasDerivedFrom ?document }
          }
          ${inRecords}
        }`),
      dataset.select(`
        PREFIX cascade: <${CASCADE}>
        SELECT DISTINCT ?record ?file WHERE {
          ?revision cascade:revisionOf ?record .
          { GRAPH ?file { ?revision cascade:revisionOf ?record } } UNION { GRAPH ?file { ?record a ?kind } }
          ${inRecords}
        }`),
    ]);
    if (kept === undefined) freed(dataset as Union);
    const revisions = new Revisions(layout, context);
    for (const row of files) {
      const [record, file] = ["record", "file"].map(
        (name) => row.get(name)?.value ?? "",
      ) as [string, string];
      const held = revisions.#recordFiles.get(record) ?? new Set();
      held.add(file.slice(base.length));
      revisions.#recordFiles.set(record, held);
    }
    const revised = new Set(rows.map((row) => row.get("previous")?.value));
    for (const row of rows) {
      const [record, revision, version] = ["record", "revision", "version"].map(
        (name) => row.get(name)?.value ?? "",
      ) as [string, string, string];
      const changed = row.get("changed")?.value;
      const observed = row.get("observed")?.value;
      const document = row.get("document")?.value;
      if (document !== undefined) revisions.#documents.set(revision, document);
      revisions.#add(
        record,
        version,
        row.get("sourceVersion")?.value,
        changed,
        revision,
      );
      const before = revisions.#before.get(record) ?? [];
      if (!before.some((one) => one.revision === revision))
        revisions.#before.set(record, [
          ...before,
          { revision, ...(changed === undefined ? {} : { changed }) },
        ]);
      if (revised.has(revision)) continue;
      const heads = revisions.#heads.get(record) ?? [];
      if (!heads.some((head) => head.revision === revision))
        revisions.#heads.set(record, [
          ...heads,
          {
            revision,
            version,
            ...(observed === undefined ? {} : { observed }),
          },
        ]);
    }
    return revisions;
  }

  /** The record's heads and the files that hold its revisions and its type, as read before the step. */
  held(record: string): {
    readonly heads: readonly string[];
    readonly files: readonly string[];
  } {
    return {
      heads: (this.#heads.get(record) ?? [])
        .map(({ revision }) => revision)
        .sort(),
      files: [...(this.#recordFiles.get(record) ?? [])].sort(),
    };
  }

  #add(
    record: string,
    version: string,
    source: string | undefined,
    changed: string | undefined,
    revision: string,
  ) {
    const versions = this.#versions.get(record) ?? new Set();
    versions.add(version);
    this.#versions.set(record, versions);
    const told = this.#held.get(record) ?? new Set();
    told.add(held(version, source, changed));
    this.#held.set(record, told);
    const holding = this.#holding.get(record) ?? new Map<string, string>();
    holding.set(held(version, source, changed), revision);
    this.#holding.set(record, holding);
  }

  /** The revision of the record holding the arrival's version, source version and source change time, if one does. */
  holding(arrival: Arrival): string | undefined {
    return this.#holding
      .get(arrival.record.value)
      ?.get(
        held(
          arrival.version.value,
          statedOnRevision(arrival, `${PAV}version`),
          statedOnRevision(arrival, `${PAV}lastUpdateOn`),
        ),
      );
  }

  /** What the document the pod holds says of how it was reached. */
  async #reachedBy(document: string): Promise<Reached> {
    const known = this.#reached.get(document);
    if (known !== undefined) return known;
    const { context } = this;
    const bytes = await context.pod.read(
      this.layout.place(`${PROV}Entity`).path(document),
    );
    const reached: Reached =
      bytes === undefined
        ? { answered: false, transmitter: undefined }
        : reachedIn(
            await parseGraph(bytes, document, context.newStore),
            iri(document),
          );
    this.#reached.set(document, reached);
    return reached;
  }

  /**
   * The revisions of the arrival's record that the pod held before the step and the arrival contradicts: each from a
   * live pull of the arrival's source whose source change time is later than the arrival's. None for an arrival with no
   * source change time, or that came by another path than a live pull.
   */
  async contradictedBy(arrival: Arrival): Promise<string[]> {
    const changed = statedOnRevision(arrival, `${PAV}lastUpdateOn`);
    if (arrival.pullSource === undefined || changed === undefined) return [];
    const record = arrival.record.value;
    const later = (this.#before.get(record) ?? []).filter(
      (one) =>
        one.changed !== undefined &&
        Date.parse(one.changed) > Date.parse(changed),
    );
    if (later.length === 0) return [];
    const contradicted: string[] = [];
    for (const { revision } of later) {
      const document = this.#documents.get(revision);
      if (
        document !== undefined &&
        pullSourceOf(await this.#reachedBy(document)) === arrival.pullSource
      )
        contradicted.push(revision);
    }
    return contradicted.sort();
  }

  /**
   * The files of the set and the syncs every reading of the ladder reads whatever records it is for: the judgments,
   * the acts, which hold the snapshots, and the documents, which name their transmitters and when they were retrieved.
   */
  #sharedFiles(): Promise<Union> {
    this.#shared ??= (async () => {
      const { context, layout } = this;
      const folders = [
        ...layout.actFolders,
        layout.place(`${CASCADE}Judgment`).folder,
        layout.place(`${PROV}Entity`).folder,
      ].filter((folder): folder is string => folder !== undefined);
      const shared = (await context.pod.list(""))
        .filter(
          (path) => layout.inSnapshotSet(path) || layout.inSyncsFolder(path),
        )
        .filter((path) => folders.some((folder) => path.startsWith(folder)));
      const union = new Union(context.newStore());
      await podFiles(context.pod, layout, context.address, union, shared);
      return union;
    })();
    return this.#shared;
  }

  /**
   * Reads, for each of the records, its current version as the vocabulary's derivations pick it through
   * queries/derivations/current-revisions.rq, which runs before any lens: over the judgments, acts and documents, the
   * pod's files holding the records and their revisions, and the revisions the step holds for them.
   */
  async #readCurrent(records: readonly string[]): Promise<void> {
    if (records.length === 0) return;
    const { context } = this;
    const union = await this.#sharedFiles();
    const graphs: string[] = [];
    const paths = records.flatMap((record) => [
      ...(this.#recordFiles.get(record) ?? []),
    ]);
    await podFiles(context.pod, this.layout, context.address, union, paths);
    graphs.push(...paths.map((path) => context.address + path));
    for (const record of records)
      for (const [path, bytes] of this.#pending.get(record) ?? []) {
        const graph = `${context.address}${path}#held`;
        await union.loadTurtle(bytes, graph);
        graphs.push(graph);
      }
    await (
      await derivationsOf(context.vocabulary)
    ).derive(union, LADDER_LENS, undefined, CURRENT_REVISIONS);
    const { rows } = await union.select(
      `SELECT ?record ?current WHERE {
        VALUES ?record { ${records.map((record) => `<${record}>`).join(" ")} }
        ?record <${PAV}hasCurrentVersion> ?current
      }`,
    );
    for (const graph of [...graphs, DERIVED + LADDER_LENS])
      await union.drop(graph);
    for (const record of records) this.#current.set(record, undefined);
    for (const row of rows)
      this.#current.set(
        row.get("record")?.value ?? "",
        row.get("current")?.value ?? "",
      );
  }

  /**
   * Whether the arrival can write nothing only by being at the record's current version: a revision of the record
   * holds its version but not with its source version and source change time, and it carries a source change time.
   */
  #readsTheLadder(arrival: Arrival): boolean {
    const record = arrival.record.value;
    const version = arrival.version.value;
    const changed = statedOnRevision(arrival, `${PAV}lastUpdateOn`);
    const told = held(
      version,
      statedOnRevision(arrival, `${PAV}version`),
      changed,
    );
    return (
      !(this.#held.get(record)?.has(told) ?? false) &&
      (this.#versions.get(record)?.has(version) ?? false) &&
      changed !== undefined
    );
  }

  /** Reads the ladder once for every record among the arrivals that `repeats` will read it for. */
  async prepare(arrivals: readonly Arrival[]): Promise<void> {
    await this.#readCurrent([
      ...new Set(
        arrivals
          .filter((arrival) => this.#readsTheLadder(arrival))
          .map(({ record }) => record.value)
          .filter((record) => !this.#current.has(record)),
      ),
    ]);
  }

  /**
   * Whether the arrival writes nothing (A3, A4): a revision of the record holds its version, source version and source
   * change time; it carries no source change time and the record holds its version; or it is at the record's current
   * version. A version the record does not hold cannot be its current one, so the ladder is read only for an arrival
   * of a held version under a new stamp.
   */
  async repeats(arrival: Arrival): Promise<boolean> {
    const record = arrival.record.value;
    const version = arrival.version.value;
    if (this.#readsTheLadder(arrival)) {
      if (!this.#current.has(record)) await this.#readCurrent([record]);
      return this.#current.get(record) === version;
    }
    const told = held(
      version,
      statedOnRevision(arrival, `${PAV}version`),
      statedOnRevision(arrival, `${PAV}lastUpdateOn`),
    );
    return (
      (this.#held.get(record)?.has(told) ?? false) ||
      (this.#versions.get(record)?.has(version) ?? false)
    );
  }

  /** Adds the record and its version, and holds the revision after each of the record's heads (A2, A5) until `write`. */
  async revise(arrival: Arrival, writes: StepWrites): Promise<string> {
    const record = arrival.record.value;
    writes.add(arrival.place.path(record), ntriples(arrival.recordTriples));
    writes.add(
      this.layout.version(arrival.place, arrival.version.value),
      ntriples(arrival.versionTriples),
    );
    const placeholder = iri(THIS_REVISION);
    const previous = (this.#heads.get(record) ?? [])
      .map(({ revision }) => revision)
      .sort();
    const triples: Triple[] = [
      ...arrival.statements,
      [placeholder, iri(TYPE), iri(`${CASCADE}Revision`)],
      [placeholder, iri(`${CASCADE}revisionOf`), arrival.record],
      [placeholder, iri(`${CASCADE}version`), arrival.version],
      [
        placeholder,
        iri(`${PROV}generatedAtTime`),
        literal(arrival.at, DATE_TIME),
      ],
      [placeholder, iri(OBSERVED_AS_OF), arrival.observedAsOf],
      [placeholder, iri(GENERATED_BY), iri(arrival.by)],
      ...previous.map((head): Triple => [
        placeholder,
        iri(`${PROV}wasRevisionOf`),
        iri(head),
      ]),
    ];
    const { value: name } = await named(triples, `the revision of ${record}`);
    const revision: [string, Uint8Array] = [
      this.layout.revision(arrival.place, name),
      ntriples(renamedWithin(triples, THIS_REVISION, name)),
    ];
    this.#files.push(revision);
    const pending = this.#pending.get(record) ?? [
      [arrival.place.path(record), ntriples(arrival.recordTriples)],
    ];
    this.#pending.set(record, [...pending, revision]);
    this.#current.delete(record);
    const observed = arrival.observedAsOf.value;
    const changed = statedOnRevision(arrival, `${PAV}lastUpdateOn`);
    const heads = this.#heads.get(record) ?? [];
    const days = Math.max(
      0,
      ...(arrival.writersClock
        ? heads.map(({ observed: head }) =>
            head === undefined ? 0 : daysBefore(observed, head),
          )
        : []),
      ...(arrival.retrievedByWriter !== undefined && changed !== undefined
        ? [daysBefore(arrival.retrievedByWriter, changed)]
        : []),
    );
    if (days >= 1) this.clockBehind.push({ revision: name, days });
    this.#heads.set(record, [
      { revision: name, version: arrival.version.value, observed },
    ]);
    this.#add(
      record,
      arrival.version.value,
      statedOnRevision(arrival, `${PAV}version`),
      changed,
      name,
    );
    return name;
  }

  /** The findings the pod holds of each kind: each one's targets, and its contradicted revisions. */
  async #findingsHeld(): Promise<
    Map<
      string,
      { name: string; targets: Set<string>; contradicted: Set<string> }[]
    >
  > {
    const { context, layout } = this;
    const folder = layout.place(FINDING).folder ?? "";
    const held = new Map<
      string,
      { name: string; targets: Set<string>; contradicted: Set<string> }[]
    >();
    for (const path of await context.pod.list(folder)) {
      const bytes = await context.pod.read(path);
      if (bytes === undefined) continue;
      const graph = await parseGraph(
        bytes,
        context.address + path,
        context.newStore,
      );
      for (const finding of graph.subjects(TYPE, iri(FINDING)))
        for (const { value: kind } of graph.objects(finding, `${OA}hasBody`))
          held.set(kind, [
            ...(held.get(kind) ?? []),
            {
              name: finding.value,
              targets: new Set(
                graph
                  .objects(finding, `${OA}hasTarget`)
                  .map(({ value }) => value),
              ),
              contradicted: new Set(
                graph.objects(finding, CONTRADICTED).map(({ value }) => value),
              ),
            },
          ]);
    }
    return held;
  }

  /**
   * Whether an act in the first-parent ancestry of the writer's last snapshot filed one of the findings, by its path, that
   * no person's judgment answers: neither an Acknowledged of it nor a ClockDiscounted of that act stands.
   */
  async #firstParentsFiledUnanswered(
    findings: ReadonlyMap<string, string>,
  ): Promise<boolean> {
    const head = this.context.lastSnapshot;
    if (head === undefined || findings.size === 0) return false;
    const stands = (answer: string): string => `
          ?${answer} prov:wasAttributedTo/a prov:Person .
          FILTER NOT EXISTS { ?retraction prov:invalidated ?${answer} }
          FILTER NOT EXISTS {
            ?replacing dct:replaces ?${answer}
            FILTER NOT EXISTS { ?undoing prov:invalidated ?replacing }
          }`;
    return (await this.#sharedFiles()).ask(`
      PREFIX cascade: <${CASCADE}>
      PREFIX dct: <http://purl.org/dc/terms/>
      PREFIX prov: <${PROV}>
      ASK {
        VALUES (?path ?finding) { ${[...findings].map(([path, finding]) => `("${path}" <${finding}>)`).join(" ")} }
        <${head}> cascade:firstParentSnapshot* ?snapshot .
        ?snapshot cascade:fileAddedToSet ?path ; prov:wasGeneratedBy ?act .
        FILTER NOT EXISTS {
          ?acknowledgement cascade:verdict cascade:Acknowledged ; prov:hadMember ?finding .${stands("acknowledgement")}
        }
        FILTER NOT EXISTS {
          ?discount cascade:verdict cascade:ClockDiscounted ; prov:hadMember ?act .${stands("discount")}
        }
      }`);
  }

  /** Adds a finding of the kind, its subject named by its triples (cascade:FindingNamingRule). */
  async #file(
    writes: StepWrites,
    content: (subject: NamedNode) => Triple[],
  ): Promise<void> {
    const name = await findingName(content(iri(THIS_FINDING)));
    writes.add(
      this.layout.place(FINDING).path(name),
      ntriples(content(iri(name))),
    );
  }

  /**
   * Adds the step's findings, after the revisions they name (W1): one that its source reported older states, naming every
   * record that went back but those a finding the pod holds already names with each revision it contradicts; and one
   * that the writer's clock was behind, naming every revision the step wrote that shows it, unless an act in the
   * first-parent ancestry of the writer's last snapshot filed one that no person's judgment answers.
   */
  async #fileFindings(
    writes: StepWrites,
    wentBack: readonly WentBack[],
  ): Promise<void> {
    if (wentBack.length === 0 && this.clockBehind.length === 0) return;
    const held = await this.#findingsHeld();
    const fresh = wentBack.filter(
      ({ older, contradicted }) =>
        !(held.get(OLDER_STATES) ?? []).some(
          ({ targets, contradicted: named }) =>
            targets.has(older) && contradicted.every((one) => named.has(one)),
        ),
    );
    const classified = (subject: NamedNode, kind: string): Triple[] => [
      [subject, iri(TYPE), iri(FINDING)],
      [subject, iri(`${OA}hasBody`), iri(kind)],
      [subject, iri(`${OA}motivatedBy`), iri(`${OA}classifying`)],
    ];
    if (fresh.length > 0)
      await this.#file(writes, (subject) => [
        ...classified(subject, OLDER_STATES),
        ...fresh.flatMap(({ older, contradicted }): Triple[] => [
          [subject, iri(`${OA}hasTarget`), iri(older)],
          ...contradicted.map((one): Triple => [
            subject,
            iri(CONTRADICTED),
            iri(one),
          ]),
        ]),
      ]);
    const clocks = new Map(
      (held.get(CLOCK_BEHIND) ?? []).map(({ name }) => [
        this.layout.place(FINDING).path(name),
        name,
      ]),
    );
    if (
      this.clockBehind.length > 0 &&
      !(await this.#firstParentsFiledUnanswered(clocks))
    )
      await this.#file(writes, (subject) => [
        ...classified(subject, CLOCK_BEHIND),
        [
          subject,
          iri(DAYS_BEHIND),
          literal(
            String(Math.max(...this.clockBehind.map(({ days }) => days))),
            `${XSD}integer`,
          ),
        ],
        ...this.clockBehind.map(({ revision }): Triple => [
          subject,
          iri(`${OA}hasTarget`),
          iri(revision),
        ]),
      ]);
  }

  /**
   * Adds the revisions held, after every file before them (W1), then the step's findings, and frees what the ladder was
   * read over.
   */
  async write(
    writes: StepWrites,
    wentBack: readonly WentBack[] = [],
  ): Promise<void> {
    for (const [path, bytes] of this.#files) writes.add(path, bytes);
    await this.#fileFindings(writes, wentBack);
    const shared = this.#shared;
    this.#shared = undefined;
    if (shared !== undefined) freed(await shared);
  }
}

function inVersion(term: Term, version: NamedNode): boolean {
  return (
    term.termType === "NamedNode" &&
    (term.value === version.value || term.value.startsWith(`${version.value}#`))
  );
}

/** Refuses a graph holding a statement about no record, version, arrival, document or import (A14). */
function refuseUnaccounted(graph: Graph, document: NamedNode, where: string) {
  if (graph.match(document, TYPE, iri(`${PROV}Entity`)).length === 0)
    throw new Refusal(`${where}'s graph does not describe its document`);
  const accounted = new Set<string>();
  const add = (triples: Iterable<Triple>): void => {
    for (const triple of triples) accounted.add(key(triple));
  };
  add(graph.closure(document));
  for (const activity of graph.subjects(USED, document))
    add(graph.closure(activity));
  for (const arrival of graph.subjects(ARRIVED_AS)) {
    add(graph.closure(arrival));
    for (const selector of selectorsOf(graph, arrival))
      add(graph.closure(selector));
  }
  for (const version of graph.subjects(SPECIALIZATION_OF)) {
    if (version.termType !== "NamedNode") continue;
    add(graph.triples.filter(([s]) => inVersion(s, version)));
    for (const record of graph.objects(version, SPECIALIZATION_OF))
      add(graph.match(record));
  }
  if (graph.triples.some((triple) => !accounted.has(key(triple))))
    throw new Refusal(
      `${where}'s graph holds a statement about no record, version, arrival, document or import`,
    );
}

/** Each record's arrival in a document's graph, in the order of their versions' names. */
function arrivals(
  layout: Layout,
  graph: Graph,
  by: string,
  where: string,
): Arrival[] {
  return graph
    .subjects(ARRIVED_AS)
    .flatMap((arrival) =>
      graph
        .objects(arrival, ARRIVED_AS)
        .map((version) => ({ arrival, version })),
    )
    .sort((a, b) => (a.version.value < b.version.value ? -1 : 1))
    .map(({ arrival, version }): Arrival => {
      const [record] = graph.objects(version, SPECIALIZATION_OF);
      if (version.termType !== "NamedNode" || record?.termType !== "NamedNode")
        throw new Refusal(
          `${where}: ${version.value} is the version of no record`,
        );
      const [at] = graph
        .objects(arrival, GENERATED_BY)
        .flatMap((activity) => graph.objects(activity, STARTED));
      if (at === undefined)
        throw new Refusal(
          `${where}: an arrival of ${record.value} came from no import that started`,
        );
      const documents = graph.objects(arrival, DERIVED_FROM);
      const answered = documents.flatMap((document) =>
        graph.objects(document, `${CASCADE}answeredAsOf`),
      );
      const retrieved = documents.flatMap((document) =>
        graph.objects(document, `${PAV}retrievedOn`),
      );
      const [observedAsOf = at] = [
        ...answered,
        ...retrieved,
        ...graph.objects(arrival, `${PAV}lastUpdateOn`),
      ];
      const [reached] = documents.map((document) => reachedIn(graph, document));
      const pullSource =
        documents.length === 1 && reached !== undefined
          ? pullSourceOf(reached)
          : undefined;
      const retrievedByWriter =
        pullSource === "" ? reached?.retrieved : undefined;
      return {
        record,
        place: recordPlace(layout, graph, record, where).place,
        recordTriples: graph.match(record),
        version,
        versionTriples: graph.triples.filter(([s]) => inVersion(s, version)),
        statements: revisionStatements(graph, arrival),
        at: at.value,
        observedAsOf,
        by,
        writersClock:
          retrievedByWriter !== undefined ||
          (answered.length === 0 && observedAsOf === at),
        ...(pullSource === undefined ? {} : { pullSource }),
        ...(retrievedByWriter === undefined ? {} : { retrievedByWriter }),
      };
    });
}

/** The import's description the Bridge gave with the document: its label, start and association, as `name`. */
function importDescription(
  graph: Graph,
  document: NamedNode,
  name: string,
  where: string,
): Triple[] {
  const [activity] = graph.subjects(USED, document);
  if (activity === undefined)
    throw new Refusal(
      `${where}'s graph names no import that used its document`,
    );
  return renamed(
    graph.closure(activity).filter(([, p]) => p.value !== USED),
    activity,
    iri(name),
  );
}

async function hasFindings(
  findings: Uint8Array,
  document: string,
  newStore: StoreFactory,
): Promise<boolean> {
  return (
    findings.length > 0 &&
    (await parseGraph(findings, `${document}#findings`, newStore)).triples
      .length > 0
  );
}

/** What the export says of a document; an export the importer cannot read is refused (A14). */
function read(found: ExportDocument, started: string): Uint8Array {
  try {
    return found.facts(started);
  } catch (error) {
    throw new Refusal(
      `${found.path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** The Bridge's answer, a document failure being the document refused (A14). */
async function refusing<T>(path: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (isBridgeError(error) && error.kind === "document")
      throw new Refusal(`${path}: ${error.message}`);
    throw error;
  }
}

/** The first adapter of the document's media type that accepts it; none accepting it refuses the step (A14). */
async function accepting(
  adapters: AdaptersOf,
  found: ExportDocument,
  document: BridgeDocument,
): Promise<LoadedAdapter> {
  for (const adapter of adapters(found.mediaType))
    if (await refusing(found.path, () => adapter.accepts(document)))
      return adapter;
  throw new Refusal(
    `${found.path}: no adapter of ${found.mediaType} accepts it`,
  );
}

/** A server's record, named by its base URL and stating it normalised (A16, A17), or none for a base that cannot be. */
async function serverRecord(
  layout: Layout,
  base: string,
): Promise<
  { record: NamedNode; place: Placement; triples: Triple[] } | undefined
> {
  const place = layout.records(SERVER);
  if (place === undefined)
    throw new Error(`the layout files no ${SERVER} under records/`);
  let record: NamedNode;
  let normalised: string;
  try {
    record = iri(await serverName(base));
    normalised = normalisedBaseUrl(base);
  } catch {
    return undefined;
  }
  return {
    record,
    place,
    triples: [
      [record, iri(TYPE), iri(SERVER)],
      [record, iri(SERVER_BASE_URL), literal(normalised)],
    ],
  };
}

/**
 * Files an export's documents, each converted by the first adapter of its media type that accepts it: A1 to A11, with
 * the import named by a new random ID (N7), and the refusals of A14. `onProgress` is told of each conversion as its
 * adapter is found.
 */
export async function fileExport(
  context: StepContext,
  documents: readonly ExportDocument[],
  adapters: AdaptersOf,
  onProgress?: OnProgress,
): Promise<string> {
  const { pod, writes, newStore, time } = context;
  const name = time.newId();
  const started = time.now();
  const { layout } = context;
  const revisions = await Revisions.of(context);
  const kept = new Map<string, Triple[]>();
  const wentBack: WentBack[] = [];
  for (const [done, found] of documents.entries()) {
    const documentIri = await documentName(found.bytes);
    if (
      kept.has(documentIri) ||
      (await pod.read(layout.storedBytes.path(documentIri))) !== undefined
    )
      continue;
    const document: BridgeDocument = {
      iri: documentIri,
      bytes: found.bytes,
      envelope: found.envelope,
      facts: { iri: `${documentIri}#facts`, bytes: read(found, started) },
    };
    const adapter = await accepting(adapters, found, document);
    await onProgress?.({ part: "converting", done, of: documents.length });
    const conversion = await refusing(found.path, () =>
      adapter.convert(document),
    );
    const graph = await parseGraph(conversion.graph, documentIri, newStore);
    const subject = iri(documentIri);
    refuseUnaccounted(graph, subject, found.path);
    let revised = false;
    let reportedOlder = false;
    const arriving = arrivals(layout, graph, name, found.path);
    await revisions.prepare(arriving);
    for (const arrival of arriving) {
      const repeated = await revisions.repeats(arrival);
      const older = repeated
        ? revisions.holding(arrival)
        : await revisions.revise(arrival, writes);
      revised ||= !repeated;
      if (older === undefined) continue;
      const contradicted = await revisions.contradictedBy(arrival);
      if (contradicted.length === 0) continue;
      wentBack.push({ older, contradicted });
      reportedOlder = true;
    }
    if (
      revised ||
      reportedOlder ||
      (await hasFindings(conversion.findings, documentIri, newStore))
    ) {
      writes.add(layout.storedBytes.path(documentIri), found.bytes);
      writes.add(
        layout.place(`${PROV}Entity`).path(documentIri),
        ntriples(graph.closure(subject)),
      );
      kept.set(
        documentIri,
        importDescription(graph, subject, name, found.path),
      );
      for (const base of graph.objects(subject, SERVER_BASE_URL)) {
        const server = await serverRecord(layout, base.value);
        if (server !== undefined)
          writes.add(
            server.place.path(server.record.value),
            ntriples(server.triples),
          );
      }
    }
  }
  await revisions.write(writes, wentBack);
  if (kept.size === 0) return name;
  const descriptions = [...kept.values()];
  const forms = new Set(await Promise.all(descriptions.map(canonical)));
  if (forms.size > 1)
    throw new Refusal(
      "its documents disagree on the import's label, start or association",
    );
  writes.act({
    name,
    path: layout.place(`${PROV}Activity`, [USED]).path(name),
    triples: [
      ...(descriptions[0] ?? []),
      ...[...kept.keys()].map((document): Triple => [
        iri(name),
        iri(USED),
        iri(document),
      ]),
    ],
  });
  return name;
}

/** An entry: its session's description, and each draft as a record (N2) with its version and first revision (A12). */
export async function fileEntry(
  context: StepContext,
  entry: StepFile,
  shapes: Shapes,
): Promise<string> {
  let graph = await parseStepFile(entry, context.newStore);
  const activities = graph.subjects(TYPE, iri(`${PROV}Activity`));
  if (activities.length !== 1)
    throw new Refusal(
      `${entry.name} holds ${activities.length} activities, not one`,
    );
  const [session] = activities as [Triple[0]];
  if (session.value === "urn:cascade:this-entry")
    throw new Refusal(
      `${entry.name} names its session urn:cascade:this-entry: an app mints a urn:uuid: for each entry session once, and keeps it`,
    );
  if (session.termType !== "NamedNode")
    throw new Refusal(`${entry.name}'s session has no name`);
  let [at] = graph.objects(session, STARTED);
  if (at === undefined) {
    at = literal(context.time.now(), DATE_TIME);
    graph = new Graph([...graph.triples, [session, iri(STARTED), at]]);
  }
  try {
    inUtc(at.value);
  } catch (error) {
    throw new Refusal(
      `${entry.name}'s session's start: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const unfit = await shapes.violations(graph.triples);
  if (unfit.length > 0)
    throw new Refusal(
      `${entry.name} does not conform to the vocabulary's shapes: ${unfit.join("; ")}`,
    );
  const records = new Map<string, NamedNode>();
  for (const draft of graph.subjects(TYPE)) {
    const position = DRAFT.exec(draft.value)?.[1];
    if (draft.termType === "NamedNode" && position !== undefined)
      records.set(
        draft.value,
        iri(await enteredRecordName(session.value, Number(position))),
      );
  }
  const { layout } = context;
  const sessions = layout.place(`${PROV}Activity`);
  const stated = layout.place(
    `${PROV}Activity`,
    graph.match(session).map(([, p]) => p.value),
  );
  if (stated !== sessions)
    throw new Refusal(
      `${entry.name}: its session states what the layout files in ${stated.folder}, not ${sessions.folder}`,
    );
  const revisions = await Revisions.of(context);
  const drafts = graph
    .subjects(SPECIALIZATION_OF)
    .sort((a, b) => (a.value < b.value ? -1 : 1));
  for (const draftVersion of drafts) {
    const [draft] = graph.objects(draftVersion, SPECIALIZATION_OF);
    const record = draft === undefined ? undefined : records.get(draft.value);
    if (draft === undefined || record === undefined)
      throw new Refusal(
        `${entry.name}: ${draftVersion.value} is the version of no draft`,
      );
    const { place, kind } = recordPlace(layout, graph, draft, entry.name);
    const within = (term: Term): boolean =>
      term.termType === "NamedNode" &&
      (term.value === draftVersion.value ||
        term.value.startsWith(`${draftVersion.value}#`));
    const content = renamedWithin(
      graph.triples
        .filter(([s]) => within(s))
        .map(
          ([s, p, o]): Triple =>
            [
              s,
              p,
              o.termType === "NamedNode" ? (records.get(o.value) ?? o) : o,
            ] as unknown as Triple,
        ),
      draftVersion.value,
      THIS_VERSION,
    );
    const version = await named(
      content,
      `${entry.name}: ${draftVersion.value}`,
    );
    await revisions.revise(
      {
        record,
        place,
        recordTriples: [[record, iri(TYPE), kind]],
        version,
        versionTriples: renamedWithin(content, THIS_VERSION, version.value),
        statements: [],
        at: at.value,
        observedAsOf: at,
        by: session.value,
        writersClock: true,
      },
      context.writes,
    );
  }
  await revisions.write(context.writes);
  context.writes.act({
    name: session.value,
    path: sessions.path(session.value),
    triples: graph.closure(session),
  });
  return session.value;
}

/** The version property each fact a connect reports is held as (A16). */
const REPORTED: readonly (readonly [keyof Reported, string])[] = [
  ["selfAssertedBaseUrl", `${CASCADE}selfAssertedBaseUrl`],
  ["authorizationEndpoint", `${CASCADE}authorizationEndpoint`],
  ["softwareName", `${CASCADE}serverSoftwareName`],
  ["softwareVersion", `${CASCADE}serverSoftwareVersion`],
  ["clientId", `${CASCADE}connectClientId`],
];

/**
 * A connect (A16): its act, named by a new random ID (N7), and a version of its server's record holding what the
 * server reported, with a revision after the record's last; a connect whose version is the one the record is at writes
 * nothing.
 */
export async function fileConnect(
  context: StepContext,
  connect: Reported,
): Promise<string | undefined> {
  const { writes, time, layout } = context;
  const name = time.newId();
  const started = time.now();
  const server = await serverRecord(layout, connect.fhirBase);
  if (server === undefined)
    throw new Refusal("the connect's FHIR base cannot be normalised");
  const placeholder = iri(THIS_VERSION);
  const content: Triple[] = [
    [placeholder, iri(SPECIALIZATION_OF), server.record],
    ...REPORTED.flatMap(([fact, property]): Triple[] => {
      const value = connect[fact];
      return value === undefined
        ? []
        : [[placeholder, iri(property), literal(value)]];
    }),
  ];
  const version = await named(content, "the connect's version");
  const revisions = await Revisions.of(context);
  const arrival: Arrival = {
    record: server.record,
    place: server.place,
    recordTriples: server.triples,
    version,
    versionTriples: renamed(content, placeholder, version),
    statements: [],
    at: started,
    observedAsOf: literal(started, DATE_TIME),
    by: name,
    writersClock: true,
  };
  if (await revisions.repeats(arrival)) return undefined;
  await revisions.revise(arrival, writes);
  await revisions.write(writes);
  const act = iri(name);
  writes.act({
    name,
    path: layout.place(`${PROV}Activity`).path(name),
    triples: [
      [act, iri(TYPE), iri(`${PROV}Activity`)],
      [act, iri(TYPE), iri(`${CASCADE}ConnectToServer`)],
      [act, iri(STARTED), literal(started, DATE_TIME)],
    ],
  });
  return name;
}
