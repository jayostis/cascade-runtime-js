import { Derivations, QUERIES } from "./derive.js";
import type { Files } from "./files.js";
import { Graph } from "./graph.js";
import { podFiles } from "./dataset.js";
import { documentName, inUtc, recordName } from "./names.js";
import { iri, literal, ntriples, RDF, type Triple, XSD } from "./rdf.js";
import type { References } from "./references.js";
import { REC, Refusal, type StepContext } from "./step.js";
import { type Dataset, Union } from "./store.js";

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
  readonly table?: string;
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
    const tables = rows.objects(row, `${REC}table`);
    if (tables.length > 1)
      throw new Refusal(
        `the rule for ${justification} reads ${tables.length} tables, not one`,
      );
    found.push({
      rule: {
        justification,
        appliesTo: new Set(
          rows.objects(row, `${REC}appliesTo`).map(({ value }) => value),
        ),
        query: path,
        ...(tables[0] === undefined ? {} : { table: tables[0].value }),
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
}

/** The matcher's procedure, M1 to M11, over the pod as the steps before this one left it. */
class Matcher {
  private constructor(
    readonly context: StepContext,
    readonly references: References,
    readonly pod: Pod,
    readonly rulesVersion: string,
    readonly rules: readonly MatcherRule[],
    readonly tableVersions: ReadonlyMap<string, string>,
    readonly matched: ReadonlyMap<string, ReadonlySet<string>>,
  ) {}

  static async of(
    context: StepContext,
    references: References,
  ): Promise<Matcher> {
    const union = await context.matcherView();
    const named = grouped(
      await column(
        union,
        "SELECT DISTINCT ?series ?version WHERE { ?series pav:hasCurrentVersion ?version }",
        "series",
        "version",
      ),
    );
    const current = (series: string): string =>
      references.current(series, named.get(series) ?? []);
    const rulesVersion = current(await references.ruleList());
    const found = await matcherRules(
      new Graph(await references.rows(rulesVersion)),
      context.vocabulary,
    );
    const tableVersions = new Map(
      found.flatMap(({ rule: { table } }) =>
        table === undefined ? [] : [[table, current(table)] as const],
      ),
    );
    const pod = await read(union, references);
    for (const version of new Set(tableVersions.values()))
      await union.add(
        await references.rows(version),
        `urn:cascade:reference:${version}`,
      );
    const matched = new Map<string, Set<string>>();
    for (const { rule, text } of found) {
      const { rows } = await union.select(text);
      matched.set(
        rule.justification,
        new Set(
          rows.map((row) =>
            pair(row.get("record")?.value, row.get("other")?.value),
          ),
        ),
      );
    }
    return new Matcher(
      context,
      references,
      pod,
      rulesVersion,
      found.map(({ rule }) => rule),
      tableVersions,
      matched,
    );
  }

  private matches(
    rule: MatcherRule,
    record: SubjectRecord,
    other: SubjectRecord,
  ): boolean {
    return (
      rule.appliesTo.has(record.kind) &&
      (this.matched
        .get(rule.justification)
        ?.has(pair(record.name, other.name)) ??
        false)
    );
  }

  /** Writes the rule's Same of the members, unless the pod holds it (M5, M8, M9). */
  private async same(
    rule: MatcherRule,
    members: readonly SubjectRecord[],
  ): Promise<void> {
    const { layout, writes, time } = this.context;
    const table =
      rule.table === undefined ? undefined : this.tableVersions.get(rule.table);
    const applied = [
      this.rulesVersion,
      ...(table === undefined ? [] : [table]),
    ];
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
    if (this.pod.held.has(name)) return;
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
    const place = layout.place(`${REC}ReferenceSeries`);
    for (const version of applied) {
      const series = this.references.seriesOf(version) ?? "";
      for (const [thing, path] of [
        [series, place.path(series)],
        [version, layout.version(place, version)],
      ] as const) {
        if (!this.pod.held.has(thing))
          writes.add(path, ntriples(this.references.description(thing)));
      }
    }
  }

  /** Files a Same for each of the subject's records that the activity's first revisions began, in arrival order (M1-M5). */
  async take(activity: string): Promise<void> {
    const records = [...this.pod.theirs.values()];
    const taken = records
      .filter((record) => record.activity === activity)
      .sort(byArrival);
    const compared = records.filter((record) => !taken.includes(record));
    for (const record of taken) {
      for (const rule of this.rules) {
        const matched = compared.filter((other) =>
          this.matches(rule, record, other),
        );
        if (matched.length > 0) await this.same(rule, [record, ...matched]);
      }
      compared.push(record);
    }
  }

  /** Files again each Same of the matcher's that used a since-revised table and still joins two of its members (M7). */
  async recheck(): Promise<void> {
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
      const members = judged.members.flatMap(
        (member) => this.pod.theirs.get(member) ?? [],
      );
      const still = members.filter((member) =>
        members.some(
          (other) => other !== member && this.matches(rule, member, other),
        ),
      );
      if (still.length >= 2) await this.same(rule, still);
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
  const revised = await column(
    dataset,
    "SELECT DISTINCT ?version WHERE { ?later prov:wasRevisionOf ?version }",
    "version",
  );
  return {
    held: new Set(held.flatMap(([thing]) => thing ?? [])),
    theirs: await subjectRecords(dataset),
    judgments: await recheckable(dataset),
    revised: new Set(
      revised.flatMap(([version]) =>
        version !== undefined && references.isVersion(version) ? [version] : [],
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
}
