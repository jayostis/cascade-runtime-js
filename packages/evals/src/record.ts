// What a run has spent and done, read from its jobs' transcripts after each wave (`meter`): it says which jobs may
// start without passing the cap, so a run stops cleanly at it. `finish` checks, grades and counts what ran, resolves
// its evidence and writes results.json.
import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Answer,
  type Asker,
  checkAnswer,
  judgeViolations,
} from "./checks.js";
import { callsFor } from "./citations.js";
import { passageOf, podProvenance } from "./evidence.js";
import { instancesOf } from "./instances.js";
import { answerPath, askedIn, splitSession } from "./sessions.js";
import { type Environment, pinnedPod } from "./pinned.js";
import {
  type KeyItem,
  loadCase,
  loadKey,
  openPrepared,
  type Prepared,
} from "./cases.js";
import { agreementOf, gradesOf, tellsIn } from "./judging.js";
import { loadPlan, type Plan, savePlan } from "./plan.js";
import { callCost, PRICE_TABLE, priced } from "./prices.js";
import {
  type CallRecord,
  type EntryProvenance,
  type Evidence,
  type Job,
  type Results,
  runFolder,
  type Stats,
  type SubjectChecks,
  type ToolCallRecord,
} from "./results.js";
import { valid } from "./schemas.js";
import { buildSite } from "./site.js";
import { type Transcript, transcriptsSince } from "./transcripts.js";

/** A job's stats and calls from its transcript. */
export function statsOf(transcript: Transcript): {
  stats: Stats;
  calls: CallRecord[];
} {
  const calls = transcript.calls.map((call) => ({
    ...call,
    usd: callCost(call.model, call) ?? null,
  }));
  const sum = (pick: (call: CallRecord) => number) =>
    calls.reduce((total, call) => total + pick(call), 0);
  const input = sum((call) => call.input);
  const cacheCreation = sum((call) => call.cacheCreation);
  const cacheRead = sum((call) => call.cacheRead);
  const output = sum((call) => call.output);
  const byName: Record<string, number> = {};
  for (const call of calls)
    for (const name of call.toolCalls) byName[name] = (byName[name] ?? 0) + 1;
  const priced = calls.every((call) => call.usd !== null);
  return {
    calls,
    stats: {
      calls: calls.length,
      models: [...new Set(calls.map((call) => call.model))],
      tokens: {
        input,
        cacheCreation,
        cacheRead,
        output,
        total: input + cacheCreation + cacheRead + output,
      },
      contextPeak: Math.max(
        0,
        ...calls.map(
          (call) => call.input + call.cacheCreation + call.cacheRead,
        ),
      ),
      toolCalls: { total: sum((call) => call.toolCalls.length), byName },
      wallSeconds: Math.round(
        (Date.parse(transcript.ended) - Date.parse(transcript.started)) / 1000,
      ),
      cost: {
        usd: priced ? sum((call) => call.usd ?? 0) : null,
        basis: "exact",
        priceTable: PRICE_TABLE.date,
      },
      usageSource: "transcript",
    },
  };
}

/** Whether a job was handed out: it may be spending, and counts at its estimate until its transcript is found. */
const handedOut = (job: Job) =>
  job.status === "dispatched" ||
  (job.status === "failed" &&
    job.stats === undefined &&
    job.dispatched === true);

/** What the run itself spent: a reused job cost this run nothing; a job handed out without a transcript, its estimate. */
const spentOf = (jobs: readonly Job[]) => ({
  tokens: jobs.reduce(
    (sum, it) =>
      sum +
      (it.status === "reused"
        ? 0
        : (it.stats?.tokens.total ?? (handedOut(it) ? it.estimate.tokens : 0))),
    0,
  ),
  usd: jobs.reduce(
    (sum, it) =>
      sum +
      (it.status === "reused"
        ? 0
        : (it.stats?.cost.usd ?? (handedOut(it) ? it.estimate.usd : 0))),
    0,
  ),
});

/** A tool use as a job keeps it: a written file's content left out. */
const keptUse = ({
  name,
  input,
}: {
  name: string;
  input: Readonly<Record<string, unknown>>;
}) => {
  const rest: Record<string, unknown> = { ...input };
  delete rest.content;
  return { name, input: rest };
};

