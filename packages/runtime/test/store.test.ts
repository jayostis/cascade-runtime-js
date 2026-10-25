import assert from "node:assert/strict";
import { test } from "node:test";
import { nTriples, OxigraphStore } from "../src/oxigraph-store.js";
import { blank, iri, literal, type Triple, written } from "../src/rdf.js";
import { RestorableUnion, Union } from "../src/store.js";

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

test("terms, quads and graphs the store frees once read leave the same answers when read again; a store freed is never read again", async () => {
  const store = new OxigraphStore();
  const turtle = '<urn:s> <urn:p> 1, 2, "x"@en .\n<urn:t> <urn:p> 1 .';
  const parsed = await store.parse(turtle, "urn:base");
  assert.deepEqual(await store.parse(turtle, "urn:base"), parsed);
  await store.loadTurtle(turtle, { graph: "urn:one" });
  const union = new Set(["urn:one"]);
  const held = await store.holds(parsed, union);
  assert.deepEqual(held, [true, true, true, true]);
  assert.deepEqual(await store.holds(parsed, union), held);
  const integer = "http://www.w3.org/2001/XMLSchema#integer";
  const added = [blank("b"), iri("urn:p"), literal("3", integer)] as const;
  await store.add([added], { graph: "urn:two" });
  const both = new Set(["urn:one", "urn:two"]);
  const construct = "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }";
  const constructed = await store.construct(construct, both);
  assert.equal(constructed.length, 5);
  assert.deepEqual(await store.construct(construct, both), constructed);
  assert.deepEqual(await store.holds(parsed, both), held);
  assert.deepEqual(
    (await store.construct(construct, new Set(["urn:two"]))).map(
      ([, , object]) => written(object),
    ),
    [`"3"^^<${integer}>`],
  );
  store.free();
  await assert.rejects(store.ask("ASK { ?s ?p ?o }", union), /freed/);
});

test("a union restored puts back every graph it dropped, added to or took subjects from, each blank node the node it was, names again a graph that held nothing, drops every graph it added, and is never used again; a copy of the store holds every quad, each blank node under its label", async () => {
  const store = new OxigraphStore();
  await store.loadTurtle("<urn:s> <urn:p> [ <urn:q> 1 ] .", {
    graph: "urn:one",
  });
  const [[, , shared] = []] = await store.construct(
    "CONSTRUCT { ?s <urn:p> ?o } WHERE { GRAPH <urn:one> { ?s <urn:p> ?o } }",
    new Set(),
  );
  assert.equal(shared?.termType, "BlankNode");
  await store.add([[shared, iri("urn:r"), iri("urn:t")] as Triple], {
    graph: "urn:two",
  });
  await store.loadTurtle("<urn:u> <urn:p> 2 . <urn:v> <urn:p> 3 .", {
    graph: "urn:three",
  });
  const quads = async (): Promise<string[]> =>
    (
      await store.select(
        "SELECT ?g ?s ?p ?o WHERE { GRAPH ?g { ?s ?p ?o } }",
        new Set(),
      )
    ).rows
      .map((row) =>
        ["s", "p", "o", "g"]
          .map((name) => written(row.get(name) ?? iri("urn:unbound")))
          .join(" "),
      )
      .sort();
  await store.loadTurtle("", { graph: "urn:empty" });
  const before = await quads();
  const graphs = ["urn:one", "urn:two", "urn:three", "urn:empty"];
  const union = new RestorableUnion(store, graphs);
  await union.drop("urn:one");
  await union.drop("urn:empty");
  await union.add([[iri("urn:w"), iri("urn:p"), blank("fresh")]], "urn:two");
  await union.removeSubjects("urn:three", ["urn:u"]);
  await union.add([[iri("urn:x"), iri("urn:p"), literal("4")]], "urn:four");
  await union.drop("urn:four");
  await union.add([[iri("urn:y"), iri("urn:p"), literal("5")]], "urn:five");
  assert.equal(await union.ask("ASK { ?s <urn:q> 1 }"), false);
  const loaded: string[] = [];
  const loadTurtle = store.loadTurtle.bind(store);
  store.loadTurtle = (turtle, options) => {
    loaded.push(options.graph);
    return loadTurtle(turtle, options);
  };
  await union.restore();
  assert.deepEqual(loaded, ["urn:empty"]);
  assert.equal(union.moved, 2 + 1 + 1 + 1 + 2 + 1);
  assert.deepEqual(await quads(), before);
  const joined =
    "ASK { <urn:s> <urn:p> ?node . ?node <urn:q> 1 ; <urn:r> <urn:t> }";
  assert.equal(await new Union(store, graphs).ask(joined), true);
  await assert.rejects(union.ask("ASK { ?s ?p ?o }"), /restored/);
  await assert.rejects(union.drop("urn:two"), /restored/);
  await assert.rejects(union.restore(), /restored/);

  const copy = await store.copy();
  const held = await quads();
  store.free();
  const copied = new Union(copy, graphs);
  assert.equal(await copied.ask(joined), true);
  assert.deepEqual(
    (
      await copy.select(
        "SELECT ?g ?s ?p ?o WHERE { GRAPH ?g { ?s ?p ?o } }",
        new Set(),
      )
    ).rows
      .map((row) =>
        ["s", "p", "o", "g"]
          .map((name) => written(row.get(name) ?? iri("urn:unbound")))
          .join(" "),
      )
      .sort(),
    held,
  );
});

test("a CONSTRUCT gives every term as a parse of the same Turtle does: escapes, languages with or without a direction, datatypes, IRIs beyond ASCII and shared blank nodes; a literal of many escapes is read in linear time", async () => {
  const store = new OxigraphStore();
  const turtle = String.raw`<urn:s> <urn:p> "say \"hi\"\\ \n\r\t\b\f \u0001 é 😀"@en-GB, "x"^^<urn:type>, "", "1"^^<http://www.w3.org/2001/XMLSchema#integer>, _:a, [ <urn:q> _:a ] .
_:a <urn:p> <urn:s#fragment?query>, <https://exämple.org/ü/日本>, "مرحبا"@ar--rtl .`;
  await store.loadTurtle(turtle, { graph: "urn:one" });
  const constructed = await store.construct(
    "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }",
    new Set(["urn:one"]),
  );
  const parsed = await store.parse(turtle, "urn:one");
  const lines = (triples: readonly Triple[]) =>
    triples
      .map((triple) =>
        JSON.stringify(
          triple.map((term) => (term.termType === "BlankNode" ? "_:" : term)),
        ),
      )
      .sort();
  const blanks = (triples: readonly Triple[]) =>
    new Set(
      triples.flatMap((triple) =>
        triple.flatMap((term) =>
          term.termType === "BlankNode" ? [term.value] : [],
        ),
      ),
    ).size;
  assert.deepEqual(lines(constructed), lines(parsed));
  assert.equal(blanks(constructed), blanks(parsed));

  const escapes = 200_000;
  const long = `<urn:s> <urn:p> "${"\\n".repeat(escapes)}" .\n`;
  const started = performance.now();
  const [[, , object] = []] = nTriples(long);
  assert.equal(object?.value.length, escapes);
  assert.ok(performance.now() - started < 400);
});
