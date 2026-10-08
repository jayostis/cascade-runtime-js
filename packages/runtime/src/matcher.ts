import { Derivations, QUERIES } from "./derive.js";
import type { Files } from "./files.js";
import { Graph } from "./graph.js";
import { podFiles } from "./dataset.js";
import { documentName, inUtc, recordName } from "./names.js";
import { iri, literal, ntriples, RDF, type Triple, XSD } from "./rdf.js";
import { type References, tableTerms, type TableTerms } from "./references.js";
import { REC, Refusal, type StepContext } from "./step.js";
import { type Dataset, type Row, Union } from "./store.js";

const JDG = "https://ns.cascadeprotocol.org/judgments/v1-draft#";
const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const NPX = "http://purl.org/nanopub/x/";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const TYPE = `${RDF}type`;
const PREFIXES = `PREFIX rec: <${REC}> PREFIX prov: <${PROV}> PREFIX pav: <${PAV}> PREFIX jdg: <${JDG}> PREFIX npx: <${NPX}>`;

export const MATCHER = "urn:uuid:80bcb9f7-34ae-432b-bd78-ba2616a81f76";
const LENS = "everyday";
const COMPARISONS = `${QUERIES}matcher/`;

export interface MatcherRule {
  readonly justification: string;
  readonly appliesTo: ReadonlySet<string>;
  readonly query: string;
  readonly kind?: string;
}

interface SubjectRecord {
  readonly name: string;
  readonly kind: string;
  readonly version: string;
  readonly arrived: readonly [string, string];
  readonly activity?: string;
}

