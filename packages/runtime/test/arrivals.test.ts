import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import { ccdaDownload } from "@cascade-runtime/ccda-download";
import { reachedIn } from "../src/arrivals.js";
import { BridgeError, type LoadedAdapter } from "../src/bridge.js";
import { CorePod } from "../src/core-pod.js";
import { MemoryFiles } from "../src/files.js";
import { StoryTime } from "../src/ids.js";
import { Graph, parseGraph } from "../src/graph.js";
import { iri, written } from "../src/rdf.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { type Replayed, replay } from "../src/replay.js";
import type { Step, Story } from "../src/story.js";
import { layout, replayed, RUNTIME, vocabulary } from "./vocabulary.js";

const newStore = (): OxigraphStore => new OxigraphStore();
const FEATURE = "runtime/arrivals.feature";
const OA = "http://www.w3.org/ns/oa#";
const CASCADE = "https://ns.cascadeprotocol.org/cascade#";

/**
 * Finn's stray-statement import, the stray line dropped, the arrival's selector node blank as saved, named `<urn:example:selector>`,
 * or with a blank-node statement beside it, then an entry whose version holds a blank node and one that holds none.
 */
async function strayReplay(mode: "saved" | "named" | "blank" = "saved") {
  const files = await vocabulary();
  const finn = "runtime/scripted-input/finn";
  const source = new MemoryFiles("https://story.example/");
  for (const path of [
    ...(await files.list(`${finn}/downloads/stray-statement`)),
    ...(await files.list(`${finn}/bridge/stray-statement`)),
  ]) {
    const bytes = (await files.read(path)) ?? new Uint8Array();
    await source.write(
      `s/${path
        .slice(finn.length + 1)
        .replace("downloads/stray-statement/", "")
        .replace("bridge/stray-statement/", "bridge/")}`,
      path.endsWith("graph.ttl")
        ? new TextEncoder().encode(
            new TextDecoder()
              .decode(bytes)
              .replace(/^<urn:example:stray>.*$/m, "")
              .replace(
                /^(.*)oa:hasSelector (_:\w+)/m,
                (_line, head: string, label: string) =>
                  mode === "named"
                    ? `${head}oa:hasSelector <urn:example:selector>`
                    : mode === "blank"
                      ? `${head}<urn:example:says> _:stray ; oa:hasSelector ${label}`
                      : `${head}oa:hasSelector ${label}`,
              )
              .replace(/^_:\w+ a oa:FragmentSelector/m, (line) =>
                mode === "named"
                  ? line.replace(/^_:\w+/, "<urn:example:selector>")
                  : line,
              ),
          )
        : bytes,
    );
  }
  const entry = (session: string, allergen: string): Uint8Array =>
    new TextEncoder()
      .encode(`<${session}> a <http://www.w3.org/ns/prov#Activity> .
<urn:cascade:output-0> a <https://ns.cascadeprotocol.org/cascade#AllergyOrIntolerance> .
<urn:cascade:output-0-version> <http://www.w3.org/ns/prov#specializationOf> <urn:cascade:output-0> ;
  <https://ns.cascadeprotocol.org/cascade#allergen> ${allergen} .`);
  await source.write(
    "s/blank.ttl",
    entry(
      "urn:uuid:5b2e8f14-9c3a-4d71-a6e0-2f8b7c4d1e93",
      `"Peanut" ; <urn:example:note> [ <urn:example:value> 2 ]`,
    ),
  );
  await source.write(
    "s/plain.ttl",
    entry("urn:uuid:8c1f4e7a-2d93-4b56-b0a8-e3d6f9c2a147", '"Peanut"'),
  );
  const story: Story = {
    address: "https://pod.example/",
    subject: "urn:uuid:a5e8c1d3-2f47-4b9a-8e60-1c3d5f7a9b24",
    steps: [
      {
        name: "create",
        when: "2026-06-01T09:00:00Z",
        happened: { kind: "creation" },
      },
      {
        name: "import",
        when: "2026-06-02T09:00:00Z",
        happened: {
          kind: "import",
          export: "apple_health_export",
          converted: "bridge",
        },
      },
      {
        name: "entry",
        when: "2026-06-03T09:00:00Z",
        happened: { kind: "entry", file: "blank.ttl" },
      },
      {
        name: "plain",
        when: "2026-06-04T09:00:00Z",
        happened: { kind: "entry", file: "plain.ttl" },
      },
    ],
  };
  return replay({
    runtime: RUNTIME,
    story,
    source,
    vocabulary: files,
    folder: "s",
    title: "",
    pod: new MemoryFiles(story.address),
    newStore,
    layout: await layout(),
    importers: [appleHealthExport],
  });
}

