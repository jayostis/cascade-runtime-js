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

test("a step whose content to be named holds a blank node is refused, and the replay goes on", async () => {
  const files = await vocabulary();
  const scripted = "runtime/vectors/refusals/scripted-input/stray-statement";
  const source = new MemoryFiles("https://story.example/");
  for (const path of await files.list(scripted)) {
    const bytes = (await files.read(path)) ?? new Uint8Array();
    await source.write(
      `s/${path.slice(scripted.length + 1)}`,
      path.endsWith("graph.ttl")
        ? new TextEncoder().encode(
            new TextDecoder()
              .decode(bytes)
              .replace(/^<urn:example:stray>.*$/m, "")
              .replace('bridge:selector ""', "bridge:selector _:selector"),
          )
        : bytes,
    );
  }
  const entry = (allergen: string): Uint8Array =>
    new TextEncoder()
      .encode(`<urn:cascade:this-entry> a <http://www.w3.org/ns/prov#Activity> .
<urn:cascade:output-0> a <https://ns.cascadeprotocol.org/health/v1#AllergyRecord> .
<urn:cascade:output-0-version> <http://www.w3.org/ns/prov#specializationOf> <urn:cascade:output-0> ;
  <https://ns.cascadeprotocol.org/health/v1#allergen> ${allergen} .`);
  await source.write("s/blank.ttl", entry("[ <urn:example:value> 2 ]"));
  await source.write("s/plain.ttl", entry('"Peanut"'));
  const story = parseStory(
    JSON.stringify({
      address: "https://pod.example/",
      subject: "urn:uuid:a5e8c1d3-2f47-4b9a-8e60-1c3d5f7a9b24",
      steps: [
        { name: "create", when: "2026-06-01T09:00:00Z", creation: {} },
        {
          name: "import",
          when: "2026-06-02T09:00:00Z",
          import: { export: "apple_health_export", converted: "bridge" },
        },
        { name: "entry", when: "2026-06-03T09:00:00Z", entry: "blank.ttl" },
        { name: "plain", when: "2026-06-04T09:00:00Z", entry: "plain.ttl" },
      ],
    }),
  );
  const { steps } = await replay({
    story,
    source,
    folder: "s",
    pod: new MemoryFiles(story.address),
    newStore,
    importers: [appleHealthExport],
  });
  assert.match(
    steps[1]?.refused ?? "",
    /^the revision of urn:uuid:.*holds a blank node/,
  );
  assert.match(steps[2]?.refused ?? "", /^blank\.ttl: .*holds a blank node/);
  for (const step of steps.slice(1, 3)) assert.deepEqual(step.wrote, []);
  assert.equal(steps[3]?.refused, undefined);
  assert.notDeepEqual(steps[3]?.wrote, []);
});
