import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, test } from "node:test";
import type { Answer } from "../src/checks.js";
import { blinded, judgePackets } from "../src/judging.js";
import { RUNS } from "../src/paths.js";
import type { Job } from "../src/results.js";

const temporary = await mkdtemp(join(tmpdir(), "cascade-evals-judging-"));
const earlier = join(RUNS, "test-earlier-letters");
after(async () => {
  await rm(temporary, { recursive: true, force: true, maxRetries: 5 });
  await rm(earlier, { recursive: true, force: true, maxRetries: 5 });
});

const answer = (says: string): Answer => ({
  answer: `${says} A positive stool test needs a colonoscopy.`,
  short: says,
  items: [
    {
      n: 1,
      says,
      why: "It is due.",
      confidence: "high",
      facts: [
        {
          says: "A positive stool test",
          provider: "Cascade North",
          cite: { entry: "pod://p/clinical/lab-results.ttl#fit" },
          value: "Positive",
          date: "2025-11-04",
        },
      ],
      absences: [
        {
          what: "No colonoscopy",
          coverage: "Every lab result in the pod (21 rows) from 3 retrievals",
          match: { terms: ["colonoscopy"] },
          query: { tool: "ask", input: { question: "pod/My procedures" } },
        },
      ],
      knowledge: { says: "A positive FIT calls for a colonoscopy." },
    },
  ],
});

const POD = "tamsin-vale.checkup.pod.opus-5-5.r1";
const RECORDS = "tamsin-vale.checkup.records.opus-5-5.r1";

/** A run of the two subjects' answers, planned for the given judges. */
async function runOf(name: string, judges: string[]) {
  const folder = join(temporary, name);
  await mkdir(join(folder, "answers"), { recursive: true });
  await mkdir(join(folder, "prompts"), { recursive: true });
  for (const [id, text] of [
    [POD, "Has a colonoscopy been booked?"],
    [RECORDS, "Should I have a colonoscopy now?"],
  ] as const) {
    await mkdir(join(folder, "answers", id), { recursive: true });
    await writeFile(
      join(folder, "answers", id, "checkup.json"),
      JSON.stringify(answer(text)),
    );
  }
  const subject = (id: string, arm: string) => ({
    id,
    role: "subject",
    case: "tamsin-vale",
    arm,
    model: "claude-opus-5-5",
    repeat: 1,
    session: "checkup",
    questions: ["checkup"],
    tag: `${name}/${id}`,
    status: "done",
    estimate: { tokens: 0, usd: 0 },
    answers: `answers/${id}`,
  });
  await writeFile(
    join(folder, "plan.json"),
    JSON.stringify({
      run: name,
      folder,
      config: { judges },
      cases: [{ id: "tamsin-vale" }],
      jobs: [subject(POD, "pod"), subject(RECORDS, "records")],
      estimate: { tokens: 0, usd: 0 },
    }),
  );
  await judgePackets(folder);
  const plan = JSON.parse(
    await readFile(join(folder, "plan.json"), "utf8"),
  ) as { jobs: Job[] };
  return { folder, judges: plan.jobs.filter((it) => it.role === "judge") };
}

test("a judge reads its packet alone, in its own folder, with neither arm's citations nor coverage", async () => {
  const { folder, judges } = await runOf("one", ["claude-haiku-5-5"]);
  const [judge] = judges;
  assert.ok(judge?.workdir !== undefined && judge.packet !== undefined);
  assert.deepEqual(readdirSync(judge.workdir).sort(), [
    "packet.md",
    "prompt.txt",
  ]);
  assert.ok(relative(folder, judge.workdir).startsWith(".."));
  const packet = await readFile(judge.packet, "utf8");
  assert.doesNotMatch(
    packet.slice(packet.indexOf("## The questions and their answers")),
    /pod:\/\/|\bpod\b|21 rows|retriev|\[…\]/i,
  );
  assert.match(blinded(answer("Q")), /- Absent: No colonoscopy$/m);
});

test("a judge sees the answers in an order of its run, and a reused verdict keeps the letters it was written to", async () => {
  const orders = new Set<string>();
  for (const run of ["r1", "r2", "r3", "r4", "r5", "r6"]) {
    const { judges } = await runOf(run, ["claude-haiku-5-5"]);
    orders.add(JSON.stringify(judges[0]!.labels));
  }
  assert.equal(orders.size, 2, "the order varies with the run");
  const { judges } = await runOf("two", ["claude-haiku-5-5"]);
  const [planned] = judges;
  // Letters no run of this harness hands out, so only the earlier verdict's own can be what the reuse keeps.
  const swapped = {
    Y: { job: POD, question: "checkup" },
    Z: { job: RECORDS, question: "checkup" },
  };
  await mkdir(join(earlier, "judges"), { recursive: true });
  await writeFile(join(earlier, "judges", "verdict.json"), "{}");
  const stats = {
    calls: 1,
    models: ["claude-haiku-5-5"],
    tokens: { input: 0, cacheCreation: 0, cacheRead: 0, output: 0, total: 0 },
    contextPeak: 0,
    toolCalls: { total: 0, byName: {} },
    wallSeconds: 0,
    cost: { usd: 0, basis: "exact", priceTable: "2026-10-06" },
    usageSource: "transcript",
  };
  await writeFile(
    join(earlier, "results.json"),
    JSON.stringify({
      run: { id: "test-earlier-letters" },
      versions: {
        harness: { commit: "0", uncommitted: 0 },
        podPackages: {},
        components: [],
      },
      jobs: [
        {
          ...planned,
          status: "done",
          labels: swapped,
          verdict: "judges/verdict.json",
          stats,
        },
      ],
      toolCalls: [],
    }),
  );
  const { judges: again } = await runOf("three", ["claude-haiku-5-5"]);
  assert.equal(again[0]!.status, "reused");
  assert.deepEqual(again[0]!.labels, swapped);
});

test("the scrubber takes out resource names used as type names and keeps the words of either arm's prose", async () => {
  const { scrubbed } = await import("../src/judging.js");
  for (const [said, kept] of [
    [
      "Type 2 diabetes is an active condition.",
      "Type 2 diabetes is an active condition.",
    ],
    [
      "Any immunization record for pneumococcal vaccine.",
      "Any immunization record for pneumococcal vaccine.",
    ],
    [
      "The patient has no procedure on record.",
      "The patient has no procedure on record.",
    ],
    [
      "The Observation resource shows an A1c of 6.9.",
      "The shows an A1c of 6.9.",
    ],
    [
      "Observation/story-stopped-a1c-9 has an A1c of 6.9.",
      "has an A1c of 6.9.",
    ],
    [
      "Every lab result (21 rows) through the records retrieved 2026-10-15.",
      "Every lab result through the records.",
    ],
  ] as const)
    assert.equal(scrubbed(said), kept, said);
});
