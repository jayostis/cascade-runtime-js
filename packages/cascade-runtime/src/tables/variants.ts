import { codeIri, Graph, iri, readText } from "@cascade-runtime/runtime";
import { type Row, rowsAbout, SKOS, values } from "../rows.js";
import { CLASSIFICATIONS, RDFS, REC } from "./constants.js";
import type {
  ClassificationRow,
  Concept,
  TablesContext,
  TablesOptions,
  VariantAsked,
  WhatClinVarSays,
} from "./types.js";

const RECORDS = "ontologies/records/v1-draft/records.ttl";

export async function variantClassification(
  context: TablesContext,
  variant: VariantAsked,
): Promise<WhatClinVarSays> {
  const [references, { codeSystems }] = await Promise.all([
    context.references(),
    context.terms(),
  ]);
  const held = context.currentOf(references, CLASSIFICATIONS).map((fact) => ({
    ...fact,
    genes: references.index
      .objects(iri(fact.version), `${REC}coversGene`)
      .map(({ value }) => value),
  }));
  const [first] = held;
  if (first === undefined) return { found: "no series" };
  const stem = (system: string): string => {
    const found = codeSystems.find((each) => each.iri === `${REC}${system}`);
    if (found === undefined)
      throw new Error(`the vocabulary registers no code system rec:${system}`);
    return found.uriSpace;
  };
  const codes =
    variant.variations.length > 0
      ? variant.variations.map((each) => codeIri(stem("ClinVar"), each))
      : variant.hgvs.map((each) => codeIri(stem("HGVS"), each));
  const answer = async (
    one: (typeof held)[number],
  ): Promise<WhatClinVarSays> => {
    const index = await context.indexes.codesIn(one.version);
    const subjects = new Set(codes.flatMap((code) => index.get(code) ?? []));
    const [subject, ...others] = subjects;
    const { series, version } = one;
    if (subject === undefined || others.length > 0)
      return { found: "not found", series, version };
    return {
      found: "rows",
      series,
      version,
      rows: [
        await classificationRow(
          context,
          subject,
          rowsAbout(await context.indexes.text(version), subject),
        ),
      ],
    };
  };
  const read = async (
    among: readonly (typeof held)[number][],
  ): Promise<WhatClinVarSays | undefined> => {
    for (const one of among) {
      const answered = await answer(one);
      if (answered.found === "rows") return answered;
    }
    return undefined;
  };
  if (variant.gene === undefined)
    return (
      (await read(held)) ?? {
        found: "not found",
        series: first.series,
        version: first.version,
      }
    );
  const covering = held.find(({ genes }) => genes.includes(variant.gene!));
  if (covering !== undefined) return answer(covering);
  const unnamed = await read(held.filter(({ genes }) => genes.length === 0));
  if (unnamed !== undefined) return unnamed;
  const stating = held.find(({ genes }) => genes.length > 0);
  return stating === undefined
    ? { found: "not found", series: first.series, version: first.version }
    : {
        found: "not covered",
        series: stating.series,
        version: stating.version,
        genes: [...stating.genes].sort(),
      };
}

/** A variant classifications row, read from the lines of its subject. */
export async function classificationRow(
  context: TablesContext,
  variation: string,
  rows: readonly Row[],
): Promise<ClassificationRow> {
  const classes = values(rows, `${REC}clinvarClassification`);
  const [status] = values(rows, `${REC}clinvarReviewStatus`);
  const [evaluated] = values(rows, `${REC}lastEvaluated`);
  const [contributing] = values(rows, `${REC}contributingSubmitters`);
  const [submitters] = values(rows, `${REC}submitters`);
  const named = await context.labels([...classes, ...(status ? [status] : [])]);
  const concept = (each: string): Concept => ({
    iri: each,
    label: named.get(each) ?? each,
  });
  return {
    variation,
    classification: classes.map(concept),
    ...(status === undefined ? {} : { reviewStatus: concept(status) }),
    ...(evaluated === undefined ? {} : { lastEvaluated: evaluated }),
    ...(contributing === undefined
      ? {}
      : { contributingSubmitters: Number(contributing) }),
    ...(submitters === undefined ? {} : { submitters: Number(submitters) }),
  };
}

/** Each concept's `skos:prefLabel`, else `rdfs:label`, in the vocabulary's records ontology. */
export async function conceptLabels({
  vocabulary,
  newStore,
}: Pick<TablesOptions, "vocabulary" | "newStore">): Promise<
  ReadonlyMap<string, string>
> {
  const graph = new Graph(
    await newStore().parse(
      await readText(vocabulary, RECORDS),
      vocabulary.iri + RECORDS,
    ),
  );
  const labels = new Map<string, string>();
  for (const predicate of [`${SKOS}prefLabel`, `${RDFS}label`])
    for (const [subject, , label] of graph.match(undefined, predicate))
      if (!labels.has(subject.value)) labels.set(subject.value, label.value);
  return labels;
}
