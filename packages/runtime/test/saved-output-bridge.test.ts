import assert from "node:assert/strict";
import { test } from "node:test";
import { isBridgeError } from "../src/bridge.js";
import { MemoryFiles } from "../src/files.js";
import { documentName } from "../src/names.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { SavedOutputBridge } from "../src/saved-output-bridge.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

test("the saved-output Bridge answers a conversion from what the step saved, and refuses one it saved nothing for", async () => {
  const story = new MemoryFiles("https://vocabulary.example/");
  const peanut = bytes(
    '{"resourceType": "AllergyIntolerance", "id": "peanut"}',
  );
  const mango = bytes('{"resourceType": "AllergyIntolerance", "id": "mango"}');
  await story.write(
    "s/export/clinical-records/AllergyIntolerance-peanut.json",
    peanut,
  );
  await story.write(
    "s/export/clinical-records/AllergyIntolerance-mango.json",
    mango,
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
    ),
    true,
  );
  assert.equal(
    await store.ask(
      "ASK { GRAPH <urn:findings> { <urn:finding> a <urn:Finding> } }",
    ),
    true,
  );

  await assert.rejects(
    adapter.convert({ iri: await documentName(mango), bytes: mango }),
    (error) => isBridgeError(error) && error.kind === "document",
  );
});
