// Blind judging: each case's answers stripped of what would say how they reached the records, in an order of each
// judge's own, given with the key to each judge in a folder of its own that holds nothing else; the verdicts turned
// back into grades per answer through the letters that judge saw, scores, and the judges' agreement.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Key, loadCase, loadKey, sha256 } from "./cases.js";
import type { Answer } from "./checks.js";
import { aliasOf, loadPlan, pastJobs, type Plan, savePlan } from "./plan.js";
import { WORK } from "./paths.js";
import { judgePrompt, PROMPT_VERSIONS } from "./prompts.js";
import { callCost } from "./prices.js";
import type { Grade, Job, Score } from "./results.js";
import { runFolder } from "./results.js";
import { errorsOf } from "./schemas.js";

/**
 * Words that would tell a judge how an answer reached the records: tool and file names, the pod's own terms, row and
 * result counts, retrieval wording. They are taken out without a mark, since a mark would itself say which arm named
 * its tools.
 */
const REVEALING = new RegExp(
  [
    String.raw`\b(?:cascade-mcp|MCP|pods?|tools?|quer(?:y|ied|ies)|files?|lab_series|find_changes|finding_rows|list_pods)\b`,
    String.raw`\b(?:entry|entries|lead (?:record|member)|non-lead|bundles?|resources?|FHIR|C-CDA|XML|JSON|downloads?|exports?|pulls?)\b`,
    String.raw`\b\d+ (?:rows?|results?|records?|items?)\b`,
    String.raw`\bretriev\w*(?: (?:on )?\d{4}-\d{2}-\d{2}(?:,? (?:and )?\d{4}-\d{2}-\d{2})*)?`,
    String.raw`cascade:\S+|pod:\/\/\S+|urn:uuid:\S+|ni:\/\/\/\S+|[\w./-]+\.(?:xml|json)\b|\bline \d+`,
  ].join("|"),
  "gi",
);

/**
 * FHIR's resource names where they are used as names: capitalised, as a type or a reference ("Observation",
 * "Observation/abc", "the Condition resource"). The same words in prose ("an active condition", "the patient") stay.
 */
const RESOURCE_NAMES =
  /\b(?:Observation|Condition|MedicationStatement|MedicationRequest|Procedure|Immunization|DiagnosticReport|Patient|AllergyIntolerance|Encounter)s?(?:\/[\w.-]+)?(?: resources?)?\b/g;

