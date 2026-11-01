import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import type { BeyondVerdict, ItemVerdict } from "../src/results.js";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-sessions-"));
process.env.CASCADE_EVALS_TRANSCRIPTS = join(folder, "transcripts");
const { openPod } = await import("cascade-runtime");
const { caseIds, loadCase, loadKey } = await import("../src/cases.js");
const { errorsOf } = await import("../src/schemas.js");
const { ask, sessionInputsHash, splitSession } =
  await import("../src/sessions.js");
const { passageOf, podProvenance } = await import("../src/evidence.js");
const { countsOf } = await import("../src/instances.js");
const { finish } = await import("../src/record.js");
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

const fixture = (path: string) =>
  fileURLToPath(new URL(`../../test/fixtures/${path}`, import.meta.url));

test("every case asks its questions in sessions, and its key holds an item for each question and none for another", async () => {
  for (const id of await caseIds()) {
    const found = await loadCase(id);
    const { key } = await loadKey(id);
    const asked = found.sessions.flatMap((it) => it.questions.map((q) => q.id));
    assert.equal(new Set(asked).size, asked.length, `${id} asks each once`);
    assert.ok(asked.includes("checkup"), `${id} asks the check-up question`);
    for (const question of asked)
      assert.ok(
        key.items.some((it) => it.question === question),
        `${id}: the key has an item for ${question}`,
      );
    for (const item of key.items)
      assert.ok(asked.includes(item.question), `${id}: ${item.id}'s question`);
  }
  const tamsin = (await loadCase("tamsin-vale")).sessions.flatMap(
    (it) => it.questions,
  );
  assert.ok(tamsin.length >= 4 && tamsin.length <= 6, "Tamsin asks 4 to 6");
});

test("a reworded question reruns only the sessions that ask it", async () => {
  const found = await loadCase("tamsin-vale");
  const hashes = (it: typeof found) =>
    it.sessions.map((session) =>
      sessionInputsHash({
        found: it,
        session,
        downloads: "digest",
        arm: "pod",
        model: "claude-opus-5-5",
        effort: undefined,
        repeat: 1,
        pod: {},
      }),
    );
  const before = hashes(found);
  const reworded = structuredClone(found) as typeof found;
  (reworded.sessions[1]!.questions[0] as { asks: string }).asks += " Really?";
  const now = hashes(reworded);
  assert.equal(now[0], before[0]);
  assert.notEqual(now[1], before[1]);
});

