import assert from "node:assert/strict";
import { test } from "node:test";
import { CorePod, type Head } from "../src/core-pod.js";
import { type Files, MemoryFiles } from "../src/files.js";
import { Graph } from "../src/graph.js";
import { randomId } from "../src/ids.js";
import { snapshotsFollowTheirRule } from "../src/kit.js";
import type { Layout } from "../src/layout.js";
import { fileDigest, setHash } from "../src/names.js";
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

async function copied(
  pod: Files,
  changes: Record<string, Uint8Array | undefined> = {},
): Promise<MemoryFiles> {
  const copy = new MemoryFiles(pod.iri);
  const paths = new Set([...(await pod.list("")), ...Object.keys(changes)]);
  for (const path of paths) {
    const bytes = path in changes ? changes[path] : await pod.read(path);
    if (bytes !== undefined) await copy.write(path, bytes);
  }
  return copy;
}

/** The snapshot an act's file holds: its IRI and the values of each of its properties, by local name. */
async function snapshotIn(
  pod: Files,
  path: string,
): Promise<{ name: string; values: (local: string) => string[] }> {
  const bytes = await pod.read(path);
  assert.ok(bytes !== undefined, path);
  const graph = new Graph(await newStore().parse(bytes, pod.iri + path));
  const [snapshot] = graph.subjects(`${RDF}type`, iri(`${CASCADE}Snapshot`));
  assert.ok(snapshot !== undefined, `${path} holds a snapshot`);
  return {
    name: snapshot.value,
    values: (local) =>
      graph.objects(snapshot, `${CASCADE}${local}`).map(({ value }) => value),
  };
}

/** The set hash of every file of the set the pod holds but the one left out. */
async function setHashOf(
  pod: Files,
  layout: Layout,
  leaving: string,
): Promise<string> {
  const files: [string, Uint8Array][] = [];
  for (const path of await pod.list(""))
    if (path !== leaving && layout.inSnapshotSet(path)) {
      const bytes = await pod.read(path);
      assert.ok(bytes !== undefined);
      files.push([path, await fileDigest(bytes)]);
    }
  return setHash(files);
}

test("each act's file is the last its step writes and holds a snapshot its rule names, chained to the one before; a pod with a file of the set removed or changed fails the check", async () => {
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
  const failing =
    "N14: the last snapshot's set hash is not the set hash of the files the pod lists of its set";
  assert.deepEqual(
    await snapshotsFollowTheirRule(
      { ...story, pod: await copied(story.pod, { [record]: undefined }) },
      local.layout,
      newStore,
    ),
    [
      failing,
      `N14: ${record}, of the set the snapshots hash, is missing from the pod`,
    ],
  );
  const changed = await snapshotsFollowTheirRule(
    {
      ...story,
      pod: await copied(story.pod, {
        [record]: new TextEncoder().encode("# changed\n"),
      }),
    },
    local.layout,
    newStore,
  );
  assert.ok(changed.includes(failing), changed.join("\n"));
});

test("a writer handed no head the pod holds is a new writer, whose snapshot merges the pod's heads; handed its last, its next session chains to it with no merge", async () => {
  const { local, replayed: story } = await replayed;
  const pod = await copied(story.pod, {
    ".DS_Store": new Uint8Array([0]),
    "records/allergies/.acl": new TextEncoder().encode("# acl\n"),
  });
  const replayHead = await snapshotIn(
    pod,
    story.steps.at(-1)?.wrote.at(-1) ?? "",
  );
  const files = await vocabulary();
  const session = async (entry: string, head: Head | undefined) => {
    const path = `runtime/scripted-input/cleo/entries/${entry}.ttl`;
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
      ...(head === undefined ? {} : { head }),
    });
    const { wrote } = await writer.enter({
      bytes,
      base: files.iri + path,
      name: path,
    });
    const actFile = wrote.at(-1) ?? "";
    const snapshot = await snapshotIn(pod, actFile);
    assert.equal(writer.head?.snapshot, snapshot.name);
    assert.deepEqual(snapshot.values("setHash"), [
      await setHashOf(pod, local.layout, actFile),
    ]);
    assert.deepEqual(
      snapshot.values("fileAddedToSet").sort(),
      wrote.filter((file) => local.layout.inSnapshotSet(file)).sort(),
    );
    return { snapshot, head: writer.head };
  };
  const first = await session("second-entry", {
    snapshot: "urn:uuid:00000000-0000-8000-8000-000000000000",
    setHash: "0".repeat(64),
  });
  assert.deepEqual(first.snapshot.values("firstParentSnapshot"), []);
  assert.deepEqual(first.snapshot.values("mergedParentSnapshot"), [
    replayHead.name,
  ]);
  const next = await session("third-entry", first.head);
  assert.deepEqual(next.snapshot.values("firstParentSnapshot"), [
    first.snapshot.name,
  ]);
  assert.deepEqual(next.snapshot.values("mergedParentSnapshot"), []);
});

test("an open that migrates a release leaves two acts in one step, each with its own snapshot naming its own files, the run's chained to the migration's (N14, N15)", async () => {
  const local = await localVocabulary(ROOT);
  const story = await featurePod(
    local,
    "runtime/naming.feature",
    new MemoryFiles(ADDRESS),
    {
      example:
        "adopting a release that declares R4 wrong retracts R4's two claims before the open's matcher runs, and neither counts nor lapses",
    },
  );
  const opened = story.steps.at(-1);
  const snapshots = [];
  for (const path of opened?.wrote ?? [])
    if (path.startsWith("provenance/"))
      snapshots.push(await snapshotIn(story.pod, path));
  assert.equal(snapshots.length, 2);
  const [migration, run] = snapshots;
  assert.deepEqual(run?.values("firstParentSnapshot"), [migration?.name]);
  assert.ok(
    migration
      ?.values("fileAddedToSet")
      .some((path) => path.startsWith("judgments/retractions/")),
  );
  assert.deepEqual(
    await snapshotsFollowTheirRule(story, local.layout, newStore),
    [],
  );
});
