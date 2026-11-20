#!/usr/bin/env node
// Builds the part of the docs site that lets a person drill into where the time of a build went: the hosted speedscope
// viewer at <out>/speedscope/, and the builds' traces and CPU profiles at <out>/runs/<run>-<sha7>/ with an index of them at
// <out>/runs/, newest first. It reads the checkout of the `perf-flame` branch, where perf.yml keeps each build's folder
// (`runtime/YYYY/MM/DD/<run>-<sha7>-<event>/`, which holds `flame.json` and the files it lists), and serves what the branch
// holds: the window of builds and files kept (`KEEP`) is applied when the branch is written, by perf.yml's publish job.
//
//   perf-runs.mjs pages --data <perf-flame checkout> --out <the site's perf folder> --viewer <speedscope release folder>
//     --repo <owner/name> --pages <the site's perf address> [--perf-data <perf-data checkout>]
//
// With --perf-data, each build's entry also shows its import beside a plain load of the same input into SQLite and what it
// handled, from that build's performance file there.
//
// check.yml's `build-pages` job runs it after copying perf-data's `perf/` (the history page) to <out>/detail/, which it links to the index.

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
import {
  FLOOR_NOTE,
  THROUGHPUT_NOTE,
  floorLine,
  freshKeys,
  shown,
  speedOf,
  throughputTable,
} from "./perf-compare.mjs";
import {
  buildsIn,
  chartTitle,
  readGlossary,
  sentenceOf,
} from "./perf-stacked.mjs";
import {
  storedHtml,
  storedKeys,
  storedOf,
  storedTitle,
} from "./perf-stored.mjs";

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

const EVENTS = {
  push: "main",
  schedule: "nightly",
  workflow_dispatch: "started by hand",
};

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

/** The steps a build's table names, longest own time first. */
export const TABLE_STEPS = 8;

/** One scenario of one build: a plain table of the steps that took the time, then the two links that open its graphs. */
function buildSection(run, build, { viewer, pages, glossary }) {
  const kept = (file) => run.kept.has(file);
  const where = `${pages}/runs/${run.id}`;
  const at = `${titleOf(build)} (${run.date}, ${run.sha})`;
  const link = (text, title, file, bytes, kind) =>
    kept(file)
      ? `<a href="${esc(openIn(viewer, `${where}/${file}`, `${title}: ${at}`))}">${text}</a> <span class="size">${megabytes(bytes)}</span>`
      : `<span class="gone">${text}: not kept, ${whyGone(build, kind)}</span>`;
  /** A worker thread's profile, named by what follows the build's own name in its file's. */
  const workerLink = ({ file }) => {
    const role = file.slice(
      build.cpu.file.length - ".cpuprofile".length + 1,
      -".cpuprofile".length,
    );
    return kept(file)
      ? `<a href="${esc(openIn(viewer, `${where}/${file}`, `${role}: ${at}`))}">${esc(role)}</a>`
      : esc(role);
  };
  const steps = build.trace.top.slice(0, TABLE_STEPS);
  const runMs = build.trace.runMs;
  const queries = build.trace.bridgeQueries ?? [];
  const merged = build.trace.merged ?? 0;
  const left = build.trace.calls - build.trace.drawn - merged;
  const drawn = [
    ...(merged > 0
      ? [
          `${merged.toLocaleString("en-US")} calls that ran at once are drawn merged into ${(build.trace.mergedEvents ?? 0).toLocaleString("en-US")} bars`,
        ]
      : []),
    ...(left > 0
      ? [`${left.toLocaleString("en-US")} of the shortest calls are not drawn`]
      : []),
  ];
  const rows = steps.map((step) => {
    const sentence = sentenceOf(step.says);
    const share =
      runMs === undefined || runMs === 0
        ? ""
        : `${Math.round((100 * step.selfMs) / runMs)}%`;
    return `<tr><td>${sentence === undefined ? "" : `${esc(sentence)} `}<code>${esc(step.name)}</code></td><td class="n">${shown(step.selfMs / 1000, "s")}</td><td class="n">${share}</td></tr>`;
  });
  const bridge =
    queries.length === 0
      ? ""
      : `<details><summary>Time per Bridge query</summary><table>${queries
          .map(
            (query) =>
              `<tr><td><code>${esc(query.name)}</code></td><td class="n">${shown(query.ms / 1000, "s")}</td><td class="n">${query.calls.toLocaleString("en-US")} runs</td></tr>`,
          )
          .join(
            "",
          )}</table><span class="size">The Bridge says how long each query took in all, not when, so a trace does not draw them and a Bridge step's own time includes them.</span></details>`;
  const cpu =
    build.cpu === undefined
      ? `<span class="gone">Which code took it (CPU profile): not produced for this scenario</span>`
      : link(
          "Which code took it (CPU profile)",
          "Which code took it",
          build.cpu.file,
          build.cpu.bytes,
          "cpu",
        ) +
        (build.cpu.processOf === undefined
          ? ""
          : ` <span class="size">(the whole fresh run; the close is its last step)</span>`) +
        (build.cpu.workers.length === 0
          ? ""
          : ` <span class="size">+ ${build.cpu.workers.length} worker threads: ${build.cpu.workers.map(workerLink).join(", ")}</span>`);
  return `<div class="scenario">
<h3>${esc(chartTitle(build, glossary))}</h3>
<table class="steps">
<thead><tr><th>Step</th><th class="n">Time</th><th class="n">Share of the run</th></tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>
<p class="caption">The ${steps.length} steps that spent the longest running on their own, not counting the steps they called${runMs === undefined ? "" : `, of the ${shown(runMs / 1000, "s")} the probed run took`}.</p>
${bridge}
<p class="links">${link("Where the time went (flame graph)", "Where the time went", build.trace.file, build.trace.bytes, "trace")}${drawn.length === 0 ? "" : ` <span class="size">${drawn.join("; ")}</span>`}<br>${cpu}</p>
</div>`;
}

