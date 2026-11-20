import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import { CorePod, type CorePodOptions } from "../src/core-pod.js";
import { type Files, MemoryFiles } from "../src/files.js";
import { parseGraph } from "../src/graph.js";
import { randomId } from "../src/ids.js";
import type { Layout } from "../src/layout.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { StepWrites } from "../src/pod.js";
import { iri, literal, type Triple, XSD } from "../src/rdf.js";
import { layout, replayed, RUNTIME, vocabulary } from "./vocabulary.js";

const CREATED = "http://purl.org/dc/terms/created";
const ADDRESS = "https://pod.example/";
const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const newStore = (): OxigraphStore => new OxigraphStore();

/** A pod over the files whose build writes only its manifest, stating when it was built; it fails while `failing`. */
function options(
  pod: Files,
  laidOut: Layout,
  state: { now: string; failing?: boolean },
): CorePodOptions {
  return {
    runtime: RUNTIME,
    pod,
    address: ADDRESS,
    subject: "urn:uuid:7c2d9e41-5a8b-4f36-b0e2-9d1a4c6f8e53",
    title: "",
    vocabulary: new MemoryFiles("https://vocabulary.example/"),
    layout: laidOut,
    newStore,
    time: { newId: randomId, now: () => state.now },
    importers: [],
    references: () => Promise.reject(new Error("no tables")),
    build: {
      lens: "everyday",
      derive: async (union, _lens, { at }) => {
        if (state.failing === true) throw new Error("the build fails");
        const manifest = ADDRESS + laidOut.manifest;
        const triples: Triple[] = [
          [iri(manifest), iri(CREATED), literal(at, `${XSD}dateTime`)],
        ];
        await union.add(triples, manifest);
        return new Map([[laidOut.manifest, triples]]);
      },
    },
  };
}

/** When the pod's build says it was built, as a question reads it. */
async function created(pod: CorePod): Promise<string[]> {
  return (
    await (
      await pod.dataset("everyday")
    ).select(`SELECT ?at WHERE { ?manifest <${CREATED}> ?at }`)
  ).rows.flatMap((row) => row.get("at")?.value ?? []);
}

/** Each start and each end of the write of a file, in the order they happened. */
interface Event {
  readonly path: string;
  readonly at: "start" | "end";
}

/** Files that take several writes at once, each taking a few milliseconds, and log every start and end. */
class Overlapping extends MemoryFiles {
  readonly log: Event[] = [];

  async #put(path: string, bytes: Uint8Array): Promise<void> {
    this.log.push({ path, at: "start" });
    await new Promise((resolve) => setTimeout(resolve, 3));
    await super.write(path, bytes);
    this.log.push({ path, at: "end" });
  }

  override write(path: string, bytes: Uint8Array): Promise<void> {
    return this.#put(path, bytes);
  }

  async writeMany(
    files: Iterable<readonly [string, Uint8Array]>,
  ): Promise<void> {
    await Promise.all(
      [...files].map(([path, bytes]) => this.#put(path, bytes)),
    );
  }
}

/** The log positions of the first start and the last end among the writes of the paths. */
function within(
  log: readonly Event[],
  paths: readonly string[],
): { first: number; last: number } {
  const at = (kind: Event["at"]): number[] =>
    log.flatMap((event, n) =>
      event.at === kind && paths.includes(event.path) ? [n] : [],
    );
  if (at("start").length === 0) throw new Error(`${paths} were never written`);
  return { first: Math.min(...at("start")), last: Math.max(...at("end")) };
}

/** Whether the write of one of the paths started while another of them was being written. */
function overlaps(log: readonly Event[], paths: readonly string[]): boolean {
  let open = 0;
  for (const event of log) {
    if (!paths.includes(event.path)) continue;
    if (event.at === "end") open -= 1;
    else if ((open += 1) > 1) return true;
  }
  return false;
}

/**
 * A step writes its files in an order, and to places, that leave the pod readable if the step stops part way: the file
 * describing the act goes last, so no pod names an act whose files are missing.
 * @rule runtime/write-order.feature W1
 */
