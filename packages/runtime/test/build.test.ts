import assert from "node:assert/strict";
import { before, test } from "node:test";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import { vocabularyDerive } from "../src/build.js";
import { dataset } from "../src/dataset.js";
import { CorePod } from "../src/core-pod.js";
import { DERIVED } from "../src/derive.js";
import { MemoryFiles, readText } from "../src/files.js";
import { clock } from "../src/ids.js";
import { LAYOUT_FILE, type Layout } from "../src/layout.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { References } from "../src/references.js";
import { type Replayed, replay } from "../src/replay.js";
import { type Dataset, Union } from "../src/store.js";
import { notIsomorphic } from "./graphs.js";
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

let store: Dataset;
/** The vocabulary's pod layout as it reads, its paths resolved against the pod's address, read without `Layout`. */
let laidOut: Union;
let address: string;
let layout: Layout;
/** The pod the story was replayed into, with a build after every step. */
let pod: CountedFiles;
/** A pod over `pod`'s files, as an app opens a folder that holds a pod. */
let reopened: () => CorePod;
let replayed: Replayed;
/** The folder the story's steps name their files under. */
let storyFolder: string;

/** Files in memory, counting each read that finds a file, and each write, by path, in the order written. */
class CountedFiles extends MemoryFiles {
  readonly found = new Map<string, number>();
  readonly writes = new Map<string, number>();
  readonly log: string[] = [];

  override async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const bytes = await super.read(pathOrIri);
    if (bytes !== undefined)
      this.found.set(pathOrIri, (this.found.get(pathOrIri) ?? 0) + 1);
    return bytes;
  }

  override write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    this.writes.set(pathOrIri, (this.writes.get(pathOrIri) ?? 0) + 1);
    this.log.push(pathOrIri);
    return super.write(pathOrIri, bytes);
  }
}

before(async () => {
  const files = await vocabulary();
  layout = await readLayout();
  const derive = await vocabularyDerive(files, layout);
  const { story, folder } = await storyFrom(FEATURE, EXAMPLE, THROUGH);
  address = story.address;
  storyFolder = folder;
  laidOut = new Union(new OxigraphStore());
  await laidOut.loadTurtle(await readText(files, LAYOUT_FILE), address);
  replayed = await replay({
    story,
    source: files,
    vocabulary: files,
    folder,
    title: "matching",
    pod: (pod = new CountedFiles(story.address)),
    newStore: () => new OxigraphStore(),
    layout,
    importers: [appleHealthExport],
    build: { lens: LENS, derive },
  });
  store = await dataset(replayed, THROUGH, LENS, new OxigraphStore(), derive);
  reopened = () =>
    new CorePod({
      pod,
      address,
      subject: story.subject,
      title: "matching",
      vocabulary: files,
      layout,
      newStore: () => new OxigraphStore(),
      time: clock,
      importers: [],
      references: () => Promise.reject(new Error("no step here matches")),
      build: { lens: LENS, derive },
    });
});

async function values(on: Dataset, where: string): Promise<string[]> {
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

test("the build writes the labels, each view the layout marks written always, a view of a kind the pod holds a record of and no other, and a type index registering each view written and the views' folder by its class, file or folder, and title", async () => {
  const held = (
    await values(
      store,
      `SELECT DISTINCT ?class WHERE { GRAPH ?file { [] a ?class } FILTER NOT EXISTS { GRAPH ?file { ?file a rec:View } } }`,
    )
  ).map((kind) => `<${kind}>`);
  const written = await values(store, `GRAPH ?view { ?view a rec:View }`);
  assert.deepEqual(
    written,
    await values(
      laidOut,
      `SELECT ?file WHERE { GRAPH <${address}> { ?placement a rec:Placement ; rec:writtenBy [] ; solid:instance ?file
        OPTIONAL { ?placement solid:forClass ?class } OPTIONAL { ?placement rec:writtenAlways ?always }
        FILTER (!BOUND(?class) || BOUND(?always) || ?class IN (${held.join(", ")})) } }`,
    ),
  );
  assert.ok(written.some((file) => file.endsWith("clinical/allergies.ttl")));
  assert.ok(!written.some((file) => file.endsWith("clinical/procedures.ttl")));
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
        { ?placement rec:writtenBy [] ; solid:instance ?target FILTER (?target IN (${written.map((view) => `<${view}>`).join(", ")})) }
        UNION { ?placement solid:forClass rec:View ; solid:instanceContainer [] } } }`,
    ),
  );
});

test("a build after each step reads no file back, or one the pod held at its opening more than once, and writes only the files it changes, each as a build of the whole pod writes it", async () => {
  assert.deepEqual([...pod.found.keys()], []);
  const begun = replayed.steps.map(({ wrote }) =>
    wrote.length === 0 ? -1 : pod.log.indexOf(wrote[0] ?? ""),
  );
  const builtAt = (path: string): number => {
    const first = pod.log.indexOf(path);
    return begun.findLastIndex((at) => at >= 0 && at < first);
  };
  const appeared = layout.views.flatMap(({ file }) =>
    pod.log.includes(file ?? "") ? [builtAt(file ?? "")] : [],
  );
  assert.ok(appeared.length > 0);
  assert.equal(
    pod.writes.get(layout.typeIndex),
    new Set([builtAt(layout.typeIndex), ...appeared]).size,
  );
  assert.ok((pod.writes.get(layout.manifest) ?? 0) > 1);
  const parser = new OxigraphStore();
  for (const path of layout.rebuilt) {
    const bytes = await pod.read(path);
    const full = await store.construct(
      `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${address}${path}> { ?s ?p ?o } }`,
    );
    if (full.length === 0) {
      assert.equal(bytes, undefined, path);
      continue;
    }
    assert.ok(bytes, path);
    assert.equal(
      notIsomorphic(full, await parser.parse(bytes, address + path)),
      undefined,
      path,
    );
  }
  pod.found.clear();
  const opened = reopened();
  await opened.refuse("a first step");
  await opened.refuse("a second step");
  assert.ok(pod.found.size > 0);
  assert.deepEqual(
    [...pod.found].filter(([, reads]) => reads > 1),
    [],
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

test("the matcher reads a statement two files of the pod make as one", async () => {
  const [[first, record] = []] = (
    await values(
      store,
      `SELECT ?first ?record WHERE { ?first rec:revisionOf ?record FILTER NOT EXISTS { ?first prov:wasRevisionOf [] } }`,
    )
  ).map((row) => row.split(" "));
  const files = await vocabulary();
  const copy = await reopened().fork(clock);
  await copy.files.write(
    "restated.ttl",
    new TextEncoder().encode(
      `<${first ?? ""}> <https://ns.cascadeprotocol.org/records/v1-draft#revisionOf> <${record ?? ""}> .`,
    ),
  );
  const restated = new CorePod({
    pod: copy.files,
    address,
    subject: replayed.story.subject,
    title: "matching",
    vocabulary: files,
    layout,
    newStore: () => new OxigraphStore(),
    time: clock,
    importers: [],
    references: () =>
      References.of(
        files,
        `${storyFolder}/references/`,
        () => new OxigraphStore(),
      ),
    build: { lens: LENS, derive: await vocabularyDerive(files, layout) },
  });
  assert.equal((await restated.match()).refused, undefined);
});
