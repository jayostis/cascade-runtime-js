import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { boundToPairs, boundToRecords, TOKEN } from "../src/bound-records.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { Refusal } from "../src/step.js";

/** A comparison whose record side is a sub-select marked as the one the records are bound in. */
const SIDES = `SELECT DISTINCT ?record ?other WHERE {
  { SELECT ?record ?code
    # bound: ?record
    WHERE { ?record <urn:code> ?code } }
  { SELECT ?other ?code WHERE { ?other <urn:code> ?code } }
  ?record <urn:code> ?code .
  FILTER (?record != ?other)
}`;

/**
 * A comparison is a SPARQL query of the vocabulary that returns pairs of records, `?record` and `?other`. The matcher
 * binds `?record` to the records a run takes by writing a `VALUES` block into the query's text, so a run reads those
 * records and not the whole pod.
 * @rule runtime/matcher.feature M4
 */
describe("Binding a comparison query to a run's records · boundToRecords(), boundToPairs()", () => {
  let store: OxigraphStore;

  /** The pairs the query returns over three records of one code, as `record other`, sorted. */
  const pairsOf = async (query: string): Promise<string[]> => {
    const { rows } = await store.select(query, new Set(["urn:pod"]));
    return rows
      .map((row) => `${row.get("record")?.value} ${row.get("other")?.value}`)
      .sort();
  };

  before(async () => {
    store = new OxigraphStore();
    await store.loadTurtle(
      "<urn:a> <urn:code> 1 . <urn:b> <urn:code> 1 . <urn:c> <urn:code> 1 .",
      { graph: "urn:pod" },
    );
  });

  describe("boundToRecords(query, records)", () => {
    it("returns a query whose rows are those of the records given alone, whatever braces a comment, an IRI, a string or a long string holds before its group", async () => {
      const heads = [
        `# Two records { of one code } match.\nSELECT DISTINCT ?record ?other`,
        `PREFIX ex: <urn:x#> SELECT DISTINCT ?record ?other ("{" AS ?brace) ('{' AS ?also)`,
        `SELECT DISTINCT ?record ?other ("""a " { ""\n} \\""" { """ AS ?long)`,
        `SELECT DISTINCT ?record ?other ('''a ' { ''\n} ''' AS ?long)`,
      ];
      for (const head of heads) {
        const query = `${head} WHERE {\n  ?record <urn:code> ?code .\n  ?other <urn:code> ?code .\n  FILTER (?record != ?other)\n}`;
        assert.deepEqual(
          await pairsOf(boundToRecords(query, ["urn:b", "urn:c"])),
          ["urn:b urn:a", "urn:b urn:c", "urn:c urn:a", "urn:c urn:b"],
          head,
        );
      }
    });

    it("binds the group that follows a prefixed name's escaped `#` on its line", () => {
      assert.match(
        boundToRecords(
          "SELECT ?record (ex:a\\#b AS ?escaped) WHERE { ?record ?p ?o { ?o ?q ?r } }",
          ["urn:b"],
        ),
        /WHERE \{ VALUES \?record \{ <urn:b> \} \?record \?p/,
      );
    });

    it("throws Refusal for a query with no group", () => {
      assert.throws(
        () => boundToRecords("SELECT ?record", ["urn:b"]),
        (error: unknown) =>
          error instanceof Refusal &&
          /has no group to bind \?record in/.test(error.message),
      );
    });
  });

  describe("given a group marked `# bound: ?record`", () => {
    it("binds the marked group as well as the WHERE group", () => {
      const bound = boundToRecords(SIDES, ["urn:b", "urn:c"]);
      assert.match(
        bound,
        /# bound: \?record\n {4}WHERE \{ VALUES \?record \{ <urn:b> <urn:c> \} \?record/,
      );
      assert.match(
        bound,
        /^SELECT DISTINCT \?record \?other WHERE \{ VALUES \?record \{ <urn:b> <urn:c> \}\n/,
      );
    });

    it("returns the rows of the records given alone", async () => {
      assert.deepEqual(
        await pairsOf(boundToRecords(SIDES, ["urn:b", "urn:c"])),
        ["urn:b urn:a", "urn:b urn:c", "urn:c urn:a", "urn:c urn:b"],
      );
    });

    it("ignores a mark that the group's brace does not follow with nothing but `WHERE` between", () => {
      const query = `SELECT ?record WHERE {\n  # bound: ?record\n  ?record ?p ?o { ?o ?q ?r }\n}`;
      const bound = boundToRecords(query, ["urn:b"]);
      assert.equal(bound.match(/VALUES/g)?.length, 1);
      assert.match(bound, /WHERE \{ VALUES \?record \{ <urn:b> \}\n/);
    });

    it("ignores a mark inside a string", () => {
      const query = `SELECT ?record ("""\n# bound: ?record\n""" AS ?s) WHERE { ?record ?p ?o }`;
      assert.equal(
        boundToRecords(query, ["urn:b"]).match(/VALUES/g)?.length,
        1,
      );
    });
  });

  describe("boundToPairs(query, pairs)", () => {
    it("returns the rows of the ordered pairs given alone, where a sub-select binds `?other`", async () => {
      const query = `SELECT DISTINCT ?record ?other WHERE {\n  { SELECT ?other ?code WHERE { ?other <urn:code> ?code } }\n  ?record <urn:code> ?code .\n  FILTER (?record != ?other)\n}`;
      assert.deepEqual(
        await pairsOf(
          boundToPairs(query, [
            ["urn:a", "urn:b"],
            ["urn:c", "urn:a"],
          ]),
        ),
        ["urn:a urn:b", "urn:c urn:a"],
      );
    });

    it("binds the pairs in the query's WHERE group and their records in a marked group", () => {
      assert.match(
        boundToPairs(SIDES, [
          ["urn:a", "urn:b"],
          ["urn:c", "urn:a"],
          ["urn:a", "urn:c"],
        ]),
        /WHERE \{ VALUES \?record \{ <urn:a> <urn:c> \} \?record/,
      );
    });

    it("returns the rows of those pairs alone from a query with a marked group", async () => {
      assert.deepEqual(
        await pairsOf(
          boundToPairs(SIDES, [
            ["urn:a", "urn:b"],
            ["urn:c", "urn:a"],
            ["urn:a", "urn:c"],
          ]),
        ),
        ["urn:a urn:b", "urn:a urn:c", "urn:c urn:a"],
      );
    });
  });

  describe("`TOKEN`", () => {
    it("reads a less-than comparison as no IRI, though a greater-than sign follows it", () => {
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
  });
});
