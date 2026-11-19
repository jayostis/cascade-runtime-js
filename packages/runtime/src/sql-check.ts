import { boundToRecords } from "./bound-records.js";
import { type VocabularyBuild, vocabularyBuild } from "./build.js";
import type { Assertion } from "./conformance.js";
import type { Database, DatabaseFunction } from "./database.js";
import { addLayout } from "./dataset.js";
import { type Files, MemoryFiles, readText } from "./files.js";
import { Graph } from "./graph.js";
import { keptMatcherJudgments } from "./kept.js";
import type { Layout } from "./layout.js";
import { lenses } from "./questions.js";
import { iri, ntriples, RDF, type Term } from "./rdf.js";
import { References } from "./references.js";
import {
  askedOf,
  askedWhole,
  graphsOfDump,
  loadStatements,
  dayKey,
  instantKey,
  parsedNt,
  sqlAnswer,
  sqlDatabaseFunctions,
  sqlFunctions,
  SqlFunctionRefused,
  sqlNt,
  sqlParts,
  sqlTermOf,
  SQL_FUNCTION_VECTORS,
  STATEMENTS_SCHEMA,
  wholeScope,
  LITERAL,
  BLANK,
  IRI,
  sparqlCompare,
} from "./statements.js";
import {
  RestorableUnion,
  type Store,
  type StoreFactory,
  Union,
} from "./store.js";

/** The address a fixture's files are read under, as the vocabulary's tests read them. */
export const FIXTURE_ADDRESS = "https://pod.example/";
export const FIXTURES = "tests/fixtures/";
const QUERIES = "queries/";
const MATCHER = "queries/matcher/";
const LENSES = "queries/lenses/";
const VIEWS = "queries/views/";
const LABELS = "queries/labels.rq";
const LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const WRITTEN_BY = "https://ns.cascadeprotocol.org/cascade#writtenByQueryPath";
const INSTANCE = "http://www.w3.org/ns/solid/terms#instance";
const MF = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#";
const QT = "http://www.w3.org/2001/sw/DataAccess/tests/test-query#";
const CTM = "https://ns.cascadeprotocol.org/test-manifest#";
const SPECIALIZATION_OF = "http://www.w3.org/ns/prov#specializationOf";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const XSD_STRING = `${XSD}string`;
const SCREEN_PARTS = ["tables", "fill", "finish"] as const;

/** One row of an answer: each column's term as N-Triples, or null where unbound. */
type Row = readonly (string | null)[];

/** A query of the vocabulary's with a `.sql` beside it. */
export interface Ported {
  /** The `.rq`'s path in the vocabulary. */
  readonly rq: string;
  readonly rqText: string;
  readonly sql: string;
}

interface ManifestEntry {
  readonly name: string;
  readonly query?: string;
  readonly lens?: string;
  readonly result?: string;
  readonly records: readonly string[];
}

/** A fixture built under a lens, the runtime's store holding it, and the statements loaded from it into SQLite. */
export interface BuiltFixture {
  readonly name: string;
  readonly lens: string;
  readonly union: Union;
  readonly db: Database;
  readonly entries: readonly ManifestEntry[];
  /** Why each ported `.sql` that cannot be answered cannot, by its `.rq`'s path: a screen that failed, or reads one. */
  readonly screens: ReadonlyMap<string, string>;
  /** Where each view's screen, filled keyed to what a change touched, is not as a whole fill leaves it, by its `.rq`. */
  readonly keyedFill?: ReadonlyMap<string, readonly string[]>;
  close(): void;
}

export interface SqlCheckOptions {
  readonly vocabulary: Files;
  readonly newStore: StoreFactory;
  readonly layout: Layout;
  /** An empty database in memory, with the functions given registered. */
  readonly open: (functions: readonly DatabaseFunction[]) => Database;
}

const decoded = (
  vocabulary: Files,
  value: string | undefined,
): string | undefined =>
  value === undefined
    ? undefined
    : value.startsWith(vocabulary.iri)
      ? decodeURIComponent(value.slice(vocabulary.iri.length))
      : value;

/** Each `.rq` outside `queries/matcher/` with a `.sql` beside it, sorted by path. */
export async function portedQueries(vocabulary: Files): Promise<Ported[]> {
  const paths = await vocabulary.list(QUERIES.slice(0, -1));
  const held = new Set(paths);
  const found: Ported[] = [];
  for (const rq of paths
    .filter((path) => path.endsWith(".rq") && !path.startsWith(MATCHER))
    .sort()) {
    const sql = `${rq.slice(0, -3)}.sql`;
    if (held.has(sql))
      found.push({
        rq,
        rqText: await readText(vocabulary, rq),
        sql: await readText(vocabulary, sql),
      });
  }
  return found;
}

/** The names of the vocabulary's fixtures, each a folder of `tests/fixtures/` with a manifest. */
export async function fixtureNames(vocabulary: Files): Promise<string[]> {
  return [
    ...new Set(
      (await vocabulary.list(FIXTURES.slice(0, -1)))
        .filter((path) => path.endsWith("/manifest.ttl"))
        .map((path) => path.slice(FIXTURES.length, -"/manifest.ttl".length))
        .filter((name) => !name.includes("/")),
    ),
  ].sort();
}

async function manifestEntries(
  vocabulary: Files,
  fixture: string,
  store: Store,
): Promise<ManifestEntry[]> {
  const path = `${FIXTURES}${fixture}/manifest.ttl`;
  const graph = new Graph(
    await store.parse(await readText(vocabulary, path), vocabulary.iri + path),
  );
  const [head] = graph.subjects(`${RDF}type`, iri(`${MF}Manifest`));
  const found: ManifestEntry[] = [];
  let list: Term | undefined =
    head === undefined ? undefined : graph.objects(head, `${MF}entries`)[0];
  while (list !== undefined && list.value !== `${RDF}nil`) {
    const entry = graph.objects(list, `${RDF}first`)[0];
    list = graph.objects(list, `${RDF}rest`)[0];
    if (entry === undefined) continue;
    const action = graph.objects(entry, `${MF}action`)[0];
    const one = (
      subject: Term | undefined,
      predicate: string,
    ): string | undefined =>
      subject === undefined
        ? undefined
        : graph.objects(subject, predicate)[0]?.value;
    found.push({
      name: one(entry, `${MF}name`) ?? entry.value,
      query: decoded(vocabulary, one(action, `${QT}query`)),
      lens: decoded(vocabulary, one(action, `${CTM}lensQueryPath`)),
      result: decoded(vocabulary, one(entry, `${MF}result`)),
      records:
        action === undefined
          ? []
          : graph
              .objects(action, `${CTM}boundRecord`)
              .map(({ value }) => value)
              .sort(),
    });
  }
  return found;
}

