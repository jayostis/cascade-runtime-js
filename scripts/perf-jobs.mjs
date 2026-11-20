// What people do after the first import, read from the rows of the jobs' scenarios (packages/cascade-runtime/test/perf-scenarios/
// after-first-import.ts and reopen-after-kill.ts): the same file imported again, with some entries changed, with one more, a pod
// opened again after its process was stopped without closing it, and the first question after an update. One plain line for each
// job, for the pull request comment, the job summary, /perf/ and /perf/runs/. A line reads each job against the same build's first
// import or reopen, as a person would. It sets no bound on any figure and says nothing about one being too much.

import { storedTitle } from "./perf-stored.mjs";

/** The scenarios of the jobs, in the order their lines come. */
export const JOB_SCENARIOS = [
  "reimport-identical",
  "reimport-changed",
  "add-one-record",
  "reopen-after-kill",
  "question-after-update",
];

const SCENARIO = JOB_SCENARIOS.join("|");

/**
 * The rows a page keeps of a build's file for the jobs: those of the jobs themselves (the times of their steps and their counts),
 * and what they are read against, the first import's time and the number of source entries, and a reopen's total.
 */
export const JOBS_ROW = new RegExp(
  `^(?:(?:${SCENARIO})-[^/]+/(?:total|open|import|first-answer|first-read|count/[^/]+)|fresh-first-screen-[^/]+/(?:import|count/records)|reopen-first-answer-[^/]+/total)$`,
);

/** The rows whose `extra` says what a job's document was edited from the first one. */
export const EDIT_ROW =
  /^(?:reimport-changed|add-one-record)-[^/]+\/count\/entries-(?:changed|added)$/;

/** What the section is about, for the pages: what a job is, what it starts from and how its figures are made. */
export const JOBS_ABOUT =
  "After the first import a pod is used again and again: the same file pulled again, a file with some results changed or one more, a pod opened again after its app was stopped without closing it, and the first question after an update. Each job starts from a copy of the pod a fresh import left and runs in a process of its own, as the app would. Times are the median of the runs and counts are exact; they are measurements, nothing more. To keep every build's measurement short, a build runs each job once and leaves adding one result to the nightly run, which runs every job three times.";

/** The suffix of each size a file measured the jobs at (`synthea-10y`, `synthea-lifetime-encrypted`), in the order its rows come. */
export function jobsKeys(file) {
  const pattern = new RegExp(`^(?:${SCENARIO})-(.+?)/total$`);
  return [
    ...new Set(
      (file.results ?? []).flatMap(({ name }) => {
        const found = pattern.exec(name ?? "");
        return found === null ? [] : [found[1]];
      }),
    ),
  ];
}

const whole = (value) => Math.round(value).toLocaleString("en-US");
/** A multiple with one decimal under a hundred, whole above: 0.3, 4.0, 120. */
const ratio = (value) => (value >= 100 ? whole(value) : value.toFixed(1));
/** A time as a person reads it: 800 ms, 2.40 s, 12.3 s. */
const took = (value) => {
  if (value >= 100) return `${value.toFixed(0)} s`;
  if (value >= 10) return `${value.toFixed(1)} s`;
  if (value >= 1) return `${value.toFixed(2)} s`;
  if (value < 0.001) return `${(value * 1_000_000).toFixed(0)} us`;
  return `${(value * 1000).toFixed(value >= 0.1 ? 0 : 1)} ms`;
};
const plural = (count, one, many = `${one}s`) =>
  `${whole(count)} ${count === 1 ? one : many}`;
/** ` (4.0 x the first import)` for a time against the one it is read against; nothing without one. */
const against = (value, base, what) =>
  base === undefined || base <= 0 ? "" : ` (${ratio(value / base)} x ${what})`;
const entries = (count, what) =>
  count === 1
    ? `one source entry ${what}`
    : `${whole(count)} source entries ${what}`;

/**
 * What a file says of the jobs at one size (`key` as `jobsKeys` gives it): the number of source entries, one line for each job it
 * measured, and, for the jobs that edit the document, what was edited. Undefined for a file with none of the jobs at the size.
 */
