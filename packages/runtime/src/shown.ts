import type { CorePod } from "./core-pod.js";
import { iri, RDF, type Triple, written } from "./rdf.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const DCT_REPLACES = "http://purl.org/dc/terms/replaces";
/** The verdicts that say something of their members' versions, which name the document each member was shown from. */
const SEEN = new Set(
  ["Same", "Different", "Erroneous", "Acknowledged"].map((v) => CASCADE + v),
);

/** Whether the verdict says something of its members' versions. */
export function sawVersions(verdict: string): boolean {
  return SEEN.has(verdict);
}

/**
 * Of each member that has a current version, under the everyday lens, or is a revision, the documents its revision was
 * derived from, by the member: none for a member entered by hand. A member with no version is not in the map.
 */
export async function documentsShownFrom(
  core: Pick<CorePod, "select">,
  members: readonly string[],
): Promise<Map<string, Set<string>>> {
  if (members.length === 0) return new Map();
  const { rows } =
    await core.select(`PREFIX cascade: <${CASCADE}> PREFIX prov: <${PROV}> PREFIX pav: <${PAV}>
      SELECT ?member ?document WHERE {
        VALUES ?member { ${members.map((member) => `<${member}>`).join(" ")} }
        { ?member pav:hasCurrentVersion ?version . OPTIONAL { ?member cascade:currentRevision/prov:wasDerivedFrom ?document } }
        UNION { ?member cascade:version ?version . OPTIONAL { ?member prov:wasDerivedFrom ?document } }
      }`);
  const found = new Map<string, Set<string>>();
  for (const row of rows) {
    const [member, document] = [row.get("member"), row.get("document")];
    if (member === undefined) continue;
    const documents = found.get(member.value) ?? new Set<string>();
    if (document !== undefined) documents.add(document.value);
    found.set(member.value, documents);
  }
  return found;
}

/**
 * Why a person's judgment or retraction, `subject` in `triples`, is refused for replacing (`dct:replaces`) or retracting
 * (`prov:invalidated`) a matcher's judgment, one that carries `cascade:matcherRule` whatever its agent is typed: it says
 * which, and what to file instead (N16). Nothing when it touches none. The matcher's judgment is in the pod, or among
 * the names in `arriving`, not in `triples`.
 */
export async function matcherJudgmentTouched(
  read: Pick<CorePod, "select">,
  triples: readonly Triple[],
  subject: string,
  arriving: ReadonlySet<string> = new Set(),
): Promise<string | undefined> {
  const targets = triples.flatMap(([s, p, o]) =>
    s.value === subject &&
    (p.value === DCT_REPLACES || p.value === `${PROV}invalidated`) &&
    o.termType === "NamedNode"
      ? [{ target: o.value, retracts: p.value !== DCT_REPLACES }]
      : [],
  );
  if (targets.length === 0) return undefined;
  const { rows } = await read.select(`PREFIX cascade: <${CASCADE}>
      SELECT DISTINCT ?judgment WHERE {
        VALUES ?judgment { ${targets.map(({ target }) => `<${target}>`).join(" ")} }
        ?judgment cascade:matcherRule ?rule
      }`);
  const matcher = new Set([
    ...arriving,
    ...rows.flatMap((row) => row.get("judgment")?.value ?? []),
  ]);
  const touched = targets.find(({ target }) => matcher.has(target));
  return touched === undefined
    ? undefined
    : `${touched.target} is a matcher's judgment: a person ${touched.retracts ? "retracts" : "replaces"} no matcher's judgment, and files a Same or a Different over its members instead`;
}

/** The kinds whose warning is about a pair, so that an Acknowledged of one names exactly that pair's two records. */
const PAIR_KINDS: ReadonlySet<string> = new Set(
  [
    "MatcherJudgmentsNoLongerReached",
    "DifferentResultValuesAtOneInstant",
    "DifferentResultUnitsAtOneInstant",
  ].map((kind) => CASCADE + kind),
);

/**
 * Why a judgment may not name `members`, the first of them the pod holds as a finding for review, whose name the pod
 * derives from its triples, and, for an Acknowledged (`acknowledged`), as a version, a revision, a judgment or a matcher
 * judgment assertion, which the pod also derives or an answer is not about. Nothing when it names none. A finding is a
 * file the build wrote, so `stated` holds it; `read` settles the pod, which a judgment filed inside a step that leaves
 * its rebuild must not force, and is asked only for an Acknowledged, whose other kinds are derived.
 */