test("the questions are handed out one at a time, in order, each once the last is answered, and logged", async () => {
  const run = join(folder, "ask");
  const job = "c.s.pod.opus-5-5.r1";
  await mkdir(join(run, "prompts", job), { recursive: true });
  await mkdir(join(run, "answers", job), { recursive: true });
  await writeFile(join(run, "prompts", job, "a.txt"), "First, in her words.");
  await writeFile(join(run, "prompts", job, "b.txt"), "Second, in her words.");
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
  assert.equal(await ask(run, job), "First, in her words.");
  assert.match(await ask(run, job), /answers.c\.s\.pod\.opus-5-5\.r1.a\.json/);
  await writeFile(join(run, "answers", job, "a.json"), "{}");
  assert.equal(await ask(run, job), "Second, in her words.");
  await writeFile(join(run, "answers", job, "b.json"), "{}");
  assert.match(await ask(run, job), /no more questions/i);
  const log = (await readFile(join(run, "asked.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { job: string; question: string });
  assert.deepEqual(
    log.map((it) => [it.job, it.question]),
    [
      [job, "a"],
      [job, "b"],
    ],
  );
});

const call = (
  at: string,
  input: number,
  cacheCreation: number,
  cacheRead: number,
) => ({
  at,
  model: "claude-opus-5-5",
  input,
  cacheCreation,
  cacheRead,
  output: 100,
  toolCalls: [],
  usd: 0.01,
});

test("a session's calls split at each hand-out: before the first is the session's own, then each question's, the records' context counted apart", () => {
  const calls = [
    call("2026-10-31T10:00:00.000Z", 5_000, 0, 0),
    call("2026-10-31T10:00:10.000Z", 10, 20_000, 5_000),
    call("2026-10-31T10:00:30.000Z", 10, 500, 25_000),
    call("2026-10-31T10:00:40.000Z", 10, 500, 25_500),
    call("2026-10-31T10:01:10.000Z", 10, 500, 26_000),
  ];
  const asked = [
    { question: "a", at: "2026-10-31T10:00:20.000Z" },
    { question: "b", at: "2026-10-31T10:01:00.000Z" },
  ];
  const split = splitSession(
    calls,
    asked,
    "2026-10-31T10:01:20.000Z",
    "records",
  );
  assert.deepEqual(Object.keys(split.questions), ["a", "b"]);
  assert.equal(split.shared.calls, 2);
  assert.equal(split.questions.a!.calls, 2);
  assert.equal(split.questions.b!.calls, 1);
  assert.equal(split.questions.a!.seconds, 40);
  assert.equal(split.questions.b!.seconds, 20);
  assert.equal(split.shared.recordsContext, 25_510 - 5_000);
  assert.equal(split.questions.a!.recordsTokens, 2 * 20_510);
  const total = (part: { tokens: { total: number } }) => part.tokens.total;
  assert.equal(
    total(split.shared) + total(split.questions.a!) + total(split.questions.b!),
    calls.reduce(
      (sum, it) => sum + it.input + it.cacheCreation + it.cacheRead + it.output,
      0,
    ),
  );
  const pod = splitSession(calls, asked, "2026-10-31T10:01:20.000Z", "pod");
  assert.equal(pod.shared.recordsContext, undefined);
});

const PULL = {
  source: "Cascade North Demo Hospital",
  retrievedAt: "2026-10-15T00:00:00Z",
};

async function downloads(at: string) {
  for (const name of ["north-2024-02", "north-2025-02", "north-2026-10"]) {
    await mkdir(join(at, name), { recursive: true });
    await copyFile(
      fixture("citations/bundle.json"),
      join(at, name, "bundle.json"),
    );
    await writeFile(join(at, name, "pull.json"), JSON.stringify(PULL));
  }
  return at;
}

test("a grab-bag citation resolves to the passage it names and its download's date; a pod entry to its records, revisions and documents", async () => {
  const at = await downloads(join(folder, "passages"));
  const file = "north-2026-10/bundle.json";
  const lines = (await readFile(join(at, file), "utf8")).split("\n");
  const passage = await passageOf(at, {
    file,
    resource: "MedicationRequest/m-1",
  });
  assert.ok(passage !== undefined);
  assert.equal(passage.pointer, "/entry/7/resource");
  assert.match(passage.text, /Jardiance 10 mg tablet/);
  assert.equal(
    passage.text,
    lines.slice(passage.from - 1, passage.to).join("\n"),
  );
  assert.deepEqual(passage.download, PULL);
  const line = await passageOf(at, { file, line: 3 });
  assert.deepEqual([line?.from, line?.to, line?.text], [3, 3, lines[2]]);
  assert.equal(
    await passageOf(at, { file, resource: "Condition/none" }),
    undefined,
  );
  const resolve = await podProvenance(fixture("pod-provenance"));
  const entry = resolve(
    "pod://b77cda3b-c4b6-44c1-98ff-e433d2aed4b8/clinical/medications.ttl#4c38f471e928531aabdcd1375340f94c1357810bc3cd98d2912d20e99a8615e3",
  );
  assert.equal(entry?.type, "PrescribedOrReportedMedication");
  const [member] = entry!.members;
  assert.equal(member?.sourceId, "story-stopped-medrx-2");
  assert.equal(
    member?.sourceUrl,
    "https://cascade-north.demo.invalid/fhir/MedicationRequest/story-stopped-medrx-2",
  );
  const [revision] = member!.revisions;
  assert.equal(revision?.observedAsOf, "2026-10-15T00:00:00Z");
  assert.equal(revision?.selector, "/entry/5");
  assert.deepEqual(
    [
      revision?.document?.retrievedOn,
      revision?.document?.author,
      revision?.document?.server,
    ],
    [
      "2026-10-15T00:00:00Z",
      "Cascade North Demo Hospital",
      "https://cascade-north.demo.invalid/fhir",
    ],
  );
  assert.equal(
    resolve(
      "pod://b77cda3b-c4b6-44c1-98ff-e433d2aed4b8/clinical/medications.ttl#none",
    ),
    undefined,
  );
});

test("an arm is counted from its judges: a verdict they share, else split; beyond the key by its verdict", () => {
  const item = (
    id: string,
    kind: "fact" | "trap" | "gap" | "absence",
    question: string,
  ) => ({
    id,
    kind,
    question,
  });
  const grade = (
    judge: string,
    question: string,
    items: [string, ItemVerdict][],
    beyond: BeyondVerdict[],
  ) => ({
    subject: "s",
    question,
    judge,
    items: items.map(([id, verdict]) => ({
      id,
      verdict,
      items: [1],
      reason: "",
    })),
    beyond: beyond.map((verdict, at) => ({ item: at + 2, verdict, why: "" })),
    chains: [],
  });
  const counts = countsOf(
    [
      item("F1", "fact", "a"),
      item("T1", "trap", "a"),
      item("G1", "gap", "b"),
      item("A1", "absence", "c"),
    ],
    [
      grade(
        "j1",
        "a",
        [
          ["F1", "found"],
          ["T1", "avoided"],
        ],
        ["fair", "speculative"],
      ),
      grade(
        "j2",
        "a",
        [
          ["F1", "partly"],
          ["T1", "avoided"],
        ],
        ["fair", "contradicted"],
      ),
      grade("j1", "b", [["G1", "found"]], []),
      grade("j2", "b", [["G1", "found"]], []),
    ],
    ["a", "b", "c"],
  );
  assert.deepEqual(counts.expected, {
    found: 1,
    partly: 0,
    missed: 0,
    split: 1,
    ungraded: 1,
    of: 3,
  });
  assert.deepEqual(counts.traps, {
    avoided: 1,
    raised: 0,
    split: 0,
    ungraded: 0,
    of: 1,
  });
  assert.deepEqual(counts.beyond, {
    fair: 1,
    trueNotPlanted: 0,
    speculative: 0,
    contradicted: 0,
    split: 1,
  });
});

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

test("a recorded session run finishes into results that hold to their schema: each question's cost apart, every citation resolved, each instance counted, judging apart", async () => {
  const run = join(folder, "recorded");
  const id = "recorded";
  const at = await downloads(join(folder, "recorded-downloads"));
  const pods = join(folder, "recorded-pods");
  await (
    await openPod(join(pods, "tamsin-vale"), { title: "Tamsin Vale" })
  ).close();
  const POD = "tamsin-vale.worries.pod.opus-5-5.r1";
  const REC = "tamsin-vale.worries.records.opus-5-5.r1";
  const JUDGE = "tamsin-vale.opus-5-5.r1.judge.haiku-5-5.j1";
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
                provider: "Cascade North",
                cite: { entry: ENTRY },
                status: "refuted",
              },
            ],
            absences: [
              {
                what: "An active pulmonary embolism",
                match: { codes: ["59282003"], terms: ["pulmonary embolism"] },
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
          chains: [{ item: 1, complete: true, faithful: true, skipped: [] }],
        },
        {
          label: "B",
          items: [
            { id: "TN1", verdict: "found", items: [1], reason: "" },
            { id: "TT5", verdict: "avoided", items: [], reason: "" },
          ],
          beyond: [],
          chains: [{ item: 1, complete: true, faithful: true, skipped: [] }],
        },
        {
          label: "C",
          items: [
            { id: "TA1", verdict: "found", items: [1], reason: "" },
            { id: "TT6", verdict: "avoided", items: [], reason: "" },
          ],
          beyond: [],
          chains: [{ item: 1, complete: true, faithful: true, skipped: [] }],
        },
        {
          label: "D",
          items: [
            { id: "TA1", verdict: "partly", items: [1], reason: "overstates" },
            { id: "TT6", verdict: "avoided", items: [], reason: "" },
          ],
          beyond: [{ item: 1, verdict: "speculative", why: "" }],
          chains: [{ item: 1, complete: true, faithful: false, skipped: [] }],
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
  const results = JSON.parse(await readFile(join(run, "results.json"), "utf8"));
  assert.deepEqual(errorsOf("results", results), []);
  const job = (it: string) =>
    results.jobs.find((j: { id: string }) => j.id === it);
  assert.equal(job(POD).status, "done");
  assert.deepEqual(Object.keys(job(REC).split.questions), questions);
  assert.equal(job(REC).split.shared.calls, 2);
  assert.ok(job(REC).split.questions["blood-clot"].recordsTokens > 0);
  assert.deepEqual(
    results.asked.map((it: { question: string }) => it.question),
    ["blood-clot", "allergies", "blood-clot", "allergies"],
  );
  const cited = results.evidence.find(
    (it: { job: string; question: string }) =>
      it.job === REC && it.question === "blood-clot",
  );
  assert.equal(cited.passage.resource, "DiagnosticReport/dr-1");
  assert.match(cited.passage.text, /No pulmonary embolism/);
  assert.deepEqual(cited.passage.download, PULL);
  const looked = results.evidence.find(
    (it: { job: string; question: string; absence?: number }) =>
      it.job === POD && it.question === "blood-clot" && it.absence === 0,
  );
  assert.deepEqual([looked.call.rows, looked.call.milliseconds], [1, 12]);
  const [tamsin] = results.cases;
  assert.equal(tamsin.build.seconds, 3.1);
  assert.ok(tamsin.sessions.some((it: { id: string }) => it.id === "worries"));
  assert.ok(
    tamsin.key.some(
      (it: { id: string; question: string }) =>
        it.id === "TN1" && it.question === "blood-clot",
    ),
  );
  assert.match(
    tamsin.keyUrl,
    /cascade-runtime-js\/blob\/0000000\/packages\/evals\/cases\/tamsin-vale\/key\.md$/,
  );
  const [instance] = results.instances;
  assert.equal(instance.id, "tamsin-vale.opus-5-5.r1");
  assert.deepEqual(instance.arms.pod.expected, {
    found: 2,
    partly: 0,
    missed: 0,
    split: 0,
    ungraded: 0,
    of: 2,
  });
  assert.deepEqual(instance.arms.records.expected, {
    found: 1,
    partly: 1,
    missed: 0,
    split: 0,
    ungraded: 0,
    of: 2,
  });
  assert.equal(instance.arms.records.beyond.speculative, 1);
  assert.equal(instance.arms.records.citations.held, 1);
  assert.equal(instance.judging.usd, job(JUDGE).stats.cost.usd);
  assert.ok(instance.judging.usd > 0);
  assert.ok(instance.arms.pod.usd > 0);
  assert.equal(instance.arms.pod.usd, job(POD).stats.cost.usd);
  const index = await readFile(join(run, "site", "index.html"), "utf8");
  assert.match(index, /href="cases\/tamsin-vale\.html"/);
  assert.match(index, /2 of 2 found/);
  const page = await readFile(
    join(run, "site", "cases", "tamsin-vale.html"),
    "utf8",
  );
  for (const said of [
    "Did I ever have a blood clot in my lung?",
    "The CT angiogram of 8 July 2025 found no pulmonary embolism.",
    "A clot in the lung was looked for on 8 July 2025 and ruled out.",
    "judge haiku-5-5",
  ])
    assert.ok(page.includes(said), `the case page shows ${said}`);
});
