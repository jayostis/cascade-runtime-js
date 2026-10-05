import assert from "node:assert/strict";
import { test } from "node:test";
import { readText, relative } from "../src/files.js";
import { MF, readManifest, REPLAY_TEST } from "../src/manifest.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { parseStory } from "../src/story.js";
import { vocabulary } from "./vocabulary.js";

const MANIFEST = "runtime/vectors/manifest.ttl";

test("the manifest reader finds every rule vector, with its story, a step of it, its lens, query and result", async () => {
  const files = await vocabulary();
  const entries = await readManifest(
    files,
    MANIFEST,
    () => new OxigraphStore(),
  );

  const store = new OxigraphStore();
  await store.loadTurtle(await readText(files, MANIFEST), {
    graph: files.iri + MANIFEST,
  });
  const { rows } = await store.select(
    `SELECT (COUNT(DISTINCT ?entry) AS ?n) WHERE { ?entry <${MF}action> ?action }`,
  );
  assert.equal(entries.length, Number(rows[0]?.get("n")?.value));
  assert.equal(new Set(entries.map((entry) => entry.iri)).size, entries.length);

  for (const entry of entries) {
    assert.ok(entry.types.includes(REPLAY_TEST), entry.name);
    for (const file of [entry.story, entry.lens, entry.query, entry.result]) {
      assert.ok(
        file !== undefined &&
          (await files.read(relative(files, file))) !== undefined,
        `${entry.name}: ${file}`,
      );
    }
    const story = parseStory(
      await readText(files, relative(files, entry.story ?? "")),
    );
    assert.ok(
      story.steps.some((step) => step.name === entry.step),
      `${entry.name}: ${entry.step}`,
    );
  }
});