/** A store's dump of the TriG, each of its graphs listed, for `restore`: so its graphs are outside any union. */
async function restoredTrig(
  store: Store,
  newStore: StoreFactory,
  trig: string,
): Promise<void> {
  const body = new TextEncoder().encode(trig);
  const dumped = (graphs: readonly string[]): Uint8Array => {
    const head = new TextEncoder().encode(
      `# ${JSON.stringify({ graphs, length: body.length })}\n`,
    );
    const bytes = new Uint8Array(head.length + body.length);
    bytes.set(head);
    bytes.set(body, head.length);
    return bytes;
  };
  const scratch = newStore();
  let graphs: string[];
  try {
    await scratch.restore(dumped([]));
    const { rows } = await scratch.select(
      "SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }",
      new Set(),
    );
    graphs = rows.flatMap((row) => row.get("g")?.value ?? []);
  } finally {
    scratch.free?.();
  }
  await store.restore(dumped(graphs));
}

interface Context extends SqlCheckOptions {
  readonly build: VocabularyBuild;
  readonly schema: string;
  readonly functions: readonly DatabaseFunction[];
  readonly ported: readonly Ported[];
}

/**
 * The fixture as the runtime builds a pod under the lens: each Turtle file a graph named by the address and its path,
 * each TriG file's graphs outside the union, the lens's derivations with the Sames M7 keeps (a version whose rows no
 * TriG file holds joins nothing), the files the layout's queries write, and the layout; then its union's graphs loaded
 * into SQLite and each ported view's screen made.
 */
async function builtFixture(
  context: Context,
  fixture: string,
  lens: string,
): Promise<BuiltFixture> {
  const { vocabulary, newStore, layout, build } = context;
  const folder = `${FIXTURES}${fixture}/`;
  const paths = await vocabulary.list(folder.slice(0, -1));
  const store = newStore();
  try {
    const trig = paths.filter((path) => path.endsWith(".trig"));
    if (trig.length > 0)
      await restoredTrig(
        store,
        newStore,
        (
          await Promise.all(
            trig.map(
              async (path) =>
                `@base <${FIXTURE_ADDRESS}${path.slice(path.lastIndexOf("/") + 1)}> .\n${await readText(vocabulary, path)}\n`,
            ),
          )
        ).join(""),
      );
    const union = new Union(store);
    const files = await Promise.all(
      paths
        .filter(
          (path) => path.endsWith(".ttl") && path !== `${folder}manifest.ttl`,
        )
        .map(async (path) => ({
          graph: FIXTURE_ADDRESS + path.slice(folder.length),
          turtle: new TextEncoder().encode(await readText(vocabulary, path)),
        })),
    );
    await union.loadFiles(files);
    await build.derivations.derive(union, lens, async (held) => {
      const index = new MemoryFiles("urn:cascade:fixture-tables/");
      const versions = await held.construct(
        `CONSTRUCT { ?version <${SPECIALIZATION_OF}> ?series } WHERE { ?version <${SPECIALIZATION_OF}> ?series FILTER EXISTS { GRAPH ?version { ?s ?p ?o } } }`,
      );
      await index.write("references.ttl", ntriples(versions));
      const tables = References.of(index, "", newStore);
      return keptMatcherJudgments(held, {
        vocabulary,
        newStore,
        references: () => tables,
      });
    });
    await build.queried(union, FIXTURE_ADDRESS);
    await addLayout(union, layout, FIXTURE_ADDRESS);
    const db = context.open(context.functions);
    try {
      loadStatements(
        db,
        context.schema,
        graphsOfDump(await store.dump(), union.graphs),
        `${fixture} under ${lens}`,
      );
      if (labelsOf(context.ported) !== undefined) unlabelled(db);
    } catch (error) {
      db.close();
      throw error;
    }
    const screens = madeScreens(db, context.ported);
    const keyedFill = new Map<string, string[]>();
    const views = context.ported.filter(
      ({ rq, sql }) =>
        (rq.startsWith(VIEWS) || rq === LABELS) &&
        sqlParts(sql).size > 0 &&
        !screens.has(rq),
    );
    for (const { view, line } of keyedFillFound(db, views))
      keyedFill.set(view, [...(keyedFill.get(view) ?? []), line]);
    return {
      name: fixture,
      lens,
      union,
      db,
      entries: await manifestEntries(vocabulary, fixture, store),
      screens,
      keyedFill,
      close: () => {
        db.close();
        store.free?.();
      },
    };
  } catch (error) {
    store.free?.();
    throw error;
  }
}

const sqlPath = (rq: string): string => `${rq.slice(0, -3)}.sql`;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The tables a view's `tables` part makes. */
function tablesOf(parts: ReadonlyMap<string, string>): string[] {
  return [
    ...(parts.get("tables") ?? "").matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?(\w+)/gi,
    ),
  ].flatMap((found) => found[1] ?? []);
}

/** Each view's `.sql` under `queries/views/` with its parts: a screen each. */
function viewsOf(
  ported: readonly Ported[],
): { query: Ported; parts: ReadonlyMap<string, string> }[] {
  return ported
    .filter(({ rq }) => rq.startsWith(VIEWS))
    .map((query) => ({ query, parts: sqlParts(query.sql) }))
    .filter(({ parts }) => parts.size > 0);
}

/** labels.sql's parts, where it is ported in parts. */
function labelsOf(
  ported: readonly Ported[],
): ReadonlyMap<string, string> | undefined {
  const found = ported.find(({ rq }) => rq === LABELS);
  const parts = found === undefined ? undefined : sqlParts(found.sql);
  return parts === undefined || parts.size === 0 ? undefined : parts;
}

const LABELS_FILE =
  "SELECT g.id AS id FROM quad w JOIN quad x ON x.s = w.s JOIN term i ON i.id = x.o JOIN term g ON g.nt = '<' || i.lex || '>' " +
  "WHERE w.p = (SELECT id FROM term WHERE nt = ?) AND w.o = (SELECT id FROM term WHERE nt = ?) " +
  "AND x.p = (SELECT id FROM term WHERE nt = ?)";

/** The graph of the file the layout says labels.rq writes, or none where the pod holds no layout of it. */
function labelsFile(db: Database): number | undefined {
  const found = db
    .prepare(LABELS_FILE)
    .get(`<${WRITTEN_BY}>`, '"labels.rq"', `<${INSTANCE}>`)?.id;
  return found === undefined ? undefined : Number(found);
}

/** Takes the labels file's rdfs:label statements out of the pod; its other statements stay. */
function unlabelled(db: Database): void {
  const file = labelsFile(db);
  if (file === undefined) return;
  db.prepare(
    "DELETE FROM quad WHERE g = ? AND p = (SELECT id FROM term WHERE nt = ?)",
  ).run(file, `<${LABEL}>`);
}

/** The id of the term the N-Triples text writes, made where the pod has none. */
function termId(db: Database, nt: string): number {
  const held = db.prepare("SELECT id FROM term WHERE nt = ?").get(nt)?.id;
  if (held !== undefined) return Number(held);
  const term = parsedNt(nt);
  db.prepare(
    "INSERT INTO term (nt, kind, lex, datatype, lang, instant, day) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    nt,
    term.kind,
    term.kind === BLANK ? null : term.value,
    term.datatype ?? null,
    term.lang ?? null,
    instantKey(term),
    dayKey(term),
  );
  return Number(db.prepare("SELECT id FROM term WHERE nt = ?").get(nt)?.id);
}

/**
 * The labels file's rdfs:label statements made again from labels.sql, as a runtime writes the file: its `fill` run, the
 * file's labels deleted and its `triples` rows put in the file's graph. Left as it is where the pod has no such graph.
 */