export const scrubbed = (text: string) =>
  text
    .replace(RESOURCE_NAMES, "")
    .replace(REVEALING, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * An answer as a judge reads it: the questions, their facts as provider, date and words, what each says is absent
 * (never what it looked through, which differs by arm), and the knowledge; no citations.
 */
export function blinded(answer: Answer): string {
  return answer.questions
    .map((q) =>
      [
        `### Q${q.n}. ${scrubbed(q.question)}`,
        `- Why: ${scrubbed(q.why)}`,
        ...q.facts.map(
          (f) =>
            `- Fact: ${scrubbed(f.provider)}${f.date === undefined ? "" : `, ${f.date}`}: ${scrubbed(f.says)}`,
        ),
        ...q.absences.map((a) => `- Absent: ${scrubbed(a.what)}`),
        `- Knowledge: ${scrubbed(q.knowledge.says)}${q.knowledge.guideline === undefined ? "" : ` (${scrubbed(q.knowledge.guideline)})`}`,
        `- Confidence: ${q.confidence}`,
      ].join("\n"),
    )
    .join("\n\n");
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const labelAt = (at: number) =>
  at < 26
    ? LETTERS[at]!
    : `${LETTERS[Math.floor(at / 26) - 1]}${LETTERS[at % 26]}`;

const answered = (job: Job) =>
  job.role === "subject" && (job.status === "done" || job.status === "reused");

/** The key as a judge reads it: without where the pod holds each item or how to find it there. */
const judgesKey = (key: Key) => ({
  ...key,
  items: key.items.map(({ pod: _pod, find: _find, ...item }) => item),
});

/**
 * Writes a blind packet for each judge, in an order of its own, in a folder of its own outside the run, and plans the
 * judge. A judge's inputs are its packet (the answers, their order and the key), its model and its prompt; a judge with
 * the same inputs in an earlier run is reused with that run's verdict and the letters that verdict was written to.
 */
export async function judgePackets(given: string) {
  const folder = runFolder(given);
  const plan = await loadPlan(folder);
  if (plan.config.judges.length === 0) return { run: plan.run, judges: [] };
  await mkdir(join(folder, "judges"), { recursive: true });
  const past = await pastJobs();
  const planned: Job[] = [];
  for (const { id: caseId } of plan.cases) {
    const subjects = plan.jobs.filter(
      (it) =>
        it.case === caseId &&
        answered(it) &&
        existsSync(join(folder, it.answer!)),
    );
    if (subjects.length === 0) continue;
    const bodies = new Map<string, string>();
    for (const job of subjects) {
      let body: string;
      try {
        body = blinded(
          JSON.parse(
            await readFile(join(folder, job.answer!), "utf8"),
          ) as Answer,
        );
      } catch {
        body = "(the answer is not valid JSON)";
      }
      bodies.set(job.id, body);
    }
    const { key, prose } = await loadKey(caseId);
    const found = await loadCase(caseId);
    for (const [at, model] of plan.config.judges.entries()) {
      const id = `${caseId}.judge.${model.replace(/^claude-/, "")}.j${at + 1}`;
      if (plan.jobs.some((it) => it.id === id)) continue;
      // The order is the run's own, so a judge does not see the arms in the same places in every run; a reused
      // verdict brings the letters it was written to.
      const seed = `${plan.run}/${caseId}/${model}/${at}`;
      const order = [...subjects].sort((a, b) =>
        sha256(`${seed}/${a.id}`).localeCompare(sha256(`${seed}/${b.id}`)),
      );
      const labels: Record<string, string> = {};
      order.forEach((job, place) => (labels[labelAt(place)] = job.id));
      const packet = [
        `# Blind packet: ${found.person.name}, as of ${found.today}`,
        "## The key, prose half",
        prose,
        "## The key, machine-readable half",
        "```json",
        JSON.stringify(judgesKey(key), null, 2),
        "```",
        "## The answers",
        ...Object.entries(labels).map(
          ([label, job]) => `## Answer ${label}\n\n${bodies.get(job)}`,
        ),
      ].join("\n\n");
      const packetSha256 = sha256(packet);
      const workdir = join(WORK, "judging", plan.run, id);
      await rm(workdir, { recursive: true, force: true, maxRetries: 5 });
      await mkdir(workdir, { recursive: true });
      const packetPath = join(workdir, "packet.md");
      await writeFile(packetPath, packet);
      const inputsHash = sha256(
        JSON.stringify({
          role: "judge",
          // what the packet holds, not its order: the answers as the judge reads them and the key
          content: sha256(
            JSON.stringify({
              answers: [...bodies.values()].sort(),
              key: judgesKey(key),
              prose,
            }),
          ),
          model,
          at,
          prompt: PROMPT_VERSIONS.judge,
        }),
      );
      const tag = `${plan.run}/${id}`;
      const verdict = `judges/${id}.json`;
      const job: Job = {
        id,
        role: "judge",
        case: caseId,
        model,
        alias: aliasOf(model),
        tag,
        inputsHash,
        status: "pending",
        estimate: judgeEstimate(model, packet, past, caseId),
        verdict,
        prompt: `prompts/${id}.txt`,
        labels,
        workdir,
        packet: packetPath,
        packetSha256,
      };
      const earlier = past.find(
        (it) =>
          it.job.inputsHash === inputsHash &&
          it.job.verdict !== undefined &&
          it.job.labels !== undefined,
      );
      if (
        earlier !== undefined &&
        existsSync(join(earlier.folder, earlier.job.verdict!))
      ) {
        await copyFile(
          join(earlier.folder, earlier.job.verdict!),
          join(folder, verdict),
        );
        Object.assign(job, {
          status: "reused",
          reusedFrom: `${earlier.run}/${earlier.job.id}`,
          labels: earlier.job.labels,
          stats: earlier.job.stats,
          calls: earlier.job.calls,
          toolUses: earlier.job.toolUses,
        });
      }
      const prompt = judgePrompt({
        tag,
        pronoun: found.person.pronoun,
        today: found.today,
        packet: packetPath,
        verdict: join(workdir, "verdict.json"),
      });
      await writeFile(join(folder, job.prompt!), prompt);
      await writeFile(join(workdir, "prompt.txt"), prompt);
      plan.jobs.push(job);
      planned.push(job);
    }
  }
  const pending = planned.filter((it) => it.status === "pending");
  Object.assign(plan, {
    estimate: {
      tokens:
        plan.estimate.tokens +
        pending.reduce((sum, it) => sum + it.estimate.tokens, 0),
      usd:
        plan.estimate.usd +
        pending.reduce((sum, it) => sum + it.estimate.usd, 0),
    },
  });
  await savePlan(plan);
  return {
    run: plan.run,
    judges: planned.map(({ id, status, estimate }) => ({
      id,
      status,
      estimate,
    })),
  };
}

/** A judge's estimate: past judges of the case and model, else the packet read a few times and a verdict written. */
function judgeEstimate(
  model: string,
  packet: string,
  past: readonly { job: Job }[],
  caseId: string,
): { tokens: number; usd: number; basis: string } {
  const same = past.filter(
    ({ job }) =>
      job.role === "judge" && job.case === caseId && job.model === model,
  );
  if (same.length > 0) {
    const n = same.length;
    return {
      tokens: Math.round(
        same.reduce((sum, { job }) => sum + job.stats!.tokens.total, 0) / n,
      ),
      usd:
        same.reduce((sum, { job }) => sum + (job.stats!.cost.usd ?? 0), 0) / n,
      basis: `the mean of ${n} past judge(s)`,
    };
  }
  const read = Math.round(packet.length / 3.5) + 20_000;
  const output = 12_000;
  const calls = 4;
  return {
    tokens: calls * read + output,
    usd:
      callCost(model, {
        input: 0,
        cacheCreation: read,
        cacheRead: (calls - 1) * read,
        output,
      }) ?? 0,
    basis: "the packet's size",
  };
}

/** Each judge's verdict turned into a grade per answer it labelled. */
export async function gradesOf(plan: Plan): Promise<Grade[]> {
  const grades: Grade[] = [];
  for (const job of plan.jobs) {
    if (job.role !== "judge" || job.verdict === undefined) continue;
    const path = join(plan.folder, job.verdict);
    if (!existsSync(path)) continue;
    let verdict: {
      outputs: (Omit<Grade, "subject" | "judge"> & { label: string })[];
    };
    try {
      verdict = JSON.parse(await readFile(path, "utf8"));
    } catch {
      continue;
    }
    if (errorsOf("verdict", verdict).length > 0) continue;
    for (const { label, ...grade } of verdict.outputs) {
      const subject = job.labels?.[label];
      if (subject !== undefined)
        grades.push({ subject, judge: job.id, ...grade });
    }
  }
  return grades;
}

export async function scoresOf(
  plan: Plan,
  grades: readonly Grade[],
  answers: Readonly<Record<string, unknown>>,
): Promise<Score[]> {
  const keys = new Map<string, Key>();
  const scores: Score[] = [];
  for (const grade of grades) {
    const subject = plan.jobs.find((it) => it.id === grade.subject)!;
    if (!keys.has(subject.case!))
      keys.set(subject.case!, (await loadKey(subject.case!)).key);
    const key = keys.get(subject.case!)!;
    const kinds = new Map(key.items.map((it) => [it.id, it.kind]));
    const verdict = (id: string) =>
      grade.items.find((it) => it.id === id)?.verdict ?? "missed";
    const gaps = key.items.filter((it) => it.kind === "gap");
    const answer = answers[grade.subject] as Answer | undefined;
    scores.push({
      subject: grade.subject,
      judge: grade.judge,
      found: gaps.filter((it) => verdict(it.id) === "found").length,
      partly: gaps.filter((it) => verdict(it.id) === "partly").length,
      missed: gaps.filter((it) => verdict(it.id) === "missed").length,
      gaps: gaps.length,
      trapsRaised: grade.items.filter(
        (it) => kinds.get(it.id) !== "gap" && it.verdict === "raised",
      ).length,
      falseQuestions: grade.falseQuestions.length,
      extraFinds: grade.extraFinds.length,
      chainsComplete: grade.chains.filter((it) => it.complete).length,
      chainsFaithful: grade.chains.filter((it) => it.faithful).length,
      questions: answer?.questions?.length ?? grade.chains.length,
    });
  }
  return scores;
}

/** How often two judges of a case gave an item the same verdict, and Cohen's kappa over those verdicts. */
export async function agreementOf(plan: Plan, grades: readonly Grade[]) {
  const out: {
    case: string;
    judges: string[];
    items: number;
    agreed: number;
    kappa: number | null;
  }[] = [];
  for (const { id: caseId } of plan.cases) {
    const judges = plan.jobs
      .filter((it) => it.role === "judge" && it.case === caseId)
      .map((it) => it.id);
    for (let a = 0; a < judges.length; a++)
      for (let b = a + 1; b < judges.length; b++) {
        const pairs: [string, string][] = [];
        for (const one of grades.filter((it) => it.judge === judges[a]))
          for (const other of grades.filter(
            (it) => it.judge === judges[b] && it.subject === one.subject,
          ))
            for (const item of one.items) {
              const same = other.items.find((it) => it.id === item.id);
              if (same !== undefined) pairs.push([item.verdict, same.verdict]);
            }
        if (pairs.length === 0) continue;
        const agreed = pairs.filter(([x, y]) => x === y).length;
        const observed = agreed / pairs.length;
        const labels = [...new Set(pairs.flat())];
        const expected = labels.reduce(
          (sum, label) =>
            sum +
            (pairs.filter(([x]) => x === label).length / pairs.length) *
              (pairs.filter(([, y]) => y === label).length / pairs.length),
          0,
        );
        out.push({
          case: caseId,
          judges: [judges[a]!, judges[b]!],
          items: pairs.length,
          agreed,
          kappa: expected === 1 ? null : (observed - expected) / (1 - expected),
        });
      }
  }
  return out;
}
