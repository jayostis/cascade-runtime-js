import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFiles } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, literal, RDF } from "../src/rdf.js";
import { fileCreation, replay } from "../src/replay.js";
import { Refusal } from "../src/step.js";
import { parseStory } from "../src/story.js";

test("a refused step writes nothing and the replay goes on; a step it cannot perform stops it, naming the kind", async () => {
  const story = parseStory(
    JSON.stringify({
      address: "https://pod.example/",
      subject: "urn:uuid:7c2d9e41-5a8b-4f36-b0e2-9d1a4c6f8e53",
      steps: [
        { name: "create", when: "2026-02-01T08:00:00Z", creation: {} },
        { name: "refused", when: "2026-02-01T08:30:00Z", entry: "entry.ttl" },
        {
          name: "export",
          when: "2026-02-02T08:00:00Z",
          import: { export: "e", converted: "c" },
        },
      ],
    }),
  );
  const pod = new MemoryFiles(story.address);
  const replayed = await replay({
    story,
    source: new MemoryFiles("https://vocabulary.example/"),
    folder: "",
    pod,
    newStore: () => new OxigraphStore(),
    performers: {
      creation: fileCreation,
      entry: ({ writes }) => {
        writes.add("records/half-written.ttl", new Uint8Array([1]));
        return Promise.reject(new Refusal("an entry holding two activities"));
      },
    },
  });

  assert.deepEqual(
    replayed.steps.map(({ step, wrote, refused }) => [
      step.name,
      wrote.length,
      refused,
    ]),
    [
      ["create", 2, undefined],
      ["refused", 0, "an entry holding two activities"],
    ],
  );
  assert.deepEqual(
    await pod.list(""),
    [...(replayed.steps[0]?.wrote ?? [])].sort(),
  );
  assert.equal(replayed.stopped?.step.name, "export");
  assert.match(replayed.stopped?.why ?? "", /kind import/);
});

test("with a build, the files it writes are rebuilt after every step, and no step lists them as written", async () => {
  const story = parseStory(
    JSON.stringify({
      address: "https://pod.example/",
      subject: "urn:uuid:7c2d9e41-5a8b-4f36-b0e2-9d1a4c6f8e53",
      steps: [
        { name: "create", when: "2026-02-01T08:00:00Z", creation: {} },
        { name: "later", when: "2026-02-02T08:00:00Z", creation: {} },
      ],
    }),
  );
  const pod = new MemoryFiles(story.address);
  const seen: string[] = [];
  const replayed = await replay({
    story,
    source: new MemoryFiles("https://vocabulary.example/"),
    folder: "",
    pod,
    newStore: () => new OxigraphStore(),
    build: {
      lens: "everyday",
      derive: (_store, lens, { at, files }) => {
        seen.push(`${lens} ${at} ${files.length}`);
        return Promise.resolve(
          new Map([
            [
              "clinical/built.ttl",
              [[iri(story.address), iri(`${RDF}value`), literal(at)]] as const,
            ],
          ]),
        );
      },
    },
  });

  assert.deepEqual(seen, [
    "everyday 2026-02-01T08:00:00Z 2",
    "everyday 2026-02-02T08:00:00Z 2",
  ]);
  assert.ok(
    !replayed.steps.some(({ wrote }) => wrote.includes("clinical/built.ttl")),
  );
  assert.match(
    new TextDecoder().decode(await pod.read("clinical/built.ttl")),
    /"2026-02-02T08:00:00Z"/,
  );
});