/**
 * What a build's import took beside a plain load of the same input into SQLite, and what it handled: for each fresh import the
 * build's performance file measured, its line and a one-row table. Nothing for a build with no such file.
 */
function speedBlock(run, glossary) {
  const speeds = run.speeds ?? [];
  if (speeds.length === 0) return "";
  const title = (key) => {
    const [, dataset = "", encrypted] =
      /^fresh-first-screen-(.+?)(-encrypted)?$/.exec(key) ?? [];
    return chartTitle(
      {
        scenario: "fresh-first-screen",
        dataset,
        encrypted: encrypted !== undefined,
      },
      glossary,
    );
  };
  const lines = speeds.flatMap((speed) => {
    const line = floorLine(speed);
    return line === undefined
      ? []
      : [
          `<p><strong>${esc(line)}</strong> <span class="size">${esc(title(speed.key))}</span></p>`,
        ];
  });
  return `<div class="box speed">
<h2>The import beside a plain load of the same input into SQLite</h2>
${lines.join("\n")}
${lines.length === 0 ? "" : `<p class="caption">${esc(FLOOR_NOTE)}</p>`}
${speeds
  .map(
    (speed) =>
      `<h3>${esc(title(speed.key))}: what the import handled</h3>
<div class="scroll">${throughputTable([{ label: esc(run.sha), speed }], "Build")}</div>`,
  )
  .join("\n")}
<p class="caption">${esc(THROUGHPUT_NOTE)}</p>
</div>`;
}

/**
 * What the pods a build's performance file counted held, for each size it counted: the line, the classes and, folded away, the
 * kinds. Nothing for a build with no such file or none of whose rows count a pod.
 */
function storedBlock(run, glossary) {
  const pods = run.stored ?? [];
  if (pods.length === 0) return "";
  return `<div class="box stored">
<h2>What a pod holds</h2>
${pods
  .map((page) =>
    storedHtml(page, { heading: `<h3>${esc(storedTitle(page))}</h3>` }),
  )
  .join("\n")}
<p class="caption">${esc(glossary.storedRule ?? "")}</p>
</div>`;
}

