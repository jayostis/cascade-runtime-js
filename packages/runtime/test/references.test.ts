import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFiles } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { References } from "../src/references.js";
import { Refusal, type StepContext } from "../src/step.js";

test("a version whose name names no file refuses the step rather than aborting the replay", async () => {
  const source = new MemoryFiles("https://story.example/");
  await source.write(
    "scripted-input/references/references.ttl",
    new TextEncoder().encode(""),
  );
  const references = await References.of({
    source,
    folder: "",
    newStore: () => new OxigraphStore(),
  } as unknown as StepContext);
  for (const version of [
    "https://example.org/tables/v2",
    "ni:///sha-256;not*base64",
  ]) {
    await assert.rejects(references.rows(version), Refusal, version);
  }
});
