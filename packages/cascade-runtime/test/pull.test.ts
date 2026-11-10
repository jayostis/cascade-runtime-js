import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { loadHospital } from "@the-cascade-protocol/sandbox/node";
import {
  type Done,
  openPod,
  type Pod,
  type Pull,
  pullFiles,
  type ExportSource,
} from "cascade-runtime";
import { pulled } from "./hospitals.js";

const HYPERTENSION = "http://snomed.info/id/59621000";

/** A clock stopped at the time, whose milliseconds end in zeros, as a stored `xsd:dateTime` drops them. */
function stopped(time: string): { now: () => Date } {
  return { now: () => new Date(time) };
}

/**
 * `pullFiles` saves a pull as files, which `pod.look()` and `pod.import()` take as they take an export. Pulls from two
 * hospitals land in one pod, where the matcher joins the records both hold.
 * @rule runtime/arrivals.feature A11
 * @rule runtime/arrivals.feature A1
 * @rule runtime/matcher.feature M14
 */
describe("Bringing a pull into a pod · pullFiles(), pod.look(), pod.import()", () => {
  let north: Pull;
  let looked: readonly ExportSource[];
  let imported: Done[];
  let conditions: Record<string, string>[];
  let again: Done;
  let pod: Pod;
  let folder: string;

  /** Every step in order, once: a leaf run alone must find what the ones before it did. */
  before(async () => {
    north = (
      await pulled(
        await loadHospital("cascade-north"),
        "pt-1001",
        stopped("2026-10-07T08:04:46.170Z"),
      )
    ).pull;
    const south = (
      await pulled(
        await loadHospital("cascade-south"),
        "s-48213",
        stopped("2026-10-07T08:05:00.000Z"),
      )
    ).pull;
    pod = await openPod();
    folder = await mkdtemp(join(tmpdir(), "cascade-pull-"));

    looked = await pod.look(pullFiles(north, "north"));
    imported = [];
    for (const [one, name] of [
      [north, "north"],
      [south, "south"],
    ] as const)
      imported.push(
        await pod.import(pullFiles(one, name), { claimProfiles: true }),
      );
    conditions = await pod.ask("pod/My active conditions");

    for (const [path, bytes] of pullFiles(north, "north")) {
      await mkdir(dirname(join(folder, path)), { recursive: true });
      await writeFile(join(folder, path), bytes);
    }
    again = await pod.import(join(folder, "north"), { claimProfiles: true });
  });

  after(async () => {
    await pod.close();
    await rm(folder, { recursive: true, force: true });
  });

  describe("pod.look(files)", () => {
    it("returns one source for a pull's files: the hospital's name, its FHIR base as `server`, and the pull's `retrievedAt` in `received`", () => {
      assert.equal(looked.length, 1);
      assert.equal(looked[0]?.name, north.source);
      assert.equal(looked[0]?.server, north.fhirBase);
      assert.deepEqual(looked[0]?.received, [north.retrievedAt]);
    });
  });

  describe("given one person's pulls from two hospitals, each imported with `claimProfiles: true`", () => {
    it("stores both, with neither import `refused`", () => {
      for (const [at, done] of imported.entries()) {
        assert.equal(done.refused, undefined, `import ${at}`);
        assert.ok(done.wrote.length > 0, `import ${at} wrote nothing`);
      }
    });

    it("shows a condition both hospitals hold as one row of `pod/My active conditions`, made of two records", () => {
      const hypertension = conditions.filter(
        ({ snomed }) => snomed === HYPERTENSION,
      );
      assert.equal(hypertension.length, 1);
      assert.equal(hypertension[0]?.records, "2");
    });
  });

  describe("given a pull the pod already holds, saved to a folder", () => {
    it("writes nothing when it is imported again from the folder's path", () => {
      assert.equal(again.refused, undefined);
      assert.deepEqual(again.wrote, []);
    });
  });
});
