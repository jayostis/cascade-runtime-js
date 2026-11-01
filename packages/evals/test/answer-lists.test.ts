import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Answer } from "../src/checks.js";
import { blinded, judgePackets } from "../src/judging.js";
import { errorsOf } from "../src/schemas.js";
import { ask } from "../src/sessions.js";

const temporary = await mkdtemp(join(tmpdir(), "cascade-evals-lists-"));
after(() => rm(temporary, { recursive: true, force: true, maxRetries: 5 }));

const smoke = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          `../../test/fixtures/smoke-answers/${name}.json`,
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  ) as Answer;

test("a point with no facts, no absences, or neither is a valid answer, and a judge reads it as one", () => {
  for (const name of [
    "pod-allergies",
    "records-allergies",
    "pod-medications",
  ]) {
    const answer = smoke(name);
    assert.deepEqual(errorsOf("answer", answer), [], name);
    const packet = blinded(answer);
    for (const item of answer.items)
      assert.match(packet, new RegExp(`### Item ${item.n}. `), name);
  }
  const knowledgeOnly = smoke("pod-allergies").items.find(
    (it) => it.facts === undefined && it.absences === undefined,
  );
  assert.ok(knowledgeOnly?.knowledge !== undefined);
  assert.match(
    blinded(smoke("pod-allergies")),
    new RegExp(`- Knowledge: ${knowledgeOnly.knowledge.says.slice(0, 20)}`),
  );
});

test("a packet names why an answer is not one, and a throw of the harness's own code is never turned into that text", async () => {
  const folder = join(temporary, "packets");
  const job = "tamsin-vale.checkup.pod.opus-5-5.r1";
  await mkdir(join(folder, "answers", job), { recursive: true });
  await mkdir(join(folder, "prompts"), { recursive: true });
  await writeFile(
    join(folder, "answers", job, "checkup.json"),
    JSON.stringify({ answer: "x", short: "y" }),
  );
  await writeFile(
    join(folder, "plan.json"),
    JSON.stringify({
      run: "packets",
      folder,
      config: { judges: ["claude-haiku-5-5"] },
      cases: [{ id: "tamsin-vale" }],
      jobs: [
        {
          id: job,
          role: "subject",
          case: "tamsin-vale",
          arm: "pod",
          model: "claude-opus-5-5",
          repeat: 1,
          session: "checkup",
          questions: ["checkup"],
          tag: `packets/${job}`,
          status: "done",
          estimate: { tokens: 0, usd: 0 },
          answers: `answers/${job}`,
        },
      ],
      estimate: { tokens: 0, usd: 0 },
    }),
  );
  await judgePackets(folder);
  const plan = JSON.parse(
    await readFile(join(folder, "plan.json"), "utf8"),
  ) as { jobs: { role: string; packet?: string }[] };
  const packet = await readFile(
    plan.jobs.find((it) => it.role === "judge")!.packet!,
    "utf8",
  );
  assert.match(packet, /not a valid answer/);
  assert.match(packet, /items/);
});

test("ask gives no new question while the last answer is malformed, and says how, for either arm", async () => {
  const run = join(temporary, "ask");
  for (const arm of ["pod", "records"]) {
    const job = `c.s.${arm}.opus-5-5.r1`;
    await mkdir(join(run, "prompts", job), { recursive: true });
    await mkdir(join(run, "answers", job), { recursive: true });
    await writeFile(join(run, "prompts", job, "a.txt"), "First.");
    await writeFile(join(run, "prompts", job, "b.txt"), "Second.");
    await writeFile(
      join(run, "plan.json"),
      JSON.stringify({
        run: "ask",
        folder: run,
        jobs: [
          {
            id: job,
            role: "subject",
            session: "s",
            questions: ["a", "b"],
            answers: `answers/${job}`,
            prompt: `prompts/${job}.txt`,
          },
        ],
      }),
    );
    assert.equal(await ask(run, job), "First.");
    await writeFile(join(run, "answers", job, "a.json"), "not json");
    const refused = await ask(run, job);
    assert.match(refused, /a\.json/);
    assert.match(refused, /JSON/);
    assert.doesNotMatch(refused, /Second/);
    await writeFile(join(run, "answers", job, "a.json"), '{"answer":"x"}');
    const missing = await ask(run, job);
    assert.match(missing, /short|items/);
    assert.doesNotMatch(missing, /Second/);
    await writeFile(
      join(run, "answers", job, "a.json"),
      JSON.stringify(smoke("pod-allergies")),
    );
    assert.equal(await ask(run, job), "Second.");
  }
});
