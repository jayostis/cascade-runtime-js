import type { Reported } from "@cascade-runtime/fhir-pull";
import {
  type AdaptersOf,
  type BridgeDocument,
  isBridgeError,
  type LoadedAdapter,
} from "./bridge.js";
import { Graph, parseGraph } from "./graph.js";
import type { ExportDocument } from "./importer.js";
import type { Layout, Placement } from "./layout.js";
import {
  canonical,
  contentName,
  documentName,
  enteredRecordName,
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
import { derivationsOf, QUERIES } from "./derive.js";
import { type StoreFactory, Union } from "./store.js";

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

/** What an arrival is told apart by: its version, its source version and its source change time. */
function held(version: string, source?: string, changed?: string): string {
  return [version, source ?? "", changed ?? ""].join("\u0000");
}

/** Each record's revisions as the pod holds them, and the revisions a step adds after them. */
class Revisions {
  /** Each record's heads: its revisions that none revises, one unless two writers revised it apart. */
  readonly #heads = new Map<
    string,
    readonly { readonly revision: string; readonly version: string }[]
  >();
  /** Each record's versions, and what its revisions are told apart by. */
  readonly #versions = new Map<string, Set<string>>();
  readonly #held = new Map<string, Set<string>>();
  readonly #files: [string, Uint8Array][] = [];
  /** Each record's current version, as the ladder picked it before the step, read once the first arrival needs it. */
  #current: Promise<ReadonlyMap<string, string>> | undefined;

  private constructor(
    readonly layout: Layout,
    readonly context: Pick<
      StepContext,
      "pod" | "newStore" | "layout" | "vocabulary" | "address"
    >,
  ) {}

  static async of(
    context: Pick<
      StepContext,
      "pod" | "newStore" | "layout" | "vocabulary" | "address"
    >,
  ): Promise<Revisions> {
    const { pod, layout } = context;
    const union = new Union(context.newStore());
    for (const { folder } of layout.recordPlacements) {
      for (const path of await pod.list(folder ?? "")) {
        const bytes = await pod.read(path);
        if (bytes !== undefined) await union.loadTurtle(bytes, pod.iri + path);
      }
    }
    const { rows } = await union.select(`
      PREFIX cascade: <${CASCADE}>
      PREFIX prov: <${PROV}>
      PREFIX pav: <${PAV}>
      SELECT DISTINCT ?revision ?record ?version ?previous ?sourceVersion ?changed WHERE {
        ?revision a cascade:Revision ; cascade:revisionOf ?record ; cascade:version ?version .
        OPTIONAL { ?revision prov:wasRevisionOf ?previous }
        OPTIONAL { ?revision pav:version ?sourceVersion }
        OPTIONAL { ?revision pav:lastUpdateOn ?changed }
      }`);
    const revisions = new Revisions(layout, context);
    const revised = new Set(rows.map((row) => row.get("previous")?.value));
    for (const row of rows) {
      const [record, revision, version] = ["record", "revision", "version"].map(
        (name) => row.get(name)?.value ?? "",
      ) as [string, string, string];
      revisions.#add(
        record,
        version,
        row.get("sourceVersion")?.value,
        row.get("changed")?.value,
      );
      if (revised.has(revision)) continue;
      const heads = revisions.#heads.get(record) ?? [];
      if (!heads.some((head) => head.revision === revision))
        revisions.#heads.set(record, [...heads, { revision, version }]);
    }
    return revisions;
  }

  #add(record: string, version: string, source?: string, changed?: string) {
    const versions = this.#versions.get(record) ?? new Set();
    versions.add(version);
    this.#versions.set(record, versions);
    const told = this.#held.get(record) ?? new Set();
    told.add(held(version, source, changed));
    this.#held.set(record, told);
  }

  /**
   * Each record's current version as the vocabulary's derivations pick it, through
   * queries/derivations/current-revisions.rq under the everyday lens, over the files of the set and the syncs, which
   * hold the judgments, the documents' transmitters and the snapshots the ladder reads: which lens counts a person's
   * judgments does not touch what their Before or Erroneous does to it.
   */
  #currentVersions(): Promise<ReadonlyMap<string, string>> {
    this.#current ??= (async () => {
      const { context } = this;
      const union = new Union(context.newStore());
      const held = (await context.pod.list("")).filter(
        (path) =>
          this.layout.inSnapshotSet(path) || this.layout.inSyncsFolder(path),
      );
      await podFiles(context.pod, this.layout, context.address, union, held);
      await (
        await derivationsOf(context.vocabulary)
      ).derive(union, LADDER_LENS, undefined, CURRENT_REVISIONS);
      const { rows } = await union.select(
        `SELECT ?record ?current WHERE { ?record <${PAV}hasCurrentVersion> ?current ; a <${CASCADE}Record> }`,
      );
      return new Map(
        rows.map((row) => [
          row.get("record")?.value ?? "",
          row.get("current")?.value ?? "",
        ]),
      );
    })();
    return this.#current;
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
    const changed = statedOnRevision(arrival, `${PAV}lastUpdateOn`);
    const told = held(
      version,
      statedOnRevision(arrival, `${PAV}version`),
      changed,
    );
    if (this.#held.get(record)?.has(told) ?? false) return true;
    if (!(this.#versions.get(record)?.has(version) ?? false)) return false;
    if (changed === undefined) return true;
    return (await this.#currentVersions()).get(record) === version;
  }

  /** Adds the record and its version, and holds the revision after each of the record's heads (A2, A5) until `write`. */
  async revise(arrival: Arrival, writes: StepWrites): Promise<void> {
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
    this.#files.push([
      this.layout.revision(arrival.place, name),
      ntriples(renamedWithin(triples, THIS_REVISION, name)),
    ]);
    this.#heads.set(record, [
      { revision: name, version: arrival.version.value },
    ]);
    this.#add(
      record,
      arrival.version.value,
      statedOnRevision(arrival, `${PAV}version`),
      statedOnRevision(arrival, `${PAV}lastUpdateOn`),
    );
  }

  /** Adds the revisions held, after every file before them (W1). */
  write(writes: StepWrites): void {
    for (const [path, bytes] of this.#files) writes.add(path, bytes);
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
      const [observedAsOf = at] = [
        ...documents.flatMap((document) =>
          graph.objects(document, `${CASCADE}answeredAsOf`),
        ),
        ...documents.flatMap((document) =>
          graph.objects(document, `${PAV}retrievedOn`),
        ),
        ...graph.objects(arrival, `${PAV}lastUpdateOn`),
      ];
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
    for (const arrival of arrivals(layout, graph, name, found.path)) {
      if (await revisions.repeats(arrival)) continue;
      await revisions.revise(arrival, writes);
      revised = true;
    }
    if (
      revised ||
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
  revisions.write(writes);
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
  const placeholder = iri(THIS_VERSION);
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
    const content = graph
      .match(draftVersion)
      .map(([, p, o]): Triple => [
        placeholder,
        p,
        o.termType === "NamedNode" ? (records.get(o.value) ?? o) : o,
      ]);
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
        versionTriples: renamed(content, placeholder, version),
        statements: [],
        at: at.value,
        observedAsOf: at,
        by: session.value,
      },
      context.writes,
    );
  }
  revisions.write(context.writes);
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
  };
  if (await revisions.repeats(arrival)) return undefined;
  await revisions.revise(arrival, writes);
  revisions.write(writes);
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
