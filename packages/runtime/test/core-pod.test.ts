import assert from "node:assert/strict";
import { test } from "node:test";
import { CorePod, type CorePodOptions } from "../src/core-pod.js";
import { type Files, MemoryFiles } from "../src/files.js";
import { randomId } from "../src/ids.js";
import type { Layout } from "../src/layout.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, literal, type Triple, XSD } from "../src/rdf.js";
import { layout } from "./vocabulary.js";

const CREATED = "http://purl.org/dc/terms/created";
const ADDRESS = "https://pod.example/";

/** A pod over the files whose build writes only its manifest, stating when it was built; it fails while `failing`. */
function options(
  pod: Files,
  laidOut: Layout,
  state: { now: string; failing?: boolean },
): CorePodOptions {
  return {
    pod,
    address: ADDRESS,
    subject: "urn:uuid:7c2d9e41-5a8b-4f36-b0e2-9d1a4c6f8e53",
    title: "",
    vocabulary: new MemoryFiles("https://vocabulary.example/"),
    layout: laidOut,
    newStore: () => new OxigraphStore(),
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

test("what an ask reads and the revision change with every step, a refused one too; a pod over the same files has the same revision", async () => {
  const laidOut = await layout();
  const state = { now: "2026-02-01T08:00:00Z", failing: false };
  const over = options(new MemoryFiles(ADDRESS), laidOut, state);
  const created = async (pod: CorePod): Promise<string[]> =>
    (
      await (
        await pod.dataset("everyday")
      ).select(`SELECT ?at WHERE { ?manifest <${CREATED}> ?at }`)
    ).rows.flatMap((row) => row.get("at")?.value ?? []);

  const pod = new CorePod(over);
  await pod.create();
  const first = await pod.revision();
  assert.deepEqual(await created(pod), ["2026-02-01T08:00:00Z"]);

  state.now = "2026-02-02T08:00:00Z";
  assert.ok((await pod.refuse("no reason")).refused);
  assert.notEqual(await pod.revision(), first);
  assert.deepEqual(await created(pod), ["2026-02-02T08:00:00Z"]);

  const again = new CorePod(over);
  assert.equal(await again.revision(), await pod.revision());
  assert.deepEqual(await created(again), ["2026-02-02T08:00:00Z"]);
  assert.deepEqual(await created(new CorePod({ ...over, build: undefined })), [
    "2026-02-02T08:00:00Z",
  ]);

  pod.close();
  state.failing = true;
  await assert.rejects(created(pod), /the build fails/);
  state.failing = false;
  assert.deepEqual(await created(pod), ["2026-02-02T08:00:00Z"]);
});

test("a step writes its files in one batch and the build its files in a second; a refused step writes only the build's", async () => {
  const laidOut = await layout();
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
  assert.deepEqual(batches, [wrote, [laidOut.manifest]]);
  assert.ok(wrote.includes(laidOut.card));

  batches.length = 0;
  state.now = "2026-02-02T08:00:00Z";
  assert.ok((await pod.refuse("no reason")).refused);
  assert.deepEqual(batches, [[laidOut.manifest]]);
});
