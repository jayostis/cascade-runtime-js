// What a pod says to a write a model proposed before the person is asked, writing nothing: whether the pod would refuse
// it, and what the person is shown of it, read from the pod and not taken from the model's own words.
import {
  OxigraphStore,
  randomId,
  RDF,
  type Triple,
} from "@cascade-runtime/runtime";
import type { Pod } from "../pod.js";
import {
  type ProposalCheck,
  type Model,
  type Proposal,
  proposedTurtle,
  VERDICTS,
  type Verdict,
} from "../propose-tools.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const TYPE = `${RDF}type`;
const SPECIALIZATION_OF = `${PROV}specializationOf`;
const PREFIXES = `PREFIX cascade: <${CASCADE}> PREFIX prov: <${PROV}> PREFIX pav: <http://purl.org/pav/> PREFIX foaf: <http://xmlns.com/foaf/0.1/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>`;

/** The only subjects a model's entry may state things of: a draft, its version, and what a draft's name carries after `#`. */
const DRAFT_SUBJECT = /^urn:cascade:output-(\d+)(-version)?(#.*)?$/;

/** Who proposes, when no one has yet: the check does not depend on it. */
const NO_ONE: Model = {
  iri: "urn:uuid:00000000-0000-4000-8000-000000000000",
  label: "a model",
};

/** Text from a model or a pod as one short line a person reads, which no line break in it can turn into two. */
function oneLine(text: string): string {
  const spaced = text.replace(/\s+/g, " ").trim();
  return spaced.length > 200 ? `${spaced.slice(0, 200)}…` : spaced;
}

/** The words of a term's local name, when the vocabulary gives it no label: `conditionName` as `condition name`. */
function words(term: string): string {
  const local = term.split(/[#/]/).pop() ?? term;
  return local.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

/**
 * An entry's statements as a person reads them: each draft by its class, then what its version states, by the
 * vocabulary's words for each property.
 */
function entryLines(
  statements: readonly Triple[],
  labels: ReadonlyMap<string, string>,
  patient: string,
): string[] {
  const named = (term: string) => labels.get(term) ?? words(term);
  const drafts = new Map<number, Triple[]>();
  for (const triple of statements) {
    const [subject] = triple;
    if (subject.termType !== "NamedNode") continue;
    const found = DRAFT_SUBJECT.exec(subject.value);
    if (found === null) continue;
    const at = Number(found[1]);
    drafts.set(at, [...(drafts.get(at) ?? []), triple]);
  }
  return [...drafts]
    .sort(([a], [b]) => a - b)
    .flatMap(([, triples], at) => {
      const heading = triples
        .filter(([, p]) => p.value === TYPE)
        .map(([, , o]) =>
          named(o.termType === "NamedNode" ? o.value : "entry"),
        );
      const stated = triples
        .filter(([, p]) => p.value !== TYPE && p.value !== SPECIALIZATION_OF)
        .map(([, p, o]) => {
          const value =
            o.termType === "Literal"
              ? oneLine(o.value)
              : o.termType === "NamedNode"
                ? o.value === patient
                  ? "the person this pod is about"
                  : o.value
                : "(more detail)";
          return `- ${oneLine(named(p.value))}: ${value}`;
        });
      return [...(at === 0 ? [] : [""]), heading[0] ?? "Entry", ...stated];
    });
}

/** A record, or a revision, by its label and where it came from, as the pod has it; its IRI only when the pod gives it no label. */
async function recordLine(pod: Pod, record: string): Promise<string> {
  const rows = await pod.ask({
    query: `${PREFIXES}
      SELECT ?label ?importLabel ?documentLabel ?hospital WHERE {
        OPTIONAL { <${record}> rdfs:label ?label }
        OPTIONAL {
          <${record}> cascade:currentRevision ?revision .
          OPTIONAL { ?revision prov:wasGeneratedBy ?import . OPTIONAL { ?import rdfs:label ?importLabel } }
          OPTIONAL { ?revision prov:wasDerivedFrom ?document .
            OPTIONAL { ?document rdfs:label ?documentLabel }
            OPTIONAL { ?document prov:wasAttributedTo/(rdfs:label|pav:hasCurrentVersion/foaf:name) ?hospital } }
        }
      }`,
  });
  const label = rows.map((row) => row.label).find((each) => each !== undefined);
  const from = [
    ...new Set(
      rows.flatMap((row) =>
        [row.hospital, row.documentLabel, row.importLabel].flatMap((each) =>
          each === undefined ? [] : [oneLine(each)],
        ),
      ),
    ),
  ];
  return `- ${label === undefined ? record : oneLine(label)}${from.length === 0 ? "" : ` (${from.join(", ")})`}`;
}

/** What the pod holds of the judgment `judgment`: its verdict and its members, and whether a retraction has set it aside. */
async function judgmentHeld(
  pod: Pod,
  judgment: string,
): Promise<
  | { held: false }
  | { held: true; retracted: boolean; verdict?: Verdict; members: string[] }
> {
  const kinds = await pod.ask({
    query: `${PREFIXES} SELECT ?judgment WHERE { ?judgment a ?kind FILTER (?judgment = <${judgment}> && ?kind IN (cascade:Judgment, cascade:MatcherJudgmentAssertion)) }`,
  });
  if (kinds.length === 0) return { held: false };
  const retractions = await pod.ask({
    query: `${PREFIXES} SELECT ?retraction WHERE { ?retraction prov:invalidated <${judgment}> }`,
  });
  const said = await pod.ask({
    query: `${PREFIXES} SELECT ?verdict ?member WHERE { OPTIONAL { <${judgment}> cascade:verdict ?verdict } OPTIONAL { <${judgment}> prov:hadMember ?member } } ORDER BY ?member`,
  });
  const verdict = VERDICTS.find(
    (each) =>
      `${CASCADE}${each.replace(/^./, (first) => first.toUpperCase())}` ===
      said.find((row) => row.verdict !== undefined)?.verdict,
  );
  return {
    held: true,
    retracted: retractions.length > 0,
    ...(verdict === undefined ? {} : { verdict }),
    members: [
      ...new Set(
        said.flatMap((row) => (row.member === undefined ? [] : [row.member])),
      ),
    ],
  };
}

/**
 * What the pod says to `proposal` before it is written: why it would refuse it, or else what the person is shown of it.
 * Nothing is written.
 */
export async function checkProposal(
  pod: Pod,
  proposal: Proposal,
  model: Model = NO_ONE,
): Promise<ProposalCheck> {
  const recording = { model, owner: pod.owner, session: randomId() };
  if (proposal.kind === "entry") {
    let drafts: readonly Triple[];
    try {
      drafts = await new OxigraphStore().parse(proposal.turtle, pod.address);
    } catch (error) {
      return {
        refused: `the entry is no Turtle: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    for (const [subject] of drafts)
      if (
        subject.termType === "NamedNode" &&
        !DRAFT_SUBJECT.test(subject.value)
      )
        return {
          refused: `an entry states only of its drafts, <urn:cascade:output-0>, <urn:cascade:output-1> and so on, their versions and what follows # in their names; it states of ${subject.value}`,
        };
    const checked = await pod.checkEntry(proposedTurtle(proposal, recording));
    if (checked.refused !== undefined) return { refused: checked.refused };
    return {
      shown: entryLines(
        checked.statements ?? [],
        checked.labels ?? new Map(),
        pod.subject,
      ),
    };
  }
  let verdict: Verdict | undefined;
  let members: readonly string[];
  if (proposal.kind === "retraction") {
    const held = await judgmentHeld(pod, proposal.judgment);
    if (!held.held)
      return {
        refused: `the pod holds no judgment ${proposal.judgment} to retract`,
      };
    if (held.retracted)
      return {
        refused: `the judgment ${proposal.judgment} is already retracted`,
      };
    ({ members } = held);
    verdict = held.verdict;
  } else members = proposal.members;
  const refused = await pod.checkJudgment(proposedTurtle(proposal, recording));
  if (refused !== undefined) return { refused };
  return {
    shown: await Promise.all(members.map((member) => recordLine(pod, member))),
    ...(verdict === undefined ? {} : { verdict }),
  };
}
