import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFiles } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import type { Replayed } from "../src/replay.js";
import { MATCHER } from "../src/matcher.js";
import { REC, Refusal } from "../src/step.js";
import { Union } from "../src/store.js";
import { CLINICAL, HEALTH, JDG, PROV, Words } from "../src/words.js";

const RECORDS = "ontologies/records/v1-draft/records.ttl";
const REGISTRY = `@prefix rec: <https://ns.cascadeprotocol.org/records/v1-draft#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix void: <http://rdfs.org/ns/void#> .
rec:SNOMEDCT a rec:CodeSystem ; rdfs:label "SNOMED CT"@en ; void:uriSpace "urn:test:snomed/" .
rec:NDC a rec:CodeSystem ; rdfs:label "NDC"@en ; void:uriSpace "urn:test:ndc/" .
`;

async function wordsOver(records: string): Promise<Words> {
  const vocabulary = new MemoryFiles("urn:test:vocabulary/");
  await vocabulary.write(RECORDS, new TextEncoder().encode(records));
  const store = new Union(new OxigraphStore());
  await store.loadTurtle(
    `@prefix health: <${HEALTH}> . @prefix clinical: <${CLINICAL}> . @prefix prov: <${PROV}> .
<urn:test:coded> a health:AllergyRecord . <urn:test:coded-v> prov:specializationOf <urn:test:coded> ; health:allergenCode <urn:test:snomed/373270004> .
<urn:test:literal> a health:AllergyRecord . <urn:test:literal-v> prov:specializationOf <urn:test:literal> ; clinical:snomedCode "1234" .
<urn:test:brand> a clinical:Medication . <urn:test:brand-v> prov:specializationOf <urn:test:brand> ; <${REC}ndcCode> <urn:test:ndc/00378520905> .
<urn:test:generic> a clinical:Medication . <urn:test:generic-v> prov:specializationOf <urn:test:generic> ; <${REC}ndcCode> <urn:test:ndc/00093101301> .
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
