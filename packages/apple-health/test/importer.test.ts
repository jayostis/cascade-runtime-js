import assert from "node:assert/strict";
import { test } from "node:test";
import * as oxigraph from "oxigraph";
import { appleHealthExport, type ExportFiles } from "../src/index.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function folder(files: Record<string, string>): ExportFiles {
  return {
    read: (path) =>
      Promise.resolve(path in files ? bytes(files[path] ?? "") : undefined),
    list: (under) =>
      Promise.resolve(
        Object.keys(files)
          .filter((path) => path.startsWith(`${under}/`))
          .sort(),
      ),
  };
}

test("an export's documents are its clinical record files, each with what export.xml says of it and of the import", async () => {
  const files = folder({
    "e/export.xml": `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [ <!ELEMENT HealthData (ClinicalRecord)*> ]>
<HealthData locale="en_US">
 <ClinicalRecord sourceName="Example Hospital" sourceURL="https://fhir.example.org/r4/AllergyIntolerance/peanut"
   fhirVersion="4.0.1" receivedDate="2026-01-02 11:00:00 +0100" resourceFilePath="/clinical-records/AllergyIntolerance-peanut.json"/>
</HealthData>`,
    "e/clinical-records/AllergyIntolerance-peanut.json": "{}",
    "e/clinical-records/Condition-unlisted.json": "[]",
    "e/clinical-records/notes.txt": "",
    "e/clinical-records/nested/Observation-x.json": "{}",
  });
  assert.equal(
    await appleHealthExport.documents(files, "elsewhere"),
    undefined,
  );
  const documents = (await appleHealthExport.documents(files, "e")) ?? [];
  assert.deepEqual(
    documents.map(({ path, mediaType }) => [path, mediaType]),
    [
      [
        "e/clinical-records/AllergyIntolerance-peanut.json",
        "application/fhir+json",
      ],
      ["e/clinical-records/Condition-unlisted.json", "application/fhir+json"],
    ],
  );

  const facts = (index: number): oxigraph.Store => {
    const store = new oxigraph.Store();
    store.load(documents[index]?.facts("2026-01-02T10:00:00Z") ?? "", {
      format: "text/turtle",
    });
    return store;
  };
  const answer = (store: oxigraph.Store, query: string): unknown =>
    store.query(`PREFIX bridge: <https://ns.cascadeprotocol.org/bridge/v1-draft#>
      PREFIX pav: <http://purl.org/pav/> PREFIX prov: <http://www.w3.org/ns/prov#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> PREFIX rec: <https://ns.cascadeprotocol.org/records/v1-draft#>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
      ${query}`);
  assert.equal(
    answer(
      facts(0),
      `ASK {
        bridge:thisImport rdfs:label "Apple Health export" ; prov:startedAtTime "2026-01-02T10:00:00Z"^^xsd:dateTime .
        bridge:thisDocument pav:retrievedFrom <https://fhir.example.org/r4/AllergyIntolerance/peanut> ;
          pav:retrievedOn "2026-01-02T10:00:00Z"^^xsd:dateTime ;
          bridge:serverBaseUrl "https://fhir.example.org/r4" ; bridge:sourceFormatVersion "4.0.1" ;
          prov:qualifiedAttribution [ prov:agent [ rdfs:label "Apple Health" ] ; prov:hadRole rec:transmitter ] ,
            [ prov:agent [ rdfs:label "Example Hospital" ] ; prov:hadRole rec:author ] .
      }`,
    ),
    true,
  );
  assert.equal(
    answer(
      facts(1),
      `ASK { bridge:thisDocument prov:qualifiedAttribution/prov:hadRole ?role FILTER (?role != rec:transmitter) }`,
    ),
    false,
  );
});

async function onlyDocument(record: string) {
  const [document] =
    (await appleHealthExport.documents(
      folder({
        "e/export.xml": `<HealthData>
 <ClinicalRecord ${record} resourceFilePath="/clinical-records/Condition-x.json"/>
</HealthData>`,
        "e/clinical-records/Condition-x.json": "{}",
      }),
      "e",
    )) ?? [];
  assert.ok(document);
  return document;
}

const record = (attributes: Record<string, string>): string =>
  Object.entries({
    sourceName: "Example Hospital",
    sourceURL: "https://fhir.example.org/r4/Condition/x",
    fhirVersion: "4.0.1",
    receivedDate: "2026-01-02 11:00:00 +0100",
    ...attributes,
  })
    .map(([name, value]) => `${name}="${value}"`)
    .join(" ");

test("a line break in an attribute is kept in the facts' Turtle", async () => {
  const document = await onlyDocument(
    record({ sourceName: "Clinic&#10;North&#13;" }),
  );
  const store = new oxigraph.Store();
  store.load(document.facts("2026-01-02T10:00:00Z"), {
    format: "text/turtle",
  });
  assert.equal(
    store.query(
      `ASK { ?agent <http://www.w3.org/2000/01/rdf-schema#label> "Clinic\\nNorth\\r" }`,
    ),
    true,
  );
});

test("a record whose attributes the facts cannot state is refused, not given made-up values", async () => {
  for (const missing of [
    "sourceName",
    "sourceURL",
    "fhirVersion",
    "receivedDate",
  ]) {
    const document = await onlyDocument(
      record({}).replace(new RegExp(`${missing}="[^"]*" ?`), ""),
    );
    assert.throws(
      () => document.facts("2026-01-02T10:00:00Z"),
      new RegExp(`has no ${missing}`),
    );
  }
  const document = await onlyDocument(
    record({ sourceURL: "https://fhir.example.org/r4/Condition/x y" }),
  );
  assert.throws(() => document.facts("2026-01-02T10:00:00Z"), /is not an IRI/);
});
