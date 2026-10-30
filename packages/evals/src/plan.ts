// A run's plan: its jobs, each with its inputs' hash, what an earlier run already answered for the same inputs, and
// an estimate against the cap. The plan is written to the run's folder before anything runs.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  appendFile,
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Case,
  caseIds,
  components,
  type Component,
  harnessCommit,
  loadCase,
  loadKey,
  prepare,
  type Prepared,
  sha256,
} from "./cases.js";
import { CONFIGS, HISTORY, PACKAGE, PRIORS, RUNS } from "./paths.js";
import { callCost } from "./prices.js";
import { type Arm, PROMPT_VERSIONS, subjectPrompt } from "./prompts.js";
import type { Job, Results } from "./results.js";
import { valid } from "./schemas.js";
import { uncommittedIn } from "./history.js";

export interface Config {
  readonly tier: "smoke" | "standard" | "full" | "custom";
  readonly cases: "all" | readonly string[];
  readonly arms: readonly Arm[];
  readonly subjects: readonly string[];
  readonly effort?: string;
  readonly repeats: number;
  readonly judges: readonly string[];
  readonly cap: { readonly tokens?: number; readonly usd?: number };
  readonly concurrency?: number;
}

export interface Plan {
  readonly run: string;
  readonly folder: string;
  readonly created: string;
  readonly config: Config;
  readonly configSha256: string;
  readonly harness: { readonly commit: string; readonly uncommitted: number };
  /** What the pod arm runs on: the runtime's packages as git trees, and the components the runtime resolves. */
  readonly podCommits: {
    readonly packages: Readonly<Record<string, string>>;
    readonly components: readonly Component[];
  };
  readonly prompts: typeof PROMPT_VERSIONS;
  readonly cases: readonly {
    readonly id: string;
    readonly downloadsSha256: string;
    readonly keySha256: string;
    readonly prepared: Prepared;
  }[];
  readonly jobs: Job[];
  readonly estimate: { readonly tokens: number; readonly usd: number };
  readonly fitsCap: boolean;
}

/** The packages a pod-arm answer depends on, beside the components. */
const POD_PACKAGES = [
  "packages/runtime",
  "packages/cascade-runtime",
  "packages/mcp",
  "packages/apple-health",
  "packages/ccda-download",
  "packages/fhir-pull",
  "packages/evals/src/pod-client.ts",
];

const REPO = dirname(dirname(PACKAGE));

/** Each package's git tree at HEAD, marked dirty when it has uncommitted changes, so a dirty tree is never reused. */
function packageTrees(): Record<string, string> {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
  const trees: Record<string, string> = {};
  for (const path of POD_PACKAGES) {
    let tree = "unknown";
    try {
      tree = git("rev-parse", `HEAD:${path}`);
      if (git("status", "--porcelain", "--", path) !== "") tree += "+dirty";
    } catch {
      // not a git checkout
    }
    trees[path] = tree;
  }
  return trees;
}

export async function loadConfig(nameOrPath: string): Promise<Config> {
  const path = existsSync(nameOrPath)
    ? nameOrPath
    : join(CONFIGS, `${nameOrPath}.json`);
  return valid<Config>(
    "config",
    JSON.parse(await readFile(path, "utf8")),
    path,
  );
}

const short = (model: string) => model.replace(/^claude-/, "");

/** The model family a Claude Code agent is asked for: the Agent tool and a workflow name models by alias. */
export const aliasOf = (model: string) =>
  /fable/.test(model)
    ? "fable"
    : /haiku/.test(model)
      ? "haiku"
      : /sonnet/.test(model)
        ? "sonnet"
        : "opus";

interface Priors {
  readonly base: number;
  readonly subjectOutput: number;
  readonly podCalls: number;
  readonly runs: readonly {
    case: string;
    arm: Arm;
    model: string;
    context: number;
  }[];
}

/**
 * Every finished job of every run kept here and in history, for reuse and for estimates; never one of a run planned
 * from uncommitted work, which no commit reproduces.
 */
export async function pastJobs(): Promise<
  { run: string; folder: string; job: Job }[]
> {
  const found: { run: string; folder: string; job: Job }[] = [];
  for (const root of [HISTORY, RUNS]) {
    let names: string[];
    try {
      names = await readdir(root);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      const path = join(root, name, "results.json");
      if (!existsSync(path)) continue;
      const results = JSON.parse(await readFile(path, "utf8")) as Results;
      if (uncommittedIn(results).length > 0) continue;
      for (const job of results.jobs)
        if (job.status === "done" && job.stats !== undefined)
          found.push({ run: results.run.id, folder: join(root, name), job });
    }
  }
  return found;
}

