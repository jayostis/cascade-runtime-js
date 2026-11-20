import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { availableParallelism, cpus, release } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { componentsOf, findRoot } from "@cascade-runtime/runtime/node";
import { type Plan } from "./perf-plan.js";
import { type PerfFile } from "./perf-rows.js";
import { resolved } from "../src/node/resolved.js";

function git(folder: string, ...args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", folder, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/** A checkout's HEAD, `-dirty` when it holds changes the commit does not. */
function headOf(folder: string): string | undefined {
  const head = git(folder, "rev-parse", "HEAD");
  if (head === undefined || !/^[0-9a-f]{40}$/.test(head)) return undefined;
  return git(folder, "status", "--porcelain") === "" ? head : `${head}-dirty`;
}

/** A resolved component's commit, `-dirty` when its folder holds changes the commit does not; undefined for a folder that is no checkout. */
function commitOf(resolvedAt: {
  commit?: string;
  uncommitted?: number;
}): string | undefined {
  const { commit, uncommitted = 0 } = resolvedAt;
  if (commit === undefined || !/^[0-9a-f]{40}$/.test(commit)) return undefined;
  return uncommitted > 0 ? `${commit}-dirty` : commit;
}

/** The runtime checkout's folder, the one holding cascade-runtime.json. */
export const RUNTIME_ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));

/** The starter kit's folder name: its checkout is beside the runtime's. */
export const KIT = "cascade-starter-kit";

/**
 * The commit of the runtime and of each component the run read (the vocabulary, the fhir-r4 adapter that owns the
 * record and its mapping, the Bridge, the reference tables), and of the kit when a checkout of it is beside this one.
 */
export async function commits(): Promise<Record<string, string>> {
  const root = RUNTIME_ROOT;
  const found: Record<string, string | undefined> = { runtime: headOf(root) };
  const parts = await resolved();
  found.vocabulary = commitOf(parts.local.resolved);
  const components = await componentsOf(
    fileURLToPath(new URL("../../", import.meta.url)),
  );
  /** What cannot be found is left out of a file written where it cannot be. */
  const each = async (
    name: string,
    work: () => Promise<string | undefined>,
  ): Promise<void> => {
    try {
      found[name] = await work();
    } catch {
      // left out
    }
  };
  await each("bridge", async () => {
    const { commit } = await components.bridge();
    return /^[0-9a-f]{40}$/.test(commit) ? commit : undefined;
  });
  await each("adapter-fhir-r4", async () => {
    const adapter = components.config.adapters.find(({ repository }) =>
      repository.endsWith("cascade-bridge-adapter-fhir-r4"),
    );
    return adapter === undefined
      ? undefined
      : commitOf(await components.resolve(adapter));
  });
  await each("reference-tables", async () =>
    commitOf(await components.resolve(components.config.tables.repository)),
  );
  const kit = join(dirname(root), KIT);
  if (existsSync(kit)) found.kit = headOf(kit);
  return Object.fromEntries(
    Object.entries(found).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

/** The file's environment. The runner is named by its kind, never by the job's own name, which differs on every run. */
export function envOf(plan: Plan): PerfFile["env"] {
  const model = cpus()[0]?.model.replace(/\s+/g, " ").trim() ?? "unknown cpu";
  const runner =
    process.env.GITHUB_ACTIONS === "true"
      ? `github-actions ${process.env.RUNNER_OS ?? ""}`.trim()
      : "local";
  return {
    os: `${process.platform} ${release()}`,
    runner: `${runner}; ${model}; other load: ${process.env.PERF_OTHER_LOAD ?? "none known"}`,
    cpus: availableParallelism(),
    node: process.versions.node,
    host: "node",
    profile: `runtime-perf ${[...plan.scenarios].join("+")}; headline unprobed median of ${plan.repeats}${plan.probe ? ", stages from one probed run" : ""}`,
  };
}
