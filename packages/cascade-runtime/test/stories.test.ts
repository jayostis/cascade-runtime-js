import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { Story, StoryFinding } from "@the-cascade-protocol/sandbox";
import { loadHospital, loadStories } from "@the-cascade-protocol/sandbox/node";
import {
  findChanges,
  type LabChange,
  openPod,
  type Pod,
  type Pull,
  pullFiles,
} from "cascade-runtime";
import { replayKit } from "cascade-runtime/fixtures";
import { pulled } from "./hospitals.js";
import { settled } from "./settled.js";

const day = (time: string | undefined) => (time ?? "").slice(0, 10);

const keyOf = ({ kind, medication, test }: StoryFinding) =>
  `${kind === "after start" ? "start" : "stop"}:${medication}:${test}`;

describe("Finding lab changes after a medication starts or stops · findChanges(), changesIn(), compact(), timelineIn()", () => {
  let stories: Story[];
  let north: Awaited<ReturnType<typeof loadHospital>>;
  const pulls = new Map<string, Promise<Pull>>();

  /** A story patient's pull from the demo hospital, made once, whichever group asks first. */
  function pullOf(patient: string): Promise<Pull> {
    let pull = pulls.get(patient);
    if (pull === undefined) {
      pull = pulled(north, patient).then((made) => made.pull);
      pulls.set(patient, pull);
    }
    return pull;
  }

  before(async () => {
    stories = await loadStories();
    north = await loadHospital("cascade-north");
  });

  describe("given the pod of each sandbox story, pulled from its demo hospital and imported", () => {
    const pods = new Map<string, Pod>();
    const found = new Map<string, LabChange[]>();

    /** The lab change a story was written to show, as `findChanges` returns it. */
    const returned = (story: Story, gold: StoryFinding): LabChange => {
      const change = found
        .get(story.patient)!
        .find((each) => each.key === keyOf(gold));
      assert.ok(change, `${story.patient}: ${keyOf(gold)}`);
      return change;
    };

    before(async () => {
      for (const { patient } of stories) {
        const pull = await pullOf(patient);
        const pod = await openPod();
        pods.set(patient, pod);
        const imported = await pod.import(pullFiles(pull, "north"), {
          claimProfiles: true,
        });
        assert.equal(imported.refused, undefined, patient);
        found.set(patient, await findChanges(pod, { limit: 20 }));
      }
    });

    after(async () => {
      await Promise.all([...pods.values()].map((pod) => pod.close()));
    });

    it("returns exactly the lab changes the story was written to show, and none for the story written to show none", () => {
      assert.deepEqual(
        stories.map(({ patient }) => [
          patient,
          found
            .get(patient)!
            .map(({ key }) => key)
            .sort(),
        ]),
        stories.map(({ patient, findings }) => [
          patient,
          findings.map(keyOf).sort(),
        ]),
      );
    });

    it("returns each lab change's `kind`, medication, day, test, `direction` and `unit` as the story states them", () => {
      for (const story of stories)
        for (const gold of story.findings) {
          const change = returned(story, gold);
          assert.deepEqual(
            [
              change.kind,
              change.medication.notation,
              change.medication.date,
              change.test.notation,
              change.direction,
              change.unit,
            ],
            [
              gold.kind,
              gold.medication,
              gold.date,
              gold.test,
              gold.direction,
              gold.unit,
            ],
            keyOf(gold),
          );
        }
    });

    it("returns in `rows` the results the story lists before and after, by day and value, with their count, least and greatest", () => {
      for (const story of stories)
        for (const gold of story.findings) {
          const change = returned(story, gold);
          for (const side of ["before", "after"] as const) {
            const values = gold[side].map(({ value }) => value);
            assert.deepEqual(
              change.rows[side].map((row) => ({
                date: day(row.performed),
                value: Number(row.value),
              })),
              gold[side],
              `${story.patient} ${side}`,
            );
            assert.deepEqual(
              [change[side].count, change[side].min, change[side].max],
              [values.length, Math.min(...values), Math.max(...values)],
              `${story.patient} ${side}`,
            );
          }
        }
    });

    it("leaves no result out, so `left` counts nothing", () => {
      for (const story of stories)
        for (const gold of story.findings)
          assert.deepEqual(
            returned(story, gold).left,
            { unparsed: 0, otherUnit: 0, undated: 0 },
            keyOf(gold),
          );
    });

    it("scores 0 only the lab change of the story written to show too few results", () => {
      for (const story of stories)
        for (const gold of story.findings)
          assert.equal(
            returned(story, gold).score === 0,
            gold.direction === "not enough results",
            `${story.patient}: ${keyOf(gold)}`,
          );
    });

    it("places a medication the hospital holds only a prescription of on the day it was written", async () => {
      const placed: unknown[][] = [];
      const expected: unknown[][] = [];
      for (const story of stories)
        for (const gold of story.findings) {
          if (gold.kind !== "after start") continue;
          const written = (await pullOf(story.patient)).bundle.entry
            .map(({ resource }) => resource as Record<string, unknown>)
            .filter(
              (resource) =>
                resource.resourceType === "MedicationRequest" &&
                (
                  resource.medicationCodeableConcept as {
                    coding: { code: string }[];
                  }
                ).coding.some(({ code }) => code === gold.medication),
            )
            .map((resource) => day(resource.authoredOn as string));
          assert.deepEqual(written, [gold.date], story.patient);
          const { medication } = returned(story, gold);
          placed.push([story.patient, medication.dateIs, medication.date]);
          expected.push([story.patient, "prescription written", gold.date]);
        }
      assert.equal(placed.length, 3);
      assert.deepEqual(placed, expected);
    });
  });

  describe("given one sandbox story imported twice, as a pull and as the C-CDA document of the same records", () => {
    let story: Story;
    let pod: Pod;

    before(async () => {
      story = stories.find(({ ccdaFile }) => ccdaFile !== undefined)!;
      pod = await openPod();
      const first = await pod.import(
        pullFiles(await pullOf(story.patient), "n"),
        { claimProfiles: true },
      );
      assert.equal(first.refused, undefined);
      const second = await pod.import(story.ccdaFile!, {
        claimProfiles: true,
      });
      assert.equal(second.refused, undefined);
    });

    after(async () => {
      await pod.close();
    });

    it("returns the same one lab change as from the pull alone, with each result that both sources report counted once", async () => {
      for (const question of [
        "pod/My lab results",
        "pod/My medication history",
      ]) {
        const rows = await pod.ask(question);
        assert.ok(rows.length > 0, question);
        assert.ok(
          rows.every(({ records }) => records === "2"),
          `${question} holds one entry for each record of the two sources`,
        );
      }
      const changes = await findChanges(pod);
      assert.deepEqual(
        changes.map((change) => [
          change.key,
          change.kind,
          change.medication.date,
          change.direction,
          change.before.count,
          change.after.count,
        ]),
        story.findings.map((gold) => [
          keyOf(gold),
          gold.kind,
          gold.date,
          gold.direction,
          gold.before.length,
          gold.after.length,
        ]),
      );
    });
  });

  describe("given a kit's pod, `tamsin-vale`, replayed into a folder", () => {
    let folder: string;
    let pod: Pod;

    before(async () => {
      folder = await mkdtemp(join(tmpdir(), "cascade-runtime-story-pulls-"));
      await replayKit("tamsin-vale", join(folder, "tamsin-vale"));
      pod = await openPod(join(folder, "tamsin-vale"));
    });

    after(async () => {
      await pod.close();
      await settled(folder);
      await rm(folder, { recursive: true, force: true });
    });

    it("returns the lab change of the sandbox story the kit's two pulls were saved from", async () => {
      const story = stories.find(({ pulls: saved }) => saved?.length)!;
      assert.deepEqual(
        (await findChanges(pod)).map(
          ({ kind, medication, test, direction }) => ({
            kind,
            medication: medication.notation,
            date: medication.date,
            test: test.notation,
            direction,
          }),
        ),
        story.findings.map(({ kind, medication, date, test, direction }) => ({
          kind,
          medication,
          date,
          test,
          direction,
        })),
      );
    });
  });
});
