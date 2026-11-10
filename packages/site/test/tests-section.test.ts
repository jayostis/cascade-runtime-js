import assert from "node:assert/strict";
import { test } from "node:test";
import { hubFiles } from "../src/front-page.js";
import type { TestReports } from "../src/hub/context.js";
import { readJunit } from "../src/junit.js";
import { testsSection } from "../src/hub/tests.js";
import { buildTree } from "../src/sections.js";
import { readPage } from "./page.js";

const PATH = "conformance/tests/index.html";

/** What node:test's junit reporter writes: a file's cases at the top, a describe nested, `>` bare, `"` escaped twice. */
const NODE = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testcase name="passes" time="0.003259" classname="test" file="/home/runner/work/cascade-runtime-js/cascade-runtime-js/packages/site/dist/test/links.test.js"/>
	<testcase name="fails <a> &amp;quot;q&amp;quot; &amp; so on" time="1.500000" classname="test" file="/home/runner/work/cascade-runtime-js/cascade-runtime-js/packages/site/dist/test/links.test.js" failure="1 == 2 and 3 > 2">
		<failure type="testCodeFailure" message="1 == 2 and 3 > 2">
[Error [ERR_TEST_FAILURE]: 1 == 2] {
  at TestContext.&lt;anonymous> (file:///home/runner/links.test.js:4:40)
}
		</failure>
	</testcase>
	<testcase name="skipped" time="0.000151" classname="test" file="/home/runner/work/cascade-runtime-js/cascade-runtime-js/packages/runtime/dist/test/other.test.js">
		<skipped type="skipped" message="later"/>
	</testcase>
	<testsuite name="outer" time="0.001134" disabled="0" errors="0" tests="2" failures="0" skipped="0" hostname="x">
		<testsuite name="inner" time="0.000697" disabled="0" errors="0" tests="1" failures="0" skipped="0" hostname="x">
			<testcase name="deep pass" time="0.000230" classname="test" file="/home/runner/work/cascade-runtime-js/cascade-runtime-js/packages/runtime/dist/test/other.test.js"/>
		</testsuite>
	</testsuite>
	<!-- tests 4 -->
	<!-- fail 1 -->
</testsuites>
`;

/** What pytest writes: one wrapper suite, a module as each case's classname, a failure with a long message. */
const PYTEST = `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="1" skipped="1" tests="3" time="392.878" timestamp="2026-11-04T22:12:49.141566+00:00" hostname="runnervm7aw5e"><testcase classname="tests.test_naming" name="test_a_name[record-from-server]@test_naming" time="0.012" /><testcase classname="tests.test_queries" name="test_gone" time="0.200"><failure message="assert 1 == 2&#10; +  where 1 = f()">def test_gone():
&gt;       assert 1 == 2
E       assert 1 == 2</failure></testcase><testcase classname="tests.test_queries" name="test_later" time="0.000"><skipped type="pytest.skip" message="later" /></testcase></testsuite></testsuites>`;

const RUN = {
  commit: "0123456789abcdef0123456789abcdef01234567",
  at: "2026-11-04T22:12:35Z",
  url: "https://github.com/jayostis/cascade-runtime-js/actions/runs/42",
};
const OTHER_RUN = {
  commit: "fedcba9876543210fedcba9876543210fedcba98",
  at: "2026-11-03T03:17:00Z",
  url: "https://github.com/jayostis/cascade-vocabulary/actions/runs/41",
};

async function pageWith(reports: TestReports) {
  const { tree } = await buildTree({
    sections: [testsSection],
    ctx: { tests: async () => reports },
    front: (rows) => hubFiles(["Records"], rows),
  });
  const bytes = tree.get(PATH);
  assert.ok(bytes, `${PATH} is written`);
  const markup = new TextDecoder().decode(bytes);
  return { markup, page: readPage(markup, PATH), tree };
}

/** The rows of the table after the heading, as the text of each cell. */
function rowsOf(markup: string, heading: string): string[][] {
  const part = markup.split(`id="${heading}"`)[1] ?? "";
  const table = /<tbody>([\s\S]*?)<\/tbody>/.exec(part)?.[1] ?? "";
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...(row ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) =>
      text((cell ?? "").replace(/<pre[\s\S]*?<\/pre>/g, "")),
    ),
  );
}

function text(markup: string): string {
  return markup
    .replaceAll("<wbr>", "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#34;", '"')
    .replaceAll("&amp;", "&")
    .trim();
}

/** What the first failed case after the heading said. */
const failureOf = (markup: string, heading: string): string =>
  text(
    /<pre class="failure">([\s\S]*?)<\/pre>/.exec(
      markup.split(`id="${heading}"`)[1] ?? "",
    )?.[1] ?? "",
  );

/**
 * node 24.16 `--test-reporter=junit` on a describe whose `after` hook throws and a test with a subtest that throws after it:
 * both parents say failures="0" and hold only their passing children, and only the `fail` comment records the failure.
 * Generated, not written; only the hostname and the file's folder were replaced.
 */
const NODE_UNLISTED = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testsuite name="hook fails" time="0.002419" disabled="0" errors="0" tests="1" failures="0" skipped="0" hostname="x">
		<testcase name="child ok" time="0.000745" classname="test" file="/home/runner/work/cascade-runtime-js/cascade-runtime-js/packages/site/dist/test/repro.test.js"/>
	</testsuite>
	<testsuite name="p" time="0.001751" disabled="0" errors="0" tests="1" failures="0" skipped="0" hostname="x">
		<testcase name="kid" time="0.000178" classname="test" file="/home/runner/work/cascade-runtime-js/cascade-runtime-js/packages/site/dist/test/repro.test.js"/>
	</testsuite>
	<testcase name="plain ok" time="0.000183" classname="test" file="/home/runner/work/cascade-runtime-js/cascade-runtime-js/packages/site/dist/test/repro.test.js"/>
	<!-- tests 4 -->
	<!-- suites 1 -->
	<!-- pass 3 -->
	<!-- fail 1 -->
	<!-- cancelled 0 -->
	<!-- skipped 0 -->
	<!-- todo 0 -->
	<!-- duration_ms 131.8153 -->
</testsuites>
`;

/**
 * node 24.16 `--test-reporter=junit` on a test whose subtest throws, a describe with a throwing `it`, and a plain throwing
 * test: three failed cases are listed, and node's `fail` is 4 because it counts the parent test `p` too. Generated; only the
 * hostname, the file's folder and the stack frames were replaced.
 */
const NODE_ORDINARY_FAILURES = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testsuite name="p" time="0.002378" disabled="0" errors="0" tests="1" failures="1" skipped="0" hostname="x">
		<testcase name="kid" time="0.001062" classname="test" file="/home/runner/work/cascade-runtime-js/cascade-runtime-js/packages/site/dist/test/repro.test.js" failure="kid broke">
			<failure type="testCodeFailure" message="kid broke">
Error [ERR_TEST_FAILURE]: kid broke
  code: 'ERR_TEST_FAILURE',
  failureType: 'testCodeFailure',
  cause: Error: kid broke
			</failure>
		</testcase>
	</testsuite>
	<testsuite name="d" time="0.000567" disabled="0" errors="0" tests="1" failures="1" skipped="0" hostname="x">
		<testcase name="bad" time="0.000213" classname="test" file="/home/runner/work/cascade-runtime-js/cascade-runtime-js/packages/site/dist/test/repro.test.js" failure="bad broke">
			<failure type="testCodeFailure" message="bad broke">
Error [ERR_TEST_FAILURE]: bad broke
  code: 'ERR_TEST_FAILURE',
  failureType: 'testCodeFailure',
  cause: Error: bad broke
			</failure>
		</testcase>
	</testsuite>
	<testcase name="plain" time="0.000237" classname="test" file="/home/runner/work/cascade-runtime-js/cascade-runtime-js/packages/site/dist/test/repro.test.js" failure="plain broke">
		<failure type="testCodeFailure" message="plain broke">
[Error [ERR_TEST_FAILURE]: plain broke] {
  code: 'ERR_TEST_FAILURE',
  failureType: 'testCodeFailure',
  cause: Error: plain broke
}
		</failure>
	</testcase>
	<!-- tests 4 -->
	<!-- suites 1 -->
	<!-- pass 0 -->
	<!-- fail 4 -->
	<!-- cancelled 0 -->
	<!-- skipped 0 -->
	<!-- todo 0 -->
	<!-- duration_ms 181.6421 -->
</testsuites>
`;

test("a node report whose count is the failed cases plus the tests holding them gives no alarm", async () => {
  const { page } = await pageWith({
    runtime: { report: NODE_ORDINARY_FAILURES, ...RUN },
  });
  assert.match(page.said, /3 cases: 0 passed, 3 failed, 0 skipped/);
  assert.doesNotMatch(page.said, /node counts|Failed outside/);
});

test("a run whose node report counts more failures than it lists says so beside the count, with the run linked", async () => {
  const { markup, page } = await pageWith({
    runtime: { report: NODE_UNLISTED, ...RUN },
  });
  assert.match(page.said, /3 cases: 3 passed, 0 failed, 0 skipped/);
  assert.match(
    page.said,
    /node counts 1 failure but the report lists 0 failed cases/,
  );
  const part = markup.split('id="runtime"')[1] ?? "";
  assert.ok(
    part.includes(`<a href="${RUN.url}">`),
    "the run is linked in the runtime's part",
  );
  const honest = await pageWith({ runtime: { report: NODE, ...RUN } });
  assert.doesNotMatch(honest.page.said, /node counts/);
});

/** The part of the page under the heading, up to the next one. */
function partOf(markup: string, heading: string): string {
  return (markup.split(`id="${heading}"`)[1] ?? "").split("<h2")[0] ?? "";
}

/** The levels (package, file, describe) after the heading, as the text of each summary, in the page's order. */
function levelsOf(markup: string, heading: string): string[] {
  const part = partOf(markup, heading);
  return [...part.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map(([, said]) =>
    text(said ?? ""),
  );
}

/** The cases of the tree after the heading, as their name, result and time, in the page's order. */
function casesOf(markup: string, heading: string): string[][] {
  const part = partOf(markup, heading);
  return [...part.matchAll(/<li class="case">([\s\S]*?)<\/li>/g)].map(
    ([, item]) => {
      const leaf = (item ?? "").replace(/<pre[\s\S]*?<\/pre>/g, "");
      const pick = (pattern: RegExp) => text(pattern.exec(leaf)?.[1] ?? "");
      return [
        pick(/<a [^>]*>([\s\S]*?)<\/a>/),
        pick(/<span class="result [^"]*">([\s\S]*?)<\/span>/),
        pick(/<span class="time">([\s\S]*?)<\/span>/),
      ];
    },
  );
}

test("each suite's newest run shows its cases with result and time, the runtime's as a tree of package, capability and situation, a failed case reading failed, and the run's commit, date and link", async () => {
  const { markup, page } = await pageWith({
    runtime: { report: NODE, ...RUN },
    vocabulary: { report: PYTEST, ...OTHER_RUN },
  });

  assert.deepEqual(levelsOf(markup, "runtime"), [
    // the failing package first; a case with no describe is a capability named for its file
    "links.test.ts 1 passed, 1 failed",
    "other.test.ts 0 passed, 1 skipped",
    "outer 1 passed",
    "inner 1 passed",
  ]);
  assert.deepEqual(casesOf(markup, "runtime"), [
    ['fails <a> "q" & so on', "failed", "1.50 s"],
    ["passes", "passed", "3 ms"],
    ["skipped", "skipped", "0 ms"],
    ["deep pass", "passed", "0 ms"],
  ]);
  assert.doesNotMatch(partOf(markup, "runtime"), /<table/);
  assert.equal(failureOf(markup, "runtime"), "1 == 2 and 3 > 2");

  const vocabulary = rowsOf(markup, "vocabulary");
  assert.deepEqual(
    vocabulary.map(([suite, name, result]) => [suite, name, result]),
    [
      ["tests.test_queries", "test_gone", "failed"],
      ["tests.test_naming", "test_a_name[record-from-server]", "passed"],
      ["tests.test_queries", "test_later", "skipped"],
    ],
  );
  assert.equal(
    failureOf(markup, "vocabulary"),
    "assert 1 == 2 + where 1 = f()",
  );

  assert.match(page.said, /4 cases: 2 passed, 1 failed, 1 skipped/);
  assert.match(page.said, /3 cases: 1 passed, 1 failed, 1 skipped/);
  assert.ok(page.hrefs.includes(RUN.url));
  assert.ok(page.hrefs.includes(OTHER_RUN.url));
  assert.ok(
    page.hrefs.includes(
      `https://github.com/jayostis/cascade-runtime-js/commit/${RUN.commit}`,
    ),
  );
  assert.ok(
    page.hrefs.includes(
      `https://github.com/jayostis/cascade-vocabulary/commit/${OTHER_RUN.commit}`,
    ),
  );
  assert.match(markup, /<time datetime="2026-11-04T22:12:35Z">/);
  assert.match(page.said, /0123456/);
});

