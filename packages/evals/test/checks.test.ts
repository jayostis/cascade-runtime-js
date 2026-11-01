import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