describe("Writing a step's files · CorePod.import(), CorePod.open(), CorePod.judge()", () => {
  describe("CorePod.import()", () => {
    let ranks: number[];

    before(async () => {
      const { pod, steps } = await replayed(
        "runtime/arrivals.feature",
        "each record's first arrival is its first version and a revision that follows none",
        { importers: [appleHealthExport] },
      );
      ranks = [];
      for (const path of steps[1]?.wrote ?? []) {
        if (!(await layout()).isRdf(path)) {
          ranks.push(0);
          continue;
        }
        const { triples } = await parseGraph(
          (await pod.read(path)) ?? new Uint8Array(),
          pod.iri + path,
          newStore,
        );
        const said = (term: string): boolean =>
          triples.some(([, p, o]) => p.value === term || o.value === term);
        ranks.push(
          said(`${PROV}used`) ? 2 : said(`${CASCADE}Revision`) ? 1 : 0,
        );
      }
    });

    it("writes its content-addressed files first, then its revisions, and its own description last", () => {
      assert.deepEqual(
        ranks,
        [...ranks].sort((a, b) => a - b),
      );
      assert.deepEqual(new Set(ranks), new Set([0, 1, 2]));
      assert.equal(ranks.filter((rank) => rank === 2).length, 1);
    });
  });

  describe("given files that take several writes at once (`Files.writeMany`), CorePod.import()", () => {
    let ranked: { path: string; rank: number }[];
    let log: readonly Event[];

    before(async () => {
      let files: Overlapping | undefined;
      const { pod, steps } = await replayed(
        "runtime/arrivals.feature",
        "each record's first arrival is its first version and a revision that follows none",
        {
          importers: [appleHealthExport],
          pod: (address) => (files = new Overlapping(address)),
        },
      );
      log = files?.log ?? [];
      ranked = [];
      for (const path of steps[1]?.wrote ?? []) {
        if (!(await layout()).isRdf(path)) {
          ranked.push({ path, rank: 0 });
          continue;
        }
        const { triples } = await parseGraph(
          (await pod.read(path)) ?? new Uint8Array(),
          pod.iri + path,
          newStore,
        );
        const said = (term: string): boolean =>
          triples.some(([, p, o]) => p.value === term || o.value === term);
        ranked.push({
          path,
          rank: said(`${PROV}used`) ? 2 : said(`${CASCADE}Revision`) ? 1 : 0,
        });
      }
    });

    it("starts none of its revisions before every content-addressed file is written, and its description before every revision is", () => {
      const of = (rank: number): string[] =>
        ranked.filter((file) => file.rank === rank).map(({ path }) => path);
      for (const [before, after] of [
        [0, 1],
        [1, 2],
      ] as const)
        assert.ok(
          within(log, of(before)).last < within(log, of(after)).first,
          `a file of rank ${after} was started before every file of rank ${before} was written`,
        );
    });

    it("writes the content-addressed files several at once", () => {
      assert.ok(
        overlaps(
          log,
          ranked.filter(({ rank }) => rank === 0).map(({ path }) => path),
        ),
        "no two were being written at once",
      );
    });
  });

  describe("given files that take several writes at once, StepWrites.commit()", () => {
    const body = (path: string): Uint8Array => new TextEncoder().encode(path);
    const waved = (
      waves: readonly (number | undefined)[],
    ): { writes: StepWrites; paths: string[] } => {
      const writes = new StepWrites();
      const paths = waves.map((_, n) => `files/${n}`);
      waves.forEach((wave, n) =>
        writes.add(paths[n] ?? "", body(`${n}`), wave),
      );
      return { writes, paths };
    };

    it("starts no file of a wave before every file of the wave before it is written, and its act's file after all, one wave at several at once", async () => {
      const { writes, paths } = waved([1, 1, 1, 1, 2, 2, 3]);
      writes.act({ name: "urn:act", path: "acts/a", triples: [] });
      const pod = new Overlapping(ADDRESS);
      const committed = await writes.commit(pod);
      const waves = [
        paths.slice(0, 4),
        paths.slice(4, 6),
        paths.slice(6),
        ["acts/a"],
      ];
      for (const [n, wave] of waves.slice(1).entries())
        assert.ok(
          within(pod.log, waves[n] ?? []).last < within(pod.log, wave).first,
          `${wave} started before ${waves[n]} was written`,
        );
      assert.ok(
        overlaps(pod.log, waves[0] ?? []),
        "the first wave was written one at a time",
      );
      assert.deepEqual(committed, [...paths, "acts/a"]);
      assert.deepEqual(writes.committed, [...paths, "acts/a"]);
    });

    it("writes a file with no wave alone, in its place, and so splits the wave around it in two", async () => {
      const { writes, paths } = waved([1, 1, undefined, 1, 1]);
      const pod = new Overlapping(ADDRESS);
      await writes.commit(pod);
      const [one, two, alone, three, four] = paths;
      const before = within(pod.log, [one ?? "", two ?? ""]);
      const middle = within(pod.log, [alone ?? ""]);
      const after = within(pod.log, [three ?? "", four ?? ""]);
      assert.ok(before.last < middle.first, "the file was started too soon");
      assert.ok(middle.last < after.first, "the file was written too late");
    });

    it("writes every file in one `writeAll` where the files have none that writes several at once, whatever the waves", async () => {
      const { writes, paths } = waved([1, 1, 2, 3]);
      writes.act({ name: "urn:act", path: "acts/a", triples: [] });
      const files = new MemoryFiles(ADDRESS);
      const batches: string[][] = [];
      await writes.commit({
        iri: ADDRESS,
        read: (path) => files.read(path),
        list: (folder) => files.list(folder),
        write: (path) => Promise.reject(new Error(`${path} written alone`)),
        writeAll: async (written) => {
          batches.push([...written].map(([path]) => path));
        },
      });
      assert.deepEqual(batches, [[...paths, "acts/a"]]);
    });

    it("rejects with the failure of a wave, writing no file of a later wave and not its act's file", async () => {
      const { writes } = waved([1, 1, 2, 3]);
      writes.act({ name: "urn:act", path: "acts/a", triples: [] });
      const files = new MemoryFiles(ADDRESS);
      const started: string[] = [];
      await assert.rejects(
        writes.commit({
          iri: ADDRESS,
          read: (path) => files.read(path),
          list: (folder) => files.list(folder),
          write: async (path) => {
            started.push(path);
          },
          writeMany: async (written) => {
            started.push(...[...written].map(([path]) => path));
            throw new Error("the first wave fails");
          },
        }),
        /the first wave fails/,
      );
      assert.deepEqual(started, ["files/0", "files/1"]);
    });
  });

  describe("CorePod.open()", () => {
    let kinds: string[];

    before(async () => {
      const { pod, steps } = await replayed(
        "runtime/opening.feature",
        "adopting files no Same the adopted rows still join, and a Same of each pair only they join",
      );
      kinds = [];
      for (const path of steps.at(-1)?.wrote ?? []) {
        const { triples } = await parseGraph(
          (await pod.read(path)) ?? new Uint8Array(),
          pod.iri + path,
          newStore,
        );
        const version = triples.find(
          ([, predicate]) => predicate.value === "http://purl.org/pav/version",
        );
        const states = (term: string): boolean =>
          triples.some(([, , object]) => object.value === term);
        kinds.push(
          states(`${CASCADE}MatcherRun`)
            ? "run"
            : states(`${CASCADE}Judgment`)
              ? "judgment"
              : states(`${CASCADE}MatcherJudgmentAssertion`)
                ? "assertion"
                : `version ${version?.[2].value ?? "?"}`,
        );
      }
    });

    it("writes its judgments first, then the description of each version it adopts, oldest first, and the file of its matcher run last", () => {
      assert.deepEqual(kinds, [
        "judgment",
        "assertion",
        "version 2",
        "version 3",
        "run",
      ]);
    });
  });

  describe("given files that take a batch (`Files.writeAll`)", () => {
    let created: { wrote: readonly string[]; batches: string[][] };
    let refused: string[][];
    let manifest: string;
    let card: string;

    before(async () => {
      const laidOut = await layout();
      manifest = laidOut.manifest;
      card = laidOut.card;
      const batches: string[][] = [];
      const files = new MemoryFiles(ADDRESS);
      const batched: Files = {
        iri: ADDRESS,
        read: (path) => files.read(path),
        list: (folder) => files.list(folder),
        write: (path) => Promise.reject(new Error(`${path} written alone`)),
        writeAll: async (written) => {
          const paths: string[] = [];
          for (const [path, bytes] of written) {
            await files.write(path, bytes);
            paths.push(path);
          }
          batches.push(paths);
        },
      };
      const state = { now: "2026-02-01T08:00:00Z" };
      const pod = new CorePod(options(batched, laidOut, state));
      const { wrote } = await pod.create();
      created = { wrote, batches: batches.map((batch) => [...batch]) };
      batches.length = 0;
      state.now = "2026-02-02T08:00:00Z";
      assert.ok((await pod.refuse("no reason")).refused);
      refused = batches.map((batch) => [...batch]);
    });

    it("writes a step's files in one batch and the build's files in a second", () => {
      assert.deepEqual(created.batches, [created.wrote, [manifest]]);
      assert.ok(created.wrote.includes(card));
    });

    it("writes only the build's batch for a refused step", () => {
      assert.deepEqual(refused, [[manifest]]);
    });
  });

  describe("when a write fails part way through a step", () => {
    let failure: unknown;
    let left: string;
    let plain: string;

    before(async () => {
      const laidOut = await layout();
      const files = new MemoryFiles(ADDRESS);
      let writes = 0;
      const failing: Files = {
        iri: ADDRESS,
        read: (path) => files.read(path),
        list: (folder) => files.list(folder),
        write: (path, bytes) =>
          ++writes === 2
            ? Promise.reject(new Error("the second write fails"))
            : files.write(path, bytes),
      };
      const state = { now: "2026-02-01T08:00:00Z" };
      const pod = new CorePod(options(failing, laidOut, state));
      try {
        await pod.create();
      } catch (error) {
        failure = error;
      }
      left = await pod.revision();
      plain = await new CorePod(options(files, laidOut, state)).revision();
    });

    it("rejects with the failure", () => {
      assert.ok(failure instanceof Error);
      assert.match(failure.message, /the second write fails/);
    });

    it("returns from `revision()` the revision of the files as they were left", () => {
      assert.equal(left, plain);
    });
  });

  describe("when a file is written to `CorePod.files`", () => {
    let underneath: Uint8Array | undefined;
    let read: Uint8Array | undefined;

    before(async () => {
      const files = new MemoryFiles(ADDRESS);
      const pod = new CorePod(
        options(files, await layout(), { now: "2026-02-01T08:00:00Z" }),
      );
      await pod.files.write("notes.txt", new TextEncoder().encode("a note"));
      underneath = await files.read("notes.txt");
      read = await pod.files.read("notes.txt");
    });

    it("writes the file to the pod's own files", () => {
      assert.equal(new TextDecoder().decode(underneath), "a note");
    });

    it("reads the file back from `CorePod.files`", () => {
      assert.equal(new TextDecoder().decode(read), "a note");
    });
  });

  describe("CorePod.judge()", () => {
    it("files a retraction that also states `prov:used` with the retractions, not with the imports", async () => {
      const laidOut = await layout();
      const pod = new CorePod({
        ...options(new MemoryFiles(ADDRESS), laidOut, {
          now: "2026-02-01T08:00:00Z",
        }),
        // A judgment is read against the pod's matcher view, which reads the vocabulary.
        vocabulary: await vocabulary(),
      });
      const name = "urn:uuid:3b9e2d47-8c15-4f6a-a0d2-7e5c1b9f4a63";
      const { wrote } = await pod.judge({
        name: "retraction.ttl",
        base: ADDRESS,
        bytes: new TextEncoder()
          .encode(`@prefix prov: <http://www.w3.org/ns/prov#> .
<${name}> a prov:Activity ;
  prov:invalidated <urn:uuid:0f6c2a9e-4d71-4b38-9e05-c8a3f2d61b7e> ;
  prov:used <urn:uuid:c41d7e90-2b6a-4f3c-8d15-a9e0b7f26c48> ;
  prov:wasAssociatedWith <https://pod.example/profile/card.ttl#me> .
`),
      });
      assert.deepEqual(wrote, [
        laidOut.place(`${PROV}Activity`, [`${PROV}invalidated`]).path(name),
      ]);
      assert.ok(wrote[0]?.startsWith("judgments/retractions/"));
    });

    it("keeps a Same of records the pod does not hold, and writes nothing for it again, whatever its time", async () => {
      const files = new MemoryFiles(ADDRESS);
      const pod = new CorePod({
        ...options(files, await layout(), { now: "2026-02-01T08:00:00Z" }),
        vocabulary: await vocabulary(),
      });
      const name = "urn:uuid:8d4f1b36-5a07-4e92-b3c8-6f2a9e0d7b15";
      const filing = (time: string) => ({
        name: "same.ttl",
        base: ADDRESS,
        bytes: new TextEncoder()
          .encode(`@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
<${name}> a cascade:Judgment ; cascade:verdict cascade:Same ;
  prov:hadMember <urn:uuid:0f6c2a9e-4d71-4b38-9e05-c8a3f2d61b7e>, <urn:uuid:c41d7e90-2b6a-4f3c-8d15-a9e0b7f26c48> ;
  prov:generatedAtTime "${time}"^^<http://www.w3.org/2001/XMLSchema#dateTime> ;
  prov:wasAttributedTo <https://pod.example/profile/card.ttl#me> .
`),
      });
      const first = await pod.judge(filing("2026-03-04T07:00:00Z"));
      const before = await pod.revision();
      const retry = await pod.judge(filing("2026-03-04T09:00:00Z"));
      assert.equal(first.refused, undefined);
      assert.equal(first.wrote.length, 1);
      assert.deepEqual([retry.refused, retry.wrote], [undefined, []]);
      assert.equal(await pod.revision(), before);
    });
  });
});

