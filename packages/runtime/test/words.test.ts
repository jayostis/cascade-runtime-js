import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFiles } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import type { Replayed } from "../src/replay.js";
import { MATCHER } from "../src/matcher.js";
import { REC, Refusal } from "../src/step.js";
import { Union } from "../src/store.js";
import {
  CLINICAL,
  GENOMICS,
  HEALTH,
  JDG,
  KINDS,
  PROV,
  Words,
} from "../src/words.js";

const RECORDS = "ontologies/records/v1-draft/records.ttl";
const REGISTRY = `@prefix rec: <https://ns.cascadeprotocol.org/records/v1-draft#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix void: <http://rdfs.org/ns/void#> .
rec:SNOMEDCT a rec:CodeSystem ; rdfs:label "SNOMED CT"@en ; void:uriSpace "urn:test:snomed/" .
rec:NDC a rec:CodeSystem ; rdfs:label "NDC"@en ; void:uriSpace "urn:test:ndc/" .
`;

async function wordsOver(
  records: string,
  handles?: ConstructorParameters<typeof Words>[0]["handles"],
): Promise<Words> {
  const vocabulary = new MemoryFiles("urn:test:vocabulary/");
  await vocabulary.write(RECORDS, new TextEncoder().encode(records));
  const store = new Union(new OxigraphStore());
  await store.loadTurtle(
    `@prefix health: <${HEALTH}> . @prefix clinical: <${CLINICAL}> . @prefix prov: <${PROV}> .
<urn:test:coded> a health:AllergyRecord . <urn:test:coded-v> prov:specializationOf <urn:test:coded> ; health:allergenCode <urn:test:snomed/373270004> .
<urn:test:literal> a health:AllergyRecord . <urn:test:literal-v> prov:specializationOf <urn:test:literal> ; clinical:snomedCode "1234" .
<urn:test:brand> a clinical:Medication . <urn:test:brand-v> prov:specializationOf <urn:test:brand> ; <${REC}ndcCode> <urn:test:ndc/00378520905> .
<urn:test:generic> a clinical:Medication . <urn:test:generic-v> prov:specializationOf <urn:test:generic> ; <${REC}ndcCode> <urn:test:ndc/00093101301> .
<urn:test:martin> a <${GENOMICS}Variant> . <urn:test:martin-v> prov:specializationOf <urn:test:martin> ; <${GENOMICS}hgvsCDot> "NM_000249.4:c.2042C>T" ; <${GENOMICS}clinvarVariationId> "90011" .
<urn:test:panel> a <${GENOMICS}Variant> . <urn:test:panel-v> prov:specializationOf <urn:test:panel> ; <${GENOMICS}hgvsCDot> "NM_000249.3:c.2042C>T" .
<urn:test:report> a <${GENOMICS}VariantInterpretation> . <urn:test:report-v> prov:specializationOf <urn:test:report> ; <${GENOMICS}variantInterpreted> <urn:test:martin> .
<urn:test:variation> <${PROV}wasAttributedTo> <${MATCHER}> ; <${JDG}justification> <${JDG}SameVariation> ; <${PROV}hadMember> <urn:test:martin>, <urn:test:panel> .
<urn:test:through> <${PROV}wasAttributedTo> <${MATCHER}> ; <${JDG}justification> <${JDG}SameVariationThroughTable> ; <${PROV}hadMember> <urn:test:martin>, <urn:test:panel> .
<urn:test:said> <${PROV}wasAttributedTo> <${MATCHER}> ; <${JDG}justification> <${JDG}SameBrandGeneric> ; <${PROV}hadMember> <urn:test:brand>, <urn:test:generic> .
<urn:test:product> <${PROV}wasAttributedTo> <${MATCHER}> ; <${JDG}justification> <${JDG}SameProductCode> ; <${PROV}hadMember> <urn:test:brand>, <urn:test:generic> .`,
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

test("a record in words is found through the stem its code system is registered with, as an IRI or, for SNOMED, a literal", async () => {
  const words = await wordsOver(REGISTRY);
  assert.equal(
    await words.record("allergy SNOMED 373270004"),
    "urn:test:coded",
  );
  assert.equal(await words.record("allergy SNOMED 1234"), "urn:test:literal");
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

test("a handle of a FHIR record with no id and a urn:uuid: fullUrl names the record from its fullUrl alone, and a handle with none of the known inputs is an Error", async () => {
  const words = await wordsOver(REGISTRY, {
    records: {
      "HG-V1": { fullUrl: "urn:uuid:0a8c1f4e-6d27-4b93-8c15-3e90a7d52011" },
      "NO-INPUTS": { identifier: "x" },
    },
    profiles: {
      "HG-PAT": { fullUrl: "urn:uuid:0a8c1f4e-6d27-4b93-8c15-3e90a7d52001" },
    },
  });
  assert.equal(
    await words.record("HG-V1"),
    "urn:uuid:5f2ff240-5d0e-8484-82a8-35a333082cbf",
  );
  assert.equal(
    await words.record("HG-PAT"),
    "urn:uuid:b21d6039-06b7-877f-a351-cdb8a2412ee0",
  );
  await assert.rejects(
    words.record("NO-INPUTS"),
    /handles\.json gives NO-INPUTS no name inputs/,
  );
});

test("a variant interpretation is a kind and no step names one: it has neither a code nor a name", async () => {
  assert.equal(
    KINDS["variant interpretation"],
    `${GENOMICS}VariantInterpretation`,
  );
  const words = await wordsOver(REGISTRY);
  await assert.rejects(
    words.record("variant interpretation"),
    (error: unknown) =>
      error instanceof Error && error.message.includes("names no record"),
  );
});