function labelled(db: Database, labels: ReadonlyMap<string, string>): void {
  const file = labelsFile(db);
  if (file === undefined) return;
  db.exec(labels.get("fill") ?? "");
  const { rows } = sqlAnswer(db, labels.get("triples") ?? "");
  db.prepare(
    "DELETE FROM quad WHERE g = ? AND p = (SELECT id FROM term WHERE nt = ?)",
  ).run(file, `<${LABEL}>`);
  const put = db.prepare(
    "INSERT OR IGNORE INTO quad (s, p, o, g) VALUES (?, ?, ?, ?)",
  );
  for (const [s, p, o] of rows) {
    if (s == null || p == null || o == null)
      throw new Error("labels.sql gives a triple with an unbound term");
    put.run(termId(db, s), termId(db, p), termId(db, o), file);
  }
}

/**
 * Makes and fills each view's screen, every view's `tables`, then every `fill`, then the labels from labels.sql, then
 * every `finish`, and gives why each ported `.sql` that cannot be answered cannot, by its `.rq`'s path: a view whose part
 * throws, named with the part, its later parts not run; labels.sql where its labels cannot be made; and a `.sql` that
 * reads a table of a screen that failed. The other screens are made whole. Only a view under `queries/views/` is a
 * screen.
 */
export function madeScreens(
  db: Database,
  ported: readonly Ported[],
): Map<string, string> {
  const failed = new Map<string, string>();
  const thrown = new Set<string>();
  const views = viewsOf(ported).map((view) => ({
    ...view,
    tables: tablesOf(view.parts),
  }));
  const labels = labelsOf(ported);
  const readsFailed = (text: string, self: string): string | undefined =>
    views.find(
      ({ query, tables }) =>
        query.rq !== self &&
        thrown.has(query.rq) &&
        tables.some((table) => new RegExp(`\\b${table}\\b`).test(text)),
    )?.query.rq;
  const reading = (rq: string, read: string): void => {
    failed.set(
      rq,
      `reads the screen of ${sqlPath(read)}, which fails: ${failed.get(read) ?? ""}`,
    );
  };
  for (const part of SCREEN_PARTS) {
    for (const { query, parts } of views) {
      if (failed.has(query.rq)) continue;
      const read = readsFailed(query.sql, query.rq);
      if (read !== undefined) {
        reading(query.rq, read);
        continue;
      }
      try {
        db.exec(parts.get(part) ?? "");
      } catch (error) {
        thrown.add(query.rq);
        failed.set(
          query.rq,
          `the screen of ${sqlPath(query.rq)} fails in its ${part} part: ${messageOf(error)}`,
        );
      }
    }
    if (part !== "fill" || labels === undefined || failed.has(LABELS)) continue;
    const read = readsFailed(
      ported.find(({ rq }) => rq === LABELS)?.sql ?? "",
      LABELS,
    );
    if (read !== undefined) {
      reading(LABELS, read);
      continue;
    }
    try {
      labelled(db, labels);
    } catch (error) {
      failed.set(
        LABELS,
        `the labels of ${sqlPath(LABELS)} cannot be made: ${messageOf(error)}`,
      );
    }
  }
  for (const { rq, sql } of ported) {
    if (failed.has(rq)) continue;
    const read = readsFailed(sql, rq);
    if (read !== undefined) reading(rq, read);
  }
  return failed;
}

const SCHEMA_TABLES = new Set(["term", "quad", "scope", "asked", "ledger"]);

/** The rows of each table a screen made, by table, each table's rows written and sorted. */
function screenTables(db: Database): Map<string, string[]> {
  const names = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
    )
    .all()
    .map(({ name }) => String(name))
    .filter((name) => !SCHEMA_TABLES.has(name));
  return new Map(
    names.map((name) => [
      name,
      db
        .prepare(`SELECT * FROM "${name}"`)
        .all()
        .map((row) =>
          JSON.stringify(Object.values(row), (_, value: unknown) =>
            typeof value === "bigint" ? value.toString() : value,
          ),
        )
        .sort(),
    ]),
  );
}

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";

interface KeyedChange {
  readonly name: string;
  /** Makes the change to the pod's statements, and gives the terms a keyed run puts in scope. */
  readonly make: (db: Database) => number[];
}

function termIds(db: Database, iris: readonly string[]): (number | null)[] {
  const find = db.prepare("SELECT id FROM term WHERE nt = ?");
  return iris.map((iri) => {
    const found = find.get(`<${iri}>`)?.id;
    return found === undefined ? null : Number(found);
  });
}

function made(
  db: Database,
  nt: string,
  kind: number,
  lex: string,
  datatype: string | null = kind === LITERAL ? XSD_STRING : null,
): number {
  db.prepare(
    "INSERT OR IGNORE INTO term (nt, kind, lex, datatype) VALUES (?, ?, ?, ?)",
  ).run(nt, kind, lex, datatype);
  return Number(db.prepare("SELECT id FROM term WHERE nt = ?").get(nt)?.id);
}

function renamed(
  db: Database,
  subjects: readonly number[],
  predicates: readonly number[],
): void {
  const name = made(db, '"renamed"', LITERAL, "renamed");
  const update = db.prepare(
    "UPDATE OR IGNORE quad SET o = ? WHERE s = ? AND p = ?",
  );
  for (const subject of subjects)
    for (const predicate of predicates) update.run(name, subject, predicate);
}

const idRows = (
  db: Database,
  sql: string,
  ...parameters: unknown[]
): number[][] =>
  db
    .prepare(sql)
    .all(...parameters)
    .map((row) => Object.values(row).map(Number));

/**
 * Each change a keyed run may be given over the pod, as the vocabulary's check makes them: each record in an entry,
 * unchanged; each record but the lead of an entry of two or more, moved to an entry of its own; each agent, renamed;
 * each record whose values give a reason condition, its reasons dropped, and given each other condition's record as a
 * reason; each entry those values are of, renamed, the record in scope, and renamed as a new record whose values give
 * no reason is put in it, or, after a whole fill, taken out of it again, that record alone in scope; and each document
 * a record's current revision derives from, retrieved again.
 */