/** The files the step wrote that are RDF, as one graph. */
async function wroteBy(done: Replayed, index: number): Promise<Graph> {
  const triples = [];
  for (const path of done.steps[index]?.wrote ?? [])
    if ((await layout()).isRdf(path))
      triples.push(
        ...(
          await parseGraph(
            (await done.pod.read(path)) ?? new Uint8Array(),
            done.pod.iri + path,
            newStore,
          )
        ).triples,
      );
  return new Graph(triples);
}

/**
 * The versions the revisions the step wrote name: a revision is a subject of `cascade:version` that also states when it
 * was last updated.
 */
async function versionsRevised(
  done: Replayed,
  index: number,
): Promise<string[]> {
  const versions: string[] = [];
  for (const path of done.steps[index]?.wrote ?? []) {
    if (!(await layout()).isRdf(path)) continue;
    const { triples } = await parseGraph(
      (await done.pod.read(path)) ?? new Uint8Array(),
      done.pod.iri + path,
      newStore,
    );
    for (const [s, p, o] of triples)
      if (
        p.value === `${CASCADE}version` &&
        triples.some(
          ([t, q, k]) =>
            t.value === s.value &&
            q.value === "http://purl.org/pav/lastUpdateOn" &&
            k.value !== "",
        )
      )
        versions.push(o.value);
  }
  return versions;
}

/** The revision the import wrote carries the arrival's selector as its #selector, with the selector's statements. */
async function carriesSelector(done: Replayed): Promise<void> {
  assert.equal(done.steps[1]?.refused, undefined);
  const wrote = await wroteBy(done, 1);
  const [revision] = wrote.subjects(`${CASCADE}revisionOf`);
  assert.ok(revision);
  const selector = iri(`${revision.value}#selector`);
  assert.deepEqual(wrote.objects(revision, `${OA}hasSelector`).map(written), [
    written(selector),
  ]);
  assert.deepEqual(
    wrote
      .match(selector)
      .map(([, p, o]) => `${p.value} ${written(o)}`)
      .sort(),
    [
      `http://purl.org/dc/terms/conformsTo <https://www.rfc-editor.org/rfc/rfc6901>`,
      `http://www.w3.org/1999/02/22-rdf-syntax-ns#type <${OA}FragmentSelector>`,
      `http://www.w3.org/1999/02/22-rdf-syntax-ns#value ""`,
    ],
  );
}

