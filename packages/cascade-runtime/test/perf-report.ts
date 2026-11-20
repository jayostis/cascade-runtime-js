import "./offline.js";
import { writeSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { CHILD } from "./perf-child.js";
import { pinClock, pinOf } from "./perf-clock.js";
import { type Job } from "./perf-job.js";
import { measure } from "./perf-measure.js";
import { parsed } from "./perf-plan.js";
import { perfFile } from "./perf-run.js";

/**
 * The runtime's performance file: fixed, named scenarios over a real person's record (a Synthea patient the fhir-r4
 * adapter commits under bench/), written as rows in the Bridge spec's result format (cascade-bridge-spec
 * bench/result.schema.json), so one reader and one comparison serve every repository.
 *
 * Run it as `npm run perf -- [--scenario fresh-first-screen,floor,...] [--size synthea-10y,...] [--encryption plain|encrypted|both]
 * [--repeats 3] [--no-probe] [--out file] [--profiles folder [--no-cpu-profile]]`.
 *
 * Two kinds of run, never mixed: the headline rows (`<scenario>/total` and the rest that are not under `stage/` or
 * `count/`) come from UNPROBED runs, each in a process of its own, a plain `performance.now()` around each step, repeated
 * (median, range, samples); the stage and count rows come from ONE separate PROBED run, which times some work one at a
 * time and so is slower than a real run: its stages are for finding where time goes, never for adding up to a total.
 *
 * With `--profiles`, the folder also gets, for each scenario, a trace of the probed run (`<scenario>-<size>.trace.json`, every
 * call as a Chrome trace event) and a CPU profile of one more, unprobed run (`<scenario>-<size>.cpuprofile`, which node
 * writes), and `flame.json` that lists them with the steps whose own time was longest. speedscope opens both.
 *
 * Where each thing is: a scenario's own code (what its child process measures, and its rows) is one module in
 * `perf-scenarios/`, and its glossary sentences are the fragment of `perf-glossary/` that names it. The rest is shared:
 * `perf-plan` (the flags), `perf-data` (the input), `perf-rows` (the row format and its helpers), `perf-job` (what a
 * child measures and what it hands back), `perf-child` (the child process), `perf-measure` (which module a child runs),
 * `perf-run` (the plan's order, the file) and `perf-env` (the machine and the commits). This file is the entry the child
 * runs and the one place every name is exported from, so a reader of a file written by it imports nothing else.
 */

export * from "./perf-child.js";
export * from "./perf-clock.js";
export * from "./perf-data.js";
export * from "./perf-env.js";
export * from "./perf-fingerprint.js";
export * from "./perf-job.js";
export * from "./perf-plan.js";
export * from "./perf-rows.js";
export * from "./perf-run.js";
export * from "./perf-scenarios/close.js";
export * from "./perf-scenarios/file-ops.js";
export * from "./perf-scenarios/floor.js";
export * from "./perf-scenarios/fresh-first-screen.js";
export * from "./perf-scenarios/question-page.js";
export * from "./perf-scenarios/reopen-first-answer.js";

async function main(args: string[]): Promise<void> {
  const at = args.indexOf(CHILD);
  if (at !== -1) {
    const job = JSON.parse(args[at + 1] as string) as Job;
    // What the job writes with the time or a new id is then the same on every run of it, as a fingerprint of it needs,
    // and differs from what another job writes (a later job into the same pod has its own ids and a later time).
    pinClock(pinOf(job));
    await writeFile(job.out, JSON.stringify(await measure(job)));
    return;
  }
  const { plan, out } = parsed(args);
  // A run that ends without its file says how it ended, and by which signal it was told to.
  let finished = false;
  const say = (text: string) =>
    writeSync(
      2,
      `${text}
`,
    );
  process.on("exit", (code) => {
    if (!finished) say(`the performance run ended early, exit code ${code}`);
  });
  process.on("beforeExit", () => {
    if (!finished) say("the performance run has nothing left to wait for");
  });
  const started = performance.now();
  const file = await perfFile(
    plan,
    (line) =>
      process.stderr.write(
        `[${((performance.now() - started) / 1000).toFixed(0)}s] ${line}\n`,
      ),
    async (so) => {
      if (out !== undefined)
        await writeFile(out, `${JSON.stringify(so, null, 2)}\n`);
    },
  );
  const text = `${JSON.stringify(file, null, 2)}\n`;
  if (out === undefined) process.stdout.write(text);
  else await writeFile(out, text);
  finished = true;
  process.stderr.write(
    `${file.results.length} rows${out === undefined ? "" : ` written to ${out}`}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main(process.argv.slice(2));