test("a suite with no report, an unreadable one, a cut-short one and one with no cases each read as such, and the page is still written", async () => {
  const none = await pageWith({});
  assert.match(none.page.said, /runtime[\s\S]*not available/i);
  assert.match(none.page.said, /vocabulary[\s\S]*not available/i);
  assert.equal(rowsOf(none.markup, "runtime").length, 0);

  const broken = await pageWith({
    runtime: { report: "not xml at all", ...RUN },
    vocabulary: { report: PYTEST.slice(0, 400), ...OTHER_RUN },
  });
  assert.equal(
    (broken.page.said.match(/not available/gi) ?? []).length,
    2,
    broken.page.said,
  );
  assert.match(broken.page.said, /cut short|cannot be read/);
  assert.ok(broken.page.hrefs.includes(RUN.url));

  const empty = await pageWith({
    runtime: {
      report: `<testsuites><testsuite name="pytest" tests="0"></testsuite></testsuites>`,
      ...RUN,
    },
  });
  assert.match(empty.page.said, /0 cases/);
  assert.match(empty.page.said, /vocabulary[\s\S]*not available/i);
});

/** A describe holding a passing test written before a failing one, each with the line node's reporter was given for it. */
const DESCRIBED = `<?xml version="1.0" encoding="utf-8"?>
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

test("a describe is one level of the page with its counts, its failing test before its passing one, each leaf linked to its line at the commit", async () => {
  const { markup, tree } = await pageWith({
    runtime: { report: DESCRIBED, ...RUN },
  });
  const part = markup.split('id="runtime"')[1] ?? "";
  const said = text(part);
  assert.equal(
    (said.match(/a pod/g) ?? []).length,
    1,
    "the describe's name is said once, not on each case",
  );
  const group = said.slice(said.indexOf("a pod"));
  assert.match(group, /^a pod\b.{0,40}1 passed.{0,20}1 failed/);
  assert.ok(
    said.indexOf("rejects a gap") < said.indexOf("accepts a record"),
    "the failing test comes first",
  );
  assert.doesNotMatch(
    part,
    /pod\.test\.ts<\/code><\/td>/,
    "the file path is not repeated on a row",
  );
  const base = `https://github.com/jayostis/cascade-runtime-js/blob/${RUN.commit}/packages/cascade-runtime/test/pod.test.ts`;
  assert.ok(part.includes(`href="${base}#L20"`), "the failing leaf is linked");
  assert.ok(part.includes(`href="${base}#L10"`), "the passing leaf is linked");
  assert.ok(tree.has("conformance/tests/index.html"));
});

