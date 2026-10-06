import assert from "node:assert/strict";
import { before, test } from "node:test";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import { vocabularyDerive } from "../src/build.js";
import { dataset } from "../src/dataset.js";
import { DERIVED } from "../src/derive.js";
import { MemoryFiles, readText } from "../src/files.js";
import { LAYOUT_FILE } from "../src/layout.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { replay } from "../src/replay.js";
import type { Store } from "../src/store.js";
import { layout as readLayout, storyFrom, vocabulary } from "./vocabulary.js";

const FEATURE = "runtime/matcher.feature";
const EXAMPLE =
  "the matcher joins the pair a person called different, and not the pair a person called the same";
const THROUGH = "persons-same";
const LENS = "everyday";
const PREFIXES = `PREFIX rec: <https://ns.cascadeprotocol.org/records/v1-draft#>
  PREFIX jdg: <https://ns.cascadeprotocol.org/judgments/v1-draft#>
  PREFIX solid: <http://www.w3.org/ns/solid/terms#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX pav: <http://purl.org/pav/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX cascade: <https://ns.cascadeprotocol.org/core/v1#>
  PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>`;

let store: Store;
/** The vocabulary's pod layout as it reads, its paths resolved against the pod's address, read without `Layout`. */
let laidOut: Store;
let address: string;

before(async () => {
  const files = await vocabulary();
  const layout = await readLayout();
  const { story, folder } = await storyFrom(FEATURE, EXAMPLE, THROUGH);
  address = story.address;
  laidOut = new OxigraphStore();
  await laidOut.loadTurtle(await readText(files, LAYOUT_FILE), {
    graph: address,
    alone: true,
  });
  const replayed = await replay({
    story,
    source: files,
    vocabulary: files,
    folder,
    title: "matching",
    pod: new MemoryFiles(story.address),
    newStore: () => new OxigraphStore(),
    layout,
    importers: [appleHealthExport],
  });
  store = await dataset(
    replayed,
    THROUGH,
    LENS,
    new OxigraphStore(),
    await vocabularyDerive(files, layout),
  );
});

async function values(on: Store, where: string): Promise<string[]> {
  const { rows, variables } = await on.select(
    `${PREFIXES} SELECT * WHERE { ${where} }`,
  );
  return rows
    .map((row) => variables.map((name) => row.get(name)?.value).join(" "))
    .sort();
}

async function placed(where: string): Promise<string> {
  const [found, ...others] = await values(
    laidOut,
    `GRAPH <${address}> { ${where} }`,
  );
  assert.ok(found !== undefined && others.length === 0, where);
  return found;
}

test("the build writes each file the layout says a query writes, as a view, and a type index registering each view and the views' folder by its class, file or folder, and title", async () => {
  assert.deepEqual(
    await values(store, `GRAPH ?view { ?view a rec:View }`),
    await values(
      laidOut,
      `GRAPH <${address}> { [] a rec:Placement ; rec:writtenBy [] ; solid:instance ?file }`,
    ),
  );
  const index = await placed(
    `[] solid:forClass solid:TypeIndex ; solid:instance ?file`,
  );
  assert.deepEqual(
    await values(store, `GRAPH <${index}> { <${index}> a ?type }`),
    [
      "http://www.w3.org/ns/solid/terms#TypeIndex",
      "http://www.w3.org/ns/solid/terms#UnlistedDocument",
    ],
  );
  const registration = `?class ; ?listing ?target ; dct:title ?title FILTER (?listing IN (solid:instance, solid:instanceContainer))`;
  assert.deepEqual(
    await values(
      store,
      `SELECT ?class ?listing ?target ?title WHERE { GRAPH <${index}> {
        [] a solid:TypeRegistration ; solid:forClass ${registration} } }`,
    ),
    await values(
      laidOut,
      `SELECT ?class ?listing ?target ?title WHERE { GRAPH <${address}> {
        ?placement a rec:Placement ; solid:forClass ${registration}
        { ?placement rec:writtenBy [] ; solid:instance [] } UNION { ?placement solid:forClass rec:View ; solid:instanceContainer [] } } }`,
    ),
  );
});