/** A job's estimate: the mean of past runs of the same case, arm and model, else the comparison's prior, else the case's size. */
export function estimateOf(
  job: Pick<Job, "role" | "case" | "arm" | "model">,
  past: readonly { job: Job }[],
  priors: Priors,
  found: Case,
  bytes: number,
): { tokens: number; usd: number; basis: string } {
  const same = past.filter(
    ({ job: it }) =>
      it.role === job.role &&
      it.case === job.case &&
      it.arm === job.arm &&
      it.model === job.model,
  );
  if (same.length > 0) {
    const mean = (pick: (it: Job) => number) =>
      same.reduce((sum, { job: it }) => sum + pick(it), 0) / same.length;
    return {
      tokens: Math.round(mean((it) => it.stats!.tokens.total)),
      usd: mean((it) => it.stats!.cost.usd ?? 0),
      basis: `the mean of ${same.length} past run(s)`,
    };
  }
  const family = aliasOf(job.model);
  const prior = priors.runs.find(
    (it) => it.case === job.case && it.arm === job.arm && it.model === family,
  );
  const context =
    prior?.context ??
    (job.arm === "records" ? Math.round(bytes / 3.3) + priors.base : 100_000);
  const calls =
    job.arm === "pod"
      ? priors.podCalls
      : found.reading.length + Math.ceil(bytes / 60_000) + 3;
  const tokens = Math.round((calls * (priors.base + context)) / 2);
  const output = priors.subjectOutput;
  const usd =
    callCost(job.model, {
      input: 0,
      cacheCreation: context,
      cacheRead: Math.max(0, tokens - context - output),
      output,
    }) ?? 0;
  return {
    tokens,
    usd,
    basis:
      prior === undefined
        ? "the case's size"
        : "the comparison of 2026-10-30, as a prior",
  };
}

/** A run's id: the date and time it was planned, and the tier. */
const runId = (tier: string, at: Date) =>
  `${at.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}-${tier}`;

/**
 * Plans a run: prepares each case, lists the subject jobs, reuses what an earlier run answered for the same inputs,
 * estimates the rest and writes the run's folder. Judges are planned once their subjects have answered.
 */
