import assert from "node:assert/strict";
import { test } from "node:test";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import { ccdaDownload } from "@cascade-runtime/ccda-download";
import { BridgeError, type LoadedAdapter } from "../src/bridge.js";
import { CorePod } from "../src/core-pod.js";
import { MemoryFiles } from "../src/files.js";
import { StoryTime } from "../src/ids.js";
import { parseGraph } from "../src/graph.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { replay } from "../src/replay.js";
import type { Step, Story } from "../src/story.js";
import { layout, storyFrom, vocabulary } from "./vocabulary.js";

const newStore = (): OxigraphStore => new OxigraphStore();

async function replayed(feature: string, example: string) {
  const files = await vocabulary();
  const { story, folder } = await storyFrom(feature, example);
  return replay({
    story,
    source: files,
    vocabulary: files,
    folder,
    title: "",
    pod: new MemoryFiles(story.address),
    newStore,
    layout: await layout(),
    importers: [appleHealthExport],
  });
}

test("an import writes its content-addressed files first, then its revisions, and its own description last", async () => {
  const { pod, steps } = await replayed(
    "runtime/arrivals.feature",
    "each record's first arrival is its first version and a revision that follows none",
  );
  const wrote = steps[1]?.wrote ?? [];
  const ranks: number[] = [];
  for (const path of wrote) {
    if (!(await layout()).isRdf(path)) {
      ranks.push(0);
      continue;
    }
    const { triples } = await parseGraph(
      (await pod.read(path)) ?? new Uint8Array(),
      pod.iri + path,
      newStore,
    );
    const said = (iri: string): boolean =>
      triples.some(([, p, o]) => p.value === iri || o.value === iri);
    ranks.push(
      said("http://www.w3.org/ns/prov#used")
        ? 2
        : said("https://ns.cascadeprotocol.org/records/v1-draft#Revision")
          ? 1
          : 0,
    );
  }
  assert.deepEqual(
    ranks,
    [...ranks].sort((a, b) => a - b),
  );
  assert.deepEqual(new Set(ranks), new Set([0, 1, 2]));
  assert.equal(ranks.filter((rank) => rank === 2).length, 1);
});

test("a refused step says which rule refused it", async () => {
  const refused = new Map<string, string | undefined>();
  for (const example of [
    "a Bridge graph holding a statement about nothing the pod files",
    "a record of a type the pod files nowhere",
    "one import's documents disagreeing on the import's description, so not even the agreeing one is written",
    "an entry holding two activities",
  ]) {
    const { steps } = await replayed("runtime/arrivals.feature", example);
    for (const { step, refused: why } of steps) refused.set(step.name, why);
  }
  assert.match(
    refused.get("stray-statement") ?? "",
    /holds a statement about no record, version, arrival, document or import/,
  );
  assert.match(
    refused.get("type-filed-nowhere") ?? "",
    /is of no type the pod files: .*NoSuchRecord/,
  );
  assert.match(
    refused.get("import-disagreement") ?? "",
    /documents disagree on the import's label, start or association/,
  );
  assert.match(
    refused.get("entry-of-two-activities") ?? "",
    /holds 2 activities, not one/,
  );
});

test("a step whose content to be named holds a blank node is refused, and the replay goes on", async () => {
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
              .replace('bridge:selector ""', "bridge:selector _:selector"),
          )
        : bytes,
    );
  }
  const entry = (allergen: string): Uint8Array =>
    new TextEncoder()
      .encode(`<urn:cascade:this-entry> a <http://www.w3.org/ns/prov#Activity> .
<urn:cascade:output-0> a <https://ns.cascadeprotocol.org/health/v1#AllergyRecord> .
<urn:cascade:output-0-version> <http://www.w3.org/ns/prov#specializationOf> <urn:cascade:output-0> ;
  <https://ns.cascadeprotocol.org/health/v1#allergen> ${allergen} .`);
  await source.write("s/blank.ttl", entry("[ <urn:example:value> 2 ]"));
  await source.write("s/plain.ttl", entry('"Peanut"'));
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
  const { steps } = await replay({
    story,
    source,
    vocabulary: source,
    folder: "s",
    title: "",
    pod: new MemoryFiles(story.address),
    newStore,
    layout: await layout(),
    importers: [appleHealthExport],
  });
  assert.match(
    steps[1]?.refused ?? "",
    /^the revision of urn:uuid:.*holds a blank node/,
  );
  assert.match(steps[2]?.refused ?? "", /^blank\.ttl: .*holds a blank node/);
  for (const step of steps.slice(1, 3)) assert.deepEqual(step.wrote, []);
  assert.equal(steps[3]?.refused, undefined);
  assert.notDeepEqual(steps[3]?.wrote, []);
});

