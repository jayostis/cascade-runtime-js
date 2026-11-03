// `cascade-evals run`: a whole eval from one config with no orchestrator. Each job the meter hands out is one `claude -p`
// child, started with the job's model, only the tools its prompt allows and none of the user's setup, in a folder of its
// own; the meter runs between waves, as it does when an orchestrator drives it, then the judges, then `finish`.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { execPath } from "node:process";
import { type Plan, loadPlan, planRun, savePlan } from "./plan.js";
import { judgePackets } from "./judging.js";
import { TOOLS } from "./prompts.js";
import { finish, recordRun } from "./record.js";
import { type Job, runFolder } from "./results.js";
import { tagLine } from "./transcripts.js";
import { WORK } from "./paths.js";

/** The executable a child runs: `claude`, unless `CASCADE_EVALS_CLAUDE` names another (a `.js` or `.mjs` file runs under node). */
const claude = (): { command: string; prefix: string[] } => {
  const given = process.env.CASCADE_EVALS_CLAUDE;
  if (given === undefined) return { command: "claude", prefix: [] };
  return /\.m?js$/.test(given)
    ? { command: execPath, prefix: [given] }
    : { command: given, prefix: [] };
};

/** Minutes a child may run before it is stopped, unless `CASCADE_EVALS_CHILD_MINUTES` says. */
const CHILD_MINUTES = Number(process.env.CASCADE_EVALS_CHILD_MINUTES ?? 60);

/** The tools a child is never given, whatever its arm: everything else it is denied by name as well as by not being offered. */
const NEVER = [
  "Agent",
  "Task",
  "WebFetch",
  "WebSearch",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "PowerShell",
  "Skill",
  "SlashCommand",
  "TodoWrite",
  "ToolSearch",
];

export interface Child {
  readonly command: string;
  readonly args: readonly string[];
  /** A folder of its own, outside the repository and the run. */
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /** The prompt, on stdin. */
  readonly input: string;
}

/** The folders a child's file tools may reach beyond its own: where it writes its answers, and what its arm reads. */
function reach(plan: Plan, job: Job): string[] {
  if (job.role === "judge") return [];
  const downloads = plan.cases.find((it) => it.id === job.case)?.prepared
    .downloads;
  return [
    join(plan.folder, job.answers ?? ""),
    ...(job.arm === "records" && downloads !== undefined ? [downloads] : []),
  ];
}

/** How a job is started: its model, its tools, no part of the user's setup, no one to ask for permission. */
export function childOf(plan: Plan, job: Job, prompt: string): Child {
  const allowed: readonly string[] =
    job.role === "judge" ? TOOLS.judge : TOOLS[job.arm!];
  const reachable = reach(plan, job);
  const args = [
    "-p",
    "--model",
    job.alias ?? job.model,
    ...(job.effort === undefined ? [] : ["--effort", job.effort]),
    "--safe-mode",
    "--restricted",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--tools",
    allowed.join(","),
    "--allowedTools",
    allowed.map((tool) => (tool === "Bash" ? "Bash(node *)" : tool)).join(","),
    "--disallowedTools",
    NEVER.filter((it) => !allowed.includes(it)).join(","),
    ...reachable.flatMap((dir) => ["--add-dir", dir]),
  ];
  const { command, prefix } = claude();
  return {
    command,
    args: [...prefix, ...args],
    cwd:
      job.role === "judge" && job.workdir !== undefined
        ? job.workdir
        : join(WORK, "children", plan.run, job.id),
    env: {
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      CLAUDE_CODE_USE_POWERSHELL_TOOL: "0",
    },
    input: prompt,
  };
}

/** One child to its end; its output goes to the run's `logs/`. A child that cannot be started throws. */
async function runChild(
  folder: string,
  job: Job,
  child: Child,
): Promise<number | null> {
  await mkdir(child.cwd, { recursive: true });
  await mkdir(join(folder, "logs"), { recursive: true });
  const out = await open(join(folder, "logs", `${job.id}.log`), "w");
  try {
    return await new Promise<number | null>((resolve, reject) => {
      const started = spawn(child.command, [...child.args], {
        cwd: child.cwd,
        env: { ...process.env, ...child.env },
        stdio: ["pipe", out.fd, out.fd],
      });
      const limit = setTimeout(() => started.kill(), CHILD_MINUTES * 60_000);
      started.once("error", (error) => {
        clearTimeout(limit);
        reject(error);
      });
      started.once("close", (code) => {
        clearTimeout(limit);
        resolve(code);
      });
      started.stdin?.end(child.input);
    });
  } finally {
    await out.close();
  }
}

