import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFiles, readText } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { Refusal } from "../src/refusal.js";
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
     ex:Labelled sh:targetSubjectsOf ex:label ; sh:severity sh:Warning ;
       sh:property [ sh:path ex:label ; sh:datatype xsd:string ; sh:message "A label is a string."@en ] ;
       sh:sparql [
         sh:prefixes ex: ;
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

test("a SPARQL constraint's severity is its shape's, and its messages are its own and its shape's, as pyshacl gives them", async () => {
  const shapes = await shapesOf(
    `ex:Both sh:targetNode ex:a ; sh:severity sh:Warning ; sh:message "shape" ;
       sh:sparql [ sh:severity sh:Info ; sh:select "SELECT $this WHERE { }" ] .
     ex:Own sh:targetNode ex:a ; sh:message "shape" ;
       sh:sparql [ sh:message "own" ; sh:select "SELECT $this WHERE { }" ] .`,
  );

  const results = await shapes.results(await data(`ex:a ex:r 1 .`));

  assert.deepEqual(
    results
      .map(({ sourceShape, severity, message }) => [
        sourceShape.value,
        severity.value,
        [...message].sort(),
      ])
      .sort(),
    [
      ["https://example.org/Both", `${SH}Warning`, ["shape"]],
      ["https://example.org/Own", `${SH}Violation`, ["own", "shape"]],
    ],
  );
});

const DATA = `ex:a ex:p ex:b ; ex:q "x" ; ex:this ex:z ; ex:n 2 . ex:other ex:p ex:c ; ex:n 9 . ex:k ex:select ex:l .`;

async function answers(
  select: string,
  turtle = DATA,
  target = "sh:targetSubjectsOf ex:p",
): Promise<string[]> {
  const shapes = await shapesOf(
    `ex: sh:declare [ sh:prefix "ex" ; sh:namespace "https://example.org/"^^xsd:anyURI ] .
     ex:S ${target} ; sh:sparql [ sh:message "m {?v}" ; sh:prefixes ex: ; sh:select ${JSON.stringify(select)} ] .`,
  );
  return (await shapes.results(await data(turtle)))
    .map(
      ({ focusNode, message }) =>
        `${focusNode.termType === "BlankNode" ? "_" : focusNode.value.replace("https://example.org/", "ex:")}|${message.join()}`,
    )
    .sort();
}

test("$this is pre-bound where a sub-select returns it, in GROUP BY and ORDER BY, and in BOUND, as pyshacl binds it", async () => {
  const cases: [select: string, pyshacl: string[]][] = [
    [
      "SELECT $this ?v WHERE { { SELECT $this ?v WHERE { $this ex:q ?v } } }",
      ["ex:a|m x"],
    ],
    [
      "SELECT $this ?v WHERE { { SELECT $this (COUNT(?o) AS ?v) WHERE { $this ex:p ?o } GROUP BY $this } FILTER(?v > 0) }",
      ["ex:a|m 1", "ex:other|m 1"],
    ],
    [
      "SELECT $this (COUNT(?o) AS ?v) WHERE { $this ex:p ?o } GROUP BY $this",
      ["ex:a|m 1", "ex:other|m 1"],
    ],
    ["SELECT $this ?v WHERE { $this ex:q ?v } ORDER BY $this", ["ex:a|m x"]],
    [
      "SELECT $this WHERE { $this ex:q ?v FILTER(BOUND($this)) }",
      ["ex:a|m {?v}"],
    ],
  ];
  for (const [select, pyshacl] of cases)
    assert.deepEqual(await answers(select), pyshacl, select);
});

test("$this is found by SPARQL's grammar: beside an unspaced <, after a prefixed name spelled like a keyword, after a long string ending in a backslash", async () => {
  const cases: [select: string, pyshacl: string[]][] = [
    [
      `SELECT $this WHERE { $this ex:n ?v FILTER(?v<5&&STR($this)>"") }`,
      ["ex:a|m {?v}"],
    ],
    ["SELECT $this WHERE { ?k ex:select ?l . $this ex:q ?v }", ["ex:a|m {?v}"]],
    [
      `SELECT $this WHERE { BIND("""a\\\\""" AS ?s) $this ex:q ?v BIND("""b""" AS ?t) }`,
      ["ex:a|m {?v}"],
    ],
  ];
  for (const [select, pyshacl] of cases)
    assert.deepEqual(await answers(select), pyshacl, select);
});

test("a blank node is a focus node of a SPARQL constraint, as pyshacl reports it", async () => {
  assert.deepEqual(
    await answers(
      "SELECT $this ?v WHERE { $this ex:q ?v }",
      `[] ex:p ex:b ; ex:q "y" . ex:a ex:p ex:b .`,
    ),
    ["_|m y"],
  );
});

test("a literal focus node is never taken for the node its string names", async () => {
  assert.deepEqual(
    await answers(
      "SELECT $this WHERE { }",
      `ex:a ex:q "https://example.org/a" .`,
      "sh:targetObjectsOf ex:q",
    ),
    [],
  );
});

test("a shape another triple names, but no shape uses, runs its SPARQL constraint", async () => {
  const shapes = await shapesOf(
    `ex:S sh:targetNode ex:a ; sh:sparql [ sh:select "SELECT $this WHERE { }" ] .
     ex:doc ex:mentions ex:S .`,
  );

  const results = await shapes.results(await data(`ex:a ex:r 1 .`));

  assert.deepEqual(
    results.map(({ focusNode }) => focusNode.value),
    ["https://example.org/a"],
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

test("SHACL-SPARQL the runtime does not run is refused when the shapes are read, never skipped", async () => {
  const select = (query: string) =>
    `ex:S sh:targetNode ex:a ; sh:sparql [ sh:select ${JSON.stringify(query)} ] .`;
  const cases: [shapes: string, why: RegExp][] = [
    [`ex:S sh:targetNode ex:a ; sh:sparql [ sh:ask "ASK { }" ] .`, /sh:select/],
    [
      `ex:S sh:targetNode ex:a ; sh:property ex:P . ex:P sh:path ex:r ; sh:sparql [ sh:select "SELECT $this WHERE { }" ] .`,
      /property shape/,
    ],
    [
      `ex:T sh:targetNode ex:a ; sh:node ex:S . ex:S sh:sparql [ sh:select "SELECT $this WHERE { }" ] .`,
      /another shape/,
    ],
    [
      `ex:T sh:targetNode ex:a ; sh:or ( ex:U ex:S ) . ex:S sh:sparql [ sh:select "SELECT $this WHERE { }" ] .`,
      /another shape/,
    ],
    [
      `ex:C a sh:ConstraintComponent ; sh:parameter [ sh:path ex:x ] ; sh:validator [ sh:ask "ASK { }" ] .`,
      /constraint component/,
    ],
    [select("SELECT $this WHERE { GRAPH $shapesGraph { } }"), /shapesGraph/],
    [select("SELECT $this WHERE { VALUES ?x { 1 } }"), /VALUES/],
    [select("SELECT $this WHERE { BIND(ex:a AS # c\n ?this) }"), /assigns/],
    [
      select("SELECT ?v WHERE { { SELECT ?v WHERE { $this ex:q ?v } } }"),
      /sub-select/,
    ],
    [
      select("SELECT $this WHERE { BIND('''a\''' AS ?s) $this ex:q ?v }"),
      /parse|string/,
    ],
  ];
  for (const [shapes, why] of cases)
    await assert.rejects(
      shapesOf(shapes),
      (error: Error) => error instanceof Refusal && why.test(error.message),
      shapes,
    );
});

test("a SPARQL constraint's ?failure refuses the graph", async () => {
  const shapes = await shapesOf(
    `ex:S sh:targetNode ex:a ; sh:sparql [ sh:select "SELECT $this ?failure WHERE { BIND (true AS ?failure) }" ] .`,
  );

  await assert.rejects(
    shapes.results(await data(`ex:a ex:r 1 .`)),
    (error: Error) => error instanceof Refusal && /failure/.test(error.message),
  );
});
