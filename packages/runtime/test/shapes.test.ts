import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
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

const DATA = `ex:a ex:p ex:b ; ex:q "x" ; ex:this ex:z ; ex:n 2 . ex:other ex:p ex:c ; ex:n 9 . ex:k ex:select ex:l .`;

/** The focus nodes of one SPARQL constraint's results on `turtle`, and the first message of each, as `node|message`. */
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

/** Each of the cases a query is held to: what it answers, as pyshacl answers it, and the data it is asked of. */
async function holds(
  cases: readonly (readonly [
    select: string,
    pyshacl: string[],
    turtle?: string,
  ])[],
): Promise<void> {
  for (const [select, pyshacl, turtle] of cases)
    assert.deepEqual(await answers(select, turtle), pyshacl, select);
}

const select = (query: string) =>
  `ex:S sh:targetNode ex:a ; sh:sparql [ sh:select ${JSON.stringify(query)} ] .`;

/** What `Shapes.read` refuses, for each set of shapes, by the words of its refusal. */
async function refuses(
  cases: readonly (readonly [shapes: string, why: RegExp])[],
): Promise<void> {
  for (const [shapes, why] of cases)
    await assert.rejects(
      shapesOf(shapes),
      (error: Error) => error instanceof Refusal && why.test(error.message),
      shapes,
    );
}

/**
 * The vocabulary's SHACL shapes say what a well-formed file of a pod holds, and some say it with a SPARQL constraint,
 * which the SHACL library the runtime uses does not run. `Shapes` runs those itself, to the results pyshacl gives, and
 * refuses any SHACL-SPARQL it does not run instead of skipping it. Check 3 of a kit reads every file of the pod
 * against them, and no example can state that check: SPARQL cannot run SHACL.
 * @rule runtime/the-kit.feature Check 3
 */