test("a step given bad input by its story is refused, and the replay goes on", async () => {
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
<urn:cascade:this-entry> a prov:Activity .
<urn:cascade:output-0> a <https://ns.cascadeprotocol.org/health/v1#AllergyRecord> .
<urn:cascade:output-0-version> prov:specializationOf <urn:cascade:output-0> ;
  <https://ns.cascadeprotocol.org/health/v1#allergen> "${allergen}" ;
  <https://ns.cascadeprotocol.org/clinical/v1#criticality> "${criticality}" .`),
    );
  const refusals: readonly [Step["happened"], RegExp][] = [
    [
      { kind: "import", export: "apple_health_export", converted: "bridge" },
      /AllergyIntolerance-peanut.json: .*has no sourceURL/,
    ],
    [
      { kind: "import", export: "nothing", converted: "bridge" },
      /^no importer of .* reads s\/nothing$/,
    ],
    [{ kind: "entry", file: "missing.ttl" }, /s\/missing\.ttl does not exist$/],
    [
      { kind: "entry", file: "blank-allergen.ttl" },
      /^blank-allergen\.ttl does not conform to the vocabulary's shapes: .*health\/v1#allergen: /,
    ],
    [
      { kind: "entry", file: "made-up-criticality.ttl" },
      /^made-up-criticality\.ttl does not conform to the vocabulary's shapes: .*clinical\/v1#criticality: /,
    ],
    [
      { kind: "judgment", file: "no-judgment.ttl" },
      /^no-judgment\.ttl holds 0 judgments, not one$/,
    ],
    [
      { kind: "judgment", file: "no-turtle.ttl" },
      /^no-turtle\.ttl is no Turtle: /,
    ],
    [
      { kind: "reference", name: "urn:example:unlisted" },
      /urn:example:unlisted, a version references\.ttl does not list$/,
    ],
  ];
  const story: Story = {
    address: "https://pod.example/",
    subject: "urn:uuid:3c9f1a2e-7b64-4d08-9e5a-6f2b8c1d4e70",
    steps: [
      ...refusals.map(([happened], index) => ({
        name: `refused-${index}`,
        when: `2026-06-${String(index + 1).padStart(2, "0")}T09:00:00Z`,
        happened,
      })),
      {
        name: "create",
        when: "2026-06-29T09:00:00Z",
        happened: { kind: "creation" },
      },
    ],
  };
  const { steps, stopped } = await replay({
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
  assert.equal(stopped, undefined);
  refusals.forEach(([happened, why], index) => {
    assert.match(steps[index]?.refused ?? "", why, happened.kind);
    assert.deepEqual(steps[index]?.wrote, []);
  });
  assert.notDeepEqual(steps.at(-1)?.wrote, []);
});

test("a document the Bridge fails on is refused with the Bridge's reason, and any other failure stops the step", async () => {
  const download = new MemoryFiles("https://download.example/");
  await download.write(
    "summary.xml",
    new TextEncoder().encode('<ClinicalDocument xmlns="urn:hl7-org:v3"/>'),
  );
  const failing = (
    on: "accepts" | "convert",
    kind: "document" | "bridge",
  ): LoadedAdapter => {
    const fail = () => Promise.reject(new BridgeError(kind, "it fails"));
    return {
      accepts: on === "accepts" ? fail : () => Promise.resolve(true),
      convert:
        on === "convert" ? fail : () => Promise.reject(new Error("unreached")),
      free: () => Promise.resolve(),
    };
  };
  const pod = async (): Promise<CorePod> => {
    const time = new StoryTime();
    time.begin("2026-06-01T09:00:00Z");
    return new CorePod({
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
  };
  for (const on of ["accepts", "convert"] as const) {
    const performed = await (
      await pod()
    ).import(download, "summary.xml", () => [failing(on, "document")]);
    assert.equal(performed.refused, "summary.xml: it fails", on);
    assert.deepEqual(performed.wrote, [], on);
    await assert.rejects(
      (await pod()).import(download, "summary.xml", () => [
        failing(on, "bridge"),
      ]),
      /it fails/,
      on,
    );
  }
});
