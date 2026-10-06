import { parseGraph } from "./graph.js";
import { iri, ntriples, RDF } from "./rdf.js";
import { References } from "./references.js";
import { inStory, type Perform, REC } from "./step.js";

const JDG = "https://ns.cascadeprotocol.org/judgments/v1-draft#";

/** A person's judgment: its file, as it is, filed by the judgment's name. */
export const fileJudgment: Perform = async (context) => {
  const { happened } = context.step;
  if (happened.kind !== "judgment") throw new Error("the step is no judgment");
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
  context.writes.add(
    context.layout.place(`${JDG}Judgment`).path(judgment.value),
    bytes,
  );
};

/** A reference version's arrival: what the story's reference index states about it, filed by its name. */
export const fileReference: Perform = async (context) => {
  const { happened } = context.step;
  if (happened.kind !== "reference")
    throw new Error("the step is no reference");
  const references = await References.of(context);
  if (!references.isVersion(happened.name))
    throw new Error(
      `it names ${happened.name}, a version references.ttl does not list`,
    );
  context.writes.add(
    context.layout.version(
      context.layout.place(`${REC}ReferenceSeries`),
      happened.name,
    ),
    ntriples(references.description(happened.name)),
  );
};
