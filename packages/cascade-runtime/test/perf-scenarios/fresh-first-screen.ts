import { loadDataset, pullOf } from "../perf-data.js";
import { type Context } from "../perf-context.js";
import {
  maybeProbed,
  type Measured,
  type Job,
  measured,
  nameOf,
  openedAt,
  partsOf,
  samplesOf,
  secs,
  stepper,
  type TraceNote,
} from "../perf-job.js";
import {
  clockRow,
  countRow,
  part,
  probedRows,
  type Row,
  unique,
} from "../perf-rows.js";
import { type Tabulated } from "../perf-rows.js";

/**
 * The questions the starter kit's pod page asks first, in its order (cascade-starter-kit app/said.ts `QUESTIONS`),
 * and `THEN`, the profile's question (app/pod-api.ts `waitingForAnswer`), which the kit's `asked` starts in the same
 * breath, with `unheldTableVersions()`. Kept here because the kit is another repository; the kit's commit is in the
 * file's `commit` map when a checkout of it is beside this one, and a test fails when one of these is not in said.ts.
 */
export const FIRST_SCREEN = [
  "entry/Where it came from",
  "pod/What was seen more than once",
  "entry/What needs review",
  "pod/My genetic variants",
  "pod/What each report says of a variant",
  "pod/My medication history",
  "pod/What each import brought in",
  "pod/My active allergies",
  "pod/My active conditions",
  "pod/My lab results",
  "pod/My immunizations",
  "pod/My procedures",
] as const;
/** What the kit's `waitingForAnswer` asks, with the first screen's questions. */
export const THEN = "profile/What needs review";

/**
 * A new, empty pod takes the whole record in and answers the first screen, then closes: one child process, whose
 * close is the `close` scenario's measurement (perf-scenarios/close.ts). With `closing` false it ends there, the pod
 * left open, for the process that is stopped before it closes (perf-scenarios/reopen-after-kill.ts).
 */
export async function measureFresh(
  job: Job,
  closing = true,
): Promise<Measured> {
  const { seconds, step } = stepper();
  const parts: Record<string, number> = {};
  const data = await loadDataset(job.dataset);
  let pull: ReadonlyMap<string, Uint8Array> | undefined = pullOf(
    data,
    data.bundle,
  );
  let wrote = 0;
  const notes: TraceNote[] = [];
  let pod: Awaited<ReturnType<typeof openedAt>> | undefined;
  // The harness's own copy of the record is dropped before the pod opens, so it is not in what the pod is charged.
  (data as { bundle: unknown }).bundle = undefined;
  const body = await maybeProbed(job, "fresh-first-screen", notes, async () => {
    pod = await step("open", () => openedAt(job.folder, job.encrypted));
    const opened = pod;
    const marks: { part: string; at: number }[] = [];
    const done = await step("import", () =>
      opened.import(pull as ReadonlyMap<string, Uint8Array>, {
        claimProfiles: job.claim,
        onProgress: ({ part: named }) => {
          marks.push({ part: named, at: performance.now() });
        },
      }),
    );
    pull = undefined;
    if (done.refused !== undefined)
      throw new Error(`the import was refused: ${done.refused}`);
    wrote = done.wrote.length;
    Object.assign(parts, partsOf(marks, performance.now()));
    // All together, as the kit's `asked` starts them: the questions, the tables newer than the pod's, and the profile's.
    await step("first-screen", async () => {
      await Promise.all([
        opened.unheldTableVersions(),
        opened.ask(THEN),
        ...FIRST_SCREEN.map((question) => opened.ask(question)),
      ]);
    });
  });
  const rssBytes = process.memoryUsage.rss();
  if (!closing)
    return measured({
      seconds,
      parts,
      rssBytes,
      wrote,
      seen: body.seen,
      notes,
    });
  const closed = await maybeProbed(job, "close", notes, () =>
    step("close", () => (pod as NonNullable<typeof pod>).close()),
  );
  return measured({
    seconds,
    parts,
    rssBytes,
    wrote,
    seen: body.seen,
    closeSeen: closed.seen,
    notes,
  });
}

/** The count of records in the input, which the scenario's rows begin with. */
export function recordsRow(ctx: Context, records: number): Row {
  return countRow(
    `${nameOf("fresh-first-screen", ctx.dataset, ctx.encrypted)}/count/records`,
    records,
    ctx.about,
  );
}

/** The headline rows of the fresh runs: the steps, the memory, the import's parts and the files written. */
export function freshRows(ctx: Context, fresh: readonly Measured[]): Row[] {
  const { about, how } = ctx;
  const name = nameOf("fresh-first-screen", ctx.dataset, ctx.encrypted);
  const samples = (pick: (each: Measured) => number | undefined) =>
    samplesOf(fresh, pick);
  const rows: Row[] = [
    clockRow(
      `${name}/total`,
      "s",
      fresh.map((each) => secs(each, "open", "import", "first-screen")),
      `open + import + first screen; ${how}`,
    ),
    clockRow(
      `${name}/open`,
      "s",
      samples((each) => each.seconds.open),
      how,
    ),
    clockRow(
      `${name}/import`,
      "s",
      samples((each) => each.seconds.import),
      how,
    ),
    clockRow(
      `${name}/first-screen`,
      "s",
      samples((each) => each.seconds["first-screen"]),
      how,
    ),
    clockRow(
      `${name}/rss`,
      "By",
      samples((each) => each.rssBytes),
      `after the first screen, before close; the harness's own copy of the input is dropped before the pod opens; ${how}`,
    ),
    clockRow(
      `${name}/peak-rss`,
      "By",
      samples((each) => each.peakRssBytes),
      `the most the process reached, as the operating system keeps it; ${how}`,
    ),
  ];
  rows.push(...phaseRows(ctx, name, fresh));
  const wrote = fresh[0]?.wrote;
  if (wrote !== undefined)
    rows.push(countRow(`${name}/count/files-written`, wrote, about));
  return rows;
}

/** One row for each part of the import that any of the runs went through (the loading, converting, saving and judging marks). */
export function phaseRows(
  ctx: Context,
  name: string,
  runs: readonly Measured[],
): Row[] {
  const taken = new Set<string>();
  return [...new Set(runs.flatMap((each) => Object.keys(each.parts)))].map(
    (each) =>
      clockRow(
        `${name}/${unique(taken, `phase-${part(each.replace(/\s*\d+\/\d+$/, ""))}`)}`,
        "s",
        samplesOf(runs, (one) => one.parts[each]),
        `part of the import (onProgress marks); ${ctx.how}`,
      ),
  );
}

/** The rows of the probed fresh run: its total and its stages. */
export function freshProbedRows(
  ctx: Context,
  probed: Measured,
  seen: Tabulated,
  note: string,
): Row[] {
  const name = nameOf("fresh-first-screen", ctx.dataset, ctx.encrypted);
  return [
    {
      ...clockRow(
        `${name}/probed-total`,
        "s",
        [secs(probed, "open", "import", "first-screen")],
        note,
      ),
    },
    ...probedRows(name, seen),
  ];
}
