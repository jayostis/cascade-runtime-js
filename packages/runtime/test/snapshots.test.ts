import assert from "node:assert/strict";
import { test } from "node:test";
import { CorePod, type Head } from "../src/core-pod.js";
import { type Files, MemoryFiles } from "../src/files.js";
import { Graph } from "../src/graph.js";
import { randomId } from "../src/ids.js";
import { HashedSet } from "../src/kept-set.js";
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

/** Cleo's writer over the pod, handed the head, its time fixed. */
async function cleosWriter(pod: Files, head: Head | undefined) {
  const { local, replayed: story } = await replayed;
  return new CorePod({
    runtime: RUNTIME,
    pod,
    address: ADDRESS,
    subject: story.story.subject,
    title: "",
    vocabulary: await vocabulary(),
    layout: local.layout,
    newStore,
    time: { newId: randomId, now: () => "2026-03-04T08:00:00Z" },
    importers: [],
    references: () => Promise.reject(new Error("no tables")),
    ...(head === undefined ? {} : { head }),
  });
}

/** A writer that, from the replay's last snapshot, entered Cleo's entry. */
async function entered(entry: string): Promise<CorePod> {
  const { replayed: story } = await replayed;
  const last = await snapshotIn(
    story.pod,
    story.steps.at(-1)?.wrote.at(-1) ?? "",
  );
  const writer = await cleosWriter(await copied(story.pod), {
    snapshot: last.name,
    setHash: last.values("setHash")[0] ?? "",
  });
  const files = await vocabulary();
  const path = `runtime/scripted-input/cleo/entries/${entry}.ttl`;
  const bytes = await files.read(path);
  assert.ok(bytes !== undefined);
  await writer.enter({ bytes, base: files.iri + path, name: path });
  return writer;
}

/** The pod's heads: the snapshots its act files hold that none of them names as a parent. */
async function headsIn(pod: Files): Promise<string[]> {
  const snapshots = new Set<string>();
  const parents = new Set<string>();
  for (const path of await pod.list("provenance/")) {
    const bytes = await pod.read(path);
    assert.ok(bytes !== undefined);
    const graph = new Graph(await newStore().parse(bytes, pod.iri + path));
    for (const snapshot of graph.subjects(
      `${RDF}type`,
      iri(`${CASCADE}Snapshot`),
    )) {
      snapshots.add(snapshot.value);
      for (const local of ["firstParentSnapshot", "mergedParentSnapshot"])
        for (const { value } of graph.objects(snapshot, `${CASCADE}${local}`))
          parents.add(value);
    }
  }
  return [...snapshots].filter((snapshot) => !parents.has(snapshot)).sort();
}

/** The one sync the pod's syncs' folder holds: the acts it names, and its snapshot's merged parents and set hash. */
async function theSync(pod: Files, layout: Layout) {
  const paths = await pod.list(layout.syncsFolder ?? "");
  assert.equal(paths.length, 1, paths.join(", "));
  const path = paths[0] ?? "";
  const bytes = await pod.read(path);
  assert.ok(bytes !== undefined);
  const graph = new Graph(await newStore().parse(bytes, pod.iri + path));
  const snapshot = await snapshotIn(pod, path);
  return {
    named: graph
      .match(undefined, `http://www.w3.org/ns/prov#wasInformedBy`, undefined)
      .map(([, , act]) => act.value)
      .sort(),
    merged: snapshot.values("mergedParentSnapshot").sort(),
    setHash: snapshot.values("setHash"),
  };
}

/** The pod's files, its writes stopping with an error at the one numbered `stopAt`, counting from 0, once. */
class StopsAtOneWrite implements Files {
  writes = 0;
  readonly reads = new Set<string>();
  constructor(
    readonly inner: Files,
    public stopAt: number,
  ) {}

  get iri(): string {
    return this.inner.iri;
  }

  read(pathOrIri: string): Promise<Uint8Array | undefined> {
    this.reads.add(pathOrIri);
    return this.inner.read(pathOrIri);
  }

  list(folder: string): Promise<string[]> {
    return this.inner.list(folder);
  }

  async write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    if (this.writes++ === this.stopAt) throw new Error("the write stopped");
    await this.inner.write(pathOrIri, bytes);
  }
}

test("a receive that stops at any of its writes and is made again writes the sync an unstopped one writes, naming the same acts", async () => {
  const { local, replayed: story } = await replayed;
  const last = await snapshotIn(
    story.pod,
    story.steps.at(-1)?.wrote.at(-1) ?? "",
  );
  const head = {
    snapshot: last.name,
    setHash: last.values("setHash")[0] ?? "",
  };
  const other = await entered("second-entry");
  const unstopped = new StopsAtOneWrite(await copied(story.pod), -1);
  await (await cleosWriter(unstopped, head)).receive(other.files);
  const expected = await theSync(unstopped, local.layout);
  assert.ok(unstopped.writes > 2, String(unstopped.writes));
  for (let stopAt = 0; stopAt < unstopped.writes; stopAt++) {
    const pod = new StopsAtOneWrite(await copied(story.pod), stopAt);
    const writer = await cleosWriter(pod, head);
    await assert.rejects(writer.receive(other.files), /the write stopped/);
    await writer.receive(other.files);
    assert.deepEqual(
      await theSync(pod, local.layout),
      expected,
      `stopped at write ${stopAt}`,
    );
  }
});

