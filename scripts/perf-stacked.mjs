#!/usr/bin/env node
// Builds the main performance page, "Where the time goes, over time": for each scenario at each size, one stacked chart
// whose columns are the builds in order and whose coloured bands are the steps that took the time. It reads the checkout of
// the `perf-data` branch (the performance files, `runtime/YYYY/MM/DD/<run>-<sha7>-<event>.json`) and writes the page and the
// data it draws, both static: no script of the page fetches anything, and no build step is needed to serve it.
//
//   perf-stacked.mjs pages --data <perf-data checkout> --out <the site's perf folder> --repo <owner/name>
//     [--runs <the site's perf/runs folder>]
//
// check.yml's `build-pages` job runs it after perf-runs.mjs, so that a column opens the build's entry in the index of flame
// graphs only when the index has one (`--runs`).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readGlossary } from "./perf-glossary.mjs";
import {
  EDIT_ROW,
  JOBS_ROW,
  jobsHtml,
  jobsKeys,
  jobsOf,
  jobsTitle,
} from "./perf-jobs.mjs";
import {
  STORED_ROW,
  storedHtml,
  storedKeys,
  storedOf,
  storedTitle,
} from "./perf-stored.mjs";
import {
  FLOOR_NOTE,
  SPEED_ROW,
  THROUGHPUT_NOTE,
  floorLine,
  shown,
  speedOf,
  throughputTable,
} from "./perf-compare.mjs";

export { readGlossary };

/** How many steps get a band of their own in a chart; the rest of the time is one band, "everything else". */
export const BANDS = 7;

/** The newest builds a chart draws; a year of pushes would make columns too thin to hover. */
export const WINDOW = 120;

/**
 * Colours that tell seven neighbouring bands apart on white. A step takes the one its name hashes to, or the next that no
 * step charted with it, earlier in name order, holds. Nothing but names decides, so a step keeps its colour from one
 * deploy to the next, and is the same colour in every chart of the page.
 */
export const PALETTE = [
  "#3b6fb6",
  "#e07b39",
  "#4f9d69",
  "#c4453c",
  "#8e6bb8",
  "#b8943a",
  "#2a9db0",
  "#d1648f",
  "#6b8e23",
  "#7a5a45",
  "#5b6770",
  "#a64d79",
];

/** The band that stands for the time of every step without one of its own, and for a build with no breakdown. */
export const OTHER = "#c9ccd1";

/**
 * A performance file's path. The Linux job's file ends in the event; a Windows or macOS job's ends in the event and the
 * system (`-push-windows`), because the three jobs of one run name their files by the same run and commit.
 */
const FILE =
  /(?:^|\/)runtime\/(\d{4})\/(\d{2})\/(\d{2})\/(\d+)-([0-9a-f]{7})-([a-z_]+)(?:-(windows|macos))?\.json$/;

/** The systems a build can be measured on, in the order the page lists them, and how a person names each. */
export const SYSTEMS = ["linux", "windows", "macos"];
export const SYSTEM_NAME = {
  linux: "Linux",
  windows: "Windows",
  macos: "macOS",
};

/** The system a file's own environment names (`env.os` is node's platform and kernel release), undefined where it names none. */
export function systemOf(env) {
  const platform = String(env?.os ?? "").split(" ")[0];
  return { linux: "linux", win32: "windows", darwin: "macos" }[platform];
}

/** The processor a file's runner names, with what a person wants to know of an Apple one. */
export function chipOf(env) {
  const model = String(env?.runner ?? "")
    .split(";")[1]
    ?.trim();
  if (model === undefined || model === "" || model.startsWith("other load:"))
    return undefined;
  if (!/^Apple /.test(model)) return model;
  const virtual = /\(Virtual\)/.test(model);
  return `${model.replace(/\s*\(Virtual\)/, "")}, Apple silicon${virtual ? ", a virtual machine" : ""}`;
}

function filesUnder(folder) {
  const found = [];
  for (const entry of readdirSync(folder)) {
    const path = join(folder, entry);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

/** Every performance file of the data checkout, oldest build first: run ids only grow, and the date leads. */
export function buildsIn(data) {
  if (!existsSync(join(data, "runtime"))) return [];
  return filesUnder(join(data, "runtime"))
    .map((path) => ({ path, name: relative(data, path).replaceAll("\\", "/") }))
    .flatMap(({ path, name }) => {
      const found = FILE.exec(name);
      if (found === null) return [];
      const [, year, month, day, run, sha, event, system = "linux"] = found;
      return [
        {
          path,
          date: `${year}-${month}-${day}`,
          run,
          sha,
          event,
          os: system,
          // The three jobs of one run share its id and commit: a build of another system has its system in its id.
          id: system === "linux" ? `${run}-${sha}` : `${run}-${sha}-${system}`,
        },
      ];
    })
    .sort((a, b) =>
      a.date === b.date
        ? Number(a.run) - Number(b.run)
        : a.date < b.date
          ? -1
          : 1,
    );
}

/** The sentence a row's `extra` begins with, without the "Sits inside <step>." the glossary adds. */
export function sentenceOf(extra) {
  if (typeof extra !== "string") return undefined;
  const first = extra
    .split(" | ")[0]
    .replace(/\s*Sits inside \S+(?: or \S+)*\.$/, "")
    .trim();
  return first === "" ? undefined : first;
}

/** A text cut at a word to fit `limit`, with an ellipsis where it was cut. */
function clipped(text, limit) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const word = cut.lastIndexOf(" ");
  return `${cut.slice(0, word > 20 ? word : limit - 1).replace(/[,\s]+$/, "")}…`;
}

/**
 * A sentence cut to a label that fits under a chart: its first sentence, shortened at a word. A sentence of the form
 * "What it does: the thing" keeps both parts when the step's own name (`name`) repeats the thing, because then the thing is
 * what tells its bands apart ("One page of the answer to: pod my lab results" for `question.page-pod-my-lab-results`); one
 * whose second part explains the first, or a sentence without a name to compare, keeps only the first part.
 */
export function shortOf(sentence, limit = 56, name = "") {
  const plain = sentence.replace(/\.$/, "");
  const first =
    plain.split(/[.;]\s/).find((part) => part.length >= 15) ?? plain;
  const named = /^([^:]*): (.+)$/.exec(first);
  if (named === null) return clipped(first, limit);
  const [, lead = "", thing = ""] = named;
  const slug = thing
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-|-$/g, "");
  if (lead.length < 15 || (slug !== "" && name.includes(slug)))
    return clipped(first, 80);
  return clipped(lead, limit);
}

const hashOf = (text) => {
  let hash = 2166136261;
  for (const letter of text)
    hash = Math.imul(hash ^ letter.codePointAt(0), 16777619) >>> 0;
  return hash;
};

