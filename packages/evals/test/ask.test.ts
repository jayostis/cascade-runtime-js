import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Reply } from "cascade-runtime";
import { schemaOf, TOOLS } from "cascade-runtime/tools";
import { COPYING_POD_PROMPT, sessionPrompt } from "../src/prompts.js";
import { ask } from "../src/sessions.js";
import { smoke } from "./smoke-answers.js";

const temporary = await mkdtemp(join(tmpdir(), "cascade-evals-ask-"));
after(() => rm(temporary, { recursive: true, force: true, maxRetries: 5 }));

/** An answer that holds to the contract and says nothing more. */
const valid = JSON.stringify({
  answer: "r",
  short: "s",
  items: [
    { n: 1, says: "x", why: "", confidence: "high", facts: [], absences: [] },
  ],
});

/**
 * A run of one session of two questions, `a` and then `b`, planned in its own folder: `ask` for the job, `write` for
 * the answer to a question. The pod arm's contract is the one of the prompt `prompts.pod` names, when it names one.
 */
async function sessionOf(
  name: string,
  options: {
    arm?: "pod" | "records";
    prompts?: { pod: string };
    questions?: [string, string];
  } = {},
) {
  const { arm = "pod", prompts, questions = ["First.", "Second."] } = options;
  const run = join(temporary, name);
  const job = `c.s.${arm}.opus-5-5.r1`;
  await mkdir(join(run, "prompts", job), { recursive: true });
  await mkdir(join(run, "answers", job), { recursive: true });
  await writeFile(join(run, "prompts", job, "a.txt"), questions[0]);
  await writeFile(join(run, "prompts", job, "b.txt"), questions[1]);
  await writeFile(
    join(run, "plan.json"),
    JSON.stringify({
      run: name,
      folder: run,
      ...(prompts === undefined ? {} : { prompts }),
      jobs: [
        {
          id: job,
          role: "subject",
          arm,
          session: "s",
          questions: ["a", "b"],
          answers: `answers/${job}`,
        },
      ],
    }),
  );
  return {
    run,
    job,
    asked: () => ask(run, job),
    write: (question: string, text: string) =>
      writeFile(join(run, "answers", job, `${question}.json`), text),
  };
}

/** A pod-arm answer whose fact copies what the record says, as the prompt before facts pointed asked. */
const copyingAnswer = {
  answer: "a",
  short: "s",
  items: [
    {
      says: "p",
      why: "w",
      confidence: "high",
      facts: [
        {
          says: "A1c was 6.9%.",
          provider: "Northbay Clinical Laboratories",
          cite: { entry: "pod://p/clinical/lab-results.ttl#a" },
          name: "Hemoglobin A1c",
        },
      ],
    },
  ],
};

/** A recorded pod reply whose items 2 and 3 are both numbered 7. */
const twoItemsAlike = (): string => {
  const reply = smoke("pod-blood-clot") as Reply & { items: { n?: number }[] };
  reply.items[1]!.n = 7;
  reply.items[2]!.n = 7;
  return JSON.stringify(reply);
};

/**
 * A subject's prompt tells it to run `ask` for its next question, and `ask` hands one out only once the last is answered
 * by a reply that keeps the reply contract. So no later question shapes an earlier answer, and a broken answer is mended
 * while the session can still mend it. What the contract is, is "Checking a model's reply against a person's records ·
 * checkReply(), replyErrors(), replySchema" on cascade-runtime's page.
 */