export function jobsOf(file, key) {
  const values = new Map();
  const edits = new Map();
  for (const { name, value, extra } of file.results ?? []) {
    values.set(name, value);
    if (EDIT_ROW.test(name ?? "") && typeof extra === "string")
      edits.set(name, extra.split(" | ").at(-1));
  }
  const at = (scenario, measure) => values.get(`${scenario}-${key}/${measure}`);
  const first = at("fresh-first-screen", "import");
  const reopened = at("reopen-first-answer", "total");
  const lines = [];
  const line = (scenario, text) => lines.push({ id: scenario, text });
  const wrote = (scenario) => {
    const files = at(scenario, "count/files-written");
    const statements = at(scenario, "count/statements-added");
    const versions = at(scenario, "count/versions-added") ?? 0;
    const revisions = at(scenario, "count/revisions-added") ?? 0;
    const records = at(scenario, "count/records-added") ?? 0;
    const converts = at(scenario, "count/converts");
    const kinds = [
      ...(versions > 0 ? [plural(versions, "new version")] : []),
      ...(revisions > 0 ? [plural(revisions, "new revision")] : []),
      ...(records > 0 ? [plural(records, "new pod record")] : []),
    ];
    return {
      wrote:
        files === undefined
          ? ""
          : ` and wrote ${plural(files, "file")}${
              statements === undefined || files === 0
                ? ""
                : ` holding ${plural(statements, "statement")}${
                    kinds.length === 0 ? "" : ` (${kinds.join(", ")})`
                  }`
            }`,
      converted:
        converts === undefined
          ? ""
          : `; the document was ${
              converts === 0
                ? "not converted again"
                : converts === 1
                  ? "converted once"
                  : `converted ${converts} times`
            }`,
    };
  };
  const identical = at("reimport-identical", "import");
  if (identical !== undefined) {
    const { wrote: made, converted } = wrote("reimport-identical");
    line(
      "reimport-identical",
      `Importing the same file again took ${took(identical)}${against(identical, first, "the first import")}${made}${converted}.`,
    );
  }
  const changed = at("reimport-changed", "import");
  if (changed !== undefined) {
    const { wrote: made, converted } = wrote("reimport-changed");
    const count = at("reimport-changed", "count/entries-changed");
    line(
      "reimport-changed",
      `Importing the same file with ${count === undefined ? "some source entries changed" : entries(count, "changed")} took ${took(changed)}${against(changed, first, "the first import")}${made}${converted}.`,
    );
  }
  const added = at("add-one-record", "import");
  if (added !== undefined) {
    const { wrote: made, converted } = wrote("add-one-record");
    const count = at("add-one-record", "count/entries-added") ?? 1;
    line(
      "add-one-record",
      `Importing the same file with ${entries(count, "added")} took ${took(added)}${against(added, first, "the first import")}${made}${converted}.`,
    );
  }
  const killed = at("reopen-after-kill", "total");
  if (killed !== undefined) {
    const files = at("reopen-after-kill", "count/files-read");
    const statements = at("reopen-after-kill", "count/statements-read");
    const found = at("reopen-after-kill", "count/database-found");
    line(
      "reopen-after-kill",
      `Opening a pod whose process stopped before it closed, and asking its first question, took ${took(killed)}${against(killed, reopened, "the same after a proper close")}${
        files === undefined
          ? ""
          : ` and read ${plural(files, "file")}${statements === undefined ? "" : ` holding ${plural(statements, "statement")}`}`
      }${found === 0 ? "; it held no database, so it was built whole" : ""}.`,
    );
  }
  const updated = at("question-after-update", "total");
  if (updated !== undefined)
    line(
      "question-after-update",
      `Opening a pod after an update, and asking its first question, took ${took(updated)}${against(updated, reopened, "the same right after the first import")}.`,
    );
  if (lines.length === 0) return undefined;
  const [, dataset = "", sealed] = /^(.+?)(-encrypted)?$/.exec(key) ?? [];
  return {
    key,
    dataset,
    encrypted: sealed !== undefined,
    entries: at("fresh-first-screen", "count/records"),
    lines,
    edits: [...edits.entries()]
      .filter(([, text]) => typeof text === "string" && text !== "")
      .map(([, text]) => text)
      .filter((text, place, all) => all.indexOf(text) === place),
  };
}

/** The size a page's pod was measured at, as a person reads it: "647 source entries", "16,833 source entries, measured nightly". */
export const jobsTitle = (page) => storedTitle(page);

const escaped = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/**
 * What a build's jobs were, for a page: one list item for each job, what was edited in the documents, and what the section is
 * about. `heading` is the HTML of the heading the block opens with, which the caller has made safe.
 */
export function jobsHtml(page, { heading = "" } = {}) {
  return `${heading}
<ul class="jobs">
${page.lines.map(({ text }) => `<li>${escaped(text)}</li>`).join("\n")}
</ul>
${page.edits.map((text) => `<p class="note">What was edited: ${escaped(text)}</p>`).join("\n")}
<p class="note">${escaped(JOBS_ABOUT)}</p>`;
}
