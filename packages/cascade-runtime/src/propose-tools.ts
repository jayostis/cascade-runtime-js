// `cascade-runtime/tools/propose`: the tools a model proposes a write with, each at the tier `ask`: the person is shown what a call
// will do, through the door it is called through (`Door.ask`), and the write is filed only on their yes. They are not in
// `TOOLS`, which every door may offer: a door that cannot ask the person is offered none of these, and a door offers them
// by choosing to import this module.
import { Refusal } from "@cascade-runtime/runtime/refusal";
import {
  checked,
  type DeclaredTool,
  PROVENANCE_QUESTION,
  type OfferedTool,
  TOOLS,
  type PodTool,
  type ToolInput,
} from "./pod-tools.js";
import {
  checkIri,
  describeProposal,
  type Proposal,
  VERDICTS,
  type Verdict,
} from "./proposals.js";

export {
  describeProposal,
  proposedTurtle,
  THIS_JUDGMENT,
  VERDICTS,
} from "./proposals.js";
export type {
  Answer,
  Model,
  Proposal,
  Recording,
  Verdict,
  Written,
} from "./proposals.js";

/** `members` as a judgment of `verdict` takes them: IRIs, at least two for a verdict that compares and one for one that does not. */
function membersOf(verdict: Verdict, members: unknown): string[] {
  const named = members as unknown[];
  const least = verdict === "erroneous" ? 1 : 2;
  if (named.length < least)
    throw new Refusal(
      `a judgment that records are ${verdict} names at least ${least} of them`,
    );
  named.forEach((member, at) => checkIri(member, `members[${at}]`));
  return named as string[];
}

/**
 * The `run` of a tool that proposes a write: it makes the proposal from the input, shows the person it through the
 * door and asks once, and files it through the host's `write` only on their yes, naming the door's model as its proposer.
 * A no, a dismissed question or no answer files nothing, and says so.
 *
 * @throws Refusal when the door cannot ask, or names no model, or the host writes nothing, or the input is no proposal.
 */
function proposing(
  proposalOf: (input: ToolInput) => Proposal,
): DeclaredTool["run"] {
  return async (reads, input, door) => {
    const proposal = proposalOf(input);
    if (door?.ask === undefined)
      throw new Refusal(
        "this door cannot ask the person, and a write is made only when they say yes",
      );
    if (door.model === undefined)
      throw new Refusal(
        "this door names no model, so what it writes could not say who proposed it",
      );
    if (reads.write === undefined)
      throw new Refusal("this host writes to no pod");
    const pod = input.pod as string;
    const said = await door.ask(describeProposal(pod, proposal, door.model));
    if (said !== "yes") return { written: false, said };
    const { refused, id } = await reads.write({
      pod,
      proposal,
      model: door.model,
    });
    return refused === undefined
      ? { written: true, ...(id === undefined ? {} : { id }) }
      : { written: false, refused };
  };
}

const PROPOSAL_ANSWERS =
  "It asks the person, through the client, to say yes to this one call, and writes nothing without it: the answer is { written: true, id }, or { written: false, said } when they said no, dismissed the question or left it unanswered, or { written: false, refused } when the pod's rules refuse it. The pod records that you proposed it and that the person said yes, so give no author, session or time.";

const DECLARED: DeclaredTool[] = [
  {
    name: "propose_entry",
    description: `Proposes adding an entry to a pod: one or more records the person has told you of, as Turtle. Each draft is <urn:cascade:output-0>, <urn:cascade:output-1> and so on, typed with its class (for example cascade:ProblemOrDiagnosis or cascade:AllergyOrIntolerance), and has a version <urn:cascade:output-0-version> that is a prov:specializationOf it and states what is entered (cascade:conditionName, cascade:clinicalStatus, cascade:allergen and so on) and cascade:patient, the person the pod is about. ${PROPOSAL_ANSWERS}`,
    inputSchema: {
      type: "object",
      properties: {
        turtle: {
          type: "string",
          description:
            "The entry's drafts and their versions, as Turtle with its prefixes declared.",
        },
      },
      required: ["turtle"],
      additionalProperties: false,
    },
    kind: "WritingToAPod",
    ofPod: true,
    run: proposing(({ turtle }) => {
      if (!(turtle as string).includes("urn:cascade:output-"))
        throw new Refusal(
          "turtle holds no draft: name each <urn:cascade:output-0>, <urn:cascade:output-1> and so on",
        );
      return { kind: "entry", turtle: turtle as string };
    }),
  },
  {
    name: "propose_judgment",
    description: `Proposes a judgment of records the pod holds, in the person's name: that records are the same thing, different things, or entered in error. A record is named by its IRI, as ask's rows give it (a row names its entry, and ${PROVENANCE_QUESTION} gives its records). ${PROPOSAL_ANSWERS}`,
    inputSchema: {
      type: "object",
      properties: {
        verdict: {
          type: "string",
          description:
            "same: the records are one thing; different: they are not, although they may look alike; erroneous: the record was entered in error.",
          enum: [...VERDICTS],
        },
        members: {
          type: "array",
          description:
            "The records' IRIs: at least two for same and different, one for erroneous.",
          items: { type: "string" },
        },
      },
      required: ["verdict", "members"],
      additionalProperties: false,
    },
    kind: "WritingToAPod",
    ofPod: true,
    run: proposing(({ verdict, members }) => ({
      kind: "judgment",
      verdict: verdict as Verdict,
      members: membersOf(verdict as Verdict, members),
    })),
  },
  {
    name: "propose_retraction",
    description: `Proposes retracting a judgment of the person's, which sets aside what it said. The judgment is named by its IRI. ${PROPOSAL_ANSWERS}`,
    inputSchema: {
      type: "object",
      properties: {
        judgment: {
          type: "string",
          description: "The IRI of the judgment to retract.",
        },
      },
      required: ["judgment"],
      additionalProperties: false,
    },
    kind: "WritingToAPod",
    ofPod: true,
    run: proposing(({ judgment }) => {
      checkIri(judgment, "judgment");
      return { kind: "retraction", judgment };
    }),
  },
];

/**
 * The tools that propose a write, each `{ name, description, inputSchema, kind, tier, ofPod, run(reads, input, door) }` as
 * a tool of `TOOLS` is. `run` files a write through `reads.write` only when `door.ask` shows the person what the call
 * will do and they say yes, and names `door.model` as the proposer.
 */
export const PROPOSAL_TOOLS: readonly PodTool[] = DECLARED.map(checked);

/** The tools a door offers a model: those of `TOOLS`, and, only where the door can ask the person, `PROPOSAL_TOOLS`. */
export const toolsFor = ({
  canAsk,
}: {
  canAsk: boolean;
}): readonly PodTool[] => (canAsk ? [...TOOLS, ...PROPOSAL_TOOLS] : TOOLS);

/**
 * The tools a door offers a model, as the conformance run lists them: for a door that can ask the person, every tool of
 * `TOOLS` and `PROPOSAL_TOOLS`, and for one that cannot, only those of `TOOLS`.
 */
export const offeredToolsOf = ({ canAsk = true } = {}): OfferedTool[] =>
  toolsFor({ canAsk }).map(({ name, kind, tier }) => ({
    name,
    kind: `https://ns.cascadeprotocol.org/cascade#${kind}`,
    tier,
  }));
