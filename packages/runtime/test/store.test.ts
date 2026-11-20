import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { nTriples, OxigraphStore } from "../src/oxigraph-store.js";
import { blank, iri, literal, type Triple, written } from "../src/rdf.js";
import { type OxigraphEngine, usedOxigraph } from "../src/oxigraph-engine.js";
import { NotTurtle, RestorableUnion, type Store, Union } from "../src/store.js";

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

/** The engine of this run, each store made on it counting its loads in `loads`. */
function countingLoads(): { readonly engine: OxigraphEngine; loads: number } {
  const used = usedOxigraph();
  const counted = {
    loads: 0,
    engine: {
      ...used,
      newStore: () => {
        const store = used.newStore();
        const load = store.load.bind(store);
        store.load = (...args) => {
          counted.loads += 1;
          load(...args);
        };
        return store;
      },
    },
  };
  return counted;
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

  describe("OxigraphStore.loadFiles()", () => {
    const encoded = (text: string) => new TextEncoder().encode(text);
    /** Files of each shape a pod's file may take, and fifty of the shape a runtime writes. */
    const files = [
      ["https://pod.example/relative.ttl", '<#r> <urn:p> "x"@en .'],
      [
        "https://pod.example/prefixed.ttl",
        "@prefix ex: <urn:ex:> .\nex:s ex:p ex:o .",
      ],
      [
        "https://pod.example/sparql-prefix.ttl",
        "PREFIX ex: <urn:ex:>\nex:t ex:p 1 .",
      ],
      [
        "https://pod.example/dot-prefix.ttl",
        "<urn:h> <urn:p> 3 .PREFIX dp: <urn:dp:>\ndp:u dp:p 4 .",
      ],
      [
        "https://pod.example/dot-base.ttl",
        "<urn:i> <urn:p> 5 .BASE <urn:base:>\n<y> <urn:p> 6 .",
      ],
      ["https://pod.example/one-label.ttl", "<urn:b> <urn:p> _:x ."],
      ["https://pod.example/same-label.ttl", "<urn:c> <urn:p> _:x ."],
      ["https://pod.example/anonymous.ttl", "<urn:d> <urn:p> [ <urn:q> 1 ] ."],
      ["https://pod.example/braces.ttl", '<urn:e> <urn:p> "a { b } c" .'],
      ["https://pod.example/long.ttl", '<urn:f> <urn:p> """two\nlines""" .'],
      ["https://pod.example/empty.ttl", ""],
      ["https://pod.example/commented.ttl", "<urn:g> <urn:p> 2 . # the end"],
      ...Array.from(
        { length: 50 },
        (_, index) =>
          [
            `https://pod.example/plain/${index}.ttl`,
            `<urn:plain:${index}> <urn:p> "${index}"@en ;\n  <urn:q> <urn:plain:${index + 1}> .\n`,
          ] as const,
      ),
    ] as const;
    /** Each quad, a blank node's label left out. */
    const unlabelled = async (store: Store) =>
      (await quadsOf(store)).map((quad) => quad.replace(/_:\S+/g, "_:"));
    let alone: string[];
    let together: string[];
    let blankNodes: number;
    let loads: number;

    before(async () => {
      const one = new OxigraphStore();
      for (const [graph, turtle] of files)
        await one.loadTurtle(encoded(turtle), { graph });
      alone = await unlabelled(one);
      const counted = countingLoads();
      const many = new OxigraphStore({ engine: counted.engine });
      await many.loadFiles(
        files.map(([graph, turtle]) => ({ graph, turtle: encoded(turtle) })),
      );
      loads = counted.loads;
      together = await unlabelled(many);
      blankNodes = (
        await many.select(
          "SELECT DISTINCT ?o WHERE { GRAPH ?g { ?s <urn:p> ?o FILTER isBlank(?o) } }",
          new Set(),
        )
      ).rows.length;
    });

    it("holds each file's triples in its graph as loading each file alone does, the blank nodes of two files apart", () => {
      assert.deepEqual(together, alone);
      assert.equal(blankNodes, 3);
    });

    it("parses the files of the shape a runtime writes in one load, and each other file alone", () => {
      assert.ok(loads <= files.length - 50 + 1, `${loads} loads`);
    });

    it("loads alone a file that has a directive right after a statement's dot, as `.PREFIX` or `.BASE`, with no failed block load first", async () => {
      for (const [graph, turtle] of files.filter(([graph]) =>
        /dot-(prefix|base)/.test(graph),
      )) {
        const counted = countingLoads();
        await new OxigraphStore({ engine: counted.engine }).loadFiles([
          { graph, turtle: encoded(turtle) },
        ]);
        assert.equal(counted.loads, 1, graph);
      }
    });

    it("refuses a file that is no Turtle alone, naming its graph, the files before it loaded once, and lets no file write into another's graph", async () => {
      const plain = {
        graph: "urn:plain",
        turtle: encoded("<urn:a> <urn:p> 1 ."),
      };
      const refusals = [
        [{ graph: "urn:unended", turtle: encoded("<urn:a> <urn:p> 2") }],
        [
          {
            graph: "urn:four-terms",
            turtle: encoded("<urn:a> <urn:p> <urn:b> <urn:c> ."),
          },
        ],
        [
          {
            graph: "urn:breaks-out",
            turtle: encoded(
              '<urn:a> <urn:p> "x" .\n}\n<urn:stolen> {\n<urn:a> <urn:p> 3 .',
            ),
          },
        ],
        [
          {
            graph: "urn:opens-a-string",
            turtle: encoded('<urn:a> <urn:p> """'),
          },
          { graph: "urn:closes-it", turtle: encoded('""" .') },
        ],
      ] as const;
      for (const bad of refusals) {
        const store = new OxigraphStore();
        await assert.rejects(
          store.loadFiles([plain, ...bad, plain]),
          (error: unknown) =>
            error instanceof NotTurtle && error.graph === bad[0].graph,
        );
        const quads = await quadsOf(store);
        assert.ok(quads.every((quad) => !quad.includes("urn:stolen")));
        assert.deepEqual(
          quads.filter((quad) => quad.endsWith("<urn:plain>")),
          [
            `<urn:a> <urn:p> "1"^^<http://www.w3.org/2001/XMLSchema#integer> <urn:plain>`,
          ],
        );
      }
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

    it("returns how many quads each removal took out: the subjects' in the graph, and the graph's all", async () => {
      const held = new Union(new OxigraphStore());
      await held.add(
        [
          [iri("urn:a"), iri("urn:p"), literal("1")],
          [iri("urn:a"), iri("urn:q"), literal("2")],
          [iri("urn:b"), iri("urn:p"), literal("3")],
          [iri("urn:c"), iri("urn:p"), literal("4")],
        ],
        "urn:graph",
      );
      await held.add([[iri("urn:a"), iri("urn:p"), literal("5")]], "urn:other");
      assert.equal(
        await held.removeSubjects("urn:graph", ["urn:a", "urn:none"]),
        2,
      );
      assert.equal(await held.removeSubjects("urn:graph", ["urn:a"]), 0);
      assert.equal(await held.removeSubjects("urn:absent", ["urn:b"]), 0);
      assert.equal(await held.drop("urn:graph"), 2);
      assert.equal(await held.drop("urn:graph"), 0);
      assert.equal(await held.drop("urn:absent"), 0);
      assert.equal(await held.drop("urn:other"), 1);
    });

    it("counts each quad once when a subject is given twice, and when there are more subjects than one removal binds", async () => {
      const held = new Union(new OxigraphStore());
      const subjects = Array.from({ length: 600 }, (_, at) => `urn:s${at}`);
      await held.add(
        subjects.flatMap((subject) => [
          [iri(subject), iri("urn:p"), literal("1")] as Triple,
          [iri(subject), iri("urn:q"), literal("2")] as Triple,
        ]),
        "urn:graph",
      );
      assert.equal(
        await held.removeSubjects("urn:graph", [...subjects, ...subjects]),
        1200,
      );
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

    it("returns how many quads each removal took out, as a union does", async () => {
      const store = new OxigraphStore();
      await store.loadTurtle("<urn:u> <urn:p> 2, 3 . <urn:v> <urn:p> 4 .", {
        graph: "urn:three",
      });
      const held = new RestorableUnion(store, ["urn:three"]);
      assert.equal(await held.removeSubjects("urn:three", ["urn:u"]), 2);
      assert.equal(await held.drop("urn:three"), 1);
      await held.restore();
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
  describe("store.dump(), store.restore()", () => {
    let dumped: {
      held: string[];
      restored: string[];
      joined: boolean;
      text: string;
      truncated: unknown;
      refusedWhenHolding: unknown;
      again: string[];
    };

    /** The quads as `quadsOf` writes them, each blank node by where it is rather than by its label. */
    const unlabelled = (quads: readonly string[]) =>
      quads.map((quad) => quad.replace(/_:[^ ]+/g, "_:b")).sort();

    before(async () => {
      const store = new OxigraphStore();
      await store.loadTurtle(
        String.raw`<urn:s> <urn:p> [ <urn:q> 1 ] ; <urn:p> "say \"hi\" é"@en-GB, "x"^^<urn:type> .`,
        { graph: "https://pod.example/one.ttl" },
      );
      const [[, , shared] = []] = await store.construct(
        "CONSTRUCT { ?s <urn:p> ?o } WHERE { GRAPH ?g { ?s <urn:p> ?o FILTER isBlank(?o) } }",
        new Set(),
      );
      assert.equal(shared?.termType, "BlankNode");
      await store.add([[shared, iri("urn:r"), iri("urn:t")] as Triple], {
        graph: "urn:two",
      });
      await store.loadTurtle("", { graph: "urn:empty" });
      const bytes = await store.dump();
      const restored = new OxigraphStore();
      await restored.restore(bytes);
      const graphs = ["https://pod.example/one.ttl", "urn:two", "urn:empty"];
      const again = new OxigraphStore();
      await again.restore(await restored.dump());
      const truncated = new OxigraphStore();
      const holding = new OxigraphStore();
      await holding.loadTurtle("<urn:a> <urn:b> <urn:c> .", { graph: "urn:x" });
      dumped = {
        held: await quadsOf(store),
        restored: await quadsOf(restored),
        joined: await new Union(restored, graphs).ask(
          "ASK { <urn:s> <urn:p> ?node . ?node <urn:q> 1 ; <urn:r> <urn:t> }",
        ),
        text: new TextDecoder().decode(bytes),
        truncated: await truncated
          .restore(bytes.subarray(0, bytes.length - 3))
          .then(
            () => undefined,
            (error: unknown) => error,
          ),
        refusedWhenHolding: await holding.restore(bytes).then(
          () => undefined,
          (error: unknown) => error,
        ),
        again: await quadsOf(again),
      };
    });

    it("restores every quad into a store of its own", () => {
      assert.ok(dumped.held.length > 0);
      assert.deepEqual(unlabelled(dumped.restored), unlabelled(dumped.held));
    });

    it("keeps each blank node one node across the graphs it is in", () => {
      assert.equal(dumped.joined, true);
    });

    it("names every graph the store lists, one that holds nothing too", () => {
      assert.ok(dumped.text.includes("urn:empty"), dumped.text);
    });

    it("restores from a store restored what it held", () => {
      assert.deepEqual(unlabelled(dumped.again), unlabelled(dumped.held));
    });

    it("refuses bytes cut short, and a store that holds something", () => {
      assert.ok(dumped.truncated instanceof Error, String(dumped.truncated));
      assert.ok(
        dumped.refusedWhenHolding instanceof Error,
        String(dumped.refusedWhenHolding),
      );
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
