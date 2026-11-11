import assert from "node:assert/strict";
import { hubFiles } from "../src/front-page.js";
import type { Suite, SuiteRun, TestRun } from "../src/hub/context.js";
import { testsSection } from "../src/hub/tests.js";
import { buildTree } from "../src/sections.js";
import { readPage } from "./page.js";
import { described, FILE, leafOf, packageProperty, report } from "./report.js";

export const R = "cascade-runtime-js";
export const V = "cascade-vocabulary";
export const PATH = `conformance/tests/${R}/index.html`;
export const pageOf = (name: string): string =>
  `conformance/tests/${name}/index.html`;
export const ctrfPath = (name: string): string =>
  `conformance/tests/${name}/${name}.ctrf.json`;

export const suite = (
  repository: string,
  runner: Suite["runner"],
  title = `The tests of ${repository}`,
): Suite => ({
  repository,
  title,
  about: `${runner} over ${repository}`,
  workflow: "check.yml",
  artifact: "unit-tests",
  report: "junit.xml",
  runner,
});
export const RUNTIME = suite(
  `jayostis/${R}`,
  "node:test",
  "The runtime's tests",
);
export const VOCABULARY = suite(
  `jayostis/${V}`,
  "pytest",
  "The vocabulary's tests",
);

/** An adapter's fixture cases: no test runner ran them, and cascade-bridge-spec's start action wrote their CTRF. */
export const CTRF_SUITE: Suite = {
  ...suite(
    "jayostis/cascade-bridge-adapter-fhir-r4",
    "ctrf",
    "The FHIR R4 adapter's fixture cases",
  ),
  report: "report.ctrf.json",
  tests: "fixtures/",
};
export const CTRF_NAME = "cascade-bridge-adapter-fhir-r4";
const LEVELS = ["synthetic adapter fixture cases", "with engine on native"];
export const CTRF_REPORT = JSON.stringify({
  reportFormat: "CTRF",
  specVersion: "0.2.0",
  results: {
    tool: { name: "cascade-bridge-spec compatibility" },
    summary: {
      tests: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      pending: 0,
      other: 0,
    },
    tests: [
      {
        name: "example-0003",
        status: "passed",
        duration: 0,
        suite: LEVELS,
        filePath: "fixtures/manifest.ttl",
        line: 42,
        extra: {
          description: "A document that fails its schema.",
          outcome: "passed",
          type: "Isomorphic conversion test",
          levels: [
            { name: LEVELS[0], description: "10 cases of an adapter." },
            { name: LEVELS[1] },
          ],
        },
      },
      {
        name: "example-0001",
        status: "failed",
        duration: 0,
        suite: LEVELS,
        filePath: "fixtures/manifest.ttl",
        line: 31,
        message: "example-0001 is reported failed",
        extra: { outcome: "failed" },
      },
    ],
  },
});

export const RUN = {
  commit: "0123456789abcdef0123456789abcdef01234567",
  at: "2026-11-04T22:12:35Z",
  url: "https://github.com/jayostis/cascade-runtime-js/actions/runs/42",
};
export const OTHER_RUN = {
  commit: "fedcba9876543210fedcba9876543210fedcba98",
  at: "2026-11-03T03:17:00Z",
  url: "https://github.com/jayostis/cascade-vocabulary/actions/runs/41",
};

/**
 * The pages of the runtime's suite, the vocabulary's and any others given, each with its newest run where one is given,
 * read as one text in that order.
 */
export async function pageWith(
  reports: { readonly runtime?: TestRun; readonly vocabulary?: TestRun },
  others: readonly SuiteRun[] = [],
  runtime: Suite = RUNTIME,
) {
  const runs: SuiteRun[] = [
    { suite: runtime, ...(reports.runtime ? { run: reports.runtime } : {}) },
    {
      suite: VOCABULARY,
      ...(reports.vocabulary ? { run: reports.vocabulary } : {}),
    },
    ...others,
  ];
  const { tree } = await buildTree({
    sections: [testsSection],
    ctx: { tests: async () => runs },
    front: (rows) => hubFiles(["Records"], rows),
  });
  const markup = runs
    .map(({ suite: { repository } }) => {
      const path = pageOf(repository.split("/")[1] ?? "");
      const bytes = tree.get(path);
      assert.ok(bytes, `${path} is written`);
      return new TextDecoder().decode(bytes);
    })
    .join("\n");
  return { markup, page: readPage(markup, PATH), tree };
}