/** The run's jobs brought up to date from their transcripts and output files, and harness jobs added as found. */
async function refreshed(plan: Plan): Promise<Map<string, Transcript>> {
  const since = new Date(Date.parse(plan.created) - 60_000);
  const found = await transcriptsSince(since, (tag) =>
    tag.startsWith(`${plan.run}/`),
  );
  const asked = await askedIn(plan.folder);
  for (const [tag, transcript] of found) {
    let job = plan.jobs.find((it) => it.tag === tag);
    if (job === undefined) {
      job = {
        id: tag.slice(plan.run.length + 1),
        role: "harness",
        model: transcript.calls[0]?.model ?? "unknown",
        tag,
        status: "done",
        estimate: { tokens: 0, usd: 0 },
      };
      plan.jobs.push(job);
    }
    if (job.status === "reused") continue;
    const { stats, calls } = statsOf(transcript);
    job.stats = stats;
    job.calls = calls;
    job.toolUses = transcript.tools.map(keptUse);
    if (job.role === "harness") continue;
    if (
      job.role === "judge" &&
      job.workdir !== undefined &&
      job.verdict !== undefined
    ) {
      const written = join(job.workdir, "verdict.json");
      if (existsSync(written))
        await copyFile(written, join(plan.folder, job.verdict));
    }
    if (job.role === "subject")
      job.split = splitSession(
        calls,
        asked.filter((it) => it.job === job!.id),
        transcript.ended,
        job.arm!,
      );
    const outputs =
      job.role === "judge"
        ? [job.verdict]
        : (job.questions ?? []).map((it) => answerPath(job!, it));
    const wrote =
      outputs.length > 0 &&
      outputs.every(
        (it) => it !== undefined && existsSync(join(plan.folder, it)),
      );
    const ran = stats.models.map(priced);
    if (wrote && !ran.includes(priced(job.model))) {
      job.status = "failed";
      job.reason = `ran ${ran.join(", ")}, not the ${job.model} its inputs' hash names`;
    } else {
      job.status = wrote ? "done" : "running";
      delete job.reason;
    }
  }
  return found;
}

/**
 * Jobs handed out at an earlier meter that have not finished: the meter runs between waves, so a job with no
 * transcript, or one that wrote nothing, failed in its wave. It is never handed out again.
 */
function closeWave(plan: Plan): void {
  for (const job of plan.jobs) {
    if (job.status === "dispatched") {
      job.status = "failed";
      job.reason = "no transcript after its wave";
    } else if (job.status === "running") {
      job.status = "failed";
      job.reason = "it wrote no output in its wave";
    }
  }
}

function fits(
  plan: Plan,
  spent: { tokens: number; usd: number },
  job: Job,
): boolean {
  const { cap } = plan.config;
  return (
    (cap.tokens === undefined ||
      spent.tokens + job.estimate.tokens <= cap.tokens) &&
    (cap.usd === undefined || spent.usd + job.estimate.usd <= cap.usd)
  );
}

/** The meter: what the run has spent, and the jobs that may start now without passing the cap. */
export async function recordRun(given: string, afterWave = false) {
  const plan = await loadPlan(runFolder(given));
  await refreshed(plan);
  // Only between waves: a meter run while agents still write must not fail them.
  if (afterWave) closeWave(plan);
  const spent = spentOf(plan.jobs);
  const running = plan.jobs.filter((it) => it.status === "running");
  const pending = plan.jobs.filter((it) => it.status === "pending");
  const room = plan.config.concurrency ?? 4;
  const next: Job[] = [];
  const committed = { ...spent };
  for (const job of pending) {
    if (next.length >= room) break;
    if (!fits(plan, committed, job)) continue;
    next.push(job);
    committed.tokens += job.estimate.tokens;
    committed.usd += job.estimate.usd;
  }
  for (const job of next) {
    job.status = "dispatched";
    job.dispatched = true;
  }
  await savePlan(plan);
  return {
    run: plan.run,
    spent,
    cap: plan.config.cap,
    done: plan.jobs
      .filter((it) => it.status === "done" || it.status === "reused")
      .map((it) => it.id),
    running: running.map((it) => it.id),
    next: await Promise.all(
      next.map(async (job) => ({
        id: job.id,
        role: job.role,
        alias: job.alias,
        ...(job.effort === undefined ? {} : { effort: job.effort }),
        tag: job.tag,
        promptPath:
          job.workdir === undefined
            ? join(plan.folder, job.prompt!)
            : join(job.workdir, "prompt.txt"),
        prompt: await readFile(join(plan.folder, job.prompt!), "utf8"),
      })),
    ),
    blockedByCap: pending
      .filter((job) => !fits(plan, spent, job))
      .map((it) => it.id),
    stop: next.length === 0 && running.length === 0,
  };
}