test("the CTRF file written for a report holds every case with its full path of names, status and duration, and counts as the page does", async () => {
  const { page, tree } = await pageWith({
    runtime: { report: DESCRIBED, ...RUN },
  });
  const bytes = tree.get("conformance/tests/runtime.ctrf.json");
  assert.ok(bytes, "conformance/tests/runtime.ctrf.json is written");
  const { results } = JSON.parse(new TextDecoder().decode(bytes)) as {
    results: {
      summary: Record<string, number>;
      tests: {
        name: string;
        suite?: string[];
        status: string;
        duration: number;
      }[];
    };
  };
  assert.deepEqual(
    results.tests.map(({ suite = [], name, status, duration }) => [
      [...suite, name],
      status,
      duration,
    ]),
    [
      [["a pod", "accepts a record"], "passed", 2],
      [["a pod", "rejects a gap"], "failed", 500],
    ],
  );
  assert.equal(results.summary.tests, 2);
  assert.equal(results.summary.passed, 1);
  assert.equal(results.summary.failed, 1);
  assert.match(page.said, /2 cases: 1 passed, 1 failed, 0 skipped/);
});

test("the CTRF file counts a failure node reported outside the cases as failed", async () => {
  const { tree } = await pageWith({
    runtime: { report: NODE_UNLISTED, ...RUN },
  });
  const bytes = tree.get("conformance/tests/runtime.ctrf.json");
  assert.ok(bytes);
  const { results } = JSON.parse(new TextDecoder().decode(bytes)) as {
    results: { summary: Record<string, number> };
  };
  assert.equal(results.summary.failed, 1);
});