function keyedChanges(db: Database, views: readonly Ported[]): KeyedChange[] {
  const [
    inEntry,
    lead,
    member,
    agent,
    label,
    foafName,
    current,
    reason,
    valuesOf,
    memberValues,
    rdfType,
    conditionKind,
    ...names
  ] = termIds(db, [
    `${CASCADE}inEntry`,
    `${CASCADE}leadMember`,
    `${CASCADE}entryMember`,
    "http://www.w3.org/ns/prov#agent",
    "http://www.w3.org/2000/01/rdf-schema#label",
    "http://xmlns.com/foaf/0.1/name",
    "http://purl.org/pav/hasCurrentVersion",
    `${CASCADE}reasonCondition`,
    `${CASCADE}valuesOfMember`,
    `${CASCADE}memberCurrentValues`,
    `${RDF}type`,
    `${CASCADE}ProblemOrDiagnosis`,
    `${CASCADE}drugName`,
    `${CASCADE}procedureName`,
    `${CASCADE}vaccineName`,
  ]);
  if (inEntry === null || inEntry === undefined) return [];
  const changes: KeyedChange[] = [];
  const entries = new Map<number, number[]>();
  for (const [record = 0, entry = 0] of idRows(
    db,
    "SELECT DISTINCT s, o FROM quad WHERE p = ? ORDER BY s, o",
    inEntry,
  )) {
    entries.set(entry, [...(entries.get(entry) ?? []), record]);
    changes.push({ name: `record ${record} unchanged`, make: () => [record] });
  }
  for (const [entry, records] of entries) {
    if (records.length < 2) continue;
    const leads = new Set(
      idRows(db, "SELECT o FROM quad WHERE s = ? AND p = ?", entry, lead).map(
        ([o]) => o,
      ),
    );
    for (const record of records
      .filter((one) => !leads.has(one))
      .sort((a, b) => a - b))
      changes.push({
        name: `record ${record} moved out of entry ${entry}`,
        make: (c) => {
          const apart = made(
            c,
            `<urn:cascade:entry:moved-${record}>`,
            IRI,
            `urn:cascade:entry:moved-${record}`,
          );
          c.prepare(
            "UPDATE quad SET o = ? WHERE s = ? AND p = ? AND o = ?",
          ).run(apart, record, inEntry, entry);
          c.prepare(
            "UPDATE quad SET s = ? WHERE s = ? AND p = ? AND o = ?",
          ).run(apart, entry, member, record);
          c.prepare(
            "INSERT OR IGNORE INTO quad (s, p, o, g) SELECT ?, ?, ?, g FROM quad WHERE s = ? AND p = ?",
          ).run(apart, lead, record, entry, lead);
          return [record];
        },
      });
  }
  if (agent !== null && agent !== undefined)
    for (const [named = 0] of idRows(
      db,
      "SELECT DISTINCT o FROM quad WHERE p = ?",
      agent,
    ))
      changes.push({
        name: `agent ${named} renamed`,
        make: (c) => {
          const versions = idRows(
            c,
            "SELECT o FROM quad WHERE s = ? AND p = ?",
            named,
            current,
          ).map(([o = 0]) => o);
          renamed(
            c,
            [named],
            label === null || label === undefined ? [] : [label],
          );
          renamed(
            c,
            versions,
            foafName === null || foafName === undefined ? [] : [foafName],
          );
          return [named];
        },
      });
  const named = names.filter((name): name is number => name !== null);
  const given =
    reason === null ||
    reason === undefined ||
    valuesOf === null ||
    valuesOf === undefined ||
    memberValues === null ||
    memberValues === undefined
      ? []
      : idRows(
          db,
          "SELECT DISTINCT v.o, e.s, v.s FROM quad r JOIN quad v ON v.s = r.s AND v.p = ? " +
            "JOIN quad e ON e.o = r.s AND e.p = ? WHERE r.p = ?",
          valuesOf,
          memberValues,
          reason,
        );
  for (const [record = 0, entry = 0, values = 0] of given) {
    changes.push({
      name: `record ${record}'s reasons dropped`,
      make: (c) => {
        c.prepare("DELETE FROM quad WHERE s = ? AND p = ?").run(values, reason);
        return [record];
      },
    });
    changes.push({
      name: `entry ${entry} its values give reasons for renamed, ${record} in scope`,
      make: (c) => {
        renamed(c, [entry], named);
        return [record];
      },
    });
    for (const [condition = 0] of idRows(
      db,
      "SELECT DISTINCT q.s FROM quad q JOIN quad t ON t.s = q.s AND t.p = ? AND t.o = ? WHERE q.p = ? " +
        "AND q.s NOT IN (SELECT o FROM quad WHERE s = ? AND p = ?)",
      rdfType,
      conditionKind,
      inEntry,
      values,
      reason,
    ))
      changes.push({
        name: `record ${record} given condition ${condition} as a reason`,
        make: (c) => {
          c.prepare(
            "INSERT INTO quad (s, p, o, g) SELECT s, p, ?, g FROM quad WHERE s = ? AND p = ? LIMIT 1",
          ).run(condition, values, reason);
          return [record];
        },
      });
  }
  /** A new record, its values giving no reason, put in the entry; its id. */
  const joined = (c: Database, entry: number): number => {
    const record = made(
      c,
      `<urn:cascade:joined-${entry}>`,
      IRI,
      `urn:cascade:joined-${entry}`,
    );
    const values = made(
      c,
      `<urn:cascade:joined-${entry}-values>`,
      IRI,
      `urn:cascade:joined-${entry}-values`,
    );
    const graph = c
      .prepare("SELECT g FROM quad WHERE s = ? AND p = ? LIMIT 1")
      .get(entry, memberValues)?.g;
    const put = c.prepare(
      "INSERT OR IGNORE INTO quad (s, p, o, g) VALUES (?, ?, ?, ?)",
    );
    put.run(record, inEntry, entry, graph);
    put.run(entry, member, record, graph);
    put.run(entry, memberValues, values, graph);
    put.run(values, valuesOf, record, graph);
    return record;
  };
  for (const entry of [...new Set(given.map(([, one = 0]) => one))].sort(
    (a, b) => a - b,
  )) {
    changes.push({
      name: `a record with no reason put in entry ${entry}, which is renamed, it alone in scope`,
      make: (c) => {
        const record = joined(c, entry);
        renamed(c, [entry], named);
        return [record];
      },
    });
    changes.push({
      name: `a record with no reason taken out of entry ${entry}, which is renamed, it alone in scope`,
      make: (c) => {
        const record = joined(c, entry);
        wholeScope(c);
        refilled(c, views);
        c.prepare("DELETE FROM quad WHERE ? IN (s, o) AND p IN (?, ?, ?)").run(
          record,
          inEntry,
          member,
          valuesOf,
        );
        c.prepare(
          "DELETE FROM quad WHERE s = ? AND p = ? AND o NOT IN (SELECT s FROM quad WHERE p = ?)",
        ).run(entry, memberValues, valuesOf);
        renamed(c, [entry], named);
        return [record];
      },
    });
  }
  const [derivedFrom, currentRevision] = termIds(db, [
    "http://www.w3.org/ns/prov#wasDerivedFrom",
    `${CASCADE}currentRevision`,
  ]);
  const documents =
    derivedFrom === null ||
    derivedFrom === undefined ||
    currentRevision === null ||
    currentRevision === undefined
      ? []
      : idRows(
          db,
          "SELECT DISTINCT d.o FROM quad r JOIN quad d ON d.s = r.o AND d.p = ? WHERE r.p = ? ORDER BY d.o",
          derivedFrom,
          currentRevision,
        );
  for (const [document = 0] of documents)
    changes.push({
      name: `document ${document} retrieved again`,
      make: (c) => {
        const retrieved = made(
          c,
          "<http://purl.org/pav/retrievedOn>",
          IRI,
          "http://purl.org/pav/retrievedOn",
        );
        const when = made(
          c,
          `"2030-01-01T00:00:00Z"^^<${XSD}dateTime>`,
          LITERAL,
          "2030-01-01T00:00:00Z",
          `${XSD}dateTime`,
        );
        c.prepare(
          "INSERT OR IGNORE INTO quad (s, p, o, g) SELECT ?, ?, ?, g FROM quad WHERE o = ? AND p = ? LIMIT 1",
        ).run(document, retrieved, when, document, derivedFrom);
        return [document];
      },
    });
  return changes;
}

