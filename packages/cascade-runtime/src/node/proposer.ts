// What the conformance run does for `When a model proposes {name} and {person} says yes`: it calls this runtime's own tool at
// ask, through a door that asks the person once and is answered as the example says, over a pod being replayed.
import {
  type Graph,
  iri,
  parseStepFile,
  type Performed,
  type Proposer,
  RDF,
} from "@cascade-runtime/runtime";
import { judged } from "../judging.js";
import {
  type Door,
  type PodReads,
  type Proposal,
  proposedTurtle,
  TOOLS,
  type Verdict,
} from "../pod-tools.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const POD = "pod";

/** The tool and the input that propose what `graph` holds: a judgment, a retraction, or else an entry's drafts. */
function callOf(
  graph: Graph,
  text: string,
): { tool: string; input: Record<string, unknown> } {
  const [judgment] = graph.subjects(`${RDF}type`, iri(`${CASCADE}Judgment`));
  if (judgment !== undefined) {
    const [verdict] = graph.objects(judgment, `${CASCADE}verdict`);
    const name = verdict?.value.slice(CASCADE.length) ?? "";
    return {
      tool: "propose_judgment",
      input: {
        pod: POD,
        verdict: name.replace(/^./, (first) => first.toLowerCase()) as Verdict,
        members: graph
          .objects(judgment, `${PROV}hadMember`)
          .map(({ value }) => value),
      },
    };
  }
  const [retraction] = graph.subjects(`${PROV}invalidated`);
  if (retraction !== undefined)
    return {
      tool: "propose_retraction",
      input: {
        pod: POD,
        judgment: graph.objects(retraction, `${PROV}invalidated`)[0]?.value,
      },
    };
  return { tool: "propose_entry", input: { pod: POD, turtle: text } };
}

/**
 * Performs a model's proposal as the conformance run asks: the tool is called with what `proposals/<name>.ttl` holds,
 * through a door that counts how often it asks the person and answers as the example says, and over reads whose `write`
 * files the proposal, as `podReads` does, at the step's time and under a name the step mints.
 */
export const proposer: Proposer = async ({
  pod,
  file,
  answer,
  address,
  layout,
  time,
  newStore,
}) => {
  const text = new TextDecoder().decode(file.bytes);
  const { tool, input } = callOf(await parseStepFile(file, newStore), text);
  let asked = 0;
  let performed: Performed | undefined;
  const door: Door = {
    model: { iri: time.newId(), label: "a model the conformance run plays" },
    ask: async () => {
      asked += 1;
      return answer;
    },
  };
  const reads = {
    async write({ proposal, model }) {
      if (asked !== 1 || answer !== "yes")
        throw new Error(
          `the door wrote ${file.name} without a yes: it asked ${asked} times and the person answered ${answer}`,
        );
      const turtle = proposedTurtle(proposal as Proposal, {
        model,
        owner: `${address}${layout.card}#me`,
        session: time.newId(),
      });
      performed =
        proposal.kind === "entry"
          ? await pod.enter({
              bytes: new TextEncoder().encode(turtle),
              base: address,
              name: "the entry",
            })
          : await judged({ core: pod, newStore, address, time }, turtle);
      return {
        ...(performed.refused === undefined
          ? {}
          : { refused: performed.refused }),
      };
    },
  } as PodReads;
  await TOOLS.find(({ name }) => name === tool)!.run(reads, input, door);
  if (asked !== 1)
    throw new Error(`the door asked ${asked} times for ${file.name}, not once`);
  return performed ?? { wrote: [] };
};