export function text(markup: string): string {
  return markup
    .replaceAll("<wbr>", "")
    .replace(/<span class="icon" aria-hidden="true">[^<]*<\/span>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#34;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .trim();
}

/** The page of the suite whose part has that id, from the part to the page's end. */
export function partOf(markup: string, heading: string): string {
  return (markup.split(`id="${heading}"`)[1] ?? "").split("<!DOCTYPE")[0] ?? "";
}

/** What the first failed case after the heading said. */
export const failureOf = (markup: string, heading: string): string =>
  text(
    /<pre class="failure">([\s\S]*?)<\/pre>/.exec(
      markup.split(`id="${heading}"`)[1] ?? "",
    )?.[1] ?? "",
  );

/** What each skipped case after the heading said of why, in the page's order. */
export const skipReasonsOf = (markup: string, heading: string): string[] =>
  [
    ...(markup.split(`id="${heading}"`)[1] ?? "").matchAll(
      /<p class="skip-reason">([\s\S]*?)<\/p>/g,
    ),
  ].map(([, said]) => text(said ?? ""));

/** The levels (package, file, describe) after the heading, as the text of each summary, in the page's order. */
export function levelsOf(markup: string, heading: string): string[] {
  const part = partOf(markup, heading);
  return [...part.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map(([, said]) =>
    text(said ?? "").replace(/(passed|failed) (?=\d)/g, "$1, "),
  );
}

/** The packages of the suite whose part has that id, in the order the page shows them. */
export const packagesOf = (markup: string, heading: string): string[] =>
  [
    ...partOf(markup, heading).matchAll(
      /<h3 class="package"><code>([^<]*)<\/code>/g,
    ),
  ].map(([, name]) => name ?? "");

/** The cases of the tree after the heading, as their name, result and time, in the page's order. */
export function casesOf(markup: string, heading: string): string[][] {
  const part = partOf(markup, heading);
  return [...part.matchAll(/<li class="case"[^>]*>([\s\S]*?)<\/li>/g)].map(
    ([, item]) => {
      const leaf = (item ?? "").replace(/<pre[\s\S]*?<\/pre>/g, "");
      const pick = (pattern: RegExp) => text(pattern.exec(leaf)?.[1] ?? "");
      return [
        pick(/<a [^>]*>([\s\S]*?)<\/a>/),
        pick(/<span class="label">([\s\S]*?)<\/span>/),
        pick(/<span class="time">([\s\S]*?)<\/span>/),
      ];
    },
  );
}

/** A suite's summary bar, as its tallies and the text around them. */
export function barOf(markup: string, heading: string) {
  const bar = /<div class="summary-bar"[\s\S]*?<\/div>/.exec(
    partOf(markup, heading),
  )?.[0];
  assert.ok(bar, `${heading} has a summary bar`);
  const tallies = Object.fromEntries(
    [...bar.matchAll(/data-status="(\w+)" data-count="(\d+)"/g)].map(
      ([, status, n]) => [status, Number(n)],
    ),
  );
  return { bar, tallies, said: text(bar) };
}

/** How many links in the markup point at the glossary entry of `anchor` in the runtime's glossary. */
export const hrefsTo = (markup: string, anchor: string): number =>
  markup.split(`href="#glossary-cascade-runtime-${anchor}"`).length - 1;

/** The CTRF file written for the suite named `name`, as JSON. */
export function ctrfOf(tree: ReadonlyMap<string, Uint8Array>, name = R) {
  const bytes = tree.get(ctrfPath(name));
  assert.ok(bytes, `${ctrfPath(name)} is written`);
  return JSON.parse(new TextDecoder().decode(bytes)) as {
    results: {
      summary: Record<string, number>;
      tests: {
        name: string;
        suite?: string[];
        status: string;
        duration: number;
        message?: string;
        extra?: { description?: string; levels?: unknown[] };
      }[];
    };
    extra?: { glossary?: Record<string, unknown[]> };
  };
}

export const pod = FILE("cascade-runtime", "pod.test");
export const terms = FILE("cascade-runtime", "terms.test");
const packaging = FILE("cascade-runtime", "pack.test");

/** A report of one package at `version` holding one case. */
export const versioned = (version: string): string =>
  report(
    packageProperty("cascade-runtime", "cascade-runtime", version, {}),
    described("A", {}, leafOf("b", pod, 2)),
  );

/**
 * Capabilities in several files, listed in an order that is neither alphabetical nor the report's; `packingFailure` is why the
 * one case of the build capability failed, when it did.
 */
export const groupedWith = (packingFailure?: string): string =>
  report(
    packageProperty("cascade-runtime", "cascade-runtime", "0.0.0", {
      about: "The library an app calls.",
      capabilities: ["Looking up a term", "Importing a health export"],
      build: ["Packing"],
    }),
    [
      described(
        "Importing a health export",
        {
          description: "Reads an export into the pod.\n\nThe pod keeps it.",
          rules: ["pod-import R19"],
          line: 4,
        },
        described(
          "when nobody has claimed the patient",
          { description: "A patient nobody claimed.", line: 9 },
          leafOf("keeps the records unclaimed", pod, 12, {
            description: "Nothing is dropped.",
          }),
        ),
      ),
      described(
        "Packing",
        { description: "What npm ships.", line: 3 },
        leafOf(
          "lists the entry points",
          packaging,
          5,
          packingFailure === undefined ? {} : { failure: packingFailure },
        ),
      ),
      described("Zebra capability", { line: 2 }, leafOf("stripes", terms, 4)),
      described(
        "Looking up a term",
        { description: "Finds a term by its name.", line: 3 },
        leafOf("finds one", terms, 6),
      ),
      described(
        "Importing a health export",
        { line: 30 },
        leafOf(
          "reads a second file",
          FILE("cascade-runtime", "pod-more.test"),
          33,
        ),
      ),
      described(
        "Apple capability",
        { line: 2 },
        leafOf("is alphabetical", terms, 20),
      ),
    ].join(""),
  );

export const GROUPED = groupedWith();

/** A describe holding a passing test written before a failing one, each with the line node's reporter was given for it. */
export const DESCRIBED = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testsuite name="a pod" time="0.004" disabled="0" errors="0" tests="2" failures="1" skipped="0" hostname="x">
		<testcase name="accepts a record" time="0.002000" classname="test" file="/home/runner/work/cascade-runtime-js/cascade-runtime-js/packages/cascade-runtime/dist/test/pod.test.js" line="10"/>
		<testcase name="rejects a gap" time="0.500000" classname="test" file="/home/runner/work/cascade-runtime-js/cascade-runtime-js/packages/cascade-runtime/dist/test/pod.test.js" line="20" failure="boom">
			<failure type="testCodeFailure" message="boom">
Error [ERR_TEST_FAILURE]: boom
			</failure>
		</testcase>
	</testsuite>
	<!-- tests 2 -->
	<!-- fail 1 -->
</testsuites>
`;

export const GLOSSARY = [
  {
    term: "claim",
    definition: "A patient's say-so that a record is theirs.",
    vocabulary: "https://ns.cascadeprotocol.org/cascade#Claim",
    aliases: ["claims", "claimed"],
  },
  { term: "pod", definition: "The person's own store." },
  {
    term: "export",
    definition: "A file from a hospital.",
    vocabulary: "https://example.org/vocab#Export",
  },
];

export const WITH_GLOSSARY = report(
  packageProperty("cascade-runtime", "cascade-runtime", "0.0.0", {
    about: "The library an app calls.",
    capabilities: ["Importing", "Asking"],
    glossary: GLOSSARY,
  }),
  [
    described(
      "Importing",
      {
        description:
          "A claim is kept in the pod. Claims stay; the claim `claim` and disclaimed things are not links.",
        line: 3,
      },
      described(
        "when the Pod holds claims",
        { description: "The pod again.", line: 8 },
        leafOf("keeps what was claimed", pod, 12),
      ),
    ) +
      described(
        "Asking",
        { description: "Asks a claim of the pod.", line: 20 },
        leafOf("returns the export", pod, 22),
      ),
  ].join(""),
);

/** One passed case in each of four packages, in the order a report lists them; `failing` names one whose case failed. */
export const FOUR_PACKAGES = (failing?: string): string =>
  report(
    ["apple-health", "cascade-runtime", "site", "runtime"]
      .map((dir) => packageProperty(dir, dir, "0.0.0", {}))
      .join(""),
    ["apple-health", "cascade-runtime", "site", "runtime"]
      .map((dir) =>
        described(
          `A capability of ${dir}`,
          {},
          leafOf(
            "does it",
            FILE(dir, "a.test"),
            3,
            dir === failing ? { failure: "broke" } : {},
          ),
        ),
      )
      .join(""),
  );

/**
 * An adapter's CTRF report as cascade-bridge-spec's start action writes it: the run is timed and its cases
 * are not: each case `duration` 0, `results.extra.caseDurations` "unmeasured", `summary.start` and `stop` the run.
 */
export const unmeasuredCtrf = (
  start?: number,
  stop?: number,
  marked = true,
): string => {
  const report = JSON.parse(CTRF_REPORT) as {
    results: { summary: object; extra?: object };
  };
  report.results.summary = {
    ...report.results.summary,
    ...(start === undefined || stop === undefined
      ? {}
      : { start, stop, duration: stop - start }),
  };
  if (marked) report.results.extra = { caseDurations: "unmeasured" };
  return JSON.stringify(report);
};
