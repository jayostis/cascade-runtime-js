import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, test } from "node:test";
import type { Answer } from "../src/checks.js";
import { loadCase } from "../src/cases.js";
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

/**
 * A run of both arms' answers, planned for the given judges: one chat of one question for tamsin-vale, or with a case
 * named every chat the case has.
 */
async function runOf(name: string, judges: string[], caseId?: string) {
  const folder = join(temporary, name);
  await mkdir(join(folder, "answers"), { recursive: true });
  await mkdir(join(folder, "prompts"), { recursive: true });
  const sessions =
    caseId === undefined
      ? [{ id: "checkup", questions: [{ id: "checkup" }] }]
      : (await loadCase(caseId)).sessions;
  const subjects = sessions.flatMap((session) =>
    (
      [
        ["pod", "Has a colonoscopy been booked?"],
        ["records", "Should I have a colonoscopy now?"],
      ] as const
    ).map(([arm, text]) => ({
      id:
        caseId === undefined
          ? arm === "pod"
            ? POD
            : RECORDS
          : `${caseId}.${session.id}.${arm}.opus-5-5.r1`,
      arm,
      text,
      session,
    })),
  );
  const subject = ({ id, arm, session }: (typeof subjects)[0]) => ({
    id,
    role: "subject",
    case: caseId ?? "tamsin-vale",
    arm,
    model: "claude-opus-5-5",
    repeat: 1,
    session: session.id,
    questions: session.questions.map((it) => it.id),
    tag: `${name}/${id}`,
    status: "done",
    estimate: { tokens: 0, usd: 0 },
    answers: `answers/${id}`,
  });
  for (const { id, text, session } of subjects) {
    await mkdir(join(folder, "answers", id), { recursive: true });
    for (const question of session.questions)
      await writeFile(
        join(folder, "answers", id, `${question.id}.json`),
        JSON.stringify(answer(text)),
      );
  }
  await writeFile(
    join(folder, "plan.json"),
    JSON.stringify({
      run: name,
      folder,
      config: { judges },
      cases: [{ id: caseId ?? "tamsin-vale" }],
      jobs: subjects.map(subject),
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

/** What names a source or the pod's own vocabulary and nothing else: a scrubbed answer holds none of it. */
const UNAMBIGUOUS = new RegExp(
  [
    String.raw`\b(?:Observation|Condition|MedicationStatement|MedicationRequest|DiagnosticReport|AllergyIntolerance)\/`,
    String.raw`\.(?:xml|json)\b|\bsummary-\d|\bexport_cda\b`,
    String.raw`\b(?:pod|record|entry)\/\S|urn:uuid|\b(?:lab_series|find_changes)\b`,
    String.raw`workflowStatus|medicationUseEndDate|resultInterpretationCode|verificationStatus|RefutedAtSource`,
  ].join("|"),
);

const INNOCENT = [
  "Your last 3 results of potassium",
  "6.9 in 5 results",
  "Immunization is incomplete",
  "Procedure: colonoscopy",
  "Patient has had",
  "community resources help",
  "She can pull the bundle of care",
  "Type 2 diabetes is an active condition.",
  "Every lab result (21 rows) through the records.",
  "Your iPhone and an mRNA shot; mmHg and hbA1c.",
  "Condition/diabetes mellitus, Medication/dose changes, Procedure/Immunization schedule",
  "amlodipine/benazepril at 148/92, 1/2 tablet, 2/day",
  "record/keeping matters and entry/exit counts, pod/names",
  "GlaxoSmithKline made it",
  "Patient. The Bundle. Done",
  "See https://example.org/page for it",
];

/** Lines of a pod-style answer and of a file-citing one, as the reviewer's probes found them. */
const POD_LINES = [
  "The My lab results view shows one row with records 2, source Fernhill, flagged H",
  "I queried the pod: lab_series 13457-7 gives LDL 142; the lead record is the pharmacy's",
  "It appears under What each version says with workflowStatus stopped and medicationUseEndDate 2026-03-05",
  "resultInterpretationCode H and verificationStatus refuted, RefutedAtSource",
  "entry/What it shows and record/What each version says --where field=x#dateOfBirth, pod/My active medications",
];
const FILE_LINES = [
  "kestrel-harbor-health-summary-4.xml line 211 says repeat TSH in 6-8 weeks",
  "In the Fernhill document (summary-5), the medications table lists HCTZ",
  "Observation/story-stopped-a1c-9 and MedicationRequest/story-stopped-medrx-2 were merged in the latest download",
  "export_cda.xml and x-e8/apple_health_export/clinical-records/Condition-cond-htn-1.json cannot be read",
  "DiagnosticReport/story-stopped-dr-1 says no pulmonary embolism, urn:uuid:abc",
];

const lineAnswer = (lines: readonly string[]): Answer => ({
  answer: lines.join(" "),
  short: lines[0]!,
  items: [
    {
      n: 1,
      says: lines[1]!,
      why: lines[2]!,
      confidence: "high",
      facts: [
        {
          says: lines[3]!,
          provider: lines[4]!,
          cite: { entry: "x" },
          value: "1",
        },
      ],
      absences: [
        {
          what: lines[0]!,
          coverage: "c",
          match: { terms: ["x"] },
          query: { tool: "ask", input: {} },
        },
      ],
    },
  ],
});

test("the scrubber puts one placeholder where an unambiguous token was and changes nothing else", async () => {
  const { scrubbed } = await import("../src/judging.js");
  for (const lines of [POD_LINES, FILE_LINES]) {
    const packet = lines.map(scrubbed).join(" ~ ");
    assert.doesNotMatch(packet, UNAMBIGUOUS);
    assert.match(packet, /\[record\]/);
    assert.doesNotMatch(packet, /\[record\]\s*\[record\]|\s{2,}|\(\s*\)/);
  }
  assert.equal(
    scrubbed("Observation/story-stopped-a1c-9 has an A1c of 6.9."),
    "[record] has an A1c of 6.9.",
  );
  assert.equal(
    scrubbed("kestrel-harbor-health-summary-4.xml line 211 says no."),
    "[record] says no.",
  );
  assert.equal(
    scrubbed("see Observation/a-1, Condition/b-2 and summary-5 for it"),
    "see [record] for it",
  );
  for (const said of INNOCENT) assert.equal(scrubbed(said), said, said);
});

test("the scrubber replaces an id-shaped resource reference whole and a view-or-id path, and the new tokens", async () => {
  const { scrubbed } = await import("../src/judging.js");
  const cases: readonly (readonly [string, string])[] = [
    ["Patient/123 is here", "[record] is here"],
    ["Condition/diabetes mellitus", "Condition/diabetes mellitus"],
    ["entry/e-12 then pod/kestrel-harbor", "[record] then [record]"],
    ["record/keeping and entry/exit", "record/keeping and entry/exit"],
    ["see http://example.org/ns#workflowStatus now", "see [record] now"],
    [
      "at https://fhir.example.org/r/x; https://snomed.info/id/123.",
      "at [record]; [record].",
    ],
    ["id 0b1f6a52-8c3d-4e7a-9d10-5a1b2c3d4e5f ok", "id [record] ok"],
    ["ran reference_table_checks then", "ran [record] then"],
    ["Patient.birthDate; Observation.value[0].quantity", "[record]; [record]"],
    ["RefutedAtSource and GlaxoSmithKline", "[record] and GlaxoSmithKline"],
  ];
  for (const [said, want] of cases) assert.equal(scrubbed(said), want, said);
});

test("a blinded answer for either arm has no unambiguous token and keeps its innocent sentences byte-identical", () => {
  for (const lines of [POD_LINES, FILE_LINES])
    assert.doesNotMatch(blinded(lineAnswer(lines)), UNAMBIGUOUS);
  const text = blinded(lineAnswer(INNOCENT));
  for (const said of INNOCENT) assert.ok(text.includes(said), said);
});

test("the tells a scrubber cannot remove are recorded by a fixed list, with the arm and question, and stay in the text", async () => {
  const { scrubbed, tellsOf, tellsIn } = await import("../src/judging.js");
  const said =
    "Merged into one row; seen in 3 sources; records 2; My lab results; What each version says; in the latest document copies, the CDA narrative section on the PDF page; the importer and the timeline";
  assert.equal(scrubbed(said), said);
  assert.deepEqual(tellsOf(said), [
    "merged",
    "seen in N sources",
    "records N",
    "My view",
    "What each version says",
    "document",
    "copies",
    "section",
    "narrative",
    "CDA",
    "page",
    "PDF",
    "latest",
    "importer",
    "timeline",
    "one row",
  ]);
  assert.deepEqual(tellsOf("Your last 3 results of potassium"), []);
  const answer = lineAnswer(["The document has a page", "x", "x", "x", "x"]);
  assert.deepEqual(
    tellsIn({ job: "j", arm: "records", question: "q" }, answer),
    [
      { job: "j", arm: "records", question: "q", term: "document" },
      { job: "j", arm: "records", question: "q", term: "page" },
    ],
  );
});

test("a judge reads what the key says of the ED's tamsulosin and the research numbers, and the at-scale P14 says not credited", async () => {
  const { judges } = await runOf(
    "tells-key",
    ["claude-haiku-5-5"],
    "priya-natarajan",
  );
  const packet = await readFile(judges[0]!.packet!, "utf8");
  assert.match(
    packet,
    /Another source lists it completed; either state is not false\./,
  );
  assert.match(packet, /research #N/);
  const scale = await runOf(
    "tells-scale",
    ["claude-haiku-5-5"],
    "priya-natarajan-at-scale",
  );
  const text = await readFile(scale.judges[0]!.packet!, "utf8");
  assert.match(text, /research #N/);
  assert.match(text, /not penalised, and not credited/);
});

test("a packet carries the key's prose without its old scoring rules, so one vocabulary reaches the judge", async () => {
  const { judges } = await runOf("vocabulary", ["claude-haiku-5-5"]);
  const packet = await readFile(judges[0]!.packet!, "utf8");
  assert.match(packet, /## Planted gaps|## Tamsin/);
  assert.doesNotMatch(packet, /## Scoring rules|## How to score/);
});

test("a verdict of the wrong kind for its key item is rejected, so counts never gain a stray key", async () => {
  const { gradesOf } = await import("../src/judging.js");
  const folder = join(temporary, "wrong-kind");
  await mkdir(folder, { recursive: true });
  const item = (id: string, verdict: string) => ({
    id,
    verdict,
    items: [1],
    reason: "",
  });
  await writeFile(
    join(folder, "v.json"),
    JSON.stringify({
      outputs: [
        // TF1 is a fact and TT3 a trap: "raised" and "found" are each the other's verdict
        { label: "A", items: [item("TF1", "raised")], beyond: [], chains: [] },
        { label: "B", items: [item("TT3", "found")], beyond: [], chains: [] },
        {
          label: "C",
          items: [item("TF1", "found"), item("TT3", "avoided")],
          beyond: [],
          chains: [],
        },
      ],
    }),
  );
  const at = (label: string) => ({ job: POD, question: "medications", label });
  const grades = await gradesOf({
    folder,
    jobs: [
      {
        id: "j",
        role: "judge",
        case: "tamsin-vale",
        verdict: "v.json",
        labels: { A: at("A"), B: at("B"), C: at("C") },
      },
    ],
  } as never);
  assert.equal(grades.length, 1);
  assert.deepEqual(
    grades[0]!.items.map((it) => it.verdict),
    ["found", "avoided"],
  );
});

/** What would tell a judge which arm wrote an answer: the arms by name, what the pod holds and how it is read. */
const ARM_TERMS = new RegExp(
  [
    String.raw`\b(?:pods?|dump|grab.?bag|importer|views?|kits?|narrative-only)\b`,
    String.raw`\b(?:pod|records?|either|both) arms?\b`,
    String.raw`\b(?:first|second) answers?\b`,
    String.raw`\b(?:pod|record|entry)/\S+`,
    String.raw`\b(?:lab_series|find_changes|cascade-mcp|pod\.mjs)\b`,
    String.raw`\bMy (?:(?:active|lab|medication|procedure|immunization|allergy|condition)\w* ?)+`,
    String.raw`\b(?:What was seen more than once|Why it is in no view|Where it came from|What it shows)\b`,
  ].join("|"),
  "gi",
);

test("no judge packet, for any case, names an arm or what only one arm holds", async () => {
  const { caseIds } = await import("../src/cases.js");
  const leaks: string[] = [];
  for (const id of await caseIds()) {
    const { judges } = await runOf(`blind-${id}`, ["claude-haiku-5-5"], id);
    const [judge] = judges;
    assert.ok(judge?.packet !== undefined, id);
    for (const [what, path] of [
      ["packet", judge.packet],
      ["prompt", join(judge.workdir!, "prompt.txt")],
    ] as const) {
      const lines = (await readFile(path, "utf8")).split("\n");
      for (const [at, line] of lines.entries())
        for (const found of new Set(line.match(ARM_TERMS) ?? []))
          leaks.push(
            `${id} ${what}:${at + 1} "${found}": ${line.trim().slice(0, 100)}`,
          );
    }
  }
  assert.deepEqual(leaks, []);
});