/** Each view's `fill`, then the labels from labels.sql where it is among them, then each view's `finish`, for the entries in scope. */
function refilled(db: Database, views: readonly Ported[]): void {
  const parts = viewsOf(views).map(({ parts }) => parts);
  const labels = labelsOf(views);
  for (const part of ["fill", "finish"]) {
    for (const found of parts) db.exec(found.get(part) ?? "");
    if (part === "fill" && labels !== undefined) labelled(db, labels);
  }
}

/**
 * Over screens made and filled whole, each change a keyed run may be given, made to the pod's statements, and the
 * screens filled again with scope holding what it touched: where a table then differs from a whole fill of the changed
 * pod from empty tables, the view whose table it is and why. Each change is undone after, leaving the pod as it was.
 */
function keyedFillFound(
  db: Database,
  views: readonly Ported[],
): { view: string; line: string }[] {
  if (views.length === 0) return [];
  const owner = new Map<string, string>();
  for (const { query, parts } of viewsOf(views))
    for (const table of tablesOf(parts)) owner.set(table, query.rq);
  const filled = screenTables(db);
  const found: { view: string; line: string }[] = [];
  for (const { name, make } of keyedChanges(db, views)) {
    db.exec("SAVEPOINT keyed_change");
    try {
      const touched = make(db);
      let wanted = filled;
      if (!name.endsWith(" unchanged")) {
        db.exec("SAVEPOINT whole_fill");
        try {
          for (const table of filled.keys()) db.exec(`DELETE FROM "${table}"`);
          wholeScope(db);
          refilled(db, views);
          wanted = screenTables(db);
        } finally {
          db.exec("ROLLBACK TO whole_fill; RELEASE whole_fill");
        }
      }
      db.exec("DELETE FROM scope");
      const put = db.prepare("INSERT OR IGNORE INTO scope (term) VALUES (?)");
      for (const term of touched) put.run(term);
      refilled(db, views);
      const kept = screenTables(db);
      for (const [table, rows] of wanted) {
        if (!owner.has(table)) continue;
        const held = kept.get(table) ?? [];
        if (JSON.stringify(held) === JSON.stringify(rows)) continue;
        const extra = [...new Set(held)].filter((row) => !rows.includes(row));
        const lacked = [...new Set(rows)].filter((row) => !held.includes(row));
        found.push({
          view: owner.get(table) ?? "",
          line: `${name}: ${table} holds [${extra.join(", ")}] a whole fill does not, and lacks [${lacked.join(", ")}]`,
        });
      }
    } finally {
      db.exec("ROLLBACK TO keyed_change; RELEASE keyed_change");
    }
  }
  return found;
}

/**
 * Why each view's screen, filled keyed to what a change touched, is not as a whole fill of the changed pod leaves it,
 * as lines; none when every keyed fill agrees. The vocabulary's tests/test_sql.py makes the same check.
 */
export function keyedFillFailures(
  db: Database,
  views: readonly Ported[],
): string[] {
  return keyedFillFound(db, views).map(({ line }) => line);
}

const CONSTRUCT_FORM = /^\s*CONSTRUCT\b/i;

