import assert from "node:assert/strict";
import { test } from "node:test";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, literal, written } from "../src/rdf.js";
import { Union } from "../src/store.js";

test("a query's default graph is the union of the graphs it names, GRAPH reads every graph, and blank nodes are shared across graphs", async () => {
  const store = new OxigraphStore();
  await store.loadTurtle('<#a> <https://ex.example/p> "x"@en, 1 .', {
    graph: "https://pod.example/one.ttl",
  });
  await store.add([[iri("urn:s"), iri("https://ex.example/p"), literal("y")]], {
    graph: "urn:aside",
  });

  const { variables, rows } = await store.select(
    "SELECT ?g ?s ?o WHERE { GRAPH ?g { ?s <https://ex.example/p> ?o } }",
    new Set(),
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
  const one = new Set(["https://pod.example/one.ttl"]);
  assert.equal(
    await store.ask('ASK { <https://pod.example/one.ttl#a> ?p "x"@en }', one),
    true,
  );
  assert.equal(await store.ask("ASK { <urn:s> ?p ?o }", one), false);
  assert.equal(
    await store.ask("ASK { <urn:s> ?p ?o }", new Set([...one, "urn:aside"])),
    true,
  );
  assert.equal(await store.ask("ASK { ?s ?p ?o }", new Set()), false);

  await store.loadTurtle("<urn:b> <urn:r> _:x, [] .", { graph: "urn:blank" });
  const joined = await store.select(
    "SELECT ?o WHERE { <urn:b> <urn:r> ?o . GRAPH <urn:blank> { <urn:b> <urn:r> ?o } }",
    new Set(["urn:blank"]),
  );
  assert.equal(joined.rows.length, 2);
  await store.loadTurtle("<urn:b> <urn:r> _:x .", { graph: "urn:other" });
  const apart = await store.select(
    "SELECT DISTINCT ?o WHERE { <urn:b> <urn:r> ?o }",
    new Set(["urn:blank", "urn:other"]),
  );
  assert.equal(apart.rows.length, 3);

  const union = new Union(store, ["urn:other"]);
  const [[, , loaded] = []] = await union.construct(
    "CONSTRUCT { <urn:b> <urn:r> ?o } WHERE { <urn:b> <urn:r> ?o }",
  );
  assert.equal(loaded?.termType, "BlankNode");
  await union.add([[loaded, iri("urn:t"), literal("z")]], "urn:added");
  assert.deepEqual(union.graphs, new Set(["urn:added", "urn:other"]));
  assert.equal(
    await union.ask('ASK { <urn:b> <urn:r> ?o . ?o <urn:t> "z" }'),
    true,
  );
  assert.equal(
    await new Union(store, ["urn:other"]).ask("ASK { ?o <urn:t> ?z }"),
    false,
  );
});