/** Ada's first export, then one that holds the current version restamped, a new version, and the first again. */
async function threeStatesOfOneRecord(): Promise<Replayed> {
  const files = await vocabulary();
  const ada = "runtime/scripted-input/ada/";
  const bytes = async (path: string): Promise<Uint8Array> =>
    (await files.read(`${ada}${path}`)) ?? new Uint8Array();
  const text = async (path: string): Promise<string> =>
    new TextDecoder().decode(await bytes(path));
  const source = new MemoryFiles("https://story.example/");
  const record = (file: string, received: string): string =>
    `<ClinicalRecord type="HKClinicalTypeIdentifierAllergyRecord" identifier="peanut" sourceName="Example Hospital" sourceURL="https://fhir.example.org/r4/AllergyIntolerance/peanut" fhirVersion="4.0.1" receivedDate="${received}" resourceFilePath="/clinical-records/${file}"/>`;
  const exported = (date: string, records: string[]): Uint8Array =>
    new TextEncoder().encode(
      `<?xml version="1.0" encoding="UTF-8"?><HealthData locale="en_US"><ExportDate value="${date}"/>${records.join("")}</HealthData>`,
    );
  await source.write(
    "s/first/apple_health_export/export.xml",
    exported("2026-01-02 10:00:00 +0000", [
      record("AllergyIntolerance-peanut.json", "2026-01-02 10:00:00 +0000"),
    ]),
  );
  await source.write(
    "s/first/apple_health_export/clinical-records/AllergyIntolerance-peanut.json",
    await bytes(
      "downloads/first-export/apple_health_export/clinical-records/AllergyIntolerance-peanut.json",
    ),
  );
  await source.write(
    "s/bridge/first/AllergyIntolerance-peanut/graph.ttl",
    await bytes("bridge/first-export/AllergyIntolerance-peanut/graph.ttl"),
  );
  await source.write(
    "s/second/apple_health_export/export.xml",
    exported("2026-01-08 10:00:00 +0000", [
      record("AllergyIntolerance-peanut-1.json", "2026-01-08 10:00:00 +0000"),
      record("AllergyIntolerance-peanut-2.json", "2026-01-08 10:00:00 +0000"),
      record("AllergyIntolerance-peanut-3.json", "2026-01-08 10:00:00 +0000"),
    ]),
  );
  for (const [file, from] of [
    ["AllergyIntolerance-peanut-1", "current-version-again"],
    ["AllergyIntolerance-peanut-2", "new-content"],
    ["AllergyIntolerance-peanut-3", "change-undone"],
  ] as const) {
    await source.write(
      `s/second/apple_health_export/clinical-records/${file}.json`,
      await bytes(
        `downloads/${from}/apple_health_export/clinical-records/AllergyIntolerance-peanut.json`,
      ),
    );
    await source.write(
      `s/bridge/second/${file}/graph.ttl`,
      new TextEncoder().encode(
        (
          await text(`bridge/${from}/AllergyIntolerance-peanut/graph.ttl`)
        ).replaceAll(/2026-01-0[56]T10:00:00Z/g, "2026-01-08T10:00:00Z"),
      ),
    );
  }
  const story: Story = {
    address: "https://pod.example/",
    subject: "urn:uuid:3c9f1a2e-7b64-4d08-9e5a-6f2b8c1d4e70",
    steps: [
      {
        name: "create",
        when: "2026-01-01T09:00:00Z",
        happened: { kind: "creation" },
      },
      ...(["first", "second"] as const).map((name, index) => ({
        name,
        when: ["2026-01-02T10:00:00Z", "2026-01-08T10:00:00Z"][index] ?? "",
        happened: {
          kind: "import" as const,
          export: `${name}/apple_health_export`,
          converted: `bridge/${name}`,
        },
      })),
    ],
  };
  return replay({
    runtime: RUNTIME,
    story,
    source,
    vocabulary: files,
    folder: "s",
    title: "",
    pod: new MemoryFiles(story.address),
    newStore,
    layout: await layout(),
    importers: [appleHealthExport],
  });
}

/**
 * An adapter converts each document of an export into arrivals: one arrival is one state of one record, as its source
 * reported it. `CorePod.import()` files each arrival as a revision of its record, and writes nothing for a state the
 * record is already at.
 * @rule runtime/arrivals.feature A4
 * @rule runtime/arrivals.feature A5
 * @rule runtime/arrivals.feature A7
 * @rule runtime/arrivals.feature A21
 * @rule runtime/naming.feature N4
 */