function isConstruct(text: string): boolean {
  return CONSTRUCT_FORM.test(
    text.replace(/^\s*(#.*|PREFIX\s.*|BASE\s.*)$/gm, ""),
  );
}

const ntOf = (term: Term | undefined): string | null =>
  term === undefined ? null : sqlNt(sqlTermOf(term));

/** What the `.rq` gives over the union, bound to the record if one is given: its columns and rows. */
async function rqAnswer(
  union: Union,
  text: string,
  record?: string,
): Promise<{ names: readonly string[]; rows: Row[] }> {
  if (isConstruct(text))
    return {
      names: ["s", "p", "o"],
      rows: (await union.construct(text)).map((triple) =>
        triple.map((term) => ntOf(term)),
      ),
    };
  const { variables, rows } = await union.select(
    record === undefined ? text : boundToRecords(text, [record]),
  );
  return {
    names: variables,
    rows: rows.map((row) => variables.map((name) => ntOf(row.get(name)))),
  };
}

/**
 * How an ORDER BY condition reads its variable where it orders by its STR: the position, from 1, its text is taken
 * from, the length taken or none for the rest, and whether an unbound value reads as "", as in
 * DESC(COALESCE(SUBSTR(STR(?a), 1, 10), "")).
 */
export interface TextRead {
  readonly start: number;
  readonly length?: number;
  readonly unboundEmpty: boolean;
}

/** A key the rows are ordered by: a column, and how its condition reads it, or none where it orders the term itself. */
export interface OrderKey {
  readonly column: number;
  readonly read?: TextRead;
}

function readAsText(condition: string): TextRead | undefined {
  if (!/\bSTR\s*\(\s*\?\w+\s*\)/.test(condition)) return undefined;
  const cut =
    /SUBSTR\s*\(\s*STR\s*\(\s*\?\w+\s*\)\s*,\s*(\d+)(?:\s*,\s*(\d+))?\s*\)/.exec(
      condition,
    );
  return {
    start: cut === null ? 1 : Number(cut[1]),
    ...(cut?.[2] === undefined ? {} : { length: Number(cut[2]) }),
    unboundEmpty: /,\s*""\s*\)/.test(condition),
  };
}

/** The text a condition reading its variable as text orders the term by; null where it reads none. */
function asText(term: string | null, read: TextRead): string | null {
  const parsed = term === null ? undefined : parsedNt(term);
  let text =
    parsed === undefined || parsed.kind === BLANK
      ? null
      : Array.from(parsed.value)
          .slice(
            read.start - 1,
            read.length === undefined
              ? undefined
              : read.start - 1 + read.length,
          )
          .join("");
  if (text === null && read.unboundEmpty) text = "";
  return text;
}

/**
 * The keys the query's rows are ordered by, after its last brace: its ORDER BY's leading conditions that are a
 * projected variable, alone or in an expression of it and of no other variable, such as DESC(COALESCE(STR(?a), "")),
 * each with how it reads the variable; the conditions after them order only rows these tie. None when the query has no
 * ORDER BY there.
 */
export function finalOrder(
  text: string,
  names: readonly string[],
): OrderKey[] | undefined {
  const tail = text.slice(text.lastIndexOf("}"));
  const clause = /ORDER\s+BY\s/.exec(tail);
  if (clause === null) return undefined;
  let rest = tail.slice(clause.index + clause[0].length).trim();
  const keys: OrderKey[] = [];
  while (rest !== "") {
    let condition: string;
    const variable = /^\?(\w+)/.exec(rest);
    if (variable !== null) condition = variable[0];
    else {
      const call = /^\w+\s*\(/.exec(rest);
      if (call === null) break;
      let depth = 0;
      let at = call[0].length - 1;
      for (; at < rest.length; at += 1) {
        depth += rest[at] === "(" ? 1 : rest[at] === ")" ? -1 : 0;
        if (depth === 0) break;
      }
      condition = rest.slice(0, at + 1);
    }
    const mentioned = new Set(
      [...condition.replace(/"[^"]*"/g, "").matchAll(/\?(\w+)/g)].map(
        (found) => found[1] ?? "",
      ),
    );
    const [found] = mentioned;
    if (mentioned.size !== 1 || found === undefined || !names.includes(found))
      break;
    const read = readAsText(condition);
    keys.push({
      column: names.indexOf(found),
      ...(read === undefined ? {} : { read }),
    });
    rest = rest.slice(condition.length).trim();
  }
  return keys;
}

/** Whether an ORDER BY may put two terms either way round. */
function tied(left: string | null, right: string | null): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  const a = parsedNt(left);
  const b = parsedNt(right);
  if (a.kind !== b.kind || a.kind === IRI) return false;
  if (a.kind === BLANK) return true;
  try {
    const found = sparqlCompare(left, right);
    return found === null || found === 0;
  } catch (error) {
    if (error instanceof SqlFunctionRefused) return true;
    throw error;
  }
}

/**
 * Whether an ORDER BY of the keys puts the two rows one way round: the first key whose value differs, a text a
 * condition reads or else the term, holds two texts, or two terms SPARQL's `<` orders.
 */
function ordered(one: Row, other: Row, keys: readonly OrderKey[]): boolean {
  for (const { column, read } of keys) {
    const a = one[column] ?? null;
    const b = other[column] ?? null;
    if (read !== undefined) {
      if (asText(a, read) !== asText(b, read)) return true;
    } else if (a !== b) return !tied(a, b);
  }
  return false;
}

function runs(found: readonly Row[], keys: readonly OrderKey[]): number[] {
  const lengths = found.length > 0 ? [1] : [];
  for (let at = 0; at + 1 < found.length; at += 1)
    if (ordered(found[at] ?? [], found[at + 1] ?? [], keys)) lengths.push(1);
    else lengths.push((lengths.pop() ?? 0) + 1);
  return lengths;
}

const shown = (names: readonly string[], row: Row): string =>
  names
    .flatMap((name, at) =>
      row[at] === null || row[at] === undefined ? [] : [`?${name}=${row[at]}`],
    )
    .join(" ");

const rowKey = (row: Row): string => JSON.stringify(row);

function counted(
  rows: readonly Row[],
): Map<string, { row: Row; count: number }> {
  const found = new Map<string, { row: Row; count: number }>();
  for (const row of rows) {
    const key = rowKey(row);
    const held = found.get(key);
    if (held === undefined) found.set(key, { row, count: 1 });
    else held.count += 1;
  }
  return found;
}

/** The rows of `from` that `less` does not have, as many times as it lacks them. */
function lacking(from: readonly Row[], less: readonly Row[]): Row[] {
  const held = counted(less);
  const out: Row[] = [];
  for (const { row, count } of counted(from).values())
    for (let n = count - (held.get(rowKey(row))?.count ?? 0); n > 0; n -= 1)
      out.push(row);
  return out;
}

const written = (row: Row): string =>
  row.map((value) => value ?? "").join("\u0000");

/**
 * Why the rows found are not the rows wanted, as lines, or none: as multisets, and, given an ORDER BY's key columns,
 * as the same runs of rows those keys order, in the same order, each run a multiset.
 */
export function compared(
  names: readonly string[],
  wanted: readonly Row[],
  found: readonly Row[],
  keys?: readonly OrderKey[],
): string[] {
  const sorted = (rows: Row[]): Row[] =>
    rows.sort((a, b) =>
      written(a) < written(b) ? -1 : written(a) > written(b) ? 1 : 0,
    );
  const lines = [
    ...sorted(lacking(wanted, found)).map(
      (row) => `missing: ${shown(names, row)}`,
    ),
    ...sorted(lacking(found, wanted)).map(
      (row) => `unexpected: ${shown(names, row)}`,
    ),
  ];
  if (lines.length > 0 || keys === undefined) return lines;
  let at = 0;
  for (const length of runs(wanted, keys)) {
    const run = wanted.slice(at, at + length);
    const got = found.slice(at, at + length);
    if (lacking(run, got).length > 0) {
      const runKeys = new Set(run.map(rowKey));
      let wrong = at;
      for (let i = at; i < at + length; i += 1)
        if (!runKeys.has(rowKey(found[i] ?? []))) {
          wrong = i;
          break;
        }
      return [
        `the same rows in another order, from row ${wrong + 1}: expected ${run.map((row) => shown(names, row)).join(" or ")}, found ${shown(names, found[wrong] ?? [])}`,
      ];
    }
    at += length;
  }
  return lines;
}

const PAGED = /:page_size\b/;

/** A list question's whole list, or its page of `pageSize` entries after a key: its rows and each row's `page_key`. */
function paged(
  db: Database,
  sql: string,
  pageSize: number | null,
  after: string | null,
): { rows: Row[]; keys: (string | null)[] } {
  const { rows, keys } = sqlAnswer(db, sql, { page_size: pageSize, after });
  return { rows: [...rows], keys: [...(keys ?? rows.map(() => null))] };
}

/** The `.sql`'s answer as its `.rq`'s: a view's through its `triples` part, a list question's whole, `page_key` dropped. */
function sqlRows(
  db: Database,
  sql: string,
): { columns: readonly string[]; rows: Row[] } {
  const triples = sqlParts(sql).get("triples");
  const { columns, rows } =
    triples !== undefined
      ? sqlAnswer(db, triples)
      : PAGED.test(sql)
        ? sqlAnswer(db, sql, { page_size: null, after: null })
        : sqlAnswer(db, sql);
  return { columns, rows: [...rows] };
}

/**
 * Why a list question's pages do not give its whole list: a row with no `page_key`, keys out of order, a page of more
 * entries than its size or not after the key it was asked after, or pages of one entry and of two, each asked after the
 * last row's key, that do not join to the whole list's rows and keys in its order.
 */
function pageFailures(db: Database, sql: string): string[] {
  const whole = paged(db, sql, null, null);
  if (whole.keys.some((key) => key === null)) return ["it gives no page_key"];
  const keys = whole.keys as string[];
  const lines: string[] = [];
  if (keys.some((key, at) => at > 0 && key < (keys[at - 1] ?? "")))
    lines.push("its page keys are not in order");
  const wanted = whole.rows.map((row, at) =>
    rowKey([...row, keys[at] ?? null]),
  );
  for (const size of [1, 2]) {
    const joined: string[] = [];
    let after: string | null = null;
    let wrong: string | undefined;
    for (let asked = 0; asked <= keys.length; asked += 1) {
      const page = paged(db, sql, size, after);
      if (page.rows.length === 0) break;
      const first = page.keys[0] ?? "";
      if (
        new Set(page.keys).size > size ||
        (after !== null && first <= after)
      ) {
        wrong = `a page of ${size} after ${JSON.stringify(after)} gives the keys ${JSON.stringify(page.keys)}`;
        break;
      }
      joined.push(
        ...page.rows.map((row, at) => rowKey([...row, page.keys[at] ?? null])),
      );
      after = page.keys.at(-1) ?? null;
    }
    if (wrong !== undefined) {
      lines.push(wrong);
      continue;
    }
    if (JSON.stringify(joined) !== JSON.stringify(wanted)) {
      const at = joined.findIndex((row, i) => row !== wanted[i]);
      lines.push(
        `pages of ${size} give ${joined.length} rows, the whole list ${wanted.length}, the first apart at row ${(at < 0 ? Math.min(joined.length, wanted.length) : at) + 1}`,
      );
    }
  }
  return lines;
}

/**
 * The `.sql`'s rows asked of each record in turn, `asked` holding it alone, as a runtime asks a question bound to it;
 * a record the pod does not hold gives no rows, the `.sql` not run, since an empty `asked` is the whole pod. The
 * question is asked of the whole pod again after.
 */
function askedRows(
  db: Database,
  sql: string,
  records: readonly string[],
): Row[] {
  const found: Row[] = [];
  try {
    for (const record of records)
      if (askedOf(db, [record])) found.push(...sqlRows(db, sql).rows);
  } finally {
    askedWhole(db);
  }
  return found;
}

/** Each record the pod puts in an entry, as its IRI. */
function recordsInEntries(db: Database): string[] {
  return db
    .prepare(
      "SELECT DISTINCT t.lex FROM quad q JOIN term t ON t.id = q.s " +
        "WHERE q.p = (SELECT id FROM term WHERE nt = ?) AND t.kind = 2 ORDER BY t.lex",
    )
    .all(`<${CASCADE}inEntry>`)
    .map(({ lex }) => String(lex));
}

/** A record no pod holds, which a question bound to records is also asked of: it gives no rows. */
const NO_SUCH_RECORD = "urn:cascade:no-such-record";

interface Pinned {
  readonly boolean?: boolean;
  readonly rows?: readonly string[];
}

function srjTerm(value: {
  type: string;
  value: string;
  datatype?: string;
  "xml:lang"?: string;
}): string {
  if (value.type === "uri") return `<${value.value}>`;
  if (value.type === "literal" || value.type === "typed-literal") {
    const lang = value["xml:lang"];
    if (lang !== undefined)
      return sqlNt({
        kind: LITERAL,
        value: value.value,
        datatype: `${RDF}langString`,
        lang,
      });
    return sqlNt({
      kind: LITERAL,
      value: value.value,
      datatype: value.datatype ?? XSD_STRING,
    });
  }
  throw new Error(
    `an expected row holds a ${value.type}, which no comparison can match exactly`,
  );
}

const pinnedRow = (pairs: Iterable<readonly [string, string]>): string =>
  [...pairs]
    .map(([name, term]) => `?${name}=${term}`)
    .sort()
    .join(" ");

async function pinned(vocabulary: Files, result: string): Promise<Pinned> {
  const answer = JSON.parse(await readText(vocabulary, result)) as {
    boolean?: boolean;
    results?: { bindings: Record<string, Parameters<typeof srjTerm>[0]>[] };
  };
  if (typeof answer.boolean === "boolean") return { boolean: answer.boolean };
  return {
    rows: (answer.results?.bindings ?? []).map((binding) =>
      pinnedRow(
        Object.entries(binding).map(
          ([name, value]) => [name, srjTerm(value)] as const,
        ),
      ),
    ),
  };
}

const lensOf = (path: string | undefined): string | undefined =>
  path !== undefined && path.startsWith(LENSES) && path.endsWith(".rq")
    ? path.slice(LENSES.length, -3)
    : undefined;

/**
 * What `read` gives of the union as labels.rq reads it, before it is run: without the rdfs:label statements of the file
 * the layout says labels.rq writes, the file's other statements kept. The store is put back after.
 */
async function beforeLabels<T>(
  union: Union,
  read: (before: Union) => Promise<T>,
): Promise<T> {
  const { rows } = await union.select(
    `SELECT ?file WHERE { ?placement <${WRITTEN_BY}> "labels.rq" ; <${INSTANCE}> ?file } LIMIT 1`,
  );
  const file = rows[0]?.get("file")?.value;
  if (file === undefined) return read(union);
  const before = new RestorableUnion(union.store, union.graphs);
  try {
    const kept = await union.store.construct(
      `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${file}> { ?s ?p ?o FILTER (?p != <${LABEL}>) } }`,
      new Set(),
    );
    await before.drop(file);
    await before.add(kept, file);
    return await read(before);
  } finally {
    await before.restore();
  }
}

/**
 * Why the `.sql`, over the fixture's pod under its lens, does not give the rows of the `.rq` beside it, as lines: in a
 * whole run, in its order where it has one, a CONSTRUCT's as a set of triples and a view's through its `triples` part;
 * for a question, asked through `asked` of each record a manifest entry binds, for a list question of each record in
 * an entry, and for a `.sql` reading `asked` of a record no pod holds, against the `.rq` bound to it; through each page
 * of a list question; the rows of each manifest entry under that lens that runs it; and, for a view, its screen filled
 * keyed to each change against a whole fill. The vocabulary's tests/test_sql.py makes the same check.
 */
export async function sqlFailures(
  vocabulary: Files,
  built: BuiltFixture,
  ported: Ported,
  sql: string = ported.sql,
): Promise<string[]> {
  const { name: fixture, lens, union, db } = built;
  const where = `${fixture}, under ${lens}, ${ported.rq}`;
  const screen = built.screens.get(ported.rq);
  if (screen !== undefined) return [`${where}: ${screen}`];
  const construct = isConstruct(ported.rqText);
  const wanted =
    ported.rq === LABELS && sqlParts(sql).size > 0
      ? await beforeLabels(union, (before) => rqAnswer(before, ported.rqText))
      : await rqAnswer(union, ported.rqText);
  let found: { columns: readonly string[]; rows: Row[] };
  try {
    found = sqlRows(db, sql);
  } catch (error) {
    return [
      `${where}: the .sql fails: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  const { names } = wanted;
  if (found.columns.join(" ") !== names.join(" "))
    return [
      `${where}: the .sql gives the columns ${found.columns.join(", ")}, the .rq ${names.join(", ")}`,
    ];
  const against = (
    said: string,
    want: readonly Row[],
    got: readonly Row[],
  ): string[] => {
    const unique = (rows: readonly Row[]): Row[] =>
      [...counted(rows).values()].map(({ row }) => row);
    const lines = construct
      ? compared(names, unique(want), unique(got))
      : compared(names, want, got, finalOrder(ported.rqText, names));
    return lines.map((line) => `${where}, ${said}: ${line}`);
  };
  const lines = against("against the .rq", wanted.rows, found.rows);
  if (!construct && PAGED.test(sql))
    lines.push(...pageFailures(db, sql).map((line) => `${where}: ${line}`));
  const bound = new Set(
    construct ? [] : built.entries.flatMap((entry) => entry.records),
  );
  if (!construct && PAGED.test(sql))
    for (const record of recordsInEntries(db)) bound.add(record);
  if (!construct && /\basked\b/.test(sql)) bound.add(NO_SUCH_RECORD);
  for (const record of [...bound].sort())
    lines.push(
      ...against(
        `keyed to ${record}, against the .rq`,
        (await rqAnswer(union, ported.rqText, record)).rows,
        askedRows(db, sql, [record]),
      ),
    );
  for (const entry of built.entries) {
    if (entry.query !== ported.rq) continue;
    if (entry.result === undefined) {
      lines.push(
        `${fixture}, ${entry.name}: it runs ${ported.rq} and pins no mf:result`,
      );
      continue;
    }
    const entryLens = lensOf(entry.lens);
    if (entryLens === undefined) {
      lines.push(
        `${fixture}, ${entry.name}: ${entry.lens ?? "no lens"} is no lens's query file`,
      );
      continue;
    }
    if (entryLens !== lens) continue;
    const pins = await pinned(vocabulary, entry.result);
    const given =
      entry.records.length > 0 ? askedRows(db, sql, entry.records) : found.rows;
    if (pins.boolean !== undefined) {
      if (given.length > 0 !== pins.boolean)
        lines.push(
          `${fixture}, ${entry.name}: expected ${pins.boolean}, found ${given.length > 0}`,
        );
      continue;
    }
    const rows = given.map((row) =>
      pinnedRow(
        names.flatMap((name, at) =>
          row[at] === null ? [] : [[name, row[at] ?? ""] as const],
        ),
      ),
    );
    const want = (pins.rows ?? []).map((row) => [row]);
    const got = rows.map((row) => [row]);
    for (const [kind, side] of [
      ["missing", lacking(want, got)],
      ["unexpected", lacking(got, want)],
    ] as const)
      for (const [row] of side.sort((a, b) =>
        (a[0] ?? "") < (b[0] ?? "") ? -1 : 1,
      ))
        lines.push(
          `${fixture}, ${entry.name}, under ${lens}, ${ported.rq}: ${kind}: ${row}`,
        );
  }
  for (const line of built.keyedFill?.get(ported.rq) ?? [])
    lines.push(`${where}, filled keyed: ${line}`);
  return lines;
}

