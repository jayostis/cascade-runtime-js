import { parseStepFile } from "./graph.js";
import { iri, ntriples, RDF } from "./rdf.js";
import type { References } from "./references.js";
import { REC, Refusal, type StepContext, type StepFile } from "./step.js";

const JDG = "https://ns.cascadeprotocol.org/judgments/v1-draft#";
const FOAF = "http://xmlns.com/foaf/0.1/";
const PROV = "http://www.w3.org/ns/prov#";
const PIM = "http://www.w3.org/ns/pim/space#";
const SOLID = "http://www.w3.org/ns/solid/terms#";

/**
 * Rule A13: the pod's creation writes the subject as a rec:Subject, the owner's profile, saying who the owner is and
 * where the pod's root and the preferences file are, and the preferences file, saying where the type index is.
 */
export async function fileCreation(context: StepContext): Promise<void> {
  const { layout, subject, address, writes } = context;
  const type = iri(`${RDF}type`);
  writes.add(
    layout.place(`${REC}Subject`).path(subject),
    ntriples([[iri(subject), type, iri(`${REC}Subject`)]]),
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

/** A person's judgment: its file, as it is, filed by the judgment's name. */
export async function fileJudgment(
  context: StepContext,
  judgment: StepFile,
): Promise<void> {
  const judgments = (await parseStepFile(judgment, context.newStore)).subjects(
    `${RDF}type`,
    iri(`${JDG}Judgment`),
  );
  const [found] = judgments;
  if (judgments.length !== 1 || found === undefined)
    throw new Refusal(
      `${judgment.name} holds ${judgments.length} judgments, not one`,
    );
  context.writes.add(
    context.layout.place(`${JDG}Judgment`).path(found.value),
    judgment.bytes,
  );
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
      context.layout.place(`${REC}ReferenceSeries`),
      version,
    ),
    ntriples(references.description(version)),
  );
}