describe("Turning an adapter's arrivals into revisions · CorePod.import(), reachedIn()", () => {
  describe("given an arrival whose selector has statements of its own, as a blank node or as a node named by an IRI", () => {
    let saved: Replayed;
    let named: Replayed;

    before(async () => {
      [saved, named] = await Promise.all([
        strayReplay("saved"),
        strayReplay("named"),
      ]);
    });

    it("carries a blank selector into the revision, which states its three statements about `<revision>#selector`", async () => {
      await carriesSelector(saved);
    });

    it("carries a selector named by an IRI as it carries a blank one: the revision states the selector's statements", async () => {
      await carriesSelector(named);
    });
  });

  describe("given one export that holds three states of one record: the state it is at, a new one, then the first again", () => {
    let first: string[];
    let second: string[];
    let stopped: unknown;
    let refused: (string | undefined)[];

    before(async () => {
      const done = await threeStatesOfOneRecord();
      stopped = done.stopped;
      refused = done.steps.map((step) => step.refused);
      first = await versionsRevised(done, 1);
      second = await versionsRevised(done, 2);
    });

    it("writes two revisions, of the new state and of the first again", () => {
      assert.equal(stopped, undefined);
      assert.deepEqual(refused, [undefined, undefined, undefined]);
      assert.equal(first.length, 1);
      const [version] = first;
      assert.equal(second.length, 2);
      assert.equal(second.filter((one) => one === version).length, 1);
      assert.equal(second.filter((one) => one !== version).length, 1);
    });
  });

  describe("reachedIn(graph, document)", () => {
    const doc = "ni:///sha-256;doc";
    const transmitter = (act: string, agent: string): string =>
      `${act} prov:qualifiedAssociation [ prov:agent ${agent} ; prov:hadRole cascade:TransmitterRole ] .`;
    const reached = async (statements: string) =>
      reachedIn(
        await parseGraph(
          new TextEncoder().encode(`@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix pav: <http://purl.org/pav/> .
<${doc}> pav:retrievedOn "2026-01-01T00:00:00Z" .
${statements}`),
          doc,
          newStore,
        ),
        iri(doc),
      );
    const author = `<${doc}> prov:wasAttributedTo <urn:x:author> ; prov:wasGeneratedBy _:writing .
_:writing prov:qualifiedAssociation [ prov:agent <urn:x:author> ; prov:hadRole cascade:AuthorRole ] .`;

    it('returns `""` as the transmitter of a document that names only its author', async () => {
      assert.equal((await reached(author)).transmitter, "");
    });

    it("returns, as the document's transmitter, the IRI of the agent an act that generated it names with the transmitter's role", async () => {
      assert.equal(
        (
          await reached(`${author}
${transmitter("_:writing", "<urn:x:fetcher>")}`)
        ).transmitter,
        "urn:x:fetcher",
      );
    });

    it("returns that one IRI when two acts that produced the document both name it", async () => {
      assert.equal(
        (
          await reached(`<${doc}> prov:wasGeneratedBy _:a , _:b .
${transmitter("_:a", "<urn:x:fetcher>")}
${transmitter("_:b", "<urn:x:fetcher>")}`)
        ).transmitter,
        "urn:x:fetcher",
      );
    });

    it("returns `undefined` when two such acts name two transmitters", async () => {
      assert.equal(
        (
          await reached(`<${doc}> prov:wasGeneratedBy _:a , _:b .
${transmitter("_:a", "<urn:x:fetcher>")}
${transmitter("_:b", "<urn:x:another>")}`)
        ).transmitter,
        undefined,
      );
    });

    it("returns `undefined` for a transmitter that no IRI names", async () => {
      assert.equal(
        (
          await reached(`<${doc}> prov:wasGeneratedBy _:a .
${transmitter("_:a", '[ <http://www.w3.org/2000/01/rdf-schema#label> "Apple Health" ]')}`)
        ).transmitter,
        undefined,
      );
    });
  });
});