/**
 * Gives each step a colour, once for the page: in name order, a step takes the colour its name hashes to, or the next one
 * that no step charted beside it, already coloured, holds.
 *
 * @param {Map<string, {with: Set<string>}>} steps
 * @returns {Map<string, string>}
 */
export function coloured(steps) {
  const taken = new Map();
  for (const key of [...steps.keys()].sort()) {
    const used = new Set(
      [...(steps.get(key)?.with ?? [])]
        .map((other) => taken.get(other))
        .filter((each) => each !== undefined),
    );
    let at = hashOf(key) % PALETTE.length;
    for (let tried = 0; tried < PALETTE.length && used.has(at); tried++)
      at = (at + 1) % PALETTE.length;
    taken.set(key, at);
  }
  return new Map([...taken].map(([key, at]) => [key, PALETTE[at]]));
}

/** What a build's file says of one scenario at one size: its headline time, the probed run's time, and each step's own time. */
function rowsOf(file, key) {
  let total;
  let runs;
  let probed;
  const own = new Map();
  const prefix = `${key}/`;
  for (const row of file.results ?? []) {
    if (!row.name.startsWith(prefix) || typeof row.value !== "number") continue;
    const rest = row.name.slice(prefix.length);
    if (rest === "total") {
      total = row.value;
      runs = row.samples;
    } else if (rest === "probed-total") probed = row.value;
    else if (rest.startsWith("self/")) {
      const name = rest.slice(5);
      own.set(name, { seconds: row.value, says: sentenceOf(row.extra) });
    }
  }
  return { total, runs, probed, own, speed: speedOf(file, key) };
}

/** The scenario and size a row name starts with, from the glossary's names: `fresh-first-screen-synthea-10y-encrypted/total`. */
const keyPattern = (glossary) =>
  new RegExp(
    `^((${Object.keys(glossary.scenarios).join("|")})-(${Object.keys(glossary.datasets).join("|")})(-encrypted)?)/`,
  );

/**
 * What a build's file keeps for the charts: the rows of the headline time, the probed run's time and each step's own time
 * (with the sentence of its `extra` and no more), the rest of the file being dropped as it is read.
 */
export function reduced(file, glossary = readGlossary()) {
  const pattern = keyPattern(glossary);
  return {
    ...(file.env !== undefined && {
      env: { os: file.env.os, runner: file.env.runner, cpus: file.env.cpus },
    }),
    results: (file.results ?? []).flatMap((row) => {
      const found = pattern.exec(row.name ?? "");
      if (found === null || typeof row.value !== "number") return [];
      const rest = row.name.slice(found[0].length);
      // What one file costs: every row, with the note of a count (why the runner refused, say).
      if (found[2] === "file-ops")
        return [
          {
            name: row.name,
            value: row.value,
            ...(typeof row.range === "string" && { range: row.range }),
            ...(typeof row.extra === "string" && { extra: row.extra }),
          },
        ];
      if (rest === "total" || rest === "probed-total")
        return [{ name: row.name, value: row.value, samples: row.samples }];
      if (SPEED_ROW.test(row.name) || STORED_ROW.test(row.name))
        return [{ name: row.name, value: row.value }];
      if (JOBS_ROW.test(row.name))
        return [
          {
            name: row.name,
            value: row.value,
            ...(EDIT_ROW.test(row.name) && { extra: row.extra }),
          },
        ];
      if (!rest.startsWith("self/")) return [];
      return [
        { name: row.name, value: row.value, extra: sentenceOf(row.extra) },
      ];
    }),
  };
}

function chartKeys(files, glossary) {
  const found = new Set();
  const scenarios = Object.keys(glossary.scenarios);
  const datasets = Object.keys(glossary.datasets);
  const pattern = keyPattern(glossary);
  for (const { file } of files)
    for (const row of file.results ?? []) {
      const found_ = pattern.exec(row.name);
      if (
        found_ !== null &&
        row.name === `${found_[1]}/total` &&
        glossary.scenarios[found_[2]]?.chart !== false
      )
        found.add(
          JSON.stringify([
            found_[1],
            found_[2],
            found_[3],
            found_[4] !== undefined,
          ]),
        );
    }
  const order = (scenario, dataset, encrypted) =>
    scenarios.indexOf(scenario) * 100 +
    datasets.indexOf(dataset) * 10 +
    (encrypted ? 1 : 0);
  return [...found]
    .map((text) => JSON.parse(text))
    .sort((a, b) => order(a[1], a[2], a[3]) - order(b[1], b[2], b[3]))
    .map(([key, scenario, dataset, encrypted]) => ({
      key,
      scenario,
      dataset,
      encrypted,
    }));
}

/**
 * One chart's columns and bands from the builds that measured it.
 *
 * A step's band is its own time (the time some call of it was in progress with none of the steps inside it in progress)
 * from the build's one PROBED run, scaled so the bands add up to the build's headline total, which is the median of
 * UNPROBED runs. The probe slows some work, and where steps overlap the own times add up to more than the run took, so the
 * own times are only shares of the time: the scale is the total over the larger of the probed run's time and the own times'
 * sum, and the time no band has is "everything else". A build whose file has no own-time rows (it predates them) is one
 * band of "everything else", and says so.
 */
export function shapeChart(measured, { bands = BANDS, window = WINDOW } = {}) {
  const kept = measured
    .filter(({ total }) => typeof total === "number")
    .slice(-window);
  const scaled = kept.map((build) => {
    const sum = [...build.own.values()].reduce(
      (a, step) => a + step.seconds,
      0,
    );
    const denominator = Math.max(build.probed ?? 0, sum);
    const scale = sum === 0 ? 0 : build.total / denominator;
    return new Map(
      [...build.own].map(([name, step]) => [name, step.seconds * scale]),
    );
  });
  const weight = new Map();
  for (const each of scaled)
    for (const [name, seconds] of each)
      weight.set(name, (weight.get(name) ?? 0) + seconds);
  const chosen = [...weight]
    .filter(([, seconds]) => seconds > 0)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .slice(0, bands)
    .map(([name, seconds]) => ({ name, weight: seconds }));
  const steps = chosen.map(({ name, weight: sum }) => {
    // Its words come from the newest build that has the step: the sentences do not change often, and the newest are right.
    const newest = [...kept]
      .reverse()
      .find((build) => build.own.has(name))
      ?.own.get(name);
    return {
      key: name,
      label:
        newest?.says === undefined
          ? name
          : shortOf(newest.says, undefined, name),
      says: newest?.says,
      span: name,
      weight: sum,
    };
  });
  const columns = kept.map((build, at) => {
    const values = steps.map(({ key }) => scaled[at].get(key) ?? 0);
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      id: build.id,
      date: build.date,
      sha: build.sha,
      event: build.event,
      run: build.run,
      total: build.total,
      runs: build.runs,
      speed: build.speed,
      measured: build.own.size > 0,
      bands: values,
      other: Math.max(0, build.total - sum),
    };
  });
  return { steps, columns };
}