/** The check's own context, read once: the build, the schema, the functions and the ported queries. */
export async function sqlCheckContext(
  options: SqlCheckOptions,
): Promise<Context> {
  return {
    ...options,
    build: await vocabularyBuild(options.vocabulary, options.layout),
    schema: await readText(options.vocabulary, STATEMENTS_SCHEMA),
    functions: await sqlDatabaseFunctions(),
    ported: await portedQueries(options.vocabulary),
  };
}

/** The fixture built under the lens and loaded, for `sqlFailures`; closed by the caller. */
export function fixtureBuilt(
  context: Context,
  fixture: string,
  lens: string,
): Promise<BuiltFixture> {
  return builtFixture(context, fixture, lens);
}

/**
 * The test a `.sql` over a fixture under a lens is: the `.sql`, and in its fragment the `.sql` again, the fixture and the
 * lens, so a report that shows a test by its fragment alone names the query.
 */
export const sqlTest = (
  vocabulary: Files,
  ported: Pick<Ported, "rq">,
  fixture: string,
  lens: string,
): string =>
  `${vocabulary.iri}${encodeURI(sqlPath(ported.rq))}#${encodeURI(sqlPath(ported.rq))}/${fixture}/${lens}`;

/**
 * One assertion for each fixture, each `.sql` and each lens: that the `.sql`, over the fixture as the runtime builds it
 * under the lens and loads it into SQLite, gives the rows its `.rq` gives and those the fixture's manifest pins.
 */