/** The bad inputs a story can give a step, each with the sentence `refused` is to say. */
const BAD_INPUT = {
  "no sourceURL": [
    { kind: "import", export: "apple_health_export", converted: "bridge" },
    /AllergyIntolerance-peanut.json: .*has no sourceURL/,
  ],
  "no importer reads": [
    { kind: "import", export: "nothing", converted: "bridge" },
    /^no importer of .* reads s\/nothing$/,
  ],
  "not well-formed": [
    { kind: "import", export: "broken.xml", converted: "bridge" },
    /^s\/broken\.xml: /,
  ],
  "no adapter accepts": [
    { kind: "import", export: "not-a-ccda.xml", converted: "bridge" },
    /^s\/not-a-ccda\.xml: no adapter of application\/cda\+xml accepts it$/,
  ],
  "missing file": [
    { kind: "entry", file: "missing.ttl" },
    /s\/missing\.ttl does not exist$/,
  ],
  "session not a urn:uuid:": [
    { kind: "entry", file: "this-entry.ttl" },
    /^this-entry\.ttl names its session urn:cascade:this-entry: an app mints a urn:uuid: for each entry session once, and keeps it$/,
  ],
  "blank allergen": [
    { kind: "entry", file: "blank-allergen.ttl" },
    /^blank-allergen\.ttl does not conform to the vocabulary's shapes: .*cascade#allergen: /,
  ],
  "made-up criticality": [
    { kind: "entry", file: "made-up-criticality.ttl" },
    /^made-up-criticality\.ttl does not conform to the vocabulary's shapes: .*cascade#allergyCriticality: /,
  ],
  "no judgment": [
    { kind: "judgment", file: "no-judgment.ttl" },
    /^no-judgment\.ttl holds 0 judgments and 0 retractions, not one of either$/,
  ],
  "not Turtle": [
    { kind: "judgment", file: "no-turtle.ttl" },
    /^no-turtle\.ttl is no Turtle: /,
  ],
  "version not listed": [
    { kind: "reference", name: "urn:example:unlisted" },
    /urn:example:unlisted, a version references\.ttl does not list$/,
  ],
  "tables with no list": [
    { kind: "open", tables: "tables/missing/" },
    /s\/tables\/missing\/references\.ttl does not exist$/,
  ],
} as const satisfies Record<string, readonly [Step["happened"], RegExp]>;

/** A story whose steps are each given bad input by the story's own files, then a creation that is not. */
async function badInputReplay(): Promise<Replayed> {
  const source = new MemoryFiles("https://story.example/");
  await source.write(
    "s/apple_health_export/export.xml",
    new TextEncoder().encode(
      '<HealthData><ClinicalRecord sourceName="Example Hospital" fhirVersion="4.0.1" receivedDate="2026-01-02 10:00:00 +0000" resourceFilePath="/clinical-records/AllergyIntolerance-peanut.json"/></HealthData>',
    ),
  );
  await source.write(
    "s/apple_health_export/clinical-records/AllergyIntolerance-peanut.json",
    new TextEncoder().encode('{"resourceType": "AllergyIntolerance"}'),
  );
  await source.write(
    "s/broken.xml",
    new TextEncoder().encode('<ClinicalDocument xmlns="urn:hl7-org:v3"><id>'),
  );
  await source.write(
    "s/not-a-ccda.xml",
    new TextEncoder().encode('<ClinicalDocument xmlns="urn:hl7-org:v3"/>'),
  );
  await source.write("s/bridge/not-a-ccda/unaccepted.txt", new Uint8Array());
  await source.write("s/no-judgment.ttl", new Uint8Array());
  await source.write("s/no-turtle.ttl", new TextEncoder().encode("<a> <b>"));
  await source.write("s/references/references.ttl", new Uint8Array());
  for (const [file, allergen, criticality] of [
    ["blank-allergen.ttl", "", "high"],
    ["made-up-criticality.ttl", "Peanuts", "extreme"],
  ])
    await source.write(
      `s/${file}`,
      new TextEncoder().encode(`@prefix prov: <http://www.w3.org/ns/prov#> .
<urn:uuid:7d4a1c9e-3b6f-4e28-8a15-c0f2e9b7d364> a prov:Activity .
<urn:cascade:output-0> a <https://ns.cascadeprotocol.org/cascade#AllergyOrIntolerance> .
<urn:cascade:output-0-version> prov:specializationOf <urn:cascade:output-0> ;
  <https://ns.cascadeprotocol.org/cascade#allergen> "${allergen}" ;
  <https://ns.cascadeprotocol.org/cascade#allergyCriticality> "${criticality}" .`),
    );
  await source.write(
    "s/this-entry.ttl",
    new TextEncoder().encode(
      "<urn:cascade:this-entry> a <http://www.w3.org/ns/prov#Activity> .",
    ),
  );
  const story: Story = {
    address: "https://pod.example/",
    subject: "urn:uuid:3c9f1a2e-7b64-4d08-9e5a-6f2b8c1d4e70",
    steps: [
      ...Object.entries(BAD_INPUT).map(([name, [happened]], index) => ({
        name,
        when: `2026-06-${String(index + 1).padStart(2, "0")}T09:00:00Z`,
        happened: happened as Step["happened"],
      })),
      {
        name: "create",
        when: "2026-06-29T09:00:00Z",
        happened: { kind: "creation" },
      },
    ],
  };
  return replay({
    runtime: RUNTIME,
    story,
    source,
    vocabulary: await vocabulary(),
    folder: "s",
    title: "",
    pod: new MemoryFiles(story.address),
    newStore,
    layout: await layout(),
    importers: [appleHealthExport, ccdaDownload],
  });
}