async function memberRefused(
  read: Pick<CorePod, "select">,
  stated: Pick<CorePod, "select">,
  members: readonly string[],
  acknowledged: boolean,
): Promise<string | undefined> {
  if (members.length === 0) return undefined;
  const values = `VALUES ?member { ${members.map((member) => `<${member}>`).join(" ")} }`;
  const flagged = (
    rows: Awaited<ReturnType<CorePod["select"]>>["rows"],
    variable: string,
  ): Set<string> =>
    new Set(
      rows.flatMap((row) =>
        row.get(variable)?.value === "true"
          ? (row.get("member")?.value ?? [])
          : [],
      ),
    );
  const findings = flagged(
    (
      await stated.select(`PREFIX cascade: <${CASCADE}>
        SELECT ?member ?finding WHERE {
          ${values}
          BIND (EXISTS { ?member a cascade:FindingForReview } AS ?finding)
        }`)
    ).rows,
    "finding",
  );
  const rows = acknowledged
    ? (
        await read.select(`PREFIX cascade: <${CASCADE}> PREFIX prov: <${PROV}>
          SELECT ?member ?version ?revision ?judgment ?assertion WHERE {
            ${values}
            BIND (EXISTS { ?member prov:specializationOf [] } AS ?version)
            BIND (EXISTS { ?member a cascade:Revision } AS ?revision)
            BIND (EXISTS { ?member a cascade:Judgment } AS ?judgment)
            BIND (EXISTS { ?member a cascade:MatcherJudgmentAssertion } AS ?assertion)
          }`)
      ).rows
    : [];
  const kinds = new Map(
    ["version", "revision", "judgment", "assertion"].map((variable) => [
      variable,
      flagged(rows, variable),
    ]),
  );
  const is = (member: string, variable: string): boolean =>
    variable === "finding"
      ? findings.has(member)
      : (kinds.get(variable)?.has(member) ?? false);
  for (const member of members) {
    if (is(member, "finding"))
      return `${member} is a finding for review: a judgment never names one, whose name the pod derives, and names what it is about instead`;
    if (acknowledged)
      for (const [kept, what] of [
        ["version", "a version"],
        ["revision", "a revision"],
        ["judgment", "a judgment"],
        ["assertion", "a matcher judgment assertion"],
      ] as const)
        if (is(member, kept))
          return `${member} is ${what}: an Acknowledged names records, documents or acts, never ${what}`;
  }
  return undefined;
}

/**
 * Why `name`, the name a judgment (`retraction` false) or a retraction is filed under, is no name for it: the pod holds
 * that IRI as something else already, which includes a retraction under a judgment's name and the reverse. Nothing when
 * the pod holds it as no more than the same kind, as a retry meets, or does not hold it.
 */
async function nameTaken(
  read: Pick<CorePod, "select">,
  name: string,
  retraction: boolean,
): Promise<string | undefined> {
  const { rows } =
    await read.select(`PREFIX cascade: <${CASCADE}> PREFIX prov: <${PROV}>
      SELECT ?judgment ?retraction ?stated WHERE {
        BIND (EXISTS { <${name}> a cascade:Judgment } AS ?judgment)
        BIND (EXISTS { <${name}> prov:invalidated ?target } AS ?retraction)
        BIND (EXISTS { <${name}> ?p ?o } AS ?stated)
      }`);
  const [row] = rows;
  const is = (variable: string): boolean =>
    row?.get(variable)?.value === "true";
  const [same, other] = retraction
    ? [is("retraction"), is("judgment")]
    : [is("judgment"), is("retraction")];
  return is("stated") && (!same || other)
    ? `${name} is the name of something else in the pod already: a judgment is named with an IRI nothing else has`
    : undefined;
}

/**
 * A person's judgment or retraction as the pod keeps it (N16), the one copy every way a judgment is filed shares: the
 * reason it is refused, for a name the pod gives something else, for replacing or retracting a matcher's judgment or,
 * for a member that is an entry of a view, an IRI under `views`, which no judgment is of, for a member that is a
 * finding, whatever the verdict, and for an Acknowledged, one that names no one kind of warning or a member that is a
 * version, a revision, a judgment or a matcher judgment assertion, or, of a kind that is about a pair, other than two
 * records; any other verdict that names a kind of warning; else its triples with the document each member was shown
 * from, and none the input states for the judgment itself. A member the pod does not hold is kept: it names no
 * document, and a restore or a rebuild may bring it back. `changed` is false when those are the triples it was given.
 * `stated` reads the pod's files alone, what a name is taken by, so that a judgment with nothing to read the matcher's
 * view for builds none. `kinds` reads the kinds of warning the vocabulary names, the concepts of
 * cascade:FindingForReviewKinds, and is called only for a judgment that is an Acknowledged or names a kind.
 */
