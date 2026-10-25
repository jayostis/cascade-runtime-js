import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFiles } from "../src/files.js";
import { Graph } from "../src/graph.js";
import { localVocabulary } from "../src/node/runtime.js";
import { featurePod } from "../src/node/story-pod.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, RDF } from "../src/rdf.js";
import { ROOT } from "./vocabulary.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const ADDRESS = "https://pod.example/";

/** Each kit's story, by the path of its feature file. */
async function kits(): Promise<string[]> {
  const local = await localVocabulary(ROOT);
  return (await local.files.list("conformance/"))
    .filter((path) => /^conformance\/[^/]+\/[^/]+\.feature$/.test(path))
    .sort();
}

test("after every step of every kit, the build kept across steps holds what a build of the whole pod holds (C8)", async () => {
  const local = await localVocabulary(ROOT);
  const stories = await kits();
  assert.ok(stories.length > 0);
  for (const story of stories) {
    const replayed = await featurePod(local, story, new MemoryFiles(ADDRESS), {
      verify: true,
    });
    assert.equal(replayed.stopped, undefined, story);
  }
});

test("the manifest's build used the writer's last snapshot, so a view is stale when the writer's is another (C8)", async () => {
  const local = await localVocabulary(ROOT);
  const [story = ""] = await kits();
  const replayed = await featurePod(local, story, new MemoryFiles(ADDRESS));
  const store = new OxigraphStore();
  const read = async (path: string) => {
    const bytes = await replayed.pod.read(path);
    assert.ok(bytes !== undefined, path);
    return new Graph(await store.parse(bytes, replayed.story.address + path));
  };
  const acts = replayed.steps.flatMap(({ wrote }) =>
    wrote.filter((path) => replayed.layout.inActFolder(path)),
  );
  const last = await read(acts.at(-1) ?? "");
  const [snapshot] = last.subjects(`${RDF}type`, iri(`${CASCADE}Snapshot`));
  const manifest = await read(replayed.layout.manifest);
  const [build] = manifest.objects(
    iri(`${replayed.story.address}${replayed.layout.manifest}#manifest`),
    `${PROV}wasGeneratedBy`,
  );
  assert.ok(snapshot !== undefined && build !== undefined);
  assert.deepEqual(
    manifest.objects(build, `${PROV}used`).map(({ value }) => value),
    [snapshot.value],
  );
});