describe("Asking a session its questions one at a time · sessionPrompt(), ask()", () => {
  describe("given the pod arm's prompt (`sessionPrompt()`)", () => {
    const command = "node cli.js pod --run run --job job";
    let prompt: string;
    let shown: string[];

    before(() => {
      prompt = sessionPrompt({
        arm: "pod",
        tag: "t",
        name: "Tamsin Vale",
        pronoun: "her",
        today: "2026-01-01",
        ask: "ask",
        command,
        pod: "tamsin-vale",
      });
      shown = [...prompt.matchAll(/ ask '([^']*)'/g)].map((it) => it[1]!);
    });

    it("shows one command that reads the whole pod", () => {
      assert.equal(shown.length, 1);
      assert.ok(prompt.includes(`${command} ask '${shown[0]}'`));
    });

    it("writes that command's input as the `ask` tool's schema accepts it, with `format: \"compact\"`", () => {
      const input = JSON.parse(shown[0]!) as Record<string, unknown>;
      const tool = TOOLS.find((it) => it.name === "ask")!;
      const validate = new Ajv2020({ strict: false }).compile(schemaOf(tool));
      assert.ok(validate(input), JSON.stringify(validate.errors));
      assert.equal(input.format, "compact");
    });

    it("names the job's own pod in that input", () => {
      const input = JSON.parse(shown[0]!) as Record<string, unknown>;
      assert.equal(input.pod, "tamsin-vale");
    });
  });

  describe("ask(run, job)", () => {
    let first: string;
    let waiting: string;
    let second: string;
    let last: string;
    let log: { job: string; question: string }[];
    let job: string;

    before(async () => {
      const session = await sessionOf("ask", {
        questions: ["First, in her words.", "Second, in her words."],
      });
      job = session.job;
      first = await session.asked();
      waiting = await session.asked();
      await session.write("a", valid);
      second = await session.asked();
      await session.write("b", valid);
      last = await session.asked();
      log = (await readFile(join(session.run, "asked.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { job: string; question: string });
    });

    it("returns the session's first question, in the person's words", () => {
      assert.equal(first, "First, in her words.");
    });

    it("returns, while the last question has no answer, where to write the answer", () => {
      assert.match(waiting, /answers.c\.s\.pod\.opus-5-5\.r1.a\.json/);
    });

    it("returns the next question once the last is answered", () => {
      assert.equal(second, "Second, in her words.");
    });

    it("returns that there are no more questions once every one is answered", () => {
      assert.match(last, /no more questions/i);
    });

    it("logs each hand-out, with its job and question, to `asked.jsonl`", () => {
      assert.deepEqual(
        log.map((it) => [it.job, it.question]),
        [
          [job, "a"],
          [job, "b"],
        ],
      );
    });
  });

  describe("when the last answer breaks the reply contract", () => {
    const arms = [
      ["pod", "pod-allergies"],
      ["records", "records-allergies"],
    ] as const;

    it("names the answer's file and says it is not JSON", async () => {
      for (const [arm] of arms) {
        const session = await sessionOf(`not-json-${arm}`, { arm });
        await session.asked();
        await session.write("a", "not json");
        const refused = await session.asked();
        assert.match(refused, /a\.json/, arm);
        assert.match(refused, /JSON/, arm);
      }
    });

    it("names the property the reply lacks", async () => {
      for (const [arm] of arms) {
        const session = await sessionOf(`lacks-${arm}`, { arm });
        await session.asked();
        await session.write("a", '{"answer":"x"}');
        const refused = await session.asked();
        assert.match(refused, /short/, arm);
        assert.match(refused, /items/, arm);
      }
    });

    it("quotes the contract's sentence for two items with one `n`", async () => {
      const session = await sessionOf("alike");
      await session.asked();
      await session.write("a", twoItemsAlike());
      const refused = await session.asked();
      assert.match(refused, /a\.json/);
      assert.match(refused, /more than one item has n 7/);
    });

    it("returns no new question", async () => {
      const broken = [
        ["not JSON", "not json"],
        ["a reply with no `short`", '{"answer":"x"}'],
        ["two items with one `n`", twoItemsAlike()],
      ] as const;
      for (const [at, [example, text]] of broken.entries()) {
        const session = await sessionOf(`none-${at}`);
        await session.asked();
        await session.write("a", text);
        assert.doesNotMatch(await session.asked(), /Second/, example);
      }
    });

    it("returns the next question once the answer is mended", async () => {
      for (const [arm, recorded] of arms) {
        const session = await sessionOf(`mended-${arm}`, { arm });
        await session.asked();
        await session.write("a", "not json");
        await session.asked();
        await session.write("a", JSON.stringify(smoke(recorded)));
        assert.equal(await session.asked(), "Second.", arm);
      }
      const alike = await sessionOf("mended-alike");
      await alike.asked();
      await alike.write("a", twoItemsAlike());
      await alike.asked();
      await alike.write("a", JSON.stringify(smoke("pod-blood-clot")));
      assert.equal(await alike.asked(), "Second.");
    });
  });

  describe("given a run planned with the prompt whose facts copy", () => {
    it("takes a pod-arm answer whose facts copy what the record says", async () => {
      const session = await sessionOf("copying", {
        prompts: { pod: COPYING_POD_PROMPT },
      });
      await session.asked();
      await session.write("a", JSON.stringify(copyingAnswer));
      assert.equal(await session.asked(), "Second.");
    });
  });

  describe("given a run planned with a prompt whose facts point", () => {
    it("refuses the same answer, naming the missing `field`", async () => {
      const session = await sessionOf("pointing", {
        prompts: { pod: "883f605fdafc7d5a" },
      });
      await session.asked();
      await session.write("a", JSON.stringify(copyingAnswer));
      const refused = await session.asked();
      assert.match(refused, /required property 'field'/);
      assert.doesNotMatch(refused, /Second/);
    });
  });
});
