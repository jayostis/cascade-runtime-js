import assert from "node:assert/strict";
import { test } from "node:test";
import { Replays } from "../src/conformance.js";
import { MemoryFiles } from "../src/files.js";
import { KIT_CHECKS, runKit } from "../src/kit.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { Shapes } from "../src/shapes.js";
import { layout } from "./vocabulary.js";

test("a kit with no cases and a step the runtime cannot perform is reported failed, naming the step's kind, not thrown", async () => {
  const vocabulary = new MemoryFiles("https://vocabulary.example/");
  await vocabulary.write(
    "conformance/broken/story.json",
    new TextEncoder().encode(
      JSON.stringify({
        address: "https://pod.example/",
        subject: "urn:uuid:7c2d9e41-5a8b-4f36-b0e2-9d1a4c6f8e53",
        steps: [{ name: "create", when: "2026-02-01T08:00:00Z", creation: {} }],
      }),
    ),
  );
  const newStore = () => new OxigraphStore();
  const options = {
    vocabulary,
    manifest: "conformance/broken/cases/manifest.ttl",
    newStore,
    newPod: (address: string) => new MemoryFiles(address),
    layout: await layout(),
    performers: {},
  };
  const assertions = await runKit(
    options,
    "conformance/broken",
    new Replays(options),
    await Shapes.read(vocabulary, newStore),
  );

  assert.deepEqual(
    assertions.map(({ entry, outcome }) => [entry.name, outcome]),
    [
      ["conformance/broken/cases/manifest.ttl", "failed"],
      ...Object.values(KIT_CHECKS).map((check) => [check, "failed"]),
    ],
  );
  for (const { entry, why } of assertions.slice(1))
    assert.match(why ?? "", /kind creation/, entry.name);
});
