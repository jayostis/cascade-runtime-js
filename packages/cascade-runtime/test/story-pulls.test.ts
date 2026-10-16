import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import type { Story } from "@cascade-runtime/demo-hospital";
import { loadStories } from "@cascade-runtime/demo-hospital/node";
import { findChanges, openPod } from "cascade-runtime";
import { kitDownload, replayKit } from "cascade-runtime/fixtures";
import { storyPulls } from "./story-pulls.js";

const KIT = "tamsin-vale";

let story: Story;
let made: ReadonlyMap<string, Uint8Array>;

const parsed = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder().decode(bytes));

before(async () => {
  story = (await loadStories()).find(({ pulls }) => pulls?.length)!;
  made = await storyPulls(story.patient);
});

test("the kit's saved pulls are what the generator makes from the hospital now", async () => {
  const names = story.pulls!.map(({ name }) => name);
  assert.deepEqual(
    [...made.keys()].sort(),
    names
      .flatMap((name) => [`${name}/bundle.json`, `${name}/pull.json`])
      .sort(),
  );
  for (const name of names) {
    const folder = await kitDownload(KIT, name);
    for (const file of ["bundle.json", "pull.json"])
      assert.deepEqual(
        JSON.parse(await readFile(join(folder, file), "utf8")),
        parsed(made.get(`${name}/${file}`)!),
        `${KIT} ${name}/${file}`,
      );
  }
});

test("each pull holds the medication and the results as they stood on its date", () => {
  const [finding] = story.findings;
  for (const { name, asOf } of story.pulls!) {
    const { entry } = parsed(made.get(`${name}/bundle.json`)!) as {
      entry: { resource: Record<string, unknown> }[];
    };
    const resources = entry.map(({ resource }) => resource);
    const [medication] = resources.filter(
      ({ resourceType }) => resourceType === "MedicationStatement",
    );
    const stopped = Date.parse(finding!.date) <= Date.parse(asOf);
    assert.equal(medication!.status, stopped ? "completed" : "active", name);
    assert.deepEqual(
      (medication!.effectivePeriod as { end?: string }).end,
      stopped ? finding!.date : undefined,
      name,
    );
    assert.deepEqual(
      resources
        .filter(({ resourceType }) => resourceType === "Observation")
        .map(({ effectiveDateTime }) =>
          (effectiveDateTime as string).slice(0, 10),
        )
        .sort(),
      [...finding!.before, ...finding!.after]
        .map(({ date }) => date)
        .filter((date) => Date.parse(date) <= Date.parse(asOf))
        .sort(),
      name,
    );
  }
});

test("the kit's pod, replayed from its story as the starter loads it, gives the story's finding", async () => {
  const at = await mkdtemp(join(tmpdir(), "cascade-runtime-story-pulls-"));
  try {
    await replayKit(KIT, join(at, KIT));
    const pod = await openPod(join(at, KIT));
    try {
      const found = await findChanges(pod);
      assert.deepEqual(
        found.map(({ kind, medication, test, direction }) => ({
          kind,
          medication: medication.notation,
          date: medication.date,
          test: test.notation,
          direction,
        })),
        story.findings.map(({ kind, medication, date, test, direction }) => ({
          kind,
          medication,
          date,
          test,
          direction,
        })),
      );
    } finally {
      await pod.close();
    }
  } finally {
    await rm(at, { recursive: true, force: true });
  }
});