describe("Checking a graph against the vocabulary's shapes · Shapes.read(), Shapes.results()", () => {
  /**
   * `tests/shape-cases/` of the vocabulary holds about 180 cases that pyshacl runs; this one is run here by hand, for
   * the one real SPARQL constraint path through the vocabulary's own shapes.
   */
  describe("given the vocabulary's own shapes and its case of a record named from its server", () => {
    const SERVER_NAME =
      "A record's name, unless it is an organization's, is the one cascade:RecordFromServerNamingRule gives its source address: expected urn:uuid:6d03d846-ac92-8492-ac9f-e810307f7bda.";
    let shapes: Shapes;
    let valid: Triple[];
    let tampered: Triple[];

    before(async () => {
      const files = await vocabulary();
      shapes = await Shapes.read(files, newStore);
      const shapeCase = async (name: string) =>
        newStore().parse(
          await readText(
            files,
            `tests/shape-cases/record-server-name/${name}.ttl`,
          ),
          files.iri,
        );
      valid = await shapeCase("valid");
      tampered = await shapeCase("name-tampered");
    });

    it("returns no result for the valid case", async () => {
      assert.deepEqual(await shapes.results(valid), []);
    });

    it("returns one violation of `cascade:ServerRecordNameShape` for the case whose name was changed, its message saying the name expected", async () => {
      assert.deepEqual(
        (await shapes.results(tampered)).map(
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
            [SERVER_NAME],
          ],
        ],
      );
    });

    /** A kit's check 3 and an entry session's refusal both print these lines. */
    it("returns from `resultLines()` that result as one line of its focus node, its path and its message", async () => {
      assert.deepEqual(await shapes.resultLines(tampered), [
        `urn:uuid:6d03d846-ac92-8492-ac9f-e810307f7bdb : ${SERVER_NAME}`,
      ]);
    });
  });

  describe("given a shape with a SPARQL constraint, whose results `Shapes.results()` returns", () => {
    const everyNode = `sh:sparql [ sh:select "SELECT $this WHERE { }" ]`;
    const prefixed = `ex: sh:declare [ sh:prefix "ex" ; sh:namespace "https://example.org/"^^xsd:anyURI ] .
     ex:Labelled sh:targetSubjectsOf ex:label ; sh:severity sh:Warning ;
       sh:property [ sh:path ex:label ; sh:datatype xsd:string ; sh:message "A label is a string."@en ] ;
       sh:sparql [
         sh:prefixes ex: ;
         sh:message "{$this} is labelled {?label} by {?shape}."@en ;
         sh:select "SELECT $this ?label ?shape WHERE { $this ex:label ?label . BIND ($currentShape AS ?shape) }"
       ] .`;

    const targetedResults = async () => {
      const shapes = await shapesOf(
        `ex:ByClass sh:targetClass ex:Thing ; ${everyNode} .
     ex:BySubject sh:targetSubjectsOf ex:p ; ${everyNode} .
     ex:ByObject sh:targetObjectsOf ex:p ; ${everyNode} .
     ex:ByNode sh:targetNode ex:e ; ${everyNode} .`,
        `ex:Kind rdfs:subClassOf ex:Thing .`,
      );
      return (
        await shapes.results(
          await data(`ex:a a ex:Kind .
       ex:b ex:p ex:c .
       ex:c ex:r 1 .
       ex:e ex:r 2 .
       ex:f a ex:Other .`),
        )
      )
        .map(({ sourceShape, focusNode }) => [
          sourceShape.value.replace("https://example.org/", "ex:"),
          focusNode.value.replace("https://example.org/", "ex:"),
        ])
        .sort();
    };

    it("takes as focus nodes the shape's targets by class, by subject, by object and by node", async () => {
      assert.deepEqual(await targetedResults(), [
        ["ex:ByClass", "ex:a"],
        ["ex:ByNode", "ex:e"],
        ["ex:ByObject", "ex:c"],
        ["ex:BySubject", "ex:b"],
      ]);
    });

    it("takes an instance of a subclass the vocabulary's terms declare as an instance of its class", async () => {
      assert.deepEqual(
        (await targetedResults()).filter(([shape]) => shape === "ex:ByClass"),
        [["ex:ByClass", "ex:a"]],
      );
    });

    it("writes each variable's value into the constraint's message, `$currentShape` among them", async () => {
      const results = await (
        await shapesOf(prefixed)
      ).results(await data(`ex:a ex:label 7 .`));
      assert.deepEqual(
        results
          .filter(
            ({ sourceConstraintComponent }) =>
              sourceConstraintComponent.value ===
              `${SH}SPARQLConstraintComponent`,
          )
          .map(({ message }) => message),
        [
          [
            "https://example.org/a is labelled 7 by https://example.org/Labelled.",
          ],
        ],
      );
    });

    it("runs a query written with a prefix the shapes declare by `sh:declare`", async () => {
      const results = await (
        await shapesOf(prefixed)
      ).results(await data(`ex:a ex:label 7 .`));
      assert.equal(
        results.filter(
          ({ sourceConstraintComponent }) =>
            sourceConstraintComponent.value ===
            `${SH}SPARQLConstraintComponent`,
        ).length,
        1,
      );
    });

    it("returns the results of the shape's other constraints beside the SPARQL constraint's", async () => {
      const results = await (
        await shapesOf(prefixed)
      ).results(await data(`ex:a ex:label 7 .`));
      assert.deepEqual(
        results
          .filter(({ severity }) => severity.value === `${SH}Violation`)
          .map(({ message }) => message),
        [["A label is a string."]],
      );
    });

    it("gives a result its shape's severity, whatever severity the constraint itself states", async () => {
      const result = async (shapes: string, node: string) =>
        (
          await (await shapesOf(shapes)).results(await data(`${node} ex:r 1 .`))
        ).map(({ severity }) => severity.value);
      assert.deepEqual(
        await result(
          `ex:Both sh:targetNode ex:a ; sh:severity sh:Warning ;
             sh:sparql [ sh:severity sh:Info ; sh:select "SELECT $this WHERE { }" ] .`,
          "ex:a",
        ),
        [`${SH}Warning`],
        "a Warning shape whose constraint says Info",
      );
      assert.deepEqual(
        await result(
          `ex:Own sh:targetNode ex:a ; sh:sparql [ sh:select "SELECT $this WHERE { }" ] .`,
          "ex:a",
        ),
        [`${SH}Violation`],
        "a shape and a constraint that state none",
      );
      assert.deepEqual(
        (
          await (
            await shapesOf(prefixed)
          ).results(await data(`ex:a ex:label 7 .`))
        )
          .filter(
            ({ sourceConstraintComponent }) =>
              sourceConstraintComponent.value ===
              `${SH}SPARQLConstraintComponent`,
          )
          .map(({ severity }) => severity.value),
        [`${SH}Warning`],
        "a Warning shape whose constraint states none",
      );
    });

    it("gives a result the constraint's messages and its shape's together", async () => {
      const shapes = await shapesOf(
        `ex:Both sh:targetNode ex:a ; sh:severity sh:Warning ; sh:message "shape" ;
           sh:sparql [ sh:severity sh:Info ; sh:select "SELECT $this WHERE { }" ] .
         ex:Own sh:targetNode ex:a ; sh:message "shape" ;
           sh:sparql [ sh:message "own" ; sh:select "SELECT $this WHERE { }" ] .`,
      );
      assert.deepEqual(
        (await shapes.results(await data(`ex:a ex:r 1 .`)))
          .map(({ sourceShape, message }) => [
            sourceShape.value.replace("https://example.org/", "ex:"),
            [...message].sort(),
          ])
          .sort(),
        [
          ["ex:Both", ["shape"]],
          ["ex:Own", ["own", "shape"]],
        ],
      );
    });

    it("takes a blank node as a focus node", async () => {
      assert.deepEqual(
        await answers(
          "SELECT $this ?v WHERE { $this ex:q ?v }",
          `[] ex:p ex:b ; ex:q "y" . ex:a ex:p ex:b .`,
        ),
        ["_|m y"],
      );
    });

    it("returns no result for a literal focus node whose string is another node's IRI", async () => {
      assert.deepEqual(
        await answers(
          "SELECT $this WHERE { }",
          `ex:a ex:q "https://example.org/a" .`,
          "sh:targetObjectsOf ex:q",
        ),
        [],
      );
    });

    it("runs the constraint of a shape that a triple names and no shape uses", async () => {
      const shapes = await shapesOf(
        `ex:S sh:targetNode ex:a ; sh:sparql [ sh:select "SELECT $this WHERE { }" ] .
         ex:doc ex:mentions ex:S .`,
      );
      assert.deepEqual(
        (await shapes.results(await data(`ex:a ex:r 1 .`))).map(
          ({ focusNode }) => focusNode.value,
        ),
        ["https://example.org/a"],
      );
    });

    it("returns no result for a deactivated constraint, or for a constraint of a deactivated shape", async () => {
      const shapes = await shapesOf(
        `ex:Active sh:targetNode ex:a ; sh:sparql [ sh:select "SELECT $this WHERE { }" ] .
         ex:Off sh:targetNode ex:a ; sh:deactivated true ; sh:sparql [ sh:select "SELECT $this WHERE { }" ] .
         ex:OneOff sh:targetNode ex:a ; sh:sparql [ sh:deactivated true ; sh:select "SELECT $this WHERE { }" ] .`,
      );
      assert.deepEqual(
        (await shapes.results(await data(`ex:a ex:r 1 .`))).map(
          ({ sourceShape }) => sourceShape.value,
        ),
        ["https://example.org/Active"],
      );
    });

    it("throws Refusal for a row that binds `?failure`", async () => {
      const shapes = await shapesOf(
        `ex:S sh:targetNode ex:a ; sh:sparql [ sh:select "SELECT $this ?failure WHERE { BIND (true AS ?failure) }" ] .`,
      );
      await assert.rejects(
        shapes.results(await data(`ex:a ex:r 1 .`)),
        (error: Error) =>
          error instanceof Refusal && /failure/.test(error.message),
      );
    });
  });

  describe("given a query that reads `$this` where a plain substitution would miss it", () => {
    it("binds `$this` inside a sub-select that returns it, with and without GROUP BY", async () => {
      await holds([
        [
          "SELECT $this ?v WHERE { { SELECT $this ?v WHERE { $this ex:q ?v } } }",
          ["ex:a|m x"],
        ],
        [
          "SELECT $this ?v WHERE { { SELECT $this (COUNT(?o) AS ?v) WHERE { $this ex:p ?o } GROUP BY $this } FILTER(?v > 0) }",
          ["ex:a|m 1", "ex:other|m 1"],
        ],
      ]);
    });

    it("binds `$this` in GROUP BY, in ORDER BY and in BOUND", async () => {
      await holds([
        [
          "SELECT $this (COUNT(?o) AS ?v) WHERE { $this ex:p ?o } GROUP BY $this",
          ["ex:a|m 1", "ex:other|m 1"],
        ],
        [
          "SELECT $this ?v WHERE { $this ex:q ?v } ORDER BY $this",
          ["ex:a|m x"],
        ],
        [
          "SELECT $this WHERE { $this ex:q ?v FILTER(BOUND($this)) }",
          ["ex:a|m {?v}"],
        ],
      ]);
    });

    it("finds `$this` after an unspaced `<` that follows a variable, a number, a tagged string or a cast", async () => {
      await holds([
        [
          `SELECT $this WHERE { $this ex:n ?v FILTER(?v<5&&STR($this)>"") }`,
          ["ex:a|m {?v}"],
        ],
        [
          `SELECT $this ?v WHERE { $this ex:n ?v FILTER(1e0<?v&&STR($this)>"") }`,
          ["ex:a|m 2", "ex:other|m 9"],
        ],
        [
          `SELECT $this ?v WHERE { $this ex:n ?v FILTER("a"@en<?v&&STR($this)>"") }`,
          [],
        ],
        [
          `SELECT $this ?v WHERE { $this ex:n ?v FILTER(<http://www.w3.org/2001/XMLSchema#integer>(?v)<5&&STR($this)>"") }`,
          ["ex:a|m 2"],
        ],
      ]);
    });

    it("leaves alone an IRI in a collection whose `#` a comment could be read from", async () => {
      await holds([
        [
          "SELECT $this WHERE { ?s ex:list (<urn:a> <http://e/#b>) . $this ex:q ?v }",
          ["ex:a|m {?v}"],
          `${DATA} ex:k ex:list (<urn:a> <http://e/#b>) .`,
        ],
      ]);
    });

    it("reads a prefixed name spelled like a keyword as a name", async () => {
      await holds([
        [
          "SELECT $this WHERE { ?k ex:select ?l . $this ex:q ?v }",
          ["ex:a|m {?v}"],
        ],
      ]);
    });

    it("reads past a long string that ends in a backslash", async () => {
      await holds([
        [
          `SELECT $this WHERE { BIND("""a\\\\""" AS ?s) $this ex:q ?v BIND("""b""" AS ?t) }`,
          ["ex:a|m {?v}"],
        ],
      ]);
    });
  });

  describe("Shapes.read(vocabulary, newStore)", () => {
    it("throws Refusal for a constraint that is no `sh:select`: an `sh:ask`, or a constraint component", async () => {
      await refuses([
        [
          `ex:S sh:targetNode ex:a ; sh:sparql [ sh:ask "ASK { }" ] .`,
          /sh:select/,
        ],
        [
          `ex:C a sh:ConstraintComponent ; sh:parameter [ sh:path ex:x ] ; sh:validator [ sh:ask "ASK { }" ] .`,
          /constraint component/,
        ],
      ]);
    });

    it("throws Refusal for a SPARQL constraint on a property shape, or on a shape another reaches by `sh:node` or `sh:or`", async () => {
      await refuses([
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
      ]);
    });

    it("throws Refusal for a query that reads `$shapesGraph`, has `VALUES`, assigns `?this`, or reads `$this` in a sub-select that does not return it", async () => {
      await refuses([
        [
          select("SELECT $this WHERE { GRAPH $shapesGraph { } }"),
          /shapesGraph/,
        ],
        [select("SELECT $this WHERE { VALUES ?x { 1 } }"), /VALUES/],
        [select("SELECT $this WHERE { BIND(ex:a AS # c\n ?this) }"), /assigns/],
        [
          select("SELECT ?v WHERE { { SELECT ?v WHERE { $this ex:q ?v } } }"),
          /sub-select/,
        ],
      ]);
    });

    it("throws Refusal for a query that does not parse, or whose string is unterminated", async () => {
      await refuses([
        [
          select(
            "SELECT $this WHERE { BIND('''a\\''' AS ?s) $this <https://example.org/q> ?v }",
          ),
          /unterminated string/,
        ],
        [select("SELECT $this WHERE { $this ex:q ?v }"), /does not parse/],
      ]);
    });
  });
});
