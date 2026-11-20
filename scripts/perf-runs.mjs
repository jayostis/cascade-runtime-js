#!/usr/bin/env node
// Builds the part of the docs site that lets a person drill into where the time of a build went: the hosted speedscope
// viewer at <out>/speedscope/, and the newest builds' traces and CPU profiles at <out>/runs/<run>-<sha7>/ with an index
// of them at <out>/runs/, newest first. It reads the checkout of the `perf-data` branch, where perf.yml keeps each build's
// folder (`runtime/YYYY/MM/DD/<run>-<sha7>-<event>/`, which holds `flame.json` and the files it lists).
//
//   perf-runs.mjs pages --data <perf-data checkout> --out <the site's perf folder> --viewer <speedscope release folder>
//     --repo <owner/name> --pages <the site's perf address> [--keep 30] [--keep-large 3]
//
// check.yml's `build-pages` job runs it after copying perf-data's `perf/` (the history page) to <out>.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { openIn, titleOf } from "./perf-flame.mjs";
import { shown } from "./perf-compare.mjs";

/** The size whose files only the newest few builds keep: a trace and a CPU profile of it run to tens of megabytes. */
export const LARGE = "synthea-lifetime";

const FOLDER =
  /(?:^|\/)runtime\/(\d{4})\/(\d{2})\/(\d{2})\/(\d+)-([0-9a-f]{7})-([a-z_]+)\/flame\.json$/;