/** What the newest of these builds that measured the chart says of its machine: the chip and the processors. */
function systemOfCharts(files, key) {
  const newest = [...files]
    .reverse()
    .find(({ file }) =>
      (file.results ?? []).some((row) => row.name === `${key}/total`),
    );
  return newest?.file.env === undefined
    ? undefined
    : { chip: chipOf(newest.file.env), cpus: newest.file.env.cpus };
}

/**
 * Every chart of the data: its title's parts, its steps with their colours, and its columns. A system's chart is drawn from
 * that system's builds alone, so a series is never one of two systems: the times of one cannot be read against the other's.
 */
export function shape(
  files,
  { glossary = readGlossary(), bands = BANDS, window = WINDOW } = {},
) {
  const charts = SYSTEMS.flatMap((os) => {
    const own = files.filter(({ build }) => (build.os ?? "linux") === os);
    return chartKeys(own, glossary).map((chart) => ({
      ...chart,
      os,
      id: os === "linux" ? chart.key : `${chart.key}-${os}`,
      ...shapeChart(
        own.map(({ build, file }) => ({
          ...build,
          ...rowsOf(file, chart.key),
        })),
        { bands, window },
      ),
      system: systemOfCharts(own, chart.key),
    }));
  });
  const steps = new Map();
  for (const chart of charts)
    for (const step of chart.steps) {
      const known = steps.get(step.key) ?? { with: new Set() };
      for (const other of chart.steps)
        if (other.key !== step.key) known.with.add(other.key);
      steps.set(step.key, known);
    }
  const colours = coloured(steps);
  return charts
    .filter((chart) => chart.columns.length > 0)
    .map((chart) => ({
      ...chart,
      steps: chart.steps.map((step) => ({
        ...step,
        colour: colours.get(step.key),
      })),
    }));
}

const esc = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const TITLES = {
  "fresh-first-screen": "A new pod, from nothing to the first screen",
  "reopen-first-answer": "Reopening a pod to its first answer",
  "question-page": "One page of answers to each question",
  close: "Closing the pod",
};

/** A size as a person reads it: "647 source entries", "16,833 source entries, measured nightly"; encrypted says so. */
function sizeOf(chart, glossary) {
  const sentence = glossary.datasets[chart.dataset] ?? chart.dataset;
  const entries = /([\d,]+) source entries/.exec(sentence)?.[1];
  const nightly = chart.dataset === "synthea-lifetime";
  return [
    entries === undefined ? chart.dataset : `${entries} source entries`,
    ...(nightly ? ["measured nightly"] : []),
    ...(chart.encrypted ? ["encrypted pod"] : []),
  ].join(", ");
}

/** The title of a chart, or of a build's scenario in the index of builds: what it measures and the size it ran on. */
export const chartTitle = (chart, glossary) =>
  `${TITLES[chart.scenario] ?? chart.scenario}: ${sizeOf(chart, glossary)}${chart.os === undefined || chart.os === "linux" ? "" : `, on ${SYSTEM_NAME[chart.os]}`}`;

/** The gap between the lines of a chart whose tallest column is `max`: one of 1, 1.5, 2, 2.5, 3, 4, 5, 7.5 tens of something. */
const niceStep = (max) => {
  const power = 10 ** Math.floor(Math.log10(max / 4 || 1));
  return (
    [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]
      .map((each) => each * power)
      .find((each) => each >= max / 4) ?? 10 * power
  );
};

const seconds = (value) =>
  value >= 1
    ? `${+value.toFixed(1)} s`
    : value === 0
      ? "0"
      : value < 0.01
        ? `${+(value * 1000).toFixed(1)} ms`
        : `${Math.round(value * 1000)} ms`;

/** A time as the rest of the performance pages say it: `5.25 s`, `310 ms`. */
const exact = (value) => shown(value, "s");

const EVENT = { push: "", schedule: "nightly", workflow_dispatch: "manual" };

const SIZE = {
  width: 880,
  height: 300,
  left: 58,
  right: 12,
  top: 12,
  bottom: 42,
};

/** The chart as an SVG: one column per build, its bands stacked from the largest step up, "everything else" on top. */
export function chartSvg(chart, index) {
  const { width, height, left, right, top, bottom } = SIZE;
  const plot = { w: width - left - right, h: height - top - bottom };
  const tallest = Math.max(
    0.001,
    ...chart.columns.map((column) => column.total),
  );
  const step = niceStep(tallest);
  const ticks = Math.ceil(tallest / step - 1e-9);
  const max = step * ticks;
  const y = (value) => top + plot.h - (value / max) * plot.h;
  const n = chart.columns.length;
  const slot = plot.w / n;
  const bar = n <= 30 ? Math.min(slot * 0.8, 56) : slot;
  const x = (at) => left + slot * at + (slot - bar) / 2;
  const out = [];
  for (let at = 0; at <= ticks; at++) {
    const value = step * at;
    out.push(
      `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"/>`,
      `<text class="tick" x="${left - 6}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end">${seconds(value)}</text>`,
    );
  }
  chart.columns.forEach((column, at) => {
    let floor = 0;
    const layers = [
      ...chart.steps.map((step, each) => ({
        colour: step.colour,
        value: column.bands[each],
      })),
      { colour: OTHER, value: column.other, other: true },
    ];
    for (const layer of layers) {
      if (layer.value <= 0) continue;
      const topAt = floor + layer.value;
      out.push(
        `<rect class="band${layer.other && !column.measured ? " bare" : ""}" x="${x(at).toFixed(1)}" y="${y(topAt).toFixed(1)}" width="${bar.toFixed(1)}" height="${Math.max(0.5, y(floor) - y(topAt)).toFixed(1)}" fill="${layer.colour}"/>`,
      );
      floor = topAt;
    }
  });
  const labels = Math.min(n, 8);
  for (let each = 0; each < labels; each++) {
    const at = labels === 1 ? 0 : Math.round((each * (n - 1)) / (labels - 1));
    const column = chart.columns[at];
    const centre = x(at) + bar / 2;
    out.push(
      `<line class="mark" x1="${centre.toFixed(1)}" x2="${centre.toFixed(1)}" y1="${top + plot.h}" y2="${top + plot.h + 4}"/>`,
      `<text class="tick" x="${centre.toFixed(1)}" y="${top + plot.h + 16}" text-anchor="middle">${esc(column.sha)}</text>`,
      `<text class="tick dim" x="${centre.toFixed(1)}" y="${top + plot.h + 29}" text-anchor="middle">${esc([column.date.slice(5), EVENT[column.event] ?? column.event].filter(Boolean).join(" "))}</text>`,
    );
  }
  chart.columns.forEach((column, at) => {
    const link =
      column.href === undefined ? ' role="img"' : ` href="${esc(column.href)}"`;
    const said = [
      ...chart.steps.map((each, place) => ({
        label: each.label,
        value: column.bands[place] ?? 0,
      })),
      { label: "everything else", value: column.other },
    ]
      .filter(({ value }) => value > 0)
      .map(({ label, value }) => `${label} ${seconds(value)}`);
    const aloud = `${column.sha}, ${column.date}, ${exact(column.total)}${said.length === 0 ? "" : `: ${said.join("; ")}`}`;
    out.push(
      `<a class="col"${link} tabindex="0" data-chart="${index}" data-at="${at}" aria-label="${esc(aloud)}"><rect x="${(left + slot * at).toFixed(1)}" y="${top}" width="${slot.toFixed(1)}" height="${plot.h}"/></a>`,
    );
  });
  return `<svg viewBox="0 0 ${width} ${height}" role="group" aria-label="${esc(`${chart.title}: seconds by build, stacked by step`)}">${out.join("")}</svg>`;
}

