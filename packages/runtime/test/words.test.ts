import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFiles } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import type { Replayed } from "../src/replay.js";
import { MATCHER } from "../src/matcher.js";
import { documentName, recordFromDocumentName } from "../src/names.js";
import { CASCADE, Refusal } from "../src/step.js";
import { Union } from "../src/store.js";
import { KINDS, PROV, Words } from "../src/words.js";

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

test("a record in words is found through the stem its code system is registered with, as an IRI and never a literal", async () => {
  const words = await wordsOver(REGISTRY);
  assert.equal(
    await words.record("allergy SNOMED 373270004"),
    "urn:test:coded",
  );
  await assert.rejects(
    words.record("allergy SNOMED 1234"),
    /names no record|no record/,
  );
});

test("a medication is found by its NDC through the space the vocabulary registers for it, and the matcher's same brand generic by the medications it joins", async () => {
  const words = await wordsOver(REGISTRY);
  assert.equal(
    await words.record("medication NDC 00378520905"),
    "urn:test:brand",
  );
  assert.equal(
    await words.judgment(
      "the matcher's same brand generic of medication NDC 00378520905 and medication NDC 00093101301",
    ),
    "urn:test:said",
  );
  assert.equal(
    await words.judgment(
      "the matcher's same product code of medication NDC 00378520905 and medication NDC 00093101301",
    ),
    "urn:test:product",
  );
});

test("a record named by a code system the vocabulary does not register is an Error naming the system", async () => {
  const words = await wordsOver(REGISTRY);
  await assert.rejects(
    words.record("lab result LOINC 2823-3"),
    (error: unknown) =>
      error instanceof Error &&
      !(error instanceof Refusal) &&
      error.message.includes("LOINC"),
  );
});

test("a variant is found by its HGVS expression, which holds a colon, or by its ClinVar ID, and the matcher's two joins of variants are named by their words", async () => {
  const words = await wordsOver(REGISTRY);
  const [hgvs, id, named] = await Promise.all([
    words.record("variant HGVS NM_000249.4:c.2042C>T"),
    words.record("variant ClinVar 90011"),
    words.record('variant ClinVar 90011 "NM_000249.4:c.2042C>T"'),
  ]);
  assert.deepEqual([hgvs, id, named], Array(3).fill("urn:test:martin"));
  const members =
    "variant HGVS NM_000249.4:c.2042C>T and variant HGVS NM_000249.3:c.2042C>T";
  assert.equal(
    await words.judgment(`the matcher's same variation of ${members}`),
    "urn:test:variation",
  );
  assert.equal(
    await words.judgment(
      `the matcher's same variation through the table of ${members}`,
    ),
    "urn:test:through",
  );
});

test("a handle names a record from a server by its base URL, normalised, its type and id, one from a document by the document's bytes and its selector, and a C-CDA entry by its id in its document's custodian and patient scopes, which a document that states none names by its selector; a retired form or none of the known inputs is an Error", async () => {
  const bundle = new TextEncoder().encode('{"resourceType": "Bundle"}');
  const summary = new TextEncoder()
    .encode(`<ClinicalDocument xmlns="urn:hl7-org:v3">
  <recordTarget><patientRole><id root="2.16.840.1.113883.19.5.99" extension="MRN-1234"/></patientRole></recordTarget>
  <custodian><assignedCustodian><representedCustodianOrganization><id root="2.16.840.1.113883.19.5" extension="CLINIC-1"/></representedCustodianOrganization></assignedCustodian></custodian>
</ClinicalDocument>`);
  const words = await wordsOver(
    REGISTRY,
    {
      records: {
        SERVER: {
          server: "https://FHIR.example.org:443/api/FHIR/R4/",
          type: "AllergyIntolerance",
          id: "eQ3xk2RtVb7Lm9Pw1aZy8A3",
        },
        DOCUMENT: { document: "downloads/bundle.json", selector: "/entry/3" },
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
      "test/downloads/bundle.json": bundle,
      "test/downloads/summary.xml": summary,
      "test/downloads/unscoped.xml": new TextEncoder().encode(
        '<ClinicalDocument xmlns="urn:hl7-org:v3"/>',
      ),
    },
  );
  await assert.rejects(
    words.record("UNSCOPED"),
    /UNSCOPED names .*unscoped\.xml, which states no custodian id, or not exactly one patient with an id: handles\.json gives its selector/,
  );
  assert.equal(
    await words.record("SERVER"),
    "urn:uuid:81ad3fab-98f1-890c-8abe-e93c84afd9e0",
  );
  assert.equal(
    await words.record("DOCUMENT"),
    await recordFromDocumentName(await documentName(bundle), "/entry/3"),
  );
  assert.equal(
    await words.record("CCDA"),
    "urn:uuid:bb2e2b2b-5b01-8991-aa76-984b9b06ed2c",
  );
  for (const handle of ["FULL-URL", "NO-INPUTS"])
    await assert.rejects(
      words.record(handle),
      new RegExp(`handles\\.json gives ${handle} no name inputs`),
    );
});

test("a variant interpretation is a kind and no step names one: it has neither a code nor a name", async () => {
  assert.equal(
    KINDS["variant interpretation"],
    `${CASCADE}VariantInterpretation`,
  );
  const words = await wordsOver(REGISTRY);
  await assert.rejects(
    words.record("variant interpretation"),
    (error: unknown) =>
      error instanceof Error && error.message.includes("names no record"),
  );
});
