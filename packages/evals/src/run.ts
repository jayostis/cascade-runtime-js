// `cascade-evals run`: a whole eval from one config with no orchestrator. Each job the meter hands out is one `claude -p`
// child, started with the job's model, only the tools its prompt allows and none of the user's setup, in a folder of its
// own; the meter runs between waves, as it does when an orchestrator drives it, then the judges, then `finish`.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { execPath } from "node:process";
import { sha256 } from "./cases.js";
import { type Plan, loadConfig, loadPlan, planRun, savePlan } from "./plan.js";
import { judgePackets } from "./judging.js";
import { CLI, TOOLS, askCommand, podCommand } from "./prompts.js";
import { finish, recordRun, writtenOf } from "./record.js";
import { type Job, runFolder } from "./results.js";
import { answerPath } from "./sessions.js";
import { TRANSCRIPTS, tagLine } from "./transcripts.js";
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
  const target =
    script?.[1] && resolve(dirname(cmd), script[1].replaceAll("\\", "/"));
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

/**
 * The Bash uses a job is allowed: the commands its prompt names, which is all the prompt asks it to run. Both arms ask
 * for their questions with `ask`; the pod arm also reaches its pod with `pod`, whatever tool and input follow.
 */
const bashOf = (plan: Plan, job: Job): string[] => [
  `Bash(${askCommand(plan.folder, job.id)})`,
  ...(job.arm === "pod" ? [`Bash(${podCommand(plan.folder, job.id)} *)`] : []),
];

/** A rule is its own argument and the command inside it is quoted, so a space in these paths cannot be carried. */
function refuseSpaces(folder: string): void {
  for (const path of [CLI, folder])
    if (path.includes(" "))
      throw new Error(
        `${path} has a space in it; a child's allowed commands cannot hold one: run from a path without spaces`,
      );
}

/** How a job is started: its model, its tools, no part of the user's setup, no one to ask for permission. */
export function childOf(plan: Plan, job: Job, prompt: string): Child {
  const allowed: readonly string[] =
    job.role === "judge" ? TOOLS.judge : TOOLS[job.arm!];
  const reachable = reach(plan, job);
  if (allowed.includes("Bash")) refuseSpaces(plan.folder);
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
    ...allowed.flatMap((tool) =>
      tool === "Bash" ? bashOf(plan, job) : [tool],
    ),
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

/** Records a child's pid in the run's lock while it lives, or forgets it. */
type Track = (pid: number, on: boolean) => void;

/** The child and everything it started: a Windows process's children outlive it unless the tree is killed. */
function stopTree(started: ReturnType<typeof spawn>): void {
  if (process.platform === "win32" && started.pid !== undefined)
    spawn("taskkill", ["/T", "/F", "/PID", String(started.pid)], {
      stdio: "ignore",
      windowsHide: true,
    }).once("error", () => started.kill());
  else started.kill();
}

/** One child to its end; its output goes to the run's `logs/`. A child that cannot be started throws. */
async function runChild(
  folder: string,
  job: Job,
  child: Child,
  track: Track,
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
      if (started.pid !== undefined) track(started.pid, true);
      const limit = setTimeout(
        () => stopTree(started),
        childMinutes() * 60_000,
      );
      started.once("error", (error) => {
        clearTimeout(limit);
        reject(error);
      });
      started.once("close", (code) => {
        clearTimeout(limit);
        if (started.pid !== undefined) track(started.pid, false);
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
 * left no transcript fails there, and no job starts that would pass the cap. A child that ended in an error (a usage
 * limit, a lost login, Ctrl-C), or ended cleanly having answered nothing because its tool calls were refused or a limit
 * stopped it, is given back whole, so a later wave or run takes its job again from the first question; when a wave's
 * every child was given back the run stops, so a limit or a missing login is not spent on every job.
 */
async function waves(
  folder: string,
  log: (line: string) => void,
  track: Track,
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
        return runChild(folder, job, childOf(plan, job, handed.prompt), track);
      }),
    );
    const unstarted = settled.flatMap((it, at) =>
      it.status === "rejected"
        ? [{ id: meter.next[at]!.id, error: it.reason }]
        : [],
    );
    if (unstarted.length > 0) {
      await giveBack(folder, (job) => unstarted.some((it) => it.id === job.id));
      const [first] = unstarted;
      throw new Error(
        `${first!.id}: could not start ${claude().command}: ${first!.error instanceof Error ? first!.error.message : String(first!.error)}`,
      );
    }
    const ended = settled.map((it) =>
      it.status === "fulfilled" ? it.value : null,
    );
    const after = await loadPlan(folder);
    const failed = new Set<string>();
    for (const [at, handed] of meter.next.entries()) {
      const job = after.jobs.find((it) => it.id === handed.id)!;
      const written = writtenOf(after, job);
      if (
        !written.all &&
        (ended[at] !== 0 || (!written.any && (await stopped(job.sessionId))))
      )
        failed.add(handed.id);
    }
    await giveBack(folder, (job) => failed.has(job.id));
    if (failed.size === meter.next.length)
      throw new Error(
        `every child of the wave ended in an error or was refused or stopped (${ended.join(", ")}); see ${join(folder, "logs")}. Run again with --run ${folder} --go once it is fixed`,
      );
  }
}