export async function planRun(
  configName: string,
  run: string | undefined,
  log: (line: string) => void,
): Promise<Plan> {
  const config = await loadConfig(configName);
  const created = new Date();
  const id = run ?? runId(config.tier, created);
  const folder = join(RUNS, id);
  if (existsSync(join(folder, "plan.json")))
    throw new Error(`${folder} already holds a plan`);
  await mkdir(join(folder, "answers"), { recursive: true });
  const ids = config.cases === "all" ? await caseIds() : [...config.cases];
  const priors = JSON.parse(await readFile(PRIORS, "utf8")) as Priors;
  const past = await pastJobs();
  const harness = harnessCommit();
  const podCommits = {
    packages: packageTrees(),
    components: (await components()).resolved,
  };
  const unpriced = [...config.subjects, ...config.judges].filter(
    (model) =>
      callCost(model, {
        input: 0,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
      }) === undefined,
  );
  if (unpriced.length > 0)
    throw new Error(
      `prices.json prices no ${unpriced.join(", ")}: a model with no price would leave the dollar cap unchecked`,
    );
  const dirty =
    harness.uncommitted > 0 ||
    Object.values(podCommits.packages).some((tree) =>
      tree.endsWith("+dirty"),
    ) ||
    podCommits.components.some((it) => (it.uncommitted ?? 0) > 0);
  if (dirty)
    log(
      `${id}: planned from uncommitted work, so it reuses nothing and cannot be recorded into history`,
    );
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  const cases: Plan["cases"][number][] = [];
  const jobs: Job[] = [];
  for (const caseId of ids) {
    const found = await loadCase(caseId);
    const prepared = await prepare(caseId, log);
    const { sha256: keySha256 } = await loadKey(caseId);
    cases.push({
      id: caseId,
      downloadsSha256: prepared.downloadsSha256,
      keySha256,
      prepared,
    });
    const caseSha = sha256(JSON.stringify(found));
    const bytes = prepared.documents.reduce((sum, it) => sum + it.bytes, 0);
    for (const model of config.subjects)
      for (const arm of config.arms)
        for (let repeat = 1; repeat <= config.repeats; repeat++) {
          const jobId = `${caseId}.${arm}.${short(model)}.r${repeat}`;
          const inputsHash = sha256(
            JSON.stringify({
              role: "subject",
              case: caseSha,
              downloads: prepared.downloadsSha256,
              arm,
              model,
              effort: config.effort ?? null,
              prompt: PROMPT_VERSIONS[arm],
              repeat,
              ...(arm === "pod" ? { pod: podCommits } : {}),
            }),
          );
          const answer = join(folder, "answers", `${jobId}.json`);
          const tag = `${id}/${jobId}`;
          const prompt = subjectPrompt({
            arm,
            tag,
            name: found.person.name,
            pronoun: found.person.pronoun,
            today: found.today,
            answer,
            ...(arm === "records"
              ? { folder: prepared.downloads, files: found.reading }
              : {
                  command: `node "${cli}" pod --run "${folder}" --job ${jobId}`,
                  pod: prepared.pod,
                }),
          });
          const job: Job = {
            id: jobId,
            role: "subject",
            case: caseId,
            arm,
            model,
            alias: aliasOf(model),
            ...(config.effort === undefined ? {} : { effort: config.effort }),
            repeat,
            tag,
            inputsHash,
            status: "pending",
            estimate: estimateOf(
              { role: "subject", case: caseId, arm, model },
              past,
              priors,
              found,
              bytes,
            ),
            answer: `answers/${jobId}.json`,
            prompt: `prompts/${jobId}.txt`,
          };
          const earlier = dirty
            ? undefined
            : past.find(
                (it) =>
                  it.job.inputsHash === inputsHash &&
                  it.job.answer !== undefined,
              );
          if (
            earlier !== undefined &&
            existsSync(join(earlier.folder, earlier.job.answer!))
          ) {
            await copyFile(join(earlier.folder, earlier.job.answer!), answer);
            Object.assign(job, {
              status: "reused",
              reusedFrom: `${earlier.run}/${earlier.job.id}`,
              stats: earlier.job.stats,
              calls: earlier.job.calls,
              toolUses: earlier.job.toolUses,
            });
            const kept = JSON.parse(
              await readFile(join(earlier.folder, "results.json"), "utf8"),
            ) as Results;
            const calls = kept.toolCalls.filter(
              (it) => it.job === earlier.job.id,
            );
            if (calls.length > 0)
              await appendFile(
                join(folder, "tool-calls.jsonl"),
                calls
                  .map((it) => `${JSON.stringify({ ...it, job: jobId })}\n`)
                  .join(""),
              );
          }
          await mkdir(join(folder, "prompts"), { recursive: true });
          await writeFile(join(folder, job.prompt!), prompt);
          jobs.push(job);
        }
  }
  const pending = jobs.filter((it) => it.status === "pending");
  const estimate = {
    tokens: pending.reduce((sum, it) => sum + it.estimate.tokens, 0),
    usd: pending.reduce((sum, it) => sum + it.estimate.usd, 0),
  };
  const fitsCap =
    (config.cap.tokens === undefined || estimate.tokens <= config.cap.tokens) &&
    (config.cap.usd === undefined || estimate.usd <= config.cap.usd);
  const plan: Plan = {
    run: id,
    folder,
    created: created.toISOString(),
    config,
    configSha256: sha256(JSON.stringify(config)),
    harness,
    podCommits,
    prompts: PROMPT_VERSIONS,
    cases,
    jobs,
    estimate,
    fitsCap,
  };
  await writeFile(
    join(folder, "plan.json"),
    JSON.stringify(plan, null, 2) + "\n",
  );
  log(
    `${id}: ${pending.length} job(s) to run, ${jobs.length - pending.length} reused; estimate ${estimate.tokens} tokens, $${estimate.usd.toFixed(2)}; cap ${JSON.stringify(config.cap)}${fitsCap ? "" : " — the estimate passes the cap: the run stops when the next job would pass it"}`,
  );
  return plan;
}

export async function loadPlan(folder: string): Promise<Plan> {
  return JSON.parse(await readFile(join(folder, "plan.json"), "utf8")) as Plan;
}

export async function savePlan(plan: Plan): Promise<void> {
  await writeFile(
    join(plan.folder, "plan.json"),
    JSON.stringify(plan, null, 2) + "\n",
  );
}
