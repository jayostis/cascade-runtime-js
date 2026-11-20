import { type Row } from "./perf-report.js";

/** One row as a build's file holds it: a clock row of one sample for a time, a cost or output row for a count. */
const clock = (name: string, value: number, unit: Row["unit"] = "s"): Row => ({
  name,
  unit,
  value,
  kind: "clock",
  samples: 3,
  range: `${value}-${value}`,
});
const count = (name: string, value: number): Row => ({
  name,
  unit: "{count}",
  value,
  kind: "output",
});

/**
 * The rows of a build whose file measured the jobs of every day at one size, as the harness names them: the first import and
 * a reopen right after it (which the jobs are read against), and each job. The first import took 3 s; importing the same
 * file again took 0.8 s and wrote nothing; with ten source entries changed 2.4 s; with one more 1.6 s; a reopen after the
 * process was stopped without closing 2.0 s, against 0.5 s for a reopen after a proper close; the first question after an
 * update 0.6 s.
 */
export const rowsOfJobs = (dataset = "synthea-10y"): Row[] => {
  const fresh = `fresh-first-screen-${dataset}`;
  const again = (
    scenario: string,
    times: { total: number; open: number; import: number },
    counts: Record<string, number>,
  ): Row[] => [
    clock(`${scenario}-${dataset}/total`, times.total),
    clock(`${scenario}-${dataset}/open`, times.open),
    clock(`${scenario}-${dataset}/import`, times.import),
    clock(`${scenario}-${dataset}/first-answer`, 0.05),
    clock(`${scenario}-${dataset}/close`, 0.4),
    ...Object.entries(counts).map(([name, value]) =>
      count(`${scenario}-${dataset}/count/${name}`, value),
    ),
  ];
  return [
    clock(`${fresh}/total`, 4),
    clock(`${fresh}/import`, 3),
    count(`${fresh}/count/records`, 647),
    clock(`reopen-first-answer-${dataset}/total`, 0.5),
    ...again(
      "reimport-identical",
      { total: 0.9, open: 0.1, import: 0.8 },
      {
        "files-written": 0,
        "statements-added": 0,
        converts: 0,
        "versions-added": 0,
        "revisions-added": 0,
        "records-added": 0,
        "entries-changed": 0,
        "entries-added": 0,
      },
    ),
    ...again(
      "reimport-changed",
      { total: 2.5, open: 0.1, import: 2.4 },
      {
        "files-written": 24,
        "statements-added": 160,
        converts: 1,
        "versions-added": 10,
        "revisions-added": 10,
        "records-added": 0,
        "entries-changed": 10,
        "entries-added": 0,
      },
    ),
    ...again(
      "add-one-record",
      { total: 1.7, open: 0.1, import: 1.6 },
      {
        "files-written": 4,
        "statements-added": 31,
        converts: 1,
        "versions-added": 1,
        "revisions-added": 1,
        "records-added": 1,
        "entries-changed": 0,
        "entries-added": 1,
      },
    ),
    clock(`reopen-after-kill-${dataset}/total`, 2),
    clock(`reopen-after-kill-${dataset}/open`, 1.8),
    clock(`reopen-after-kill-${dataset}/first-read`, 0.2),
    count(`reopen-after-kill-${dataset}/count/files-read`, 1712),
    count(`reopen-after-kill-${dataset}/count/statements-read`, 19636),
    count(`reopen-after-kill-${dataset}/count/database-found`, 0),
    clock(`question-after-update-${dataset}/total`, 0.6),
    clock(`question-after-update-${dataset}/open`, 0.5),
    clock(`question-after-update-${dataset}/first-read`, 0.1),
  ];
};
