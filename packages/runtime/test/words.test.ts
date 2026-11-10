import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { MemoryFiles } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import type { Replayed } from "../src/replay.js";
import { MATCHER } from "../src/matcher.js";
import { documentName, recordFromDocumentName } from "../src/names.js";
import { CASCADE, Refusal } from "../src/step.js";
import { Union } from "../src/store.js";
import { PROV, Words } from "../src/words.js";

const RECORDS = "ontologies/cascade.ttl";
const REGISTRY = `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix void: <http://rdfs.org/ns/void#> .
cascade:SNOMEDCT a cascade:CodeSystem ; rdfs:label "SNOMED CT"@en ; void:uriSpace "urn:test:snomed/" .
cascade:NDC a cascade:CodeSystem ; rdfs:label "NDC"@en ; void:uriSpace "urn:test:ndc/" .
`;

async function wordsOver(
  records: string,
  handles?: ConstructorParameters<typeof Words>[0]["handles"],
  files: Readonly<Record<string, Uint8Array>> = {},
): Promise<Words> {
  const vocabulary = new MemoryFiles("urn:test:vocabulary/");
  await vocabulary.write(RECORDS, new TextEncoder().encode(records));
  for (const [path, bytes] of Object.entries(files))
    await vocabulary.write(path, bytes);
  const store = new Union(new OxigraphStore());
  await store.loadTurtle(
    `@prefix cascade: <${CASCADE}> . @prefix prov: <${PROV}> .
<urn:test:coded> a cascade:AllergyOrIntolerance . <urn:test:coded-v> prov:specializationOf <urn:test:coded> ; cascade:allergenCode <urn:test:snomed/373270004> .
<urn:test:literal> a cascade:AllergyOrIntolerance . <urn:test:literal-v> prov:specializationOf <urn:test:literal> ; cascade:snomedCode "1234" .
<urn:test:brand> a cascade:PrescribedOrReportedMedication . <urn:test:brand-v> prov:specializationOf <urn:test:brand> ; <${CASCADE}ndcCode> <urn:test:ndc/00378520905> .
<urn:test:generic> a cascade:PrescribedOrReportedMedication . <urn:test:generic-v> prov:specializationOf <urn:test:generic> ; <${CASCADE}ndcCode> <urn:test:ndc/00093101301> .
<urn:test:martin> a <${CASCADE}GeneticVariantFinding> . <urn:test:martin-v> prov:specializationOf <urn:test:martin> ; <${CASCADE}hgvsCodingDnaExpression> "NM_000249.4:c.2042C>T" ; <${CASCADE}clinvarVariationId> "90011" .
<urn:test:panel> a <${CASCADE}GeneticVariantFinding> . <urn:test:panel-v> prov:specializationOf <urn:test:panel> ; <${CASCADE}hgvsCodingDnaExpression> "NM_000249.3:c.2042C>T" .
<urn:test:report> a <${CASCADE}VariantInterpretation> . <urn:test:report-v> prov:specializationOf <urn:test:report> ; <${CASCADE}variantInterpreted> <urn:test:martin> .
<urn:test:variation> <${PROV}wasAttributedTo> <${MATCHER}> ; <${CASCADE}justification> <${CASCADE}SameVariation> ; <${PROV}hadMember> <urn:test:martin>, <urn:test:panel> .
<urn:test:through> <${PROV}wasAttributedTo> <${MATCHER}> ; <${CASCADE}justification> <${CASCADE}SameVariationThroughTable> ; <${PROV}hadMember> <urn:test:martin>, <urn:test:panel> .
<urn:test:said> <${PROV}wasAttributedTo> <${MATCHER}> ; <${CASCADE}justification> <${CASCADE}SameBrandGeneric> ; <${PROV}hadMember> <urn:test:brand>, <urn:test:generic> .
<urn:test:product> <${PROV}wasAttributedTo> <${MATCHER}> ; <${CASCADE}justification> <${CASCADE}SameProductCode> ; <${PROV}hadMember> <urn:test:brand>, <urn:test:generic> .`,
    "urn:test:pod",
  );
  const person = {
    name: "Test",
    subject: "urn:test:subject",
    address: "urn:test:pod/",
    folder: "test",
  };
  return new Words({
    store,
    newStore: () => new OxigraphStore(),
    replayed: {} as Replayed,
    vocabulary,
    person,
    people: new Map([["Test", person]]),
    folder: "test",
    ...(handles === undefined ? {} : { handles }),
  });
}

/** A pod of seven records and four matcher judgments, over a vocabulary that registers SNOMED CT and NDC; no leaf changes it. */
let plain: Promise<Words> | undefined;
const plainWords = (): Promise<Words> => (plain ??= wordsOver(REGISTRY));

const BUNDLE = new TextEncoder().encode('{"resourceType": "Bundle"}');
const SUMMARY = new TextEncoder()
  .encode(`<ClinicalDocument xmlns="urn:hl7-org:v3">
  <recordTarget><patientRole><id root="2.16.840.1.113883.19.5.99" extension="MRN-1234"/></patientRole></recordTarget>
  <custodian><assignedCustodian><representedCustodianOrganization><id root="2.16.840.1.113883.19.5" extension="CLINIC-1"/></representedCustodianOrganization></assignedCustodian></custodian>
</ClinicalDocument>`);

/**
 * A feature's example names a record or a judgment in words, such as `allergy SNOMED 373270004`, or by a handle, a
 * short name whose inputs the kit's `handles.json` gives (`runtime/steps.md`). `Words` finds the one thing in a pod those
 * words name, so a feature says which record it means without writing its IRI.
 */