/**
 * `dataset(lens)` is the pod as a question reads it, and `revision()` names the state it is in. Both hold until the next
 * step, so an app keeps an answer for as long as the revision stands.
 */
describe("Reading a pod between steps · CorePod.dataset(), CorePod.revision(), CorePod.close()", () => {
  let read: {
    createdAfterCreation: string[];
    createdAfterRefusal: string[];
    refused: string | undefined;
    freed: Awaited<ReturnType<CorePod["dataset"]>>;
    revisions: { created: string; refused: string; second: string };
    secondCreated: string[];
    noBuildCreated: string[];
    failure: unknown;
    recovered: string[];
  };

  before(async () => {
    const laidOut = await layout();
    const state = { now: "2026-02-01T08:00:00Z", failing: false };
    const over = options(new MemoryFiles(ADDRESS), laidOut, state);
    const pod = new CorePod(over);
    await pod.create();
    const createdRevision = await pod.revision();
    const createdAfterCreation = await created(pod);
    const first = await pod.dataset("everyday");

    state.now = "2026-02-02T08:00:00Z";
    const { refused } = await pod.refuse("no reason");
    const refusedRevision = await pod.revision();
    const createdAfterRefusal = await created(pod);

    const second = new CorePod(over);
    const secondRevision = await second.revision();
    const secondCreated = await created(second);
    const noBuildCreated = await created(
      new CorePod({ ...over, build: undefined }),
    );

    pod.close();
    state.failing = true;
    let failure: unknown;
    try {
      await created(pod);
    } catch (error) {
      failure = error;
    }
    state.failing = false;
    read = {
      createdAfterCreation,
      createdAfterRefusal,
      refused,
      freed: first,
      revisions: {
        created: createdRevision,
        refused: refusedRevision,
        second: secondRevision,
      },
      secondCreated,
      noBuildCreated,
      failure,
      recovered: await created(pod),
    };
  });

  describe("when a step is performed", () => {
    it("returns from `dataset()` what the build wrote at that step", () => {
      assert.deepEqual(read.createdAfterCreation, ["2026-02-01T08:00:00Z"]);
      assert.deepEqual(read.createdAfterRefusal, ["2026-02-02T08:00:00Z"]);
    });

    it("returns a different `revision()` after a refused step than after the creation before it", () => {
      assert.ok(read.refused);
      assert.notEqual(read.revisions.refused, read.revisions.created);
    });

    it("frees the dataset read before the step", async () => {
      await assert.rejects(read.freed.ask("ASK { ?s ?p ?o }"), /freed/);
    });
  });

  describe("given a second `CorePod` over the same files", () => {
    it("returns the same revision", () => {
      assert.equal(read.revisions.second, read.revisions.refused);
    });

    it("returns the same dataset, with a build of its own or with none", () => {
      assert.deepEqual(read.secondCreated, ["2026-02-02T08:00:00Z"]);
      assert.deepEqual(read.noBuildCreated, ["2026-02-02T08:00:00Z"]);
    });
  });

  describe("when the build fails after `close()`", () => {
    it("rejects `dataset()` with the build's error", () => {
      assert.ok(read.failure instanceof Error);
      assert.match(read.failure.message, /the build fails/);
    });

    it("returns the dataset at the next call, once the build succeeds", () => {
      assert.deepEqual(read.recovered, ["2026-02-02T08:00:00Z"]);
    });
  });
});

/** A retitle changes no revision, whatever the title holds: the title's line ends at a newline, not at a separator the manifest's text carries. */
describe("Retitling a pod · CorePod.retitle(), CorePod.revision()", () => {
  it("leaves the revision as it was for a title holding a line or paragraph separator", async () => {
    const pod = new CorePod(
      options(new MemoryFiles(ADDRESS), await layout(), {
        now: "2026-02-01T08:00:00Z",
      }),
    );
    await pod.create();
    await pod.retitle("plain");
    const titled = await pod.revision();
    for (const title of ["sep\u2028after", "para\u2029x", "\u2028 ", "a\nb"]) {
      await pod.retitle(title);
      assert.equal(await pod.revision(), titled, JSON.stringify(title));
    }
  });
});
