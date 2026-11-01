// Blind judging: each sitting's answers (one case, model and repeat, both arms) stripped of what would say how they
// reached the records, each question's in an order of each judge's own, given with the key to each judge in a folder
// of its own that holds nothing else; the verdicts turned back into grades per answer through the letters that judge
// saw, and the judges' agreement.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Key, loadCase, loadKey, sha256 } from "./cases.js";
import { instanceOf } from "./instances.js";
import { answerPath } from "./sessions.js";
import type { Answer } from "./checks.js";
import { aliasOf, loadPlan, pastJobs, type Plan, savePlan } from "./plan.js";
import { WORK } from "./paths.js";
import { judgePrompt, PROMPT_VERSIONS } from "./prompts.js";
import { callCost } from "./prices.js";
import type { Grade, Job, Label } from "./results.js";
import { runFolder } from "./results.js";
import { errorsOf } from "./schemas.js";

const PLACEHOLDER = "[record]";

const RESOURCES =
  "Observation|Condition|MedicationStatement|MedicationRequest|MedicationAdministration|Medication|Procedure|Immunization|DiagnosticReport|Patient|AllergyIntolerance|Encounter|Practitioner|Organization|Location|DocumentReference|CarePlan|Provenance|Bundle";
const VIEWS =
  "My [a-z]+(?: [a-z]+)*|What it shows|What each version says|Where it came from|Why it is in no view|What was seen more than once";

/**
 * Tokens that name a source file or the pod's own vocabulary and nothing else: a resource reference (Name/id), a file
 * name or path with its line, a pod, record or entry path and the view it names, a vocabulary property or class name,
 * a tool's name. Each is replaced by one placeholder, the same for both arms; no word that is also prose is touched.
 */
const UNAMBIGUOUS = new RegExp(
  [
    String.raw`\b(?:${RESOURCES})\/[\w.:-]+`,
    String.raw`(?:[\w.-]+\/)*[\w.-]+\.(?:xml|json|ttl|pdf|csv|zip|txt)\b(?::\d+(?:-\d+)?)?`,
    String.raw`\b(?:[a-z][a-z0-9]*[-_])+(?:summary|record|results|cda)-\d+\b|\b(?:summary|record)-\d+\b`,
    String.raw`\b(?:[a-z][a-z0-9]*-)+(?:summary|patient-record)\b`,
    String.raw`(?<![\w/])(?:pod|record|entry)\/(?:${VIEWS}|\S+)(?: --\w+ \S+)*`,
    String.raw`\b(?:lab_series|find_changes|finding_rows|list_pods|export_cda|cascade-mcp)\b`,
    String.raw`\b(?:urn:uuid|cascade|pod|ni):(?:\/\/\/?)?[^\s,;)]+`,
    String.raw`\b[a-z]{3,}(?:[A-Z][a-z0-9]+)+\b|\b(?:[A-Z][a-z]+){3,}\b|\bRefutedAtSource\b`,
  ].join("|"),
  "g",
);

const JOINED = new RegExp(
  String.raw`\[record\](?:(?:\s*,\s*|\s+and\s+|\s+or\s+|\s*\/\s*|\s+)\[record\])+`,
  "g",
);

export const scrubbed = (text: string) =>
  text
    .replace(UNAMBIGUOUS, PLACEHOLDER)
    .replace(JOINED, PLACEHOLDER)
    .replace(/(\[record\])(?:,?\s+lines?\s+\d+(?:-\d+)?|:\d+(?:-\d+)?)/g, "$1");

/**
 * What would still tell a judge how an answer reached the records but cannot be taken out without damaging prose, by a
 * fixed list: kept in the text, and recorded by answer so the report can say how imperfect the blinding was.
 */
const TELLS: readonly (readonly [string, RegExp])[] = [
  ["merged", /\bmerged\b/i],
  ["seen in N sources", /\bseen in \d+ sources?\b/i],
  ["records N", /\brecords \d+\b/i],
  [
    "My view",
    /\bMy (?:active|lab|medication|procedure|immunization|allergy|condition)\w*/,
  ],
  ["What each version says", /\bWhat each version says\b/i],
  ["Where it came from", /\bWhere it came from\b/i],
  ["document", /\bdocuments?\b/i],
  ["copies", /\bcop(?:y|ies)\b/i],
  ["section", /\bsections?\b/i],
  ["narrative", /\bnarrative\b/i],
  ["CDA", /\bC?-?CDA\b/],
  ["page", /\bpages?\b/i],
  ["PDF", /\bPDF\b/],
  ["latest", /\blatest\b/i],
  ["importer", /\bimporter\b/i],
  ["timeline", /\btimeline\b/i],
  ["one row", /\bone row\b/i],
];

