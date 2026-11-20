#!/usr/bin/env node
// Turns one performance file (packages/cascade-runtime/test/perf-report.ts) into the list github-action-benchmark's
// `customSmallerIsBetter` tool reads, `[{name, unit, value, range, extra}]`, for the history page.
//
//   perf-history.mjs <perf.json> [--stages 6] > benchmark.json
//
// A chart per measurement is only readable while there are not hundreds: the page takes every headline time and the peak
// memory, and each probed run's few slowest stages and few steps with the longest own time (those of a probed run say
// where time goes, not what a person waits for; own time is what points at the step to change). Counts stay in the file kept on `perf-data`, not on the page.

import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HEADLINE =
  /\/(total|open|import|first-screen|first-read|second-read|close|peak-rss|parse|flatten|insert)$/;

export function forHistory(file, { stages = 6 } = {}) {
  const keep = file.results.filter((row) => HEADLINE.test(row.name));
  const slowest = new Map();
  for (const kind of ["stage", "self"])
    for (const row of file.results) {
      const at = row.name.indexOf(`/${kind}/`);
      if (at === -1 || row.name.includes(`/${kind}/scenario.`)) continue;
      const group = row.name.slice(0, at) + kind;
      slowest.set(group, [...(slowest.get(group) ?? []), row]);
    }
  for (const rows of slowest.values())
    keep.push(...rows.sort((a, b) => b.value - a.value).slice(0, stages));
  return keep.map(({ name, unit, value, range, extra }) => ({
    name,
    unit,
    value,
    ...(range !== undefined && { range }),
    ...(extra !== undefined && { extra }),
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [path, ...rest] = process.argv.slice(2);
  if (path === undefined) {
    process.stderr.write("usage: perf-history.mjs <perf.json> [--stages 6]\n");
    process.exit(2);
  }
  const at = rest.indexOf("--stages");
  const stages = at === -1 ? 6 : Number(rest[at + 1]);
  process.stdout.write(
    `${JSON.stringify(forHistory(JSON.parse(readFileSync(path, "utf8")), { stages }), null, 2)}\n`,
  );
}
