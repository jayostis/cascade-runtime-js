import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  type BridgeDocument,
  isBridgeError,
  type LoadedAdapter,
} from "../src/bridge.js";
import { MemoryFiles } from "../src/files.js";
import { documentName } from "../src/names.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { SavedOutputBridge } from "../src/saved-output-bridge.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const ADAPTER = { iri: "https://adapter.example/tree/c/", files: new Map() };
const PEANUT = "s/export/clinical-records/AllergyIntolerance-peanut.json";

/** A document of the story's export, named as a runtime names it. */
async function documentOf(text: string): Promise<BridgeDocument> {
  const content = bytes(text);
  return { iri: await documentName(content), bytes: content };
}

/**
 * A kit saves, beside each export, the graph and conversion findings the Bridge made of each document.
 * `SavedOutputBridge` answers a conversion from those files, so a story replays where no Bridge can run, and what the
 * kit saved stays the expected output every runtime is held to.
 */
describe("Converting from a kit's saved output · SavedOutputBridge.of()", () => {
  const peanut = '{"resourceType": "AllergyIntolerance", "id": "peanut"}';
  const mango = '{"resourceType": "AllergyIntolerance", "id": "mango"}';
  const kiwi = '{"resourceType": "AllergyIntolerance", "id": "kiwi"}';
  const graph = bytes("<urn:record> a <urn:Allergy> .");
  const story = new MemoryFiles("https://vocabulary.example/");

  before(async () => {
    for (const [name, text] of [
      ["peanut", peanut],
      ["mango", mango],
      ["kiwi", kiwi],
    ] as const)
      await story.write(
        `s/export/clinical-records/AllergyIntolerance-${name}.json`,
        bytes(text),
      );
    await story.write(
      "s/bridge/AllergyIntolerance-kiwi/unaccepted.txt",
      new Uint8Array(),
    );
    await story.write("s/bridge/AllergyIntolerance-peanut/graph.ttl", graph);
    await story.write(
      "s/bridge/AllergyIntolerance-peanut/findings.ttl",
      bytes("<urn:finding> a <urn:Finding> ."),
    );
  });

  describe("given a step whose export is a folder of documents", () => {
    let adapter: LoadedAdapter;

    before(async () => {
      adapter = await (
        await SavedOutputBridge.of(story, {
          export: "s/export",
          converted: "s/bridge",
        })
      ).load(ADAPTER);
    });

    it("accepts a document the step saved output for", async () => {
      assert.equal(await adapter.accepts(await documentOf(peanut)), true);
    });

    it("converts it to the graph and the conversion findings saved under its file's name", async () => {
      const converted = await adapter.convert(await documentOf(peanut));
      const store = new OxigraphStore();
      await store.loadTurtle(converted.graph, { graph: "urn:graph" });
      await store.loadTurtle(converted.findings, { graph: "urn:findings" });
      assert.equal(
        await store.ask(
          "ASK { GRAPH <urn:graph> { <urn:record> a <urn:Allergy> } }",
          new Set(),
        ),
        true,
        "the graph",
      );
      assert.equal(
        await store.ask(
          "ASK { GRAPH <urn:findings> { <urn:finding> a <urn:Finding> } }",
          new Set(),
        ),
        true,
        "the conversion findings",
      );
    });

    it("declines a document the step marks with `unaccepted.txt`", async () => {
      assert.equal(await adapter.accepts(await documentOf(kiwi)), false);
    });

    it("accepts a document the step saved nothing for", async () => {
      assert.equal(await adapter.accepts(await documentOf(mango)), true);
    });

    it("rejects the conversion of that document with a BridgeError of kind `bridge`", async () => {
      await assert.rejects(
        adapter.convert(await documentOf(mango)),
        (error) => isBridgeError(error) && error.kind === "bridge",
      );
    });
  });

  describe("given a step whose export is one document", () => {
    it("converts the document to the graph saved under its file's name", async () => {
      const adapter = await (
        await SavedOutputBridge.of(story, {
          export: PEANUT,
          converted: "s/bridge",
        })
      ).load(ADAPTER);
      assert.deepEqual(
        (await adapter.convert(await documentOf(peanut))).graph,
        graph,
      );
    });
  });
});
