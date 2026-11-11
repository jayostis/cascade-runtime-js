import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { readTestRun } from "../src/node/test-runs.js";

const RUN = { commit: "abc123", at: "2026-11-10T00:00:00Z", url: "https://x/1" };

/**
 * The deploy keeps each suite's newest run in a folder of the tests folder, whatever runner wrote it: its report, its
 * `run.json` and perhaps its `spec.json`. A page reads the folder through `readTestRun`.
 */
describe("Reading a suite's kept run from the tests folder · readTestRun()", () => {
  let root: string;
  const lines: string[] = [];
  const log = (line: string): void => void lines.push(line);
  const folder = async (
    name: string,
    files: Record<string, string>,
  ): Promise<string> => {
    const dir = join(root, name);
    await mkdir(dir);
    for (const [file, text] of Object.entries(files))
      await writeFile(join(dir, file), text);
    return dir;
  };

  before(async () => {
    root = await mkdtemp(join(tmpdir(), "runs-"));
  });
  after(() => rm(root, { recursive: true, force: true }));

  it("reads a CTRF report kept as `report`, with its run and spec", async () => {
    const dir = await folder("ctrf", {
      report: '{"reportFormat":"CTRF"}',
      "run.json": JSON.stringify(RUN),
      "spec.json": '{"about":"a"}',
    });
    assert.deepEqual(await readTestRun(dir, "ctrf", log), {
      report: '{"reportFormat":"CTRF"}',
      ...RUN,
      spec: { about: "a" },
    });
  });

  it("reads a JUnit report kept as `report` the same way", async () => {
    const dir = await folder("junit", {
      report: "<testsuites/>",
      "run.json": JSON.stringify(RUN),
    });
    assert.deepEqual(await readTestRun(dir, "junit", log), {
      report: "<testsuites/>",
      ...RUN,
    });
  });

  it("finds no run in a folder that holds the report under the old name `junit.xml`", async () => {
    const dir = await folder("old", {
      "junit.xml": "<testsuites/>",
      "run.json": JSON.stringify(RUN),
    });
    assert.equal(await readTestRun(dir, "old", log), undefined);
    assert.match(lines.join("\n"), /no old test report/);
  });

  it("finds no run in a folder without `run.json`", async () => {
    const dir = await folder("bare", { report: "<testsuites/>" });
    assert.equal(await readTestRun(dir, "bare", log), undefined);
  });

  it("finds no run when `run.json` names no commit, time and url", async () => {
    const dir = await folder("partial", {
      report: "<testsuites/>",
      "run.json": '{"commit":"abc"}',
    });
    assert.equal(await readTestRun(dir, "partial", log), undefined);
  });
});
