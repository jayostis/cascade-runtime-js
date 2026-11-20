import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { type CpuNote, type Job, type Measured } from "./perf-job.js";

const run = promisify(execFile);

/** The argument that makes the harness's own script measure one job instead of running a plan. */
export const CHILD = "--child";

/** The script a child runs: the harness's entry, which `main` there sends to `measure`. */
const ENTRY = fileURLToPath(new URL("./perf-report.js", import.meta.url));

/** The most often the processor is sampled while a CPU profile is taken, in microseconds: node's own is 1000. */
const CPU_INTERVAL = 500;

/**
 * Gives the profiles `--cpu-prof` wrote in `from` the names a reader opens them by: the main thread's is `<name>.cpuprofile`
 * and each worker's `<name>.<role>.cpuprofile`, the role being the worker's script (`pod-database-worker`).
 */
export async function keptCpu(
  from: string,
  into: string,
  name: string,
): Promise<CpuNote> {
  await mkdir(into, { recursive: true });
  const found = (await readdir(from)).filter((each) =>
    each.endsWith(".cpuprofile"),
  );
  // CPU.<date>.<time>.<pid>.<thread>.<n>.cpuprofile: the main thread is thread 0.
  const thread = (each: string) => Number(each.split(".").at(-3));
  const main = found.find((each) => thread(each) === 0);
  if (main === undefined)
    throw new Error(`node wrote no CPU profile of the main thread in ${from}`);
  const file = `${name}.cpuprofile`;
  await copyFile(join(from, main), join(into, file));
  const workers: { file: string; bytes: number; role: string }[] = [];
  const roles = new Map<string, number>();
  const threads = found
    .filter((other) => thread(other) !== 0)
    .sort((a, b) => thread(a) - thread(b));
  for (const each of threads) {
    const text = await readFile(join(from, each), "utf8");
    const role = /\/([a-z0-9-]+-worker)\.js/.exec(text)?.[1] ?? "worker";
    const seen = (roles.get(role) ?? 0) + 1;
    roles.set(role, seen);
    const named = `${name}.${role}${seen > 1 ? `-${seen}` : ""}.cpuprofile`;
    await writeFile(join(into, named), text);
    workers.push({ file: named, bytes: Buffer.byteLength(text), role });
  }
  return { file, bytes: (await stat(join(into, file))).size, workers };
}

/** One job measured in a process of its own, as fresh as a process is. */
export async function child(
  job: Omit<Job, "out">,
  dir: string,
  /** Where to keep the CPU profile of this process, under which name, when one is wanted. */
  cpu?: { into: string; name: string; notes: Map<string, CpuNote> },
): Promise<Measured> {
  const out = join(dir, `result-${Math.random().toString(36).slice(2)}.json`);
  const profiled =
    cpu === undefined ? undefined : await mkdtemp(join(dir, "cpuprof-"));
  await run(
    process.execPath,
    [
      ...process.execArgv,
      ...(profiled === undefined
        ? []
        : [
            "--cpu-prof",
            `--cpu-prof-dir=${profiled}`,
            `--cpu-prof-interval=${CPU_INTERVAL}`,
          ]),
      ENTRY,
      CHILD,
      JSON.stringify({ ...job, out }),
    ],
    { maxBuffer: 1 << 26, timeout: 3 * 3_600_000 },
  ).catch(async (error: unknown) => {
    // A killed job ends itself with a signal, after it has written its result (perf-scenarios/reopen-after-kill.ts): that
    // is its end. Any other failure, or one before the result is written, is a failure.
    if (job.scenario === "killed" && existsSync(out)) return;
    throw error;
  });
  if (cpu !== undefined && profiled !== undefined) {
    cpu.notes.set(cpu.name, await keptCpu(profiled, cpu.into, cpu.name));
    await rm(profiled, { recursive: true, force: true });
  }
  return JSON.parse(await readFile(out, "utf8")) as Measured;
}
