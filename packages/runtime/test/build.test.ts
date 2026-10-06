import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import * as oxigraph from "oxigraph";
import { vocabularyDerive } from "../src/build.js";
import { dataset } from "../src/dataset.js";
import { DERIVED } from "../src/derive.js";
import { MemoryFiles } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, literal, type Term, written } from "../src/rdf.js";
import { replay } from "../src/replay.js";
import { layout, ROOT, storyFrom, vocabulary } from "./vocabulary.js";

const FEATURE = "runtime/matcher.feature";
const EXAMPLE =
  "the matcher joins the pair a person called different, and not the pair a person called the same";
const THROUGH = "persons-same";
const LENS = "everyday";
/**
 * What the vocabulary's Python builds for the story through the step under the lens: the derived state, the views, the
 * labels and the type index, with each import or session named by its step and each revision by its record and position.
 */
const ORACLE = join(
  ROOT,
  "packages",
  "runtime",
  "test",
  "fixtures",
  "oracle-matching-persons-same-everyday.nq",
);

function fromOxigraph(term: oxigraph.Term): Term {
  if (term.termType === "NamedNode") return iri(term.value);
  if (term.termType === "Literal")
    return term.language
      ? literal(term.value, { language: term.language })
      : literal(term.value, term.datatype.value);
  throw new Error(`the oracle holds a ${term.termType}`);
}

test("the derived state, the views, the labels and the type index equal, as graphs, what the vocabulary's Python builds", async () => {
  const files = await vocabulary();
  const { story, folder } = await storyFrom(FEATURE, EXAMPLE, THROUGH);
  const replayed = await replay({
    story,
    source: files,
    vocabulary: files,
    folder,
    title: "matching",
    pod: new MemoryFiles(story.address),
    newStore: () => new OxigraphStore(),
    layout: await layout(),
    importers: [appleHealthExport],
  });
  const store = await dataset(
    replayed,
    THROUGH,
    LENS,
    new OxigraphStore(),
    await vocabularyDerive(files, await layout()),
  );

  const renames = new Map<string, string>();
  for (const row of (
    await store.select(`PREFIX prov: <http://www.w3.org/ns/prov#>
      SELECT ?step ?activity WHERE {
        GRAPH <urn:cascade:steps> { ?step prov:generated ?file }
        GRAPH ?file { ?activity prov:startedAtTime ?started }
        FILTER (CONTAINS(STR(?file), "/provenance/")) }`)
  ).rows)
    renames.set(
      written(row.get("activity") ?? iri("")),
      `urn:test:activity:${row.get("step")?.value.split(":").at(-1)}`,
    );
  for (const row of (
    await store.select(`PREFIX prov: <http://www.w3.org/ns/prov#>
      PREFIX rec: <https://ns.cascadeprotocol.org/records/v1-draft#>
      SELECT ?revision ?record (COUNT(DISTINCT ?earlier) AS ?position) WHERE {
        ?revision a rec:Revision ; rec:revisionOf ?record ; prov:wasRevisionOf* ?earlier }
      GROUP BY ?revision ?record`)
  ).rows)
    renames.set(
      written(row.get("revision") ?? iri("")),
      `urn:test:revision:${row.get("record")?.value}:${row.get("position")?.value}`,
    );
  const named = (term: Term): string => {
    const renamed = renames.get(written(term));
    return renamed === undefined ? written(term) : written(iri(renamed));
  };

  const { rows } = await store.select(`SELECT ?g ?s ?p ?o WHERE {
      GRAPH ?g { ?s ?p ?o }
      FILTER (?g IN (<${DERIVED}${LENS}>, <${story.address}${(await layout()).typeIndex}>)
        || STRSTARTS(STR(?g), "${story.address}${(await layout()).viewsFolder}")) }`);
  const found = new Set(
    rows.map((row) =>
      ["s", "p", "o", "g"]
        .map((name) => named(row.get(name) ?? iri("")))
        .join(" "),
    ),
  );
  const expected = new Set(
    oxigraph
      .parse(await readFile(ORACLE, "utf8"), { format: "application/n-quads" })
      .map((quad) =>
        [quad.subject, quad.predicate, quad.object, quad.graph]
          .map((term) => written(fromOxigraph(term as oxigraph.Term)))
          .join(" "),
      ),
  );
  assert.deepEqual(
    [...found].filter((quad) => !expected.has(quad)).sort(),
    [],
    "found, not expected",
  );
  assert.deepEqual(
    [...expected].filter((quad) => !found.has(quad)).sort(),
    [],
    "expected, not found",
  );
});
