#!/usr/bin/env node
// Reads the runtime's performance files (packages/cascade-runtime/test/perf-report.ts), which are rows in the Bridge spec's
// result format, and reports on them. It states what changed and by how much; it has no threshold and never fails on a
// slowdown.
//
//   perf-compare.mjs compare <before.json> <after.json> [--markdown] [--stages 15]
//   perf-compare.mjs summary <file.json> [--markdown] [--stages 10] [--without-own-time]
//   perf-compare.mjs against <pull.json> [--same-job <main.json>] [--latest <file.json> --latest-name <name>] [--markdown]
//                    [--without-own-time] [--subject <what the file is called>] [--bridge-how <how its Bridge was picked>]
//                    [--summary-shown]
//     What a pull request's comment says: its file against main's taken in the same job, else against the latest push to
//     main's; a main file that is missing or unreadable is said and falls back, and the exit status stays 0. With no file of
//     main's at all, the pull request's own summary follows, unless --summary-shown says it is on the page already.
//   perf-compare.mjs history --name <glob> [--since 7d] [--dir <folder of files>]
//
// A name's glob uses `*` for any run of characters, `/` included. History reads every `*.json` under the folder (the
// `perf-data` branch's `runtime/YYYY/MM/DD/<run>-<sha7>-<event>.json`), oldest first.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { jobsKeys, jobsOf, jobsTitle } from "./perf-jobs.mjs";
import {
  CLASS_HEAD,
  KIND_HEAD,
  classCells,
  kindCells,
  storedKeys,
  storedLine,
  storedNotes,
  storedRowName,
  storedOf,
  storedTitle,
  STORED_ROW,
} from "./perf-stored.mjs";

/**
 * What a row is, from its name: a count of what a pod holds (the `stored` scenario's rows), a stage of the probed run (its
 * total included), a step's own time in it, a count, or a headline time or size.
 */
