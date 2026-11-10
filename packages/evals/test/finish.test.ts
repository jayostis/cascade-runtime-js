import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { downloads, PULL } from "./recorded-downloads.js";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-finish-"));
process.env.CASCADE_EVALS_TRANSCRIPTS = join(folder, "transcripts");
const { configureTables, openPod } = await import("cascade-runtime");
configureTables({ checkOnOpen: false });
const { finish } = await import("../src/record.js");
const { loadCase } = await import("../src/cases.js");
const { errorsOf } = await import("../src/schemas.js");
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

/** A Claude Code transcript of one agent: its tagged prompt, then each call with its usage and the tools it used. */
function transcript(
  tag: string,
  model: string,
  calls: {
    at: string;
    usage: [number, number, number, number];
    tools?: { name: string; input: object }[];
  }[],
): string {
  return [
    {
      type: "user",
      timestamp: calls[0]!.at,
      message: {
        role: "user",
        content: `eval-tag: ${tag}\n\nRead the prompt.`,
      },
    },
    ...calls.map(
      ({ at, usage: [input, creation, read, output], tools = [] }, n) => ({
        type: "assistant",
        timestamp: at,
        message: {
          id: `${tag}-${n}`,
          model,
          content: tools.map((it) => ({ type: "tool_use", ...it })),
          usage: {
            input_tokens: input,
            cache_creation_input_tokens: creation,
            cache_read_input_tokens: read,
            output_tokens: output,
          },
        },
      }),
    ),
  ]
    .map((line) => JSON.stringify(line))
    .join("\n");
}

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

  describe("given a recorded run of one session on both arms, with one judge", () => {
    const POD = "tamsin-vale.worries.pod.opus-5-5.r1";
    const REC = "tamsin-vale.worries.records.opus-5-5.r1";
    const JUDGE = "tamsin-vale.opus-5-5.r1.judge.haiku-5-5.j1";
    // results.json as parsed, read by the field each leaf names.
    let results: ReturnType<typeof JSON.parse>;
    const job = (it: string) =>
      results.jobs.find((j: { id: string }) => j.id === it);

    before(async () => {
      const run = join(folder, "recorded");
      const id = "recorded";
      const at = await downloads(join(folder, "recorded-downloads"));
      const pods = join(folder, "recorded-pods");
      await (
        await openPod(join(pods, "tamsin-vale"), { title: "Tamsin Vale" })
      ).close();
      const questions = ["blood-clot", "allergies"];
      const subject = (job: string, arm: string) => ({
        id: job,
        role: "subject",
        case: "tamsin-vale",
        session: "worries",
        questions,
        arm,
        model: "claude-opus-5-5",
        alias: "opus",
        repeat: 1,
        tag: `${id}/${job}`,
        status: "dispatched",
        dispatched: true,
        estimate: { tokens: 0, usd: 0 },
        answers: `answers/${job}`,
        prompt: `prompts/${job}.txt`,
      });
      const labels = {
        A: { job: REC, question: "blood-clot" },
        B: { job: POD, question: "blood-clot" },
        C: { job: POD, question: "allergies" },
        D: { job: REC, question: "allergies" },
      };
      const created = new Date().toISOString();
      await mkdir(join(run, "judges"), { recursive: true });
      await writeFile(
        join(run, "plan.json"),
        JSON.stringify({
          run: id,
          folder: run,
          created,
          config: {
            tier: "custom",
            cases: ["tamsin-vale"],
            arms: ["pod", "records"],
            subjects: ["claude-opus-5-5"],
            repeats: 1,
            judges: ["claude-haiku-5-5"],
            cap: { usd: 5 },
          },
          configSha256: "",
          harness: { commit: "0000000", uncommitted: 0 },
          podCommits: { packages: {}, components: [] },
          prompts: {},
          cases: [
            {
              id: "tamsin-vale",
              downloadsSha256: "",
              keySha256: "",
              prepared: {
                case: "tamsin-vale",
                downloads: at,
                downloadsSha256: "",
                pods,
                pod: "tamsin-vale",
                components: [],
                imports: [],
                documents: [],
                build: { seconds: 3.1, modelCalls: 0, tokens: 0, usd: 0 },
              },
            },
          ],
          jobs: [
            subject(POD, "pod"),
            subject(REC, "records"),
            {
              id: JUDGE,
              role: "judge",
              case: "tamsin-vale",
              instance: "tamsin-vale.opus-5-5.r1",
              model: "claude-haiku-5-5",
              alias: "haiku",
              tag: `${id}/${JUDGE}`,
              status: "dispatched",
              dispatched: true,
              estimate: { tokens: 0, usd: 0 },
              verdict: `judges/${JUDGE}.json`,
              prompt: `prompts/${JUDGE}.txt`,
              labels,
            },
          ],
          estimate: { tokens: 0, usd: 0 },
          fitsCap: true,
        }),
      );
      const t = (seconds: number) =>
        new Date(Date.parse(created) + seconds * 1000).toISOString();
      const ENTRY = "pod://p/clinical/conditions.ttl#pe";
      const answers: Record<string, Record<string, unknown>> = {
        [POD]: {
          "blood-clot": {
            answer:
              "No. A clot in the lung was looked for on 8 July 2025 and ruled out.",
            short: "No: suspected and ruled out on 2025-07-08.",
            items: [
              {
                n: 1,
                says: "No pulmonary embolism is among your conditions.",
                why: "The one recorded was refuted.",
                confidence: "high",
                facts: [
                  {
                    says: "A pulmonary embolism, refuted.",
                    cite: { entry: ENTRY },
                    field: "status",
                  },
                ],
                absences: [
                  {
                    what: "An active pulmonary embolism",
                    match: {
                      codes: ["59282003"],
                      terms: ["pulmonary embolism"],
                    },
                    coverage: "Every active condition from every source",
                    query: {
                      tool: "ask",
                      input: { question: "pod/My active conditions" },
                      call: 1,
                    },
                  },
                ],
              },
            ],
          },
          allergies: {
            answer:
              "No allergies are recorded, from the one hospital whose records you have.",
            short: "None recorded.",
            items: [
              {
                n: 1,
                says: "No allergies are recorded.",
                why: "The allergy list is empty.",
                confidence: "high",
                facts: [],
                absences: [
                  {
                    what: "Any allergy",
                    match: { terms: ["allergy"] },
                    coverage: "Every allergy from every source, any date",
                    query: {
                      tool: "ask",
                      input: { question: "pod/My active allergies" },
                    },
                  },
                ],
              },
            ],
          },
        },
        [REC]: {
          "blood-clot": {
            answer:
              "No. The CT angiogram of 8 July 2025 found no pulmonary embolism.",
            short: "No: the CT found none.",
            items: [
              {
                n: 1,
                says: "The CT report says there was no pulmonary embolism.",
                why: "Its conclusion says so.",
                confidence: "high",
                facts: [
                  {
                    says: "The CT angiogram found no pulmonary embolism.",
                    provider: "Cascade North",
                    cite: {
                      file: "north-2026-10/bundle.json",
                      resource: "DiagnosticReport/dr-1",
                    },
                    quote: "No pulmonary embolism",
                  },
                ],
                absences: [],
                links: [],
              },
            ],
          },
          allergies: {
            answer: "You have no allergies.",
            short: "None.",
            items: [
              {
                n: 1,
                says: "You have no allergies.",
                why: "None of the files lists one.",
                confidence: "high",
                facts: [],
                absences: [
                  {
                    what: "Any allergy",
                    match: { terms: ["AllergyIntolerance"] },
                    coverage: "Every file",
                  },
                ],
              },
            ],
          },
        },
      };
      for (const [job, byQuestion] of Object.entries(answers)) {
        await mkdir(join(run, "answers", job), { recursive: true });
        for (const [question, answer] of Object.entries(byQuestion))
          await writeFile(
            join(run, "answers", job, `${question}.json`),
            JSON.stringify(answer),
          );
      }
      await writeFile(
        join(run, "asked.jsonl"),
        [
          {
            job: POD,
            question: "blood-clot",
            at: t(10),
            message: "Did I ever have a blood clot in my lung?",
          },
          {
            job: POD,
            question: "allergies",
            at: t(40),
            message: "Am I allergic to anything?",
          },
          {
            job: REC,
            question: "blood-clot",
            at: t(30),
            message: "Did I ever have a blood clot in my lung?",
          },
          {
            job: REC,
            question: "allergies",
            at: t(60),
            message: "Am I allergic to anything?",
          },
        ]
          .map((it) => JSON.stringify(it))
          .join("\n") + "\n",
      );
      await writeFile(
        join(run, "tool-calls.jsonl"),
        JSON.stringify({
          job: POD,
          call: 1,
          at: t(15),
          tool: "ask",
          input: { question: "pod/My active conditions" },
          ok: true,
          rows: 1,
          entries: [],
          answer: JSON.stringify({
            rows: [{ condition: "Type 2 diabetes mellitus" }],
            total: 1,
          }),
          milliseconds: 12,
        }) + "\n",
      );
      await writeFile(
        join(run, "judges", `${JUDGE}.json`),
        JSON.stringify({
          outputs: [
            {
              label: "A",
              items: [
                { id: "TN1", verdict: "found", items: [1], reason: "" },
                { id: "TT5", verdict: "avoided", items: [], reason: "" },
              ],
              beyond: [],
              chains: [
                { item: 1, complete: true, faithful: true, skipped: [] },
              ],
            },
            {
              label: "B",
              items: [
                { id: "TN1", verdict: "found", items: [1], reason: "" },
                { id: "TT5", verdict: "avoided", items: [], reason: "" },
              ],
              beyond: [],
              chains: [
                { item: 1, complete: true, faithful: true, skipped: [] },
              ],
            },
            {
              label: "C",
              items: [
                { id: "TA1", verdict: "found", items: [1], reason: "" },
                { id: "TT6", verdict: "avoided", items: [], reason: "" },
              ],
              beyond: [],
              chains: [
                { item: 1, complete: true, faithful: true, skipped: [] },
              ],
            },
            {
              label: "D",
              items: [
                {
                  id: "TA1",
                  verdict: "partly",
                  items: [1],
                  reason: "overstates",
                },
                { id: "TT6", verdict: "avoided", items: [], reason: "" },
              ],
              beyond: [{ item: 1, verdict: "speculative", why: "" }],
              chains: [
                { item: 1, complete: true, faithful: false, skipped: [] },
              ],
            },
          ],
        }),
      );
      const transcripts = join(folder, "transcripts", "project");
      await mkdir(transcripts, { recursive: true });
      const write = (job: string, path: string) => ({
        name: "Write",
        input: { file_path: join(run, "answers", job, path), content: "{}" },
      });
      await writeFile(
        join(transcripts, "agent-pod.jsonl"),
        transcript(`${id}/${POD}`, "claude-opus-5-5", [
          { at: t(1), usage: [3_000, 0, 0, 50] },
          { at: t(12), usage: [10, 1_000, 3_000, 80] },
          {
            at: t(20),
            usage: [10, 500, 4_000, 400],
            tools: [write(POD, "blood-clot.json")],
          },
          {
            at: t(45),
            usage: [10, 500, 4_500, 300],
            tools: [write(POD, "allergies.json")],
          },
        ]),
      );
      const read = (file: string) => ({
        name: "Read",
        input: { file_path: join(at, file) },
      });
      await writeFile(
        join(transcripts, "agent-records.jsonl"),
        transcript(`${id}/${REC}`, "claude-opus-5-5", [
          {
            at: t(1),
            usage: [3_000, 0, 0, 50],
            tools: (await loadCase("tamsin-vale")).reading.map(read),
          },
          { at: t(20), usage: [10, 20_000, 3_000, 50] },
          {
            at: t(35),
            usage: [10, 500, 23_000, 400],
            tools: [write(REC, "blood-clot.json")],
          },
          {
            at: t(65),
            usage: [10, 500, 23_500, 300],
            tools: [write(REC, "allergies.json")],
          },
        ]),
      );
      await writeFile(
        join(transcripts, "agent-judge.jsonl"),
        transcript(`${id}/${JUDGE}`, "claude-haiku-5-5", [
          { at: t(70), usage: [8_000, 0, 0, 2_000] },
        ]),
      );
      await finish(run, () => undefined);
      results = JSON.parse(await readFile(join(run, "results.json"), "utf8"));
    });

    it("writes results that hold to the results schema", () => {
      assert.deepEqual(errorsOf("results", results), []);
    });

    it("closes a handed-out job whose every answer is written as `done`", () => {
      assert.deepEqual(
        results.jobs.map((it: { status: string }) => it.status),
        ["done", "done", "done"],
      );
    });

    it("splits each subject's calls at its hand-outs", () => {
      assert.deepEqual(Object.keys(job(REC).split.questions), [
        "blood-clot",
        "allergies",
      ]);
      assert.equal(job(REC).split.shared.calls, 2);
    });

    it("charges a records-arm question for the records it read again", () => {
      assert.ok(job(REC).split.questions["blood-clot"].recordsTokens > 0);
    });

    it("lists every hand-out of the run, in the order they were logged", () => {
      assert.deepEqual(
        results.asked.map((it: { question: string }) => it.question),
        ["blood-clot", "allergies", "blood-clot", "allergies"],
      );
    });

    it("resolves a file citation to its passage, with the resource and the download it came from", () => {
      const cited = results.evidence.find(
        (it: { job: string; question: string }) =>
          it.job === REC && it.question === "blood-clot",
      );
      assert.equal(cited.passage.resource, "DiagnosticReport/dr-1");
      assert.match(cited.passage.text, /No pulmonary embolism/);
      assert.deepEqual(cited.passage.download, PULL);
    });

    it("gives an absence the logged call that looked, with its rows and its time", () => {
      const looked = results.evidence.find(
        (it: { job: string; question: string; absence?: number }) =>
          it.job === POD && it.question === "blood-clot" && it.absence === 0,
      );
      assert.deepEqual([looked.call.rows, looked.call.milliseconds], [1, 12]);
    });

    it("carries the case's pod build time, its sessions and its key", () => {
      const [tamsin] = results.cases;
      assert.equal(tamsin.build.seconds, 3.1);
      assert.ok(
        tamsin.sessions.some((it: { id: string }) => it.id === "worries"),
      );
      assert.ok(
        tamsin.key.some(
          (it: { id: string; question: string }) =>
            it.id === "TN1" && it.question === "blood-clot",
        ),
      );
    });

    it("links the key's prose at the harness's commit", () => {
      assert.match(
        results.cases[0].keyUrl,
        /cascade-runtime-js\/blob\/0000000\/packages\/evals\/cases\/tamsin-vale\/key\.md$/,
      );
    });

    it("names the instance by its case, model and repeat", () => {
      assert.equal(results.instances[0].id, "tamsin-vale.opus-5-5.r1");
    });

    // Seven of the case's key items are not traps, and five of them are of questions this run never asked, as
    // `cases/tamsin-vale/key.json` stands: a red leaf after an edit of the key starts there.
    it("counts each arm out of every key item of the case, those of questions the run never asked as unanswered", () => {
      const [instance] = results.instances;
      assert.deepEqual(instance.arms.pod.expected, {
        found: 2,
        partly: 0,
        missed: 0,
        split: 0,
        ungraded: 0,
        unanswered: 5,
        of: 7,
      });
      assert.deepEqual(instance.arms.records.expected, {
        found: 1,
        partly: 1,
        missed: 0,
        split: 0,
        ungraded: 0,
        unanswered: 5,
        of: 7,
      });
    });

    it("counts a point beyond the key under the arm that made it", () => {
      assert.equal(results.instances[0].arms.records.beyond.speculative, 1);
    });

    it("counts a fact that points at a view entry by its field, held or failed", () => {
      assert.deepEqual(results.instances[0].arms.pod.citations.byField, {
        status: { held: 0, failed: 1 },
      });
    });

    it("counts a fact that copies its record with no field", () => {
      const { citations } = results.instances[0].arms.records;
      assert.equal(citations.held, 1);
      assert.equal(
        citations.byField,
        undefined,
        "a copied fact names no field",
      );
    });

    it("charges the judge's cost to the instance's judging, and each subject's to its arm", () => {
      const [instance] = results.instances;
      assert.equal(instance.judging.usd, job(JUDGE).stats.cost.usd);
      assert.ok(instance.judging.usd > 0);
      assert.equal(instance.arms.pod.usd, job(POD).stats.cost.usd);
      assert.ok(instance.arms.pod.usd > 0);
    });
  });
});