const SCRIPT = `
const data = JSON.parse(document.getElementById("data").textContent);
const tip = document.getElementById("tip");
const seconds = (v) => v >= 1 ? v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2) + " s" : v === 0 ? "0" : v < 0.01 ? (+(v * 1000).toFixed(1)) + " ms" : Math.round(v * 1000) + " ms";
const el = (name, text, cls) => { const e = document.createElement(name); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
function show(link, event) {
  const chart = data.charts[+link.dataset.chart];
  const column = chart.columns[+link.dataset.at];
  tip.replaceChildren();
  tip.append(el("strong", column.sha + " · " + column.date + " · " + column.event));
  tip.append(el("div", "Total " + seconds(column.total), "total"));
  const rows = chart.steps.map((step, i) => ({ colour: step.colour, label: step.label, says: step.says, value: column.bands[i] }));
  rows.push({ colour: data.other, label: column.measured ? "everything else" : "no step breakdown in this build's file", value: column.other });
  for (const row of rows.slice().reverse()) {
    if (row.value <= 0) continue;
    const line = el("div", undefined, "row");
    const swatch = el("span", undefined, "swatch");
    swatch.style.background = row.colour;
    line.append(swatch, el("span", row.label), el("b", seconds(row.value) + " (" + Math.round(100 * row.value / column.total) + "%)"));
    tip.append(line);
    if (row.says && row.says.replace(/\\.$/, "") !== row.label) tip.append(el("div", row.says, "says"));
  }
  tip.append(el("div", column.href ? (event.pointerType === "touch" ? "Tap again: this build's flame graphs" : "Click: this build's flame graphs") : "No flame graphs are kept for this build", "hint"));
  tip.hidden = false;
  const box = tip.getBoundingClientRect();
  const left = event.clientX + 16 + box.width > innerWidth ? event.clientX - 16 - box.width : event.clientX + 16;
  tip.style.left = Math.max(4, left) + "px";
  tip.style.top = Math.max(4, Math.min(event.clientY + 12, innerHeight - box.height - 4)) + "px";
}
let armed = null;
document.addEventListener("pointerdown", (event) => {
  if (event.target.closest("a.col")) return;
  tip.hidden = true;
  armed = null;
});
for (const link of document.querySelectorAll("a.col")) {
  link.addEventListener("pointermove", (event) => show(link, event));
  link.addEventListener("pointerleave", (event) => { if (event.pointerType !== "touch") tip.hidden = true; });
  link.addEventListener("pointerdown", (event) => { link.dataset.touch = event.pointerType === "touch" ? "1" : ""; });
  link.addEventListener("click", (event) => {
    if (!link.dataset.touch || armed === link) return;
    event.preventDefault();
    armed = link;
    show(link, { clientX: event.clientX, clientY: event.clientY, pointerType: "touch" });
  });
  link.addEventListener("focus", () => { const r = link.getBoundingClientRect(); show(link, { clientX: r.left + r.width / 2, clientY: r.top + 20 }); });
  link.addEventListener("blur", () => { tip.hidden = true; });
}
`;

const STYLE = `
body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 2rem auto; max-width: 62rem; padding: 0 1rem; color: #2b2f36; line-height: 1.5; }
h1 { font-size: 1.7rem; margin-bottom: .3rem; }
h2 { font-size: 1.15rem; margin: 0 0 .1rem; }
nav.top, p.links { font-size: .9rem; }
a { color: #2f64b8; text-decoration: none; }
a:hover { text-decoration: underline; }
.how { background: #f4f6f9; border: 1px solid #dde2ea; border-radius: 6px; padding: .2rem 1rem; margin: 1rem 0 1.5rem; font-size: .93rem; }
.how summary { cursor: pointer; font-weight: 600; padding: .5rem 0; }
section.chart { margin: 2.2rem 0; }
section.chart p.about { margin: 0 0 .4rem; color: #555b66; font-size: .9rem; }
svg { width: 100%; height: auto; display: block; }
.grid { stroke: #e3e6ea; stroke-width: 1; }
.mark { stroke: #8a909b; }
.tick { font-size: 11px; fill: #555b66; }
.tick.dim { fill: #8a909b; }
.band { stroke: #fff; stroke-width: .6; }
.band.bare { opacity: .55; }
a.col rect { fill: transparent; }
a.col:hover rect, a.col:focus rect { fill: rgba(30, 40, 60, .09); }
a.col { outline: none; cursor: pointer; }
a.col:focus-visible rect { stroke: #2f64b8; stroke-width: 2; }
ul.legend { list-style: none; padding: 0; margin: .4rem 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(26rem, 1fr)); gap: .2rem 1.2rem; font-size: .88rem; }
ul.legend li { display: flex; gap: .5rem; align-items: baseline; }
.swatch { display: inline-block; width: .8rem; height: .8rem; border-radius: 2px; flex: none; }
ul.legend code { color: #7a808b; font-size: .8em; display: block; }
ul.legend .latest { margin-left: auto; color: #555b66; white-space: nowrap; font-variant-numeric: tabular-nums; }
#tip { position: fixed; z-index: 5; background: #1f2430; color: #fff; padding: .55rem .7rem; border-radius: 6px; font-size: .82rem; pointer-events: none; max-width: 24rem; box-shadow: 0 4px 14px rgba(0, 0, 0, .25); }
#tip .total { font-size: 1rem; margin: .1rem 0 .35rem; }
#tip .row { display: flex; gap: .45rem; align-items: baseline; }
#tip .row b { margin-left: auto; padding-left: 1rem; font-weight: 500; white-space: nowrap; }
#tip .says { color: #aab; font-size: .75rem; margin: 0 0 .25rem 1.25rem; }
#tip .hint { margin-top: .4rem; color: #aab; font-size: .75rem; }
table.held { border-collapse: collapse; width: 100%; font-size: .85rem; margin: .4rem 0; }
table.held th, table.held td { padding: .25rem .5rem; border-bottom: 1px solid #e3e6ea; vertical-align: bottom; text-align: left; }
table.held th.n, table.held td.n { text-align: right; font-variant-numeric: tabular-nums; }
section.stored details { margin: .4rem 0; }
section.jobs h3 { font-size: 1rem; margin: 1.4rem 0 .2rem; }
section.jobs ul.jobs { margin: .4rem 0; padding-left: 1.2rem; }
section.jobs ul.jobs li { margin: .3rem 0; }
section.stored h3 { font-size: 1rem; margin: 1.4rem 0 .2rem; }
.speedbox { margin: .6rem 0; }
.speedbox p { margin: .3rem 0; }
.speedline { font-size: 1rem; }
.scroll { overflow-x: auto; }
table.speed { border-collapse: collapse; width: 100%; font-size: .82rem; }
table.speed th, table.speed td { padding: .25rem .5rem; border-bottom: 1px solid #e3e6ea; vertical-align: bottom; text-align: left; }
table.speed th.n, table.speed td.n { text-align: right; font-variant-numeric: tabular-nums; }
table.speed td:first-child { white-space: nowrap; }
.toc { columns: 2; font-size: .9rem; }
.note { color: #555b66; font-size: .85rem; }
`;

