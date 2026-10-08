import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFiles } from "../src/files.js";
import { parseGraph } from "../src/graph.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { References } from "../src/references.js";
import { replay } from "../src/replay.js";
import { REC } from "../src/step.js";
import { layout, storyFrom, vocabulary } from "./vocabulary.js";

const FEATURE = "runtime/opening.feature";
const JUDGMENT = "https://ns.cascadeprotocol.org/judgments/v1-draft#Judgment";
const newStore = (): OxigraphStore => new OxigraphStore();

async function replayed(example: string) {
  const files = await vocabulary();
  const { story, folder } = await storyFrom(FEATURE, example);
  const pod = new MemoryFiles(story.address);
  const { steps } = await replay({
    story,
    source: files,
    vocabulary: files,
    folder,
    title: "",
    pod,
    newStore,
    layout: await layout(),
  });
  return { pod, folder, opened: steps.at(-1) };
}

test("an open writes its judgments first and the descriptions of the versions it adopts last, oldest first (W1)", async () => {
  const { pod, opened } = await replayed(
    "adopting files again each Same the adopted rows still join, and a Same of each pair only they join",
  );
  const kinds: string[] = [];
  for (const path of opened?.wrote ?? []) {
    const { triples } = await parseGraph(
      (await pod.read(path)) ?? new Uint8Array(),
      pod.iri + path,
      newStore,
    );
    const version = triples.find(
      ([, predicate]) => predicate.value === "http://purl.org/pav/version",
    );
    kinds.push(
      triples.some(([, , object]) => object.value === JUDGMENT)
        ? "judgment"
        : `version ${version?.[2].value ?? "?"}`,
    );
  }
  assert.deepEqual(kinds, ["judgment", "judgment", "version 2", "version 3"]);
});

test("an open of a pod on series the tables lack writes nothing of them and names their versions as unheld (O2)", async () => {
  const { folder, opened } = await replayed(
    "a pod made on the vector tables, opened with an app's, is judged by the app's tables and writes nothing of the vector tables",
  );
  const vector = await References.of(
    await vocabulary(),
    `${folder}/references/`,
    newStore,
  );
  const used = [
    await vector.ruleList(),
    ...vector.seriesOfKind(`${REC}VaccineGroups`),
  ].map((series) => vector.fallback(series));
  assert.deepEqual(opened?.unheld, used.sort());
  assert.equal(opened?.refused, undefined);
});
