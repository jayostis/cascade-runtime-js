import { boundToRecords } from "./bound-records.js";
import { derivationsOf, type Keep, QUERIES } from "./derive.js";
import type { Files } from "./files.js";
import { Graph } from "./graph.js";
import { podFiles } from "./dataset.js";
import {
  assertionName,
  byCodePoint,
  claimName,
  documentName,
  findingName,
  inUtc,
  retractionName,
} from "./names.js";
import { codeIri, iri, literal, ntriples, RDF, type Triple } from "./rdf.js";
import { type References, tableTerms, type TableTerms } from "./references.js";
import { CASCADE, Refusal, type StepContext } from "./step.js";
import { type Dataset, type Row, Union } from "./store.js";

const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const DCT = "http://purl.org/dc/terms/";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const OA = "http://www.w3.org/ns/oa#";
const TYPE = `${RDF}type`;
/** The graph holding the descriptions of the versions a comparison reads and of their series, and no others. */
const DESCRIBED = "urn:cascade:references";
const PREFIXES = `PREFIX cascade: <${CASCADE}> PREFIX prov: <${PROV}> PREFIX pav: <${PAV}> PREFIX dct: <${DCT}> PREFIX oa: <${OA}>`;
const NO_LONGER_REACHED = `${CASCADE}ClaimsNoLongerReached`;
const THIS_FINDING = "urn:cascade:this-finding";

export const MATCHER = `${CASCADE}CascadeMatcher`;
export const MATCHER_LENS = "everyday";
const LENS = MATCHER_LENS;
const COMPARISONS = `${QUERIES}matcher/`;

export interface MatcherRule {
  /** The matcher rule term the row names. */
  readonly term: string;
  readonly justification: string;
  /** The record classes it compares. */
  readonly appliesTo: ReadonlySet<string>;
  readonly query: string;
  /** The name of the query's bytes, which the rule's claims are asserted with. */
  readonly hash: string;
  readonly kind?: string;
  /** Whether the rule files findings for review of the kind `justification` names rather than judgments (R16, R17). */
  readonly finding?: boolean;
}

interface TakenRecord {
  readonly name: string;
  readonly classes: ReadonlySet<string>;
  readonly version: string;
  readonly arrived: readonly [string, string];
  /** The act that generated each of its first revisions. */
  readonly activities: readonly string[];
  /** For a server, the act that generated each of its revisions, first or later: a reconnect takes it (M1). */
  readonly revisedBy: readonly string[];
}

/**
 * The acts whose records a run takes: those with a first revision from any of them, and servers with any revision from
 * one, or, for a sync's run, every one (M1).
 */
interface Takes {
  readonly acts: ReadonlySet<string>;
  readonly all: boolean;
}

function taken(record: TakenRecord, takes: Takes): boolean {
  return takes.all
    ? record.activities.length > 0 &&
        record.activities.every((act) => takes.acts.has(act))
    : [...record.activities, ...record.revisedBy].some((act) =>
        takes.acts.has(act),
      );
}

/** The path a rule's query names under `queries/`, when it resolves inside `matcher/` and holds no backslash. */
function comparison(query: string): string | undefined {
  if (query.includes("\\") || /^(\/|[a-z][a-z0-9+.-]*:)/i.test(query))
    return undefined;
  const parts = QUERIES.split("/").filter((part) => part !== "");
  for (const part of query.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.pop() === undefined) return undefined;
  }
  const path = parts.join("/");
  return path.startsWith(COMPARISONS) ? path : undefined;
}

/** The rules a version of the rule list holds, each checked to name a comparison whose bytes hash to its hash (M11). */
export async function matcherRules(
  rows: Graph,
  vocabulary: Files,
): Promise<{ rule: MatcherRule; text: string }[]> {
  const found: { rule: MatcherRule; text: string }[] = [];
  for (const row of rows.subjects(TYPE, iri(`${CASCADE}RuleListRow`))) {
    const one = (predicate: string): string => {
      const values = rows.objects(row, `${CASCADE}${predicate}`);
      if (values.length !== 1)
        throw new Refusal(
          `a rule of the rule list gives ${values.length} cascade:${predicate}, not one`,
        );
      return values[0]?.value ?? "";
    };
    const term = one("matcherRule");
    const said = [
      ...rows.objects(row, `${CASCADE}justifiedAs`),
      ...rows.objects(row, `${CASCADE}findingKind`),
    ];
    if (said.length !== 1)
      throw new Refusal(
        `a rule of the rule list gives ${said.length} cascade:justifiedAs and cascade:findingKind, not one`,
      );
    const justification = said[0]?.value ?? "";
    const finding = rows.objects(row, `${CASCADE}findingKind`).length > 0;
    const query = one("queryPath");
    const expected = one("queryHash");
    const path = comparison(query);
    if (path === undefined)
      throw new Refusal(
        `the rule for ${justification} names ${query}, which is not under matcher/`,
      );
    const bytes = await vocabulary.read(path);
    if (bytes === undefined || (await documentName(bytes)) !== expected)
      throw new Refusal(
        `${query} does not hash to ${expected}, as the rule for ${justification} says it does`,
      );
    const kinds = rows.objects(row, `${CASCADE}tableKind`);
    if (kinds.length > 1)
      throw new Refusal(
        `the rule for ${justification} reads ${kinds.length} table kinds, not one`,
      );
    found.push({
      rule: {
        term,
        justification,
        appliesTo: new Set(
          rows
            .objects(row, `${CASCADE}appliesToClass`)
            .map(({ value }) => value),
        ),
        query: path,
        hash: expected,
        ...(kinds[0] === undefined ? {} : { kind: kinds[0].value }),
        ...(finding ? { finding } : {}),
      },
      text: new TextDecoder().decode(bytes),
    });
  }
  const justifications = new Set(found.map(({ rule }) => rule.justification));
  if (justifications.size !== found.length)
    throw new Refusal("two rules of the rule list give one justification");
  return found.sort((a, b) =>
    a.rule.justification < b.rule.justification ? -1 : 1,
  );
}

/** The origins whose rows join each ordered pair under the rule, each one of the origins it may cite: "" for a rule that reads no table (M5). */
export function joined(
  rule: MatcherRule,
  rows: readonly Row[],
  origins: ReadonlySet<string>,
): Map<string, Set<string>> {
  const pairs = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = pair(row.get("record")?.value, row.get("other")?.value);
    const origin = row.get("origin")?.value ?? "";
    if (!origins.has(origin))
      throw new Refusal(
        `the rule for ${rule.justification} joins ${key} by ${origin === "" ? "no table" : origin}, not by a table version it reads`,
      );
    pairs.set(key, new Set([...(pairs.get(key) ?? []), origin]));
  }
  return pairs;
}

async function column(
  dataset: Dataset,
  query: string,
  ...names: string[]
): Promise<(string | undefined)[][]> {
  const { rows } = await dataset.select(`${PREFIXES} ${query}`);
  return rows.map((row) => names.map((name) => row.get(name)?.value));
}

function grouped(
  rows: readonly (string | undefined)[][],
): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [key, value] of rows) {
    if (key === undefined || value === undefined) continue;
    found.set(key, [...(found.get(key) ?? []), value]);
  }
  return found;
}