test("the labels label every record, current revision and current version of the derived state, each document a current revision came from, the subject, and every entry of a view", async () => {
  const labels = await placed(
    `[] rec:writtenBy "labels.rq" ; solid:instance ?file`,
  );
  const views = await placed(
    `[] solid:forClass rec:View ; solid:instanceContainer ?folder`,
  );
  const derived = `${DERIVED}${LENS}`;
  const { rows } = await store.select(`${PREFIXES}
    SELECT ?kind ?thing ?label WHERE {
      { GRAPH <${derived}> { ?thing a rec:Record } BIND ("record" AS ?kind) }
      UNION { GRAPH <${derived}> { [] rec:currentRevision ?thing } BIND ("revision" AS ?kind) }
      UNION { GRAPH <${derived}> { [] pav:hasCurrentVersion ?thing } BIND ("version" AS ?kind) }
      UNION { GRAPH <${derived}> { [] rec:currentRevision ?revision } GRAPH ?file { ?revision prov:wasDerivedFrom ?thing }
              BIND ("document" AS ?kind) }
      UNION { GRAPH ?file { ?thing a rec:Subject } BIND ("subject" AS ?kind) }
      UNION { GRAPH ?view { ?thing cascade:mergedFrom [] } FILTER (STRSTARTS(STR(?view), "${views}")) BIND ("entry" AS ?kind) }
      OPTIONAL { GRAPH <${labels}> { ?thing rdfs:label ?label } }
    }`);
  assert.deepEqual(
    [...new Set(rows.map((row) => row.get("kind")?.value))].sort(),
    ["document", "entry", "record", "revision", "subject", "version"],
  );
  assert.deepEqual(
    rows
      .filter((row) => !row.has("label"))
      .map((row) => `${row.get("kind")?.value} ${row.get("thing")?.value}`),
    [],
  );
});

test("the derived state holds what the person's judgments say: each counts, a Same's members are currently the same and a Different's currently different, and a record of a profile no About claims is left out, and every other record is in an entry", async () => {
  const derived = `${DERIVED}${LENS}`;
  const judged = await values(
    store,
    `SELECT DISTINCT ?verdict WHERE { GRAPH ?file { [] a jdg:Judgment ; jdg:verdict ?verdict } FILTER (?file != <${derived}>) }`,
  );
  assert.deepEqual(judged, [
    "https://ns.cascadeprotocol.org/judgments/v1-draft#About",
    "https://ns.cascadeprotocol.org/judgments/v1-draft#Different",
    "https://ns.cascadeprotocol.org/judgments/v1-draft#Same",
  ]);
  assert.deepEqual(
    await values(
      store,
      `GRAPH ?file { ?judgment a jdg:Judgment } FILTER (?file != <${derived}>)
       FILTER NOT EXISTS { GRAPH <${derived}> { ?judgment rec:counts true } }`,
    ),
    [],
  );
  for (const [verdict, currently] of [
    ["Same", "currentlySame"],
    ["Different", "currentlyDifferent"],
  ])
    assert.deepEqual(
      await values(
        store,
        `GRAPH ?file { [] jdg:verdict jdg:${verdict} ; prov:hadMember ?one, ?other FILTER (?one != ?other) }
         FILTER NOT EXISTS { GRAPH <${derived}> { ?one jdg:${currently} ?other } }`,
      ),
      [],
      verdict,
    );
  const leftOut = await values(
    store,
    `GRAPH <${derived}> { ?record rec:leftOutFor [ rec:reason rec:PatientNotClaimed ; rec:because ?profile ] }`,
  );
  assert.ok(leftOut.length > 0, "no record is left out for its patient");
  assert.deepEqual(
    await values(
      store,
      `GRAPH <${derived}> { ?record rec:leftOutFor [ rec:reason rec:PatientNotClaimed ; rec:because ?profile ] }
       GRAPH ?file { [] jdg:verdict jdg:About ; prov:hadMember ?profile }`,
    ),
    [],
  );
  assert.deepEqual(
    await values(
      store,
      `GRAPH <${derived}> { ?record a rec:Record FILTER NOT EXISTS { ?record rec:leftOutFor [] } FILTER NOT EXISTS { ?record rec:inEntry [] } }`,
    ),
    [],
  );
});
