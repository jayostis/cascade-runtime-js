import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { MemoryFiles } from "../src/files.js";
import { Graph } from "../src/graph.js";
import { localVocabulary } from "../src/node/runtime.js";
import { featurePod } from "../src/node/story-pod.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, RDF } from "../src/rdf.js";
import { cleosReplay } from "./cleo.js";
import { countRebuildsInPart } from "./rebuilds.js";
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

describe("Keeping one build of a pod across steps · CorePodOptions.build, CorePod.select()", () => {
  /**
   * `build.verify` (`PodBuildOption.verify`) makes a pod that rebuilt a step in part build itself whole as well, and
   * throw where the two differ: in a graph of derived state, or in a file the build writes. A replay that does not throw
   * is one in which they never differed. Each kit's story is replayed once, with a count of the steps that were
   * rebuilt in part.
   */
  describe("given every kit replayed with `build.verify`", () => {
    let replays: { kit: string; error: unknown; inPart: number }[];

    before(async () => {
      const local = await localVocabulary(ROOT);
      const rebuilds = countRebuildsInPart();
      replays = [];
      try {
        for (const kit of await kits()) {
          const calls = rebuilds.count();
          let error: unknown;
          try {
            await featurePod(local, kit, new MemoryFiles(ADDRESS), {
              verify: true,
            });
          } catch (thrown) {
            error = thrown;
          }
          replays.push({
            kit,
            error,
            inPart: rebuilds.count() - calls,
          });
        }
      } finally {
        rebuilds.stop();
      }
    });

    it("leaves, after each step rebuilt in part, the derived state and the built files of a pod built whole", () => {
      assert.ok(replays.length > 0, "no kit was replayed");
      assert.deepEqual(
        replays
          .filter(({ error }) => error !== undefined)
          .map(
            ({ kit, error }) =>
              `${kit}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        [],
      );
    });

    it("rebuilds at least one step of each kit in part", () => {
      assert.ok(replays.length > 0, "no kit was replayed");
      for (const { kit, inPart } of replays)
        assert.ok(inPart > 0, `${kit} rebuilt no step in part`);
    });
  });

  /**
   * Three acts of one pod, replayed from the example of naming.feature that names each act's snapshot, with the
   * build run after each. The build's manifest says which snapshot of the writer its views were built from.
   */
  describe("given three acts replayed, each followed by a build", () => {
    it("names the writer's last snapshot as what its build used", async () => {
      const { replayed } = await cleosReplay();
      const store = new OxigraphStore();
      const read = async (path: string) => {
        const bytes = await replayed.pod.read(path);
        assert.ok(bytes !== undefined, path);
        return new Graph(
          await store.parse(bytes, replayed.story.address + path),
        );
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
      assert.ok(snapshot !== undefined, "the last act holds no snapshot");
      assert.ok(build !== undefined, "the manifest names no build");
      assert.deepEqual(
        manifest.objects(build, `${PROV}used`).map(({ value }) => value),
        [snapshot.value],
      );
    });
  });
});
