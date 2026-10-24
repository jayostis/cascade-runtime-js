import assert from "node:assert/strict";
import { test } from "node:test";
import { boundToRecords } from "../src/bound-records.js";
import { OxigraphStore } from "../src/oxigraph-store.js";

test("a comparison bound to a run's records gives their rows alone, whatever braces its comments, IRIs and strings hold before its group", async () => {
  const store = new OxigraphStore();
  await store.loadTurtle(
    "<urn:a> <urn:code> 1 . <urn:b> <urn:code> 1 . <urn:c> <urn:code> 1 .",
    { graph: "urn:pod" },
  );
  const query = `# Two records { of one code } match.
PREFIX ex: <urn:x#>
SELECT DISTINCT ?record ?other ("{" AS ?brace)
WHERE {
  ?record <urn:code> ?code .
  ?other <urn:code> ?code .
  FILTER (?record != ?other)
}`;
  const { rows } = await store.select(
    boundToRecords(query, ["urn:b", "urn:c"]),
    new Set(["urn:pod"]),
  );
  assert.deepEqual(
    rows
      .map((row) => `${row.get("record")?.value} ${row.get("other")?.value}`)
      .sort(),
    ["urn:b urn:a", "urn:b urn:c", "urn:c urn:a", "urn:c urn:b"],
  );
});
