// `cascade-evals run`: a whole eval from one config with no orchestrator. Each job the meter hands out is one `claude -p`
// child, started with the job's model, only the tools its prompt allows and none of the user's setup, in a folder of its
// own; the meter runs between waves, as it does when an orchestrator drives it, then the judges, then `finish`.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { execPath } from "node:process";
import { sha256 } from "./cases.js";
import { type Plan, loadConfig, loadPlan, planRun, savePlan } from "./plan.js";
import { judgePackets } from "./judging.js";
import { TOOLS, askCommand, podCommand } from "./prompts.js";
import { finish, recordRun, writtenOf } from "./record.js";
import { type Job, runFolder } from "./results.js";
import { tagLine } from "./transcripts.js";
import { WORK } from "./paths.js";

/**
 * The executable a child runs: `claude`, unless `CASCADE_EVALS_CLAUDE` names another (a `.js` or `.mjs` file runs under
 * node). On Windows a `claude` that is only an npm `.cmd` shim cannot be spawned, so the script the shim runs is run
 * under node instead, and `note` says so.
 */
export function resolveClaude(
  given = process.env.CASCADE_EVALS_CLAUDE,
  platform: string = process.platform,
  path = process.env.PATH ?? "",
): { command: string; prefix: string[]; note?: string } {
  if (given !== undefined && /\.m?js$/.test(given))
    return { command: execPath, prefix: [given] };
  const name = given ?? "claude";
  const plain = { command: name, prefix: [] };
  if (platform !== "win32" || /\.exe$/i.test(name)) return plain;
  const named = name.includes("/") || name.includes("\\");
  const dirs = named ? [dirname(name)] : path.split(delimiter).filter(Boolean);
  const stem = (named ? basename(name) : name).replace(/\.(cmd|bat)$/i, "");
  if (dirs.some((dir) => existsSync(join(dir, `${stem}.exe`)))) return plain;
  const cmd = dirs
    .map((dir) => join(dir, `${stem}.cmd`))
    .find((it) => existsSync(it));
  if (cmd === undefined) return plain;
  const script = /"%dp0%[\\/]([^"]+\.m?js)"/i.exec(readFileSync(cmd, "utf8"));
  const target = script?.[1] && resolve(dirname(cmd), script[1]);
  if (!target || !existsSync(target))
    throw new Error(
      `${cmd} is an npm .cmd shim whose script could not be found; set CASCADE_EVALS_CLAUDE to claude.exe or to the .js file the shim runs`,
    );
  return {
    command: execPath,
    prefix: [target],
    note: `${cmd} is an npm .cmd shim, which cannot be spawned: running ${target} under node`,
  };
}

const claude = () => resolveClaude();

/** Minutes a child may run before it is stopped, unless `CASCADE_EVALS_CHILD_MINUTES` says. */
function childMinutes(): number {
  const given = process.env.CASCADE_EVALS_CHILD_MINUTES;
  if (given === undefined) return 60;
  const minutes = Number(given);
  if (given.trim() === "" || !Number.isFinite(minutes) || minutes <= 0)
    throw new Error(
      `CASCADE_EVALS_CHILD_MINUTES must be a number of minutes above 0, not "${given}"`,
    );
  return minutes;
}

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

/** The one Bash use a job is allowed: the command its prompt names, which is all the prompt asks it to run. */
const bashOf = (plan: Plan, job: Job): string =>
  job.arm === "records"
    ? `Bash(${askCommand(plan.folder, job.id)})`
    : `Bash(${podCommand(plan.folder, job.id)} *)`;

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
    ...(job.sessionId === undefined ? [] : ["--session-id", job.sessionId]),
    "--tools",
    allowed.join(","),
    "--allowedTools",
    allowed
      .map((tool) => (tool === "Bash" ? bashOf(plan, job) : tool))
      .join(","),
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
      const limit = setTimeout(() => started.kill(), childMinutes() * 60_000);
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
 * left no transcript fails there, and no job starts that would pass the cap. A child that ended in an error and wrote no
 * answer (a usage limit, a lost login, Ctrl-C) is given back, so a later wave or run takes its job again; when a wave's
 * every child ended in an error the run stops, so a limit or a missing login is not spent on every job.
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
    for (const handed of meter.next)
      plan.jobs.find((it) => it.id === handed.id)!.sessionId = randomUUID();
    await savePlan(plan);
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
        (job) => unstarted.some((it) => it.id === job.id),
        true,
      );
      const [first] = unstarted;
      throw new Error(
        `${first!.id}: could not start ${claude().command}: ${first!.error instanceof Error ? first!.error.message : String(first!.error)}`,
      );
    }
    const ended = settled.map((it) =>
      it.status === "fulfilled" ? it.value : null,
    );
    const failed = new Set(
      meter.next.filter((_, at) => ended[at] !== 0).map((it) => it.id),
    );
    await giveBack(folder, (job) => failed.has(job.id), false);
    if (ended.every((code) => code !== 0))
      throw new Error(
        `every child of the wave ended in an error (${ended.join(", ")}); see ${join(folder, "logs")}. Run again with --run ${folder} --go once it is fixed`,
      );
  }
}