/** How many of the newest builds the table of what an import handled lists. */
export const SPEED_BUILDS = 10;

/**
 * Under a fresh import's chart: the line of the newest build that has a plain load into SQLite to read the import against, and a
 * table of what the newest builds' imports handled and how fast each phase went. Nothing for a chart whose builds did not
 * measure the import's parts.
 */
function speedBlock(chart, repo) {
  const measured = chart.columns.filter(({ speed }) => speed !== undefined);
  if (measured.length === 0) return "";
  const at = [...measured].reverse().find(({ speed }) => floorLine(speed));
  const label = (column) =>
    `<a href="https://github.com/${esc(repo)}/commit/${esc(column.sha)}">${esc(column.sha)}</a> <span class="note">${esc(column.date)}</span>`;
  const line =
    at === undefined
      ? ""
      : `<p class="speedline"><strong>${esc(floorLine(at.speed))}</strong> <span class="note">Build ${label(at)}.</span></p>
<p class="note">${esc(FLOOR_NOTE)}</p>`;
  return `<div class="speedbox">
${line}
<div class="scroll">${throughputTable(
    measured
      .slice(-SPEED_BUILDS)
      .reverse()
      .map((column) => ({ label: label(column), speed: column.speed })),
  )}</div>
<p class="note">${esc(THROUGHPUT_NOTE)}</p>
</div>`;
}

const OPS_ROWS = [
  ["absent-check", "Ask whether a file is there, when it is not"],
  ["create", "Create a file"],
  ["create-rename", "Create a file under a temporary name, then rename it"],
  [
    "full-path",
    "What the pod's folder does for a file: look at the path, resolve the folder, create, rename",
  ],
];
const AT_ONCE = [1, 16, 64];
const ROW_OF_FILES =
  /^file-ops-3000-files(?:-scanner-(off|on|excluded))?\/(.+)$/;

/**
 * What one small file costs on each system, from each system's newest build that measured it: its times by the state of the
 * virus scanner (as the machine is, switched off, folder excluded), and what the scanner allowed.
 */
export function fileOpsOf(files) {
  return SYSTEMS.flatMap((os) => {
    const newest = [...files]
      .reverse()
      .find(
        ({ build, file }) =>
          (build.os ?? "linux") === os &&
          (file.results ?? []).some((row) => ROW_OF_FILES.test(row.name)),
      );
    if (newest === undefined) return [];
    const states = {};
    const ranges = {};
    const notes = {};
    for (const row of newest.file.results ?? []) {
      const found = ROW_OF_FILES.exec(row.name);
      if (found === null) continue;
      const [, state = "as-is", rest] = found;
      (states[state] ??= {})[rest] = row.value;
      if (typeof row.range === "string")
        (ranges[state] ??= {})[rest] = row.range;
      if (rest.startsWith("count/") && typeof row.extra === "string")
        (notes[state] ??= {})[rest] = row.extra.split(" | ").at(-1);
    }
    return [
      {
        os,
        label: SYSTEM_NAME[os],
        chip: chipOf(newest.file.env),
        cpus: newest.file.env?.cpus,
        sha: newest.build.sha,
        date: newest.build.date,
        states,
        ranges,
        notes,
      },
    ];
  });
}

/** Whether a range, `0.000010-0.000100` in seconds, is so wide that one run was far from the others, so its median is not a figure to quote. */
export function wideRange(range) {
  const [low, high] = String(range).split("-").map(Number);
  return (
    Number.isFinite(low) &&
    Number.isFinite(high) &&
    high > Math.max(low, 1e-12) * 3
  );
}

/** A time per file as a person reads it: `830 µs`, `45 µs`, `7.2 µs`. */
export function micro(seconds) {
  const us = seconds * 1e6;
  return `${us >= 100 ? Math.round(us) : us >= 10 ? +us.toFixed(1) : +us.toFixed(2)} µs`;
}

const timesOf = (change) => `${change.toFixed(change >= 10 ? 0 : 1)}×`;

/** The range of a row, `0.000225-0.000375` in seconds, as `225-375 µs`. */
function microRange(range) {
  const [low, high] = String(range).split("-").map(Number);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined;
  const plain = (seconds) => micro(seconds).replace(" µs", "");
  return `${plain(low)}-${plain(high)} µs`;
}

/**
 * What a system's scanner was set to and what each state measured, as the run recorded it, and no verdict: the page gives the
 * recorded settings and the numbers, and a reader decides what a difference between two times means.
 */
function scannerFacts(system) {
  const own = system.notes["as-is"] ?? {};
  const said = [];
  if (own["count/scanner-realtime-on"] !== undefined)
    said.push(
      `What the runner allowed, as Windows Defender reported it before anything was changed: ${own["count/scanner-realtime-on"]}.`,
    );
  if (own["count/work-folder"] !== undefined)
    said.push(
      `${own["count/work-folder"][0].toUpperCase()}${own["count/work-folder"].slice(1)}.`,
    );
  for (const [key, text] of [
    ["count/scanner-switch-off-allowed", "switch its live checking off"],
    [
      "count/scanner-switch-on-allowed",
      "switch its live, file and script checking on",
    ],
    ["count/scanner-exclusion-allowed", "exclude the folder"],
  ])
    if (system.states["as-is"]?.[key] === 0)
      said.push(
        `The runner did not let the run ${text} (${own[key] ?? "no reason recorded"}), so that column is missing.`,
      );
  if (own["count/scanner-restored"] !== undefined)
    said.push(
      `Afterwards the settings were ${system.states["as-is"]["count/scanner-restored"] === 1 ? "read back as they were" : "NOT read back as they were"}: ${own["count/scanner-restored"]}.`,
    );
  return said;
}

