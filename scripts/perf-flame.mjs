#!/usr/bin/env node
// Reads the folder `npm run perf -- --profiles <folder>` writes (packages/cascade-runtime/test/perf-report.ts): a trace of
// each scenario's probed run (`<scenario>-<size>.trace.json`), a CPU profile of one more run (`<scenario>-<size>.cpuprofile`)
// and `flame.json`, which lists them with the steps whose own time was longest. Says where the time went.
//
//   perf-flame.mjs summary <folder> [--markdown] [--top 5] [--download <artifact url>] [--files <base url>] [--viewer <url>]
//
// `--files` and `--viewer` make each scenario's two links open in the hosted speedscope at once (the files are read from
// `<base url>/<file>`); `--download` says where a pull request's folder can be downloaded, which speedscope cannot open by
// address, for a person to drop the files into the viewer.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { shown } from "./perf-compare.mjs";

/** The hosted viewer's address that opens `fileUrl` as `title`: speedscope reads `#profileURL=<url-encoded>&title=<title>`. */
export function openIn(viewer, fileUrl, title) {
  return `${viewer}#profileURL=${encodeURIComponent(fileUrl)}&title=${encodeURIComponent(title)}`;
}

export function readFlame(folder) {
  const flame = JSON.parse(readFileSync(join(folder, "flame.json"), "utf8"));
  if (!Array.isArray(flame.builds))
    throw new Error(`${folder}/flame.json lists no builds`);
  return flame;
}

/** How a build is named for a person: `fresh-first-screen on synthea-10y`, with `encrypted` when it is. */
export function titleOf(build) {
  return `${build.scenario} on ${build.dataset}${build.encrypted ? ", encrypted" : ""}`;
}

/** A glossary sentence as one cell of a table, or nothing for a step it has none for. */
export const plain = (says) => (says ?? "").replaceAll("|", "/");

/** What a trace file does not draw, and why its time is still counted: calls merged, and calls left out for being short. */
export function drawnNotes(trace) {
  const merged = trace.merged ?? 0;
  const left = trace.calls - trace.drawn - merged;
  return [
    ...(merged > 0
      ? [
          `${merged.toLocaleString("en-US")} calls ran at once, more than a track holds side by side; they are drawn merged, ${(trace.mergedEvents ?? 0).toLocaleString("en-US")} bars labelled "<step> × N at once", so their time is in the picture.`,
        ]
      : []),
    ...(left > 0
      ? [
          `${left.toLocaleString("en-US")} of the shortest calls are not drawn; their time is their parent's own.`,
        ]
      : []),
  ];
}

/**
 * The text that says where each scenario's time went: its `top` steps by own time (the time a step was running with none of
 * the steps inside it running), and the links to its trace and CPU profile.
 */
export function summary(
  flame,
  { markdown = false, top = 5, download, files, viewer } = {},
) {
  const out = [];
  const bold = (text) => (markdown ? `**${text}**` : text.toUpperCase());
  out.push(
    bold("Where the time went"),
    "",
    `One probed run of each scenario, the ${top} steps with the longest own time (the time a step was running with none of the steps inside it running; the largest are the places to look first).`,
    "",
  );
  for (const build of flame.builds) {
    const links = [];
    const link = (label, file) => {
      if (files !== undefined && viewer !== undefined)
        links.push(
          markdown
            ? `[${label}](${openIn(viewer, `${files}/${file}`, `${label}: ${titleOf(build)}`)})`
            : `${label}: ${file}`,
        );
      else links.push(`${label}: ${markdown ? "`" + file + "`" : file}`);
    };
    link("Where the time went", build.trace.file);
    if (build.cpu !== undefined) link("Which code took it", build.cpu.file);
    out.push(
      markdown
        ? `**${titleOf(build)}** · ${links.join(" · ")}`
        : `${titleOf(build)}: ${links.join("; ")}`,
      "",
    );
    if (build.cpu?.processOf !== undefined)
      out.push(
        `${markdown ? "_" : ""}The CPU profile is of the whole fresh run; the close is its last step.${markdown ? "_" : ""}`,
        "",
      );
    for (const note of drawnNotes(build.trace))
      out.push(`${markdown ? "_" : ""}${note}${markdown ? "_" : ""}`, "");
    const rows = build.trace.top.slice(0, top);
    if (markdown)
      out.push(
        "| step | what it is | own time | calls |",
        "|---|---|---:|---:|",
        ...rows.map(
          (row) =>
            `| \`${row.name}\` | ${plain(row.says)} | ${shown(row.selfMs / 1000, "s")} | ${row.calls.toLocaleString("en-US")} |`,
        ),
        "",
      );
    else
      out.push(
        ...rows.map(
          (row) =>
            `  ${shown(row.selfMs / 1000, "s").padStart(8)}  ${row.name} (${row.calls} calls)${row.says === undefined ? "" : `: ${row.says}`}`,
        ),
        "",
      );
    const queries = (build.trace.bridgeQueries ?? []).slice(0, top);
    if (queries.length > 0) {
      out.push(
        `${markdown ? "_" : ""}Time per Bridge query, positions unknown: the Bridge says how long each took in all and not when, so the trace does not draw them, and a Bridge stage's own time includes the queries it ran.${markdown ? "_" : ""}`,
        "",
      );
      if (markdown)
        out.push(
          "| Bridge query | what it is | time | runs |",
          "|---|---|---:|---:|",
          ...queries.map(
            (row) =>
              `| \`${row.name}\` | ${plain(row.says)} | ${shown(row.ms / 1000, "s")} | ${row.calls.toLocaleString("en-US")} |`,
          ),
          "",
        );
      else
        out.push(
          ...queries.map(
            (row) =>
              `  ${shown(row.ms / 1000, "s").padStart(8)}  ${row.name} (${row.calls} runs)`,
          ),
          "",
        );
    }
  }
  if (download !== undefined && viewer !== undefined)
    out.push(
      markdown
        ? `To open them: [download the flame graph files](${download}), unzip, and drop a \`.trace.json\` (where the time went) or a \`.cpuprofile\` (which code took it) into [speedscope](${viewer}).`
        : `To open them: download ${download}, unzip, and drop a file into ${viewer}.`,
    );
  return out.join("\n");
}

function main(args) {
  const [command, folder, ...rest] = args;
  const flag = (name) => {
    const at = rest.indexOf(name);
    return at === -1 ? undefined : rest[at + 1];
  };
  if (command === "summary" && folder !== undefined) {
    const top = flag("--top");
    process.stdout.write(
      `${summary(readFlame(folder), {
        markdown: rest.includes("--markdown"),
        ...(top !== undefined && { top: Number(top) }),
        download: flag("--download"),
        files: flag("--files"),
        viewer: flag("--viewer"),
      })}\n`,
    );
    return;
  }
  process.stderr.write(
    "usage: perf-flame.mjs summary <folder> [--markdown] [--top 5] [--download <url>] [--files <base url>] [--viewer <url>]\n",
  );
  process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
