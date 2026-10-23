import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as oxigraph from "oxigraph";
import {
  findRoot,
  readConfig,
  resolveVocabulary,
} from "@cascade-runtime/runtime/node";
import { terms as main } from "cascade-runtime";
import { terms } from "cascade-runtime/terms";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SH = "http://www.w3.org/ns/shacl#";

const KEYS = [
  "MedicationActive",
  "MedicationPaused",
  "MedicationUnknown",
  "MedicationStopped",
  "MedicationEnteredInError",
  "Pathogenic",
  "LikelyPathogenic",
  "UncertainSignificance",
  "LikelyBenign",
  "Benign",
  "ClinVarConflicting",
  "ClinVarConflictingData",
  "ClinVarCombinationOnly",
  "ClinVarVusHigh",
  "ClinVarRiskFactor",
  "ClinVarMultipleSubmittersNoConflicts",
  "ClinVarSingleSubmitter",
  "ClinVarNoAssertionCriteria",
  "establishedPharmacologicClass",
  "mechanismOfActionClass",
  "physiologicEffectClass",
  "chemicalStructureClass",
  "mergedFrom",
  "hgvsCodingDnaExpression",
  "clinvarVariationId",
  "geneSymbol",
  "coversGene",
  "clinvarClassification",
  "clinvarReviewStatus",
  "contributingSubmitterCount",
  "variantInterpreted",
  "acmgClassification",
  "interpretedDate",
  "drugName",
  "medicationUseEndDate",
  "allergen",
  "Vaccination",
  "vaccineCode",
  "vaccinationOccurrenceTime",
  "patient",
  "PatientRole",
  "justification",
  "SameMappedCodeAndDate",
  "CodeSystem",
  "ReferenceSeries",
  "defaultTableVersion",
  "statusOf",
];

const CLASSES: Record<keyof typeof terms.statusOf, string> = {
  AllergyOrIntolerance:
    "https://ns.cascadeprotocol.org/cascade#AllergyOrIntolerance",
  ProblemOrDiagnosis:
    "https://ns.cascadeprotocol.org/cascade#ProblemOrDiagnosis",
  Vaccination: terms.Vaccination,
  PrescribedOrReportedMedication:
    "https://ns.cascadeprotocol.org/cascade#PrescribedOrReportedMedication",
  MedicalProcedure: "https://ns.cascadeprotocol.org/cascade#MedicalProcedure",
  LaboratoryTestResult:
    "https://ns.cascadeprotocol.org/cascade#LaboratoryTestResult",
};

test("the keys of terms are never renamed", () => {
  assert.deepEqual(Object.keys(terms), KEYS);
  assert.deepEqual(Object.keys(terms.statusOf), Object.keys(CLASSES));
});

test("every IRI of terms is a term the vocabulary the runtime reads declares, each status one the shape of its class constrains, and the subpath is the main entry's", async () => {
  assert.equal(terms, main);
  const { folder } = await resolveVocabulary(ROOT, await readConfig(ROOT));
  const ontologies = join(folder, "ontologies");
  const declared = new Set<string>();
  const shapesOf = new Map<string, string[]>();
  const propertiesOf = new Map<string, string[]>();
  const pathOf = new Map<string, string>();
  const add = (map: Map<string, string[]>, key: string, value: string) =>
    map.set(key, [...(map.get(key) ?? []), value]);
  for (const path of await readdir(ontologies, { recursive: true })) {
    if (!path.endsWith(".ttl")) continue;
    const shapes = path.endsWith(".shapes.ttl");
    for (const { subject, predicate, object } of oxigraph.parse(
      await readFile(join(ontologies, path), "utf8"),
      {
        format: "text/turtle",
        base_iri: pathToFileURL(join(ontologies, path)).href,
      },
    ))
      if (!shapes) {
        if (predicate.value === TYPE) declared.add(subject.value);
      } else if (predicate.value === `${SH}targetClass`)
        add(shapesOf, object.value, subject.value);
      else if (predicate.value === `${SH}property`)
        add(propertiesOf, subject.value, object.value);
      else if (predicate.value === `${SH}path`)
        pathOf.set(subject.value, object.value);
  }
  const { statusOf, ...named } = terms;
  assert.deepEqual(
    [...Object.values(named), ...Object.values(statusOf)].filter(
      (iri) => !declared.has(iri),
    ),
    [],
  );
  for (const [kind, status] of Object.entries(statusOf)) {
    const paths = (shapesOf.get(CLASSES[kind as keyof typeof CLASSES]) ?? [])
      .flatMap((shape) => propertiesOf.get(shape) ?? [])
      .map((property) => pathOf.get(property));
    assert.ok(paths.includes(status), `${kind}'s shape constrains ${status}`);
  }
});
