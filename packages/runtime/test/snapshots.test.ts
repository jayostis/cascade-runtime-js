import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { CorePod, type Head } from "../src/core-pod.js";
import { type Files, MemoryFiles } from "../src/files.js";
import { Graph } from "../src/graph.js";
import { randomId } from "../src/ids.js";
import { HashedSet } from "../src/kept-set.js";
import { snapshotFaults } from "../src/kit.js";
import type { Layout } from "../src/layout.js";
import { fileDigest, setHash } from "../src/names.js";
import { featurePod } from "../src/node/story-pod.js";
import { localVocabulary } from "../src/node/runtime.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, RDF } from "../src/rdf.js";
import { cleosReplay, copied } from "./cleo.js";
import { got, type Kept, kept } from "./kept.js";
import { random } from "./random.js";
import { ROOT, RUNTIME, vocabulary } from "./vocabulary.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const ADDRESS = "https://pod.example/";
const newStore = () => new OxigraphStore();

// The replay every group below reads is made once for the file, so no leaf is charged for it.
before(async () => {
  await cleosReplay();
});

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

/** The set hash of every file of the set the pod holds, and `alsoTaking` whatever the layout leaves out, but the one left out. */
async function setHashOf(
  pod: Files,
  layout: Layout,
  leaving: string,
  alsoTaking: readonly string[] = [],
): Promise<string> {
  const files: [string, Uint8Array][] = [];
  for (const path of await pod.list(""))
    if (
      path !== leaving &&
      (layout.inSnapshotSet(path) || alsoTaking.includes(path))
    ) {
      const bytes = await pod.read(path);
      assert.ok(bytes !== undefined);
      files.push([path, await fileDigest(bytes)]);
    }
  return setHash(files);
}

