import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFiles, readText } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import type { Triple } from "../src/rdf.js";
import { Shapes } from "../src/shapes.js";
import { vocabulary } from "./vocabulary.js";

const newStore = () => new OxigraphStore();
const SH = "http://www.w3.org/ns/shacl#";
const PREFIXES = `@prefix sh: <${SH}> .
@prefix ex: <https://example.org/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;

async function shapesOf(shapes: string, terms = ""): Promise<Shapes> {
  const files = new MemoryFiles("https://vocabulary.example/");
  const encode = (text: string) => new TextEncoder().encode(PREFIXES + text);
  await files.write("ontologies/test.shapes.ttl", encode(shapes));
  await files.write("ontologies/test.ttl", encode(terms));
  return Shapes.read(files, newStore);
}

function data(turtle: string): Promise<Triple[]> {
  return newStore().parse(PREFIXES + turtle, "https://data.example/");
}

test("the vocabulary's server record name shape gives pyshacl's result on its valid case and its tampered one", async () => {
  const files = await vocabulary();
  const shapes = await Shapes.read(files, newStore);
  const shapeCase = async (name: string) =>
    newStore().parse(
      await readText(files, `tests/shape-cases/record-server-name/${name}.ttl`),
      files.iri,
    );

  assert.deepEqual(await shapes.results(await shapeCase("valid")), []);
  assert.deepEqual(
    (await shapes.results(await shapeCase("name-tampered"))).map(
      ({ focusNode, sourceShape, severity, message }) => [
        focusNode.value,
        sourceShape.value,
        severity.value,
        message,
      ],
    ),
    [
      [
        "urn:uuid:6d03d846-ac92-8492-ac9f-e810307f7bdb",
        "https://ns.cascadeprotocol.org/cascade#ServerRecordNameShape",
        `${SH}Violation`,
        [
          "A record's name is the one cascade:RecordFromServerNamingRule gives its source address: expected urn:uuid:6d03d846-ac92-8492-ac9f-e810307f7bda.",
        ],
      ],
    ],
  );
});

test("a SPARQL constraint's focus nodes are its shape's targets of every kind, a subclass's instances its class's", async () => {
  const every = `sh:sparql [ sh:select "SELECT $this WHERE { }" ]`;
  const shapes = await shapesOf(
    `ex:ByClass sh:targetClass ex:Thing ; ${every} .
     ex:BySubject sh:targetSubjectsOf ex:p ; ${every} .
     ex:ByObject sh:targetObjectsOf ex:p ; ${every} .
     ex:ByNode sh:targetNode ex:e ; ${every} .`,
    `ex:Kind rdfs:subClassOf ex:Thing .`,
  );

  const results = await shapes.results(
    await data(`ex:a a ex:Kind .
       ex:b ex:p ex:c .
       ex:c ex:r 1 .
       ex:e ex:r 2 .
       ex:f a ex:Other .`),
  );

  assert.deepEqual(
    results
      .map(({ sourceShape, focusNode }) => [sourceShape.value, focusNode.value])
      .sort(),
    [
      ["https://example.org/ByClass", "https://example.org/a"],
      ["https://example.org/ByNode", "https://example.org/e"],
      ["https://example.org/ByObject", "https://example.org/c"],
      ["https://example.org/BySubject", "https://example.org/b"],
    ],
  );
});

test("a SPARQL constraint's result has its message with each variable's value, its severity and its declared prefixes, beside the core constraints' results", async () => {
  const shapes = await shapesOf(
    `ex: sh:declare [ sh:prefix "ex" ; sh:namespace "https://example.org/"^^xsd:anyURI ] .
     ex:Labelled sh:targetSubjectsOf ex:label ;
       sh:property [ sh:path ex:label ; sh:datatype xsd:string ; sh:message "A label is a string."@en ] ;
       sh:sparql [
         sh:prefixes ex: ;
         sh:severity sh:Warning ;
         sh:message "{$this} is labelled {?label} by {?shape}."@en ;
         sh:select "SELECT $this ?label ?shape WHERE { $this ex:label ?label . BIND ($currentShape AS ?shape) }"
       ] .`,
  );

  const results = await shapes.results(await data(`ex:a ex:label 7 .`));

  assert.deepEqual(
    results.map(({ severity, message }) => [severity.value, message]).sort(),
    [
      [`${SH}Violation`, ["A label is a string."]],
      [
        `${SH}Warning`,
        [
          "https://example.org/a is labelled 7 by https://example.org/Labelled.",
        ],
      ],
    ],
  );
});

test("a deactivated SPARQL constraint, or one on a deactivated shape, gives no result", async () => {
  const shapes = await shapesOf(
    `ex:Active sh:targetNode ex:a ; sh:sparql [ sh:select "SELECT $this WHERE { }" ] .
     ex:Off sh:targetNode ex:a ; sh:deactivated true ; sh:sparql [ sh:select "SELECT $this WHERE { }" ] .
     ex:OneOff sh:targetNode ex:a ; sh:sparql [ sh:deactivated true ; sh:select "SELECT $this WHERE { }" ] .`,
  );

  const results = await shapes.results(await data(`ex:a ex:r 1 .`));

  assert.deepEqual(
    results.map(({ sourceShape }) => sourceShape.value),
    ["https://example.org/Active"],
  );
});

test("SHACL-SPARQL the runtime does not run is refused, never skipped", async () => {
  const select = (query: string) =>
    `ex:S sh:targetNode ex:a ; sh:sparql [ sh:select "${query}" ] .`;
  const cases: [shapes: string, triples: string, why: RegExp][] = [
    [
      `ex:S sh:targetNode ex:a ; sh:sparql [ sh:ask "ASK { }" ] .`,
      "",
      /sh:select/,
    ],
    [
      `ex:S sh:targetNode ex:a ; sh:property ex:P . ex:P sh:path ex:r ; sh:sparql [ sh:select "SELECT $this WHERE { }" ] .`,
      "",
      /property shape/,
    ],
    [
      `ex:T sh:targetNode ex:a ; sh:node ex:S . ex:S sh:sparql [ sh:select "SELECT $this WHERE { }" ] .`,
      "",
      /another shape/,
    ],
    [
      `ex:C a sh:ConstraintComponent ; sh:parameter [ sh:path ex:x ] ; sh:validator [ sh:ask "ASK { }" ] .`,
      "",
      /constraint component/,
    ],
    [
      select("SELECT $this WHERE { GRAPH $shapesGraph { } }"),
      "",
      /shapesGraph/,
    ],
    [select("SELECT $this WHERE { VALUES ?x { 1 } }"), "", /VALUES/],
    [
      `ex:S sh:targetSubjectsOf ex:r ; sh:sparql [ sh:select "SELECT $this WHERE { }" ] .`,
      `[] ex:r 1 .`,
      /blank node/,
    ],
    [
      select("SELECT $this ?failure WHERE { BIND (true AS ?failure) }"),
      `ex:a ex:r 1 .`,
      /failure/,
    ],
  ];
  for (const [shapes, triples, why] of cases)
    await assert.rejects(
      async () => (await shapesOf(shapes)).results(await data(triples)),
      why,
      shapes,
    );
});
