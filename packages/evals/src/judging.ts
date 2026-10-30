// Blind judging: each case's answers stripped of what would say how they reached the records, shuffled under
// letters, and given with the key to each judge; the verdicts turned back into grades per answer, scores, and the
// judges' agreement.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Key, loadCase, loadKey, sha256 } from "./cases.js";
import type { Answer } from "./checks.js";
import { aliasOf, loadPlan, pastJobs, type Plan, savePlan } from "./plan.js";
import { PROMPT_VERSIONS, judgePrompt } from "./prompts.js";
import { SCHEMAS } from "./paths.js";
import { callCost } from "./prices.js";
import type { Grade, Job, Score } from "./results.js";
import { runFolder } from "./results.js";
import { errorsOf } from "./schemas.js";

/** Words and names that would tell a judge how an answer reached the records. */
const REVEALING =
  /\b(?:cascade-mcp|MCP|pods?|tools?|quer(?:y|ied|ies)|files?|bundle\.json|pull\.json|export\.xml|entry IRI|lead (?:record|member)|non-lead|\d+ rows?)\b|pod:\/\/\S+|urn:uuid:\S+|ni:\/\/\/\S+|[\w./-]+\.(?:xml|json)\b|line \d+/gi;

export const scrubbed = (text: string) => text.replace(REVEALING, "[…]");

/** An answer as a judge reads it: the questions, their facts as sources and dates, absences, knowledge; no citations. */
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
        ...q.absences.map(
          (a) =>
            `- Absent: ${scrubbed(a.what)} (looked through: ${scrubbed(a.coverage)})`,
        ),
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

/**
 * Writes each case's blind packet and plans its judges, one per model the config names: a judge's inputs are the
 * answers, the key, its model and its prompt, and a judge with the same inputs in an earlier run is reused.
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
    const texts = new Map<string, string>();
    for (const job of subjects)
      texts.set(job.id, await readFile(join(folder, job.answer!), "utf8"));
    const order = [...subjects].sort((a, b) =>
      sha256(`${plan.run}/${a.id}`).localeCompare(
        sha256(`${plan.run}/${b.id}`),
      ),
    );
    const labels: Record<string, string> = {};
    order.forEach((job, at) => (labels[labelAt(at)] = job.id));
    const { key, sha256: keySha, prose } = await loadKey(caseId);
    const found = await loadCase(caseId);
    const packet = [
      `# Blind packet: ${found.person.name}, as of ${found.today}`,
      "## The key, prose half",
      prose,
      "## The key, machine-readable half",
      "```json",
      JSON.stringify(
        {
          ...key,
          items: key.items.map(({ pod: _pod, find: _find, ...item }) => item),
        },
        null,
        2,
      ),
      "```",
      "## The answers",
      ...Object.entries(labels).map(([label, id]) => {
        let body: string;
        try {
          body = blinded(JSON.parse(texts.get(id)!) as Answer);
        } catch {
          body = "(the answer is not valid JSON)";
        }
        return `## Answer ${label}\n\n${body}`;
      }),
    ].join("\n\n");
    const packetPath = join(folder, "judges", `${caseId}.md`);
    await writeFile(packetPath, packet);
    const answersHash = sha256(
      [...texts.entries()]
        .map(([, text]) => sha256(text))
        .sort()
        .join(),
    );
    for (const [at, model] of plan.config.judges.entries()) {
      const id = `${caseId}.judge.${model.replace(/^claude-/, "")}.j${at + 1}`;
      if (plan.jobs.some((it) => it.id === id)) continue;
      const verdict = `judges/${id}.json`;
      const inputsHash = sha256(
        JSON.stringify({
          role: "judge",
          answersHash,
          keySha,
          model,
          prompt: PROMPT_VERSIONS.judge,
          at,
        }),
      );
      const tag = `${plan.run}/${id}`;
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
      };
      const earlier = past.find(
        (it) =>
          it.job.inputsHash === inputsHash && it.job.verdict !== undefined,
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
          stats: earlier.job.stats,
          calls: earlier.job.calls,
        });
      }
      await writeFile(
        join(folder, job.prompt!),
        judgePrompt({
          tag,
          pronoun: found.person.pronoun,
          today: found.today,
          packet: packetPath,
          verdict: join(folder, verdict),
          schema: join(SCHEMAS, "verdict.schema.json"),
        }),
      );
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

/** A judge's estimate: past judges of the case and model, else the packet read once and a verdict written. */
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