/** The path a rule's query names under `queries/v1-draft/`, when it resolves inside `matcher/` and holds no backslash. */
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
  for (const row of rows.subjects(TYPE, iri(`${REC}MatcherRule`))) {
    const one = (predicate: string): string => {
      const values = rows.objects(row, `${REC}${predicate}`);
      if (values.length !== 1)
        throw new Refusal(
          `a rule of the rule list gives ${values.length} rec:${predicate}, not one`,
        );
      return values[0]?.value ?? "";
    };
    const justification = one("justifiedAs");
    const query = one("query");
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
    const kinds = rows.objects(row, `${REC}tableKind`);
    if (kinds.length > 1)
      throw new Refusal(
        `the rule for ${justification} reads ${kinds.length} table kinds, not one`,
      );
    found.push({
      rule: {
        justification,
        appliesTo: new Set(
          rows.objects(row, `${REC}appliesTo`).map(({ value }) => value),
        ),
        query: path,
        ...(kinds[0] === undefined ? {} : { kind: kinds[0].value }),
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

function byArrival(a: SubjectRecord, b: SubjectRecord): number {
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

/** The pod's one subject's records, by name, each with its kind, current version and first revision's arrival. */
async function subjectRecords(
  dataset: Dataset,
): Promise<Map<string, SubjectRecord>> {
  const subjects = await column(
    dataset,
    "SELECT DISTINCT ?subject WHERE { ?subject a rec:Subject }",
    "subject",
  );
  const [subject] = subjects;
  if (subjects.length !== 1 || subject?.[0] === undefined)
    throw new Refusal(`the pod holds ${subjects.length} subjects, not one`);
  const theirs = `?record rec:subject <${subject[0]}> .`;
  const records = await column(
    dataset,
    `SELECT DISTINCT ?record WHERE { ${theirs} }`,
    "record",
  );
  const kinds = grouped(
    await column(
      dataset,
      `SELECT DISTINCT ?record ?kind WHERE { ${theirs} ?record rec:kind ?kind }`,
      "record",
      "kind",
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
      `SELECT DISTINCT ?record ?first WHERE { ${theirs} ?first rec:revisionOf ?record FILTER NOT EXISTS { ?first prov:wasRevisionOf ?earlier } }`,
      "record",
      "first",
    ),
  );
  const times = grouped(
    await column(
      dataset,
      `SELECT DISTINCT ?first ?at WHERE { ${theirs} ?first rec:revisionOf ?record ; prov:generatedAtTime ?at }`,
      "first",
      "at",
    ),
  );
  const activities = grouped(
    await column(
      dataset,
      `SELECT DISTINCT ?first ?activity WHERE { ${theirs} ?first rec:revisionOf ?record ; prov:wasGeneratedBy ?activity }`,
      "first",
      "activity",
    ),
  );
  const found = new Map<string, SubjectRecord>();
  for (const [name] of records) {
    if (name === undefined) continue;
    const first = firsts.get(name) ?? [];
    const version = versions.get(name)?.[0];
    const at = times.get(first[0] ?? "")?.[0];
    if (first.length !== 1 || version === undefined || at === undefined)
      throw new Refusal(
        `${name} has no one first revision and current version`,
      );
    const activity = activities.get(first[0] ?? "")?.[0];
    found.set(name, {
      name,
      kind: kinds.get(name)?.[0] ?? "",
      version,
      arrived: arrival(at),
      ...(activity === undefined ? {} : { activity }),
    });
  }
  return found;
}

const derivations = new WeakMap<Files, Promise<Derivations>>();

/**
 * The matcher's view: each RDF file of the pod but those the build writes, and the everyday lens's derived state, the
 * union of a new store.
 */
export async function matcherView(
  context: Pick<
    StepContext,
    "layout" | "pod" | "address" | "vocabulary" | "newStore"
  >,
): Promise<Union> {
  let read = derivations.get(context.vocabulary);
  if (read === undefined) {
    read = Derivations.of(context.vocabulary);
    derivations.set(context.vocabulary, read);
  }
  const union = new Union(context.newStore());
  await podFiles(context.pod, context.layout, context.address, union);
  await (await read).derive(union, LENS);
  return union;
}

/** What the matcher reads of the pod and its derived state, before any table's rows are added to it. */
interface Pod {
  readonly held: ReadonlySet<string>;
  readonly theirs: ReadonlyMap<string, SubjectRecord>;
  readonly judgments: readonly Judged[];
  readonly revised: ReadonlySet<string>;
  /** Each ordered pair of members of a matcher Same a person retracted. */
  readonly retracted: ReadonlySet<string>;
}

/**
 * Every code a current version of the pod's records may join a table by: each IRI it states under a code system's URI
 * space, and each literal it states written after each URI space.
 */
async function podCodes(
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
      for (const space of uriSpaces) codes.add(space + value.value);
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
async function namedVersions(union: Dataset): Promise<Map<string, string[]>> {
  return grouped(
    await column(
      union,
      "SELECT DISTINCT ?series ?version WHERE { ?series a rec:ReferenceSeries ; pav:hasCurrentVersion ?version }",
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

  private constructor(
    readonly context: StepContext,
    readonly references: References,
    readonly pod: Pod,
    readonly rulesVersion: string,
    readonly rules: readonly MatcherRule[],
    readonly current: (series: string) => string | undefined,
    readonly matched: Joins,
    readonly fresh: Joins,
  ) {}

  /**
   * The matcher over the pod and the tables. Given what an open adopts, by series, those versions are current, and
   * `fresh` holds the joins the pod's own rule list and versions do not make (O1).
   */
  static async of(
    context: StepContext,
    references: References,
    adopted?: ReadonlyMap<string, string>,
  ): Promise<Matcher> {
    const union = await context.matcherView();
    const named = await namedVersions(union);
    const current = (series: string): string | undefined =>
      adopted?.get(series) ??
      references.current(series, named.get(series) ?? []);
    const pod = await read(union, references);
    const rulesVersion = current(await references.ruleList());
    const none: Joins = new Map();
    if (rulesVersion === undefined)
      return new Matcher(context, references, pod, "", [], current, none, none);
    const found = await matcherRules(
      new Graph(await references.rows(rulesVersion)),
      context.vocabulary,
    );
    const rules = found.map(({ rule }) => rule);
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
    for (const version of new Set([...versions, ...versionsBefore])) {
      await union.add(await references.rows(version, find), version);
      await union.add(
        [
          ...references.description(version),
          ...references.description(references.seriesOf(version) ?? ""),
        ],
        "urn:cascade:references",
      );
    }
    const selected = new Map<string, Promise<readonly Row[]>>();
    const rowsOf = (query: string): Promise<readonly Row[]> => {
      let rows = selected.get(query);
      if (rows === undefined) {
        rows = union.select(query).then((answer) => answer.rows);
        selected.set(query, rows);
      }
      return rows;
    };
    const matched = await joins(
      rowsOf,
      found,
      loaded,
      new Set(["", ...versions]),
    );
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
      );
    const foundBefore =
      rulesBefore === undefined
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
    const known = await joins(
      rowsOf,
      foundBefore,
      loaded,
      new Set(["", ...versionsBefore]),
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
    );
  }

  /** The origins whose rows join the record to the other under the rule, among the joins given. */
  private origins(
    joined: Joins,
    rule: MatcherRule,
    record: SubjectRecord,
    other: SubjectRecord,
  ): ReadonlySet<string> {
    if (!rule.appliesTo.has(record.kind)) return new Set();
    return (
      joined.get(rule.justification)?.get(pair(record.name, other.name)) ??
      new Set()
    );
  }

  /** Writes, after every judgment, what the pod lacks of the series or version's description (M8, W1). */
  describe(thing: string): void {
    if (this.pod.held.has(thing)) return;
    const { layout } = this.context;
    const place = layout.place(`${REC}ReferenceSeries`);
    const path = this.references.isVersion(thing)
      ? layout.version(place, thing)
      : place.path(thing);
    if (!this.#descriptions.has(path))
      this.#descriptions.set(
        path,
        ntriples(this.references.description(thing)),
      );
  }

  /** Writes the descriptions held back for after the judgments. */
  finish(): void {
    for (const [path, bytes] of this.#descriptions)
      this.context.writes.add(path, bytes);
  }

  /** Writes the rule's Same of the members by the origin's rows, unless the pod holds it (M5, M8, M9). */
  private async same(
    rule: MatcherRule,
    origin: string,
    members: readonly SubjectRecord[],
  ): Promise<void> {
    const { layout, writes, time } = this.context;
    const applied = [this.rulesVersion, ...(origin === "" ? [] : [origin])];
    const used = [
      ...new Set([...applied, ...members.map(({ version }) => version)]),
    ].sort();
    const names = members.map(({ name }) => name).sort();
    const name = await recordName([
      MATCHER,
      rule.justification,
      ...names,
      ...used,
    ]);
    for (const version of applied) {
      this.describe(this.references.seriesOf(version) ?? "");
      this.describe(version);
    }
    if (this.pod.held.has(name) || this.#filed.has(name)) return;
    this.#filed.add(name);
    const same = iri(name);
    const matcher = iri(MATCHER);
    const triples: Triple[] = [
      [same, iri(TYPE), iri(`${JDG}Judgment`)],
      [same, iri(`${JDG}verdict`), iri(`${JDG}Same`)],
      [same, iri(`${JDG}justification`), iri(rule.justification)],
      ...names.map((member): Triple => [
        same,
        iri(`${PROV}hadMember`),
        iri(member),
      ]),
      ...used.map((thing): Triple => [same, iri(`${PROV}used`), iri(thing)]),
      [same, iri(`${PROV}wasAttributedTo`), matcher],
      [
        same,
        iri(`${PROV}generatedAtTime`),
        literal(time.now(), `${XSD}dateTime`),
      ],
      [matcher, iri(TYPE), iri(`${PROV}SoftwareAgent`)],
      [matcher, iri(`${RDFS}label`), literal("Cascade matcher")],
    ];
    writes.add(layout.place(`${JDG}Judgment`).path(name), ntriples(triples));
  }

  /** Files a Same for each record taken, in arrival order, of it and what it joins among the records before it (M3-M5). */
  private async file(
    taken: readonly SubjectRecord[],
    joined: Joins,
  ): Promise<void> {
    const compared = [...this.pod.theirs.values()].filter(
      (record) => !taken.includes(record),
    );
    for (const record of [...taken].sort(byArrival)) {
      for (const rule of this.rules) {
        const byOrigin = new Map<string, SubjectRecord[]>();
        for (const other of compared)
          for (const origin of this.origins(joined, rule, record, other))
            byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), other]);
        for (const [origin, matched] of [...byOrigin].sort(([a], [b]) =>
          a < b ? -1 : 1,
        ))
          await this.same(rule, origin, [record, ...matched]);
      }
      compared.push(record);
    }
  }

  /** Files a Same for each of the subject's records that the activity's first revisions began (M1-M5). */
  async take(activity: string): Promise<void> {
    await this.file(
      [...this.pod.theirs.values()].filter(
        (record) => record.activity === activity,
      ),
      this.matched,
    );
  }

  /** Files a Same for each pair the tables newly join, taking the records of those pairs (M1, O1). */
  async rejoin(): Promise<void> {
    const records = [...this.pod.theirs.values()];
    await this.file(
      records.filter((record) =>
        this.rules.some((rule) =>
          records.some(
            (other) =>
              this.origins(this.fresh, rule, record, other).size > 0 ||
              this.origins(this.fresh, rule, other, record).size > 0,
          ),
        ),
      ),
      this.fresh,
    );
  }

  /** Files again each Same of the matcher's that used a version the tables revise and still joins two of its members (M7). */
  async recheck(): Promise<void> {
    if (this.rulesVersion === "") return;
    const byJustification = new Map(
      this.rules.map((rule) => [rule.justification, rule]),
    );
    for (const judged of this.pod.judgments) {
      if (!judged.used.some((thing) => this.pod.revised.has(thing))) continue;
      const rule = byJustification.get(judged.justification);
      if (rule === undefined)
        throw new Refusal(
          `the rule list has no rule for ${judged.justification}, which ${judged.name} gives`,
        );
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
      const members = judged.members.flatMap(
        (member) => this.pod.theirs.get(member) ?? [],
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
  }
}

interface Judged {
  readonly name: string;
  readonly justification: string;
  readonly members: readonly string[];
  readonly used: readonly string[];
}

function pair(record: string | undefined, other: string | undefined): string {
  return `${record ?? ""} ${other ?? ""}`;
}

/** The matcher's Sames that nothing retracts and no unretracted judgment supersedes, in order of name. */
async function recheckable(dataset: Dataset): Promise<Judged[]> {
  const ours = `?judgment prov:wasAttributedTo <${MATCHER}> ; jdg:verdict jdg:Same .
    FILTER NOT EXISTS {
      ?superseding npx:supersedes ?judgment
      OPTIONAL { ?undoing npx:retracts ?superseding }
      FILTER (!BOUND(?undoing))
    }
    FILTER NOT EXISTS { ?retracting npx:retracts ?judgment }`;
  const [justifications, members, used] = await Promise.all(
    ["jdg:justification", "prov:hadMember", "prov:used"].map(
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
      justification: justifications?.get(name)?.[0] ?? "",
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
        ?judgment prov:wasAttributedTo <${MATCHER}> ; jdg:verdict jdg:Same ; prov:hadMember ?member .
        ?retracting npx:retracts ?judgment
      }`,
      "judgment",
      "member",
    ),
  );
  return {
    held: new Set(held.flatMap(([thing]) => thing ?? [])),
    theirs: await subjectRecords(dataset),
    judgments: await recheckable(dataset),
    revised: references.revised(),
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

/** A matcher run: the records the import or entry session it takes made, or, taking none, a recheck. */
export async function runMatcher(
  context: StepContext,
  references: References,
  activity?: string,
): Promise<void> {
  const matcher = await Matcher.of(context, references);
  if (activity === undefined) await matcher.recheck();
  else await matcher.take(activity);
  matcher.finish();
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

/**
 * Opens the pod with the tables: adopts each series' default that descends from the version the pod names, and files
 * what that and any rule or series new to the pod join (O1); a version the tables do not hold is left out (O2). Gives
 * the versions the pod names that the tables do not hold.
 */
export async function openPod(
  context: StepContext,
  references: References,
): Promise<string[]> {
  const named = await namedVersions(await context.matcherView());
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
  const matcher = await Matcher.of(context, references, adopted);
  for (const version of line) matcher.describe(version);
  await matcher.recheck();
  await matcher.rejoin();
  matcher.finish();
  return unheld.sort();
}