export function kindOf(name) {
  if (STORED_ROW.test(name)) return "stored";
  if (/\/self\//.test(name)) return "self";
  if (/\/stage\//.test(name) || /\/probed-total$/.test(name)) return "stage";
  if (/\/count\//.test(name)) return "count";
  return "headline";
}

/**
 * A value as a person reads it: seconds with a unit that fits, bytes as MiB (in tenths under ten of them) or, for an
 * exact count of bytes, in whole bytes, counts with thousands separators.
 */
export function shown(value, unit, exact = false) {
  if (value === undefined) return "";
  if (unit === "By" && exact) return `${value.toLocaleString("en-US")} By`;
  if (unit === "By")
    return `${(value / 1048576).toFixed(value < 10 * 1048576 ? 1 : 0)} MiB`;
  if (unit === "{count}") return value.toLocaleString("en-US");
  if (value >= 100) return `${value.toFixed(0)} s`;
  if (value >= 10) return `${value.toFixed(1)} s`;
  if (value >= 1) return `${value.toFixed(2)} s`;
  if (value < 0.001) return `${(value * 1_000_000).toFixed(0)} us`;
  return `${(value * 1000).toFixed(value >= 0.1 ? 0 : 1)} ms`;
}

/** The change from `before` to `after` as `-73% (3.7x faster)`, `+12% (1.1x slower)`, or `same`. */
export function change(before, after) {
  if (before === after) return "same";
  if (before === 0 || after === 0)
    return before === 0 ? "new (was 0)" : "now 0";
  const pct = ((after - before) / before) * 100;
  const times = after < before ? before / after : after / before;
  const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
  const shownPct =
    Math.abs(pct) >= 10 ? Math.abs(pct).toFixed(0) : Math.abs(pct).toFixed(1);
  return `${sign}${shownPct}% (${times.toFixed(times >= 10 ? 0 : 1)}x ${after < before ? "faster" : "slower"})`;
}

/** The same figure for a count, where more is not slower: `+12% (1.1x)`. */
export function countChange(before, after) {
  if (before === after) return "same";
  if (before === 0) return "new (was 0)";
  const pct = ((after - before) / before) * 100;
  return `${pct > 0 ? "+" : "-"}${Math.abs(pct).toFixed(Math.abs(pct) >= 10 ? 0 : 1)}% (${(after > before ? after / before : before / after).toFixed(1)}x)`;
}

export function read(path) {
  const file = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(file.results)) throw new Error(`${path} holds no results`);
  return file;
}

const byName = (file) => new Map(file.results.map((row) => [row.name, row]));

/**
 * The sentence about two files' environments, empty when they match: a comparison across machines says so. Machines are
 * told apart by operating system, processor count and processor model: the kernel's release, the job's name and the
 * node patch version differ between runs on one kind of machine and say nothing about the time.
 */
export function environmentNote(before, after) {
  const system = (file) => (file.env?.os ?? "").split(" ")[0];
  const model = (file) => (file.env?.runner ?? "").split(";")[1]?.trim();
  const major = (file) => (file.env?.node ?? "").split(".")[0];
  const differs = [
    ...(system(before) !== system(after) ? ["os"] : []),
    ...(before.env?.cpus !== after.env?.cpus ? ["cpus"] : []),
    ...(model(before) !== model(after) ? ["cpu model"] : []),
    ...(major(before) !== major(after) ? ["node"] : []),
  ];
  return differs.length === 0
    ? ""
    : `The two files were taken on different ${differs.join(", ")}; times do not compare across them.`;
}

/** The processor model a file's runner names (`github-actions Linux; <model>; other load: ...`), undefined where it names none. */
export function cpuModelOf(file) {
  const model = (file.env?.runner ?? "").split(";")[1]?.trim();
  return model === undefined ||
    model === "" ||
    model.startsWith("other load:") ||
    model === "unknown cpu"
    ? undefined
    : model;
}

/**
 * What is said of the machines of two files taken one after the other in one job. Both runs are on one hosted runner and so
 * on one processor model; that is checked from what each file records and said in words, and never fails the job: a
 * different model, or none recorded, is a sentence that the totals are not comparable. Within one job the different-models
 * sentence cannot fire (one VM); it is a guard for the two files of a hand-made comparison, which may come from two jobs.
 */
export function machinesLine(main, pull, subject = "this pull request") {
  const one = cpuModelOf(main);
  const other = cpuModelOf(pull);
  const measured = `Main and ${subject} were measured one after the other in the same job`;
  if (one === undefined || other === undefined)
    return `${measured}. A file records no CPU model, so whether the two runs landed on the same CPU is not known; totals may not be comparable.`;
  if (one !== other)
    return `${measured}. The two runs landed on different CPUs; totals are not comparable. Main ran on ${one}; ${subject} on ${other}.`;
  const others = environmentNote(main, pull);
  return `${measured}, on the same runner, both on ${one}.${others === "" ? "" : ` ${others}`}`;
}

const short = (sha) => (sha ?? "").slice(0, 7);

/** Whether the two files read different Bridge builds; false where either records none. */
export function bridgesDiffer(main, pull) {
  const one = main.commit?.bridge;
  const other = pull.commit?.bridge;
  return one !== undefined && other !== undefined && one !== other;
}

/**
 * Which Bridge each side read. Main's run reads the build of the Bridge that this build's own run picked, when that pick was
 * the newest build of the default branch (so a publish between the two reads cannot make them differ); when something
 * names another (the head of the pull request a `Depends-On:` line names, or a branch of the run's name), main reads the
 * newest build of the default branch, and `how` is how the build's own run says it picked.
 */
export function bridgeLine(main, pull, subject = "this pull request", how) {
  const one = main.commit?.bridge;
  const other = pull.commit?.bridge;
  if (one === undefined || other === undefined)
    return "The Bridge build is not recorded in one of the files.";
  if (one === other) return `Both runs read the Bridge build ${short(one)}.`;
  const reason =
    how === undefined || how === ""
      ? "the file does not record why"
      : `${subject} picked its Bridge as ${how}`;
  return `The two runs read different Bridge builds: main's run read ${short(one)} (the newest build of its default branch, as a push to main reads it); ${subject}'s read ${short(other)} (${reason}). The change below includes the Bridge's.`;
}

/** The components other than the runtime and the Bridge that the two files read at different commits, one line each. */
export function otherComponents(main, pull, subject = "this pull request") {
  const names = new Set([
    ...Object.keys(main.commit ?? {}),
    ...Object.keys(pull.commit ?? {}),
  ]);
  return [...names]
    .filter((name) => name !== "runtime" && name !== "bridge")
    .filter((name) => main.commit?.[name] !== pull.commit?.[name])
    .map(
      (name) =>
        `${name}: main ${short(main.commit?.[name]) || "none"}, ${subject} ${short(pull.commit?.[name]) || "none"}`,
    );
}

/** The dataset and its digest a row names in its `extra`, which a comparison of different data is told of. */
function digestOf(row) {
  return /sha256=([0-9a-f]{64})/.exec(row?.extra ?? "")?.[1];
}

/** Rows grouped by the scenario-and-size part of their names, in the order they come. */
function grouped(rows) {
  const groups = new Map();
  for (const row of rows) {
    const [group] = row.name.split("/");
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }
  return groups;
}

/** A table whose columns are numbers, right-aligned, except the first and those in `text`. */
function table(header, lines, markdown, text = []) {
  const left = (at) => at === 0 || text.includes(at);
  if (markdown)
    return [
      `| ${header.join(" | ")} |`,
      `|${header.map((_, at) => (left(at) ? "---" : "---:")).join("|")}|`,
      ...lines.map((line) => `| ${line.join(" | ")} |`),
    ].join("\n");
  const widths = header.map((cell, at) =>
    Math.max(cell.length, ...lines.map((line) => String(line[at]).length)),
  );
  const pad = (line) =>
    line
      .map((cell, at) =>
        left(at)
          ? String(cell).padEnd(widths[at])
          : String(cell).padStart(widths[at]),
      )
      .join("  ");
  return [pad(header), ...lines.map(pad)].join("\n");
}

/** The sentence a row's `extra` begins with, which says what the step is in plain words; a table cell. */
export function says(row) {
  return (row?.extra ?? "").split(" | ")[0].replaceAll("|", "/");
}

/**
 * The rows beyond the headline times and own times that a page needs to read an import against the plain load of the same
 * input and to say what the import handled: the import's parts and exact counts, and the loading stages.
 */
export const SPEED_ROW =
  /^(?:fresh-first-screen-.+\/(?:import|phase-saving|phase-converting|phase-judging|count\/(?:records|built\.lines\.total|files-written|store\.queries|graph\.quadsvisited))|floor-[^/]+\/(?:total|parse|flatten|insert|count\/rows))$/;

/** The key of a fresh import's rows (`fresh-first-screen-<size>[-encrypted]`). */
const FRESH = /^(fresh-first-screen-.+?)\/import$/;

/** The key of every fresh import a file measured, in the order its rows come. */
export function freshKeys(file) {
  return [
    ...new Set(
      (file.results ?? []).flatMap(({ name }) => FRESH.exec(name)?.[1] ?? []),
    ),
  ];
}

/**
 * What a file says of one fresh import (`key`): its time, the plain load of the same input beside it, what it handled, and
 * the rate of the phase that writes what is counted. A rate is the run's whole count over the phase's time. Undefined for a
 * file with no such import.
 */
export function speedOf(file, key) {
  const values = new Map(
    (file.results ?? []).map(({ name, value }) => [name, value]),
  );
  const imported = values.get(`${key}/import`);
  if (imported === undefined) return undefined;
  const size = /^fresh-first-screen-(.+?)(?:-encrypted)?$/.exec(key)?.[1];
  const floorKey = `floor-${size}`;
  const total = values.get(`${floorKey}/total`);
  const floor =
    total === undefined
      ? undefined
      : {
          total,
          parse: values.get(`${floorKey}/parse`),
          flatten: values.get(`${floorKey}/flatten`),
          insert: values.get(`${floorKey}/insert`),
          rows: values.get(`${floorKey}/count/rows`),
        };
  const counted = (name) => values.get(`${key}/count/${name}`);
  const phase = (name) => values.get(`${key}/phase-${name}`);
  const rate = (count, seconds) =>
    count === undefined || seconds === undefined || seconds <= 0
      ? undefined
      : count / seconds;
  const lines = counted("built.lines.total");
  const files = counted("files-written");
  return {
    key,
    imported,
    floor,
    times: total === undefined || total <= 0 ? undefined : imported / total,
    records: counted("records"),
    lines,
    files,
    queries: counted("store.queries"),
    facts: counted("graph.quadsvisited"),
    phases: { saving: phase("saving") },
    rates: {
      saving: {
        lines: rate(lines, phase("saving")),
        files: rate(files, phase("saving")),
      },
    },
  };
}

/** "Import takes 42.3 s; a plain load of the same input into SQLite takes 2.10 s (20x).", or undefined where the file has no floor. */
export function floorLine(speed) {
  if (speed?.floor === undefined || speed.times === undefined) return undefined;
  const times = speed.times;
  return `Import takes ${shown(speed.imported, "s")}; a plain load of the same input into SQLite takes ${shown(speed.floor.total, "s")} (${times.toFixed(times >= 10 ? 0 : 1)}x).`;
}

/** What the plain load does and does not do, in the words every page puts under the line. */
export const FLOOR_NOTE =
  "The plain load reads and parses the same input, flattens each resource to one row of a table of its type (anything nested kept as JSON text, no further tables) and inserts the rows into SQLite in one transaction, with SQLite's default settings. Only the insert is SQL; the parsing and flattening are JavaScript. It maps nothing to the Cascade vocabulary, keeps no provenance, does no matching, builds no derived views and writes no files. It is not a lower bound: a faster load could exist. The encrypted import is compared with the same unencrypted load. What the import does beyond loading is not split here further than the stages the flame graphs measure.";

/** How to read the table of what an import handled. */
export const THROUGHPUT_NOTE =
  "Counts are exact and come from the probed run of the same import; answer-file lines are the lines the import built for the pod's files, counted each time a file is built: more than the statements the files hold, because some files are built more than once (at 647 source entries, 21,631 lines against 19,636 statements). A rate is the run's whole count divided by the time of the phase that writes it, from the unprobed runs. It is shown only for saving, the phase that writes the files and their lines.";

export const THROUGHPUT_HEAD = [
  "Source entries",
  "Answer-file lines",
  "Files written",
  "Questions put to the fact store",
  "Individual facts looked at",
  "Saving: answer-file lines/s",
  "Saving: files/s",
];

/** The cells under `THROUGHPUT_HEAD` for one import: whole numbers with thousands separators, `-` where the file has none. */
export function throughputCells(speed) {
  const count = (value) =>
    value === undefined ? "-" : Math.round(value).toLocaleString("en-US");
  return [
    speed.records,
    speed.lines,
    speed.files,
    speed.queries,
    speed.facts,
    speed.rates.saving.lines,
    speed.rates.saving.files,
  ].map(count);
}

const escaped = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/** A table of imports for a page: a row for each of `rows`, whose `label` is HTML the caller has made safe. */
export function throughputTable(rows, first = "Build") {
  const cells = (speed) =>
    throughputCells(speed)
      .map((cell) => `<td class="n">${cell}</td>`)
      .join("");
  return `<table class="speed">
<thead><tr><th>${escaped(first)}</th>${THROUGHPUT_HEAD.map((cell) => `<th class="n">${escaped(cell)}</th>`).join("")}</tr></thead>
<tbody>
${rows.map(({ label, speed }) => `<tr><td>${label}</td>${cells(speed)}</tr>`).join("\n")}
</tbody>
</table>`;
}

/**
 * The lines of a report that read each fresh import of a file against the plain load of its input, and say what it
 * handled and how fast each phase went; none for a file with no import.
 */
export function speedSection(file, { markdown = false } = {}) {
  const speeds = freshKeys(file).flatMap((key) => speedOf(file, key) ?? []);
  if (speeds.length === 0) return [];
  const quote = (text) => (markdown ? `> ${text}` : text);
  const out = [
    markdown
      ? "**The import beside a plain load of the same input into SQLite**"
      : "THE IMPORT BESIDE A PLAIN LOAD OF THE SAME INPUT INTO SQLITE",
    "",
  ];
  const lines = speeds.flatMap((speed) => {
    const line = floorLine(speed);
    return line === undefined
      ? []
      : [`${markdown ? "- " : ""}${speed.key}: ${line}`];
  });
  if (lines.length > 0) out.push(...lines, "", quote(FLOOR_NOTE), "");
  out.push(
    table(
      ["", ...THROUGHPUT_HEAD],
      speeds.map((speed) => [speed.key, ...throughputCells(speed)]),
      markdown,
    ),
    "",
    quote(THROUGHPUT_NOTE),
    "",
  );
  return out;
}

/**
 * What a file says of the jobs of every day after the first import, one line for each job it measured, read against the same
 * file's first import and reopen. None for a file with none of them. Where the file measured two sizes, each size's lines come
 * under its own title.
 */
export function jobsSection(file, { markdown = false } = {}) {
  const pages = jobsKeys(file).flatMap((key) => jobsOf(file, key) ?? []);
  if (pages.length === 0) return [];
  const out = [
    markdown
      ? "**What people do after the first import**"
      : "WHAT PEOPLE DO AFTER THE FIRST IMPORT",
    "",
  ];
  for (const page of pages) {
    if (pages.length > 1)
      out.push(markdown ? `*${jobsTitle(page)}*` : `${jobsTitle(page)}:`, "");
    for (const { text } of page.lines) out.push(markdown ? `- ${text}` : text);
    out.push("");
    for (const edit of page.edits)
      out.push(
        markdown ? `> What was edited: ${edit}` : `What was edited: ${edit}`,
        "",
      );
  }
  return out;
}

/**
 * What a file says of what each pod it counted holds: for each, the line of what a fresh import left, the classes of what is
 * held and, folded away in a markdown report, each kind. None for a file with no such rows.
 */
export function storedSection(file, { markdown = false } = {}) {
  const pages = storedKeys(file).flatMap((key) => storedOf(file, key) ?? []);
  if (pages.length === 0) return [];
  const out = [markdown ? "**What a pod holds**" : "WHAT A POD HOLDS", ""];
  for (const page of pages) {
    out.push(
      markdown
        ? `- ${storedTitle(page)}: ${storedLine(page)}`
        : `${storedTitle(page)}: ${storedLine(page)}`,
      "",
      table(CLASS_HEAD, classCells(page), markdown),
      "",
    );
    const kinds = table(KIND_HEAD, kindCells(page), markdown, [1]);
    out.push(
      ...(markdown
        ? [
            "<details><summary>Each kind of file</summary>",
            "",
            kinds,
            "",
            "</details>",
          ]
        : [kinds]),
      "",
      ...storedNotes(page).flatMap((note) => [
        markdown ? `> ${note}` : note,
        "",
      ]),
    );
  }
  return out;
}

/**
 * What changed in the counts of what a pod holds between two files, a row to a line, in the files' own order; a sentence where
 * the earlier file has no counts of the pod to compare with, and where none changed.
 */
function storedChanges(before, after, { markdown, was$, now$ }) {
  const rowsOf = (file) =>
    new Map(
      (file.results ?? [])
        .filter(({ name }) => STORED_ROW.test(name))
        .map((row) => [row.name, row]),
    );
  const was = rowsOf(before);
  const now = rowsOf(after);
  if (now.size === 0) return [];
  const quote = (text) => (markdown ? `> ${text}` : text);
  const bare = storedKeys(after).filter(
    (key) => ![...was.keys()].some((name) => name.startsWith(`${key}/`)),
  );
  const out = [];
  if (bare.length > 0)
    out.push(
      quote(
        `${was$}'s file holds no counts of what a pod holds (${bare.join(", ")}), so they are new here.`,
      ),
      "",
    );
  const entries = (key) =>
    now.get(`${key}/count/entries`)?.value ??
    was.get(`${key}/count/entries`)?.value;
  const sized = (value, unit) =>
    unit === "By"
      ? `${(value / 1048576).toFixed(2)} MiB`
      : shown(value, unit, true);
  const changed = [...now.values()].flatMap((row) => {
    const key = row.name.slice(0, row.name.indexOf("/"));
    const from = was.get(row.name);
    return bare.includes(key) || from?.value === row.value
      ? []
      : [
          [
            storedRowName(row.name, entries(key)),
            from === undefined ? "" : sized(from.value, row.unit),
            sized(row.value, row.unit),
            from === undefined ? "new" : countChange(from.value, row.value),
          ],
        ];
  });
  const compared = storedKeys(after).length - bare.length;
  if (changed.length > 0)
    out.push(
      markdown
        ? `**What a pod holds, that changed: ${was$} -> ${now$}**`
        : `WHAT A POD HOLDS, THAT CHANGED: ${was$} -> ${now$}`,
      "",
      table(["", was$, now$, "change"], changed, markdown),
      "",
    );
  else if (compared > 0)
    out.push(
      quote(
        `No count of what a pod holds changed between ${was$} and ${now$}.`,
      ),
      "",
    );
  return out;
}

/**
 * In words, for each scenario and size, what main took and what this pull request took: the total of each, with the change.
 * `was` and `now` are the rows of the two files by name.
 */
function sameJobSentences(was, now, { markdown, subject }) {
  return [...now.keys()]
    .filter((name) => /\/total$/.test(name) && was.has(name))
    .map((name) => {
      const [group] = name.split("/");
      const from = was.get(name);
      const to = now.get(name);
      return `${markdown ? "- " : ""}${group}: main ${shown(from.value, from.unit)}, ${subject} ${shown(to.value, to.unit)}: ${change(from.value, to.value)}`;
    });
}

/**
 * The report of two files: headline rows, then the counts that changed, then the stages that changed most. With `sameJob`,
 * the files are main's and a pull request's, taken one after the other in one job, and every heading says so.
 */
export function compare(
  before,
  after,
  {
    markdown = false,
    stages = 15,
    sameJob = false,
    subject = "this pull request",
    bridgeDiffers = false,
  } = {},
) {
  const [was$, now$] = sameJob ? ["main", subject] : ["before", "after"];
  // A scenario and size the after file did not run (the nightly's large one, against a pull request's) is not a row gone.
  const ran = new Set(after.results.map(({ name }) => name.split("/")[0]));
  const left = before.results.filter(
    ({ name }) => !ran.has(name.split("/")[0]),
  );
  const was = byName({
    results: before.results.filter(({ name }) => ran.has(name.split("/")[0])),
  });
  const now = byName(after);
  const out = [];
  const note = sameJob ? "" : environmentNote(before, after);
  if (note) out.push(markdown ? `> ${note}` : note, "");
  if (left.length > 0) {
    const sizes = [...new Set(left.map(({ name }) => name.split("/")[0]))];
    out.push(
      `${markdown ? "> " : ""}Not compared, because the after file did not run them: ${sizes.join(", ")}.`,
      "",
    );
  }
  out.push(...speedSection(after, { markdown }));
  out.push(...jobsSection(after, { markdown }));
  out.push(...storedSection(after, { markdown }));
  out.push(...storedChanges(before, after, { markdown, was$, now$ }));
  const head = (title) =>
    out.push(markdown ? `**${title}**` : title.toUpperCase(), "");
  const rowsOf = (kind) => {
    const names = [...new Set([...was.keys(), ...now.keys()])].filter(
      (name) => kindOf(name) === kind,
    );
    return names.map((name) => ({
      name,
      from: was.get(name),
      to: now.get(name),
    }));
  };
  const line = ({ name, from, to }, label = name) => {
    const unit = (to ?? from).unit;
    const counting = unit === "{count}" || kindOf(name) === "count";
    const verdict =
      from === undefined
        ? "new"
        : to === undefined
          ? "gone"
          : counting
            ? countChange(from.value, to.value)
            : change(from.value, to.value);
    return [
      label,
      shown(from?.value, unit, counting),
      shown(to?.value, unit, counting),
      verdict,
    ];
  };
  /** A line with the plain sentence of the step after its change. */
  const said = (pair) => [...line(pair), says(pair.to ?? pair.from)];
  const headline = rowsOf("headline").filter(
    ({ from, to }) =>
      (to ?? from).unit !== "{count}" || from?.value !== to?.value,
  );
  const mismatched = [
    ...grouped(headline.map(({ name }) => ({ name }))),
  ].flatMap(([group]) => {
    const a = digestOf(was.get(`${group}/total`));
    const b = digestOf(now.get(`${group}/total`));
    return a !== undefined && b !== undefined && a !== b ? [group] : [];
  });
  if (mismatched.length > 0)
    out.push(
      `${markdown ? "> " : ""}The data differs between the files for: ${mismatched.join(", ")}.`,
      "",
    );
  const main = (name) =>
    /\/(total|open|import|first-screen|first-read|second-read|close|rss|peak-rss)$/.test(
      name,
    );
  const lines = (pairs) => pairs.map((pair) => line(pair));
  head(
    `Headline: unprobed runs, median of the samples, ${was$} -> ${now$}${sameJob ? ", measured in the same job" : ""}`,
  );
  if (sameJob) {
    if (bridgeDiffers)
      out.push(
        `${markdown ? "> " : ""}The two sides read different Bridge builds, so the change below includes the Bridge's.`,
        "",
      );
    const said = sameJobSentences(was, now, { markdown, subject });
    if (said.length > 0) out.push(...said, "");
  }
  out.push(
    table(
      ["", was$, now$, "change"],
      lines(headline.filter(({ name }) => main(name))),
      markdown,
    ),
    "",
  );
  const rest = headline.filter(({ name }) => !main(name));
  if (rest.length > 0) {
    const detail = table(["", was$, now$, "change"], lines(rest), markdown);
    out.push(
      ...(markdown
        ? [
            "<details><summary>The import's parts and each question's page</summary>",
            "",
            detail,
            "",
            "</details>",
          ]
        : [detail]),
      "",
    );
  }
  const counts = rowsOf("count")
    .filter(({ from, to }) => from?.value !== to?.value)
    .sort(
      (a, b) =>
        Math.abs((b.to?.value ?? 0) - (b.from?.value ?? 0)) -
        Math.abs((a.to?.value ?? 0) - (a.from?.value ?? 0)),
    )
    .slice(0, stages);
  if (counts.length > 0) {
    head(
      `Exact counts that changed (probed run; the ${counts.length} largest differences)`,
    );
    out.push(
      table(
        ["", was$, now$, "change"],
        counts.map((pair) => line(pair)),
        markdown,
      ),
      "",
    );
  } else out.push("No exact count changed.", "");
  const moved = rowsOf("stage")
    .filter(({ from, to }) => from !== undefined && to !== undefined)
    .sort(
      (a, b) =>
        Math.abs(b.to.value - b.from.value) -
        Math.abs(a.to.value - a.from.value),
    )
    .slice(0, stages);
  if (moved.length > 0) {
    head(
      `Stages that moved most (one probed run each, so one sample, and slower than the same work unprobed; a stage's time is the time some call of it was in progress)`,
    );
    out.push(
      table(
        ["", was$, now$, "change", "what it is"],
        moved.map((pair) => said(pair)),
        markdown,
        [4],
      ),
      "",
    );
  }
  const movedOwn = rowsOf("self")
    .filter(({ from, to }) => from !== undefined && to !== undefined)
    .sort(
      (a, b) =>
        Math.abs(b.to.value - b.from.value) -
        Math.abs(a.to.value - a.from.value),
    )
    .slice(0, stages);
  if (movedOwn.length > 0) {
    head(
      `Steps whose own time moved most (one probed run each; own time is the time some call of the step was in progress with none of the steps inside it in progress, so it points at the step to change)`,
    );
    out.push(
      table(
        ["", was$, now$, "change", "what it is"],
        movedOwn.map((pair) => said(pair)),
        markdown,
        [4],
      ),
      "",
    );
  }
  const commits = (file) =>
    Object.entries(file.commit ?? {})
      .map(([name, sha]) => `${name} ${sha.slice(0, 7)}`)
      .join(", ");
  out.push(`${was$}: ${commits(before)}`, `${now$}: ${commits(after)}`);
  return out.join("\n");
}

/**
 * One file as text: the headline rows, then each scenario's slowest stages and, unless `own` is false (a caller that lists
 * the steps with the longest own time itself, with their links), the steps with the longest own time.
 */
export function summary(
  file,
  { markdown = false, stages = 10, own = true } = {},
) {
  const out = [];
  const headline = file.results.filter(
    (row) => kindOf(row.name) === "headline",
  );
  out.push(
    markdown
      ? "**Headline: unprobed runs, median (range) of the samples**"
      : "HEADLINE: unprobed runs, median (range)",
    "",
  );
  out.push(
    table(
      ["", "value", "range", "samples"],
      headline.map((row) => {
        const [low, high] = (row.range ?? "").split("-").map(Number);
        return [
          row.name,
          shown(row.value, row.unit),
          row.range === undefined
            ? ""
            : `${shown(low, row.unit)} - ${shown(high, row.unit)}`,
          row.samples ?? "",
        ];
      }),
      markdown,
    ),
    "",
  );
  out.push(...speedSection(file, { markdown }));
  out.push(...jobsSection(file, { markdown }));
  out.push(...storedSection(file, { markdown }));
  for (const [group, rows] of grouped(
    file.results.filter((row) => kindOf(row.name) === "stage"),
  )) {
    const top = rows
      .filter((row) => !/\/stage\/scenario\./.test(row.name))
      .sort((a, b) => b.value - a.value)
      .slice(0, stages + 1);
    out.push(
      markdown
        ? `**${group}: slowest stages (one probed run)**`
        : `${group}: slowest stages (one probed run)`,
      "",
    );
    out.push(
      table(
        ["stage", "time", "what it is"],
        top.map((row) => [
          row.name.split("/stage/")[1] ?? "(probed total of the run's steps)",
          shown(row.value, row.unit),
          says(row),
        ]),
        markdown,
        [2],
      ),
      "",
    );
  }
  for (const [group, rows] of grouped(
    own ? file.results.filter((row) => kindOf(row.name) === "self") : [],
  )) {
    const top = rows
      .filter((row) => !/\/self\/scenario\./.test(row.name))
      .sort((a, b) => b.value - a.value)
      .slice(0, stages);
    out.push(
      markdown
        ? `**${group}: longest own time (one probed run)**`
        : `${group}: longest own time (one probed run)`,
      "",
      table(
        ["step", "own time", "what it is"],
        top.map((row) => [
          row.name.split("/self/")[1],
          shown(row.value, row.unit),
          says(row),
        ]),
        markdown,
        [2],
      ),
      "",
    );
  }
  out.push(
    `commit: ${Object.entries(file.commit ?? {})
      .map(([name, sha]) => `${name} ${sha.slice(0, 7)}`)
      .join(", ")}`,
    `env: ${file.env?.runner ?? ""}; node ${file.env?.node}; ${file.env?.cpus} cpus`,
  );
  return out.join("\n");
}

/**
 * What a pull request's performance comment says about the comparison, as the files allow. `sameJob` is main's file taken in
 * the same job as `pull` (the comparison that is made when there is one); `null` is the job having tried and having none, which
 * is said, and the comparison is then with `latest`, the latest push to main's file (named `latestName`), taken on another run;
 * `undefined` is a run that does not measure main in its own job. With neither file there is only `pull`'s own report, unless
 * `summaryShown` says the caller has put it elsewhere already. `subject` is what `pull` is called (`this pull request`, or
 * `this build` in a run that has no pull request); `bridgeHow` is how the build's own run says it picked its Bridge.
 */
export function comparison(
  pull,
  {
    sameJob,
    latest,
    latestName = "",
    markdown = false,
    own = true,
    subject = "this pull request",
    bridgeHow,
    summaryShown = false,
  } = {},
) {
  const quote = (text) => (markdown ? `> ${text}` : text);
  const out = [];
  if (sameJob) {
    out.push(
      quote(machinesLine(sameJob, pull, subject)),
      "",
      quote(bridgeLine(sameJob, pull, subject, bridgeHow)),
      "",
    );
    const others = otherComponents(sameJob, pull, subject);
    out.push(
      quote(
        `Main's run read each repository it needs (the vocabulary, the adapters, the reference tables, the starter kit, the Bridge) as a push to main does, at its default branch; ${subject}'s read the ones its own run picks, which a Depends-On line can change.${others.length > 0 ? ` They differ in: ${others.join("; ")}.` : " They are the same commits."}`,
      ),
      "",
    );
    out.push(
      "Unprobed medians; no threshold, nothing here fails the run.",
      "",
      compare(sameJob, pull, {
        markdown,
        sameJob: true,
        subject,
        bridgeDiffers: bridgesDiffer(sameJob, pull),
      }),
    );
    return out.join("\n");
  }
  if (latest === undefined) {
    out.push(
      sameJob === null
        ? "Main's own run in this job gave no file (its step in the job's log says why), and there is no other file of main's to compare with."
        : "main has no performance file yet, so there is nothing to compare with.",
    );
    if (!summaryShown)
      out.push(
        "",
        `${subject[0].toUpperCase()}${subject.slice(1)}'s:`,
        "",
        summary(pull, { markdown, own }),
      );
    return out.join("\n");
  }
  if (sameJob === null)
    out.push(
      `Main's own run in this job did not give a file (its step in the job's log says why), so main is not measured beside ${subject}.`,
      "",
    );
  const elsewhere =
    sameJob === null
      ? ", which was taken on another run, perhaps on another machine; the same commits took 23% longer on one run than on another when the runners had different processors"
      : "";
  out.push(
    `Against \`${latestName}\`, the latest push to main's file${elsewhere}. Unprobed medians; no threshold, nothing here fails the run.`,
    "",
    compare(latest, pull, { markdown, subject }),
  );
  return out.join("\n");
}

function filesUnder(folder) {
  const found = [];
  for (const entry of readdirSync(folder)) {
    const path = join(folder, entry);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else if (entry.endsWith(".json")) found.push(path);
  }
  return found.sort();
}

/** The rows named by the glob over the files in the folder, oldest first, one line each. */
export function history(folder, glob, since) {
  const pattern = new RegExp(
    `^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
  );
  const cutoff = since === undefined ? undefined : Date.now() - duration(since);
  const lines = [];
  for (const path of filesUnder(folder)) {
    const day = /(\d{4})\/(\d{2})\/(\d{2})\//.exec(
      relative(folder, path).replaceAll("\\", "/") + "/",
    );
    const when =
      day === null
        ? undefined
        : Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]) + 1);
    if (cutoff !== undefined && when !== undefined && when < cutoff) continue;
    let file;
    try {
      file = read(path);
    } catch {
      continue;
    }
    for (const row of file.results)
      if (pattern.test(row.name))
        lines.push([
          relative(folder, path)
            .replaceAll("\\", "/")
            .replace(/\.json$/, ""),
          row.name,
          shown(row.value, row.unit),
          row.range === undefined
            ? ""
            : `${row.range} (${row.samples} samples)`,
        ]);
  }
  return lines.length === 0
    ? "no rows match"
    : table(["file", "row", "value", "range"], lines, false);
}

function duration(text) {
  const match = /^(\d+)([dhw])$/.exec(text);
  if (match === null)
    throw new Error(
      `--since is a number of days, hours or weeks: 7d, 12h, 2w; not ${text}`,
    );
  return (
    Number(match[1]) * { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2]]
  );
}

/** Writes the text and a newline. */
function say(text) {
  process.stdout.write(`${text}
`);
}

function main(args) {
  const [command, ...rest] = args;
  const flag = (name) => {
    const at = rest.indexOf(name);
    return at === -1 ? undefined : rest[at + 1];
  };
  const valued = new Set([
    "--name",
    "--since",
    "--dir",
    "--stages",
    "--same-job",
    "--latest",
    "--latest-name",
    "--subject",
    "--bridge-how",
  ]);
  const positional = rest.filter(
    (arg, at) => !arg.startsWith("--") && !valued.has(rest[at - 1]),
  );
  const markdown = rest.includes("--markdown");
  const stages =
    flag("--stages") === undefined ? undefined : Number(flag("--stages"));
  const options = {
    markdown,
    ...(stages !== undefined && { stages }),
    ...(rest.includes("--without-own-time") && { own: false }),
  };
  if (command === "against" && positional.length === 1) {
    const usable = (path) => {
      try {
        return read(path);
      } catch {
        return undefined;
      }
    };
    const named = flag("--same-job");
    const sameJob = named === undefined ? undefined : (usable(named) ?? null);
    const kept = flag("--latest");
    const latest = kept === undefined ? undefined : usable(kept);
    return say(
      comparison(read(positional[0]), {
        ...options,
        ...(sameJob !== undefined && { sameJob }),
        ...(latest !== undefined && { latest }),
        latestName: flag("--latest-name") ?? "",
        ...(flag("--subject") !== undefined && { subject: flag("--subject") }),
        ...(flag("--bridge-how") !== undefined && {
          bridgeHow: flag("--bridge-how"),
        }),
        ...(rest.includes("--summary-shown") && { summaryShown: true }),
      }),
    );
  }
  if (command === "compare" && positional.length === 2)
    return say(compare(read(positional[0]), read(positional[1]), options));
  if (command === "summary" && positional.length === 1)
    return say(summary(read(positional[0]), options));
  if (command === "history" && flag("--name") !== undefined)
    return say(
      history(flag("--dir") ?? "perf-data", flag("--name"), flag("--since")),
    );
  process.stderr.write(
    "usage: perf-compare.mjs compare <before.json> <after.json> | against <pull.json> [--same-job f] [--latest f --latest-name n] | summary <file.json> | history --name <glob> [--since 7d] [--dir folder]\n",
  );
  process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