test("the CTRF file is linked once, in its part, and a file outside packages/<pkg>/test/ still sits at file depth", async () => {
  const { markup } = await pageWith({
    runtime: { report: NODE, ...RUN },
  });
  assert.equal(markup.split('href="runtime.ctrf.json"').length - 1, 1);
  const outside = NODE.replace(
    /\/home\/runner\/work\/cascade-runtime-js\/cascade-runtime-js\/packages\/site\/dist\/test\/links\.test\.js/g,
    "/home/runner/work/cascade-runtime-js/cascade-runtime-js/scripts/x.test.js",
  );
  const { markup: other } = await pageWith({
    runtime: { report: outside, ...RUN },
  });
  assert.ok(
    levelsOf(other, "runtime").some((l) => /^x\.test\.js|scripts\/x/.test(l)),
  );
});

/** A property element, the way scripts/junit-reporter.mjs writes it. */
const prop = (name: string, value: string): string =>
  `<property name="${name}" value="${value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll("\n", "&#10;")}"/>`;

const FILE = (pkg: string, name: string): string =>
  `/home/runner/work/cascade-runtime-js/cascade-runtime-js/packages/${pkg}/dist/test/${name}.js`;

interface Marked {
  readonly description?: string;
  readonly rules?: readonly string[];
  readonly line?: number;
}