/**
 * Jobs handed out go back to pending, with nothing kept of the attempt: those picked by `which` that have written no
 * answer (`always`: whatever they wrote). A job that wrote some but not all of its answers is left for the meter to fail.
 */
async function giveBack(
  folder: string,
  which: (job: Job) => boolean,
  always: boolean,
): Promise<void> {
  const plan = await loadPlan(folder);
  for (const job of plan.jobs)
    if (
      which(job) &&
      (job.status === "dispatched" || job.status === "running") &&
      (always || !writtenOf(plan, job).any)
    ) {
      job.status = "pending";
      for (const key of [
        "dispatched",
        "sessionId",
        "stats",
        "calls",
        "toolUses",
        "split",
        "reason",
      ] as const)
        delete job[key];
    }
  await savePlan(plan);
}

/** Holds the run's folder for `work`, so that two `--go` on one run do not race on its plan. */
async function locked<T>(folder: string, work: () => Promise<T>): Promise<T> {
  const path = join(folder, "run.lock");
  for (;;) {
    const taken = await writeFile(path, String(process.pid), {
      flag: "wx",
    }).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
        return false;
      },
    );
    if (taken) break;
    const holder = Number(await readFile(path, "utf8").catch(() => ""));
    if (holder > 0 && alive(holder))
      throw new Error(
        `${folder} is being run by process ${holder} (${path}); wait for it to end`,
      );
    await rm(path, { force: true });
  }
  try {
    return await work();
  } finally {
    await rm(path, { force: true });
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** The plan a run starts from: the existing run's, or a new one planned from the config. */
async function planOf(
  config: string | undefined,
  run: string | undefined,
  log: (line: string) => void,
): Promise<Plan> {
  if (run !== undefined) {
    const folder = runFolder(run);
    if (existsSync(join(folder, "plan.json"))) {
      const plan = await loadPlan(folder);
      if (
        config !== undefined &&
        sha256(JSON.stringify(await loadConfig(config))) !== plan.configSha256
      )
        throw new Error(
          `${plan.run} was planned from another config than ${config}; leave --config out to resume it, or plan a new run`,
        );
      return plan;
    }
  }
  return planRun(config ?? "smoke", run, log);
}

/** What a run would do: its jobs, and the estimate against the cap. Plans the run if it has no plan yet. */
export async function showRun(o: {
  config?: string | undefined;
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
    go: `cascade-evals run --run ${plan.run} --go`,
    cap: plan.config.cap,
    fitsCap: plan.fitsCap,
    concurrency: plan.config.concurrency ?? 4,
    judges: plan.config.judges,
  };
}

/**
 * Plans (or resumes) a run, runs its subjects and judges as `claude -p` children, and finishes it. A resumed run first
 * takes back the jobs an earlier `--go` handed out and never finished, which have no child now, before the meter looks.
 */
export async function runEval(o: {
  config?: string | undefined;
  run?: string | undefined;
  log: (line: string) => void;
}) {
  childMinutes();
  const { note } = claude();
  if (note !== undefined) o.log(note);
  const plan = await planOf(o.config, o.run, o.log);
  return locked(plan.folder, async () => {
    await giveBack(plan.folder, () => true, false);
    await waves(plan.folder, o.log);
    const judges = await judgePackets(plan.folder);
    if (judges.judges.length > 0) await waves(plan.folder, o.log);
    return finish(plan.folder, o.log);
  });
}
