import type { CorePod } from "./core-pod.js";
import { iri, ntriples, RDF, type Term, type Triple, written } from "./rdf.js";
import { type References, tableTerms } from "./references.js";
import type { Shapes } from "./shapes.js";
import { judgmentFiled } from "./shown.js";
import {
  parseStepFile,
  CASCADE,
  Refusal,
  type StepContext,
  type StepFile,
} from "./step.js";

const FOAF = "http://xmlns.com/foaf/0.1/";
const PROV = "http://www.w3.org/ns/prov#";
const PIM = "http://www.w3.org/ns/pim/space#";
const SOLID = "http://www.w3.org/ns/solid/terms#";

/**
 * Rule A13: the pod's creation writes the subject as a cascade:Subject, the owner's profile, saying who the owner is and
 * where the pod's root and the preferences file are, and the preferences file, saying where the type index is.
 */
export async function fileCreation(context: StepContext): Promise<void> {
  const { layout, subject, address, writes } = context;
  const type = iri(`${RDF}type`);
  writes.add(
    layout.place(`${CASCADE}Subject`).path(subject),
    ntriples([[iri(subject), type, iri(`${CASCADE}Subject`)]]),
  );
  const owner = iri(`${address}${layout.card}#me`);
  const preferences = iri(address + layout.preferences);
  writes.add(
    layout.card,
    ntriples([
      [owner, type, iri(`${FOAF}Person`)],
      [owner, type, iri(`${PROV}Person`)],
      [owner, iri(`${PIM}storage`), iri(address)],
      [owner, iri(`${PIM}preferencesFile`), preferences],
    ]),
  );
  writes.add(
    layout.preferences,
    ntriples([
      [preferences, type, iri(`${PIM}ConfigurationFile`)],
      [owner, iri(`${SOLID}privateTypeIndex`), iri(address + layout.typeIndex)],
    ]),
  );
}

/**
 * A person's judgment or retraction, filed by its name (N10), a retraction where the layout files what states
 * prov:invalidated: as N16 keeps it (`judgmentFiled`), which is its file as it is when that changes nothing. `read` is
 * the pod as the matcher reads it.
 */
export async function fileJudgment(
  context: StepContext,
  judgment: StepFile,
  read: Pick<CorePod, "select">,
  shapes: () => Promise<Shapes>,
): Promise<void> {
  const graph = await parseStepFile(judgment, context.newStore);
  const judgments = graph.subjects(`${RDF}type`, iri(`${CASCADE}Judgment`));
  const retractions = graph
    .subjects(`${PROV}invalidated`)
    .filter(
      (s) => graph.match(s, `${RDF}type`, iri(`${PROV}Activity`)).length > 0,
    );
  const found = [...judgments, ...retractions];
  const [one] = found;
  if (found.length !== 1 || one === undefined)
    throw new Refusal(
      `${judgment.name} holds ${judgments.length} judgments and ${retractions.length} retractions, not one of either`,
    );
  const { layout } = context;
  const placement =
    judgments.length === 1
      ? layout.place(`${CASCADE}Judgment`)
      : layout.place(
          `${PROV}Activity`,
          graph.match(one).map(([, p]) => p.value),
        );
  const filed = await judgmentFiled(
    read,
    graph.triples,
    context.address + context.layout.viewsFolder,
    { select: (query) => context.selectStated(query) },
    shapes,
    async () =>
      (await tableTerms(context.vocabulary, context.newStore)).findingKinds,
  );
  if ("refused" in filed) throw new Refusal(filed.refused);
  const path = placement.path(one.value);
  const held = await context.pod.read(path);
  if (held !== undefined) {
    const before = await parseStepFile(
      { ...judgment, bytes: held },
      context.newStore,
    );
    if (
      statedOf(before.triples, one.value) !== statedOf(filed.triples, one.value)
    )
      throw new Refusal(
        `${one.value} names a judgment the pod holds already, and this one states something else: a retry states the same`,
      );
    return;
  }
  context.writes.add(
    path,
    filed.changed ? ntriples(filed.triples) : judgment.bytes,
  );
}

/**
 * What a judgment states that a retry states again: every triple whose subject is named, but the judgment's own time and
 * the documents it was shown from (a retry meets a pod that may have changed, and may state no time), a blank node being
 * what it states, whatever its label: the qualified association that says who authored it and in what role is compared.
 */
function statedOf(triples: readonly Triple[], judgment: string): string {
  const own = new Set([
    `${PROV}wasDerivedFrom`,
    `${PROV}generatedAtTime`,
    `${PROV}startedAtTime`,
  ]);
  const described = (term: Term, visiting: readonly string[]): string => {
    if (term.termType !== "BlankNode") return written(term);
    if (visiting.includes(term.value)) return "_:";
    return `[${triples
      .filter(([s]) => s.termType === "BlankNode" && s.value === term.value)
      .map(
        ([, p, o]) =>
          `${written(p)} ${described(o, [...visiting, term.value])}`,
      )
      .sort()
      .join("; ")}]`;
  };
  return triples
    .filter(
      ([s, p]) =>
        s.termType === "NamedNode" &&
        !(s.value === judgment && own.has(p.value)),
    )
    .map(([s, p, o]) => `${written(s)} ${written(p)} ${described(o, [])}`)
    .sort()
    .join("\n");
}

/** A reference version's arrival: what the reference index states about it, filed by its name. */
export async function fileReference(
  context: StepContext,
  references: References,
  version: string,
): Promise<void> {
  if (!references.isVersion(version))
    throw new Refusal(
      `it names ${version}, a version references.ttl does not list`,
    );
  context.writes.add(
    context.layout.version(
      context.layout.place(`${CASCADE}ReferenceSeries`),
      version,
    ),
    ntriples(await references.podDescription(version)),
  );
}
