// What a run has spent and done, read from its jobs' transcripts after each wave (`meter`): it says which jobs may
// start without passing the cap, so a run stops cleanly at it. `finish` checks, grades and scores what ran and writes
// results.json.
import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  answerFile,
  type Asker,
  checkAnswer,
  judgeViolations,
} from "./checks.js";
import { type Environment, pinnedPod } from "./pinned.js";
import {
  type Key,
  type KeyItem,
  loadCase,
  loadKey,
  openPrepared,
  type Prepared,
} from "./cases.js";
import { agreementOf, gradesOf, scoresOf } from "./judging.js";
import { loadPlan, type Plan, savePlan } from "./plan.js";
import { callCost, PRICE_TABLE, priced } from "./prices.js";
import {
  type CallRecord,
  type Job,
  type Results,
  runFolder,
  type Slice,
  type SliceNode,
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
    const output = job.role === "judge" ? job.verdict : job.answer;
    const wrote = output !== undefined && existsSync(join(plan.folder, output));
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

/** The fields of a record a slice shows: its state and its dates and values. */
const DETAIL =
  /Status|EndDate|StartDate|effective|performed|resultValue|value|verification/i;

const local = (iri: string) => iri.split(/[#/]/).pop() ?? iri;

/** The pod around a key item: the entries its `find` selects, each with its records per source and their state. */
export async function sliceOf(
  pod: Asker,
  caseId: string,
  item: KeyItem,
): Promise<Slice | undefined> {
  if (item.find === undefined || item.find.length === 0) return undefined;
  const nodes: SliceNode[] = [];
  const edges: { from: string; to: string }[] = [];
  const sources = await pod.ask("entry/Where it came from");
  const shows = await pod.ask("entry/What it shows");
  for (const { question, where = [] } of item.find) {
    const rows = (await pod.ask(question)).filter((row) =>
      where.every((text) =>
        Object.values(row).some((value) => value.includes(text)),
      ),
    );
    for (const row of rows.slice(0, 6)) {
      const entry = row.entry;
      if (nodes.length >= 12) break;
      if (entry === undefined || nodes.some((it) => it.id === entry)) continue;
      nodes.push({
        id: entry,
        kind: question.includes("lab")
          ? "lab"
          : question.includes("condition")
            ? "condition"
            : "entry",
        label: row.entryLabel ?? local(entry),
        detail: Object.entries(row)
          .filter(
            ([name]) =>
              !/^(entry|entryLabel|records|code|snomed|icd10|lifecycle)$/.test(
                name,
              ),
          )
          .map(([name, value]) => `${name}: ${value}`)
          .join("; "),
      });
      for (const source of sources
        .filter((it) => it.entry === entry)
        .slice(0, 4)) {
        if (nodes.length >= 12) break;
        const record = source.record ?? `${entry} ${source.recordLabel ?? ""}`;
        if (nodes.some((it) => it.id === record)) continue;
        nodes.push({
          id: record,
          kind: "record",
          label: source.recordLabel ?? local(record),
          source: [source.hospital, source.retrieved?.slice(0, 10)]
            .filter(Boolean)
            .join(", "),
          detail: shows
            .filter((it) => it.from === record && DETAIL.test(it.field ?? ""))
            .slice(0, 4)
            .map((it) => `${local(it.field ?? "")}: ${local(it.value ?? "")}`)
            .join("; "),
        });
        edges.push({ from: entry, to: record });
      }
    }
  }
  return { case: caseId, item: item.id, nodes, edges };
}

/**
 * What reads a case's pod for the checks and slices: the pod itself, or for a pinned run its own build of the runtime,
 * asked every question the checks need in one process, since another build may not read the pod the same way.
 */
async function askerOf(
  prepared: Prepared,
  key: Key,
): Promise<Asker & { close(): Promise<void> }> {
  if (prepared.runtime === undefined) return openPrepared(prepared);
  const questions = [
    "entry/What it shows",
    "entry/Where it came from",
    ...new Set(
      key.items.flatMap((it) => (it.find ?? []).map((one) => one.question)),
    ),
  ];
  const rows = pinnedPod(
    { runtime: prepared.runtime } as Environment,
    "ask",
    join(prepared.pods, prepared.pod),
    questions,
  ) as Record<string, Readonly<Record<string, string>>[]>;
  return {
    ask: async (question) => rows[question] ?? [],
    close: async () => undefined,
  };
}

/** Checks, grades and scores the run, and writes results.json and the run's report site. */
export async function finish(given: string, log: (line: string) => void) {
  const folder = runFolder(given);
  const plan = await loadPlan(folder);
  await refreshed(plan);
  const spentBefore = spentOf(plan.jobs);
  for (const job of plan.jobs)
    if (job.status === "pending" || job.status === "running") {
      job.reason =
        job.status === "running"
          ? "it wrote no output"
          : fits(plan, spentBefore, job)
            ? "not run"
            : "the cap";
      job.status = "skipped";
    }
  await savePlan(plan);
  const toolCalls = await toolCallsOf(folder);
  const checks: Record<string, SubjectChecks> = {};
  const answers: Record<string, unknown> = {};
  const slices: Slice[] = [];
  for (const { id: caseId, prepared } of plan.cases) {
    const found = await loadCase(caseId);
    const { key } = await loadKey(caseId);
    const pod = await askerOf(prepared, key);
    try {
      for (const item of key.items) {
        const slice = await sliceOf(pod, caseId, item);
        if (slice !== undefined) slices.push(slice);
      }
      for (const job of plan.jobs.filter(
        (it) => it.role === "subject" && it.case === caseId,
      )) {
        const path = answerFile(folder, job);
        if (!existsSync(path)) continue;
        let answer: unknown;
        try {
          answer = JSON.parse(await readFile(path, "utf8"));
        } catch (error) {
          answer = { unparsed: String(error) };
        }
        answers[job.id] = answer;
        checks[job.id] = await checkAnswer({
          job,
          answer,
          folder,
          prepared,
          reading: found.reading,
          key,
          toolCalls,
          pod: job.arm === "pod" ? pod : undefined,
        });
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
  const scores = await scoresOf(plan, grades, answers);
  const agreement = await agreementOf(plan, grades);
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
    schema: "cascade-evals/results/1",
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
    cases: plan.cases.map(({ id, downloadsSha256, keySha256, prepared }) => ({
      id,
      downloadsSha256,
      keySha256,
      imports: prepared.imports,
      documents: prepared.documents,
    })),
    jobs: plan.jobs,
    toolCalls,
    checks,
    judgeDiscipline,
    answers,
    grades,
    scores,
    agreement,
    slices,
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
