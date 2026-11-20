import { type Context } from "../perf-context.js";
import {
  maybeProbed,
  type Measured,
  type Job,
  measured,
  openedAt,
  samplesOf,
  secs,
  stepper,
  type TraceNote,
} from "../perf-job.js";
import { clockRow, type Row } from "../perf-rows.js";

/** The first and the second read of a reopened pod: the bench's, so the numbers continue its. */
export const FIRST_READ = "pod/My active conditions";
export const SECOND_READ = "pod/My active medications";

/** A pod that already holds the record is opened, asked two questions and closed. */
export async function measureReopen(job: Job): Promise<Measured> {
  const { seconds, step } = stepper();
  const notes: TraceNote[] = [];
  let rssBytes = 0;
  const body = await maybeProbed(
    job,
    "reopen-first-answer",
    notes,
    async () => {
      const opened = await step("open", () =>
        openedAt(job.folder, job.encrypted),
      );
      await step("first-read", () => opened.ask(FIRST_READ));
      await step("second-read", () => opened.ask(SECOND_READ));
      rssBytes = process.memoryUsage.rss();
      await step("close", () => opened.close());
    },
  );
  return measured({
    seconds,
    parts: {},
    rssBytes,
    wrote: 0,
    seen: body.seen,
    notes,
  });
}

/** The headline rows of the reopen runs. */
export function reopenRows(
  ctx: Context,
  name: string,
  runs: readonly Measured[],
): Row[] {
  const { how } = ctx;
  const from = (pick: (each: Measured) => number | undefined) =>
    samplesOf(runs, pick);
  return [
    clockRow(
      `${name}/total`,
      "s",
      runs.map((each) => secs(each, "open", "first-read")),
      `open + first read; ${how}`,
    ),
    clockRow(
      `${name}/open`,
      "s",
      from((each) => each.seconds.open),
      how,
    ),
    clockRow(
      `${name}/first-read`,
      "s",
      from((each) => each.seconds["first-read"]),
      `${FIRST_READ}; ${how}`,
    ),
    clockRow(
      `${name}/second-read`,
      "s",
      from((each) => each.seconds["second-read"]),
      `${SECOND_READ}; ${how}`,
    ),
    clockRow(
      `${name}/close`,
      "s",
      from((each) => each.seconds.close),
      how,
    ),
    clockRow(
      `${name}/rss`,
      "By",
      runs.map((each) => each.rssBytes),
      `after the second read; ${how}`,
    ),
    clockRow(
      `${name}/peak-rss`,
      "By",
      runs.map((each) => each.peakRssBytes),
      how,
    ),
  ];
}

/** What the probed run's total is, of the steps the headline's total is. */
export const reopenProbedTotal = (probed: Measured): number =>
  secs(probed, "open", "first-read");
