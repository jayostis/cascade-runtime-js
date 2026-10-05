import { readText } from "./files.js";
import { parseGraph } from "./graph.js";
import { FOLDERS, fanned } from "./layout.js";
import { iri, literal, ntriples, RDF, type Triple } from "./rdf.js";
import { inStory, type Perform } from "./step.js";

const JDG = "https://ns.cascadeprotocol.org/judgments/v1-draft#";
const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const REFERENCES = "scripted-input/references/references.json";

interface ReferenceVersion {
  readonly name: string;
  readonly version: string;
  readonly revises?: string;
}

interface ReferenceSeries {
  readonly name: string;
  readonly versions: readonly ReferenceVersion[];
}

/** A person's judgment: its file, as it is, filed by the judgment's name. */
export const fileJudgment: Perform = async (context) => {
  const { happened } = context.step;
  if (happened.kind !== "judgment")
    throw new Error(`step ${context.step.name} is no judgment`);
  const path = inStory(context, happened.file);
  const bytes = await context.source.read(path);
  if (bytes === undefined)
    throw new Error(`${context.source.iri}${path} does not exist`);
  const judgments = (
    await parseGraph(bytes, context.source.iri + path, context.newStore)
  ).subjects(`${RDF}type`, iri(`${JDG}Judgment`));
  const [judgment] = judgments;
  if (judgments.length !== 1 || judgment === undefined)
    throw new Error(
      `${happened.file} holds ${judgments.length} judgments, not one`,
    );
  context.writes.add(fanned(FOLDERS.judgments, judgment.value), bytes);
};

/** A reference version's arrival: its description, as the story's reference tables list it, filed by its name. */
export const fileReference: Perform = async (context) => {
  const { happened } = context.step;
  if (happened.kind !== "reference")
    throw new Error(`step ${context.step.name} is no reference`);
  const { series } = JSON.parse(
    await readText(context.source, inStory(context, REFERENCES)),
  ) as { series: readonly ReferenceSeries[] };
  for (const { name: seriesName, versions } of series) {
    const found = versions.find(({ name }) => name === happened.name);
    if (found === undefined) continue;
    const version = iri(found.name);
    const triples: Triple[] = [
      [version, iri(`${RDF}type`), iri(`${PROV}Entity`)],
      [version, iri(`${PROV}specializationOf`), iri(seriesName)],
      [version, iri(`${PAV}version`), literal(found.version)],
      ...versions
        .filter(({ version: other }) => other === found.revises)
        .map(({ name }): Triple => [
          version,
          iri(`${PROV}wasRevisionOf`),
          iri(name),
        ]),
    ];
    context.writes.add(
      fanned(FOLDERS.references, found.name),
      ntriples(triples),
    );
    return;
  }
  throw new Error(`${REFERENCES} lists no reference version ${happened.name}`);
};