describe("Finding what an example names in words · Words.record(), Words.judgment()", () => {
  /** A pod of seven records, whose code systems the vocabulary registers with made-up URI spaces (`urn:test:snomed/`, `urn:test:ndc/`). */
  describe("Words.record(words)", () => {
    let words: Words;
    before(async () => {
      words = await plainWords();
    });

    it("finds a record by its kind and a code, through the URI space the vocabulary registers for the code system", async () => {
      assert.equal(
        await words.record("allergy SNOMED 373270004"),
        "urn:test:coded",
        "allergy SNOMED 373270004",
      );
      assert.equal(
        await words.record("medication NDC 00378520905"),
        "urn:test:brand",
        "medication NDC 00378520905",
      );
    });

    it("rejects a code that a record holds only as a literal", async () => {
      await assert.rejects(
        words.record("allergy SNOMED 1234"),
        /names no record/,
      );
    });

    it("rejects, with an Error that is no Refusal and names the code system, a code system the vocabulary does not register", async () => {
      await assert.rejects(
        words.record("lab result LOINC 2823-3"),
        (error: unknown) =>
          error instanceof Error &&
          !(error instanceof Refusal) &&
          error.message.includes("LOINC"),
      );
    });

    it("finds a variant by its HGVS expression, by its ClinVar ID, and by its ClinVar ID with its name", async () => {
      for (const said of [
        "variant HGVS NM_000249.4:c.2042C>T",
        "variant ClinVar 90011",
        'variant ClinVar 90011 "NM_000249.4:c.2042C>T"',
      ])
        assert.equal(await words.record(said), "urn:test:martin", said);
    });

    it("rejects a kind given with neither a code nor a name", async () => {
      await assert.rejects(
        words.record("variant interpretation"),
        (error: unknown) =>
          error instanceof Error && error.message.includes("names no record"),
      );
    });
  });

  /**
   * A kit's `handles.json` gives a record a short name and the inputs its name is made from. The vocabulary here
   * holds a document `bundle.json`, and two C-CDA documents, one that states a custodian and a patient and one that
   * states neither.
   */
  describe("given a handle of `handles.json`", () => {
    let words: Words;
    before(async () => {
      words = await wordsOver(
        REGISTRY,
        {
          records: {
            SERVER: {
              server: "https://FHIR.example.org:443/api/FHIR/R4/",
              type: "AllergyIntolerance",
              id: "eQ3xk2RtVb7Lm9Pw1aZy8A3",
            },
            DOCUMENT: {
              document: "downloads/bundle.json",
              selector: "/entry/3",
            },
            CCDA: {
              document: "downloads/summary.xml",
              identifier: "2.16.840.1.113883.19.5:8237461",
            },
            "FULL-URL": {
              fullUrl: "urn:uuid:0a8c1f4e-6d27-4b93-8c15-3e90a7d52011",
            },
            "NO-INPUTS": { identifier: "x" },
            UNSCOPED: {
              document: "downloads/unscoped.xml",
              identifier: "2.16.840.1.113883.19.5:8237461",
            },
          },
        },
        {
          "test/downloads/bundle.json": BUNDLE,
          "test/downloads/summary.xml": SUMMARY,
          "test/downloads/unscoped.xml": new TextEncoder().encode(
            '<ClinicalDocument xmlns="urn:hl7-org:v3"/>',
          ),
        },
      );
    });

    it("finds a record read from a server by its base URL, normalised, its type and its id", async () => {
      assert.equal(
        await words.record("SERVER"),
        "urn:uuid:81ad3fab-98f1-890c-8abe-e93c84afd9e0",
      );
    });

    it("finds a record read from a document by the document's bytes and its selector", async () => {
      assert.equal(
        await words.record("DOCUMENT"),
        await recordFromDocumentName(await documentName(BUNDLE), "/entry/3"),
      );
    });

    it("finds a C-CDA record by its id and the custodian and patient ids its document states", async () => {
      assert.equal(
        await words.record("CCDA"),
        "urn:uuid:bb2e2b2b-5b01-8991-aa76-984b9b06ed2c",
      );
    });

    it("rejects, saying `handles.json` gives its selector, a C-CDA document that states no custodian id or no patient id", async () => {
      await assert.rejects(
        words.record("UNSCOPED"),
        /UNSCOPED names .*unscoped\.xml, whose custodian has no id that names an organization, or which states not exactly one patient with an id: handles\.json gives its selector/,
      );
    });

    it("rejects, saying the handle has no name inputs, inputs of no form it knows", async () => {
      for (const handle of ["FULL-URL", "NO-INPUTS"])
        await assert.rejects(
          words.record(handle),
          new RegExp(`handles\\.json gives ${handle} no name inputs`),
          handle,
        );
    });
  });

  /** The matcher's judgments the pod holds are each about two records, and give a justification in words. */
  describe("Words.judgment(words)", () => {
    let words: Words;
    before(async () => {
      words = await plainWords();
    });

    it("finds the matcher's judgment by its justification in words and the records it joins", async () => {
      const brand = "medication NDC 00378520905 and medication NDC 00093101301";
      const variants =
        "variant HGVS NM_000249.4:c.2042C>T and variant HGVS NM_000249.3:c.2042C>T";
      const found = {
        [`the matcher's same brand generic of ${brand}`]: "urn:test:said",
        [`the matcher's same product code of ${brand}`]: "urn:test:product",
        [`the matcher's same variation of ${variants}`]: "urn:test:variation",
        [`the matcher's same variation through the table of ${variants}`]:
          "urn:test:through",
      };
      for (const [said, judgment] of Object.entries(found))
        assert.equal(await words.judgment(said), judgment, said);
    });
  });
});