/** A time's place in time order: its seconds in UTC, then the digits of any fraction of a second. */
export function arrival(moment: string): [string, string] {
  let utc: string;
  try {
    utc = inUtc(moment);
  } catch (error) {
    throw new Refusal(
      `a first revision's time: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const [whole = "", fraction = ""] = utc.slice(0, -1).split(".");
  return [whole, fraction];
}

function byArrival(a: TakenRecord, b: TakenRecord): number {
  const [x, y] = [
    [...a.arrived, a.name],
    [...b.arrived, b.name],
  ];
  for (let index = 0; index < x.length; index++) {
    const [p = "", q = ""] = [x[index], y[index]];
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

interface FirstRevision {
  readonly at: string | undefined;
  readonly activities: readonly string[];
}

function takenRecord(
  name: string,
  classes: Iterable<string>,
  version: string | undefined,
  firsts: readonly FirstRevision[],
  revisedBy: readonly string[],
): TakenRecord {
  if (
    firsts.length === 0 ||
    version === undefined ||
    firsts.some(({ at }) => at === undefined)
  )
    throw new Refusal(`${name} has no first revision and current version`);
  const [earliest = arrival(""), ...later] = firsts.map(({ at }) =>
    arrival(at as string),
  );
  return {
    name,
    classes: new Set(classes),
    version,
    arrived: later.reduce(
      (soonest, at) =>
        at[0] < soonest[0] || (at[0] === soonest[0] && at[1] < soonest[1])
          ? at
          : soonest,
      earliest,
    ),
    activities: [...new Set(firsts.flatMap(({ activities }) => activities))],
    revisedBy,
  };
}

/** The subject's records, each with its kind, current version and first revisions. */
async function subjectRecords(
  dataset: Dataset,
  subject: string,
): Promise<TakenRecord[]> {
  const theirs = `?record a cascade:Record ; cascade:subject <${subject}> .`;
  const records = await column(
    dataset,
    `SELECT DISTINCT ?record WHERE { ${theirs} }`,
    "record",
  );
  const classes = grouped(
    await column(
      dataset,
      `SELECT DISTINCT ?record ?class WHERE { ${theirs} ?record a ?class }`,
      "record",
      "class",
    ),
  );
  const versions = grouped(
    await column(
      dataset,
      `SELECT DISTINCT ?record ?version WHERE { ${theirs} ?record pav:hasCurrentVersion ?version }`,
      "record",
      "version",
    ),
  );
  const firsts = grouped(
    await column(
      dataset,
      `SELECT DISTINCT ?record ?first WHERE { ${theirs} ?first cascade:revisionOf ?record FILTER NOT EXISTS { ?first prov:wasRevisionOf ?earlier } }`,
      "record",
      "first",
    ),
  );
  const times = grouped(
    await column(
      dataset,
      `SELECT DISTINCT ?first ?at WHERE { ${theirs} ?first cascade:revisionOf ?record ; prov:generatedAtTime ?at }`,
      "first",
      "at",
    ),
  );
  const activities = grouped(
    await column(
      dataset,
      `SELECT DISTINCT ?first ?activity WHERE { ${theirs} ?first cascade:revisionOf ?record ; prov:wasGeneratedBy ?activity }`,
      "first",
      "activity",
    ),
  );
  return records.flatMap(([name]) =>
    name === undefined
      ? []
      : [
          takenRecord(
            name,
            classes.get(name) ?? [],
            versions.get(name)?.[0],
            (firsts.get(name) ?? []).map((revision) => ({
              at: times.get(revision)?.[0],
              activities: activities.get(revision) ?? [],
            })),
            [],
          ),
        ],
  );
}

/** Each server's record with a version, from one query, since a pod holds few; every revision's act is kept (M1). */
async function serverRecords(dataset: Dataset): Promise<TakenRecord[]> {
  const rows = await column(
    dataset,
    `SELECT DISTINCT ?record ?class ?version ?revision ?earlier ?at ?activity WHERE {
      ?record a cascade:Server ; pav:hasCurrentVersion ?version ; a ?class .
      OPTIONAL { ?revision cascade:revisionOf ?record
        OPTIONAL { ?revision prov:wasRevisionOf ?earlier }
        OPTIONAL { ?revision prov:generatedAtTime ?at }
        OPTIONAL { ?revision prov:wasGeneratedBy ?activity } } }`,
    "record",
    "class",
    "version",
    "revision",
    "earlier",
    "at",
    "activity",
  );
  interface Revision {
    first: boolean;
    at: string | undefined;
    readonly activities: Set<string>;
  }
  const servers = new Map<
    string,
    {
      readonly classes: Set<string>;
      version: string | undefined;
      readonly revisions: Map<string, Revision>;
    }
  >();
  for (const [record, kind, version, revision, earlier, at, activity] of rows) {
    if (record === undefined) continue;
    const server = servers.get(record) ?? {
      classes: new Set<string>(),
      version,
      revisions: new Map<string, Revision>(),
    };
    servers.set(record, server);
    if (kind !== undefined) server.classes.add(kind);
    if (revision === undefined) continue;
    const found = server.revisions.get(revision) ?? {
      first: true,
      at,
      activities: new Set<string>(),
    };
    server.revisions.set(revision, found);
    if (earlier !== undefined) found.first = false;
    if (activity !== undefined) found.activities.add(activity);
  }
  return [...servers].map(([name, { classes, version, revisions }]) => {
    const all = [...revisions.values()];
    return takenRecord(
      name,
      classes,
      version,
      all
        .filter(({ first }) => first)
        .map(({ at, activities }) => ({ at, activities: [...activities] })),
      [...new Set(all.flatMap(({ activities }) => [...activities]))],
    );
  });
}

/**
 * The records the matcher takes (M2), by name: the pod's subject's, if it has one, and each server's with a version,
 * each with its kind, current version and first revisions' arrival.
 */
async function takenRecords(
  dataset: Dataset,
): Promise<Map<string, TakenRecord>> {
  const subjects = await column(
    dataset,
    "SELECT DISTINCT ?subject WHERE { ?subject a cascade:Subject }",
    "subject",
  );
  if (subjects.length > 1)
    throw new Refusal(`the pod holds ${subjects.length} subjects, not one`);
  const subject = subjects[0]?.[0];
  const records = [
    ...(subject === undefined ? [] : await subjectRecords(dataset, subject)),
    ...(await serverRecords(dataset)),
  ];
  return new Map(records.map((record) => [record.name, record]));
}

/**
 * The matcher's view: each RDF file of the pod but those the build writes, and the everyday lens's derived state, the
 * union of a new store; with `keep`, the Sames M7 leaves as they were count on.
 */
export async function matcherView(
  context: Pick<
    StepContext,
    "layout" | "pod" | "address" | "vocabulary" | "newStore"
  >,
  keep?: Keep,
): Promise<Union> {
  const union = new Union(context.newStore());
  await podFiles(context.pod, context.layout, context.address, union);
  await (await derivationsOf(context.vocabulary)).derive(union, LENS, keep);
  return union;
}

/** What the matcher reads of the pod and its derived state, before any table's rows are added to it. */
interface Pod {
  readonly held: ReadonlySet<string>;
  /** The members of each Same that counts under the lens before the run. */
  readonly sames: readonly (readonly string[])[];
  /** Each ordered pair of records that are currently different. */
  readonly different: ReadonlySet<string>;
  /** The entry each of the subject's records is in, as the derived state the run reads gives it. */
  readonly entryOf: ReadonlyMap<string, string>;
  /** The matcher's claims retracted, or replaced by a judgment not itself retracted. */
  readonly withdrawn: ReadonlySet<string>;
  /**
   * The query hashes each claim is asserted with: those of its rule's row in each version it is asserted under, by an
   * assertion no retraction invalidates (N15).
   */
  readonly asserted: ReadonlyMap<string, ReadonlySet<string>>;
  readonly records: ReadonlyMap<string, TakenRecord>;
  readonly judgments: readonly Judged[];
  readonly revised: ReadonlySet<string>;
  /** Each ordered pair of members of a retracted matcher Same. */
  readonly retracted: ReadonlySet<string>;
  /** Each rule list version a finding of the claims it no longer reaches names. */
  readonly noLongerReachedUnder: ReadonlySet<string>;
  /** Each claim a finding of claims no longer reached names. */
  readonly namedByFinding: ReadonlySet<string>;
  /** Each finding for review the pod holds, by its name. */
  readonly findings: ReadonlySet<string>;
  /** The query hash of each matcher rule's row, by the rule list version whose rows the pod describes. */
  readonly ruleHashes: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/**
 * Every code a current version of the pod's records may join a table by: each IRI it states under a code system's URI
 * space, and each literal it states as the IRI of that code in each URI space.
 */
export async function podCodes(
  union: Dataset,
  { uriSpaces }: TableTerms,
): Promise<Set<string>> {
  const { rows } = await union.select(
    `${PREFIXES} SELECT DISTINCT ?value WHERE { ?record pav:hasCurrentVersion ?version . ?version ?property ?value }`,
  );
  const codes = new Set<string>();
  for (const row of rows) {
    const value = row.get("value");
    if (value?.termType === "Literal")
      for (const space of uriSpaces) codes.add(codeIri(space, value.value));
    else if (
      value?.termType === "NamedNode" &&
      uriSpaces.some((space) => value.value.startsWith(space))
    )
      codes.add(value.value);
  }
  return codes;
}

/** For each rule's justification, the origins that join each pair: "" for a rule that reads no table. */
type Joins = ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;

/** The version of each series the pod names as current, by series. */
export async function namedVersions(
  union: Dataset,
): Promise<Map<string, string[]>> {
  return grouped(
    await column(
      union,
      "SELECT DISTINCT ?series ?version WHERE { ?series a cascade:ReferenceSeries ; pav:hasCurrentVersion ?version }",
      "series",
      "version",
    ),
  );
}

/**
 * What the rules' queries join, given each query's rows, each rule citing the versions of its kind loaded, and keeping
 * only the origins given.
 */
async function joins(
  rowsOf: (query: string) => Promise<readonly Row[]>,
  found: readonly { rule: MatcherRule; text: string }[],
  loaded: ReadonlyMap<string, ReadonlySet<string>>,
  kept: ReadonlySet<string>,
): Promise<Joins> {
  const all = new Map<string, Map<string, Set<string>>>();
  for (const { rule, text } of found) {
    const rows = await rowsOf(text);
    const pairs = new Map<string, Set<string>>();
    for (const [key, origins] of joined(
      rule,
      rows,
      rule.kind === undefined
        ? new Set([""])
        : (loaded.get(rule.kind) ?? new Set()),
    )) {
      const cited = [...origins].filter((origin) => kept.has(origin));
      if (cited.length > 0) pairs.set(key, new Set(cited));
    }
    all.set(rule.justification, pairs);
  }
  return all;
}

/** The matcher's procedure, M1 to M11, and O1, over the pod as the steps before this one left it. */
class Matcher {
  /** The reference descriptions the run writes after all its judgments, by path (W1). */
  readonly #descriptions = new Map<string, Uint8Array>();
  /** The Sames the run has written, which its recheck and its new joins may both give. */
  readonly #filed = new Set<string>();
  #sames?: (readonly string[])[];

  /** The members of each Same that counts: the pod's, then each the run files. */
  private get sames(): (readonly string[])[] {
    this.#sames ??= [...this.pod.sames];
    return this.#sames;
  }

  private constructor(
    readonly context: StepContext,
    readonly references: References,
    readonly pod: Pod,
    readonly rulesVersion: string,
    readonly rules: readonly MatcherRule[],
    readonly current: (series: string) => string | undefined,
    readonly matched: Joins,
    readonly fresh: Joins,
    readonly findings: readonly MatcherRule[] = [],
  ) {}

  /**
   * The matcher over the pod and the tables. Given what an open adopts, by series, those versions are current, and
   * `fresh` holds the joins the pod's own rule list and versions do not make (O1). Given the acts whose records a run
   * takes, each comparison is evaluated with ?record bound to the records they began (M1, M4). The rule list the
   * pod names is evaluated over the versions it names, and the current one over the current versions, each with those
   * versions' descriptions alone and none of the pod's, so neither reads the other's rows and no version the pod
   * describes but the tables do not load revises one they do (M13, O1). It consumes the matcher's view it is given: it
   * takes the view out of what the pod keeps and swaps its graphs, so it is never read again.
   */
  static async of(
    context: StepContext,
    references: References,
    adopted?: ReadonlyMap<string, string>,
    takes?: Takes,
  ): Promise<Matcher> {
    const union = await context.matcherView();
    const named = await namedVersions(union);
    const current = (series: string): string | undefined =>
      adopted?.get(series) ??
      references.current(series, named.get(series) ?? []);
    const pod = await read(union, references);
    const bound =
      takes === undefined
        ? undefined
        : [...pod.records.values()].flatMap((record) =>
            taken(record, takes) ? [record.name] : [],
          );
    const rulesVersion = current(await references.ruleList());
    const none: Joins = new Map();
    if (rulesVersion === undefined)
      return new Matcher(context, references, pod, "", [], current, none, none);
    const found = await matcherRules(
      new Graph(await references.rows(rulesVersion)),
      context.vocabulary,
    );
    const rules = found.flatMap(({ rule }) => (rule.finding ? [] : [rule]));
    const findings = found.flatMap(({ rule }) => (rule.finding ? [rule] : []));
    const kinds = new Set(found.flatMap(({ rule: { kind } }) => kind ?? []));
    const versions = [
      ...new Set(
        [...kinds]
          .flatMap((kind) => references.seriesOfKind(kind))
          .flatMap((series) => current(series) ?? []),
      ),
    ];
    const before = (version: string): string | undefined => {
      if (version === "") return "";
      const series = references.seriesOf(version) ?? "";
      const [was, ...others] = named.get(series) ?? [];
      return was !== undefined &&
        others.length === 0 &&
        references.seriesOf(was) === series
        ? was
        : undefined;
    };
    const rulesBefore = before(rulesVersion);
    if (
      adopted !== undefined &&
      adopted.size === 0 &&
      rulesBefore === rulesVersion &&
      versions.every((version) => before(version) === version)
    )
      return new Matcher(
        context,
        references,
        pod,
        rulesVersion,
        rules,
        current,
        none,
        none,
        findings,
      );
    const versionsBefore =
      adopted === undefined
        ? []
        : versions.flatMap((version) => before(version) ?? []);
    const loaded = new Map(
      [...kinds].map((kind) => [
        kind,
        new Set(
          [...versions, ...versionsBefore].filter(
            (version) =>
              references.kindOf(references.seriesOf(version) ?? "") === kind,
          ),
        ),
      ]),
    );
    const terms = await tableTerms(context.vocabulary, context.newStore);
    const find = { codes: await podCodes(union, terms), terms };
    const shown = new Set<string>();
    const over = async (
      held: readonly string[],
      rules: readonly { rule: MatcherRule; text: string }[],
    ): Promise<Joins> => {
      for (const version of shown)
        if (!held.includes(version)) {
          await union.store.drop(version);
          shown.delete(version);
        }
      await union.store.drop(DESCRIBED);
      for (const version of held) {
        if (!shown.has(version))
          await union.add(await references.rows(version, find), version);
        shown.add(version);
        await union.add(
          [
            ...references.description(version),
            ...references.description(references.seriesOf(version) ?? ""),
          ],
          DESCRIBED,
        );
      }
      const selected = new Map<string, Promise<readonly Row[]>>();
      const rowsOf = (query: string): Promise<readonly Row[]> => {
        let rows = selected.get(query);
        if (rows === undefined) {
          rows = union
            .select(bound === undefined ? query : boundToRecords(query, bound))
            .then((answer) => answer.rows);
          selected.set(query, rows);
        }
        return rows;
      };
      return joins(rowsOf, rules, loaded, new Set(["", ...held]));
    };
    const foundBefore =
      adopted === undefined || rulesBefore === undefined
        ? []
        : rulesBefore === rulesVersion
          ? found
          : await matcherRules(
              new Graph(await references.rows(rulesBefore)),
              context.vocabulary,
            ).catch((error: unknown) => {
              if (error instanceof Refusal) return [];
              throw error;
            });
    const { address, layout } = context;
    const folder = layout.place(`${CASCADE}ReferenceSeries`).folder;
    context.releaseMatcherView();
    let known: Joins;
    let matched: Joins;
    try {
      for (const graph of union.graphs)
        if (folder !== undefined && graph.startsWith(address + folder))
          await union.store.drop(graph);
      known =
        foundBefore.length > 0 ? await over(versionsBefore, foundBefore) : none;
      matched = await over(versions, found);
    } finally {
      union.store.free?.();
    }
    if (adopted === undefined)
      return new Matcher(
        context,
        references,
        pod,
        rulesVersion,
        rules,
        current,
        matched,
        none,
        findings,
      );
    const fresh = new Map<string, Map<string, Set<string>>>();
    for (const [justification, pairs] of matched) {
      const newly = new Map<string, Set<string>>();
      for (const [key, origins] of pairs) {
        if (pod.retracted.has(key)) continue;
        const unknown = [...origins].filter((origin) => {
          const was = before(origin);
          return (
            was === undefined ||
            !(known.get(justification)?.get(key)?.has(was) ?? false)
          );
        });
        if (unknown.length > 0) newly.set(key, new Set(unknown));
      }
      fresh.set(justification, newly);
    }
    return new Matcher(
      context,
      references,
      pod,
      rulesVersion,
      rules,
      current,
      matched,
      fresh,
      findings,
    );
  }

  /** The origins whose rows join the record to the other under the rule, among the joins given. */
  private origins(
    joined: Joins,
    rule: MatcherRule,
    record: TakenRecord,
    other: TakenRecord,
  ): ReadonlySet<string> {
    if (!applies(rule, record)) return new Set();
    return (
      joined.get(rule.justification)?.get(pair(record.name, other.name)) ??
      new Set()
    );
  }

  /** Writes, after every judgment, what the pod lacks of the series or version's description (M8, W1). */
  async describe(thing: string): Promise<void> {
    if (this.pod.held.has(thing)) return;
    const { layout } = this.context;
    const place = layout.place(`${CASCADE}ReferenceSeries`);
    const path = this.references.isVersion(thing)
      ? layout.version(place, thing)
      : place.path(thing);
    if (!this.#descriptions.has(path))
      this.#descriptions.set(
        path,
        ntriples(await this.references.podDescription(thing)),
      );
  }

  /** Writes the descriptions held back for after the judgments. */
  finish(): void {
    for (const [path, bytes] of this.#descriptions)
      this.context.writes.add(path, bytes);
  }

  /**
   * Writes the rule's claim of the members by the origin's rows, unless the pod holds it, and its assertion under the
   * rule list's version, unless the claim is asserted with the rule's query hash already (M5, M8, M9).
   */
  private async same(
    rule: MatcherRule,
    origin: string,
    members: readonly TakenRecord[],
  ): Promise<void> {
    const { layout, writes } = this.context;
    const used = [
      ...new Set([
        ...(origin === "" ? [] : [origin]),
        ...members.map(({ version }) => version),
      ]),
    ].sort(byCodePoint);
    const names = [...new Set(members.map(({ name }) => name))].sort(
      byCodePoint,
    );
    const name = await claimName({
      maker: MATCHER,
      rule: rule.term,
      justification: rule.justification,
      members: names,
      used,
    });
    for (const version of [
      this.rulesVersion,
      ...(origin === "" ? [] : [origin]),
    ]) {
      await this.describe(this.references.seriesOf(version) ?? "");
      await this.describe(version);
    }
    const asserted = this.pod.asserted.get(name);
    if (
      asserted?.has(rule.hash) === true ||
      this.#filed.has(name) ||
      this.pod.withdrawn.has(name)
    )
      return;
    this.#filed.add(name);
    this.sames.push(names);
    const claim = iri(name);
    const matcher = iri(MATCHER);
    if (!this.pod.held.has(name))
      writes.add(
        layout.place(`${CASCADE}Judgment`).path(name),
        ntriples([
          [claim, iri(TYPE), iri(`${CASCADE}Judgment`)],
          [claim, iri(`${CASCADE}verdict`), iri(`${CASCADE}Same`)],
          [claim, iri(`${CASCADE}justification`), iri(rule.justification)],
          [claim, iri(`${CASCADE}matcherRule`), iri(rule.term)],
          ...names.map((member): Triple => [
            claim,
            iri(`${PROV}hadMember`),
            iri(member),
          ]),
          ...used.map((thing): Triple => [
            claim,
            iri(`${PROV}used`),
            iri(thing),
          ]),
          [claim, iri(`${PROV}wasAttributedTo`), matcher],
          [matcher, iri(TYPE), iri(`${PROV}SoftwareAgent`)],
          [matcher, iri(`${RDFS}label`), literal("Cascade matcher")],
        ]),
      );
    const assertion = await assertionName(this.rulesVersion, name);
    writes.add(
      layout.place(`${CASCADE}ClaimAssertion`).path(assertion),
      ntriples([
        [iri(assertion), iri(TYPE), iri(`${CASCADE}ClaimAssertion`)],
        [iri(assertion), iri(`${CASCADE}assertedClaim`), claim],
        [
          iri(assertion),
          iri(`${CASCADE}assertedUnderRuleListVersion`),
          iri(this.rulesVersion),
        ],
      ]),
    );
  }

  /**
   * The record and, of each entry among the records it matched, the least of those it matched and is not judged different
   * from, or the least of them all when it is judged different from each, in code point order of their names: a star, so a record matched with every earlier copy of one fact names one of them (M5). The entries
   * are those the counting Sames make as same-pairs.rq derives them, with the Sames the run has filed so far and
   * without any Same that holds the record, so a run again over the same records reaches the same claims (M9).
   */
  private star(
    record: TakenRecord,
    matched: readonly TakenRecord[],
  ): TakenRecord[] {
    const parent = new Map<string, string>();
    const root = (name: string): string => {
      let at = name;
      for (
        let up = parent.get(at);
        up !== undefined && up !== at;
        up = parent.get(at)
      )
        at = up;
      parent.set(name, at);
      return at;
    };
    const { different } = this.pod;
    const later = (name: string): boolean => {
      const other = this.pod.records.get(name);
      return other !== undefined && byArrival(other, record) >= 0;
    };
    for (const members of this.sames) {
      if (members.some(later)) continue;
      const split = members.some((one) =>
        members.some((other) => different.has(pair(one, other))),
      );
      const [least = ""] = [...members].sort(byCodePoint);
      for (const one of members)
        for (const other of split ? members : [least])
          if (one !== other && !different.has(pair(one, other)))
            parent.set(root(one), root(other));
    }
    const kept = new Map<string, TakenRecord>();
    const apart = (other: TakenRecord): boolean =>
      different.has(pair(record.name, other.name));
    for (const other of matched) {
      const entry = root(other.name);
      const was = kept.get(entry);
      if (
        was === undefined ||
        (apart(was) && !apart(other)) ||
        (apart(was) === apart(other) && byCodePoint(other.name, was.name) < 0)
      )
        kept.set(entry, other);
    }
    return [record, ...kept.values()];
  }

  /** Files a Same for each record taken, in arrival order, of it and what it joins among the records before it (M3-M5). */
  private async file(
    taken: readonly TakenRecord[],
    joined: Joins,
  ): Promise<void> {
    const takenNames = new Set(taken.map(({ name }) => name));
    const position = new Map<string, number>();
    for (const record of this.pod.records.values())
      if (!takenNames.has(record.name))
        position.set(record.name, position.size);
    const partners = partnersOf(joined);
    for (const record of [...taken].sort(byArrival)) {
      for (const rule of this.rules) {
        if (!applies(rule, record)) continue;
        const pairs = joined.get(rule.justification);
        const others = (
          partners.get(rule.justification)?.get(record.name) ?? []
        )
          .filter((other) => position.has(other))
          .sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
        const byOrigin = new Map<string, TakenRecord[]>();
        for (const name of others) {
          const other = this.pod.records.get(name);
          if (other === undefined) continue;
          for (const origin of pairs?.get(pair(record.name, name)) ?? [])
            byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), other]);
        }
        for (const [origin, matched] of [...byOrigin].sort(([a], [b]) =>
          a < b ? -1 : 1,
        ))
          await this.same(rule, origin, this.star(record, matched));
      }
      position.set(record.name, position.size);
    }
  }

  /** Files a Same for each record taken whose first revisions the acts began (M1-M5). */
  async take(takes: Takes): Promise<void> {
    await this.file(
      [...this.pod.records.values()].filter((record) => taken(record, takes)),
      this.matched,
    );
  }

  /** Files a Same for each pair the tables newly join, taking the records of those pairs (M1, O1). */
  async rejoin(): Promise<void> {
    const { records } = this.pod;
    const joining = new Set<string>();
    for (const rule of this.rules)
      for (const [key, origins] of this.fresh.get(rule.justification) ?? []) {
        if (origins.size === 0) continue;
        const [record, other] = names(key).map((name) => records.get(name));
        if (record === undefined || other === undefined) continue;
        if (applies(rule, record)) joining.add(record.name).add(other.name);
      }
    await this.file(
      [...records.values()].filter(({ name }) => joining.has(name)),
      this.fresh,
    );
  }

  /**
   * Files again each claim of the matcher's that used a version the tables revise whose current version does not join
   * its members, or whose rule the current rule list runs with a query it is not asserted with, and still joins two of
   * its members (M7).
   */
  async recheck(): Promise<void> {
    if (this.rulesVersion === "") return;
    const byTerm = new Map(this.rules.map((rule) => [rule.term, rule]));
    for (const judged of this.pod.judgments) {
      const rule = byTerm.get(judged.rule);
      if (rule === undefined) continue;
      if (
        !judged.used.some((thing) => this.pod.revised.has(thing)) &&
        this.pod.asserted.get(judged.name)?.has(rule.hash) === true
      )
        continue;
      const series =
        rule.kind === undefined
          ? undefined
          : judged.used
              .map((thing) => this.references.seriesOf(thing))
              .find(
                (found) =>
                  found !== undefined &&
                  this.references.kindOf(found) === rule.kind,
              );
      const origin = series === undefined ? "" : this.current(series);
      if (origin === undefined) continue;
      if (
        origin !== "" &&
        !judged.used.includes(origin) &&
        this.pod.asserted.get(judged.name)?.has(rule.hash) === true &&
        this.#joinsAll(rule, origin, judged.members)
      )
        continue;
      const members = judged.members.flatMap(
        (member) => this.pod.records.get(member) ?? [],
      );
      const still = members.filter((member) =>
        members.some(
          (other) =>
            other !== member &&
            this.origins(this.matched, rule, member, other).has(origin),
        ),
      );
      if (still.length >= 2) await this.same(rule, origin, still);
    }
    await this.resplit(byTerm);
  }

  /** Whether the origin's rows join one of the members to each other one under the rule, as the lens asks (M7). */
  #joinsAll(
    rule: MatcherRule,
    origin: string,
    members: readonly string[],
  ): boolean {
    const pairs = this.matched.get(rule.justification);
    return members.some((one) =>
      members.every(
        (other) =>
          other === one || (pairs?.get(pair(one, other))?.has(origin) ?? false),
      ),
    );
  }

  /**
   * Files the rule list version's finding of the claims it no longer reaches (M18), when the version revises another and
   * the pod holds no such finding of it: every claim of the matcher's nothing withdraws that is asserted with the query
   * hash of its rule's row in any version this one revises, directly or not, as the rows the pod describes give it, and
   * not with this version's row for it, this run's assertions counted, and that no finding the pod holds names, so the
   * claims it names do not depend on which versions the pod's runs went through. None when it would name none.
   */
  async fileNoLongerReached(): Promise<void> {
    const version = this.rulesVersion;
    if (version === "" || this.pod.noLongerReachedUnder.has(version)) return;
    const earlier = new Map<string, Set<string>>();
    for (const revised of revisedBy(this.references, version))
      for (const [rule, hash] of this.pod.ruleHashes.get(revised) ?? [])
        earlier.set(rule, (earlier.get(rule) ?? new Set()).add(hash));
    if (earlier.size === 0) return;
    const hashesNow = new Map(this.rules.map(({ term, hash }) => [term, hash]));
    const claims: string[] = [];
    for (const judged of this.pod.judgments) {
      if (
        this.#filed.has(judged.name) ||
        this.pod.namedByFinding.has(judged.name)
      )
        continue;
      const asserted = this.pod.asserted.get(judged.name);
      const now = hashesNow.get(judged.rule);
      if (
        asserted === undefined ||
        (now !== undefined && asserted.has(now)) ||
        ![...(earlier.get(judged.rule) ?? [])].some((hash) =>
          asserted.has(hash),
        )
      )
        continue;
      claims.push(judged.name);
    }
    if (claims.length === 0) return;
    const content = (subject: string): Triple[] => [
      [iri(subject), iri(TYPE), iri(`${CASCADE}FindingForReview`)],
      [iri(subject), iri(`${OA}hasBody`), iri(NO_LONGER_REACHED)],
      [iri(subject), iri(`${OA}motivatedBy`), iri(`${OA}classifying`)],
      [
        iri(subject),
        iri(`${CASCADE}noLongerReachedUnderRuleListVersion`),
        iri(version),
      ],
      ...claims.map((claim): Triple => [
        iri(subject),
        iri(`${OA}hasTarget`),
        iri(claim),
      ]),
    ];
    const name = await findingName(content(THIS_FINDING));
    const { layout, writes } = this.context;
    writes.add(
      layout.place(`${CASCADE}FindingForReview`).path(name),
      ntriples(content(name)),
    );
  }

  /**
   * Files a finding for review for each pair a finding rule's query gives, of records of a class it applies to, that
   * the pod holds no finding of: its kind, oa:motivatedBy oa:classifying, the two records as its targets and their
   * current versions as prov:used, named by its triples (M21: R16, R17).
   */
  async fileFindings(): Promise<void> {
    const { layout, writes } = this.context;
    const filed = new Set<string>();
    for (const rule of this.findings)
      for (const key of this.matched.get(rule.justification)?.keys() ?? []) {
        const [one, other] = key
          .split(" ")
          .map((name) => this.pod.records.get(name));
        if (
          one === undefined ||
          other === undefined ||
          ![one, other].every((record) =>
            [...record.classes].some((found) => rule.appliesTo.has(found)),
          )
        )
          continue;
        const content = (subject: string): Triple[] => [
          [iri(subject), iri(TYPE), iri(`${CASCADE}FindingForReview`)],
          [iri(subject), iri(`${OA}hasBody`), iri(rule.justification)],
          [iri(subject), iri(`${OA}motivatedBy`), iri(`${OA}classifying`)],
          ...[one, other].flatMap((record): Triple[] => [
            [iri(subject), iri(`${OA}hasTarget`), iri(record.name)],
            [iri(subject), iri(`${PROV}used`), iri(record.version)],
          ]),
        ];
        const name = await findingName(content(THIS_FINDING));
        if (this.pod.findings.has(name) || filed.has(name)) continue;
        filed.add(name);
        writes.add(
          layout.place(`${CASCADE}FindingForReview`).path(name),
          ntriples(content(name)),
        );
      }
  }

  /**
   * Files again, by its rule over the entries as they now are, each claim's star that a Different has split: its
   * latest-arriving member's rule matches a record it is not judged different from that the entries keep apart from it
   * (M7). A star filed again joins it, so a claim triggers this once.
   */
  private async resplit(
    byTerm: ReadonlyMap<string, MatcherRule>,
  ): Promise<void> {
    const { different, records, entryOf } = this.pod;
    const neighbours = new Map<string, Map<string, string[]>>();
    for (const [justification, pairs] of this.matched) {
      const of = new Map<string, string[]>();
      for (const key of pairs.keys()) {
        const [record = "", other = ""] = key.split(" ");
        of.set(record, [...(of.get(record) ?? []), other]);
      }
      neighbours.set(justification, of);
    }
    for (const judged of this.pod.judgments) {
      const rule = byTerm.get(judged.rule);
      if (rule === undefined) continue;
      const members = judged.members.flatMap(
        (member) => records.get(member) ?? [],
      );
      const [record] = [...members].sort(byArrival).slice(-1);
      if (record === undefined) continue;
      const origin =
        rule.kind === undefined
          ? ""
          : (judged.used.find(
              (thing) =>
                this.references.kindOf(
                  this.references.seriesOf(thing) ?? "",
                ) === rule.kind,
            ) ?? "");
      const matched = (
        neighbours.get(rule.justification)?.get(record.name) ?? []
      )
        .flatMap((name) => records.get(name) ?? [])
        .filter(
          (other) =>
            byArrival(other, record) < 0 &&
            this.origins(this.matched, rule, record, other).has(origin),
        );
      const entry = entryOf.get(record.name);
      if (
        entry !== undefined &&
        matched.some(
          (other) =>
            !different.has(pair(record.name, other.name)) &&
            entryOf.get(other.name) !== undefined &&
            entryOf.get(other.name) !== entry,
        )
      )
        await this.same(rule, origin, this.star(record, matched));
    }
  }
}

interface Judged {
  readonly name: string;
  readonly rule: string;
  readonly members: readonly string[];
  readonly used: readonly string[];
}

function pair(record: string | undefined, other: string | undefined): string {
  return `${record ?? ""} ${other ?? ""}`;
}

/** The record and the other a pair names; an IRI holds no space. */
function names(key: string): [string, string] {
  const at = key.indexOf(" ");
  return [key.slice(0, at), key.slice(at + 1)];
}

function applies(rule: MatcherRule, record: TakenRecord): boolean {
  for (const found of record.classes)
    if (rule.appliesTo.has(found)) return true;
  return false;
}

/** For each justification, the others each record is joined to. */
function partnersOf(joined: Joins): Map<string, Map<string, string[]>> {
  const found = new Map<string, Map<string, string[]>>();
  for (const [justification, pairs] of joined) {
    const partners = new Map<string, string[]>();
    for (const [key, origins] of pairs) {
      if (origins.size === 0) continue;
      const [record, other] = names(key);
      const others = partners.get(record);
      if (others === undefined) partners.set(record, [other]);
      else others.push(other);
    }
    found.set(justification, partners);
  }
  return found;
}

/** The matcher's Sames that nothing retracts and no unretracted judgment replaces, in order of name. */
async function recheckable(dataset: Dataset): Promise<Judged[]> {
  const ours = `?judgment prov:wasAttributedTo <${MATCHER}> ; cascade:verdict cascade:Same .
    FILTER NOT EXISTS {
      ?replacing dct:replaces ?judgment
      OPTIONAL { ?undoing prov:invalidated ?replacing }
      FILTER (!BOUND(?undoing))
    }
    FILTER NOT EXISTS { ?retraction prov:invalidated ?judgment }`;
  const [rules, members, used] = await Promise.all(
    ["cascade:matcherRule", "prov:hadMember", "prov:used"].map(
      async (predicate) =>
        grouped(
          await column(
            dataset,
            `SELECT DISTINCT ?judgment ?value WHERE { ${ours} ?judgment ${predicate} ?value }`,
            "judgment",
            "value",
          ),
        ),
    ),
  );
  const names = await column(
    dataset,
    `SELECT DISTINCT ?judgment WHERE { ${ours} }`,
    "judgment",
  );
  return names
    .flatMap(([name]) => name ?? [])
    .sort()
    .map((name) => ({
      name,
      rule: rules?.get(name)?.[0] ?? "",
      members: [...(members?.get(name) ?? [])].sort(),
      used: used?.get(name) ?? [],
    }));
}

async function read(dataset: Dataset, references: References): Promise<Pod> {
  const held = await column(
    dataset,
    "SELECT DISTINCT ?thing WHERE { ?thing ?p ?o FILTER isIRI(?thing) }",
    "thing",
  );
  const retracted = grouped(
    await column(
      dataset,
      `SELECT DISTINCT ?judgment ?member WHERE {
        ?judgment prov:wasAttributedTo <${MATCHER}> ; cascade:verdict cascade:Same ; prov:hadMember ?member .
        ?retraction prov:invalidated ?judgment
      }`,
      "judgment",
      "member",
    ),
  );
  const judgments = await recheckable(dataset);
  const counted = new Set(judgments.map(({ name }) => name));
  const entries = await column(
    dataset,
    "SELECT DISTINCT ?record ?entry WHERE { ?record cascade:inEntry ?entry }",
    "record",
    "entry",
  );
  const claims = await column(
    dataset,
    `SELECT DISTINCT ?claim WHERE { ?claim prov:wasAttributedTo <${MATCHER}> ; cascade:verdict cascade:Same }`,
    "claim",
  );
  const sames = grouped(
    await column(
      dataset,
      `SELECT DISTINCT ?same ?member WHERE {
        { ?same cascade:countsUnderLens true ; cascade:verdict cascade:Same ; prov:hadMember ?member }
        UNION
        { ?answer cascade:countsUnderLens true ; cascade:verdict cascade:Same ; prov:hadMember ?finding .
          ?finding oa:hasBody <${NO_LONGER_REACHED}> ; oa:hasTarget ?same .
          ?same prov:hadMember ?member }
      }`,
      "same",
      "member",
    ),
  );
  const noLongerReachedUnder = await column(
    dataset,
    `SELECT DISTINCT ?version WHERE { ?finding oa:hasBody <${NO_LONGER_REACHED}> ; cascade:noLongerReachedUnderRuleListVersion ?version }`,
    "version",
  );
  const findings = await column(
    dataset,
    "SELECT DISTINCT ?finding WHERE { ?finding a cascade:FindingForReview }",
    "finding",
  );
  const namedByFinding = await column(
    dataset,
    `SELECT DISTINCT ?claim WHERE { ?finding oa:hasBody <${NO_LONGER_REACHED}> ; oa:hasTarget ?claim }`,
    "claim",
  );
  const rows = await column(
    dataset,
    "SELECT DISTINCT ?version ?rule ?hash WHERE { ?row cascade:rowOfRuleListVersion ?version ; cascade:matcherRule ?rule ; cascade:queryHash ?hash }",
    "version",
    "rule",
    "hash",
  );
  const ruleHashes = new Map<string, Map<string, string>>();
  for (const [version, rule, hash] of rows)
    if (version !== undefined && rule !== undefined && hash !== undefined)
      ruleHashes.set(
        version,
        (ruleHashes.get(version) ?? new Map<string, string>()).set(rule, hash),
      );
  const different = await column(
    dataset,
    "SELECT DISTINCT ?record ?other WHERE { ?record cascade:currentlyDifferent ?other }",
    "record",
    "other",
  );
  const asserted = grouped(
    await column(
      dataset,
      `SELECT DISTINCT ?claim ?hash WHERE {
        ?assertion cascade:assertedClaim ?claim ; cascade:assertedUnderRuleListVersion ?version .
        FILTER NOT EXISTS { ?retraction prov:invalidated ?assertion }
        ?claim cascade:matcherRule ?rule .
        ?row cascade:rowOfRuleListVersion ?version ; cascade:matcherRule ?rule ; cascade:queryHash ?hash
      }`,
      "claim",
      "hash",
    ),
  );
  return {
    held: new Set(held.flatMap(([thing]) => thing ?? [])),
    sames: [...sames.values()],
    different: new Set(
      different.flatMap(([record, other]) => [
        pair(record, other),
        pair(other, record),
      ]),
    ),
    asserted: new Map(
      [...asserted].map(([claim, hashes]) => [claim, new Set(hashes)]),
    ),
    records: await takenRecords(dataset),
    judgments,
    withdrawn: new Set(
      claims.flatMap(([claim]) =>
        claim === undefined || counted.has(claim) ? [] : [claim],
      ),
    ),
    entryOf: new Map(
      entries.flatMap(([record, entry]) =>
        record === undefined || entry === undefined ? [] : [[record, entry]],
      ),
    ),
    revised: references.revised(),
    noLongerReachedUnder: new Set(
      noLongerReachedUnder.flatMap(([version]) => version ?? []),
    ),
    namedByFinding: new Set(namedByFinding.flatMap(([claim]) => claim ?? [])),
    findings: new Set(findings.flatMap(([finding]) => finding ?? [])),
    ruleHashes,
    retracted: new Set(
      [...retracted.values()].flatMap((members) =>
        members.flatMap((record) =>
          members.flatMap((other) =>
            record === other ? [] : [pair(record, other)],
          ),
        ),
      ),
    ),
  };
}

/**
 * The run as an act, a new random ID (N7), informed by the act whose records it took: written only when the run writes
 * something else, so a run that finds nothing new writes nothing.
 */
function actOfRun(
  context: StepContext,
  informedBy?: string,
): string | undefined {
  const { writes, time, layout } = context;
  if (writes.size === 0) return undefined;
  const name = time.newId();
  const run = iri(name);
  writes.act({
    name,
    path: layout.place(`${PROV}Activity`).path(name),
    triples: [
      [run, iri(TYPE), iri(`${PROV}Activity`)],
      [run, iri(TYPE), iri(`${CASCADE}MatcherRun`)],
      [run, iri(`${PROV}startedAtTime`), literal(time.now(), `${XSD}dateTime`)],
      ...(informedBy === undefined
        ? []
        : [[run, iri(`${PROV}wasInformedBy`), iri(informedBy)] as Triple]),
    ],
  });
  return name;
}

/**
 * The acts whose records a run given the activity takes (M1): an import, entry session or connect, for the records with any
 * first revision from it, or each act a sync names, for those with every first revision from them; a sync naming none
 * takes none.
 */
async function actsTaken(
  context: StepContext,
  activity: string,
): Promise<Takes> {
  const named = await column(
    await context.matcherView(),
    `SELECT ?act WHERE { <${activity}> a cascade:SyncFromAnotherWriter OPTIONAL { <${activity}> prov:wasInformedBy ?act } }`,
    "act",
  );
  return named.length === 0
    ? { acts: new Set([activity]), all: false }
    : { acts: new Set(named.flatMap(([act]) => act ?? [])), all: true };
}

/**
 * A matcher run: the records the import, entry session or connect it takes made, or those a sync brought, or, taking none, a
 * recheck. Gives the run's act, if it wrote one.
 */
export async function runMatcher(
  context: StepContext,
  references: References,
  activity?: string,
): Promise<string | undefined> {
  const takes =
    activity === undefined ? undefined : await actsTaken(context, activity);
  const matcher = await Matcher.of(context, references, undefined, takes);
  if (takes === undefined) {
    await matcher.recheck();
    await matcher.fileNoLongerReached();
  } else await matcher.take(takes);
  await matcher.fileFindings();
  matcher.finish();
  return actOfRun(context, activity);
}

/** The versions after `from` on the line that ends at `to`, oldest first: none when `to` does not descend from it. */
function descent(references: References, to: string, from: string): string[] {
  const line: string[] = [];
  for (
    let at: string | undefined = to;
    at !== from;
    at = references.revisionOf(at)
  ) {
    if (at === undefined || line.includes(at)) return [];
    line.unshift(at);
  }
  return line;
}

/** What an open adopts: each series' default that descends from the version the pod names, and the line of versions after it. */
interface Adoption {
  readonly adopted: ReadonlyMap<string, string>;
  /** Each version after the pod's on the way to the adopted one, oldest first, series by series. */
  readonly line: readonly string[];
  /** The versions the pod names that the tables do not hold (O2). */
  readonly unheld: readonly string[];
}

function adoptionOf(
  named: ReadonlyMap<string, readonly string[]>,
  references: References,
): Adoption {
  const adopted = new Map<string, string>();
  const line: string[] = [];
  const unheld: string[] = [];
  for (const [series, [version, ...others]] of named) {
    if (version === undefined || others.length > 0) continue;
    if (references.seriesOf(version) !== series) {
      unheld.push(version);
      continue;
    }
    const after = descent(references, references.fallback(series), version);
    const last = after.at(-1);
    if (last === undefined) continue;
    adopted.set(series, last);
    line.push(...after);
  }
  return { adopted, line, unheld: unheld.sort() };
}

/** A release's retraction of an assertion (N15), as its file states it. */
export interface ReleaseRetraction {
  readonly name: string;
  readonly triples: readonly Triple[];
}

/**
 * The retractions the rule list version migration writes (N15): for each version on the line up to the pod's current
 * rule list version, itself among them, that declares a matcher rule wrong, oldest first, a retraction of each assertion
 * of that rule's claim under a version it revises that no retraction invalidates. The current version is the one an
 * open adopts when `opening`. None, without reading the pod, when no version the tables describe declares a rule wrong,
 * or when the pod's current version is not one the tables can name.
 */
export async function releaseRetractions(
  view: () => Promise<Dataset>,
  references: References,
  opening: boolean,
): Promise<ReleaseRetraction[]> {
  if (!references.declareARuleWrong()) return [];
  const union = await view();
  const named = await namedVersions(union);
  const series = await references.ruleList();
  let current: string | undefined;
  try {
    current =
      (opening
        ? adoptionOf(named, references).adopted.get(series)
        : undefined) ?? references.current(series, named.get(series) ?? []);
  } catch (error) {
    if (error instanceof Refusal) return [];
    throw error;
  }
  const releases: {
    readonly release: string;
    readonly wrong: ReadonlySet<string>;
    readonly revises: ReadonlySet<string>;
  }[] = [];
  for (
    let at = current, seen = new Set<string>();
    at !== undefined && !seen.has(at);
    at = references.revisionOf(at)
  ) {
    seen.add(at);
    const wrong = references.rulesDeclaredWrong(at);
    if (wrong.length > 0)
      releases.unshift({
        release: at,
        wrong: new Set(wrong),
        revises: revisedBy(references, at),
      });
  }
  if (releases.length === 0) return [];
  const rules = [...new Set(releases.flatMap(({ wrong }) => [...wrong]))];
  const held = await column(
    union,
    `SELECT DISTINCT ?assertion ?rule ?version WHERE {
      VALUES ?rule { ${rules.map((rule) => `<${rule}>`).join(" ")} }
      ?claim prov:wasAttributedTo <${MATCHER}> ; cascade:matcherRule ?rule .
      ?assertion cascade:assertedClaim ?claim ; cascade:assertedUnderRuleListVersion ?version .
      FILTER NOT EXISTS { ?retraction prov:invalidated ?assertion }
    }`,
    "assertion",
    "rule",
    "version",
  );
  const taken = new Map<string, ReleaseRetraction>();
  for (const { release, wrong, revises } of releases)
    for (const [assertion, rule, version] of held) {
      if (
        assertion === undefined ||
        rule === undefined ||
        version === undefined ||
        taken.has(assertion) ||
        !wrong.has(rule) ||
        !revises.has(version)
      )
        continue;
      const name = await retractionName(release, assertion, rule);
      const retraction = iri(name);
      taken.set(assertion, {
        name,
        triples: [
          [retraction, iri(TYPE), iri(`${PROV}Activity`)],
          [retraction, iri(`${PROV}invalidated`), iri(assertion)],
          [retraction, iri(`${PROV}used`), iri(release)],
        ],
      });
    }
  return [...taken.values()].sort((a, b) => byCodePoint(a.name, b.name));
}

/** Every version the version revises, directly or not. */
function revisedBy(references: References, version: string): Set<string> {
  const earlier = new Set<string>();
  for (
    let at = references.revisionOf(version);
    at !== undefined && !earlier.has(at);
    at = references.revisionOf(at)
  )
    earlier.add(at);
  return earlier;
}

/**
 * The rule list version migration (N15): the retractions given, each filed where the layout files what states
 * prov:invalidated, and the act, a cascade:RuleListVersionMigration named by a new random ID (N7). Gives the act.
 */
export function migrateRuleListVersions(
  context: StepContext,
  retractions: readonly ReleaseRetraction[],
): string {
  const { writes, layout, time } = context;
  for (const { name, triples } of retractions)
    writes.add(
      layout
        .place(
          `${PROV}Activity`,
          triples.map(([, p]) => p.value),
        )
        .path(name),
      ntriples([...triples]),
    );
  const name = time.newId();
  const act = iri(name);
  writes.act({
    name,
    path: layout.place(`${PROV}Activity`).path(name),
    triples: [
      [act, iri(TYPE), iri(`${PROV}Activity`)],
      [act, iri(TYPE), iri(`${CASCADE}RuleListVersionMigration`)],
      [act, iri(`${PROV}startedAtTime`), literal(time.now(), `${XSD}dateTime`)],
    ],
  });
  return name;
}

/**
 * Opens the pod with the tables: adopts each series' default that descends from the version the pod names, and files
 * what that and any rule or series new to the pod join (O1); a version the tables do not hold is left out (O2). Gives
 * the versions the pod names that the tables do not hold, and the run's act, if it wrote one.
 */
export async function openPod(
  context: StepContext,
  references: References,
): Promise<{ readonly unheld: string[]; readonly activity?: string }> {
  const { adopted, line, unheld } = adoptionOf(
    await namedVersions(await context.matcherView()),
    references,
  );
  const matcher = await Matcher.of(context, references, adopted);
  for (const version of line) await matcher.describe(version);
  await matcher.recheck();
  await matcher.rejoin();
  await matcher.fileNoLongerReached();
  await matcher.fileFindings();
  matcher.finish();
  const activity = actOfRun(context);
  return activity === undefined
    ? { unheld: [...unheld] }
    : { unheld: [...unheld], activity };
}
