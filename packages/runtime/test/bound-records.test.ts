import assert from "node:assert/strict";
import { test } from "node:test";
import { boundToPairs, boundToRecords } from "../src/bound-records.js";
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