function filesUnder(folder) {
  const found = [];
  for (const entry of readdirSync(folder)) {
    const path = join(folder, entry);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

/** Every build's folder in the data checkout, newest first: run ids only grow, and the date leads. */
export function runsIn(data) {
  if (!existsSync(join(data, "runtime"))) return [];
  return filesUnder(join(data, "runtime"))
    .map((path) => relative(data, path).replaceAll("\\", "/"))
    .flatMap((path) => {
      const found = FOLDER.exec(path);
      if (found === null) return [];
      const [, year, month, day, run, sha, event] = found;
      return [
        {
          folder: path.replace(/\/flame\.json$/, ""),
          date: `${year}-${month}-${day}`,
          run,
          sha,
          event,
          id: `${run}-${sha}`,
        },
      ];
    })
    .sort((a, b) => (a.folder < b.folder ? 1 : -1));
}

/** The files a build lists: its trace, its CPU profile and the CPU profiles of its worker threads. */
export function filesOf(build) {
  return [
    build.trace.file,
    ...(build.cpu === undefined
      ? []
      : [build.cpu.file, ...build.cpu.workers.map(({ file }) => file)]),
  ];
}

const esc = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const megabytes = (bytes) =>
  bytes < 1048576
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;

/** The page of builds: each one's scenarios with the two links that open them in the hosted viewer. */
export function runsPage(runs, { repo, pages, viewer }) {
  const sections = runs.map((run) => {
    const rows = run.flame.builds.map((build) => {
      const kept = (file) => run.kept.has(file);
      const where = `${pages}/runs/${run.id}`;
      const link = (label, file, bytes) =>
        kept(file)
          ? `<a href="${esc(openIn(viewer, `${where}/${file}`, `${label}: ${titleOf(build)} (${run.date}, ${run.sha})`))}">${label}</a> <span class="size">${megabytes(bytes)}</span>`
          : `<span class="gone">${label}: not kept, it is large</span>`;
      /** A worker thread's profile, named by what follows the build's own name in its file's. */
      const workerLink = ({ file }) => {
        const role = file.slice(
          build.cpu.file.length - ".cpuprofile".length + 1,
          -".cpuprofile".length,
        );
        return kept(file)
          ? `<a href="${esc(openIn(viewer, `${where}/${file}`, `${role}: ${titleOf(build)} (${run.date}, ${run.sha})`))}">${esc(role)}</a>`
          : esc(role);
      };
      const own = build.trace.top[0];
      return `<tr><td>${esc(build.scenario)}</td><td>${esc(build.dataset)}${build.encrypted ? " encrypted" : ""}</td>
<td>${link("Where the time went", build.trace.file, build.trace.bytes)}${build.trace.drawn < build.trace.calls ? ` <span class="size">draws ${build.trace.drawn.toLocaleString("en-US")} of ${build.trace.calls.toLocaleString("en-US")} calls</span>` : ""}</td>
<td>${
        build.cpu === undefined
          ? ""
          : link("Which code took it", build.cpu.file, build.cpu.bytes) +
            (build.cpu.processOf === undefined
              ? ""
              : ` <span class="size">(the whole fresh run; the close is its last step)</span>`) +
            (build.cpu.workers.length === 0
              ? ""
              : ` <span class="size">+ ${build.cpu.workers.length} worker threads: ${build.cpu.workers.map(workerLink).join(", ")}</span>`)
      }</td>
<td>${own === undefined ? "" : `<code>${esc(own.name)}</code> ${shown(own.selfMs / 1000, "s")}`}</td></tr>`;
    });
    return `<section>
<h2>${esc(run.date)} · ${esc(run.event)} · <a href="https://github.com/${repo}/commit/${run.sha}">${run.sha}</a> · <a href="https://github.com/${repo}/actions/runs/${run.run}">run ${run.run}</a></h2>
<table>
<thead><tr><th>Scenario</th><th>Size</th><th>Where the time went (trace)</th><th>Which code took it (CPU profile)</th><th>Longest own time</th></tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>
</section>`;
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Where the time of each build went</title>
<style>
body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 2rem auto; max-width: 70rem; padding: 0 1rem; color: #333; line-height: 1.5; }
h1 { font-size: 1.6rem; }
h2 { font-size: 1.05rem; margin: 2rem 0 .4rem; }
table { border-collapse: collapse; width: 100%; font-size: .9rem; }
th, td { text-align: left; padding: .3rem .6rem; border-bottom: 1px solid #ddd; vertical-align: top; }
code { font-size: .85em; }
.size, .gone { color: #777; font-size: .8em; }
a { color: #3273dc; text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
</head>
<body>
<h1>Where the time of each build went</h1>
<p>Each build, newest first, with a flame graph of one probed run of each scenario and a CPU profile of one more, opened in <a href="${esc(viewer)}">speedscope</a>.
<strong>Where the time went</strong> is a trace of every step of the runtime, nested inside the step that called it: a step's own time is what it took with none of the steps inside it running. <strong>Which code took it</strong> is a CPU profile of an unprobed run: every function the processor was sampled in, so it shows the real code at the real speed, but only where the time went in code.
In speedscope, <em>Time Order</em> draws the run as it happened, <em>Left Heavy</em> merges the same calls, and <em>Sandwich</em> ranks steps by their own time.
What each step means: <a href="https://github.com/${repo}/blob/main/docs/perf-glossary.md">the glossary</a>. The numbers over time: <a href="../">performance history</a>.
The newest ${runs.length} builds are kept here; the large size's files only for the newest few.</p>
${sections.length === 0 ? "<p>No build has kept its flame graphs yet.</p>" : sections.join("")}
<p><a href="../">Performance history</a></p>
</body>
</html>
`;
}

/** The marker the history page gets a link to the builds under, which github-action-benchmark's page has in its header. */
const HEADER = '<header id="header">';

/**
 * Copies the viewer and the newest builds' files into `out`, writes the index of them, and links it from the history page
 * there. Returns what it kept.
 */
export function pages({
  data,
  out,
  viewerFolder,
  viewerLicense,
  repo,
  pagesAt,
  keep = 30,
  keepLarge = 3,
}) {
  const viewerUrl = `${pagesAt}/speedscope/`;
  mkdirSync(join(out, "speedscope"), { recursive: true });
  for (const entry of readdirSync(viewerFolder))
    if (!/^perf-.*\.txt$/.test(entry))
      cpSync(join(viewerFolder, entry), join(out, "speedscope", entry), {
        recursive: true,
      });
  if (viewerLicense !== undefined && existsSync(viewerLicense))
    cpSync(viewerLicense, join(out, "speedscope", "LICENSE"));
  rmSync(join(out, "runs"), { recursive: true, force: true });
  mkdirSync(join(out, "runs"), { recursive: true });
  let large = 0;
  const kept = [];
  for (const run of runsIn(data).slice(0, keep)) {
    const flame = JSON.parse(
      readFileSync(join(data, run.folder, "flame.json"), "utf8"),
    );
    const hasLarge = flame.builds.some(({ dataset }) => dataset === LARGE);
    const withLarge = hasLarge && large < keepLarge;
    if (hasLarge) large += 1;
    const files = new Set();
    for (const build of flame.builds) {
      if (build.dataset === LARGE && !withLarge) continue;
      for (const file of filesOf(build)) {
        const from = join(data, run.folder, file);
        if (!existsSync(from)) continue;
        mkdirSync(join(out, "runs", run.id), { recursive: true });
        cpSync(from, join(out, "runs", run.id, file));
        files.add(file);
      }
    }
    kept.push({ ...run, flame, kept: files });
  }
  writeFileSync(
    join(out, "runs", "index.html"),
    runsPage(kept, { repo, pages: pagesAt, viewer: viewerUrl }),
  );
  const history = join(out, "index.html");
  if (existsSync(history)) {
    const page = readFileSync(history, "utf8");
    if (page.includes(HEADER) && !page.includes('href="runs/"'))
      writeFileSync(
        history,
        page.replace(
          HEADER,
          `${HEADER}<p style="margin:0 0 8px"><a href="runs/">Where the time of each build went: flame graphs and CPU profiles</a></p>`,
        ),
      );
  }
  return kept;
}

function main(args) {
  const [command, ...rest] = args;
  const flag = (name) => {
    const at = rest.indexOf(name);
    return at === -1 ? undefined : rest[at + 1];
  };
  const need = ["--data", "--out", "--viewer", "--repo", "--pages"];
  if (command !== "pages" || need.some((name) => flag(name) === undefined)) {
    process.stderr.write(
      `usage: perf-runs.mjs pages ${need.map((name) => `${name} <x>`).join(" ")} [--viewer-license <file>] [--keep 30] [--keep-large 3]\n`,
    );
    process.exitCode = 2;
    return;
  }
  const kept = pages({
    data: flag("--data"),
    out: flag("--out"),
    viewerFolder: flag("--viewer"),
    viewerLicense: flag("--viewer-license"),
    repo: flag("--repo"),
    pagesAt: flag("--pages").replace(/\/$/, ""),
    ...(flag("--keep") !== undefined && { keep: Number(flag("--keep")) }),
    ...(flag("--keep-large") !== undefined && {
      keepLarge: Number(flag("--keep-large")),
    }),
  });
  process.stdout.write(
    `${kept.length} builds kept under ${flag("--out")}/runs/\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
