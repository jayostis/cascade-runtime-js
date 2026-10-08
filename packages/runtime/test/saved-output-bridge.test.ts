import assert from "node:assert/strict";
import { test } from "node:test";
import { isBridgeError } from "../src/bridge.js";
import { MemoryFiles } from "../src/files.js";
import { documentName } from "../src/names.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { SavedOutputBridge } from "../src/saved-output-bridge.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

test("the saved-output Bridge answers a document from what the step saved, declines one it marks unaccepted, and fails on one it saved nothing for", async () => {
  const story = new MemoryFiles("https://vocabulary.example/");
  const peanut = bytes(
    '{"resourceType": "AllergyIntolerance", "id": "peanut"}',
  );
  const mango = bytes('{"resourceType": "AllergyIntolerance", "id": "mango"}');
  const kiwi = bytes('{"resourceType": "AllergyIntolerance", "id": "kiwi"}');
  await story.write(
    "s/export/clinical-records/AllergyIntolerance-peanut.json",
    peanut,
  );
  await story.write(
    "s/export/clinical-records/AllergyIntolerance-mango.json",
    mango,
  );
  await story.write(
    "s/export/clinical-records/AllergyIntolerance-kiwi.json",
    kiwi,
  );
  await story.write(
    "s/bridge/AllergyIntolerance-kiwi/unaccepted.txt",
    new Uint8Array(),
  );
  await story.write(
    "s/bridge/AllergyIntolerance-peanut/graph.ttl",
    bytes("<urn:record> a <urn:Allergy> ."),
  );
  await story.write(
    "s/bridge/AllergyIntolerance-peanut/findings.ttl",
    bytes("<urn:finding> a <urn:Finding> ."),
  );

  const bridge = await SavedOutputBridge.of(story, {
    export: "s/export",
    converted: "s/bridge",
  });
  const adapter = await bridge.load({
    iri: "https://adapter.example/tree/c/",
    files: new Map(),
  });
  const document = { iri: await documentName(peanut), bytes: peanut };
  assert.equal(await adapter.accepts(document), true);

  const { graph, findings } = await adapter.convert(document);
  const store = new OxigraphStore();
  await store.loadTurtle(graph, { graph: "urn:graph" });
  await store.loadTurtle(findings, { graph: "urn:findings" });
  assert.equal(
    await store.ask(
      "ASK { GRAPH <urn:graph> { <urn:record> a <urn:Allergy> } }",
      new Set(),
    ),
    true,
  );
  assert.equal(
    await store.ask(
      "ASK { GRAPH <urn:findings> { <urn:finding> a <urn:Finding> } }",
      new Set(),
    ),
    true,
  );

  const downloaded = await (
    await SavedOutputBridge.of(story, {
      export: "s/export/clinical-records/AllergyIntolerance-peanut.json",
      converted: "s/bridge",
    })
  ).load({ iri: "https://adapter.example/tree/c/", files: new Map() });
  assert.deepEqual((await downloaded.convert(document)).graph, graph);

  assert.equal(
    await adapter.accepts({ iri: await documentName(kiwi), bytes: kiwi }),
    false,
  );
  const unsaved = { iri: await documentName(mango), bytes: mango };
  assert.equal(await adapter.accepts(unsaved), true);
  await assert.rejects(
    adapter.convert(unsaved),
    (error) => isBridgeError(error) && error.kind === "bridge",
  );
});