async function toolCallsOf(folder: string): Promise<ToolCallRecord[]> {
  const path = join(folder, "tool-calls.jsonl");
  if (!existsSync(path)) return [];
  return (await readFile(path, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ToolCallRecord);
}

/**
 * What reads a case's pod for the checks: the pod itself, or for a pinned run its own build of the runtime, asked
 * every question the checks need in one process, since another build may not read the pod the same way.
 */
async function askerOf(
  prepared: Prepared,
): Promise<Asker & { close(): Promise<void> }> {
  if (prepared.runtime === undefined) return openPrepared(prepared);
  const rows = pinnedPod(
    { runtime: prepared.runtime } as Environment,
    "ask",
    join(prepared.pods, prepared.pod),
    ["entry/What it shows"],
  ) as Record<string, Readonly<Record<string, string>>[]>;
  return {
    ask: async (question) => rows[question] ?? [],
    close: async () => undefined,
  };
}

/**
 * Each citation and absence of one answer, resolved mechanically: a pod entry to its provenance, a file to its
 * passage, a pod absence to the call it names, which must be a call of its tool and input (else the first answered call
 * of that tool and input when it names no number), a grab-bag absence to the files it names (else every file offered, marked
 * as defaulted), each marked read whole or not.
 */
export async function evidenceOf(o: {
  job: Job;
  question: string;
  answer: Answer;
  prepared: Prepared;
  reading: readonly string[];
  /** The files the job read whole, as its checks found them. */
  read?: readonly string[];
  provenance: (entry: string) => EntryProvenance | undefined;
  toolCalls: readonly ToolCallRecord[];
}): Promise<Evidence[]> {
  const found: Evidence[] = [];
  const at = { job: o.job.id, question: o.question };
  const calls = o.toolCalls.filter((it) => it.job === o.job.id);
  for (const item of o.answer.items) {
    for (const [fact, { cite }] of item.facts.entries())
      found.push({
        ...at,
        item: item.n,
        fact,
        cite,
        ...("entry" in cite
          ? { entry: o.provenance(cite.entry) ?? null }
          : { passage: (await passageOf(o.prepared.downloads, cite)) ?? null }),
      });
    for (const [absence, { query, sources }] of item.absences.entries()) {
      if (o.job.arm === "pod") {
        const named = query === undefined ? [] : callsFor(calls, query);
        const call = named.find((it) => it.ok) ?? named[0];
        found.push({
          ...at,
          item: item.n,
          absence,
          call:
            call === undefined
              ? null
              : {
                  ...(call.call === undefined ? {} : { call: call.call }),
                  at: call.at,
                  ok: call.ok,
                  rows: call.rows,
                  milliseconds: call.milliseconds,
                },
        });
      } else
        found.push({
          ...at,
          item: item.n,
          absence,
          stated: sources !== undefined,
          files: (sources ?? o.reading).map((file) => ({
            file,
            read: (o.read ?? []).includes(file),
            bytes:
              o.prepared.documents.find((it) => it.file === file)?.bytes ?? 0,
          })),
        });
    }
  }
  return found;
}

/** Checks, grades and counts the run, resolves its evidence, and writes results.json and the run's report site. */
export async function finish(given: string, log: (line: string) => void) {
  const folder = runFolder(given);
  const plan = await loadPlan(folder);
  await refreshed(plan);
  const spentBefore = spentOf(plan.jobs);
  for (const job of plan.jobs)
    if (job.status === "pending" || job.status === "running") {
      job.reason =
        job.status === "running"
          ? "it did not answer every question"
          : fits(plan, spentBefore, job)
            ? "not run"
            : "the cap";
      job.status = "skipped";
    }
  await savePlan(plan);
  const toolCalls = await toolCallsOf(folder);
  for (const job of plan.jobs)
    if (
      job.role === "subject" &&
      job.prompt !== undefined &&
      existsSync(join(folder, job.prompt))
    )
      job.promptText = await readFile(join(folder, job.prompt), "utf8");
  const checks: Record<string, Record<string, SubjectChecks>> = {};
  const answers: Record<string, Record<string, unknown>> = {};
  const evidence: Evidence[] = [];
  const tells: NonNullable<Results["blinding"]>["tells"][number][] = [];
  const keys = new Map<string, readonly KeyItem[]>();
  const cases: Results["cases"][number][] = [];
  for (const {
    id: caseId,
    downloadsSha256,
    keySha256,
    prepared,
  } of plan.cases) {
    const found = await loadCase(caseId);
    const { key } = await loadKey(caseId);
    keys.set(caseId, key.items);
    cases.push({
      id: caseId,
      person: found.person,
      today: found.today,
      description: {
        summary: found.description.summary,
        who: found.description.who,
        sources: found.description.sources,
        planted: found.description.planted,
      },
      downloadsSha256,
      keySha256,
      imports: prepared.imports,
      documents: prepared.documents,
      sessions: found.sessions,
      key: key.items.map(({ id, question, kind, title, lookingFor, pod }) => ({
        id,
        question,
        kind,
        title,
        lookingFor,
        pod,
      })),
      keyUrl: `https://github.com/jayostis/cascade-runtime-js/blob/${plan.harness.commit}/packages/evals/cases/${caseId}/key.md`,
      build: prepared.build ?? null,
    });
    const provenance = await podProvenance(join(prepared.pods, prepared.pod));
    const pod = await askerOf(prepared);
    try {
      for (const job of plan.jobs.filter(
        (it) => it.role === "subject" && it.case === caseId,
      ))
        for (const question of job.questions ?? []) {
          const path = join(folder, answerPath(job, question));
          if (!existsSync(path)) continue;
          let answer: unknown;
          try {
            answer = JSON.parse(await readFile(path, "utf8"));
          } catch (error) {
            answer = { unparsed: String(error) };
          }
          (answers[job.id] ??= {})[question] = answer;
          const checked = await checkAnswer({
            job,
            question,
            answer,
            folder,
            prepared,
            reading: found.reading,
            key,
            toolCalls,
            pod: job.arm === "pod" ? pod : undefined,
          });
          (checks[job.id] ??= {})[question] = checked;
          if (checked.answerValid && job.arm !== undefined)
            tells.push(
              ...tellsIn(
                { job: job.id, arm: job.arm, question },
                answer as Answer,
              ),
            );
          if (checked.answerValid)
            evidence.push(
              ...(await evidenceOf({
                job,
                question,
                answer: answer as Answer,
                prepared,
                reading: found.reading,
                ...(checked.read === undefined ? {} : { read: checked.read }),
                provenance,
                toolCalls,
              })),
            );
        }
    } finally {
      await pod.close();
    }
  }
  const judgeDiscipline: Results["judgeDiscipline"] = Object.fromEntries(
    plan.jobs
      .filter((it) => it.role === "judge" && it.toolUses !== undefined)
      .map((it) => {
        const violations = judgeViolations(it, it.toolUses ?? []);
        return [it.id, { ok: violations.length === 0, violations }];
      }),
  );
  const grades = await gradesOf(plan);
  const agreement = agreementOf(plan, grades);
  const spent = spentOf(plan.jobs);
  const byRole: Record<string, { tokens: number; usd: number }> = {};
  for (const job of plan.jobs) {
    if (job.status === "reused" || job.stats === undefined) continue;
    const role = (byRole[job.role] ??= { tokens: 0, usd: 0 });
    role.tokens += job.stats.tokens.total;
    role.usd += job.stats.cost.usd ?? 0;
  }
  const finished = new Date();
  const results: Results = {
    schema: "cascade-evals/results/2",
    run: {
      id: plan.run,
      tier: plan.config.tier,
      runner: "claude-code",
      created: plan.created,
      finished: finished.toISOString(),
      wallSeconds: Math.round(
        (finished.getTime() - Date.parse(plan.created)) / 1000,
      ),
      stoppedAtCap: plan.jobs.some(
        (it) => it.status === "skipped" && it.reason === "the cap",
      ),
      config: plan.config,
      configSha256: plan.configSha256,
    },
    versions: {
      harness: plan.harness,
      podPackages: plan.podCommits.packages,
      components: plan.podCommits.components,
      prompts: plan.prompts,
      priceTable: PRICE_TABLE.date,
    },
    budget: {
      cap: plan.config.cap,
      estimate: plan.estimate,
      spent: {
        ...spent,
        basis: plan.jobs.every(
          (it) => it.stats === undefined || it.stats.cost.basis === "exact",
        )
          ? "exact"
          : "estimated",
      },
      byRole,
    },
    cases,
    jobs: plan.jobs,
    asked: await askedIn(folder),
    toolCalls,
    checks,
    judgeDiscipline,
    answers,
    evidence,
    grades,
    instances: instancesOf(plan.jobs, grades, checks, answers, keys),
    agreement,
    blinding: { tells },
  };
  valid(
    "results",
    JSON.parse(JSON.stringify(results)),
    join(folder, "results.json"),
  );
  await writeFile(
    join(folder, "results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  const site = await buildSite({ run: folder }, join(folder, "site"));
  log(`${plan.run}: results.json and ${site}`);
  return {
    run: plan.run,
    results: join(folder, "results.json"),
    site,
    spent: results.budget.spent,
    estimate: plan.estimate,
    jobs: plan.jobs.map(({ id, status, reason, stats }) => ({
      id,
      status,
      ...(reason === undefined ? {} : { reason }),
      tokens: stats?.tokens.total,
      usd: stats?.cost.usd,
    })),
  };
}