/**
 * Waves of children until the meter has nothing to hand out: the meter runs between waves, so a job it handed out that
 * left no transcript fails there, and no job starts that would pass the cap. When a wave's every child ended in an
 * error, the jobs that left nothing are given back and the run stops, so a limit or a missing login is not spent on
 * every job.
 */
async function waves(
  folder: string,
  log: (line: string) => void,
): Promise<void> {
  for (;;) {
    const meter = await recordRun(folder, true);
    if (meter.next.length === 0) {
      if (meter.blockedByCap.length > 0)
        log(`held back by the cap: ${meter.blockedByCap.join(", ")}`);
      return;
    }
    const plan = await loadPlan(folder);
    log(`starting ${meter.next.map((it) => it.id).join(", ")}`);
    const settled = await Promise.allSettled(
      meter.next.map((handed) => {
        const job = plan.jobs.find((it) => it.id === handed.id)!;
        if (
          !handed.prompt.startsWith(`${tagLine(handed.tag)}
`)
        )
          throw new Error(
            `${handed.id}: its prompt does not open with ${tagLine(handed.tag)}, so its transcript could not be found`,
          );
        return runChild(folder, job, childOf(plan, job, handed.prompt));
      }),
    );
    const unstarted = settled.flatMap((it, at) =>
      it.status === "rejected"
        ? [{ id: meter.next[at]!.id, error: it.reason }]
        : [],
    );
    if (unstarted.length > 0) {
      await giveBack(
        folder,
        unstarted.map((it) => it.id),
      );
      const [first] = unstarted;
      throw new Error(
        `${first!.id}: could not start ${claude().command}: ${first!.error instanceof Error ? first!.error.message : String(first!.error)}`,
      );
    }
    const ended = settled.map((it) =>
      it.status === "fulfilled" ? it.value : null,
    );
    if (ended.every((code) => code !== 0)) {
      await recordRun(folder, false);
      const fresh = await loadPlan(folder);
      await giveBack(
        folder,
        meter.next
          .map((it) => it.id)
          .filter(
            (id) =>
              fresh.jobs.find((it) => it.id === id)?.status === "dispatched",
          ),
      );
      throw new Error(
        `every child of the wave ended in an error (${ended.join(", ")}); see ${join(folder, "logs")}. Run again with --run ${folder} --go once it is fixed`,
      );
    }
  }
}

/** Jobs handed out that never started go back to pending. */
async function giveBack(folder: string, ids: readonly string[]): Promise<void> {
  const plan = await loadPlan(folder);
  for (const job of plan.jobs)
    if (ids.includes(job.id) && job.status === "dispatched") {
      job.status = "pending";
      delete job.dispatched;
    }
  await savePlan(plan);
}

/** The plan a run starts from: the existing run's, or a new one planned from the config. */
async function planOf(
  config: string,
  run: string | undefined,
  log: (line: string) => void,
): Promise<Plan> {
  if (run !== undefined) {
    const folder = runFolder(run);
    if (existsSync(join(folder, "plan.json"))) return loadPlan(folder);
  }
  return planRun(config, run, log);
}

/** What a run would do: its jobs, and the estimate against the cap. Plans the run if it has no plan yet. */
export async function showRun(o: {
  config: string;
  run?: string | undefined;
  log: (line: string) => void;
}) {
  const plan = await planOf(o.config, o.run, o.log);
  return {
    run: plan.run,
    folder: plan.folder,
    jobs: plan.jobs.map(({ id, status, model, estimate }) => ({
      id,
      status,
      model,
      tokens: estimate.tokens,
      usd: Number(estimate.usd.toFixed(2)),
    })),
    estimate: plan.estimate,
    go: `cascade-evals run --config ${o.config} --run ${plan.run} --go`,
    cap: plan.config.cap,
    fitsCap: plan.fitsCap,
    concurrency: plan.config.concurrency ?? 4,
    judges: plan.config.judges,
  };
}

/** Plans (or resumes) a run, runs its subjects and judges as `claude -p` children, and finishes it. */
export async function runEval(o: {
  config: string;
  run?: string | undefined;
  log: (line: string) => void;
}) {
  const plan = await planOf(o.config, o.run, o.log);
  await waves(plan.folder, o.log);
  const judges = await judgePackets(plan.folder);
  if (judges.judges.length > 0) await waves(plan.folder, o.log);
  const finished = await finish(plan.folder, o.log);
  return finished;
}