/** A pod whose import of one C-CDA document is given `adapter`. */
async function importWith(adapter: LoadedAdapter) {
  const download = new MemoryFiles("https://download.example/");
  await download.write(
    "summary.xml",
    new TextEncoder().encode('<ClinicalDocument xmlns="urn:hl7-org:v3"/>'),
  );
  const time = new StoryTime();
  time.begin("2026-06-01T09:00:00Z");
  const pod = new CorePod({
    runtime: RUNTIME,
    pod: new MemoryFiles("https://pod.example/"),
    address: "https://pod.example/",
    subject: "urn:uuid:3c9f1a2e-7b64-4d08-9e5a-6f2b8c1d4e70",
    title: "",
    vocabulary: await vocabulary(),
    layout: await layout(),
    newStore,
    time,
    importers: [ccdaDownload],
    references: () => Promise.reject(new Error("an import reads no table")),
  });
  return pod.import(download, "summary.xml", async () => () => [adapter]);
}

/** An adapter that fails with `kind` when asked to `on`, and is otherwise as a real one does. */
function failing(
  on: "accepts" | "convert",
  kind: "document" | "bridge",
): LoadedAdapter {
  const fail = () => Promise.reject(new BridgeError(kind, "it fails"));
  return {
    accepts: on === "accepts" ? fail : () => Promise.resolve(true),
    convert:
      on === "convert" ? fail : () => Promise.reject(new Error("unreached")),
    free: () => Promise.resolve(),
  };
}

/**
 * A step whose input breaks a rule is refused: the call returns `refused`, a sentence saying which rule, and writes no
 * file. A failure that is not the input's fault is thrown instead.
 * @rule runtime/arrivals.feature A14
 */
