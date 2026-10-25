import assert from "node:assert/strict";
import { test } from "node:test";
import { boundToPairs, boundToRecords, TOKEN } from "../src/bound-records.js";
import { OxigraphStore } from "../src/oxigraph-store.js";

test("a comparison bound to a run's records gives their rows alone, whatever braces its comments, IRIs and long or short strings hold before its group", async () => {
  const store = new OxigraphStore();
  await store.loadTurtle(
    "<urn:a> <urn:code> 1 . <urn:b> <urn:code> 1 . <urn:c> <urn:code> 1 .",
    { graph: "urn:pod" },
  );
  const heads = [
    `# Two records { of one code } match.\nSELECT DISTINCT ?record ?other`,
    `PREFIX ex: <urn:x#> SELECT DISTINCT ?record ?other ("{" AS ?brace) ('{' AS ?also)`,
    `SELECT DISTINCT ?record ?other ("""a " { ""\n} \\""" { """ AS ?long)`,
    `SELECT DISTINCT ?record ?other ('''a ' { ''\n} ''' AS ?long)`,
  ];
  for (const head of heads) {
    const query = `${head} WHERE {\n  ?record <urn:code> ?code .\n  ?other <urn:code> ?code .\n  FILTER (?record != ?other)\n}`;
    const { rows } = await store.select(
      boundToRecords(query, ["urn:b", "urn:c"]),
      new Set(["urn:pod"]),
    );
    assert.deepEqual(
      rows
        .map((row) => `${row.get("record")?.value} ${row.get("other")?.value}`)
        .sort(),
      ["urn:b urn:a", "urn:b urn:c", "urn:c urn:a", "urn:c urn:b"],
      head,
    );
  }
});

test("a prefixed name's escaped number sign opens no comment, so the group after it on its line is the one bound", () => {
  assert.match(
    boundToRecords(
      "SELECT ?record (ex:a\\#b AS ?escaped) WHERE { ?record ?p ?o { ?o ?q ?r } }",
      ["urn:b"],
    ),
    /WHERE \{ VALUES \?record \{ <urn:b> \} \?record \?p/,
  );
});

test("a comparison bound to pairs gives the rows of those ordered pairs alone, though the group binds ?other in a sub-select", async () => {
  const store = new OxigraphStore();
  await store.loadTurtle(
    "<urn:a> <urn:code> 1 . <urn:b> <urn:code> 1 . <urn:c> <urn:code> 1 .",
    { graph: "urn:pod" },
  );
  const query = `SELECT DISTINCT ?record ?other WHERE {\n  { SELECT ?other ?code WHERE { ?other <urn:code> ?code } }\n  ?record <urn:code> ?code .\n  FILTER (?record != ?other)\n}`;
  const { rows } = await store.select(
    boundToPairs(query, [
      ["urn:a", "urn:b"],
      ["urn:c", "urn:a"],
    ]),
    new Set(["urn:pod"]),
  );
  assert.deepEqual(
    rows
      .map((row) => `${row.get("record")?.value} ${row.get("other")?.value}`)
      .sort(),
    ["urn:a urn:b", "urn:c urn:a"],
  );
});

const SIDES = `SELECT DISTINCT ?record ?other WHERE {
  { SELECT ?record ?code
    # bound: ?record
    WHERE { ?record <urn:code> ?code } }
  { SELECT ?other ?code WHERE { ?other <urn:code> ?code } }
  ?record <urn:code> ?code .
  FILTER (?record != ?other)
}`;

test("a comparison that marks its record's side is bound in that side's group as well as in its outermost group, and gives those records' rows alone", async () => {
  const store = new OxigraphStore();
  await store.loadTurtle(
    "<urn:a> <urn:code> 1 . <urn:b> <urn:code> 1 . <urn:c> <urn:code> 1 .",
    { graph: "urn:pod" },
  );
  const bound = boundToRecords(SIDES, ["urn:b", "urn:c"]);
  assert.match(
    bound,
    /# bound: \?record\n {4}WHERE \{ VALUES \?record \{ <urn:b> <urn:c> \} \?record/,
  );
  assert.match(
    bound,
    /^SELECT DISTINCT \?record \?other WHERE \{ VALUES \?record \{ <urn:b> <urn:c> \}\n/,
  );
  const { rows } = await store.select(bound, new Set(["urn:pod"]));
  assert.deepEqual(
    rows
      .map((row) => `${row.get("record")?.value} ${row.get("other")?.value}`)
      .sort(),
    ["urn:b urn:a", "urn:b urn:c", "urn:c urn:a", "urn:c urn:b"],
  );
});

test("a mark binds only the group whose brace follows it, with nothing but WHERE between, and never one in a string", () => {
  const strays = [
    `SELECT ?record WHERE {\n  # bound: ?record\n  ?record ?p ?o { ?o ?q ?r }\n}`,
    `SELECT ?record ("""\n# bound: ?record\n""" AS ?s) WHERE { ?record ?p ?o }`,
  ];
  for (const query of strays)
    assert.equal(
      boundToRecords(query, ["urn:b"]).match(/VALUES/g)?.length,
      1,
      query,
    );
  assert.match(
    boundToRecords(strays[0]!, ["urn:b"]),
    /WHERE \{ VALUES \?record \{ <urn:b> \}\n/,
  );
});

test("a comparison bound to pairs that marks its record's side binds the pairs in its outermost group and their records in that side", async () => {
  const store = new OxigraphStore();
  await store.loadTurtle(
    "<urn:a> <urn:code> 1 . <urn:b> <urn:code> 1 . <urn:c> <urn:code> 1 .",
    { graph: "urn:pod" },
  );
  const bound = boundToPairs(SIDES, [
    ["urn:a", "urn:b"],
    ["urn:c", "urn:a"],
    ["urn:a", "urn:c"],
  ]);
  assert.match(
    bound,
    /WHERE \{ VALUES \?record \{ <urn:a> <urn:c> \} \?record/,
  );
  const { rows } = await store.select(bound, new Set(["urn:pod"]));
  assert.deepEqual(
    rows
      .map((row) => `${row.get("record")?.value} ${row.get("other")?.value}`)
      .sort(),
    ["urn:a urn:b", "urn:a urn:c", "urn:c urn:a"],
  );
});

test("a less-than comparison is no IRI, though an IRI's own characters stand between it and a greater-than sign", () => {
  const iris = (text: string) =>
    [...text.matchAll(TOKEN)]
      .map(([token]) => token)
      .filter((token) => token.startsWith("<"));
  assert.deepEqual(iris("FILTER (?x <3&&?y>1) ?s <urn:a#b> <> ?o"), [
    "<urn:a#b>",
    "<>",
  ]);
  assert.deepEqual(iris("FILTER (?x<?y&&?y>?z || ?a<=?b&&?b>=?c)"), []);
});
