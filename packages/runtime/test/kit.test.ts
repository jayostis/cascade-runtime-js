import assert from "node:assert/strict";
import { test } from "node:test";
import { runConformance } from "../src/conformance.js";
import { MemoryFiles } from "../src/files.js";
import { KIT_CHECKS } from "../src/kit.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { Shapes } from "../src/shapes.js";
import { layout } from "./vocabulary.js";

test("a kit whose story has a step the runtime cannot perform reports its checks failed, naming the step's kind, not thrown", async () => {
  const vocabulary = new MemoryFiles("https://vocabulary.example/");
  const write = (path: string, text: string) =>
    vocabulary.write(path, new TextEncoder().encode(text));
  await write(
    "conformance/broken/scripted-input/people.ttl",
    `<urn:uuid:7c2d9e41-5a8b-4f36-b0e2-9d1a4c6f8e53> <http://xmlns.com/foaf/0.1/name> "Ben" ;
       <http://www.w3.org/ns/pim/space#storage> <https://pod.example/> .`,
  );
  await write(
    "conformance/broken/broken.feature",
    `Feature: Broken
  Background: Ben's story
    Given a new pod for Ben on 2026-02-01 at 08:00
`,
  );
  const newStore = () => new OxigraphStore();
  const assertions = await runConformance({
    vocabulary,
    newStore,
    newPod: (address: string) => new MemoryFiles(address),
    layout: await layout(),
    performers: {},
    shapes: await Shapes.read(vocabulary, newStore),
  });

  assert.deepEqual(
    assertions.map(({ name, outcome }) => [name, outcome]),
    Object.values(KIT_CHECKS).map((check) => [check, "failed"]),
  );
  for (const { name, why } of assertions)
    assert.match(why ?? "", /kind creation/, name);
});