describe("Refusing a step that cannot be filed · Performed.refused", () => {
  let examples: ReadonlyMap<string, string | undefined>;
  let stoppedAt: unknown[];
  let blank: Replayed;
  let bad: Replayed;
  const sentence = (name: keyof typeof BAD_INPUT): string =>
    bad.steps.find(({ step }) => step.name === name)?.refused ?? "";
  const says = (name: keyof typeof BAD_INPUT): RegExp => BAD_INPUT[name][1];

  before(async () => {
    const replays = await Promise.all(
      [
        "a Bridge graph holding a statement about nothing the pod files",
        "a record of a type the pod files nowhere",
        "one import's documents disagreeing on the import's description, so not even the agreeing one is written",
        "an entry holding two activities",
      ].map((example) =>
        replayed(FEATURE, example, { importers: [appleHealthExport] }),
      ),
    );
    const refused = new Map<string, string | undefined>();
    for (const { steps } of replays)
      for (const { step, refused: why } of steps) refused.set(step.name, why);
    examples = refused;
    stoppedAt = replays.map(({ stopped }) => stopped);
    [blank, bad] = await Promise.all([strayReplay("blank"), badInputReplay()]);
  });

  describe("given an import", () => {
    it("returns `refused` for a graph holding a statement about nothing the pod files", () => {
      assert.match(
        examples.get("stray-statement") ?? "",
        /holds a statement about no record, version, arrival, document or import/,
      );
    });

    it("returns `refused` for a record of a type the pod files nowhere, naming the type", () => {
      assert.match(
        examples.get("type-filed-nowhere") ?? "",
        /is of no type the pod files: .*NoSuchRecord/,
      );
    });

    it("returns `refused` when the import's documents disagree on its description", () => {
      assert.match(
        examples.get("import-disagreement") ?? "",
        /documents disagree on the import's label, start or association/,
      );
    });

    it("returns `refused` for a clinical record its export gives no `sourceURL`, naming the file", () => {
      assert.match(sentence("no sourceURL"), says("no sourceURL"));
    });

    it("returns `refused` for a path no importer reads", () => {
      assert.match(sentence("no importer reads"), says("no importer reads"));
    });

    it("returns `refused` for a document that is not well-formed, naming it", () => {
      assert.match(sentence("not well-formed"), says("not well-formed"));
    });

    it("returns `refused` for a CDA document no adapter accepts", () => {
      assert.match(sentence("no adapter accepts"), says("no adapter accepts"));
    });

    it("returns `refused` for a revision whose content holds a blank node", () => {
      assert.match(
        blank.steps[1]?.refused ?? "",
        /^the revision of urn:uuid:.*holds a blank node/,
      );
    });
  });

  describe("given records entered by the owner", () => {
    it("returns `refused` for a file that does not exist", () => {
      assert.match(sentence("missing file"), says("missing file"));
    });

    it("returns `refused` for an entry session not named by a `urn:uuid:`", () => {
      assert.match(
        sentence("session not a urn:uuid:"),
        says("session not a urn:uuid:"),
      );
    });

    it("returns `refused` for a version that breaks the vocabulary's shapes, naming the property", () => {
      assert.match(sentence("blank allergen"), says("blank allergen"));
      assert.match(
        sentence("made-up criticality"),
        says("made-up criticality"),
      );
    });

    it("returns `refused` for a file that describes two acts", () => {
      assert.match(
        examples.get("entry-of-two-activities") ?? "",
        /holds 2 activities, not one/,
      );
    });

    it("returns `refused` for a version whose content holds a blank node", () => {
      assert.match(
        blank.steps[2]?.refused ?? "",
        /^blank\.ttl: .*holds a blank node/,
      );
    });
  });

  describe("given a judgment", () => {
    it("returns `refused` for a file holding no judgment and no retraction", () => {
      assert.match(sentence("no judgment"), says("no judgment"));
    });

    it("returns `refused` for a file that is not Turtle", () => {
      assert.match(sentence("not Turtle"), says("not Turtle"));
    });
  });

  describe("given a table version, or tables, that are not there", () => {
    it("returns `refused` for a version `references.ttl` does not list", () => {
      assert.match(sentence("version not listed"), says("version not listed"));
    });

    it("returns `refused` for an open with a folder that has no `references.ttl`", () => {
      assert.match(
        sentence("tables with no list"),
        says("tables with no list"),
      );
    });
  });

  describe("given a refused step", () => {
    it("writes no file", () => {
      for (const name of Object.keys(BAD_INPUT))
        assert.deepEqual(
          bad.steps.find(({ step }) => step.name === name)?.wrote,
          [],
          name,
        );
      for (const step of blank.steps.slice(1, 3))
        assert.deepEqual(step.wrote, [], step.step.name);
    });

    it("does not stop `replay()`, which performs the step after it", () => {
      assert.equal(bad.stopped, undefined);
      assert.notDeepEqual(bad.steps.at(-1)?.wrote, []);
      assert.equal(blank.steps[3]?.refused, undefined);
      assert.notDeepEqual(blank.steps[3]?.wrote, []);
      assert.deepEqual(stoppedAt, [undefined, undefined, undefined, undefined]);
    });
  });

  describe("given an adapter that fails", () => {
    it("returns `refused`, with the Bridge's reason, for a `BridgeError` of kind `document`", async () => {
      for (const on of ["accepts", "convert"] as const)
        assert.equal(
          (await importWith(failing(on, "document"))).refused,
          "summary.xml: it fails",
          on,
        );
    });

    it("writes no file for it", async () => {
      for (const on of ["accepts", "convert"] as const)
        assert.deepEqual(
          (await importWith(failing(on, "document"))).wrote,
          [],
          on,
        );
    });
  });

  describe("given an adapter that breaks, which throws rather than refuses", () => {
    it("rejects with the error for a `BridgeError` of kind `bridge`", async () => {
      for (const on of ["accepts", "convert"] as const)
        await assert.rejects(importWith(failing(on, "bridge")), /it fails/, on);
    });
  });
});
