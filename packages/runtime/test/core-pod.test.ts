import assert from "node:assert/strict";
import { test } from "node:test";
import { CorePod, type CorePodOptions } from "../src/core-pod.js";
import { MemoryFiles } from "../src/files.js";
import { randomId } from "../src/ids.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, literal, type Triple, XSD } from "../src/rdf.js";
import { layout } from "./vocabulary.js";

const CREATED = "http://purl.org/dc/terms/created";

test("what an ask reads and the revision change with every step, a refused one too; a pod over the same files has the same revision", async () => {
  const address = "https://pod.example/";
  const laidOut = await layout();
  let now = "2026-02-01T08:00:00Z";
  const options: CorePodOptions = {
    pod: new MemoryFiles(address),
    address,
    subject: "urn:uuid:7c2d9e41-5a8b-4f36-b0e2-9d1a4c6f8e53",
    title: "",
    vocabulary: new MemoryFiles("https://vocabulary.example/"),
    layout: laidOut,
    newStore: () => new OxigraphStore(),
    time: { newId: randomId, now: () => now },
    importers: [],
    references: () => Promise.reject(new Error("no tables")),
    build: {
      lens: "everyday",
      derive: async (union, _lens, { at }) => {
        const manifest = address + laidOut.manifest;
        const triples: Triple[] = [
          [iri(manifest), iri(CREATED), literal(at, `${XSD}dateTime`)],
        ];
        await union.add(triples, manifest);
        return new Map([[laidOut.manifest, triples]]);
      },
    },
  };
  const created = async (pod: CorePod): Promise<string[]> =>
    (
      await (
        await pod.dataset("everyday")
      ).select(`SELECT ?at WHERE { ?manifest <${CREATED}> ?at }`)
    ).rows.flatMap((row) => row.get("at")?.value ?? []);

  const pod = new CorePod(options);
  await pod.create();
  const first = await pod.revision();
  assert.deepEqual(await created(pod), ["2026-02-01T08:00:00Z"]);

  now = "2026-02-02T08:00:00Z";
  assert.ok((await pod.refuse("no reason")).refused);
  assert.notEqual(await pod.revision(), first);
  assert.deepEqual(await created(pod), ["2026-02-02T08:00:00Z"]);

  const again = new CorePod(options);
  assert.equal(await again.revision(), await pod.revision());
  assert.deepEqual(await created(again), ["2026-02-02T08:00:00Z"]);
});
