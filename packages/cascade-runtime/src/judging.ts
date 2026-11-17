// A person's judgment or retraction as a pod files it: the Turtle an app hands `pod.judge`, given the name and the time of
// its own, and for a verdict that says something of its members' versions, the document each member was shown from, never
// a version. Shared by the pod and by the run that performs a model's proposal as a step.
import {
  type CorePod,
  documentsShownFrom,
  machineJudgmentTouched,
  sawVersions,
  type IdsAndTime,
  iri,
  literal,
  ntriples,
  RDF,
  type StoreFactory,
  type Triple,
  XSD,
} from "@cascade-runtime/runtime";
import { THIS_JUDGMENT } from "./proposals.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const TYPE = `${RDF}type`;
const USED = `${PROV}used`;
const DERIVED_FROM = `${PROV}wasDerivedFrom`;
const GENERATED_AT = `${PROV}generatedAtTime`;
const STARTED_AT = `${PROV}startedAtTime`;
const PREFIXES = `PREFIX cascade: <${CASCADE}> PREFIX prov: <${PROV}> PREFIX pav: <${PAV}> PREFIX bridge: <${BRIDGE}>`;

/** What files a judgment: the pod's step, what reads it, and the name and the time a new judgment is given. */
export interface Judging {
  readonly core: Pick<CorePod, "judge" | "select">;
  readonly newStore: StoreFactory;
  /** The pod's address, which the judgment's Turtle is parsed against. */
  readonly address: string;
  readonly time: IdsAndTime;
}

/** What filing a judgment gave: the files written, why the rules refused it, if they did, and its name. */
export type Judged = Awaited<ReturnType<CorePod["judge"]>> & {
  readonly judgment?: string;
};

/** Whether the pod holds the thing as a finding for review, which has no versions: a Same may name one alone. */
async function isFinding(
  core: Pick<CorePod, "select">,
  thing: string,
): Promise<boolean> {
  const { rows } = await core.select(`${PREFIXES}
      SELECT ?thing WHERE { BIND (<${thing}> AS ?thing) ?thing a cascade:FindingForReview }`);
  return rows.length > 0;
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What filing the judgment or the retraction `turtle` holds writes, named `<urn:cascade:this-judgment>` in it: under a
 * new name, at the time now, and for a verdict that says something of its members' versions, naming the version each was at.
 *
 * @throws Error when the Turtle is none, holds more or less than one judgment or retraction, or names a member the pod
 *   holds no version of.
 */
async function prepared(
  { core, newStore, address, time }: Judging,
  turtle: string,
): Promise<{ name: string; triples: Triple[] }> {
  let stated: Triple[];
  try {
    stated = await newStore().parse(turtle, address);
  } catch (error) {
    throw new Error(`the judgment is no Turtle: ${failure(error)}`, {
      cause: error,
    });
  }
  const judgments = stated
    .filter(([, p, o]) => p.value === TYPE && o.value === `${CASCADE}Judgment`)
    .map(([s]) => s.value);
  const retractions = stated
    .filter(([, p]) => p.value === `${PROV}invalidated`)
    .map(([s]) => s.value);
  const found = [...new Set([...judgments, ...retractions])];
  if (found.length !== 1 || found[0] !== THIS_JUDGMENT)
    throw new Error(
      `the judgment's Turtle holds ${found.length === 0 ? "no judgment or retraction" : found.join(", ")}; it holds one judgment or one retraction, named <${THIS_JUDGMENT}>`,
    );
  const retracting = retractions.length > 0;
  const name = time.newId();
  const judgment = iri(name);
  const named = stated
    .map(
      (triple) =>
        triple.map((term) =>
          term.termType === "NamedNode" && term.value === THIS_JUDGMENT
            ? judgment
            : term,
        ) as unknown as Triple,
    )
    .filter(
      ([s, p]) =>
        !(
          s.value === name &&
          (p.value === USED ||
            p.value === DERIVED_FROM ||
            p.value === GENERATED_AT ||
            p.value === STARTED_AT)
        ),
    );
  const of = (predicate: string): string[] =>
    named.flatMap(([s, p, o]) =>
      s.value === name && p.value === predicate && o.termType === "NamedNode"
        ? [o.value]
        : [],
    );
  const touched = await machineJudgmentTouched(core, named, name);
  if (touched !== undefined) throw new Error(touched);
  const used: Triple[] = [];
  const verdicts = of(`${CASCADE}verdict`);
  const members = of(`${PROV}hadMember`);
  const [only] = members;
  const overFinding =
    verdicts.length === 1 &&
    verdicts[0] === `${CASCADE}Same` &&
    members.length === 1 &&
    only !== undefined &&
    (await isFinding(core, only));
  if (!overFinding && verdicts.some(sawVersions)) {
    const current = await documentsShownFrom(core, members);
    for (const member of members) {
      const documents = current.get(member);
      if (documents === undefined)
        throw new Error(
          `${member} has no current version in the pod: it names no record or revision`,
        );
      for (const document of documents)
        if (!used.some(([, , o]) => o.value === document))
          used.push([judgment, iri(DERIVED_FROM), iri(document)]);
    }
  }
  return {
    name,
    triples: [
      ...named,
      ...used,
      [
        judgment,
        iri(retracting ? STARTED_AT : GENERATED_AT),
        literal(time.now(), `${XSD}dateTime`),
      ],
    ],
  };
}

/**
 * Files the judgment or the retraction `turtle` holds, named `<urn:cascade:this-judgment>` in it.
 *
 * @throws Error as `checkJudgment` does.
 */
export async function judged(
  judging: Judging,
  turtle: string,
): Promise<Judged> {
  const { name, triples } = await prepared(judging, turtle);
  const filed = await judging.core.judge({
    bytes: ntriples(triples),
    base: judging.address,
    name: "the judgment",
  });
  return filed.refused === undefined ? { ...filed, judgment: name } : filed;
}

/**
 * Why filing the judgment or the retraction `turtle` holds would fail before the pod's rules are asked, or nothing
 * when it would not; nothing is written.
 */
export async function checkJudgment(
  judging: Judging,
  turtle: string,
): Promise<string | undefined> {
  try {
    await prepared(judging, turtle);
  } catch (error) {
    return failure(error);
  }
  return undefined;
}
