import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-finish-"));
process.env.CASCADE_EVALS_TRANSCRIPTS = join(folder, "transcripts");
const { configureTables, openPod } = await import("cascade-runtime");
configureTables({ checkOnOpen: false });
const { finish } = await import("../src/record.js");
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

interface Written {
  cases: {
    id: string;
    today: string;
    person: { name: string; pronoun: string };
    description: Record<string, string>;
  }[];
  jobs: { id: string; promptText?: string; status: string; reason?: string }[];
  answers: Record<string, Record<string, { items: { n: number }[] }>>;
  evidence: { item: number }[];
}

/**
 * `finish` checks every answer again, reads the verdicts, and writes `results.json`, the one file the report is
 * rendered from, and the report beside it.
 */
describe("Finishing a run into results.json · finish()", () => {
  describe("given a run of two cases", () => {
    let run: string;
    let finished: Awaited<ReturnType<typeof finish>>;
    let lines: string[];
    let results: Written;

    before(async () => {
      run = join(folder, "run");
      await mkdir(run, { recursive: true });
      const cases = [];
      for (const id of ["tamsin-vale", "priya-natarajan"]) {
        const pods = join(folder, id);
        await (await openPod(join(pods, id), { title: id })).close();
        cases.push({
          id,
          downloadsSha256: "",
          keySha256: "",
          prepared: {
            case: id,
            downloads: join(folder, "downloads"),
            downloadsSha256: "",
            pods,
            pod: id,
            components: [],
            imports: [],
            documents: [],
          },
        });
      }
      await writeFile(
        join(run, "plan.json"),
        JSON.stringify({
          run: "two-cases",
          folder: run,
          created: new Date().toISOString(),
          config: {
            tier: "custom",
            cases: ["tamsin-vale", "priya-natarajan"],
            arms: ["pod", "records"],
            subjects: ["claude-opus-5-5"],
            repeats: 1,
            judges: [],
            cap: { usd: 1 },
          },
          configSha256: "",
          harness: { commit: "0000000", uncommitted: 0 },
          podCommits: { packages: {}, components: [] },
          prompts: {},
          cases,
          jobs: [
            {
              id: "tamsin-vale.checkup.pod",
              role: "subject",
              case: "tamsin-vale",
              arm: "pod",
              model: "claude-opus-5-5",
              tag: "two-cases/tamsin-vale.checkup.pod",
              status: "done",
              estimate: { tokens: 0, usd: 0 },
              session: "checkup",
              questions: [],
              prompt: "prompts/tamsin-vale.checkup.pod.txt",
            },
            {
              id: "tamsin-vale.checkup.judge",
              role: "judge",
              case: "tamsin-vale",
              model: "claude-haiku-5-5",
              tag: "two-cases/tamsin-vale.checkup.judge",
              status: "done",
              estimate: { tokens: 0, usd: 0 },
              verdict: "judges/tamsin-vale.checkup.judge.json",
              labels: {},
            },
          ],
          estimate: { tokens: 0, usd: 0 },
          fitsCap: true,
        }),
      );
      await mkdir(join(run, "prompts"), { recursive: true });
      await writeFile(
        join(run, "prompts", "tamsin-vale.checkup.pod.txt"),
        "You are answering Tamsin Vale.\n",
      );
      await mkdir(join(run, "judges"), { recursive: true });
      await writeFile(
        join(run, "judges", "tamsin-vale.checkup.judge.json"),
        JSON.stringify({
          outputs: [
            {
              label: "A",
              items: [],
              beyond: [{ item: -1, verdict: "fair", why: "" }],
              chains: [],
            },
          ],
        }),
      );
      lines = [];
      finished = await finish(run, (line) => lines.push(line));
      results = JSON.parse(
        await readFile(join(run, "results.json"), "utf8"),
      ) as Written;
    });

    it("records each case of the run, in its order", () => {
      assert.deepEqual(
        results.cases.map(({ id }) => id),
        ["tamsin-vale", "priya-natarajan"],
      );
    });

    it("records each case's person, the day it is asked on, and its description", () => {
      const [tamsin] = results.cases;
      assert.deepEqual(tamsin!.person, {
        name: "Tamsin Vale",
        pronoun: "her",
      });
      assert.match(tamsin!.today, /^\d{4}-\d{2}-\d{2}$/);
      assert.deepEqual(Object.keys(tamsin!.description).sort(), [
        "planted",
        "sources",
        "summary",
        "who",
      ]);
      assert.match(tamsin!.description.who!, /^Tamsin Vale, born 1957-09-30/);
    });

    it("records each subject job's opening prompt", () => {
      assert.equal(
        results.jobs.find((it) => it.id === "tamsin-vale.checkup.pod")
          ?.promptText,
        "You are answering Tamsin Vale.\n",
      );
    });

    it("reports each verdict that breaks its schema, naming its judge", () => {
      assert.deepEqual(
        finished.invalidVerdicts.map((it) => it.judge),
        ["tamsin-vale.checkup.judge"],
      );
    });

    it("marks a judge whose verdict breaks its schema `failed`, with the reason", () => {
      const judge = results.jobs.find(
        (it) => it.id === "tamsin-vale.checkup.judge",
      );
      assert.equal(judge?.status, "failed");
      assert.match(judge?.reason ?? "", /verdict/);
    });

    it("logs a verdict that breaks its schema, naming its judge, while it runs", () => {
      assert.ok(
        lines.some((it) => /tamsin-vale\.checkup\.judge.*verdict/.test(it)),
        lines.join("\n"),
      );
    });

    it("writes the report's pages beside `results.json`", () => {
      for (const page of ["index.html", "how_it_works.html"])
        assert.ok(existsSync(join(run, "site", page)), page);
    });
  });

  describe("given an answer whose items carry no `n`", () => {
    let results: Written;
    const job = "tamsin-vale.checkup.pod";

    before(async () => {
      const run = join(folder, "numbers");
      const id = "tamsin-vale";
      const pods = join(folder, "numbers-pods");
      await (await openPod(join(pods, id), { title: id })).close();
      await mkdir(join(run, "answers", job), { recursive: true });
      await mkdir(join(run, "prompts"), { recursive: true });
      await writeFile(join(run, "prompts", `${job}.txt`), "Ask.\n");
      await writeFile(
        join(run, "answers", job, "checkup.json"),
        await readFile(
          new URL(
            "../../test/fixtures/smoke-answers/pod-blood-clot.json",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await writeFile(
        join(run, "plan.json"),
        JSON.stringify({
          run: "numbers",
          folder: run,
          created: new Date().toISOString(),
          config: {
            tier: "custom",
            cases: [id],
            arms: ["pod"],
            subjects: ["claude-opus-5-5"],
            repeats: 1,
            judges: [],
            cap: { usd: 1 },
          },
          configSha256: "",
          harness: { commit: "0000000", uncommitted: 0 },
          podCommits: { packages: {}, components: [] },
          prompts: {},
          cases: [
            {
              id,
              downloadsSha256: "",
              keySha256: "",
              prepared: {
                case: id,
                downloads: join(folder, "downloads"),
                downloadsSha256: "",
                pods,
                pod: id,
                components: [],
                imports: [],
                documents: [],
              },
            },
          ],
          jobs: [
            {
              id: job,
              role: "subject",
              case: id,
              arm: "pod",
              model: "claude-opus-5-5",
              tag: `numbers/${job}`,
              status: "done",
              estimate: { tokens: 0, usd: 0 },
              session: "checkup",
              questions: ["checkup"],
              answers: `answers/${job}`,
              prompt: `prompts/${job}.txt`,
            },
          ],
          estimate: { tokens: 0, usd: 0 },
          fitsCap: true,
        }),
      );
      await finish(run, () => undefined);
      results = JSON.parse(
        await readFile(join(run, "results.json"), "utf8"),
      ) as Written;
    });

    it("stores the answer with each item numbered by its place", () => {
      assert.deepEqual(
        results.answers[job]!.checkup!.items.map((it) => it.n),
        [1, 2, 3, 4, 5],
      );
    });

    it("stores each row of evidence under its item's number", () => {
      assert.ok(results.evidence.some((it) => it.item === 2));
      assert.ok(
        results.evidence.every((it) => typeof it.item === "number"),
        "a row of evidence has no item number",
      );
    });
  });
});
