import assert from "node:assert/strict";
import { test } from "node:test";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import { MemoryFiles, folderOf, readText } from "../src/files.js";
import { parseGraph } from "../src/graph.js";
import { isRdf } from "../src/layout.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { replay } from "../src/replay.js";
import { parseStory, type Story } from "../src/story.js";
import { vocabulary } from "./vocabulary.js";

const newStore = (): OxigraphStore => new OxigraphStore();

async function replayed(path: string, through?: string) {
  const files = await vocabulary();
  const story: Story = parseStory(await readText(files, path));
  const steps =
    through === undefined
      ? story.steps
      : story.steps.slice(
          0,
          story.steps.findIndex((step) => step.name === through) + 1,
        );
  return replay({
    story: { ...story, steps },
    source: files,
    folder: folderOf(path),
    pod: new MemoryFiles(story.address),
    newStore,
    importers: [appleHealthExport],
  });
}

test("an import writes its content-addressed files first, then its revisions, and its own description last", async () => {
  const { pod, steps } = await replayed(
    "runtime/vectors/arrivals/story.json",
    "first-export",
  );
  const wrote = steps[1]?.wrote ?? [];
  const ranks: number[] = [];
  for (const path of wrote) {
    if (!isRdf(path)) {
      ranks.push(0);
      continue;
    }
    const { triples } = await parseGraph(
      (await pod.read(path)) ?? new Uint8Array(),
      pod.iri + path,
      newStore,
    );
    const said = (iri: string): boolean =>
      triples.some(([, p, o]) => p.value === iri || o.value === iri);
    ranks.push(
      said("http://www.w3.org/ns/prov#used")
        ? 2
        : said("https://ns.cascadeprotocol.org/records/v1-draft#Revision")
          ? 1
          : 0,
    );
  }
  assert.deepEqual(
    ranks,
    [...ranks].sort((a, b) => a - b),
  );
  assert.deepEqual(new Set(ranks), new Set([0, 1, 2]));
  assert.equal(ranks.filter((rank) => rank === 2).length, 1);
});

test("a refused step says which rule refused it", async () => {
  const { steps } = await replayed("runtime/vectors/refusals/story.json");
  const refused = new Map(
    steps.map(({ step, refused }) => [step.name, refused]),
  );
  assert.match(
    refused.get("stray-statement") ?? "",
    /holds a statement about no record, version, arrival, document or import/,
  );
  assert.match(
    refused.get("type-filed-nowhere") ?? "",
    /is of no type the pod files: .*NoSuchRecord/,
  );
  assert.match(
    refused.get("import-disagreement") ?? "",
    /documents disagree on the import's label, start or association/,
  );
  assert.match(
    refused.get("entry-of-two-activities") ?? "",
    /holds 2 activities, not one/,
  );
});
