import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { nTriples, OxigraphStore } from "../src/oxigraph-store.js";
import { blank, iri, literal, type Triple, written } from "../src/rdf.js";
import { RestorableUnion, type Store, Union } from "../src/store.js";

const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";

/** Every quad the store holds, as `subject predicate object graph`, sorted. */
async function quadsOf(store: Store): Promise<string[]> {
  return (
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
}

/** A store that holds one graph from Turtle with a relative IRI and a literal in a language, and one made by `add`. */
async function holdingTwoGraphs(): Promise<OxigraphStore> {
  const store = new OxigraphStore();
  await store.loadTurtle('<#a> <https://ex.example/p> "x"@en, 1 .', {
    graph: "https://pod.example/one.ttl",
  });
  await store.add([[iri("urn:s"), iri("https://ex.example/p"), literal("y")]], {
    graph: "urn:aside",
  });
  return store;
}

/** What a store of one graph with a blank node returns, then of the same graph, and of a graph that adds a blank node. */
async function restorable() {
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
  await store.loadTurtle("", { graph: "urn:empty" });
  const quadsBefore = await quadsOf(store);
  const graphs = ["urn:one", "urn:two", "urn:three", "urn:empty"];
  const union = new RestorableUnion(store, graphs);
  await union.drop("urn:one");
  await union.drop("urn:empty");
  await union.add([[iri("urn:w"), iri("urn:p"), blank("fresh")]], "urn:two");
  await union.removeSubjects("urn:three", ["urn:u"]);
  await union.add([[iri("urn:x"), iri("urn:p"), literal("4")]], "urn:four");
  await union.drop("urn:four");
  await union.add([[iri("urn:y"), iri("urn:p"), literal("5")]], "urn:five");
  const changed = await union.ask("ASK { ?s <urn:q> 1 }");
  const loaded: string[] = [];
  const loadTurtle = store.loadTurtle.bind(store);
  store.loadTurtle = (turtle, options) => {
    loaded.push(options.graph);
    return loadTurtle(turtle, options);
  };
  await union.restore();
  const joined =
    "ASK { <urn:s> <urn:p> ?node . ?node <urn:q> 1 ; <urn:r> <urn:t> }";
  const restored = {
    changed,
    loaded,
    moved: union.moved,
    quadsBefore,
    quadsAfter: await quadsOf(store),
    joined: await new Union(store, graphs).ask(joined),
  };
  const held = await quadsOf(store);
  const copy = await store.renewed();
  return {
    store,
    union,
    restored,
    renewal: {
      held,
      copied: await quadsOf(copy),
      joined: await new Union(copy, graphs).ask(joined),
    },
  };
}

let sequence: ReturnType<typeof restorable> | undefined;

/** A store and a union restored, made once for the leaves of both and never written after. */
const afterRestore = () => (sequence ??= restorable());

/**
 * A store holds named graphs and runs SPARQL over them. A `Union` is a store read with some of its graphs as the default
 * graph, which is how a pod is read under a lens; a `RestorableUnion` is one that can be changed for a while and then
 * put back exactly.
 */
describe("Holding graphs and querying them · OxigraphStore, Union, RestorableUnion", () => {
  describe("OxigraphStore", () => {
    let graphs: { variables: readonly string[]; rows: string[] };
    let asks: boolean[];
    let blanks: { joined: number; apart: number };
    let again: {
      parsed: [unknown, unknown];
      holds: [boolean[], boolean[], boolean[]];
      constructed: [Triple[], Triple[]];
      second: string[];
    };
    let freed: OxigraphStore;

    before(async () => {
      const store = await holdingTwoGraphs();
      const { variables, rows } = await store.select(
        "SELECT ?g ?s ?o WHERE { GRAPH ?g { ?s <https://ex.example/p> ?o } }",
        new Set(),
      );
      graphs = {
        variables,
        rows: rows
          .map((row) =>
            ["g", "s", "o"]
              .map((name) => written(row.get(name) ?? iri("urn:unbound")))
              .join(" "),
          )
          .sort(),
      };
      const one = new Set(["https://pod.example/one.ttl"]);
      asks = [
        await store.ask(
          'ASK { <https://pod.example/one.ttl#a> ?p "x"@en }',
          one,
        ),
        await store.ask("ASK { <urn:s> ?p ?o }", one),
        await store.ask(
          "ASK { <urn:s> ?p ?o }",
          new Set([...one, "urn:aside"]),
        ),
        await store.ask("ASK { ?s ?p ?o }", new Set()),
      ];
      await store.loadTurtle("<urn:b> <urn:r> _:x, [] .", {
        graph: "urn:blank",
      });
      const joined = await store.select(
        "SELECT ?o WHERE { <urn:b> <urn:r> ?o . GRAPH <urn:blank> { <urn:b> <urn:r> ?o } }",
        new Set(["urn:blank"]),
      );
      await store.loadTurtle("<urn:b> <urn:r> _:x .", { graph: "urn:other" });
      const apart = await store.select(
        "SELECT DISTINCT ?o WHERE { <urn:b> <urn:r> ?o }",
        new Set(["urn:blank", "urn:other"]),
      );
      blanks = { joined: joined.rows.length, apart: apart.rows.length };

      const reading = new OxigraphStore();
      const turtle = '<urn:s> <urn:p> 1, 2, "x"@en .\n<urn:t> <urn:p> 1 .';
      const parsed = await reading.parse(turtle, "urn:base");
      await reading.loadTurtle(turtle, { graph: "urn:one" });
      const union = new Set(["urn:one"]);
      const held = await reading.holds(parsed, union);
      const added = [
        blank("b"),
        iri("urn:p"),
        literal("3", XSD_INTEGER),
      ] as const;
      await reading.add([added], { graph: "urn:two" });
      const both = new Set(["urn:one", "urn:two"]);
      const construct = "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }";
      const constructed = await reading.construct(construct, both);
      again = {
        parsed: [parsed, await reading.parse(turtle, "urn:base")],
        holds: [
          held,
          await reading.holds(parsed, union),
          await reading.holds(parsed, both),
        ],
        constructed: [constructed, await reading.construct(construct, both)],
        second: (await reading.construct(construct, new Set(["urn:two"]))).map(
          ([, , object]) => written(object),
        ),
      };
      reading.free();
      freed = reading;
    });

    it("returns to `GRAPH ?g` the triples of every graph, whichever graphs the query names", () => {
      assert.deepEqual(graphs.variables, ["g", "s", "o"]);
      assert.equal(graphs.rows.length, 3);
      assert.deepEqual(
        new Set(graphs.rows.map((row) => row.split(" ")[0])),
        new Set(["<https://pod.example/one.ttl>", "<urn:aside>"]),
      );
    });

    it("resolves a relative IRI against the graph it is loaded into", () => {
      assert.ok(
        graphs.rows.every(
          (row) =>
            row.includes("<https://pod.example/one.ttl#a>") ||
            row.includes("<urn:s>"),
        ),
      );
      assert.equal(
        graphs.rows.filter((row) =>
          row.includes("<https://pod.example/one.ttl#a>"),
        ).length,
        2,
      );
    });

    it("keeps a literal's language and its datatype", () => {
      assert.ok(graphs.rows.some((row) => row.endsWith('"x"@en')));
      assert.ok(
        graphs.rows.some((row) => row.endsWith(`"1"^^<${XSD_INTEGER}>`)),
      );
    });

    it("reads the union of the graphs a query names, and no graph when it names none", () => {
      assert.deepEqual(asks, [true, false, true, false]);
    });

    it("joins a blank node between the default graph and a `GRAPH` of the same graph", () => {
      assert.equal(blanks.joined, 2);
    });

    it("keeps two graphs' blank nodes apart, though one label names both", () => {
      assert.equal(blanks.apart, 3);
    });

    it("returns the same terms when asked again, having freed what it read the first time", () => {
      assert.deepEqual(again.parsed[1], again.parsed[0]);
      assert.deepEqual(again.holds[0], [true, true, true, true]);
      assert.deepEqual(again.holds[1], again.holds[0]);
      assert.deepEqual(again.holds[2], again.holds[0]);
      assert.equal(again.constructed[0].length, 5);
      assert.deepEqual(again.constructed[1], again.constructed[0]);
      assert.deepEqual(again.second, [`"3"^^<${XSD_INTEGER}>`]);
    });

    it("rejects every query after `free()`", async () => {
      await assert.rejects(freed.ask("ASK { ?s ?p ?o }", new Set()), /freed/);
    });

    it("returns from a CONSTRUCT each term as a parse of the same Turtle gives it", async () => {
      const { constructed, parsed } = await constructedAndParsed();
      const lines = (triples: readonly Triple[]) =>
        triples
          .map((triple) =>
            JSON.stringify(
              triple.map((term) =>
                term.termType === "BlankNode" ? "_:" : term,
              ),
            ),
          )
          .sort();
      assert.deepEqual(lines(constructed), lines(parsed));
    });

    it("returns as many blank nodes from a CONSTRUCT as the parse has", async () => {
      const { constructed, parsed } = await constructedAndParsed();
      const blanks = (triples: readonly Triple[]) =>
        new Set(
          triples.flatMap((triple) =>
            triple.flatMap((term) =>
              term.termType === "BlankNode" ? [term.value] : [],
            ),
          ),
        ).size;
      assert.equal(blanks(constructed), blanks(parsed));
    });
  });

  describe("nTriples(text)", () => {
    it("reads a literal of 200,000 escapes in under 400 ms", () => {
      const escapes = 200_000;
      const long = `<urn:s> <urn:p> "${"\\n".repeat(escapes)}" .\n`;
      const started = performance.now();
      const [[, , object] = []] = nTriples(long);
      assert.equal(object?.value.length, escapes);
      assert.ok(performance.now() - started < 400);
    });
  });

  describe("Union", () => {
    let union: Union;
    let store: OxigraphStore;
    let loaded: { termType: string } | undefined;
    let readsBack: boolean;
    let otherUnion: boolean;

    before(async () => {
      store = new OxigraphStore();
      await store.loadTurtle("<urn:b> <urn:r> _:x .", { graph: "urn:other" });
      union = new Union(store, ["urn:other"]);
      const [[, , node] = []] = await union.construct(
        "CONSTRUCT { <urn:b> <urn:r> ?o } WHERE { <urn:b> <urn:r> ?o }",
      );
      loaded = node;
      if (node?.termType === "BlankNode")
        await union.add([[node, iri("urn:t"), literal("z")]], "urn:added");
      readsBack = await union.ask(
        'ASK { <urn:b> <urn:r> ?o . ?o <urn:t> "z" }',
      );
      otherUnion = await new Union(store, ["urn:other"]).ask(
        "ASK { ?o <urn:t> ?z }",
      );
    });

    it("adds to its graphs each graph it adds triples to", () => {
      assert.deepEqual(union.graphs, new Set(["urn:added", "urn:other"]));
    });

    it("reads a blank node a CONSTRUCT returned as the node the store holds", () => {
      assert.equal(loaded?.termType, "BlankNode");
      assert.equal(readsBack, true);
    });

    it("leaves out a graph that another union of the same store added", () => {
      assert.equal(otherUnion, false);
    });
  });

  describe("RestorableUnion", () => {
    let done: Awaited<ReturnType<typeof restorable>>;

    before(async () => {
      done = await afterRestore();
    });

    it("puts back every quad of each graph it dropped, added to or took subjects from, each blank node the node it was", () => {
      assert.equal(done.restored.changed, false);
      assert.deepEqual(done.restored.quadsAfter, done.restored.quadsBefore);
      assert.equal(done.restored.joined, true);
    });

    it("drops each graph it added", () => {
      assert.ok(done.restored.quadsAfter.length > 0);
      for (const graph of ["<urn:four>", "<urn:five>"])
        assert.ok(
          done.restored.quadsAfter.every((quad) => !quad.endsWith(` ${graph}`)),
          graph,
        );
    });

    it("tells the store the empty graph's name again when it restores, once, for that graph only", () => {
      assert.deepEqual(done.restored.loaded, ["urn:empty"]);
    });

    it("counts in `moved` each quad it added and each quad a changed graph held", () => {
      assert.equal(done.restored.moved, 2 + 1 + 1 + 1 + 2 + 1);
    });

    it("rejects every use after `restore()`", async () => {
      await assert.rejects(done.union.ask("ASK { ?s ?p ?o }"), /restored/);
      await assert.rejects(done.union.drop("urn:two"), /restored/);
      await assert.rejects(done.union.restore(), /restored/);
    });
  });

  describe("store.renewed()", () => {
    let done: Awaited<ReturnType<typeof restorable>>;

    before(async () => {
      done = await afterRestore();
    });

    it("frees the store it is called on", async () => {
      await assert.rejects(
        done.store.ask("ASK { ?s ?p ?o }", new Set()),
        /freed/,
      );
    });

    it("returns a store that holds every quad", () => {
      assert.deepEqual(done.renewal.copied, done.renewal.held);
    });

    it("keeps in the new store each blank node the node it was", () => {
      assert.equal(done.renewal.joined, true);
    });
  });
});

/** A CONSTRUCT of every triple of Turtle that has escapes, languages, datatypes, IRIs beyond ASCII and shared blank nodes, and a parse of it. */
async function constructedAndParsed() {
  const store = new OxigraphStore();
  const turtle = String.raw`<urn:s> <urn:p> "say \"hi\"\\ \n\r\t\b\f \u0001 é 😀"@en-GB, "x"^^<urn:type>, "", "1"^^<http://www.w3.org/2001/XMLSchema#integer>, _:a, [ <urn:q> _:a ] .
_:a <urn:p> <urn:s#fragment?query>, <https://exämple.org/ü/日本>, "مرحبا"@ar--rtl .`;
  await store.loadTurtle(turtle, { graph: "urn:one" });
  const constructed = await store.construct(
    "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }",
    new Set(["urn:one"]),
  );
  return { constructed, parsed: await store.parse(turtle, "urn:one") };
}