/** Whether a child's transcript shows a refused tool call or a message of Claude Code's own (a usage limit). */
async function stopped(session: string | undefined): Promise<boolean> {
  if (session === undefined) return false;
  const name = `${session}.jsonl`;
  const found = (
    await readdir(TRANSCRIPTS, { recursive: true, withFileTypes: true }).catch(
      () => [],
    )
  ).find((it) => it.isFile() && it.name === name);
  if (found === undefined) return false;
  const lines = (await readFile(join(found.parentPath, name), "utf8")).split(
    "\n",
  );
  return lines.some((text) => {
    try {
      const { message } = JSON.parse(text) as {
        message?: { model?: string; content?: unknown };
      };
      if (message?.model === "<synthetic>") return true;
      return (
        Array.isArray(message?.content) &&
        (
          message.content as {
            type?: string;
            is_error?: boolean;
            content?: unknown;
          }[]
        ).some(
          (block) =>
            block.type === "tool_result" &&
            block.is_error === true &&
            /permission|not allowed|denied/i.test(
              JSON.stringify(block.content),
            ),
        )
      );
    } catch {
      return false;
    }
  });
}

/** A file of JSON lines without those that name `job`. */
async function dropLines(path: string, job: string): Promise<void> {
  if (!existsSync(path)) return;
  const kept = (await readFile(path, "utf8"))
    .split("\n")
    .filter(
      (line) => line !== "" && !line.includes(`"job":${JSON.stringify(job)}`),
    );
  await writeFile(path, kept.map((line) => `${line}\n`).join(""));
}

/**
 * Jobs handed out go back to pending, picked by `which`, with nothing kept of the attempt: its answer files, its lines in
 * `asked.jsonl` and `tool-calls.jsonl`, its session and its stats, so it reruns from the first question. A job whose
 * every answer is written is left for the meter to close.
 */
async function giveBack(
  folder: string,
  which: (job: Job) => boolean,
): Promise<void> {
  const plan = await loadPlan(folder);
  for (const job of plan.jobs)
    if (
      which(job) &&
      (job.status === "dispatched" || job.status === "running") &&
      !writtenOf(plan, job).all
    ) {
      const answers =
        job.role === "judge"
          ? [job.verdict]
          : (job.questions ?? []).map((it) => answerPath(job, it));
      for (const file of answers)
        if (file !== undefined) await rm(join(folder, file), { force: true });
      await dropLines(join(folder, "asked.jsonl"), job.id);
      await dropLines(join(folder, "tool-calls.jsonl"), job.id);
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

/**
 * Holds the run's folder for `work`, so that two `--go` on one run do not race on its plan. The lock names the process
 * and each child alive: a lock whose process is dead is taken over, unless a child it started is still running (a
 * killed parent on Windows leaves its children).
 */
async function locked<T>(
  folder: string,
  work: (track: Track) => Promise<T>,
): Promise<T> {
  const path = join(folder, "run.lock");
  const children = new Set<number>();
  const content = () =>
    JSON.stringify({ pid: process.pid, children: [...children] });
  for (;;) {
    const taken = await writeFile(path, content(), { flag: "wx" }).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
        return false;
      },
    );
    if (taken) break;
    const text = await readFile(path, "utf8").catch(() => "");
    const held = (() => {
      try {
        const parsed = JSON.parse(text) as
          number | Partial<{ pid: number; children: number[] }>;
        return typeof parsed === "number"
          ? { pid: parsed, children: [] }
          : { pid: parsed.pid ?? 0, children: parsed.children ?? [] };
      } catch {
        return { pid: 0, children: [] as number[] };
      }
    })();
    if (held.pid > 0 && alive(held.pid))
      throw new Error(
        `${folder} is being run by process ${held.pid} (${path}); wait for it to end`,
      );
    const orphan = held.children.find(alive);
    if (orphan !== undefined)
      throw new Error(
        `${folder} was run by process ${held.pid}, which is gone, but its child ${orphan} is still running (${path}); stop it first`,
      );
    await rm(path, { force: true });
  }
  try {
    return await work((pid, on) => {
      if (on) children.add(pid);
      else children.delete(pid);
      writeFileSync(path, content());
    });
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
  const go = async (folder: string, track: Track) => {
    refuseSpaces(folder);
    await giveBack(folder, () => true);
    await waves(folder, o.log, track);
    const judges = await judgePackets(folder);
    if (judges.judges.length > 0) await waves(folder, o.log, track);
    return finish(folder, o.log);
  };
  if (o.run === undefined) {
    const plan = await planOf(o.config, o.run, o.log);
    return locked(plan.folder, (track) => go(plan.folder, track));
  }
  // A named run is locked before it is planned, so that two `--go` for one new run do not both plan it.
  const folder = runFolder(o.run);
  await mkdir(folder, { recursive: true });
  return locked(folder, async (track) => {
    const plan = await planOf(o.config, o.run, o.log);
    return go(plan.folder, track);
  });
}