const marks = (m: Marked): string => {
  const list = [
    ...(m.description === undefined
      ? []
      : [prop("description", m.description)]),
    ...(m.rules ?? []).map((rule) => prop("rule", rule)),
    ...(m.line === undefined ? [] : [prop("line", String(m.line))]),
  ];
  return list.length === 0 ? "" : `<properties>${list.join("")}</properties>`;
};

const described = (name: string, m: Marked, inner: string): string =>
  `<testsuite name="${name}" time="0.001" tests="1" failures="0">${marks(m)}${inner}</testsuite>`;

const leafOf = (name: string, file: string, line: number, m: Marked = {}) =>
  `<testcase name="${name}" time="0.001" classname="test" file="${file}" line="${line}">${marks(m)}</testcase>`;

const packageProperty = (
  dir: string,
  name: string,
  version: string,
  spec: unknown,
): string =>
  `<properties>${prop(`package:${dir}`, JSON.stringify({ name, version, spec }))}</properties>`;

const report = (packages: string, body: string): string =>
  `<?xml version="1.0" encoding="utf-8"?>\n<testsuites>${packages}${body}</testsuites>\n`;

const pod = FILE("cascade-runtime", "pod.test");
const terms = FILE("cascade-runtime", "terms.test");
const packaging = FILE("cascade-runtime", "pack.test");

