// What a model proposes to write to a pod, shown to the person and, on their yes, recorded: the Turtle a host files for
// an entry, a judgment or a retraction a model proposed, naming the model and the person who said yes (runtime/consent.feature,
// Y3). Nothing here reads or writes a pod: the tools of `pod-tools.ts` ask the person, and a host's `PodReads.write` files.
import { Refusal } from "@cascade-runtime/runtime/refusal";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";

/** What an app hands `Pod.judge` in place of the judgment's name, which the pod mints. */
export const THIS_JUDGMENT = "urn:cascade:this-judgment";

/** What the person said to a question a door asked: a yes, a no, a dismissed question, or no answer before the door stopped waiting. */
export type Answer = "yes" | "no" | "dismissed" | "unanswered";

/** The model a door is serving: named by an IRI of the door's choosing, never the runtime's, and labelled with what the door knows of it. */
export interface Model {
  readonly iri: string;
  readonly label: string;
}

/** The verdicts a model may propose, by the local name in `cascade:` that each is, lower-cased. */
export const VERDICTS = ["same", "different", "erroneous"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** A write a model proposes: an entry's drafts as Turtle, a judgment of records, or the retraction of a judgment. */
export type Proposal =
  | { readonly kind: "entry"; readonly turtle: string }
  | {
      readonly kind: "judgment";
      readonly verdict: Verdict;
      readonly members: readonly string[];
    }
  | { readonly kind: "retraction"; readonly judgment: string };

/** What a host answers of a write it filed, or refused. */
export interface Written {
  /** Why the pod's rules refused it, when they did; nothing was written. */
  readonly refused?: string;
  /** The entry's session, the judgment or the retraction, by the name the pod gave it. */
  readonly id?: string;
}

/** What turns a proposal into the Turtle a host files: who proposed it, who said yes, and the session's name for an entry. */
export interface Recording {
  readonly model: Model;
  /** The pod's owner, who said yes: `<pod address>profile/card.ttl#me`. */
  readonly owner: string;
  /** The new name of an entry's session, a random `urn:uuid:` the host mints. */
  readonly session?: string;
}

const IRI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]+$/;

/** @throws Refusal when `value` is no IRI an entry or a judgment can name. */
export function checkIri(value: unknown, at: string): asserts value is string {
  if (typeof value !== "string" || !IRI.test(value))
    throw new Refusal(`${at} must be an IRI, as the pod names it`);
}

/** A string as a Turtle literal. */
function quoted(text: string): string {
  return `"${text
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")}"`;
}

/**
 * What a write a model proposed records, in the Turtle a host files (Y3): the act that wrote it has an association in
 * `cascade:ModelProposerRole` whose agent is the model, a `prov:SoftwareAgent` typed in the same file, and one in
 * `cascade:PatientRole` whose agent is the owner, who said yes, a `prov:Person`. A judgment is attributed to the owner,
 * and a retraction associated with them, as the owner's own are. The host adds the time, and for a judgment or a
 * retraction the name, which stands for it as `urn:cascade:this-judgment`.
 *
 * @throws Refusal when an entry's `session` is not given.
 */
export function proposedTurtle(
  proposal: Proposal,
  { model, owner, session }: Recording,
): string {
  const associations = `prov:qualifiedAssociation
      [ prov:agent <${model.iri}> ; prov:hadRole cascade:ModelProposerRole ] ,
      [ prov:agent <${owner}> ; prov:hadRole cascade:PatientRole ]`;
  const agents = `<${owner}> a prov:Person .
<${model.iri}> a prov:SoftwareAgent ; rdfs:label ${quoted(model.label)} .
`;
  const prefixes = `@prefix cascade: <${CASCADE}> .
@prefix prov: <${PROV}> .
@prefix rdfs: <${RDFS}> .
`;
  switch (proposal.kind) {
    case "entry":
      if (session === undefined)
        throw new Refusal("an entry's session needs a name");
      return `${proposal.turtle}
${prefixes}<${session}> a cascade:HandEntrySession , prov:Activity ;
  rdfs:label "entered by a model, which the person said yes to" ;
  ${associations} .
${agents}`;
    case "judgment":
      return `${prefixes}<${THIS_JUDGMENT}> a cascade:Judgment ;
  cascade:verdict cascade:${proposal.verdict.replace(/^./, (first) => first.toUpperCase())} ;
  prov:hadMember ${proposal.members.map((member) => `<${member}>`).join(" , ")} ;
  prov:wasAttributedTo <${owner}> ;
  prov:wasGeneratedBy [ ${associations} ] .
${agents}`;
    case "retraction":
      return `${prefixes}<${THIS_JUDGMENT}> a prov:Activity ;
  prov:invalidated <${proposal.judgment}> ;
  prov:wasAssociatedWith <${owner}> ;
  ${associations} .
${agents}`;
  }
}

const SAID: Record<Verdict, string> = {
  same: "the same thing",
  different: "different things",
  erroneous: "entered in error",
};

/** What the person is shown before they are asked: who proposes what, for which pod, and that nothing is written without their yes. */
export function describeProposal(
  pod: string,
  proposal: Proposal,
  model: Model,
): string {
  const what =
    proposal.kind === "entry"
      ? `to add this entry to the pod ${pod}:\n\n${proposal.turtle.trim()}`
      : proposal.kind === "judgment"
        ? `to record in the pod ${pod}, as your judgment, that these records are ${SAID[proposal.verdict]}:\n\n${proposal.members.map((member) => `- ${member}`).join("\n")}`
        : `to retract, in the pod ${pod}, your judgment ${proposal.judgment}, which sets aside what it said`;
  return `${model.label} proposes ${what}\n\nSay yes to write it; nothing is written otherwise.`;
}
