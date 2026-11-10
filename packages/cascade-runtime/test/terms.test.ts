import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as oxigraph from "oxigraph";
import {
  findRoot,
  readConfig,
  resolveVocabulary,
} from "@cascade-runtime/runtime/node";
import { codeStems as mainCodeStems, terms as main } from "cascade-runtime";
import { codeStems, terms } from "cascade-runtime/terms";

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

const ontologiesFolder = async () => {
  const { folder } = await resolveVocabulary(ROOT, await readConfig(ROOT));
  return join(folder, "ontologies");
};

describe("the vocabulary the runtime reads", () => {
  const declared = new Set<string>();
  const systems = new Set<string>();
  const spaceOf = new Map<string, string>();
  const shapesOf = new Map<string, string[]>();
  const propertiesOf = new Map<string, string[]>();
  const pathOf = new Map<string, string>();
  const add = (map: Map<string, string[]>, key: string, value: string) =>
    map.set(key, [...(map.get(key) ?? []), value]);

  before(async () => {
    const ontologies = await ontologiesFolder();
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
          if (predicate.value === TYPE) {
            declared.add(subject.value);
            if (object.value === terms.CodeSystem) systems.add(subject.value);
          } else if (predicate.value === "http://rdfs.org/ns/void#uriSpace")
            spaceOf.set(subject.value, object.value);
        } else if (predicate.value === `${SH}targetClass`)
          add(shapesOf, object.value, subject.value);
        else if (predicate.value === `${SH}property`)
          add(propertiesOf, subject.value, object.value);
        else if (predicate.value === `${SH}path`)
          pathOf.set(subject.value, object.value);
    }
  });

  describe("terms", () => {
    it("never has a key renamed", () => {
      assert.deepEqual(Object.keys(terms), KEYS);
      assert.deepEqual(Object.keys(terms.statusOf), Object.keys(CLASSES));
    });

    it("is the main entry's", () => {
      assert.equal(terms, main);
    });

    it("holds only IRIs the vocabulary declares", () => {
      const { statusOf, ...named } = terms;
      assert.deepEqual(
        [...Object.values(named), ...Object.values(statusOf)].filter(
          (iri) => !declared.has(iri),
        ),
        [],
      );
    });

    for (const kind of Object.keys(CLASSES))
      it(`has ${kind}'s status in the shape of its class`, () => {
        const status = terms.statusOf[kind as keyof typeof CLASSES];
        const paths = (
          shapesOf.get(CLASSES[kind as keyof typeof CLASSES]) ?? []
        )
          .flatMap((shape) => propertiesOf.get(shape) ?? [])
          .map((property) => pathOf.get(property));
        assert.ok(
          paths.includes(status),
          `${kind}'s shape constrains ${status}`,
        );
      });
  });

  describe("codeStems", () => {
    it("is the main entry's", () => {
      assert.equal(codeStems, mainCodeStems);
    });

    it("holds every code system the vocabulary declares, under its local name, as its void:uriSpace", () => {
      assert.deepEqual(
        codeStems,
        Object.fromEntries(
          [...systems].map((system) => [
            system.slice(system.lastIndexOf("#") + 1),
            spaceOf.get(system),
          ]),
        ),
      );
    });
  });
});