/** Why a ratio to Linux moves with the build, said wherever one is given. */
const LINUX_CHIP_NOTE =
  "These ratios move with the chip GitHub gave the Linux build, which is named in each column's header: creating a file at 16 at once took 15 µs on one Linux machine (an Intel Xeon 6975P) and 45 µs on another (an AMD EPYC 7763), three times as long, so the same Windows time has been between 5 and 45 times Linux's depending on the draw. Compare a ratio with another only where the Linux chip is the same.";

/** How many times as long a system took to create a file as Linux, for each number of files at once. */
function againstLinux(system, linux) {
  const parts = AT_ONCE.flatMap((at) => {
    const own = system.states["as-is"]?.[`create/in-flight-${at}`];
    const base = linux.states["as-is"]?.[`create/in-flight-${at}`];
    return own === undefined || base === undefined
      ? []
      : [
          `${timesOf(own / base)} ${at === 1 ? "one at a time" : `at ${at} at once`}`,
        ];
  });
  if (parts.length === 0) return undefined;
  const [first, ...rest] = parts;
  const tail =
    rest.length === 0
      ? ""
      : `, ${rest.length === 1 ? rest[0] : `${rest.slice(0, -1).join(", ")} and ${rest.at(-1)}`}`;
  return `On ${system.label}, creating a file took ${first.replace(" ", " as long as on Linux ")}${tail}.`;
}

/** The table of what one file costs, one column for each system, and the scanner table of each system that was asked. */
function fileOpsSection(systems) {
  if (systems.length === 0) return "";
  const linux = systems.find(({ os }) => os === "linux");
  const files = (system) => system.states["as-is"]?.["count/files"] ?? 3000;
  const head = systems
    .map(
      (system) =>
        `<th class="n">${esc(system.label)}<br><span class="note">${esc(system.chip ?? "chip not recorded")}${system.cpus === undefined ? "" : `, ${esc(system.cpus)} processors`}<br>build ${esc(system.sha)}, ${esc(system.date)}</span></th>`,
    )
    .join("");
  const cell = (system, key, scale = 1) => {
    const value = system.states["as-is"]?.[key];
    return `<td class="n">${value === undefined ? "-" : micro(value * scale)}</td>`;
  };
  const rows = OPS_ROWS.flatMap(([op, text]) =>
    AT_ONCE.map(
      (at) =>
        `<tr><td>${esc(text)}, ${at === 1 ? "one at a time" : `${at} at once`}</td>${systems.map((system) => cell(system, `${op}/in-flight-${at}`)).join("")}</tr>`,
    ),
  );
  const asOne = (key, text) =>
    `<tr><td>${esc(text)}</td>${systems
      .map((system) => {
        const value = system.states["as-is"]?.[key];
        return `<td class="n">${value === undefined ? "-" : micro(value / files(system))}</td>`;
      })
      .join("")}</tr>`;
  const ratios = systems
    .filter((system) => system !== linux && linux !== undefined)
    .flatMap((system) => againstLinux(system, linux) ?? []);
  const scanned = systems.filter(
    ({ states, notes }) =>
      states.off !== undefined ||
      states.on !== undefined ||
      states.excluded !== undefined ||
      Object.keys(notes["as-is"] ?? {}).some((key) => key.includes("scanner")),
  );
  const scanner = scanned
    .map((system) => {
      const states = [
        ["as-is", "As the runner has it"],
        ["off", "Live checking switched off"],
        ["on", "Live, file and script checking on, no folder left out"],
        ["excluded", "Live, file and script checking on, the folder excluded"],
      ].filter(([state]) => system.states[state] !== undefined);
      const timeOf = (state, key) => {
        const value = system.states[state][key];
        if (value === undefined) return '<td class="n">-</td>';
        const range = microRange(system.ranges?.[state]?.[key]);
        const slow = wideRange(system.ranges?.[state]?.[key])
          ? ", one slow run"
          : "";
        return `<td class="n">${micro(value)}${range === undefined ? "" : `<br><span class="note">range ${range}${slow}</span>`}</td>`;
      };
      const lines = OPS_ROWS.map(
        ([op, text]) =>
          `<tr><td>${esc(text)}, 16 at once</td>${states
            .map(([state]) => timeOf(state, `${op}/in-flight-16`))
            .join("")}</tr>`,
      );
      return `<h3>${esc(system.label)}: what the virus scanner was doing</h3>
<p>${scannerFacts(system).map(esc).join(" ")}</p>
<div class="scroll"><table class="speed">
<thead><tr><th></th>${states.map(([, text]) => `<th class="n">${esc(text)}</th>`).join("")}</tr></thead>
<tbody>
${lines.join("\n")}
</tbody>
</table></div>
<p class="note">Each time is the median of the runs for one file, with the range over the runs under it. Two columns differ only where their ranges do not overlap; this page picks no cause from them. A range marked "one slow run" is so wide that one run was far from the others, so that median is not a figure to quote. The scanner was changed only for these runs and put back after them.</p>`;
    })
    .join("\n");
  return `<section class="chart" id="file-ops">
<h2>What one file costs on each operating system</h2>
<p class="about">An import writes tens of thousands of small files, so what a system charges for one small file matters. Each system below made the same 3,000 small files (280 bytes each) with the same code, and each column is that system's newest measured build. A time is the average cost of one file in microseconds, so a bigger number is slower. "At once" is how many files were being made at the same moment. These numbers are about the system and its disk, not about the runtime's own code. They are measured on the machines GitHub lends the builds, which are not a person's computer: read them as how much dearer a file is on one system than on another. In this measurement every file has the same bytes, where the files of a pod differ in size. The macOS machine is a virtual machine on Apple silicon; Intel Macs are not measured.</p>
<div class="scroll"><table class="speed">
<thead><tr><th>One small file</th>${head}</tr></thead>
<tbody>
${rows.join("\n")}
${asOne("one-file/whole", "All the files' bytes written as ONE file, per file")}
${asOne("one-file/whole-flushed", "The same one file, flushed to the drive first, per file")}
</tbody>
</table></div>
<p class="note">"As one file" is what a pod would pay if it kept its new files together in one file instead of one file each; its time for the whole file is divided by the 3,000 files it holds.</p>
${ratios.length === 0 ? "" : `<p>${ratios.map(esc).join(" ")} ${esc(LINUX_CHIP_NOTE)}</p>`}
${scanner}
</section>`;
}

/**
 * What each size's pod held in the newest build whose file counted it, for the section "What a pod holds": the build and what
 * its rows say, by size, plain before encrypted. Nothing for builds none of whose files count a pod.
 */