test("three writers, one receiving the others' files in either order, hold one set hash and leave no head but their own", async () => {
  const { local, replayed: story } = await replayed;
  const last = await snapshotIn(
    story.pod,
    story.steps.at(-1)?.wrote.at(-1) ?? "",
  );
  const head = {
    snapshot: last.name,
    setHash: last.values("setHash")[0] ?? "",
  };
  const [second, third] = [
    await entered("second-entry"),
    await entered("third-entry"),
  ];
  const receiving = async (order: CorePod[]) => {
    const writer = await cleosWriter(await copied(story.pod), head);
    for (const from of order) await writer.receive(from.files);
    assert.deepEqual(await headsIn(writer.files), [writer.head?.snapshot]);
    assert.equal(
      writer.head?.setHash,
      await setHashOf(writer.files, local.layout, ""),
    );
    return writer.head?.setHash;
  };
  assert.equal(
    await receiving([second, third]),
    await receiving([third, second]),
  );
});

test("an open that migrates a release leaves two acts in one step, each with its own snapshot naming its own files, the run's chained to the migration's (N14, N15)", async () => {
  const local = await localVocabulary(ROOT);
  const story = await featurePod(
    local,
    "runtime/naming.feature",
    new MemoryFiles(ADDRESS),
    {
      example:
        "adopting a release that declares R4 wrong retracts the assertions of R4's two claims before the open's matcher runs, and neither claim counts nor lapses",
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

test("a set hash multiplied in a few files at a time, in any order, and kept between sessions is the whole set's; a kept set whose files the pod no longer lists is not taken", async () => {
  const files = new Map<string, Uint8Array>();
  for (let index = 0; index < 60; index++)
    files.set(
      `records/${randomId()}.ttl`,
      globalThis.crypto.getRandomValues(new Uint8Array(32)),
    );
  const whole = await setHash(files);
  for (let round = 0; round < 5; round++) {
    const order = [...files].sort(() => Math.random() - 0.5);
    const cut = 1 + Math.floor(Math.random() * 20);
    const hashed = await HashedSet.of(new Map(order.slice(0, cut)));
    for (let at = cut; at < order.length; at += 7) {
      const paths = new Set(order.slice(0, at + 7).map(([path]) => path));
      const missing = hashed.missing(paths, () => true) ?? [];
      await hashed.add(
        missing.map((path) => [path, files.get(path) ?? new Uint8Array()]),
      );
    }
    assert.equal(await hashed.setHash(), whole);
    const paths = new Set(files.keys());
    const reopened = await HashedSet.kept(await hashed.kept(), paths);
    assert.equal(await reopened?.setHash(), whole);
    const [first = ""] = paths;
    const swapped = new Set([...paths].filter((path) => path !== first));
    swapped.add(`records/${randomId()}.ttl`);
    assert.equal(await HashedSet.kept(await hashed.kept(), swapped), undefined);
    assert.equal(
      hashed.missing(swapped, () => true),
      undefined,
    );
  }
});

/** The replay's last snapshot, as the head its writer kept, with no set. */
async function replayHead(): Promise<Head> {
  const { replayed: story } = await replayed;
  const last = await snapshotIn(
    story.pod,
    story.steps.at(-1)?.wrote.at(-1) ?? "",
  );
  return { snapshot: last.name, setHash: last.values("setHash")[0] ?? "" };
}

/** Cleo's entry, entered by the writer; the act's file is the last it wrote. */
async function enterInto(writer: CorePod, entry: string): Promise<string> {
  const files = await vocabulary();
  const path = `runtime/scripted-input/cleo/entries/${entry}.ttl`;
  const bytes = await files.read(path);
  assert.ok(bytes !== undefined);
  const { wrote, refused } = await writer.enter({
    bytes,
    base: files.iri + path,
    name: path,
  });
  assert.equal(refused, undefined);
  return wrote.at(-1) ?? "";
}

test("a writer reopened with the head it kept reads no file of the set it kept, and its set hash is the whole set's; handed the head without the set, it reads them", async () => {
  const { local, replayed: story } = await replayed;
  const pod = new StopsAtOneWrite(await copied(story.pod), -1);
  const first = await cleosWriter(pod, await replayHead());
  await enterInto(first, "second-entry");
  const kept = first.head;
  assert.ok(kept?.set !== undefined);
  const untouched = await pod.list("attachments/");
  assert.ok(untouched.length > 0);
  const control = new StopsAtOneWrite(await copied(pod), -1);
  pod.reads.clear();
  const actFile = await enterInto(await cleosWriter(pod, kept), "third-entry");
  assert.deepEqual(
    untouched.filter((path) => pod.reads.has(path)),
    [],
  );
  assert.deepEqual((await snapshotIn(pod, actFile)).values("setHash"), [
    await setHashOf(pod, local.layout, actFile),
  ]);
  const { snapshot, setHash: hash } = kept;
  await enterInto(
    await cleosWriter(control, { snapshot, setHash: hash }),
    "third-entry",
  );
  assert.ok(untouched.every((path) => control.reads.has(path)));
});

test("a step that fails after hashing the set leaves the next act's set hash the whole set's", async () => {
  const { local, replayed: story } = await replayed;
  const pod = new StopsAtOneWrite(await copied(story.pod), -1);
  const writer = await cleosWriter(pod, await replayHead());
  await enterInto(writer, "second-entry");
  pod.stopAt = pod.writes + 1;
  await assert.rejects(enterInto(writer, "third-entry"), /the write stopped/);
  const actFile = await enterInto(writer, "third-entry");
  assert.deepEqual((await snapshotIn(pod, actFile)).values("setHash"), [
    await setHashOf(pod, local.layout, actFile),
  ]);
});
