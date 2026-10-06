import type { BridgeDocument, LoadedAdapter } from "./bridge.js";
import type { Files } from "./files.js";
import { Graph, parseGraph } from "./graph.js";
import type { ExportDocument } from "./importer.js";
import type { Layout, Placement } from "./layout.js";
import {
  canonical,
  contentName,
  documentName,
  inUtc,
  recordName,
  THIS_ENTRY,
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
import { REC, Refusal, type StepContext, type StepFile } from "./step.js";
import type { StoreFactory } from "./store.js";

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
const DRAFT = /^urn:cascade:output-(\d+)$/;

/** One arrival of a record, as a revision would carry it (runtime/rules.md, N4). */
interface Arrival {
  readonly record: NamedNode;
  readonly place: Placement;
  readonly recordTriples: readonly Triple[];
  readonly version: NamedNode;
  readonly versionTriples: readonly Triple[];
  /** Every statement on the arrival but `bridge:arrivedAs` and `prov:wasGeneratedBy`. */
  readonly statements: readonly (readonly [NamedNode, Term])[];
  /** The start of the import or the session, as an `xsd:dateTime`. */
  readonly at: string;
  /** The import or the session. */
  readonly by: string;
}

function sourceVersion(arrival: Arrival): string | undefined {
  return arrival.statements.find(([p]) => p.value === `${PAV}version`)?.[1]
    .value;
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

/** Each record's revisions as the pod holds them, and the revisions a step adds after them. */
class Revisions {
  readonly #last = new Map<string, { revision: string; version: string }>();
  readonly #sourceVersions = new Map<string, Set<string>>();
  readonly #files: [string, Uint8Array][] = [];

  private constructor(readonly layout: Layout) {}

  static async of(
    pod: Files,
    newStore: StoreFactory,
    layout: Layout,
  ): Promise<Revisions> {
    const store = newStore();
    for (const { folder } of layout.recordPlacements) {
      for (const path of await pod.list(folder ?? "")) {
        const bytes = await pod.read(path);
        if (bytes !== undefined)
          await store.loadTurtle(bytes, { graph: pod.iri + path });
      }
    }
    const { rows } = await store.select(`
      PREFIX rec: <${REC}>
      PREFIX prov: <${PROV}>
      PREFIX pav: <${PAV}>
      SELECT DISTINCT ?revision ?record ?version ?previous ?sourceVersion WHERE {
        ?revision a rec:Revision ; rec:revisionOf ?record ; rec:version ?version .
        OPTIONAL { ?revision prov:wasRevisionOf ?previous }
        OPTIONAL { ?revision pav:version ?sourceVersion }
      }`);
    const revisions = new Revisions(layout);
    const revised = new Set(rows.map((row) => row.get("previous")?.value));
    for (const row of rows) {
      const [record, revision, version] = ["record", "revision", "version"].map(
        (name) => row.get(name)?.value ?? "",
      ) as [string, string, string];
      const found = row.get("sourceVersion")?.value;
      if (found !== undefined) revisions.#sourceVersionsOf(record).add(found);
      if (revised.has(revision)) continue;
      const last = revisions.#last.get(record);
      if (last !== undefined && last.revision !== revision)
        throw new Error(`${record} has two revisions that none revises`);
      revisions.#last.set(record, { revision, version });
    }
    return revisions;
  }

  #sourceVersionsOf(record: string): Set<string> {
    let found = this.#sourceVersions.get(record);
    if (found === undefined) {
      found = new Set();
      this.#sourceVersions.set(record, found);
    }
    return found;
  }

  /** Whether the arrival repeats a source version the record's revisions carry (A3) or the version it is at (A4). */
  repeats(arrival: Arrival): boolean {
    const source = sourceVersion(arrival);
    return (
      (source !== undefined &&
        this.#sourceVersionsOf(arrival.record.value).has(source)) ||
      this.#last.get(arrival.record.value)?.version === arrival.version.value
    );
  }

  /** Adds the record and its version, and holds the revision after the record's last (A2, A5) until `write`. */
  async revise(arrival: Arrival, writes: StepWrites): Promise<void> {
    const record = arrival.record.value;
    writes.add(arrival.place.path(record), ntriples(arrival.recordTriples));
    writes.add(
      this.layout.version(arrival.place, arrival.version.value),
      ntriples(arrival.versionTriples),
    );
    const placeholder = iri(THIS_REVISION);
    const previous = this.#last.get(record)?.revision;
    const triples: Triple[] = [
      ...arrival.statements.map(([p, o]): Triple => [placeholder, p, o]),
      [placeholder, iri(TYPE), iri(`${REC}Revision`)],
      [placeholder, iri(`${REC}revisionOf`), arrival.record],
      [placeholder, iri(`${REC}version`), arrival.version],
      [
        placeholder,
        iri(`${PROV}generatedAtTime`),
        literal(arrival.at, DATE_TIME),
      ],
      [placeholder, iri(GENERATED_BY), iri(arrival.by)],
      ...(previous === undefined
        ? []
        : [
            [placeholder, iri(`${PROV}wasRevisionOf`), iri(previous)] as Triple,
          ]),
    ];
    const { value: name } = await named(triples, `the revision of ${record}`);
    this.#files.push([
      this.layout.revision(arrival.place, name),
      ntriples(renamed(triples, placeholder, iri(name))),
    ]);
    this.#last.set(record, { revision: name, version: arrival.version.value });
    const source = sourceVersion(arrival);
    if (source !== undefined) this.#sourceVersionsOf(record).add(source);
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
  for (const arrival of graph.subjects(ARRIVED_AS)) add(graph.match(arrival));
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
      return {
        record,
        place: recordPlace(layout, graph, record, where).place,
        recordTriples: graph.match(record),
        version,
        versionTriples: graph.triples.filter(([s]) => inVersion(s, version)),
        statements: graph
          .match(arrival)
          .filter(([, p]) => p.value !== ARRIVED_AS && p.value !== GENERATED_BY)
          .map(([, p, o]) => [p, o] as const),
        at: at.value,
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

async function accepting(
  adapters: readonly LoadedAdapter[],
  document: BridgeDocument,
): Promise<LoadedAdapter | undefined> {
  for (const adapter of adapters)
    if (await adapter.accepts(document)) return adapter;
  return undefined;
}

/**
 * Files an export's documents, each converted by the first adapter that accepts it: A1 to A11, with the import named
 * by a new random ID (N7), and the refusals of A14.
 */
export async function fileExport(
  context: StepContext,
  documents: readonly ExportDocument[],
  adapters: readonly LoadedAdapter[],
): Promise<string> {
  const { pod, writes, newStore, time } = context;
  const name = time.newId();
  const started = time.now();
  const { layout } = context;
  const revisions = await Revisions.of(pod, newStore, layout);
  const kept = new Map<string, Triple[]>();
  for (const found of documents) {
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
    const adapter = await accepting(adapters, document);
    if (adapter === undefined) continue;
    const conversion = await adapter.convert(document);
    const graph = await parseGraph(conversion.graph, documentIri, newStore);
    const subject = iri(documentIri);
    refuseUnaccounted(graph, subject, found.path);
    let revised = false;
    for (const arrival of arrivals(layout, graph, name, found.path)) {
      if (revisions.repeats(arrival)) continue;
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
  writes.add(
    layout.place(`${PROV}Activity`, [USED]).path(name),
    ntriples([
      ...(descriptions[0] ?? []),
      ...[...kept.keys()].map((document): Triple => [
        iri(name),
        iri(USED),
        iri(document),
      ]),
    ]),
  );
  return name;
}

/** An entry: its session's description, and each draft as a record (N2) with its version and first revision (A12). */
export async function fileEntry(
  context: StepContext,
  entry: StepFile,
): Promise<string> {
  let graph = await parseGraph(entry.bytes, entry.base, context.newStore);
  const activities = graph.subjects(TYPE, iri(`${PROV}Activity`));
  if (activities.length !== 1)
    throw new Refusal(
      `${entry.name} holds ${activities.length} activities, not one`,
    );
  let [session] = activities as [Triple[0]];
  if (session.value === THIS_ENTRY) {
    const id = iri(context.time.newId());
    graph = new Graph([
      ...renamed(
        graph.triples.filter(
          ([s, p]) => !(s.value === THIS_ENTRY && p.value === STARTED),
        ),
        session,
        id,
      ),
      [id, iri(STARTED), literal(context.time.now(), DATE_TIME)],
    ]);
    session = id;
  }
  if (session.termType !== "NamedNode")
    throw new Refusal(`${entry.name}'s session has no name`);
  const [at] = graph.objects(session, STARTED);
  if (at === undefined)
    throw new Refusal(`${entry.name}'s session has no start`);
  let started: string;
  try {
    started = inUtc(at.value);
  } catch (error) {
    throw new Refusal(
      `${entry.name}'s session's start: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const records = new Map<string, NamedNode>();
  for (const draft of graph.subjects(TYPE)) {
    const position = DRAFT.exec(draft.value)?.[1];
    if (draft.termType === "NamedNode" && position !== undefined)
      records.set(
        draft.value,
        iri(await recordName([context.subject, started, position])),
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
  const revisions = await Revisions.of(context.pod, context.newStore, layout);
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
        by: session.value,
      },
      context.writes,
    );
  }
  revisions.write(context.writes);
  context.writes.add(
    sessions.path(session.value),
    ntriples(graph.closure(session)),
  );
  return session.value;
}