/** The page of builds: for each, a plain table of where each scenario's time went, and the links that open its graphs. */
export function runsPage(
  runs,
  { repo, pages, viewer, glossary = readGlossary() },
) {
  const sections = runs.map((run, at) => {
    const scenarios = [
      speedBlock(run, glossary),
      storedBlock(run, glossary),
      ...run.flame.builds.map((build) =>
        buildSection(run, build, { viewer, pages, glossary }),
      ),
    ].filter((each) => each !== "");
    return `<details class="build" id="${esc(run.id)}"${at === 0 ? " open" : ""}>
<summary><strong>${esc(run.date)}</strong> · ${esc(EVENTS[run.event] ?? run.event)} · build <a href="https://github.com/${repo}/commit/${run.sha}">${run.sha}</a> · <a href="https://github.com/${repo}/actions/runs/${run.run}">run ${run.run}</a> <span class="size">${run.flame.builds.length} measurements</span></summary>
${scenarios.join("\n")}
</details>`;
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Where the time of each build went</title>
<style>
body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 2rem auto; max-width: 62rem; padding: 0 1rem; color: #2b2f36; line-height: 1.5; }
h1 { font-size: 1.6rem; margin-bottom: .3rem; }
h3 { font-size: 1rem; margin: 1.6rem 0 .3rem; }
nav { font-size: .9rem; }
table { border-collapse: collapse; width: 100%; font-size: .9rem; }
th, td { text-align: left; padding: .3rem .6rem; border-bottom: 1px solid #e3e6ea; vertical-align: top; }
th.n, td.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
code { font-size: .8em; color: #6b7280; }
.size, .gone { color: #777; font-size: .8em; }
.size { margin-left: .4rem; }
.caption { color: #555b66; font-size: .85rem; margin: .3rem 0; }
.box { background: #f4f6f9; border: 1px solid #dde2ea; border-radius: 6px; padding: .6rem 1rem; margin: 1rem 0; font-size: .93rem; }
.box h2 { font-size: 1rem; margin: 0 0 .3rem; }
.box ul { margin: .3rem 0; padding-left: 1.2rem; }
.box p { margin: .4rem 0; }
.box.speed h2 { font-size: .95rem; }
.box.speed h3 { font-size: .9rem; margin: .8rem 0 .3rem; }
.box.stored h3 { font-size: .9rem; margin: .8rem 0 .3rem; }
.box.stored .speedline { margin: .3rem 0; }
.note { color: #555b66; font-size: .85rem; margin: .3rem 0; }
table.held { font-size: .82rem; }
table.held th, table.held td { padding: .25rem .5rem; }
.scroll { overflow-x: auto; }
table.speed { font-size: .82rem; }
table.speed th, table.speed td { padding: .25rem .5rem; }
details.build { border-top: 1px solid #cfd5de; margin-top: 1rem; padding-top: .3rem; }
details.build > summary { cursor: pointer; padding: .4rem 0; }
a { color: #2f64b8; text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
</head>
<body>
<nav><a href="../../">Documentation home</a> · <a href="../">Where the time goes, over time</a> · <a href="../detail/">Every measurement, one small chart each</a> · <a href="https://github.com/${repo}/blob/main/docs/perf-glossary.md">What each step means</a></nav>
<h1>Where the time of each build went</h1>
<p>Each build, newest first. For each thing measured, the table says which steps took the time, in plain words; under it, two links open the same run as a picture. ${runs.length === 1 ? "One build is" : `${runs.length} builds are`} kept here. Pictures are kept for the newest ${KEEP.builds} builds, CPU profiles for the newest ${KEEP.cpu}, and the large size's pictures for the newest ${KEEP.large} builds that ran it; a row says which of its files are gone.</p>
<div class="box">
<h2>How to read a flame graph</h2>
<ul>
<li>Each box is a step of the runtime. Its width is the time it took: a wide box is where the time went.</li>
<li>A box sits under the step that called it, so the boxes stack as the calls did; a step's own time is the part of its box with nothing under it.</li>
<li>Click a box to zoom into it. Use <em>Left Heavy</em> (top left) to put the biggest pieces together, and <em>Sandwich</em> for a table of the steps by time.</li>
<li><strong>Where the time went</strong> draws every step of one run, as it happened. <strong>Which code took it</strong> is a CPU profile of another run: the functions the processor was in, so it shows the real code at the real speed, but only where the time went in code.</li>
</ul>
<p><strong>Don't open the files in an editor</strong>: they are data, not a document. The links below open them in the viewer.</p>
</div>
${sections.length === 0 ? "<p>No build has kept its flame graphs yet.</p>" : sections.join("\n")}
<p><a href="../../">Documentation home</a> · <a href="../">Where the time goes, over time</a></p>
<script>
function openTarget() {
  const target = document.getElementById(location.hash.slice(1));
  if (target && target.tagName === "DETAILS") { target.open = true; target.scrollIntoView(); }
}
addEventListener("hashchange", openTarget);
openTarget();
</script>
</body>
</html>
`;
}

/** The marker the history page gets a link to the builds under, which github-action-benchmark's page has in its header. */
const HEADER = '<header id="header">';

/**
 * Copies the viewer and the builds' files the data checkout holds into `out`, writes the index of them, and links it from
 * the history page there, which check.yml put at `<out>/detail/`. Returns what it kept.
 */
export function pages({
  data,
  out,
  viewerFolder,
  viewerLicense,
  repo,
  pagesAt,
  perfData,
}) {
  const performanceFiles = new Map(
    (perfData === undefined ? [] : buildsIn(perfData)).map(({ id, path }) => [
      id,
      path,
    ]),
  );
  /** The imports a build's performance file measured, read apart from its flame graphs; none when the file is not kept or cannot be read. */
  const speedsOf = (id) => {
    const path = performanceFiles.get(id);
    if (path === undefined) return [];
    try {
      const file = JSON.parse(readFileSync(path, "utf8"));
      return freshKeys(file).flatMap((key) => speedOf(file, key) ?? []);
    } catch (error) {
      process.stderr.write(
        `warning: ${id} shows no import beside a plain load into SQLite, its file cannot be read: ${error instanceof Error ? error.message : error}\n`,
      );
      return [];
    }
  };
  /** The pods a build's performance file counted; none when the file is not kept or cannot be read (speedsOf has said so). */
  const storedPods = (id) => {
    const path = performanceFiles.get(id);
    if (path === undefined) return [];
    try {
      const file = JSON.parse(readFileSync(path, "utf8"));
      return storedKeys(file).flatMap((key) => storedOf(file, key) ?? []);
    } catch {
      return [];
    }
  };
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
    kept.push({
      ...run,
      flame,
      kept: files,
      speeds: speedsOf(run.id),
      stored: storedPods(run.id),
    });
  }
  writeFileSync(
    join(out, "runs", "index.html"),
    runsPage(kept, { repo, pages: pagesAt, viewer: viewerUrl }),
  );
  const history = join(out, "detail", "index.html");
  if (existsSync(history)) {
    const page = readFileSync(history, "utf8");
    if (page.includes(HEADER) && !page.includes('href="../runs/"'))
      writeFileSync(
        history,
        page.replace(
          HEADER,
          `${HEADER}<p style="margin:0 0 8px"><a href="../">Where the time goes, over time</a> · <a href="../runs/">Each build's flame graphs and CPU profiles</a> · <a href="../../">Documentation home</a></p>`,
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
      `usage: perf-runs.mjs pages ${need.map((name) => `${name} <x>`).join(" ")} [--viewer-license <file>] [--perf-data <perf-data checkout>]\n`,
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
    perfData: flag("--perf-data"),
  });
  process.stdout.write(
    `${kept.length} builds kept under ${flag("--out")}/runs/\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
