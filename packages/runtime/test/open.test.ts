import assert from "node:assert/strict";
import { test } from "node:test";
import { CorePod } from "../src/core-pod.js";
import { type Files, MemoryFiles } from "../src/files.js";
import { parseGraph } from "../src/graph.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { References } from "../src/references.js";
import { replay } from "../src/replay.js";
import { randomId } from "../src/ids.js";
import { REC } from "../src/step.js";
import { layout, storyFrom, vocabulary } from "./vocabulary.js";

const FEATURE = "runtime/opening.feature";
const JUDGMENT = "https://ns.cascadeprotocol.org/judgments/v1-draft#Judgment";
const newStore = (): OxigraphStore => new OxigraphStore();

/** The example replayed, its story's files those `source` gives for its folder, and otherwise the vocabulary's. */
async function replayed(
  example: string,
  source?: (files: Files, folder: string) => Promise<Files>,
) {
  const files = await vocabulary();
  const { story, folder } = await storyFrom(FEATURE, example);
  const pod = new MemoryFiles(story.address);
  const { steps } = await replay({
    story,
    source: source === undefined ? files : await source(files, folder),
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

test("an open whose tables list another version of the pod's rule list matches nothing and names the pod's as unheld (O2)", async () => {
  const rules = "f32ebeea-4ed7-4da7-b08c-031dc619538e";
  const other = "0b6f2c1e-9d4a-4e7b-8c3f-5a1d2e6b7f90";
  const { opened } = await replayed(
    "adopting describes each version after the pod's up to the adopted one",
    async (files, folder) => {
      const source = new MemoryFiles(files.iri);
      for (const path of await files.list(`${folder}/`)) {
        const bytes = (await files.read(path)) ?? new Uint8Array();
        if (!path.startsWith(`${folder}/tables/app-later/`))
          await source.write(path, bytes);
        else if (path.endsWith("/references.ttl"))
          await source.write(
            path,
            new TextEncoder().encode(
              new TextDecoder().decode(bytes).replaceAll(rules, other),
            ),
          );
        else await source.write(path, bytes);
      }
      await source.write(
        `${folder}/tables/app-later/${other}.ttl`,
        (await files.read(`runtime/rule-list/${rules}.ttl`)) ??
          new Uint8Array(),
      );
      return source;
    },
  );
  assert.equal(opened?.refused, undefined);
  assert.deepEqual(opened?.unheld, [`urn:uuid:${rules}`]);
});

test("an open on a clock that moves between judgments files each Same once when its recheck and its new joins both give it (O1)", async () => {
  const files = await vocabulary();
  const { story, folder } = await storyFrom(
    FEATURE,
    "a rule list the pod names that M11 now refuses joins nothing, so the adopted rule list judges every pair",
  );
  const pod = new MemoryFiles(story.address);
  await replay({
    story: { ...story, steps: story.steps.slice(0, -1) },
    source: files,
    vocabulary: files,
    folder,
    title: "",
    pod,
    newStore,
    layout: await layout(),
  });
  const tables = (name: string) =>
    References.of(files, `${folder}/tables/${name}/`, newStore, files);
  let tick = Date.parse("2026-07-03T09:00:00Z");
  const reopened = new CorePod({
    pod,
    address: story.address,
    subject: story.subject,
    title: "",
    vocabulary: files,
    layout: await layout(),
    newStore,
    time: { newId: randomId, now: () => new Date(tick++).toISOString() },
    importers: [],
    references: () => tables("app"),
  });
  const opened = await reopened.open(await tables("app-new-rules"));
  assert.equal(opened.refused, undefined);
  const judgments = [];
  for (const path of opened.wrote) {
    const { triples } = await parseGraph(
      (await pod.read(path)) ?? new Uint8Array(),
      pod.iri + path,
      newStore,
    );
    if (triples.some(([, , object]) => object.value === JUDGMENT))
      judgments.push(path);
  }
  assert.equal(judgments.length, 2);
});

test("a refused open leaves the pod matching with the tables it had", async () => {
  const files = await vocabulary();
  const { story, folder } = await storyFrom(
    FEATURE,
    "opening again with the same tables writes nothing",
  );
  const app = await References.of(
    files,
    `${folder}/tables/app/`,
    newStore,
    files,
  );
  const empty = new MemoryFiles("https://tables.example/");
  await empty.write("references.ttl", new Uint8Array());
  const pod = new CorePod({
    pod: new MemoryFiles(story.address),
    address: story.address,
    subject: story.subject,
    title: "",
    vocabulary: files,
    layout: await layout(),
    newStore,
    time: { newId: randomId, now: () => "2026-07-01T09:00:00Z" },
    importers: [],
    references: () => Promise.resolve(app),
  });
  await pod.create();
  assert.ok((await pod.open(await References.of(empty, "", newStore))).refused);
  assert.equal((await pod.match()).refused, undefined);
});
