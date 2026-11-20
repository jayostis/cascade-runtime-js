#!/usr/bin/env node
// Builds the part of the docs site that lets a person drill into where the time of a build went: the hosted speedscope
// viewer at <out>/speedscope/, and the builds' traces and CPU profiles at <out>/runs/<run>-<sha7>/ with an index of them at
// <out>/runs/, newest first. It reads the checkout of the `perf-flame` branch, where perf.yml keeps each build's folder
// (`runtime/YYYY/MM/DD/<run>-<sha7>-<event>/`, which holds `flame.json` and the files it lists), and serves what the branch
// holds: the window of builds and files kept (`KEEP`) is applied when the branch is written, by perf.yml's publish job.
//
//   perf-runs.mjs pages --data <perf-flame checkout> --out <the site's perf folder> --viewer <speedscope release folder>
//     --repo <owner/name> --pages <the site's perf address>
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

/**
 * What the `perf-flame` branch keeps, which perf.yml's publish job writes it with: the newest builds' traces, the CPU
 * profiles of the newest few of those builds, and the large size's files of the newest few builds that ran it.
 */
export const KEEP = { builds: 30, cpu: 5, large: 7 };

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

/** Why a file a build lists is not in its folder: it fell outside the window the branch keeps, or the build never made it. */
function whyGone(build, kind) {
  if (build.dataset === LARGE)
    return `outside the newest ${KEEP.large} builds that ran the large size`;
  if (kind === "cpu") return `outside the newest ${KEEP.cpu} builds`;
  return "not produced";
}

/** The page of builds: each one's scenarios with the two links that open them in the hosted viewer. */
export function runsPage(runs, { repo, pages, viewer }) {
  const sections = runs.map((run) => {
    const rows = run.flame.builds.map((build) => {
      const kept = (file) => run.kept.has(file);
      const where = `${pages}/runs/${run.id}`;
      const link = (label, file, bytes, kind) =>
        kept(file)
          ? `<a href="${esc(openIn(viewer, `${where}/${file}`, `${label}: ${titleOf(build)} (${run.date}, ${run.sha})`))}">${label}</a> <span class="size">${megabytes(bytes)}</span>`
          : `<span class="gone">${label}: not kept, ${whyGone(build, kind)}</span>`;
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
      const queries = build.trace.bridgeQueries ?? [];
      const merged = build.trace.merged ?? 0;
      const left = build.trace.calls - build.trace.drawn - merged;
      const drawn = [
        ...(merged > 0
          ? [
              `${merged.toLocaleString("en-US")} calls that ran at once merged into ${(build.trace.mergedEvents ?? 0).toLocaleString("en-US")} bars`,
            ]
          : []),
        ...(left > 0
          ? [`${left.toLocaleString("en-US")} of the shortest calls not drawn`]
          : []),
      ];
      return `<tr><td>${esc(build.scenario)}</td><td>${esc(build.dataset)}${build.encrypted ? " encrypted" : ""}</td>
<td>${link("Where the time went", build.trace.file, build.trace.bytes, "trace")}${drawn.length === 0 ? "" : ` <span class="size">${drawn.join("; ")}</span>`}</td>
<td>${
        build.cpu === undefined
          ? `<span class="gone">not produced for this scenario</span>`
          : link("Which code took it", build.cpu.file, build.cpu.bytes, "cpu") +
            (build.cpu.processOf === undefined
              ? ""
              : ` <span class="size">(the whole fresh run; the close is its last step)</span>`) +
            (build.cpu.workers.length === 0
              ? ""
              : ` <span class="size">+ ${build.cpu.workers.length} worker threads: ${build.cpu.workers.map(workerLink).join(", ")}</span>`)
      }</td>
<td>${
        own === undefined
          ? ""
          : `<code>${esc(own.name)}</code> ${shown(own.selfMs / 1000, "s")}<details><summary>the ${build.trace.top.length} longest own times</summary><table>${build.trace.top
              .map(
                (step) =>
                  `<tr><td><code>${esc(step.name)}</code></td><td>${shown(step.selfMs / 1000, "s")}</td><td>${esc(step.says ?? "")}</td></tr>`,
              )
              .join("")}</table></details>`
      }${
        queries.length === 0
          ? ""
          : `<details><summary>time per Bridge query, positions unknown</summary><table>${queries
              .map(
                (query) =>
                  `<tr><td><code>${esc(query.name)}</code></td><td>${shown(query.ms / 1000, "s")}</td><td>${query.calls.toLocaleString("en-US")} runs</td></tr>`,
              )
              .join("")}</table></details>`
      }</td></tr>`;
    });
    return `<section id="${esc(run.id)}">
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
In speedscope, <em>Time Order</em> draws the run as it happened and <em>Left Heavy</em> merges the same calls; the own-time list under each row's <em>Longest own time</em> ranks every step, whereas speedscope's <em>Sandwich</em> covers one track at a time.
What each step means: <a href="https://github.com/${repo}/blob/main/docs/perf-glossary.md">the glossary</a>. The numbers over time: <a href="../">performance history</a>.
${runs.length} builds are kept here: traces for the newest ${KEEP.builds}, CPU profiles for the newest ${KEEP.cpu}, and the large size's files for the newest ${KEEP.large} builds that ran it; each row says which of its files are gone. The Bridge says how long each of its queries took and not when, so a trace does not draw them and a Bridge stage's own time includes them: each row lists them apart.</p>
${sections.length === 0 ? "<p>No build has kept its flame graphs yet.</p>" : sections.join("")}
<p><a href="../">Performance history</a></p>
</body>
</html>
`;
}

/** The marker the history page gets a link to the builds under, which github-action-benchmark's page has in its header. */
const HEADER = '<header id="header">';

/**
 * Copies the viewer and the builds' files the data checkout holds into `out`, writes the index of them, and links it from
 * the history page there. Returns what it kept.
 */
export function pages({
  data,
  out,
  viewerFolder,
  viewerLicense,
  repo,
  pagesAt,
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
  const kept = [];
  for (const run of runsIn(data)) {
    const flame = JSON.parse(
      readFileSync(join(data, run.folder, "flame.json"), "utf8"),
    );
    const files = new Set();
    for (const build of flame.builds) {
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
      `usage: perf-runs.mjs pages ${need.map((name) => `${name} <x>`).join(" ")} [--viewer-license <file>]\n`,
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
  });
  process.stdout.write(
    `${kept.length} builds kept under ${flag("--out")}/runs/\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
