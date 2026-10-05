import assert from "node:assert/strict";
import { test } from "node:test";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, literal, written } from "../src/rdf.js";

test("the store answers over named graphs, and its default graph holds what was not loaded alone, blank nodes and all", async () => {
  const store = new OxigraphStore();
  await store.loadTurtle('<#a> <https://ex.example/p> "x"@en, 1 .', {
    graph: "https://pod.example/one.ttl",
  });
  await store.add([[iri("urn:s"), iri("https://ex.example/p"), literal("y")]], {
    graph: "urn:aside",
    alone: true,
  });

  const { variables, rows } = await store.select(
    "SELECT ?g ?s ?o WHERE { GRAPH ?g { ?s <https://ex.example/p> ?o } }",
  );
  assert.deepEqual(variables, ["g", "s", "o"]);
  assert.deepEqual(
    rows
      .map((row) =>
        ["g", "s", "o"]
          .map((name) => written(row.get(name) ?? iri("urn:unbound")))
          .join(" "),
      )
      .sort(),
    [
      '<https://pod.example/one.ttl> <https://pod.example/one.ttl#a> "1"^^<http://www.w3.org/2001/XMLSchema#integer>',
      '<https://pod.example/one.ttl> <https://pod.example/one.ttl#a> "x"@en',
      '<urn:aside> <urn:s> "y"',
    ],
  );
  assert.equal(
    await store.ask('ASK { <https://pod.example/one.ttl#a> ?p "x"@en }'),
    true,
  );
  assert.equal(await store.ask("ASK { <urn:s> ?p ?o }"), false);
  await store.loadTurtle("<urn:b> <urn:r> _:x, [] .", { graph: "urn:blank" });
  const joined = await store.select(
    "SELECT ?o WHERE { <urn:b> <urn:r> ?o . GRAPH <urn:blank> { <urn:b> <urn:r> ?o } }",
  );
  assert.equal(joined.rows.length, 2);
  const built = await store.construct(
    "CONSTRUCT { ?s <urn:q> ?o } WHERE { GRAPH <urn:aside> { ?s ?p ?o } }",
  );
  assert.deepEqual(
    built.map((triple) => triple.map(written).join(" ")),
    ['<urn:s> <urn:q> "y"'],
  );
});
