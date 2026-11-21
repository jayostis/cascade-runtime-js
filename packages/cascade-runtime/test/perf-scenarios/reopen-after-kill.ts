import { writeFile } from "node:fs/promises";
import { type Context } from "../perf-context.js";
import { type Job, type Measured, nameOf } from "../perf-job.js";
import { countRow, outputRow, type Row } from "../perf-rows.js";
import { measureFresh } from "./fresh-first-screen.js";
import { type Stored } from "./stored.js";

/**
 * A new pod takes the whole record in and answers the first screen, as the first import does, and then its process is
 * stopped without the pod being closed: the harness's own process ends itself with SIGKILL, which no handler can catch, so
 * what the pod folder holds is exactly what the import and the first screen had written when the signal came. The signal is
 * sent from the line after the last awaited step (`import` resolves once its files are written, the act last), so the same
 * files are written on every run. The result is written to `job.out` before it, because the process never returns.
 */
export async function measureKilled(job: Job): Promise<Measured> {
  const result = await measureFresh(job, false);
  await writeFile(job.out, JSON.stringify(result));
  process.kill(process.pid, "SIGKILL");
  // The signal is delivered asynchronously on some systems: wait for it, never run on.
  await new Promise<never>(() => undefined);
  throw new Error("the process outlived its own SIGKILL");
}

/** What a reopen of the killed pod is told besides its times: what it had to read, and that there was no database to start from. */
export function killedRows(
  ctx: Context,
  stored: Stored,
  databaseFound: boolean,
): Row[] {
  const name = nameOf("reopen-after-kill", ctx.dataset, ctx.encrypted);
  const loaded = stored.loaded;
  return [
    outputRow(`${name}/count/database-found`, databaseFound ? 1 : 0, ctx.about),
    ...(loaded === undefined
      ? []
      : [
          countRow(`${name}/count/files-read`, loaded.files, ctx.about),
          countRow(
            `${name}/count/statements-read`,
            loaded.statements,
            ctx.about,
          ),
        ]),
  ];
}
