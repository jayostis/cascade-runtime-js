import type { CorePod } from "./core-pod.js";
import { iri, RDF, type Triple, written } from "./rdf.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const DCT_REPLACES = "http://purl.org/dc/terms/replaces";
/** The verdicts that say something of their members' versions, which name the document each member was shown from. */
const SEEN = new Set(
  ["Same", "Different", "Erroneous"].map((v) => CASCADE + v),
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

/** Whether the pod holds the thing as a finding for review, which has no versions: a Same may name one alone. */
async function isFinding(
  read: Pick<CorePod, "select">,
  thing: string,
): Promise<boolean> {
  const { rows } = await read.select(`PREFIX cascade: <${CASCADE}>
      SELECT ?thing WHERE { BIND (<${thing}> AS ?thing) ?thing a cascade:FindingForReview }`);
  return rows.length > 0;
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
 * for a member that is an entry of a view, an IRI under `views`, which no judgment is of, or for a verdict that says
 * something of its members' versions, for a member that is a finding; else its triples with the document each member was
 * shown from, and none the input states for the judgment itself. A member the pod does not hold is kept: it names no
 * document, and a restore or a rebuild may bring it back. `changed` is false when those are the triples it was given.
 */
export async function judgmentFiled(
  read: Pick<CorePod, "select">,
  triples: readonly Triple[],
  views: string,
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
    const taken = await nameTaken(read, name, judged === undefined);
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
  const entry = members.find((member) => member.startsWith(views));
  if (entry !== undefined)
    return {
      refused: `${entry} is a view entry: a judgment is of records, never entries`,
    };
  const [only] = members;
  const overFinding =
    verdicts.length === 1 &&
    verdicts[0] === `${CASCADE}Same` &&
    members.length === 1 &&
    only !== undefined &&
    (await isFinding(read, only));
  const added: Triple[] = [];
  if (!overFinding && verdicts.some(sawVersions)) {
    const shown = await documentsShownFrom(read, members);
    for (const member of members)
      if (!shown.has(member) && (await isFinding(read, member)))
        return {
          refused: `${member} is a finding for review: a Same may name one alone, and no other verdict may name one`,
        };
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
