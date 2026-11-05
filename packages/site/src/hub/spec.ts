import { markup } from "../html.js";
import type { Section } from "../sections.js";
import { STYLESHEET_FILE } from "../site.js";
import {
  type FeatureResult,
  ranWithList,
  resultsTable,
  specPages,
} from "../spec.js";
import type { PagesContext } from "./context.js";

export const SPEC_FOLDER = "spec/";
export const CONFORMANCE_FOLDER = "conformance/";
const EARL_FILE = "earl.ttl";
const TABLE_FILE = "table.md";
const RESULTS_FILE = "results.json";

/** What the section reads of the context. */
export type SpecContext = Pick<PagesContext, "vocabulary" | "report">;

const encoder = new TextEncoder();

const total = (
  listed: readonly FeatureResult[],
  which: "passed" | "failed" | "notRun",
): number => listed.reduce((sum, result) => sum + result[which], 0);

/**
 * The rules of the vocabulary's `runtime/` features beside their notes and results under `spec/`, and under
 * `conformance/` the same results by feature with the run's own files: the EARL report, its table, and a JSON copy of
 * the results by feature for a tool. Without a report every result reads "not run", and nothing of the run is linked.
 */
export const specSection: Section<SpecContext> = {
  path: `${SPEC_FOLDER}index.html`,
  title: "The runtime's rules and their results",
  kind: "explore",
  source:
    "cascade-vocabulary's features and decision notes, and the latest conformance run on main",
  async build(ctx) {
    const { files: vocabulary, builtFrom, at } = await ctx.vocabulary();
    const { report, earl, table } = await ctx.report();
    const pages = await specPages({ vocabulary, report, builtFrom, at });
    const files = new Map<string, Uint8Array>();
    for (const [path, bytes] of pages.files)
      files.set(`${SPEC_FOLDER}${path}`, bytes);

    const features = pages.features.map((result) => ({
      ...result,
      page: `${SPEC_FOLDER}${result.page}`,
    }));
    const ran = total(features, "passed") + total(features, "failed") > 0;
    files.set(
      `${CONFORMANCE_FOLDER}${RESULTS_FILE}`,
      encoder.encode(
        `${JSON.stringify(
          {
            at,
            vocabulary: vocabulary.iri,
            ran,
            ranWith: report.ranWith,
            passed: total(features, "passed"),
            failed: total(features, "failed"),
            notRun: total(features, "notRun"),
            features,
          },
          null,
          2,
        )}\n`,
      ),
    );
    if (earl !== undefined)
      files.set(`${CONFORMANCE_FOLDER}${EARL_FILE}`, earl);
    if (table !== undefined)
      files.set(`${CONFORMANCE_FOLDER}${TABLE_FILE}`, table);

    const spec = `../${SPEC_FOLDER}`;
    const listed = (kit: boolean) =>
      resultsTable(
        pages.features.filter((result) => result.kit === kit),
        spec,
      );
    files.set(
      `${CONFORMANCE_FOLDER}index.html`,
      encoder.encode(
        markup`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cascade runtime conformance results</title>
<link rel="stylesheet" href="../${STYLESHEET_FILE}">
</head>
<body>
<main>
<h1>Cascade runtime conformance results</h1>
<p class="prose">The reference runtime's latest result on <code>main</code> for every example of cascade-vocabulary's
features and conformance kits. Each feature links to its page among <a href="${spec}index.html">the rules</a>, which
shows every example with its result.</p>
${
  ran
    ? markup`<p class="prose">${total(features, "passed")} pass, ${total(features, "failed")} fail, ${total(features, "notRun")} not run.</p>`
    : markup`<p class="prose">No result of a conformance report joins an example in this build, so every example shows as not run.</p>`
}
<h2 class="part">The features</h2>
${listed(false)}
<h2 class="part">The kits</h2>
${listed(true)}
<h2 class="part">The run's files</h2>
<ul>
${earl === undefined ? "" : markup`<li><a href="${EARL_FILE}">${EARL_FILE}</a>: the EARL report the run wrote.</li>\n`}${table === undefined ? "" : markup`<li><a href="${TABLE_FILE}">${TABLE_FILE}</a>: its results as a table.</li>\n`}<li><a href="${RESULTS_FILE}">${RESULTS_FILE}</a>: the results by feature, for a tool.</li>
<li><a href="tests/index.html">tests/</a>: the runtime's and the vocabulary's unit tests, case by case.</li>
</ul>
</main>
<footer>
<p class="about">Built at <time datetime="${at}">${at}</time> from:</p>
<ul class="about">
${builtFrom.map(({ name, version, href }) => markup`<li><a href="${href}">${name} ${version}</a></li>\n`)}</ul>
${ranWithList("The results are of the run with:", report.ranWith)}</footer>
</body>
</html>
`.text,
      ),
    );
    return files;
  },
  async rows() {
    return [
      {
        href: `${SPEC_FOLDER}index.html`,
        label: "The runtime's rules",
        about:
          "every rule beside the note that ruled it, its examples and their latest result.",
      },
      {
        href: `${CONFORMANCE_FOLDER}index.html`,
        label: "Conformance results",
        about:
          "the reference runtime's pass and fail for each feature, from the latest run on main.",
      },
    ];
  },
};