export function storedLatest(files, glossary = readGlossary()) {
  const order = Object.keys(glossary.datasets);
  const found = new Map();
  for (const { build, file } of files)
    for (const key of storedKeys(file)) {
      const page = storedOf(file, key, glossary);
      if (page !== undefined) found.set(key, { build, page });
    }
  return [...found.values()].sort(
    (a, b) =>
      order.indexOf(a.page.dataset) - order.indexOf(b.page.dataset) ||
      Number(a.page.encrypted) - Number(b.page.encrypted),
  );
}

/** The section of what the pods the newest builds left hold, one block for each size. */
function storedBlock(stored, repo, glossary) {
  if (stored.length === 0) return "";
  const blocks = stored.map(({ build, page }) =>
    storedHtml(page, {
      heading: `<h3>${esc(storedTitle(page))} <span class="note">Build <a href="https://github.com/${esc(repo)}/commit/${esc(build.sha)}">${esc(build.sha)}</a>, ${esc(build.date)}</span></h3>`,
    }),
  );
  return `<section class="stored" id="stored">
<h2>What a pod holds</h2>
<p class="about">What a fresh import leaves in a new pod once it is closed, counted exactly in the newest build that counted it: how many files, statements and bytes, and how much of it is what the source said against what the pod keeps about it. It is about the pod's shape, not a measure of time.</p>
${blocks.join("\n")}
<p class="note">${esc(glossary.storedRule ?? "")}</p>
</section>`;
}

/**
 * What the jobs of every day took at each size in the newest build whose file measured them, for the section "What people do
 * after the first import": the build and what its rows say, by size, plain before encrypted.
 */
export function jobsLatest(files, glossary = readGlossary()) {
  const order = Object.keys(glossary.datasets);
  const found = new Map();
  for (const { build, file } of files)
    for (const key of jobsKeys(file)) {
      const page = jobsOf(file, key);
      if (page !== undefined) found.set(key, { build, page });
    }
  return [...found.values()].sort(
    (a, b) =>
      order.indexOf(a.page.dataset) - order.indexOf(b.page.dataset) ||
      Number(a.page.encrypted) - Number(b.page.encrypted),
  );
}

/** The section of what the jobs after the first import took, one block for each size. */
function jobsBlock(jobs, repo) {
  if (jobs.length === 0) return "";
  const blocks = jobs.map(({ build, page }) =>
    jobsHtml(page, {
      heading: `<h3>${esc(jobsTitle(page))} <span class="note">Build <a href="https://github.com/${esc(repo)}/commit/${esc(build.sha)}">${esc(build.sha)}</a>, ${esc(build.date)}</span></h3>`,
    }),
  );
  return `<section class="jobs" id="jobs">
<h2>What people do after the first import</h2>
${blocks.join("\n")}
</section>`;
}

