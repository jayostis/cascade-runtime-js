import type { CorePod } from "./core-pod.js";
import { iri, type Triple } from "./rdf.js";

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

/** The statements naming the documents each member of the judgment was shown from, once each; a member with no version adds none. */
export async function documentsShown(
  core: Pick<CorePod, "select">,
  judgment: string,
  members: readonly string[],
): Promise<Triple[]> {
  const shown = await documentsShownFrom(core, members);
  const documents = new Set([...shown.values()].flatMap((from) => [...from]));
  return [...documents].map((document) => [
    iri(judgment),
    iri(`${PROV}wasDerivedFrom`),
    iri(document),
  ]);
}

/**
 * Why a person's judgment or retraction, `subject` in `triples`, is refused for replacing (`dct:replaces`) or retracting
 * (`prov:invalidated`) a judgment a machine made, one attributed to a `prov:SoftwareAgent` of the pod: it says which, and
 * what to file instead (N16). Nothing when it touches none. The machine's judgment is in the pod, not in `triples`.
 */
export async function machineJudgmentTouched(
  core: Pick<CorePod, "select">,
  triples: readonly Triple[],
  subject: string,
): Promise<string | undefined> {
  const targets = triples.flatMap(([s, p, o]) =>
    s.value === subject &&
    (p.value === DCT_REPLACES || p.value === `${PROV}invalidated`) &&
    o.termType === "NamedNode"
      ? [{ target: o.value, retracts: p.value !== DCT_REPLACES }]
      : [],
  );
  if (targets.length === 0) return undefined;
  const { rows } = await core.select(`PREFIX prov: <${PROV}>
      SELECT DISTINCT ?judgment WHERE {
        VALUES ?judgment { ${targets.map(({ target }) => `<${target}>`).join(" ")} }
        ?judgment prov:wasAttributedTo ?agent . ?agent a prov:SoftwareAgent
      }`);
  const machine = new Set(
    rows.flatMap((row) => row.get("judgment")?.value ?? []),
  );
  const touched = targets.find(({ target }) => machine.has(target));
  return touched === undefined
    ? undefined
    : `${touched.target} is a judgment a machine made: a person ${touched.retracts ? "retracts" : "replaces"} no machine's judgment, and files a Same or a Different over its members instead`;
}
