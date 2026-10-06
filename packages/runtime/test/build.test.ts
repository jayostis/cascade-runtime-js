import assert from "node:assert/strict";
import { before, test } from "node:test";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import { vocabularyDerive } from "../src/build.js";
import { dataset } from "../src/dataset.js";
import { DERIVED } from "../src/derive.js";
import { MemoryFiles } from "../src/files.js";
import type { Layout } from "../src/layout.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { replay } from "../src/replay.js";
import type { Store } from "../src/store.js";
import { layout, storyFrom, vocabulary } from "./vocabulary.js";

const FEATURE = "runtime/matcher.feature";
const EXAMPLE =
  "the matcher joins the pair a person called different, and not the pair a person called the same";
const THROUGH = "persons-same";
const LENS = "everyday";
const PREFIXES = `PREFIX rec: <https://ns.cascadeprotocol.org/records/v1-draft#>
  PREFIX solid: <http://www.w3.org/ns/solid/terms#>
  PREFIX pav: <http://purl.org/pav/>
  PREFIX cascade: <https://ns.cascadeprotocol.org/core/v1#>
  PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>`;

let store: Store;
let pod: Layout;
let address: string;

before(async () => {
  const files = await vocabulary();
  pod = await layout();
  const { story, folder } = await storyFrom(FEATURE, EXAMPLE, THROUGH);
  address = story.address;
  const replayed = await replay({
    story,
    source: files,
    vocabulary: files,
    folder,
    title: "matching",
    pod: new MemoryFiles(story.address),
    newStore: () => new OxigraphStore(),
    layout: pod,
    importers: [appleHealthExport],
  });
  store = await dataset(
    replayed,
    THROUGH,
    LENS,
    new OxigraphStore(),
    await vocabularyDerive(files, pod),
  );
});

test("the build writes each file the layout says a query writes, as a view, and a type index registering each view by its class and file", async () => {
  const views = await store.select(`${PREFIXES}
    SELECT ?view WHERE { GRAPH ?view { ?view a rec:View } }`);
  assert.deepEqual(
    views.rows.map((row) => row.get("view")?.value).sort(),
    pod.built.map(({ file }) => address + (file ?? "")).sort(),
  );
  const registered = await store.select(`${PREFIXES}
    SELECT ?class ?file WHERE {
      GRAPH <${address}${pod.typeIndex}> { [] a solid:TypeRegistration ; solid:forClass ?class ; solid:instance ?file } }`);
  assert.deepEqual(
    registered.rows
      .map((row) => `${row.get("class")?.value} ${row.get("file")?.value}`)
      .sort(),
    pod.views.map(({ kind, file }) => `${kind} ${address}${file}`).sort(),
  );
});

test("the labels label every record, current revision and current version of the derived state, and every entry of a view", async () => {
  const labels = pod.built.find(({ writtenBy }) => writtenBy === "labels.rq");
  assert.ok(labels?.file, "the layout names no file of labels");
  const { rows } = await store.select(`${PREFIXES}
    SELECT ?thing ?label WHERE {
      { GRAPH <${DERIVED}${LENS}> { ?thing a rec:Record } }
      UNION { GRAPH <${DERIVED}${LENS}> { [] rec:currentRevision ?thing } }
      UNION { GRAPH <${DERIVED}${LENS}> { [] pav:hasCurrentVersion ?thing } }
      UNION { GRAPH ?view { ?thing cascade:mergedFrom [] } FILTER (STRSTARTS(STR(?view), "${address}${pod.viewsFolder}")) }
      OPTIONAL { GRAPH <${address}${labels.file}> { ?thing rdfs:label ?label } }
    }`);
  assert.ok(rows.length > 0);
  assert.deepEqual(
    rows.filter((row) => !row.has("label")).map((row) => row.get("thing")),
    [],
  );
});