/** Cleo's writer over the pod, handed the head, its time fixed. */
async function cleosWriter(pod: Files, head: Head | undefined) {
  const { local, replayed: story } = await cleosReplay();
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

/** The replay's last snapshot, as the head its writer kept, with no set. */
async function replayHead(): Promise<Head> {
  const { replayed: story } = await cleosReplay();
  const last = await snapshotIn(
    story.pod,
    story.steps.at(-1)?.wrote.at(-1) ?? "",
  );
  return { snapshot: last.name, setHash: last.values("setHash")[0] ?? "" };
}

/** Cleo's entry, entered by the writer: what the step wrote, and the act's file, the last it wrote. */
async function enterInto(
  writer: CorePod,
  entry: string,
): Promise<{ wrote: readonly string[]; actFile: string }> {
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
  return { wrote, actFile: wrote.at(-1) ?? "" };
}

/** A writer that, from the replay's last snapshot, entered Cleo's entry. */
async function entered(entry: string): Promise<CorePod> {
  const { replayed: story } = await cleosReplay();
  const writer = await cleosWriter(await copied(story.pod), await replayHead());
  await enterInto(writer, entry);
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

/** The pod's files, recording the path of every read. */
class RecordsReads implements Files {
  readonly reads = new Set<string>();
  constructor(readonly inner: Files) {}

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

  write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    return this.inner.write(pathOrIri, bytes);
  }
}

/** The pod's files, its writes stopping with an error at the one numbered `stopAt`, counting from 0, once. */
class StopsAtOneWrite implements Files {
  writes = 0;
  constructor(
    readonly inner: Files,
    public stopAt: number,
  ) {}

  get iri(): string {
    return this.inner.iri;
  }

  read(pathOrIri: string): Promise<Uint8Array | undefined> {
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

/** Files a folder holds that no snapshot's set may take: a file system's own, and an access list. */
const OUTSIDE_THE_SET = [".DS_Store", "records/allergies/.acl"];

/** What one session of Cleo's writer entering an entry left in the pod, read at the time. */
interface Session {
  readonly snapshot: Awaited<ReturnType<typeof snapshotIn>>;
  readonly headSnapshot: string | undefined;
  readonly head: Head | undefined;
  readonly wrote: readonly string[];
  readonly actFile: string;
  /** The set hash of every file of the set the pod held then, the act's own file left out. */
  readonly setHash: string;
  /** The same, were the files of `OUTSIDE_THE_SET` taken in too. */
  readonly setHashWithThem: string;
}

interface TwoSessions {
  readonly layout: Layout;
  /** What the pod held beside the replay's files, of `OUTSIDE_THE_SET`. */
  readonly held: readonly string[];
  /** The replay's last snapshot, the pod's one head before the sessions. */
  readonly replayLast: string;
  readonly first: Session;
  readonly next: Session;
}

let twoSessions: Promise<Kept<TwoSessions>> | undefined;

/**
 * Two sessions of Cleo's writer on one copy of the replay's pod: the first handed a head the pod does not hold, entering
 * `second-entry`, the second handed the head the first returned, entering `third-entry`. Each session's facts are read as
 * it ends, before the next writes. Nothing writes to the replay's pod.
 */
function sessions(): Promise<Kept<TwoSessions>> {
  twoSessions ??= kept(async () => {
    const { local, replayed: story } = await cleosReplay();
    const pod = await copied(story.pod, {
      [OUTSIDE_THE_SET[0] ?? ""]: new Uint8Array([0]),
      [OUTSIDE_THE_SET[1] ?? ""]: new TextEncoder().encode("# acl\n"),
    });
    const held = (await pod.list("")).filter((path) =>
      OUTSIDE_THE_SET.includes(path),
    );
    const replayLast = (await replayHead()).snapshot;
    const session = async (
      entry: string,
      head: Head | undefined,
    ): Promise<Session> => {
      const writer = await cleosWriter(pod, head);
      const { wrote, actFile } = await enterInto(writer, entry);
      return {
        snapshot: await snapshotIn(pod, actFile),
        headSnapshot: writer.head?.snapshot,
        head: writer.head,
        wrote,
        actFile,
        setHash: await setHashOf(pod, local.layout, actFile),
        setHashWithThem: await setHashOf(
          pod,
          local.layout,
          actFile,
          OUTSIDE_THE_SET,
        ),
      };
    };
    const first = await session("second-entry", {
      snapshot: "urn:uuid:00000000-0000-8000-8000-000000000000",
      setHash: "0".repeat(64),
    });
    const next = await session("third-entry", first.head);
    return { layout: local.layout, held, replayLast, first, next };
  });
  return twoSessions;
}

/**
 * Each act leaves a snapshot in its own file: the set hash of the files the pod then holds, the files the act added, and
 * the snapshot before it, as a git commit names its parent. A writer keeps its last snapshot, its head, outside the pod
 * and hands it back when it opens the pod again; a writer whose head the pod does not hold is a new writer, and its first
 * snapshot merges every head.
 * @rule runtime/naming.feature N14
 * @rule runtime/naming.feature N15
 * @rule runtime/write-order.feature W1
 */
describe("Chaining each act's snapshot to the writer's last · CorePod.head, CorePodOptions.head", () => {
  /**
   * The example of naming.feature in which a writer's first snapshot has no first parent and each later act's names the
   * one before it: Cleo's import, an entry session and a matcher run. Nothing in the pod is written after the replay.
   */
  describe("given a replay of an import, an entry session and a matcher run", () => {
    it("writes each act's file, which holds its snapshot, last of its step's files", async () => {
      const { replayed: story } = await cleosReplay();
      const acts = story.steps.filter(({ activity }) => activity !== undefined);
      assert.equal(acts.length, 3);
      for (const { step, wrote } of acts) {
        const last = wrote.at(-1) ?? "";
        assert.match(last, /^provenance\//, step.name);
        await snapshotIn(story.pod, last);
      }
    });
  });

  /**
   * A copy of the replay's pod, which also holds a `.DS_Store` and a `records/allergies/.acl`, is opened by a writer
   * whose head is a snapshot the pod does not hold; it enters Cleo's `second-entry`.
   */
  describe("given a writer handed a head the pod does not hold", () => {
    let outcome: Kept<TwoSessions>;
    before(async () => {
      outcome = await sessions();
    });

    it("writes a snapshot with no first parent, whose merged parent is the pod's one head", () => {
      const { first, replayLast } = got(outcome);
      assert.deepEqual(first.snapshot.values("firstParentSnapshot"), []);
      assert.deepEqual(first.snapshot.values("mergedParentSnapshot"), [
        replayLast,
      ]);
    });

    it("writes as the set hash the hash of every file of the set the pod holds, the act's own file left out", () => {
      const { first, next } = got(outcome);
      assert.deepEqual(
        first.snapshot.values("setHash"),
        [first.setHash],
        "first session",
      );
      assert.deepEqual(
        next.snapshot.values("setHash"),
        [next.setHash],
        "next session",
      );
    });

    it("leaves out of the set a `.DS_Store` and an `.acl` the pod's folder also holds", () => {
      const { first, layout, held } = got(outcome);
      assert.deepEqual([...held].sort(), [...OUTSIDE_THE_SET].sort());
      for (const path of OUTSIDE_THE_SET)
        assert.equal(layout.inSnapshotSet(path), false, path);
      assert.ok(
        first.wrote.some(
          (path) => path !== first.actFile && layout.inSnapshotSet(path),
        ),
        "the step wrote no file of the set",
      );
      assert.notEqual(
        first.snapshot.values("setHash")[0],
        first.setHashWithThem,
        "the set hash takes in the files that are no part of the set",
      );
    });

    it("names in `fileAddedToSet` each file of the set its act wrote, and no other", () => {
      const { first, next, layout } = got(outcome);
      for (const [which, session] of [
        ["first session", first],
        ["next session", next],
      ] as const)
        assert.deepEqual(
          session.snapshot.values("fileAddedToSet").sort(),
          session.wrote.filter((path) => layout.inSnapshotSet(path)).sort(),
          which,
        );
    });

    it("returns the snapshot it wrote as `head`", () => {
      const { first, next } = got(outcome);
      assert.equal(first.headSnapshot, first.snapshot.name, "first session");
      assert.equal(next.headSnapshot, next.snapshot.name, "next session");
    });
  });

  /** The same writer enters `third-entry` in a second session, handed the head the first session returned. */
  describe("given that writer's next session, handed the head the first returned", () => {
    let outcome: Kept<TwoSessions>;
    before(async () => {
      outcome = await sessions();
    });

    it("writes a snapshot whose first parent is that head, with no merged parent", () => {
      const { first, next } = got(outcome);
      assert.deepEqual(next.snapshot.values("firstParentSnapshot"), [
        first.snapshot.name,
      ]);
      assert.deepEqual(next.snapshot.values("mergedParentSnapshot"), []);
    });
  });

  /**
   * The example of naming.feature in which adopting a release that declares R4 wrong retracts the assertions of R4's two
   * matcher judgments before the open's matcher runs: one open, two acts.
   */
  describe("given an open that adopts a release declaring a rule wrong", () => {
    let outcome: Kept<{
      snapshots: Awaited<ReturnType<typeof snapshotIn>>[];
      faults: string[];
    }>;

    before(async () => {
      outcome = await kept(async () => {
        const local = await localVocabulary(ROOT);
        const story = await featurePod(
          local,
          "runtime/naming.feature",
          new MemoryFiles(ADDRESS),
          {
            example:
              "adopting a release that declares R4 wrong retracts the assertions of R4's two matcher judgments before the open's matcher runs, and neither matcher judgment counts nor lapses",
          },
        );
        const snapshots = [];
        for (const path of story.steps.at(-1)?.wrote ?? [])
          if (path.startsWith("provenance/"))
            snapshots.push(await snapshotIn(story.pod, path));
        return {
          snapshots,
          faults: await snapshotFaults(story, local.layout, newStore),
        };
      });
    });

    it("writes two snapshots in the one step, a migration's and a matcher run's", () => {
      assert.equal(got(outcome).snapshots.length, 2);
    });

    it("names the migration's snapshot as the first parent of the run's", () => {
      const [migration, run] = got(outcome).snapshots;
      assert.ok(migration !== undefined && run !== undefined);
      assert.deepEqual(run.values("firstParentSnapshot"), [migration.name]);
    });

    it("names a retraction among the files the migration's snapshot added", () => {
      const [migration] = got(outcome).snapshots;
      assert.ok(migration !== undefined);
      assert.ok(
        migration
          .values("fileAddedToSet")
          .some((path) => path.startsWith("judgments/retractions/")),
        migration.values("fileAddedToSet").join(", "),
      );
    });

    it("leaves snapshots in which `snapshotFaults()` finds no fault", () => {
      assert.deepEqual(got(outcome).faults, []);
    });
  });
});

/**
 * Two writers of one pod, two apps or two devices, each hold a copy and pass each other the files the other lacks.
 * `receive()` writes those files and then a sync, an act whose snapshot merges the heads that arrived, so both writers end
 * holding one set of files with one set hash.
 * @rule runtime/sync.feature S1
 * @rule runtime/sync.feature S3
 * @rule runtime/sync.feature S5
 */
describe("Receiving another writer's files · CorePod.receive()", () => {
  /**
   * A writer receives the files of another that entered `second-entry`, once with every write allowed and then once for
   * each of its writes, stopped there. The stopped receive is made again on the same pod.
   */
  describe("when a receive stops at one of its writes and is made again", () => {
    let outcome: Kept<{
      writes: number;
      expected: Awaited<ReturnType<typeof theSync>>;
      stopped: {
        stopAt: number;
        rejection: unknown;
        sync: Awaited<ReturnType<typeof theSync>>;
      }[];
    }>;

    before(async () => {
      outcome = await kept(async () => {
        const { local, replayed: story } = await cleosReplay();
        const head = await replayHead();
        const other = await entered("second-entry");
        const unstopped = new StopsAtOneWrite(await copied(story.pod), -1);
        await (await cleosWriter(unstopped, head)).receive(other.files);
        const expected = await theSync(unstopped, local.layout);
        const stopped = [];
        for (let stopAt = 0; stopAt < unstopped.writes; stopAt++) {
          const pod = new StopsAtOneWrite(await copied(story.pod), stopAt);
          const writer = await cleosWriter(pod, head);
          let rejection: unknown;
          try {
            await writer.receive(other.files);
          } catch (thrown) {
            rejection = thrown;
          }
          await writer.receive(other.files);
          stopped.push({
            stopAt,
            rejection,
            sync: await theSync(pod, local.layout),
          });
        }
        return { writes: unstopped.writes, expected, stopped };
      });
    });

    it("rejects the stopped receive with the write's own failure", () => {
      const { writes, stopped } = got(outcome);
      assert.ok(writes > 2, `a receive writes ${writes} files`);
      for (const { stopAt, rejection } of stopped) {
        assert.ok(rejection instanceof Error, `stopped at write ${stopAt}`);
        assert.match(
          rejection.message,
          /the write stopped/,
          `stopped at write ${stopAt}`,
        );
      }
    });

    it("writes the one sync an unstopped receive writes: the same acts named, the same merged parents, the same set hash", () => {
      const { expected, stopped } = got(outcome);
      assert.ok(expected.named.length > 0, "the sync names no act");
      for (const { stopAt, sync } of stopped)
        assert.deepEqual(sync, expected, `stopped at write ${stopAt}`);
    });
  });

  /**
   * Two other writers each entered an entry on a copy of the replay's pod. A third writer receives both, once the one's
   * first and once the other's.
   */
  describe("given a writer that receives two other writers' files", () => {
    let outcome: Kept<
      {
        order: string;
        head: Head | undefined;
        heads: string[];
        setHash: string;
      }[]
    >;

    before(async () => {
      outcome = await kept(async () => {
        const { local, replayed: story } = await cleosReplay();
        const head = await replayHead();
        const second = await entered("second-entry");
        const third = await entered("third-entry");
        const receiving = async (order: string, from: CorePod[]) => {
          const writer = await cleosWriter(await copied(story.pod), head);
          for (const one of from) await writer.receive(one.files);
          return {
            order,
            head: writer.head,
            heads: await headsIn(writer.files),
            setHash: await setHashOf(writer.files, local.layout, ""),
          };
        };
        return [
          await receiving("the second's files first", [second, third]),
          await receiving("the third's files first", [third, second]),
        ];
      });
    });

    it("holds one set hash whichever writer's files it received first", () => {
      const [one, other] = got(outcome);
      assert.ok(one?.head !== undefined && other?.head !== undefined);
      assert.equal(one.head.setHash, other.head.setHash);
    });

    it("holds as its set hash the hash of every file of the set it then holds", () => {
      for (const { order, head, setHash: whole } of got(outcome))
        assert.equal(head?.setHash, whole, order);
    });

    it("leaves its own head the only snapshot that no snapshot names as a parent", () => {
      for (const { order, head, heads } of got(outcome))
        assert.deepEqual(heads, [head?.snapshot], order);
    });
  });
});

/** The seeds the leaves of `HashedSet` draw their sets from. */
const SEEDS = [1, 2, 3, 4, 5];

interface Round {
  readonly seed: number;
  readonly whole: string;
  readonly hashed: HashedSet;
  readonly paths: ReadonlySet<string>;
  /** The paths with one swapped for a path the set never held. */
  readonly swapped: ReadonlySet<string>;
}

/**
 * 60 files of drawn 32-byte digests, hashed a few at a time: the first 1 to 20 of them in a drawn order, then `missing()`
 * and `add()` seven at a time, as a writer that reads a pod in parts does.
 */
async function round(seed: number): Promise<Round> {
  const next = random(seed);
  const hex = () =>
    Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16)).join(
      "",
    );
  const files = new Map<string, Uint8Array>();
  for (let index = 0; index < 60; index++)
    files.set(
      `records/${hex()}.ttl`,
      Uint8Array.from({ length: 32 }, () => Math.floor(next() * 256)),
    );
  const whole = await setHash(files);
  const left = [...files];
  const order: [string, Uint8Array][] = [];
  while (left.length > 0)
    order.push(...left.splice(Math.floor(next() * left.length), 1));
  const cut = 1 + Math.floor(next() * 20);
  const hashed = await HashedSet.of(new Map(order.slice(0, cut)));
  for (let at = cut; at < order.length; at += 7) {
    const paths = new Set(order.slice(0, at + 7).map(([path]) => path));
    const missing = hashed.missing(paths, () => true) ?? [];
    await hashed.add(
      missing.map((path) => [path, files.get(path) ?? new Uint8Array()]),
    );
  }
  const paths = new Set(files.keys());
  const [first = ""] = paths;
  const swapped = new Set([...paths].filter((path) => path !== first));
  swapped.add(`records/${hex()}.ttl`);
  return { seed, whole, hashed, paths, swapped };
}

/**
 * A set hash is a product over every file of the set, so a writer that kept the product multiplies in only the files an
 * act adds and does not read the whole pod again. `Head.set` is what a writer keeps of the set it hashed; it is taken up
 * only while the pod lists exactly those files.
 * @rule runtime/naming.feature N14
 */
describe("Keeping a writer's set hash between sessions · Head.set", () => {
  /**
   * Cleo's writer enters `second-entry`, keeps its head and, in a new session over the same files, enters
   * `third-entry`. The pod's documents are in `attachments/`, and are files of the set.
   */
  describe("given a writer opened again with the head and the set it kept", () => {
    let outcome: Kept<{
      kept: Head;
      untouched: string[];
      reads: ReadonlySet<string>;
      snapshot: Awaited<ReturnType<typeof snapshotIn>>;
      setHash: string;
    }>;

    before(async () => {
      outcome = await kept(async () => {
        const { local, replayed: story } = await cleosReplay();
        const pod = new RecordsReads(await copied(story.pod));
        const first = await cleosWriter(pod, await replayHead());
        await enterInto(first, "second-entry");
        const head = first.head;
        assert.ok(head !== undefined, "the first session kept no head");
        const untouched = await pod.list("attachments/");
        pod.reads.clear();
        const { actFile } = await enterInto(
          await cleosWriter(pod, head),
          "third-entry",
        );
        return {
          kept: head,
          untouched,
          reads: new Set(pod.reads),
          snapshot: await snapshotIn(pod, actFile),
          setHash: await setHashOf(pod, local.layout, actFile),
        };
      });
    });

    it("reads none of the documents the pod keeps, which are files of that set", () => {
      const { kept: head, untouched, reads } = got(outcome);
      assert.ok(head.set !== undefined, "the head holds no set");
      assert.ok(untouched.length > 0, "the pod keeps no document");
      assert.deepEqual(
        untouched.filter((path) => reads.has(path)),
        [],
      );
    });

    it("writes on its next act the set hash of the whole set", () => {
      const { snapshot, setHash: whole } = got(outcome);
      assert.deepEqual(snapshot.values("setHash"), [whole]);
    });
  });

  /** The same, with the head the first session kept handed back without its `set`. */
  describe("given a writer handed the head without the set", () => {
    let outcome: Kept<{ untouched: string[]; reads: ReadonlySet<string> }>;

    before(async () => {
      outcome = await kept(async () => {
        const { replayed: story } = await cleosReplay();
        const pod = new RecordsReads(await copied(story.pod));
        const first = await cleosWriter(pod, await replayHead());
        await enterInto(first, "second-entry");
        const { snapshot, setHash: hash } = first.head ?? {
          snapshot: "",
          setHash: "",
        };
        const untouched = await pod.list("attachments/");
        pod.reads.clear();
        await enterInto(
          await cleosWriter(pod, { snapshot, setHash: hash }),
          "third-entry",
        );
        return { untouched, reads: new Set(pod.reads) };
      });
    });

    it("reads every document the pod keeps", () => {
      const { untouched, reads } = got(outcome);
      assert.ok(untouched.length > 0, "the pod keeps no document");
      assert.deepEqual(
        untouched.filter((path) => !reads.has(path)),
        [],
      );
    });
  });

  /**
   * An entry that is written, then a step that fails at its second write after hashing the set, then the same step made
   * again by the same writer, which has kept the product of the failed step.
   */
  describe("when a step fails after the set was hashed", () => {
    let outcome: Kept<{
      rejection: unknown;
      snapshot: Awaited<ReturnType<typeof snapshotIn>>;
      setHash: string;
    }>;

    before(async () => {
      outcome = await kept(async () => {
        const { local, replayed: story } = await cleosReplay();
        const pod = new StopsAtOneWrite(await copied(story.pod), -1);
        const writer = await cleosWriter(pod, await replayHead());
        await enterInto(writer, "second-entry");
        pod.stopAt = pod.writes + 1;
        let rejection: unknown;
        try {
          await enterInto(writer, "third-entry");
        } catch (thrown) {
          rejection = thrown;
        }
        const { actFile } = await enterInto(writer, "third-entry");
        return {
          rejection,
          snapshot: await snapshotIn(pod, actFile),
          setHash: await setHashOf(pod, local.layout, actFile),
        };
      });
    });

    it("writes on the next act the set hash of the whole set", () => {
      const { rejection, snapshot, setHash: whole } = got(outcome);
      assert.ok(rejection instanceof Error, "the step did not fail");
      assert.match(rejection.message, /the write stopped/);
      assert.deepEqual(snapshot.values("setHash"), [whole]);
    });
  });

  /**
   * `HashedSet` is not exported from the package: it is the class a writer's `Head.set` is made from, tested here where
   * it is refused as well as where it is taken up. Each leaf draws five sets of 60 files from the seeds 1 to 5.
   */
  describe("HashedSet.of(files), HashedSet.ofKept(kept, paths)", () => {
    let outcome: Kept<Round[]>;

    before(async () => {
      outcome = await kept(() => Promise.all(SEEDS.map(round)));
    });

    it("returns the whole set's hash after its files were added a few at a time, in a drawn order", async () => {
      for (const { seed, hashed, whole } of got(outcome))
        assert.equal(await hashed.setHash(), whole, `seed ${seed}`);
    });

    it("returns the same hash from the set kept and taken up again with the same paths", async () => {
      for (const { seed, hashed, paths, whole } of got(outcome)) {
        const reopened = await HashedSet.ofKept(await hashed.kept(), paths);
        assert.equal(await reopened?.setHash(), whole, `seed ${seed}`);
      }
    });

    it("returns undefined from `HashedSet.ofKept()` and from `missing()` once one path is swapped for another", async () => {
      for (const { seed, hashed, swapped } of got(outcome)) {
        assert.equal(
          await HashedSet.ofKept(await hashed.kept(), swapped),
          undefined,
          `seed ${seed}: ofKept`,
        );
        assert.equal(
          hashed.missing(swapped, () => true),
          undefined,
          `seed ${seed}: missing`,
        );
      }
    });
  });
});