/** The page: the charts, how to read them, and the data they draw. */
export function stackedPage(
  charts,
  {
    repo,
    glossary = readGlossary(),
    fileOps = [],
    stored = [],
    jobs = [],
  } = {},
) {
  const repeats = [
    ...new Set(charts.map((chart) => chart.columns.at(-1)?.runs)),
  ].filter((each) => typeof each === "number");
  const runsText =
    repeats.length === 0
      ? "several runs"
      : repeats.length === 1
        ? `${repeats[0]} runs`
        : `${Math.min(...repeats)} to ${Math.max(...repeats)} runs`;
  const titled = charts.map((chart) => ({
    ...chart,
    title: chartTitle(chart, glossary),
  }));
  const data = {
    other: OTHER,
    bands: BANDS,
    charts: titled.map((chart) => ({
      key: chart.key,
      os: chart.os,
      title: chart.title,
      steps: chart.steps.map(({ key, label, says, span, colour }) => ({
        key,
        label,
        says,
        span,
        colour,
      })),
      columns: chart.columns.map((column) => ({
        ...column,
        speed: undefined,
      })),
    })),
  };
  const sections = titled.map((chart, at) => {
    const latest = chart.columns.at(-1);
    const totals = chart.columns.map(({ total }) => total);
    const legend = [
      ...chart.steps.map((step, each) => ({
        colour: step.colour,
        label: step.label,
        says: step.says,
        span: step.span,
        value: latest.bands[each],
      })),
      {
        colour: OTHER,
        label: "Everything else",
        says: "All the steps too small to have a band of their own, with the time no step accounts for.",
        span: undefined,
        value: latest.other,
      },
    ];
    const machine =
      chart.os === "linux" || chart.system === undefined
        ? ""
        : ` Measured on a GitHub-hosted ${SYSTEM_NAME[chart.os]} runner (${esc(chart.system.chip ?? "chip not recorded")}${chart.system.cpus === undefined ? "" : `, ${esc(chart.system.cpus)} processors`}).`;
    return `<section class="chart" id="${esc(chart.id ?? chart.key)}">
<h2>${esc(chart.title)}</h2>
<p class="about">${esc(glossary.scenarios[chart.scenario]?.says ?? "")}${machine} Latest build <a href="https://github.com/${repo}/commit/${latest.sha}">${esc(latest.sha)}</a> (${esc(latest.date)}): <strong>${exact(latest.total)}</strong>; across the ${chart.columns.length} builds shown, ${exact(Math.min(...totals))} to ${exact(Math.max(...totals))}.</p>
${chartSvg(chart, at)}
${speedBlock(chart, repo)}
<ul class="legend">
${legend
  .map(
    (item) =>
      `<li title="${esc([item.says, item.span && `Technical name: ${item.span}`].filter(Boolean).join(" "))}"><span class="swatch" style="background:${item.colour}"></span><span>${esc(item.label)}${item.span === undefined ? "" : ` <code>${esc(item.span)}</code>`}</span><span class="latest">${exact(item.value)}</span></li>`,
  )
  .join("\n")}
</ul>
${chart.columns.some((column) => !column.measured) ? `<p class="note">Faded columns are builds whose file has no step breakdown, made before the files kept one: their whole time is shown as "everything else".</p>` : ""}
</section>`;
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Where the time goes, over time</title>
<style>${STYLE}</style>
</head>
<body>
<nav class="top"><a href="../">Documentation home</a> · <a href="runs/">Each build's flame graphs</a> · <a href="detail/">Every measurement, one small chart each</a></nav>
<h1>Where the time goes, over time</h1>
<p>Each chart follows one thing a person waits for. Every column is one build of the runtime, oldest on the left, so the chart shows whether it got faster or slower. A column's height is how long it took, in seconds; its coloured bands are the steps inside that took the time, so a band that grows is the step that slowed things down. Move over a column to see its numbers; click it to open that build's flame graphs.</p>
<details class="how"><summary>How the bands are worked out</summary>
<p>The column's height is the build's measured time: the median of ${runsText} with nothing watching. Which steps took that time comes from one more run with the probe on, which records how long each step was running by itself, not counting the steps it called. The probe slows some work and some steps run at once, so those own times are only shares: each is scaled so that the bands and "everything else" add up to the measured time. The ${BANDS} steps with the most time across the builds shown get a band each; every other step is in "everything else".</p>
<p>Each band is named by what the step does in plain words; the step's technical name is beside it, and the whole sentence appears when you hold the pointer over it. A step's colour is chosen from a fixed palette by its name, so it is the same in every chart and does not change from one visit to the next; only when two steps charted together would get the same colour does one take the next free one. The sizes: 647 source entries are one synthetic patient's ten years, measured on every build; 16,833 source entries are a whole life, measured nightly, with the same pod encrypted as well. What each step means: <a href="https://github.com/${repo}/blob/main/docs/perf-glossary.md">the glossary</a>.</p>
<p>Under the charts of a new pod, a line sets the import's time against a plain load of the same input into SQLite (not a lower bound), and a table lists what the import handled (source entries, answer-file lines, files, questions put to the fact store, individual facts looked at) and how fast saving wrote the lines and files. Those numbers are the measured ones, with no limit set on any of them.</p></details>
<p>Charts "on Windows" and "on macOS" are the same measurement on those systems' own GitHub-hosted machines, drawn from those builds alone: a time on one system is never plotted in a column of another, because the machines differ in processor, disk and file system, and the times only read against their own system's earlier ones. Those two are measured when a change is merged to main and every night, not on every pull request, so they have fewer columns. What the systems cost per file, and what the virus scanner was set to and doing while it was measured, is under the charts.</p>
<p>Why the two are not measured on every pull request: a pull request is shown only when its slowest check is done. A Windows run took about 6 minutes (11 with the Defender comparison, which only a hand-started run adds) and a macOS run about 3 (November 2026, a hosted runner each), against about 9 minutes for the slowest check, so the Windows run would have become the slowest check of every pull request. They are measured on the main branch and by hand, and a hand-started run of any branch can name them.</p></details>
<p class="toc">${[...titled.map((chart) => `<a href="#${esc(chart.id ?? chart.key)}">${esc(chart.title)}</a><br>`), ...(fileOps.length === 0 ? [] : ['<a href="#file-ops">What one file costs on each operating system</a><br>']), ...(jobs.length === 0 ? [] : ['<a href="#jobs">What people do after the first import</a><br>']), ...(stored.length === 0 ? [] : ['<a href="#stored">What a pod holds</a><br>'])].join("\n")}</p>
${sections.length === 0 ? "<p>No build has been measured yet.</p>" : sections.join("\n")}
${fileOpsSection(fileOps)}
${jobsBlock(jobs, repo)}
${storedBlock(stored, repo, glossary)}
<p class="links"><a href="../">Documentation home</a> · <a href="runs/">Each build's flame graphs</a> · <a href="detail/">Every measurement, one small chart each</a> · <a href="stacked.json">The data of these charts</a></p>
<div id="tip" hidden></div>
<script type="application/json" id="data">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/** The build entries the index of flame graphs has, by id; every build when there is no index to look in. */
export function entriesOf(runs) {
  const index = runs === undefined ? undefined : join(runs, "index.html");
  if (index === undefined || !existsSync(index)) return undefined;
  return new Set(
    [
      ...readFileSync(index, "utf8").matchAll(
        /<details class="build" id="([^"]+)"/g,
      ),
    ].map((found) => found[1]),
  );
}

/**
 * Every build's rows the charts need, oldest first. The files are read newest first, one at a time, and each is cut down to
 * those rows as it is read; a build that no chart needs any more (every chart it measures already has `window` newer builds)
 * is let go. A file that cannot be read is skipped, with a warning, and the rest of the page is drawn.
 */
export function readBuilds(data, glossary, window = WINDOW) {
  const have = new Map();
  const opsFrom = new Set();
  const files = [];
  for (const build of buildsIn(data).reverse()) {
    let file;
    try {
      file = reduced(JSON.parse(readFileSync(build.path, "utf8")), glossary);
    } catch (error) {
      process.stderr.write(
        `warning: ${build.id} is left out of the charts, its file cannot be read: ${error instanceof Error ? error.message : error}\n`,
      );
      continue;
    }
    const said = systemOf(file.env);
    if (said !== undefined && said !== build.os) {
      process.stderr.write(
        `warning: ${build.id} is left out of the charts: its name says ${SYSTEM_NAME[build.os]} and its environment says ${SYSTEM_NAME[said]}, and a series is never of two systems\n`,
      );
      continue;
    }
    const keys = file.results
      .filter((row) => row.name.endsWith("/total"))
      .map((row) => `${build.os}/${row.name.slice(0, -"/total".length)}`);
    // The newest build of each system that measured what one file costs is kept for that table, whatever else it holds.
    const newestOps =
      !opsFrom.has(build.os) &&
      file.results.some((row) => row.name.startsWith("file-ops-"));
    if (newestOps) opsFrom.add(build.os);
    if (newestOps || keys.some((key) => (have.get(key) ?? 0) < window))
      files.push({ build, file });
    for (const key of keys) have.set(key, (have.get(key) ?? 0) + 1);
  }
  return files.reverse();
}

/** Reads the data checkout, writes `index.html` and `stacked.json` into `out`, and returns what it drew. */
export function pages({ data, out, repo, runs, glossary = readGlossary() }) {
  const files = readBuilds(data, glossary);
  const charts = shape(files, { glossary });
  const entries = entriesOf(runs);
  for (const chart of charts)
    for (const column of chart.columns)
      if (entries === undefined || entries.has(column.id))
        column.href = `runs/#${column.id}`;
  mkdirSync(out, { recursive: true });
  const fileOps = fileOpsOf(files);
  const page = stackedPage(charts, {
    repo,
    glossary,
    fileOps,
    stored: storedLatest(files, glossary),
    jobs: jobsLatest(files, glossary),
  });
  writeFileSync(join(out, "index.html"), page);
  writeFileSync(
    join(out, "stacked.json"),
    `${JSON.stringify({ bands: BANDS, window: WINDOW, charts: charts.map(({ key, os, steps, columns }) => ({ key, os, steps, columns })), fileOps }, null, 1)}\n`,
  );
  return charts;
}

function main(args) {
  const [command, ...rest] = args;
  const flag = (name) => {
    const at = rest.indexOf(name);
    return at === -1 ? undefined : rest[at + 1];
  };
  const need = ["--data", "--out", "--repo"];
  if (command !== "pages" || need.some((name) => flag(name) === undefined)) {
    process.stderr.write(
      `usage: perf-stacked.mjs pages ${need.map((name) => `${name} <x>`).join(" ")} [--runs <folder>]\n`,
    );
    process.exitCode = 2;
    return;
  }
  const charts = pages({
    data: flag("--data"),
    out: flag("--out"),
    repo: flag("--repo"),
    runs: flag("--runs"),
  });
  process.stdout.write(
    `${charts.length} charts of ${new Set(charts.flatMap((chart) => chart.columns.map(({ id }) => id))).size} builds under ${flag("--out")}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