export async function sqlCheckAssertions(
  options: SqlCheckOptions,
  fixtures?: readonly string[],
  /** A `.sql`'s text to check in place of the vocabulary's, by its `.rq`'s path. */
  given: Readonly<Record<string, string>> = {},
): Promise<Assertion[]> {
  if ((await options.vocabulary.read(STATEMENTS_SCHEMA)) === undefined)
    return [];
  const context = await sqlCheckContext(options);
  if (context.ported.length === 0) return [];
  const assertions: Assertion[] = [];
  for (const fixture of fixtures ?? (await fixtureNames(options.vocabulary)))
    for (const lens of await lenses(options.vocabulary)) {
      let built: BuiltFixture | undefined;
      let why: string | undefined;
      try {
        built = await builtFixture(context, fixture, lens);
      } catch (error) {
        why = `${fixture}, under ${lens}: the runtime's build or the load fails: ${error instanceof Error ? error.message : String(error)}`;
      }
      try {
        for (const ported of context.ported) {
          let lines: string[];
          try {
            lines =
              built === undefined
                ? [why ?? ""]
                : await sqlFailures(
                    options.vocabulary,
                    built,
                    ported,
                    given[ported.rq],
                  );
          } catch (error) {
            lines = [
              `${fixture}, under ${lens}, ${ported.rq}: ${error instanceof Error ? error.message : String(error)}`,
            ];
          }
          assertions.push({
            test: sqlTest(options.vocabulary, ported, fixture, lens),
            name: `${ported.rq.slice(0, -3)}.sql over ${fixture} under ${lens}`,
            outcome: lines.length === 0 ? "passed" : "failed",
            ...(lines.length === 0 ? {} : { why: lines.join("\n") }),
          });
        }
      } finally {
        built?.close();
      }
    }
  return assertions;
}

/** The test of a function against its vectors. */
export const sqlFunctionTest = (vocabulary: Files, name: string): string =>
  `${vocabulary.iri}${SQL_FUNCTION_VECTORS}#${name}`;

interface Vector {
  readonly input: readonly unknown[];
  readonly output?: unknown;
  readonly refused?: string;
}

/** Each vector of the function whose output the TypeScript function does not give, or that it does not refuse. */
export function vectorFailures(
  apply: ((...values: unknown[]) => unknown) | undefined,
  vectors: readonly Vector[],
): string[] {
  return vectors.flatMap((vector) => {
    const wanted = vector.refused !== undefined ? "refused" : vector.output;
    let got: unknown;
    if (apply === undefined) got = "no such function";
    else
      try {
        got = apply(...vector.input);
      } catch (error) {
        got =
          error instanceof SqlFunctionRefused
            ? "refused"
            : `throws ${String(error)}`;
      }
    return got === wanted
      ? []
      : [
          `${JSON.stringify(vector.input)}: expected ${JSON.stringify(wanted)}, gives ${JSON.stringify(got)}`,
        ];
  });
}

/** One assertion for each function the vectors name: that it gives each vector's output and refuses each refused one. */
export async function sqlFunctionAssertions(
  vocabulary: Files,
): Promise<Assertion[]> {
  const bytes = await vocabulary.read(SQL_FUNCTION_VECTORS);
  if (bytes === undefined) return [];
  const { functions } = JSON.parse(new TextDecoder().decode(bytes)) as {
    functions: Record<string, { vectors: Vector[] }>;
  };
  const implemented = await sqlFunctions();
  return Object.entries(functions)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, { vectors }]) => {
      const lines = vectorFailures(implemented[name], vectors);
      return {
        test: sqlFunctionTest(vocabulary, name),
        name: `${name} gives each vector's output`,
        outcome: lines.length === 0 ? "passed" : "failed",
        ...(lines.length === 0 ? {} : { why: lines.join("\n") }),
      };
    });
}
