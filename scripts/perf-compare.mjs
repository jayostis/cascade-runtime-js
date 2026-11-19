#!/usr/bin/env node
// Reads the runtime's performance files (packages/cascade-runtime/test/perf-report.ts), which are rows in the Bridge spec's
// result format, and reports on them. It states what changed and by how much; it has no threshold and never fails on a
// slowdown.
//
//   perf-compare.mjs compare <before.json> <after.json> [--markdown] [--stages 15]
//   perf-compare.mjs summary <file.json> [--markdown] [--stages 10]
//   perf-compare.mjs history --name <glob> [--since 7d] [--dir <folder of files>]
//
// A name's glob uses `*` for any run of characters, `/` included. History reads every `*.json` under the folder (the
// `perf-data` branch's `runtime/YYYY/MM/DD/<run>-<sha7>.json`), oldest first.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** What a row is, from its name: a stage of the probed run, a count, or a headline time or size. */
export function kindOf(name) {
  if (/\/stage\//.test(name)) return "stage";
  if (/\/count\//.test(name)) return "count";
  return "headline";
}

/** A value as a person reads it: seconds with a unit that fits, bytes as MB, counts with thousands separators. */
export function shown(value, unit) {
  if (value === undefined) return "";
  if (unit === "By") return `${(value / 1048576).toFixed(0)} MB`;
  if (unit === "{count}") return value.toLocaleString("en-US");
  if (value >= 100) return `${value.toFixed(0)} s`;
  if (value >= 10) return `${value.toFixed(1)} s`;
  if (value >= 1) return `${value.toFixed(2)} s`;
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

/** The sentence about two files' environments, empty when they match: a comparison across machines says so. */
export function environmentNote(before, after) {
  const differs = ["os", "cpus", "node"].filter(
    (key) => before.env?.[key] !== after.env?.[key],
  );
  const machine = (file) =>
    (file.env?.runner ?? "").split(";").slice(0, 2).join(";");
  if (machine(before) !== machine(after)) differs.push("runner");
  return differs.length === 0
    ? ""
    : `The two files were taken on different ${differs.join(", ")}; times do not compare across them.`;
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

function table(header, lines, markdown) {
  if (markdown)
    return [
      `| ${header.join(" | ")} |`,
      `|${header.map((_, at) => (at === 0 ? "---" : "---:")).join("|")}|`,
      ...lines.map((line) => `| ${line.join(" | ")} |`),
    ].join("\n");
  const widths = header.map((cell, at) =>
    Math.max(cell.length, ...lines.map((line) => String(line[at]).length)),
  );
  const pad = (line) =>
    line
      .map((cell, at) =>
        at === 0
          ? String(cell).padEnd(widths[at])
          : String(cell).padStart(widths[at]),
      )
      .join("  ");
  return [pad(header), ...lines.map(pad)].join("\n");
}

/** The report of two files: headline rows, then the counts that changed, then the stages that changed most. */
export function compare(before, after, { markdown = false, stages = 15 } = {}) {
  const was = byName(before);
  const now = byName(after);
  const out = [];
  const note = environmentNote(before, after);
  if (note) out.push(markdown ? `> ${note}` : note, "");
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
    const counting = (to ?? from).unit === "{count}";
    const verdict =
      from === undefined
        ? "new"
        : to === undefined
          ? "gone"
          : counting
            ? countChange(from.value, to.value)
            : change(from.value, to.value);
    return [label, shown(from?.value, unit), shown(to?.value, unit), verdict];
  };
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
  head("Headline: unprobed runs, median of the samples, before -> after");
  out.push(
    table(
      ["", "before", "after", "change"],
      lines(headline.filter(({ name }) => main(name))),
      markdown,
    ),
    "",
  );
  const rest = headline.filter(({ name }) => !main(name));
  if (rest.length > 0) {
    const detail = table(
      ["", "before", "after", "change"],
      lines(rest),
      markdown,
    );
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
        ["", "before", "after", "change"],
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
      `Stages that moved most (one probed run each: a stage is slower than the same work unprobed, and is one sample)`,
    );
    out.push(
      table(
        ["", "before", "after", "change"],
        moved.map((pair) => line(pair)),
        markdown,
      ),
      "",
    );
  }
  const commits = (file) =>
    Object.entries(file.commit ?? {})
      .map(([name, sha]) => `${name} ${sha.slice(0, 7)}`)
      .join(", ");
  out.push(`before: ${commits(before)}`, `after: ${commits(after)}`);
  return out.join("\n");
}

/** One file as text: the headline rows, then each scenario's slowest stages. */
export function summary(file, { markdown = false, stages = 10 } = {}) {
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
  for (const [group, rows] of grouped(
    file.results.filter((row) => kindOf(row.name) === "stage"),
  )) {
    const top = rows
      .filter((row) => !/\/stage\/scenario\./.test(row.name))
      .sort((a, b) => b.value - a.value)
      .slice(0, stages);
    out.push(
      markdown
        ? `**${group}: slowest stages (one probed run)**`
        : `${group}: slowest stages (one probed run)`,
      "",
    );
    out.push(
      table(
        ["stage", "time"],
        top.map((row) => [
          row.name.split("/stage/")[1],
          shown(row.value, row.unit),
        ]),
        markdown,
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
  const valued = new Set(["--name", "--since", "--dir", "--stages"]);
  const positional = rest.filter(
    (arg, at) => !arg.startsWith("--") && !valued.has(rest[at - 1]),
  );
  const markdown = rest.includes("--markdown");
  const stages =
    flag("--stages") === undefined ? undefined : Number(flag("--stages"));
  const options = { markdown, ...(stages !== undefined && { stages }) };
  if (command === "compare" && positional.length === 2)
    return say(compare(read(positional[0]), read(positional[1]), options));
  if (command === "summary" && positional.length === 1)
    return say(summary(read(positional[0]), options));
  if (command === "history" && flag("--name") !== undefined)
    return say(
      history(flag("--dir") ?? "perf-data", flag("--name"), flag("--since")),
    );
  process.stderr.write(
    "usage: perf-compare.mjs compare <before.json> <after.json> | summary <file.json> | history --name <glob> [--since 7d] [--dir folder]\n",
  );
  process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
