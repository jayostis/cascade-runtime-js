import assert from "node:assert/strict";
import { test } from "node:test";
import { runConformance } from "../src/conformance.js";
import { MemoryFiles } from "../src/files.js";
import { KIT_CHECKS, podAddressesIn } from "../src/kit.js";
import { iri, relativeTurtle } from "../src/rdf.js";
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

test("check 6 finds each IRI a view's bytes write that begins with the pod's address, a prefix's among them, and none a relative reference or another name gives", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  assert.deepEqual(
    podAddressesIn(
      bytes(`<> a <urn:example:View> .
<#ab> <urn:example:p> <urn:uuid:7c2d9e41-5a8b-4f36-b0e2-9d1a4c6f8e53> .`),
      "https://pod.example/",
    ),
    [],
  );
  assert.deepEqual(
    podAddressesIn(
      bytes(`@prefix pod: <https://pod.example/clinical/> .
<https://pod.example/clinical/allergies.ttl#ab> <urn:example:p> pod:x .`),
      "https://pod.example/",
    ),
    [
      "https://pod.example/clinical/",
      "https://pod.example/clinical/allergies.ttl#ab",
    ],
  );
});

test("a view written relative to itself writes an entry of another view in its folder as a relative reference, and holds no pod address", () => {
  const view = "https://pod.example/clinical/variant-interpretations.ttl";
  const bytes = relativeTurtle(
    [
      [
        iri(`${view}#ab`),
        iri("https://ns.cascadeprotocol.org/cascade#variantInterpreted"),
        iri("https://pod.example/clinical/variants.ttl#cd"),
      ],
      [iri(view), iri("urn:example:p"), iri("https://other.example/x")],
    ],
    view,
  );
  assert.deepEqual(podAddressesIn(bytes, "https://pod.example/"), []);
  assert.match(
    new TextDecoder().decode(bytes),
    /^<#ab> \S+ <variants\.ttl#cd> \.$/m,
  );
});
