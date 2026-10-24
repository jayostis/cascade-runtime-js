import assert from "node:assert/strict";
import { test } from "node:test";
import { CorePod } from "../src/core-pod.js";
import { type Files, MemoryFiles } from "../src/files.js";
import { Graph } from "../src/graph.js";
import { randomId } from "../src/ids.js";
import { snapshotsFollowTheirRule } from "../src/kit.js";
import { setHash } from "../src/names.js";
import { featurePod } from "../src/node/story-pod.js";
import { localVocabulary } from "../src/node/runtime.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, RDF } from "../src/rdf.js";
import { ROOT, RUNTIME, vocabulary } from "./vocabulary.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const ADDRESS = "https://pod.example/";
const newStore = () => new OxigraphStore();

/** Cleo's import, entry and matcher run, three acts in a row (naming.feature, N14). */
const replayed = localVocabulary(ROOT).then(async (local) => ({
  local,
  replayed: await featurePod(
    local,
    "runtime/naming.feature",
    new MemoryFiles(ADDRESS),
    {
      example:
        "a writer's first snapshot has no first parent, and each later act's names the one before it",
    },
  ),
}));

async function copied(pod: Files, leaving?: string): Promise<MemoryFiles> {
  const copy = new MemoryFiles(pod.iri);
  for (const path of await pod.list(""))
    if (path !== leaving) {
      const bytes = await pod.read(path);
      if (bytes !== undefined) await copy.write(path, bytes);
    }
  return copy;
}

async function snapshotIn(pod: Files, path: string): Promise<Graph> {
  const bytes = await pod.read(path);
  assert.ok(bytes !== undefined, path);
  return new Graph(await newStore().parse(bytes, pod.iri + path));
}

test("each act's file is the last its step writes, and holds a snapshot its rule names, chained to the one before; a pod missing a file of the set fails the check", async () => {
  const { local, replayed: story } = await replayed;
  const acts = story.steps.filter(({ activity }) => activity !== undefined);
  assert.equal(acts.length, 3);
  for (const { wrote } of acts)
    assert.match(wrote.at(-1) ?? "", /^provenance\//);
  assert.deepEqual(
    await snapshotsFollowTheirRule(story, local.layout, newStore),
    [],
  );
  const record = story.steps
    .flatMap(({ wrote }) => wrote)
    .find((path) => path.startsWith("records/"));
  assert.ok(record !== undefined);
  const failures = await snapshotsFollowTheirRule(
    { ...story, pod: await copied(story.pod, record) },
    local.layout,
    newStore,
  );
  assert.deepEqual(failures, [
    `N14: ${record}, of the set the snapshots hash, is missing from the pod`,
  ]);
});

test("a writer with no last snapshot is a new writer: its first snapshot has no first parent, merges every head the pod holds and hashes the whole set", async () => {
  const { local, replayed: story } = await replayed;
  const pod = await copied(story.pod);
  const last = await snapshotIn(pod, story.steps.at(-1)?.wrote.at(-1) ?? "");
  const [head] = last.subjects(`${RDF}type`, iri(`${CASCADE}Snapshot`));
  assert.ok(head !== undefined);
  const files = await vocabulary();
  const path = "runtime/scripted-input/cleo/entries/second-entry.ttl";
  const bytes = await files.read(path);
  assert.ok(bytes !== undefined);
  const writer = new CorePod({
    runtime: RUNTIME,
    pod,
    address: ADDRESS,
    subject: story.story.subject,
    title: "",
    vocabulary: files,
    layout: local.layout,
    newStore,
    time: { newId: randomId, now: () => "2026-03-04T08:00:00Z" },
    importers: [],
    references: () => Promise.reject(new Error("no tables")),
  });
  const headOf = (of: CorePod) => of.head;
  assert.equal(headOf(writer), undefined);
  const { wrote } = await writer.enter({
    bytes,
    base: files.iri + path,
    name: path,
  });
  const graph = await snapshotIn(pod, wrote.at(-1) ?? "");
  const [snapshot] = graph.subjects(`${RDF}type`, iri(`${CASCADE}Snapshot`));
  assert.ok(snapshot !== undefined);
  const values = (local: string): string[] =>
    graph.objects(snapshot, `${CASCADE}${local}`).map(({ value }) => value);
  assert.deepEqual(values("firstParentSnapshot"), []);
  assert.deepEqual(values("mergedParentSnapshot"), [head.value]);
  assert.deepEqual(values("setHash"), [
    await setHash(
      (await pod.list("")).filter((file) => local.layout.inSnapshotSet(file)),
    ),
  ]);
  assert.equal(headOf(writer)?.snapshot, snapshot.value);
});
