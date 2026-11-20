import { type Context } from "../perf-context.js";
import {
  maybeProbed,
  type Measured,
  type Job,
  measured,
  openedAt,
  samplesOf,
  type TraceNote,
} from "../perf-job.js";
import { clockRow, part, type Row, unique } from "../perf-rows.js";
import { FIRST_READ } from "./reopen-first-answer.js";

/** The questions a page of the pod's database answers, each asked for a first page. */
export const PAGES = [
  "pod/My lab results",
  "pod/My medication history",
  "pod/My condition history",
  "pod/My active conditions",
  "pod/My active medications",
  "pod/My active allergies",
  "pod/My immunizations",
  "pod/My procedures",
  "pod/My genetic variants",
  "pod/My reports, notes and documents",
  "pod/What each import brought in",
  "pod/What everything is called",
  "pod/How many of each kind",
  "pod/Which reference versions are current",
  "pod/The person this pod is about",
  "profile/What needs review",
] as const;
export const PAGE_SIZE = 20;

/** A pod that already holds the record is opened and one page of the answer to each question is fetched. */
export async function measureQuestionPage(job: Job): Promise<Measured> {
  const seconds: Record<string, number> = {};
  const notes: TraceNote[] = [];
  const opened = await openedAt(job.folder, job.encrypted);
  await opened.ask(FIRST_READ);
  const rssBytes = process.memoryUsage.rss();
  const body = await maybeProbed(job, "question-page", notes, async () => {
    for (const question of PAGES) {
      const started = performance.now();
      await opened.askPage(question, { size: PAGE_SIZE });
      seconds[`question:${question}`] = (performance.now() - started) / 1000;
    }
  });
  await opened.close();
  return measured({
    seconds,
    parts: {},
    rssBytes,
    wrote: 0,
    seen: body.seen,
    notes,
  });
}

/** The sum of every question's seconds in one run. */
export const questionPageTotal = (each: Measured): number =>
  Object.entries(each.seconds).reduce((sum, [, value]) => sum + value, 0);

/** The headline rows of the question-page runs. */
export function questionPageRows(
  ctx: Context,
  name: string,
  runs: readonly Measured[],
): Row[] {
  const { how } = ctx;
  const from = (pick: (each: Measured) => number | undefined) =>
    samplesOf(runs, pick);
  const taken = new Set<string>();
  const rows: Row[] = [
    clockRow(
      `${name}/total`,
      "s",
      runs.map(questionPageTotal),
      `${PAGES.length} questions, a page of ${PAGE_SIZE} each, from pod.db; ${how}`,
    ),
    clockRow(
      `${name}/rss`,
      "By",
      runs.map((each) => each.rssBytes),
      `after a first read, before the pages; ${how}`,
    ),
    clockRow(
      `${name}/peak-rss`,
      "By",
      runs.map((each) => each.peakRssBytes),
      how,
    ),
  ];
  for (const question of PAGES)
    rows.push(
      clockRow(
        `${name}/${unique(taken, `question-${part(question)}`)}`,
        "s",
        from((each) => each.seconds[`question:${question}`]),
        `askPage(${question}, size ${PAGE_SIZE}); ${how}`,
      ),
    );
  return rows;
}