/** Capabilities in several files, listed in an order that is neither alphabetical nor the report's. */
const GROUPED = report(
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
      leafOf("lists the entry points", packaging, 5),
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

test("a package's cases are grouped by capability across files, in the order spec.json gives, the unlisted alphabetically, and build last in a collapsed section", async () => {
  const { markup } = await pageWith({ runtime: { report: GROUPED, ...RUN } });
  assert.deepEqual(levelsOf(markup, "runtime"), [
    "Looking up a term 1 passed",
    "Importing a health export 2 passed",
    "when nobody has claimed the patient 1 passed",
    "Apple capability 1 passed",
    "Zebra capability 1 passed",
    "Build and packaging 1 passed",
    "Packing 1 passed",
  ]);
  const part = partOf(markup, "runtime");
  const build = part.indexOf("Build and packaging");
  assert.ok(build > part.indexOf("Zebra capability"));
  assert.doesNotMatch(
    part.slice(build - 40, build),
    /open/,
    "the build section is collapsed",
  );
});

test("a capability shows its description and links the files it comes from at the line it starts on", async () => {
  const { markup, page } = await pageWith({
    runtime: { report: GROUPED, ...RUN },
  });
  const said = text(partOf(markup, "runtime"));
  assert.match(said, /Reads an export into the pod\./);
  assert.match(said, /The pod keeps it\./);
  assert.match(said, /Nothing is dropped\./);
  assert.match(said, /A patient nobody claimed\./);
  assert.match(said, /The library an app calls\./);
  const base = `https://github.com/jayostis/cascade-runtime-js/blob/${RUN.commit}/packages/cascade-runtime/test/`;
  assert.ok(page.hrefs.includes(`${base}pod.test.ts#L4`));
  assert.ok(page.hrefs.includes(`${base}pod-more.test.ts#L30`));
  assert.ok(
    page.hrefs.includes(`${base}pod.test.ts#L12`),
    "a leaf links its line",
  );
});

test("a @rule tag is a link to its rule on the conformance page, and is not part of the prose", async () => {
  const { markup, page } = await pageWith({
    runtime: { report: GROUPED, ...RUN },
  });
  assert.ok(
    page.hrefs.includes("spec/pod-import.html#r19"),
    page.hrefs.join("\n"),
  );
  assert.doesNotMatch(text(partOf(markup, "runtime")), /@rule/);
  const kit = report(
    "",
    described(
      "Kits",
      { rules: ["conformance/some-kit/some-kit.feature Check 3"] },
      leafOf("runs", pod, 3),
    ),
  );
  const other = await pageWith({ runtime: { report: kit, ...RUN } });
  assert.ok(other.page.hrefs.includes("spec/some-kit.html#check-3"));
});

test("the package line names the package, its version and the commit, and says unreleased for 0.0.0 and for a prerelease only", async () => {
  const line = async (version: string) => {
    const xml = report(
      packageProperty("cascade-runtime", "cascade-runtime", version, {}),
      described("A", {}, leafOf("b", pod, 2)),
    );
    return (await pageWith({ runtime: { report: xml, ...RUN } })).page.said;
  };
  const unreleased =
    /unreleased: what main does today, not a compatibility promise/;
  const zero = await line("0.0.0");
  assert.match(zero, /cascade-runtime 0\.0\.0/);
  assert.match(zero, /0123456/);
  assert.match(zero, unreleased);
  assert.match(await line("1.2.0-rc.1"), unreleased);
  const released = await line("1.2.0");
  assert.match(released, /cascade-runtime 1\.2\.0/);
  assert.doesNotMatch(released, /unreleased/);
});

test("the CTRF entry of a case carries the description and rule links of every level above it, and the full path of names", async () => {
  const { tree } = await pageWith({ runtime: { report: GROUPED, ...RUN } });
  const bytes = tree.get("conformance/tests/runtime.ctrf.json");
  assert.ok(bytes);
  const { results } = JSON.parse(new TextDecoder().decode(bytes)) as {
    results: {
      tests: {
        name: string;
        suite?: string[];
        extra?: { description?: string; levels: unknown[] };
      }[];
    };
  };
  const one = results.tests.find(
    (t) => t.name === "keeps the records unclaimed",
  );
  assert.deepEqual(one?.suite, [
    "Importing a health export",
    "when nobody has claimed the patient",
  ]);
  assert.equal(one?.extra?.description, "Nothing is dropped.");
  assert.deepEqual(one?.extra?.levels, [
    {
      name: "Importing a health export",
      description: "Reads an export into the pod.\n\nThe pod keeps it.",
      rules: [
        {
          feature: "pod-import",
          id: "R19",
          href: "../../spec/pod-import.html#r19",
        },
      ],
    },
    {
      name: "when nobody has claimed the patient",
      description: "A patient nobody claimed.",
    },
  ]);
});

/** A TypeScript test file with doc comments, transpiled with a source map as scripts/transpile.mjs does, then run by the reporter. */
async function reportOfFixture(): Promise<string> {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { pathToFileURL } = await import("node:url");
  const { build } = await import("esbuild");
  const dir = mkdtempSync(join(tmpdir(), "reporter-"));
  const source = join(dir, "x.test.ts");
  writeFileSync(
    source,
    [
      'import { describe, it } from "node:test";',
      "",
      "/**",
      " * Imports an export.",
      " * It keeps the records.",
      " *",
      " * @rule pod-import R19",
      " * @rule pod-import R20",
      " */",
      'describe("Importing", () => {',
      "  /** When nobody claimed it. */",
      '  describe("when unclaimed", () => {',
      "    /** Nothing is dropped & <nothing> is lost. */",
      '    it("keeps them", () => {});',
      "  });",
      '  it("bare", () => {});',
      "});",
      "",
      "// not a doc comment",
      'describe("Plain", () => {',
      '  it("passes", () => {});',
      "});",
      "",
    ].join("\n"),
  );
  await build({
    entryPoints: [source],
    outfile: join(dir, "x.test.js"),
    sourcemap: "external",
    format: "esm",
    logLevel: "silent",
  });
  const reporter = pathToFileURL(
    join(process.cwd(), "scripts", "junit-reporter.mjs"),
  ).href;
  const env = { ...process.env };
  delete env["NODE_TEST_CONTEXT"];
  const run = spawnSync(
    process.execPath,
    ["--test", `--test-reporter=${reporter}`, join(dir, "x.test.js")],
    { encoding: "utf8", env },
  );
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

test("the reporter writes each describe's and each test's doc comment as a description property and each @rule as a rule property, with the line it is declared on", async () => {
  const xml = await reportOfFixture();
  const { cases } = readJunit(xml);
  const byName = new Map(cases.map((one) => [one.name, one]));
  const keeps = byName.get("keeps them");
  assert.deepEqual(keeps?.describes, ["Importing", "when unclaimed"]);
  assert.equal(keeps?.description, "Nothing is dropped & <nothing> is lost.");
  assert.deepEqual(keeps?.described, [
    {
      description: "Imports an export. It keeps the records.",
      rules: ["pod-import R19", "pod-import R20"],
      line: 10,
    },
    { description: "When nobody claimed it.", rules: [], line: 12 },
  ]);
  assert.equal(byName.get("bare")?.description, undefined);
  assert.equal(
    byName.get("passes")?.described?.[0]?.description,
    undefined,
    "a // comment is no description",
  );
  assert.doesNotMatch(xml, /⁣/, "no marker is left in the report");
});

const GLOSSARY = [
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

const WITH_GLOSSARY = report(
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

const hrefsTo = (markup: string, anchor: string): number =>
  markup.split(`href="#glossary-cascade-runtime-${anchor}"`).length - 1;

test("a package's glossary is an open definition list under its about line, each entry anchored and linked to its term", async () => {
  const { markup } = await pageWith({
    runtime: { report: WITH_GLOSSARY, ...RUN },
  });
  const part = partOf(markup, "runtime");
  assert.ok(part.indexOf("The library an app calls.") < part.indexOf("<dl"));
  assert.match(part, /<details class="glossary" open>/);
  for (const anchor of ["claim", "pod", "export"])
    assert.match(
      part,
      new RegExp(`<dt id="glossary-cascade-runtime-${anchor}"`),
    );
  assert.match(part, /claims, claimed/);
  assert.ok(part.includes('href="../../terms/#cascade:Claim"'));
  assert.ok(part.includes('href="https://example.org/vocab#Export"'));
});

test("the first use of a term or alias in each capability links to its entry, as a whole word outside code spans and links", async () => {
  const { markup } = await pageWith({
    runtime: { report: WITH_GLOSSARY, ...RUN },
  });
  const part = partOf(markup, "runtime");
  const importing = part.slice(
    part.indexOf("Importing"),
    part.indexOf("Asking <span"),
  );
  assert.equal(hrefsTo(importing, "claim"), 1);
  assert.match(
    importing,
    /<a href="#glossary-cascade-runtime-claim">claim<\/a> is kept in the <a href="#glossary-cascade-runtime-pod">pod<\/a>\./,
  );
  assert.match(importing, /Claims stay/);
  assert.doesNotMatch(importing, /`claim`<\/a>|>claim<\/a>`/);
  assert.doesNotMatch(importing, /dis<a|>disclaimed/);
  assert.equal(hrefsTo(importing, "pod"), 1);
  const asking = part.slice(part.indexOf("Asking <span"));
  assert.equal(hrefsTo(asking, "claim"), 1, "a second capability links again");
  assert.equal(hrefsTo(asking, "export"), 1, "a leaf name links");
  assert.doesNotMatch(
    asking,
    /<a [^>]*>[^<]*<a /,
    "no link sits inside a link",
  );
});

test("a level name and a leaf name link the first use, the leaf keeping its source link", async () => {
  const { markup } = await pageWith({
    runtime: {
      report: WITH_GLOSSARY.replace(
        /"A claim is kept[^"]*"/,
        '"Reads."',
      ).replace("holds claims", "holds records"),
      ...RUN,
    },
  });
  const part = partOf(markup, "runtime");
  assert.match(
    part,
    /<summary>when the <a href="#glossary-cascade-runtime-pod">Pod<\/a> holds records/,
  );
  assert.match(
    part,
    /<a href="[^"]*pod\.test\.ts#L12">keeps what was <\/a><a href="#glossary-cascade-runtime-claim">claimed<\/a>/,
  );
});

test("the CTRF report carries the glossary in its extra, and a package without one adds nothing", async () => {
  const { tree } = await pageWith({
    runtime: { report: WITH_GLOSSARY, ...RUN },
  });
  const ctrfOf = (files: typeof tree) =>
    JSON.parse(
      new TextDecoder().decode(
        files.get("conformance/tests/runtime.ctrf.json"),
      ),
    ) as { extra?: { glossary?: Record<string, unknown[]> } };
  const glossary = ctrfOf(tree).extra?.glossary?.["cascade-runtime"];
  assert.equal(glossary?.length, 3);
  assert.deepEqual(glossary?.[0], {
    id: "glossary-cascade-runtime-claim",
    ...GLOSSARY[0],
  });
  const none = await pageWith({ runtime: { report: GROUPED, ...RUN } });
  assert.equal(ctrfOf(none.tree).extra, undefined);
  assert.doesNotMatch(none.markup, /class="glossary"/);
});
