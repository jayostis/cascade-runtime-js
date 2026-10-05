import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFiles } from "../src/files.js";
import { parseGraph } from "../src/graph.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, literal, written } from "../src/rdf.js";
import { replay } from "../src/replay.js";
import { parseStory } from "../src/story.js";
import { layout } from "./vocabulary.js";

const PROV = "http://www.w3.org/ns/prov#";
const SERIES = "urn:uuid:2e8a6d14-7b9c-4f3e-9a52-6c1d8f4b7e30";
const FIRST = "urn:uuid:5d3b9f27-1c6e-4a8d-b4f9-8e2a7c5d1f63";
const SECOND = "urn:uuid:8f6c2a49-3d7b-4e1f-a5c8-1b9e4d7a2c86";

test("a reference version's arrival files its description, revising the version it names, by its own name", async () => {
  const source = new MemoryFiles("https://vocabulary.example/");
  await source.write(
    "story/scripted-input/references/references.json",
    new TextEncoder().encode(
      JSON.stringify({
        series: [
          {
            key: "map",
            name: SERIES,
            label: "A map",
            ships_with: "1",
            versions: [
              { name: FIRST, version: "1", table: "map-1.csv" },
              { name: SECOND, version: "2", revises: "1", table: "map-2.csv" },
            ],
          },
        ],
      }),
    ),
  );
  const story = parseStory(
    JSON.stringify({
      address: "https://pod.example/",
      subject: "urn:uuid:7c2d9e41-5a8b-4f36-b0e2-9d1a4c6f8e53",
      steps: [
        { name: "new-map", when: "2026-04-03T09:00:00Z", reference: SECOND },
      ],
    }),
  );
  const newStore = (): OxigraphStore => new OxigraphStore();
  const { steps, pod } = await replay({
    story,
    source,
    folder: "story",
    pod: new MemoryFiles(story.address),
    layout: await layout(),
    newStore,
  });

  const path = "references/8f/8f6c2a49-3d7b-4e1f-a5c8-1b9e4d7a2c86.ttl";
  assert.deepEqual(steps[0]?.wrote, [path]);
  const graph = await parseGraph(
    (await pod.read(path)) ?? new Uint8Array(),
    story.address + path,
    newStore,
  );
  assert.deepEqual(
    graph.triples.map((triple) => triple.map(written).join(" ")).sort(),
    [
      [
        iri(`http://www.w3.org/1999/02/22-rdf-syntax-ns#type`),
        iri(`${PROV}Entity`),
      ],
      [iri(`${PROV}specializationOf`), iri(SERIES)],
      [iri(`${PROV}wasRevisionOf`), iri(FIRST)],
      [iri("http://purl.org/pav/version"), literal("2")],
    ]
      .map(([p, o]) => [iri(SECOND), p, o].map((t) => written(t!)).join(" "))
      .sort(),
  );
});
