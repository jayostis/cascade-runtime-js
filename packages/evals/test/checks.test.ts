import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { after, describe, it } from "node:test";
import type { Prepared } from "../src/cases.js";
import { checkAnswer } from "../src/checks.js";
import type { Job } from "../src/results.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const runs = join("runs-root");
const id = "tamsin-vale.checkup.pod.opus-5-5.r1";

const downloads = await mkdtemp(join(tmpdir(), "cascade-evals-checks-"));
await writeFile(join(downloads, "a.json"), "{}");
after(() => rm(downloads, { recursive: true, force: true, maxRetries: 5 }));

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

const checkedRecords = (job: Job) =>
  checkAnswer({
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

const withPath = (job: Job, file_path: string, name = "Read"): Job => ({
  ...job,
  toolUses: [{ name, input: { file_path } }],
});

/**
 * A subject may read only its case's downloads, and its commands and answer file may name only its own run's folder.
 * `checkAnswer()` reads the job's tool uses and lists each one that went outside as a violation.
 */
describe("Holding a job to its own downloads and run folder · checkAnswer()", () => {
  describe("checkAnswer(options)", () => {
    it("returns one violation for each command or answer file that names another run's folder", async () => {
      const wrong = await checked(jobIn("first"), "second");
      assert.equal(wrong.discipline.ok, false);
      assert.equal(wrong.discipline.violations.length, 3);
    });

    it("returns a violation, and counts nothing as read, for a file outside the case's downloads", async () => {
      const outside: readonly (readonly [string, Job])[] = [
        [
          "a fresh job under a path that only looks like a checkout",
          withPath(
            recordsJob(),
            "/tmp/x/packages/evals/work/tamsin-vale/downloads/a.json",
          ),
        ],
        [
          "a reused job's `..` out of the case's downloads",
          withPath(
            recordsJob(`first/${id}`),
            `${elsewhere}/work/tamsin-vale/downloads/../../priya-natarajan/downloads/a.json`,
          ),
        ],
        [
          "a reused job's path under work that is not the case's downloads",
          withPath(
            recordsJob(`first/${id}`),
            `${elsewhere}/work/tamsin-vale/downloadsX/a.json`,
          ),
        ],
      ];
      for (const [example, job] of outside) {
        const result = await checkedRecords(job);
        assert.equal(result.discipline.violations.length, 1, example);
        assert.deepEqual(result.read, [], example);
      }
    });
  });

  describe("given a job reused from an earlier run", () => {
    it("holds its commands and answer file to the run it was answered in", async () => {
      const reused = await checked(jobIn("first", `first/${id}`), "second");
      assert.deepEqual(reused.discipline, { ok: true, violations: [] });
    });
  });

  describe("given a job reused from another checkout", () => {
    it("holds its commands and answer file to that checkout", async () => {
      const reused = await checkedRecords(recordsJob(`first/${id}`));
      assert.deepEqual(reused.discipline, { ok: true, violations: [] });
    });

    it("counts a download read in that checkout as read", async () => {
      const reused = await checkedRecords(recordsJob(`first/${id}`));
      assert.deepEqual(reused.read, ["a.json"]);
    });

    it("returns a violation, naming the case and the checkout, for a read of another case's downloads there", async () => {
      const reused = await checkedRecords(
        recordsJob(`first/${id}`, "priya-natarajan"),
      );
      assert.equal(reused.discipline.violations.length, 1);
      assert.match(reused.discipline.violations[0]!, /priya-natarajan/);
      assert.match(reused.discipline.violations[0]!, /wt.+other/);
    });

    it("counts nothing as read for a read of another case's downloads there", async () => {
      const reused = await checkedRecords(
        recordsJob(`first/${id}`, "priya-natarajan"),
      );
      assert.deepEqual(reused.read, []);
    });

    it("returns a violation, naming it, for a read in a second checkout", async () => {
      const two = await checkedRecords({
        ...recordsJob(`first/${id}`),
        toolUses: [
          {
            name: "Read",
            input: {
              file_path: `${elsewhere}/work/tamsin-vale/downloads/a.json`,
            },
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
  });
});
