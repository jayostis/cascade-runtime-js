import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFiles } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import type { Replayed } from "../src/replay.js";
import { Union } from "../src/store.js";
import { CLINICAL, HEALTH, PROV, Words } from "../src/words.js";

const RECORDS = "ontologies/records/v1-draft/records.ttl";
const REGISTRY = `@prefix rec: <https://ns.cascadeprotocol.org/records/v1-draft#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix void: <http://rdfs.org/ns/void#> .
rec:SNOMEDCT a rec:CodeSystem ; rdfs:label "SNOMED CT"@en ; void:uriSpace "urn:test:snomed/" .
rec:RxNorm a rec:CodeSystem ; rdfs:label "RxNorm"@en ; void:uriSpace "urn:test:rxnorm/" .
`;

async function wordsOver(records: string): Promise<Words> {
  const vocabulary = new MemoryFiles("urn:test:vocabulary/");
  await vocabulary.write(RECORDS, new TextEncoder().encode(records));
  const store = new Union(new OxigraphStore());
  await store.loadTurtle(
    `@prefix health: <${HEALTH}> . @prefix clinical: <${CLINICAL}> . @prefix prov: <${PROV}> .
<urn:test:coded> a health:AllergyRecord . <urn:test:coded-v> prov:specializationOf <urn:test:coded> ; health:allergenCode <urn:test:snomed/373270004> .
<urn:test:literal> a health:AllergyRecord . <urn:test:literal-v> prov:specializationOf <urn:test:literal> ; clinical:snomedCode "1234" .
<urn:test:drug> a clinical:Medication . <urn:test:drug-v> prov:specializationOf <urn:test:drug> ; clinical:drugCode <urn:test:rxnorm/314076> .`,
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
  assert.equal(await words.record("medication RxNorm 314076"), "urn:test:drug");
});

test("a record named by a code system the vocabulary does not register is an Error naming the system", async () => {
  const words = await wordsOver(REGISTRY);
  await assert.rejects(
    words.record("lab result LOINC 2823-3"),
    (error: unknown) =>
      error instanceof Error && error.message.includes("LOINC"),
  );
});
