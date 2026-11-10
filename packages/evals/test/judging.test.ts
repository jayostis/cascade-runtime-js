import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  configureTables,
  numberedReply,
  openPod,
  type Reply,
} from "cascade-runtime";
import { caseIds, loadCase } from "../src/cases.js";
import {
  blinded,
  gradesOf,
  judgePackets,
  scrubbed,
  tellsIn,
  tellsOf,
  verdictProblems,
} from "../src/judging.js";
import { RUNS } from "../src/paths.js";
import type { Job } from "../src/results.js";
import { smoke } from "./smoke-answers.js";

const temporary = await mkdtemp(join(tmpdir(), "cascade-evals-judging-"));
const earlier = join(RUNS, "test-earlier-letters");
after(async () => {
  await rm(temporary, { recursive: true, force: true, maxRetries: 5 });
  await rm(earlier, { recursive: true, force: true, maxRetries: 5 });
});

const answer = (says: string): Reply => ({
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

/** The packet a judge is handed for one pod-arm job whose answer file holds `text`, the pod it is asked of given when the answer needs one. */
async function packetOf(
  name: string,
  text: string,
  prepared?: { pods: string; pod: string },
) {
  const folder = join(temporary, name);
  await mkdir(join(folder, "answers", POD), { recursive: true });
  await mkdir(join(folder, "prompts"), { recursive: true });
  await writeFile(join(folder, "answers", POD, "checkup.json"), text);
  await writeFile(
    join(folder, "plan.json"),
    JSON.stringify({
      run: name,
      folder,
      config: { judges: ["claude-haiku-5-5"] },
      cases: [
        { id: "tamsin-vale", ...(prepared === undefined ? {} : { prepared }) },
      ],
      jobs: [
        {
          id: POD,
          role: "subject",
          case: "tamsin-vale",
          arm: "pod",
          model: "claude-opus-5-5",
          repeat: 1,
          session: "checkup",
          questions: ["checkup"],
          tag: `${name}/${POD}`,
          status: "done",
          estimate: { tokens: 0, usd: 0 },
          answers: `answers/${POD}`,
        },
      ],
      estimate: { tokens: 0, usd: 0 },
    }),
  );
  await judgePackets(folder);
  const plan = JSON.parse(
    await readFile(join(folder, "plan.json"), "utf8"),
  ) as { jobs: { role: string; packet?: string }[] };
  return readFile(plan.jobs.find((it) => it.role === "judge")!.packet!, "utf8");
}

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

const lineAnswer = (lines: readonly string[]): Reply => ({
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

/** A reply with one fact, as a pod-arm model wrote it. */
const withFact = (fact: object) =>
  ({
    answer: "a",
    short: "s",
    items: [{ n: 1, says: "p", why: "w", confidence: "high", facts: [fact] }],
  }) as Reply;

/**
 * A judge grades both arms' answers without knowing which arm wrote which. Its packet holds the answers under letters,
 * stripped of what only one arm writes, and what cannot be stripped is recorded as a tell. What an answer must be to
 * be shown is decided by "Checking a model's reply against a person's records · checkReply(), replyErrors(),
 * replySchema, numberedReply()" on cascade-runtime's page.
 */
describe("Blinding the answers a judge reads · judgePackets(), blinded(), scrubbed(), tellsOf()", () => {
  describe("judgePackets(run)", () => {
    let one: Awaited<ReturnType<typeof runOf>>;
    let packet: string;

    before(async () => {
      one = await runOf("one", ["claude-haiku-5-5"]);
      packet = await readFile(one.judges[0]!.packet!, "utf8");
    });

    it("gives each judge a folder outside the run that holds only its packet and its prompt", () => {
      const [judge] = one.judges;
      assert.ok(judge?.workdir !== undefined && judge.packet !== undefined);
      assert.deepEqual(readdirSync(judge.workdir).sort(), [
        "packet.md",
        "prompt.txt",
      ]);
      assert.ok(relative(one.folder, judge.workdir).startsWith(".."));
    });

    it("leaves each answer's citations and coverage out of the packet", () => {
      assert.doesNotMatch(
        packet.slice(packet.indexOf("## The questions and their answers")),
        /pod:\/\/|\bpod\b|21 rows|retriev|\[…\]/i,
      );
    });

    it("draws the letters in more than one order across runs", async () => {
      const orders = new Set<string>();
      for (const run of ["r1", "r2", "r3", "r4", "r5", "r6"]) {
        const { judges } = await runOf(run, ["claude-haiku-5-5"]);
        orders.add(JSON.stringify(judges[0]!.labels));
      }
      assert.equal(orders.size, 2, "the order varies with the run");
    });

    it("reuses a recorded verdict with the letters it was written to", async () => {
      const { judges } = await runOf("two", ["claude-haiku-5-5"]);
      const [planned] = judges;
      // Letters no run of this harness hands out, so only the earlier verdict's own can be what the reuse keeps.
      const swapped = {
        Y: { job: POD, question: "checkup" },
        Z: { job: RECORDS, question: "checkup" },
      };
      const stats = {
        calls: 1,
        models: ["claude-haiku-5-5"],
        tokens: {
          input: 0,
          cacheCreation: 0,
          cacheRead: 0,
          output: 0,
          total: 0,
        },
        contextPeak: 0,
        toolCalls: { total: 0, byName: {} },
        wallSeconds: 0,
        cost: { usd: 0, basis: "exact", priceTable: "2026-10-06" },
        usageSource: "transcript",
      };
      try {
        await mkdir(join(earlier, "judges"), { recursive: true });
        await writeFile(join(earlier, "judges", "verdict.json"), "{}");
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
      } finally {
        await rm(earlier, { recursive: true, force: true, maxRetries: 5 });
      }
    });

    it("carries the key's prose without a section of scoring rules", () => {
      assert.match(packet, /## Planted gaps|## Tamsin/);
      assert.doesNotMatch(packet, /## Scoring rules|## How to score/);
    });

    it("shows each item of an answer under its number, by its place when the answer gives none", async () => {
      const pods = join(temporary, "packet-numbers-pods");
      configureTables({ checkOnOpen: false });
      await (
        await openPod(join(pods, "tamsin-vale"), { title: "tamsin-vale" })
      ).close();
      const given = smoke("pod-blood-clot");
      const shown = await packetOf("packet-numbers", JSON.stringify(given), {
        pods,
        pod: "tamsin-vale",
      });
      assert.match(shown, /### Item 1\. /);
      assert.match(shown, /### Item 2\. /);
      assert.equal(shown.match(/### Item \d+\. /g)?.length, given.items.length);
    });
  });

  describe("given an answer that breaks the reply contract", () => {
    let packet: string;

    before(async () => {
      packet = await packetOf(
        "packets",
        JSON.stringify({ answer: "x", short: "y" }),
      );
    });

    it("says in the packet that it is not a valid answer, and where it breaks", () => {
      assert.match(packet, /not a valid answer/);
      assert.match(packet, /items/);
    });
  });

  describe("blinded(reply)", () => {
    it("shows every item, also one with no fact and no absence", () => {
      for (const name of [
        "pod-allergies",
        "records-allergies",
        "pod-medications",
      ]) {
        const reply = smoke(name);
        const shown = blinded(numberedReply(reply) as Reply);
        for (const [at] of reply.items.entries())
          assert.match(shown, new RegExp(`### Item ${at + 1}. `), name);
      }
    });

    it("shows an item's own knowledge on a line of its own", () => {
      const reply = smoke("pod-allergies");
      const knowledgeOnly = reply.items.find(
        (it) => it.facts === undefined && it.absences === undefined,
      );
      assert.ok(knowledgeOnly?.knowledge !== undefined);
      assert.match(
        blinded(numberedReply(reply) as Reply),
        new RegExp(`- Knowledge: ${knowledgeOnly.knowledge.says.slice(0, 20)}`),
      );
    });

    it("shows an absence by what it says is absent, and nothing of how it was looked for", () => {
      assert.match(blinded(answer("Q")), /- Absent: No colonoscopy$/m);
    });

    it("shows a link between facts of two items", () => {
      const fact = (says: string) => ({
        says,
        cite: { entry: "pod://p/clinical/medications.ttl#a" },
        field: "name",
      });
      const item = (n: number, says: string) => ({
        n,
        says,
        why: "",
        confidence: "high",
        facts: [fact(says)],
        absences: [],
      });
      const linked = {
        answer: "r",
        short: "s",
        items: [
          item(1, "Metformin listed active"),
          item(2, "Metformin completed"),
        ],
        links: [
          {
            from: { item: 1, fact: 0 },
            to: { item: 2, fact: 0 },
            says: "the later copy closes the earlier one",
          },
        ],
      } as Reply;
      assert.match(
        blinded(linked),
        /^- Link: item 1 fact 0 to item 2 fact 0: the later copy closes the earlier one$/m,
      );
      assert.doesNotMatch(blinded({ ...linked, links: [] }), /- Link:/);
    });

    it("removes every token the scrubber removes, from every part of a reply", () => {
      for (const lines of [POD_LINES, FILE_LINES])
        assert.doesNotMatch(blinded(lineAnswer(lines)), UNAMBIGUOUS);
    });

    it("keeps a sentence that names no record byte for byte", () => {
      const text = blinded(lineAnswer(INNOCENT));
      for (const said of INNOCENT) assert.ok(text.includes(said), said);
    });
  });

  describe("given a fact that points at a view entry (`blinded(reply, filled)`)", () => {
    let shown: string;

    before(() => {
      shown = blinded(
        withFact({
          says: "Her A1c was 6.9%.",
          cite: { entry: "Lcd05f84f" },
          field: "value",
          source: "S12",
        }),
        () => ({
          entry: "pod://p/clinical/lab-results.ttl#cd05f84f",
          label: "Hemoglobin A1c",
          value: "6.9 %",
          date: "2025-09-22",
          dateKind: "when",
          held: ["6.9"],
          sources: ["S12 Northbay Clinical Laboratories"],
        }),
      );
    });

    it("shows the fact with what the pod holds of that view entry", () => {
      assert.match(
        shown,
        /^- Fact 0: Northbay Clinical Laboratories, 2025-09-22: Her A1c was 6\.9%\. \(the record: Hemoglobin A1c: 6\.9 %\)$/m,
      );
    });

    it("shows no handle, and no source's short name as a compact read gives it", () => {
      assert.doesNotMatch(shown, /S12|Lcd05f84f/);
    });
  });

  describe("given a fact that copies what its record says (`blinded(reply)`)", () => {
    it("shows the fact as the reply wrote it, with no record of the program's beside it", () => {
      const copied = blinded(
        withFact({
          says: "Her A1c was 6.9%.",
          provider: "Northbay Clinical Laboratories",
          cite: { file: "lab.xml", line: 3 },
          name: "Hemoglobin A1c",
          value: 6.9,
          unit: "%",
          date: "2025-09-22",
        }),
      );
      assert.match(
        copied,
        /^- Fact 0: Northbay Clinical Laboratories, 2025-09-22: Her A1c was 6.9%.$/m,
      );
    });
  });

  describe("scrubbed(text)", () => {
    it("replaces a FHIR resource reference or element path with `[record]`", () => {
      for (const [said, want] of [
        [
          "Observation/story-stopped-a1c-9 has an A1c of 6.9.",
          "[record] has an A1c of 6.9.",
        ],
        ["Patient/123 is here", "[record] is here"],
        [
          "Patient.birthDate; Observation.value[0].quantity",
          "[record]; [record]",
        ],
      ] as const)
        assert.equal(scrubbed(said), want, said);
    });

    it("replaces a file's name and line with `[record]`", () => {
      assert.equal(
        scrubbed("kestrel-harbor-health-summary-4.xml line 211 says no."),
        "[record] says no.",
      );
    });

    it("replaces an IRI, an id, a path that names a view or an id, or a name only the pod holds with `[record]`", () => {
      for (const [said, want] of [
        ["entry/e-12 then pod/kestrel-harbor", "[record] then [record]"],
        ["see http://example.org/ns#workflowStatus now", "see [record] now"],
        [
          "at https://fhir.example.org/r/x; https://snomed.info/id/123.",
          "at [record]; [record].",
        ],
        ["id 0b1f6a52-8c3d-4e7a-9d10-5a1b2c3d4e5f ok", "id [record] ok"],
        ["ran reference_table_checks then", "ran [record] then"],
        ["RefutedAtSource and GlaxoSmithKline", "[record] and GlaxoSmithKline"],
      ] as const)
        assert.equal(scrubbed(said), want, said);
    });

    it("replaces several in one sentence, each once", () => {
      assert.equal(
        scrubbed("see Observation/a-1, Condition/b-2 and summary-5 for it"),
        "see [record] for it",
      );
    });

    it("removes every unambiguous token, a placeholder in its place", () => {
      for (const lines of [POD_LINES, FILE_LINES]) {
        const text = lines.map(scrubbed).join(" ~ ");
        assert.doesNotMatch(text, UNAMBIGUOUS);
        assert.match(text, /\[record\]/);
      }
    });

    it("leaves no doubled placeholder, doubled space or empty brackets", () => {
      for (const lines of [POD_LINES, FILE_LINES])
        assert.doesNotMatch(
          lines.map(scrubbed).join(" ~ "),
          /\[record\]\s*\[record\]|\s{2,}|\(\s*\)/,
        );
    });

    it("returns a sentence that names no record unchanged", () => {
      for (const said of INNOCENT) assert.equal(scrubbed(said), said, said);
    });
  });

  describe("tellsOf(text)", () => {
    const said =
      "Merged into one row; seen in 3 sources; records 2; My lab results; What each version says; in the latest document copies, the CDA narrative section on the PDF page; the importer and the timeline";

    it("lists each wording of a fixed list that the text holds", () => {
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
    });

    it("returns none for a sentence that holds none", () => {
      assert.deepEqual(tellsOf("Your last 3 results of potassium"), []);
    });

    it("leaves the tell in the text", () => {
      assert.equal(scrubbed(said), said);
    });
  });

  describe("tellsIn(at, reply)", () => {
    it("records each tell with its arm and question", () => {
      const reply = lineAnswer(["The document has a page", "x", "x", "x", "x"]);
      assert.deepEqual(
        tellsIn({ job: "j", arm: "records", question: "q" }, reply),
        [
          { job: "j", arm: "records", question: "q", term: "document" },
          { job: "j", arm: "records", question: "q", term: "page" },
        ],
      );
    });
  });
});

/** A verdict grades each key item and each point an answer makes beyond the key. One that breaks its schema grades nothing and is reported, never half read. */
describe("Reading a judge's verdict · gradesOf(), verdictProblems()", () => {
  describe("gradesOf(plan)", () => {
    let wrongKind: Awaited<ReturnType<typeof gradesOf>>;
    let zero: Awaited<ReturnType<typeof gradesOf>>;

    before(async () => {
      const kind = join(temporary, "wrong-kind");
      await mkdir(kind, { recursive: true });
      const item = (id: string, verdict: string) => ({
        id,
        verdict,
        items: [1],
        reason: "",
      });
      await writeFile(
        join(kind, "v.json"),
        JSON.stringify({
          outputs: [
            // TF1 is a fact and TT3 a trap: "raised" and "found" are each the other's verdict
            {
              label: "A",
              items: [item("TF1", "raised")],
              beyond: [],
              chains: [],
            },
            {
              label: "B",
              items: [item("TT3", "found")],
              beyond: [],
              chains: [],
            },
            {
              label: "C",
              items: [item("TF1", "found"), item("TT3", "avoided")],
              beyond: [],
              chains: [],
            },
          ],
        }),
      );
      const at = (label: string) => ({
        job: POD,
        question: "medications",
        label,
      });
      wrongKind = await gradesOf({
        folder: kind,
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
      zero = await gradesOf(await zeroPlan());
    });

    it("drops a grade of the wrong kind for its key item", () => {
      assert.equal(wrongKind.length, 1);
      assert.deepEqual(
        wrongKind[0]!.items.map((it) => it.verdict),
        ["found", "avoided"],
      );
    });

    it("grades a point numbered 0, which is text outside every numbered item", () => {
      const graded = zero.find((it) => it.judge === "zero");
      assert.equal(graded?.beyond[0]?.item, 0);
    });

    it("returns no grade from a verdict that breaks the schema or is not yet written", () => {
      const judges = zero.map((it) => it.judge);
      for (const broken of ["negative", "unknown", "broken", "missing"])
        assert.ok(!judges.includes(broken), `${broken} is graded`);
    });
  });

  describe("verdictProblems(plan)", () => {
    it("lists each verdict that breaks the schema with its judge and the schema's errors, also one that is not JSON", async () => {
      const problems = await verdictProblems(await zeroPlan());
      assert.deepEqual(
        problems.map((it) => it.judge),
        ["negative", "unknown", "broken"],
        "a verdict not yet written is not a problem",
      );
      assert.match(problems[0]!.errors.join(), /item must be >= 0/);
      assert.match(problems[2]!.errors.join(), /JSON/i);
    });
  });
});

/** The plan of five judges of one question, one verdict file each: a point numbered 0, one numbered -1, one of an unknown verdict, one that is not JSON, and one not yet written. */
async function zeroPlan() {
  const folder = join(temporary, "item-zero");
  await mkdir(folder, { recursive: true });
  const output = (beyond: object[]) => ({
    label: "A",
    items: [{ id: "TF1", verdict: "found", items: [1], reason: "" }],
    beyond,
    chains: [],
  });
  const intro = { item: 0, verdict: "fair", why: "the closing paragraph" };
  const files = {
    zero: { outputs: [output([intro])] },
    negative: { outputs: [output([{ ...intro, item: -1 }])] },
    unknown: { outputs: [output([{ ...intro, verdict: "good" }])] },
  };
  for (const [name, verdict] of Object.entries(files))
    await writeFile(join(folder, `${name}.json`), JSON.stringify(verdict));
  await writeFile(join(folder, "broken.json"), "{ not json");
  const judge = (id: string) => ({
    id,
    role: "judge",
    case: "tamsin-vale",
    verdict: `${id}.json`,
    labels: { A: { job: POD, question: "medications", label: "A" } },
  });
  return {
    folder,
    jobs: [
      ...["zero", "negative", "unknown", "broken"].map(judge),
      { ...judge("missing"), verdict: "missing.json" },
    ],
  } as never;
}

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

describe("The cases in `cases/`, as checked in", () => {
  let packets: Map<string, { packet: string; prompt: string }>;

  before(async () => {
    packets = new Map();
    for (const id of await caseIds()) {
      const { judges } = await runOf(`blind-${id}`, ["claude-haiku-5-5"], id);
      const [judge] = judges;
      assert.ok(judge?.packet !== undefined, id);
      packets.set(id, {
        packet: await readFile(judge.packet, "utf8"),
        prompt: await readFile(join(judge.workdir!, "prompt.txt"), "utf8"),
      });
    }
  });

  describe("given every case's judge packet", () => {
    it("names neither arm, nor anything only one arm holds", () => {
      const leaks: string[] = [];
      for (const [id, { packet, prompt }] of packets)
        for (const [what, text] of [
          ["packet", packet],
          ["prompt", prompt],
        ] as const)
          for (const [at, line] of text.split("\n").entries())
            for (const found of new Set(line.match(ARM_TERMS) ?? []))
              leaks.push(
                `${id} ${what}:${at + 1} "${found}": ${line.trim().slice(0, 100)}`,
              );
      assert.deepEqual(leaks, []);
    });
  });

  describe("given the packets of priya-natarajan and priya-natarajan-at-scale", () => {
    it("holds what the key says of the emergency department's tamsulosin and of the research numbers", () => {
      const { packet } = packets.get("priya-natarajan")!;
      assert.match(
        packet,
        /Another source lists it completed; either state is not false\./,
      );
      assert.match(packet, /research #N/);
    });

    it("holds, at scale, that P14 is not penalised and not credited", () => {
      const { packet } = packets.get("priya-natarajan-at-scale")!;
      assert.match(packet, /research #N/);
      assert.match(packet, /not penalised, and not credited/);
    });
  });
});
