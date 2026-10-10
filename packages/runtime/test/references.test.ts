import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFiles, readText } from "../src/files.js";
import { Graph } from "../src/graph.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, type Triple } from "../src/rdf.js";
import { References, tableTerms } from "../src/references.js";
import { REC, Refusal } from "../src/step.js";
import { vocabulary } from "./vocabulary.js";

const RECORDS = "ontologies/records/v1-draft/records.ttl";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const URI_SPACE = "http://rdfs.org/ns/void#uriSpace";

test("a version whose name names no file refuses the step rather than aborting the replay", async () => {
  const source = new MemoryFiles("https://story.example/");
  await source.write("references/references.ttl", new TextEncoder().encode(""));
  const references = await References.of(
    source,
    "references/",
    () => new OxigraphStore(),
  );
  const files = await vocabulary();
  const folder = "runtime/scripted-input/hana/tables/app/";
  const tables = new MemoryFiles(files.iri);
  await tables.write(
    `${folder}references.ttl`,
    (await files.read(`${folder}references.ttl`)) ?? new Uint8Array(),
  );
  const shared = await References.of(
    tables,
    folder,
    () => new OxigraphStore(),
    files,
  );
  const rules = "f32ebeea-4ed7-4da7-b08c-031dc619538e";
  const refused: [References, string, RegExp][] = [
    [references, "https://example.org/tables/v2", /./],
    [references, "ni:///sha-256;not*base64", /./],
    [
      shared,
      `urn:uuid:${rules.replace("f", "e")}`,
      /runtime\/scripted-input\/hana\/tables\/app\/ holds no rows for/,
    ],
  ];
  for (const [from, version, message] of refused) {
    await assert.rejects(
      from.rows(version),
      (error) => error instanceof Refusal && message.test(error.message),
      version,
    );
  }
});

test("a folder without a file for a version of the vocabulary's rule list reads it from the vocabulary, and a file of the folder's own is read instead", async () => {
  const files = await vocabulary();
  const rules = "f32ebeea-4ed7-4da7-b08c-031dc619538e";
  const folder = "runtime/scripted-input/hana/tables/app/";
  const story = new MemoryFiles(files.iri);
  await story.write(
    `${folder}references.ttl`,
    (await files.read(`${folder}references.ttl`)) ?? new Uint8Array(),
  );
  const ruleCount = async (rows: Promise<Triple[]>) =>
    new Graph(await rows).subjects(
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      iri(`${REC}MatcherRule`),
    ).length;
  const references = () =>
    References.of(story, folder, () => new OxigraphStore(), files);

  const shared = await ruleCount(
    (await references()).rows(`urn:uuid:${rules}`),
  );
  assert.ok(shared > 0);
  await story.write(`${folder}${rules}.ttl`, new TextEncoder().encode(""));
  assert.equal(
    await ruleCount((await references()).rows(`urn:uuid:${rules}`)),
    0,
  );
});

test("the table terms hold one code system for each the vocabulary's records file registers, with its label and its URI space", async () => {
  const files = await vocabulary();
  const registry = new Graph(
    await new OxigraphStore().parse(
      await readText(files, RECORDS),
      files.iri + RECORDS,
    ),
  );
  const registered = registry
    .subjects(
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      iri(`${REC}CodeSystem`),
    )
    .map((system) => ({
      iri: system.value,
      label: registry.objects(system, RDFS_LABEL)[0]?.value,
      uriSpace: registry.objects(system, URI_SPACE)[0]?.value,
    }));
  const { codeSystems, uriSpaces } = await tableTerms(
    files,
    () => new OxigraphStore(),
  );
  assert.ok(registered.length > 0);
  assert.deepEqual(
    [...codeSystems].sort((a, b) => (a.iri < b.iri ? -1 : 1)),
    registered.sort((a, b) => (a.iri < b.iri ? -1 : 1)),
  );
  assert.deepEqual(
    uriSpaces,
    codeSystems.map(({ uriSpace }) => uriSpace),
  );
  for (const { iri: system, uriSpace } of codeSystems)
    assert.ok(uriSpace.endsWith("/"), system);
});

test("a code system registered without a label or without a URI space is a broken vocabulary, an Error and never a Refusal", async () => {
  const system = (what: string): string =>
    `@prefix rec: <${REC}> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix void: <http://rdfs.org/ns/void#> .
rec:Broken a rec:CodeSystem ; ${what} .`;
  for (const [broken, why] of [
    [system('void:uriSpace "urn:test:broken/"'), "no label"],
    [system('rdfs:label "Broken"@en'), "no URI space"],
  ] as const) {
    const files = new MemoryFiles("urn:test:vocabulary/");
    await files.write(RECORDS, new TextEncoder().encode(broken));
    await assert.rejects(
      tableTerms(files, () => new OxigraphStore()),
      (error: unknown) =>
        error instanceof Error &&
        !(error instanceof Refusal) &&
        error.message.includes(`${REC}Broken`),
      why,
    );
  }
});