export async function judgmentFiled(
  read: Pick<CorePod, "select">,
  triples: readonly Triple[],
  views: string,
  stated: Pick<CorePod, "select">,
  kinds: () => Promise<ReadonlySet<string>>,
): Promise<{ refused: string } | { triples: Triple[]; changed: boolean }> {
  const subjectsOf = (predicate: string, object?: string): string[] =>
    triples.flatMap(([s, p, o]) =>
      p.value === predicate && (object === undefined || o.value === object)
        ? [s.value]
        : [],
    );
  const [judged] = subjectsOf(`${RDF}type`, `${CASCADE}Judgment`);
  const [retracting] = subjectsOf(`${PROV}invalidated`);
  const name = judged ?? retracting;
  if (name !== undefined) {
    const taken = await nameTaken(stated, name, judged === undefined);
    if (taken !== undefined) return { refused: taken };
  }
  for (const subject of new Set([
    ...subjectsOf(DCT_REPLACES),
    ...subjectsOf(`${PROV}invalidated`),
  ])) {
    const refused = await matcherJudgmentTouched(read, triples, subject);
    if (refused !== undefined) return { refused };
  }
  const judgment = judged;
  if (judgment === undefined) return { triples: [...triples], changed: false };
  const of = (predicate: string): string[] =>
    triples.flatMap(([s, p, o]) =>
      s.value === judgment && p.value === predicate ? [o.value] : [],
    );
  const kept = triples.filter(
    ([s, p]) => !(s.value === judgment && p.value === `${PROV}wasDerivedFrom`),
  );
  const verdicts = of(`${CASCADE}verdict`);
  const members = of(`${PROV}hadMember`);
  const unnamed = triples.find(
    ([s, p, o]) =>
      s.value === judgment &&
      p.value === `${PROV}hadMember` &&
      o.termType !== "NamedNode",
  );
  if (unnamed !== undefined)
    return {
      refused: `${written(unnamed[2])} is no IRI: a judgment's members are named by their IRIs`,
    };
  const entry = members.find((member) => member.startsWith(views));
  if (entry !== undefined)
    return {
      refused: `${entry} is a view entry: a judgment is of records, never entries`,
    };
  const acknowledged = verdicts.includes(`${CASCADE}Acknowledged`);
  const named = await memberRefused(read, stated, members, acknowledged);
  if (named !== undefined) return { refused: named };
  const answered = triples.flatMap(([s, p, o]) =>
    s.value === judgment && p.value === `${CASCADE}answersWarningOfKind`
      ? [o]
      : [],
  );
  if (!acknowledged && answered.length > 0)
    return {
      refused: `only an Acknowledged names a kind of warning it answers (cascade:answersWarningOfKind): this one's verdict is ${verdicts.join(", ") || "none"}, and it names ${answered.map(written).join(", ")}`,
    };
  if (acknowledged) {
    const [kind] = answered;
    const known = await kinds();
    if (known.size === 0)
      return {
        refused:
          "an Acknowledged names one kind of warning it answers (cascade:answersWarningOfKind), and the vocabulary names no warning kinds (no concept of cascade:FindingForReviewKinds)",
      };
    if (
      answered.length !== 1 ||
      kind === undefined ||
      kind.termType !== "NamedNode" ||
      !known.has(kind.value)
    )
      return {
        refused: `an Acknowledged names one kind of warning it answers (cascade:answersWarningOfKind), a concept of cascade:FindingForReviewKinds: it names ${answered.length === 0 ? "none" : answered.map(written).join(", ")}`,
      };
    if (PAIR_KINDS.has(kind.value) && new Set(members).size !== 2)
      return {
        refused: `an Acknowledged of ${kind.value} is about a pair and names exactly the pair's two records: it names ${new Set(members).size}`,
      };
  }
  const added: Triple[] = [];
  if (verdicts.some(sawVersions)) {
    const shown = await documentsShownFrom(read, members);
    const documents = new Set([...shown.values()].flatMap((from) => [...from]));
    for (const document of documents)
      added.push([iri(judgment), iri(`${PROV}wasDerivedFrom`), iri(document)]);
  }
  const filed = [...kept, ...added];
  const key = (triple: Triple) => triple.map(written).join(" ");
  const before = new Set(triples.map(key));
  const changed =
    filed.length !== before.size || filed.some((t) => !before.has(key(t)));
  return { triples: changed ? filed : [...triples], changed };
}
