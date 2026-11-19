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
  type GraphStatements,
  keyedScope,
  loadStatements,
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
import { type Store, type StoreFactory, Union } from "./store.js";

/** The address a fixture's files are read under, as the vocabulary's tests read them. */
export const FIXTURE_ADDRESS = "https://pod.example/";
export const FIXTURES = "tests/fixtures/";
const QUERIES = "queries/";
const MATCHER = "queries/matcher/";
const LENSES = "queries/lenses/";
const MF = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#";
const QT = "http://www.w3.org/2001/sw/DataAccess/tests/test-query#";
const CTM = "https://ns.cascadeprotocol.org/test-manifest#";
const SPECIALIZATION_OF = "http://www.w3.org/ns/prov#specializationOf";
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
const PAGE_KEY = "page_key";
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
  /** Why the screens of the ported views could not be made, if they could not. */
  readonly screens?: string;
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

/** The graphs a store's dump holds, each block of it the N-Triples Oxigraph writes of a graph, those `kept` names. */
function graphsOfDump(
  bytes: Uint8Array,
  kept: ReadonlySet<string>,
): GraphStatements[] {
  const lines = new TextDecoder().decode(bytes).split("\n").slice(1);
  const found: GraphStatements[] = [];
  let graph: string | undefined;
  let held: string[] = [];
  for (const line of lines) {
    if (graph === undefined) {
      graph = /^<(.*)> \{$/.exec(line)?.[1];
      held = [];
    } else if (line === "}") {
      if (kept.has(graph)) found.push({ graph, ntriples: held.join("\n") });
      graph = undefined;
    } else held.push(line);
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
    } catch (error) {
      db.close();
      throw error;
    }
    let screens: string | undefined;
    try {
      const views = context.ported
        .map(({ sql }) => sqlParts(sql))
        .filter((parts) => parts.size > 0);
      for (const part of SCREEN_PARTS)
        for (const parts of views) db.exec(parts.get(part) ?? "");
    } catch (error) {
      screens = `the screens fail: ${error instanceof Error ? error.message : String(error)}`;
    }
    return {
      name: fixture,
      lens,
      union,
      db,
      entries: await manifestEntries(vocabulary, fixture, store),
      ...(screens === undefined ? {} : { screens }),
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

const ORDER_CONDITION =
  /^\s*(?:(?:ASC|DESC)\s*\(\s*\?(\w+)\s*\)|\?(\w+))(?![\w(])/i;

/**
 * The indexes of the columns the query's rows are ordered by, after its last brace: its ORDER BY's leading conditions
 * that are a projected variable; none when it has no ORDER BY there.
 */
export function finalOrder(
  text: string,
  names: readonly string[],
): number[] | undefined {
  const tail = text.slice(text.lastIndexOf("}"));
  const clause = /ORDER\s+BY\s/.exec(tail);
  if (clause === null) return undefined;
  let rest = tail.slice(clause.index + clause[0].length);
  const keys: number[] = [];
  for (
    let condition = ORDER_CONDITION.exec(rest);
    condition !== null;
    condition = ORDER_CONDITION.exec(rest)
  ) {
    const variable = condition[1] ?? condition[2] ?? "";
    if (!names.includes(variable)) break;
    keys.push(names.indexOf(variable));
    rest = rest.slice(condition[0].length);
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

function runs(found: readonly Row[], keys: readonly number[]): number[] {
  const lengths = found.length > 0 ? [1] : [];
  for (let at = 0; at + 1 < found.length; at += 1) {
    const one = found[at] ?? [];
    const other = found[at + 1] ?? [];
    const key = keys.find((k) => one[k] !== other[k]);
    if (key === undefined || tied(one[key] ?? null, other[key] ?? null))
      lengths.push((lengths.pop() ?? 0) + 1);
    else lengths.push(1);
  }
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
  keys?: readonly number[],
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

/** A list question's whole list, or its page after a key, its trailing `page_key` kept. */
function paged(
  db: Database,
  sql: string,
  pageSize: number | null,
  after: string | null,
) {
  return sqlAnswer(db, sql, { page_size: pageSize, after });
}

/** The `.sql`'s answer as its `.rq`'s: a view's through its `triples` part, a list question's whole, `page_key` dropped. */
function sqlRows(
  db: Database,
  sql: string,
): { columns: readonly string[]; rows: Row[] } {
  const triples = sqlParts(sql).get("triples");
  if (triples !== undefined) {
    const { columns, rows } = sqlAnswer(db, triples);
    return { columns, rows: [...rows] };
  }
  if (!PAGED.test(sql)) {
    const { columns, rows } = sqlAnswer(db, sql);
    return { columns, rows: [...rows] };
  }
  const { columns, rows } = paged(db, sql, null, null);
  const kept =
    columns.at(-1) === PAGE_KEY ? columns.length - 1 : columns.length;
  return {
    columns: columns.slice(0, kept),
    rows: rows.map((row) => row.slice(0, kept)),
  };
}

/** Why pages of one entry and of two, each asked after the last row's `page_key`, do not join to the whole list. */
function pageFailures(db: Database, sql: string): string[] {
  const whole = paged(db, sql, null, null);
  const lines: string[] = [];
  for (const size of [1, 2]) {
    const joined: Row[] = [];
    let after: string | null = null;
    for (let asked = 0; asked <= whole.rows.length; asked += 1) {
      const { rows } = paged(db, sql, size, after);
      if (rows.length === 0) break;
      joined.push(...rows);
      after = rows.at(-1)?.at(-1) ?? null;
    }
    const same =
      joined.length === whole.rows.length &&
      joined.every((row, at) => rowKey(row) === rowKey(whole.rows[at] ?? []));
    if (!same)
      lines.push(
        `pages of ${size} ${size === 1 ? "entry" : "entries"} joined give ${joined.length} rows, not the whole list's ${whole.rows.length} in its order`,
      );
  }
  return lines;
}

function scopedRows(
  db: Database,
  sql: string,
  records: readonly string[],
): Row[] {
  const found: Row[] = [];
  try {
    for (const record of records) {
      keyedScope(db, [record]);
      found.push(...sqlRows(db, sql).rows);
    }
  } finally {
    wholeScope(db);
  }
  return found;
}

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
 * Why the `.sql`, over the fixture's pod under its lens, does not give the rows of the `.rq` beside it, as lines: in a
 * whole run, in its order where it has one, a CONSTRUCT's as a set of triples and a view's through its `triples` part;
 * in a keyed run of each record a manifest entry binds, for a question; through each page of a list question; and the
 * rows of each manifest entry under that lens that runs it. The vocabulary's tests/test_sql.py makes the same check.
 */
export async function sqlFailures(
  vocabulary: Files,
  built: BuiltFixture,
  ported: Ported,
  sql: string = ported.sql,
): Promise<string[]> {
  const { name: fixture, lens, union, db } = built;
  const where = `${fixture}, under ${lens}, ${ported.rq}`;
  if (built.screens !== undefined) return [`${where}: ${built.screens}`];
  const construct = isConstruct(ported.rqText);
  const wanted = await rqAnswer(union, ported.rqText);
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
  const records = construct
    ? []
    : [...new Set(built.entries.flatMap((entry) => entry.records))].sort();
  for (const record of records)
    lines.push(
      ...against(
        `keyed to ${record}, against the .rq`,
        (await rqAnswer(union, ported.rqText, record)).rows,
        scopedRows(db, sql, [record]),
      ),
    );
  for (const entry of built.entries) {
    if (entry.query !== ported.rq || entry.result === undefined) continue;
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
      entry.records.length > 0
        ? scopedRows(db, sql, entry.records)
        : found.rows;
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

/** The test a `.sql` over a fixture under a lens is: the `.sql`, the fixture and the lens its fragment. */
export const sqlTest = (
  vocabulary: Files,
  ported: Pick<Ported, "rq">,
  fixture: string,
  lens: string,
): string =>
  `${vocabulary.iri}${encodeURI(`${ported.rq.slice(0, -3)}.sql`)}#${fixture}/${lens}`;

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
  const { functions } = JSON.parse(
    await readText(vocabulary, SQL_FUNCTION_VECTORS),
  ) as {
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
