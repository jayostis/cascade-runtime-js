// A person's judgment or retraction as a pod files it: the Turtle an app hands `pod.judge`, kept under the name, the time
// and the author the app gives it (N10), and for a verdict that says something of its members' versions, the document
// each member was shown from, never a version. Shared by the pod and by the run that performs a model's proposal as a step.
import {
  type CorePod,
  FILE_STEM,
  fileStem,
  judgmentFiled,
  type IdsAndTime,
  iri,
  literal,
  ntriples,
  RDF,
  type StoreFactory,
  type Term,
  type Triple,
  XSD,
} from "@cascade-runtime/runtime";
import { THIS_JUDGMENT } from "./proposals.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const TYPE = `${RDF}type`;
const USED = `${PROV}used`;
const GENERATED_AT = `${PROV}generatedAtTime`;
const STARTED_AT = `${PROV}startedAtTime`;

/** What files a judgment: the pod's step, what reads it, and the name and the time a new judgment is given. */
export interface Judging {
  readonly core: Pick<CorePod, "judge" | "select" | "selectStated">;
  readonly newStore: StoreFactory;
  /** The pod's address, which the judgment's Turtle is parsed against. */
  readonly address: string;
  /** The IRI the pod's views are under, which no judgment's member is. */
  readonly views: string;
  readonly time: IdsAndTime;
}

/** What filing a judgment gave: the files written, why the rules refused it, if they did, and its name. */
export type Judged = Awaited<ReturnType<CorePod["judge"]>> & {
  readonly judgment?: string;
};

/** The time a judgment states, which is kept as the app gave it when it is an `xsd:dateTime` that reads as one. */
function datedLiteral(term: Term): Term {
  const lexical =
    /^(-?\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;
  const found = term.termType === "Literal" ? lexical.exec(term.value) : null;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = (
    found?.slice(1) ?? []
  ).map((part) => (part === undefined ? 0 : Number(part)));
  const leap =
    (year ?? 0) % 4 === 0 &&
    ((year ?? 0) % 100 !== 0 || (year ?? 0) % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    (month ?? 0) - 1
  ];
  if (
    term.termType !== "Literal" ||
    term.datatype.value !== `${XSD}dateTime` ||
    found === null ||
    days === undefined ||
    (day ?? 0) < 1 ||
    (day ?? 0) > days ||
    (hour ?? 0) > 23 ||
    (minute ?? 0) > 59 ||
    (second ?? 0) > 59 ||
    (offsetHour ?? 0) > 14 ||
    (offsetMinute ?? 0) > 59 ||
    ((offsetHour ?? 0) === 14 && (offsetMinute ?? 0) > 0)
  )
    throw new Error(
      `the judgment states a time that is no xsd:dateTime: ${term.value}`,
    );
  return term;
}

/** Whether the pod can name a file after `name`: an IRI whose stem is the layout's, a lowercase UUID or a SHA-256 in lowercase hex. */
function placed(name: string): boolean {
  try {
    return FILE_STEM.test(fileStem(name));
  } catch {
    return false;
  }
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What filing the judgment or the retraction `turtle` holds writes: under the IRI it is named by, or a new name when it
 * is named `<urn:cascade:this-judgment>`, at the time it states or else now, and as the pod keeps it (`judgmentFiled`, N16), so that a refusal is told before a step is taken.
 *
 * @throws Error when the Turtle is none, holds more or less than one judgment or retraction, or `judgmentFiled` refuses it.
 */
async function prepared(
  { core, newStore, address, views, time }: Judging,
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
  const [given] = found;
  if (found.length !== 1 || given === undefined)
    throw new Error(
      `the judgment's Turtle holds ${found.length === 0 ? "no judgment or retraction" : found.join(", ")}; it holds one judgment or one retraction`,
    );
  if (stated.some(([s]) => s.value === given && s.termType !== "NamedNode"))
    throw new Error(
      `the judgment's name is a blank node: the app names it with an IRI it minted, or with <${THIS_JUDGMENT}> to have the pod name it`,
    );
  const retracting = retractions.length > 0;
  const name = given === THIS_JUDGMENT ? time.newId() : given;
  if (!placed(name))
    throw new Error(
      `the judgment's name ${name} is no lowercase urn:uuid: IRI: the app names it with a lowercase urn:uuid: it minted, or with <${THIS_JUDGMENT}> to have the pod name it`,
    );
  const judgment = iri(name);
  const [at, ...more] = stated.filter(
    ([s, p]) =>
      s.value === given && p.value === (retracting ? STARTED_AT : GENERATED_AT),
  );
  if (more.length > 0)
    throw new Error(`the judgment states ${more.length + 1} times, not one`);
  const stamp =
    at === undefined
      ? literal(time.now(), `${XSD}dateTime`)
      : datedLiteral(at[2]);
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
            p.value === GENERATED_AT ||
            p.value === STARTED_AT)
        ),
    );
  const filed = await judgmentFiled(core, named, views, {
    select: (query) => core.selectStated(query),
  });
  if ("refused" in filed) throw new Error(filed.refused);
  return {
    name,
    triples: [
      ...filed.triples,
      [judgment, iri(retracting ? STARTED_AT : GENERATED_AT), stamp],
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
