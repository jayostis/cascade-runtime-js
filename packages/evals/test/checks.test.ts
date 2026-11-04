import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import type { Prepared } from "../src/cases.js";
import { checkAnswer } from "../src/checks.js";
import type { Job } from "../src/results.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const runs = join("runs-root");
const id = "tamsin-vale.checkup.pod.opus-5-5.r1";

const jobIn = (answeredIn: string, reusedFrom?: string): Job => ({
  id,
  role: "subject",
  case: "tamsin-vale",
  arm: "pod",
  model: "claude-opus-5-5",
  tag: `t/${id}`,
  status: reusedFrom === undefined ? "done" : "reused",
  ...(reusedFrom === undefined ? {} : { reusedFrom }),
  estimate: { tokens: 0, usd: 0 },
  session: "checkup",
  questions: ["checkup"],
  answers: `answers/${id}`,
  toolUses: [
    {
      name: "Bash",
      input: {
        command: `node "${cli}" ask --run "${join(runs, answeredIn)}" --job ${id}`,
      },
    },
    {
      name: "Bash",
      input: {
        command: `node "${cli}" pod --run "${join(runs, answeredIn)}" --job ${id} --list`,
      },
    },
    {
      name: "Write",
      input: {
        file_path: join(runs, answeredIn, "answers", id, "checkup.json"),
      },
    },
  ],
});

const checked = (job: Job, run: string) =>
  checkAnswer({
    job,
    question: "checkup",
    answer: {},
    folder: join(runs, run),
    prepared: { downloads: "downloads" } as Prepared,
    reading: [],
    key: { case: "tamsin-vale", written: "", items: [] },
    toolCalls: [],
    pod: undefined,
    copies: true,
  });

test("a reused job's commands and answer file are checked against the run it was answered in", async () => {
  const reused = await checked(jobIn("first", `first/${id}`), "second");
  assert.deepEqual(reused.discipline, { ok: true, violations: [] });
});

test("a job answered in this run is still held to this run's folder", async () => {
  const wrong = await checked(jobIn("first"), "second");
  assert.equal(wrong.discipline.ok, false);
  assert.equal(wrong.discipline.violations.length, 3);
});

const elsewhere = "C:/wt/other/packages/evals";
const recordsJob = (reusedFrom?: string, readCase = "tamsin-vale"): Job => ({
  ...jobIn("first", reusedFrom),
  arm: "records",
  toolUses: [
    {
      name: "Read",
      input: {
        file_path: `${elsewhere}/work/${readCase}/downloads/a.json`.replaceAll(
          "/",
          "\\",
        ),
      },
    },
    {
      name: "Bash",
      input: {
        command: `node "${elsewhere}/dist/src/cli.js" ask --run "${elsewhere}/runs/first" --job ${id}`,
      },
    },
    {
      name: "Write",
      input: {
        file_path: `${elsewhere}/runs/first/answers/${id}/checkup.json`,
      },
    },
  ],
});

const checkedRecords = async (job: Job) => {
  const downloads = await mkdtemp(join(tmpdir(), "reused-"));
  await writeFile(join(downloads, "a.json"), "{}");
  return checkAnswer({
    job,
    question: "checkup",
    answer: {},
    folder: join(runs, "second"),
    prepared: { downloads } as Prepared,
    reading: ["a.json"],
    key: { case: "tamsin-vale", written: "", items: [] },
    toolCalls: [],
    pod: undefined,
    copies: true,
  });
};

test("a reused job answered in another checkout is checked with the files and commands of that checkout", async () => {
  const reused = await checkedRecords(recordsJob(`first/${id}`));
  assert.deepEqual(reused.discipline, { ok: true, violations: [] });
  assert.deepEqual(reused.read, ["a.json"]);
});

test("a read of another case's downloads in that checkout is still a violation", async () => {
  const reused = await checkedRecords(
    recordsJob(`first/${id}`, "priya-natarajan"),
  );
  assert.equal(reused.discipline.violations.length, 1);
  assert.match(reused.discipline.violations[0]!, /priya-natarajan/);
  assert.match(reused.discipline.violations[0]!, /wt.+other/);
  assert.deepEqual(reused.read, []);
});

const withPath = (job: Job, file_path: string, name = "Read"): Job => ({
  ...job,
  toolUses: [{ name, input: { file_path } }],
});

test("a fresh job reading downloads under a path that only looks like a checkout is a violation and reads nothing", async () => {
  const fresh = await checkedRecords(
    withPath(
      recordsJob(),
      "/tmp/x/packages/evals/work/tamsin-vale/downloads/a.json",
    ),
  );
  assert.equal(fresh.discipline.violations.length, 1);
  assert.deepEqual(fresh.read, []);
});

test("a reused job's `..` out of the case's downloads is a violation and reads nothing", async () => {
  const escape = await checkedRecords(
    withPath(
      recordsJob(`first/${id}`),
      `${elsewhere}/work/tamsin-vale/downloads/../../priya-natarajan/downloads/a.json`,
    ),
  );
  assert.equal(escape.discipline.violations.length, 1);
  assert.deepEqual(escape.read, []);
});

test("a reused job's path under work that is not the case's downloads is a violation", async () => {
  const other = await checkedRecords(
    withPath(
      recordsJob(`first/${id}`),
      `${elsewhere}/work/tamsin-vale/downloadsX/a.json`,
    ),
  );
  assert.equal(other.discipline.violations.length, 1);
  assert.deepEqual(other.read, []);
});

test("a reused job that names two checkouts is held to the first", async () => {
  const two = await checkedRecords({
    ...recordsJob(`first/${id}`),
    toolUses: [
      {
        name: "Read",
        input: { file_path: `${elsewhere}/work/tamsin-vale/downloads/a.json` },
      },
      {
        name: "Read",
        input: {
          file_path:
            "C:/wt/third/packages/evals/work/tamsin-vale/downloads/a.json",
        },
      },
    ],
  });
  assert.equal(two.discipline.violations.length, 1);
  assert.match(two.discipline.violations[0]!, /third/);
});