/** The fixed-list tells in a text, each once, in the list's order. */
export const tellsOf = (text: string): string[] =>
  TELLS.filter(([, pattern]) => pattern.test(text)).map(([term]) => term);

/** The tells in one blinded answer, with the job (and so the arm) and the question it answers. */
export const tellsIn = (
  at: { job: string; arm: string; question: string },
  answer: Answer,
) => tellsOf(blinded(answer)).map((term) => ({ ...at, term }));

/**
 * An answer as a judge reads it: the reply, then each point with its facts as provider, date and words, what it says
 * is absent (never what it looked through, which differs by arm), its knowledge and its links; no citations.
 */
export function blinded(answer: Answer): string {
  return [
    `Reply: ${scrubbed(answer.answer)}`,
    `Short answer: ${scrubbed(answer.short)}`,
    ...answer.items.map((item) =>
      [
        `### Item ${item.n}. ${scrubbed(item.says)}`,
        `- Why: ${scrubbed(item.why)}`,
        ...item.facts.map(
          (f, at) =>
            `- Fact ${at}: ${scrubbed(f.provider)}${f.date === undefined ? "" : `, ${f.date}`}: ${scrubbed(f.says)}`,
        ),
        ...item.absences.map((a) => `- Absent: ${scrubbed(a.what)}`),
        ...(item.knowledge === undefined
          ? []
          : [
              `- Knowledge: ${scrubbed(item.knowledge.says)}${item.knowledge.guideline === undefined ? "" : ` (${scrubbed(item.knowledge.guideline)})`}`,
            ]),
        ...(item.links ?? []).map(
          (link) =>
            `- Link: fact ${link.from} to fact ${link.to}: ${scrubbed(link.says)}`,
        ),
        `- Confidence: ${item.confidence}`,
      ].join("\n"),
    ),
    ...(answer.links ?? []).map(
      (link) =>
        `- Link: item ${link.from.item} fact ${link.from.fact} to item ${link.to.item} fact ${link.to.fact}: ${scrubbed(link.says)}`,
    ),
  ].join("\n\n");
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const labelAt = (at: number) =>
  at < 26
    ? LETTERS[at]!
    : `${LETTERS[Math.floor(at / 26) - 1]}${LETTERS[at % 26]}`;

const answered = (job: Job) =>
  job.role === "subject" && (job.status === "done" || job.status === "reused");

/**
 * The key's prose as a judge reads it: without the sections that score by the older rules (a gap found, a false
 * question counted), since the judge's verdicts have the one vocabulary its prompt gives, and without the summary
 * table and the bullets that say where the pod holds an item, which would say which answer came from the pod.
 */
export const judgesProse = (prose: string) =>
  prose
    .replace(
      /^## (?:Scoring rules|How to score|Summary)\b.*?(?=^## |(?![\s\S]))/gms,
      "",
    )
    .replace(/^- \*\*Pod[ :(].*(?:\n {2,}\S.*)*\n?/gm, "");

/** The key as a judge reads it: without where the pod holds each item or what only the pod has to say about one. */
const judgesKey = (key: Key) => ({
  ...key,
  items: key.items.map(({ pod: _pod, ...item }) => item),
  preExisting: key.preExisting?.map(({ podNote: _note, ...item }) => item),
});

/**
 * Writes a blind packet for each judge of each sitting (a case, model and repeat: its arms' sessions), with each
 * question's answers under letters in an order of its own, in a folder of its own outside the run, and plans the judge.
 * A judge's inputs are its packet's content, its model and its prompt; a judge with the same inputs in an earlier run
 * is reused with that run's verdict and the letters that verdict was written to.
 */
export async function judgePackets(given: string) {
  const folder = runFolder(given);
  const plan = await loadPlan(folder);
  if (plan.config.judges.length === 0) return { run: plan.run, judges: [] };
  await mkdir(join(folder, "judges"), { recursive: true });
  const past = await pastJobs();
  const planned: Job[] = [];
  const sittings = new Map<string, Job[]>();
  for (const job of plan.jobs.filter(answered)) {
    const id = instanceOf(job);
    (sittings.get(id) ?? sittings.set(id, []).get(id)!).push(job);
  }
  for (const [instance, subjects] of sittings) {
    const caseId = subjects[0]!.case!;
    const found = await loadCase(caseId);
    const { key, prose: whole } = await loadKey(caseId);
    const prose = judgesProse(whole);
    const bodies = new Map<string, string>();
    for (const job of subjects)
      for (const question of job.questions ?? []) {
        const path = join(folder, answerPath(job, question));
        if (!existsSync(path)) continue;
        let body: string;
        try {
          body = blinded(JSON.parse(await readFile(path, "utf8")) as Answer);
        } catch {
          body = "(the answer is not valid JSON, or not an answer)";
        }
        bodies.set(`${job.id}\n${question}`, body);
      }
    if (bodies.size === 0) continue;
    for (const [at, model] of plan.config.judges.entries()) {
      const id = `${instance}.judge.${model.replace(/^claude-/, "")}.j${at + 1}`;
      if (plan.jobs.some((it) => it.id === id)) continue;
      // Each question's order is the run's own, so a judge does not see the arms in the same places; a reused verdict
      // brings the letters it was written to.
      const seed = `${plan.run}/${instance}/${model}/${at}`;
      const labels: Record<string, Label> = {};
      const sections: string[] = [];
      for (const session of found.sessions)
        for (const question of session.questions) {
          const answers = subjects
            .filter((job) => bodies.has(`${job.id}\n${question.id}`))
            .sort((a, b) =>
              sha256(`${seed}/${question.id}/${a.id}`).localeCompare(
                sha256(`${seed}/${question.id}/${b.id}`),
              ),
            );
          if (answers.length === 0) continue;
          const lettered = answers.map((job) => {
            const label = labelAt(Object.keys(labels).length);
            labels[label] = { job: job.id, question: question.id };
            return `### Answer ${label}\n\n${bodies.get(`${job.id}\n${question.id}`)}`;
          });
          sections.push(
            [
              `## Question ${question.id}: "${question.asks}"`,
              `Key items: ${
                key.items
                  .filter((it) => it.question === question.id)
                  .map((it) => it.id)
                  .join(", ") || "none"
              }`,
              ...lettered,
            ].join("\n\n"),
          );
        }
      const packet = [
        `# Blind packet: ${found.person.name}, as of ${found.today}`,
        "## The key, prose half",
        prose,
        "## The key, machine-readable half",
        "```json",
        JSON.stringify(judgesKey(key), null, 2),
        "```",
        "## The questions and their answers",
        ...sections,
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
        instance,
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

/** Each judge's verdict turned into a grade per answer it labelled: one subject job's answer to one question. */
export async function gradesOf(plan: Plan): Promise<Grade[]> {
  const grades: Grade[] = [];
  const kinds = new Map<string, Map<string, boolean>>();
  for (const job of plan.jobs) {
    if (job.role !== "judge" || job.verdict === undefined) continue;
    const path = join(plan.folder, job.verdict);
    if (!existsSync(path)) continue;
    let verdict: {
      outputs: (Omit<Grade, "subject" | "question" | "judge"> & {
        label: string;
      })[];
    };
    try {
      verdict = JSON.parse(await readFile(path, "utf8"));
    } catch {
      continue;
    }
    if (errorsOf("verdict", verdict).length > 0) continue;
    if (job.case !== undefined && !kinds.has(job.case))
      kinds.set(
        job.case,
        new Map(
          (await loadKey(job.case)).key.items.map((it) => [
            it.id,
            it.kind === "trap" || it.kind === "near-trap",
          ]),
        ),
      );
    const traps = kinds.get(job.case ?? "");
    for (const { label, ...grade } of verdict.outputs) {
      const answer = job.labels?.[label];
      // a trap is raised or avoided, anything else found, partly or missed: the other kind's verdict is rejected
      const wrong = grade.items.some((it) => {
        const trap = traps?.get(it.id);
        return (
          trap !== undefined &&
          trap !== (it.verdict === "raised" || it.verdict === "avoided")
        );
      });
      if (answer !== undefined && !wrong)
        grades.push({
          subject: answer.job,
          question: answer.question,
          judge: job.id,
          ...grade,
        });
    }
  }
  return grades;
}

/** How often two judges of a sitting gave a key item the same verdict, and Cohen's kappa over those verdicts. */
export function agreementOf(plan: Plan, grades: readonly Grade[]) {
  const out: {
    instance: string;
    judges: string[];
    items: number;
    agreed: number;
    kappa: number | null;
  }[] = [];
  const sittings = new Map<string, string[]>();
  for (const job of plan.jobs)
    if (job.role === "judge" && job.instance !== undefined)
      (
        sittings.get(job.instance) ??
        sittings.set(job.instance, []).get(job.instance)!
      ).push(job.id);
  for (const [instance, judges] of sittings)
    for (let a = 0; a < judges.length; a++)
      for (let b = a + 1; b < judges.length; b++) {
        const pairs: [string, string][] = [];
        for (const one of grades.filter((it) => it.judge === judges[a]))
          for (const other of grades.filter(
            (it) =>
              it.judge === judges[b] &&
              it.subject === one.subject &&
              it.question === one.question,
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
          instance,
          judges: [judges[a]!, judges[b]!],
          items: pairs.length,
          agreed,
          kappa: expected === 1 ? null : (observed - expected) / (1 - expected),
        });
      }
  return out;
}
