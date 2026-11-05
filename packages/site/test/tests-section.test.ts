import assert from "node:assert/strict";
import { test } from "node:test";
import { hubFiles } from "../src/front-page.js";
import type { TestReports } from "../src/hub/context.js";
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

test("each suite's newest run is a table of its cases with result and time, nested describes in the case, a failed case reading failed, and the run's commit, date and link", async () => {
  const { markup, page } = await pageWith({
    runtime: { report: NODE, ...RUN },
    vocabulary: { report: PYTEST, ...OTHER_RUN },
  });

  const runtime = rowsOf(markup, "runtime");
  assert.deepEqual(
    runtime.map(([suite, name, result]) => [suite, name, result]),
    [
      // failures first, then by suite and case
      ["packages/site/test/links.test.ts", 'fails <a> "q" & so on', "failed"],
      [
        "packages/runtime/test/other.test.ts",
        "outer › inner › deep pass",
        "passed",
      ],
      ["packages/runtime/test/other.test.ts", "skipped", "skipped"],
      ["packages/site/test/links.test.ts", "passes", "passed"],
    ],
  );
  assert.deepEqual(
    runtime.map((row) => row[3]),
    ["1.50 s", "0 ms", "0 ms", "3 ms"],
  );
  assert.equal(failureOf(markup, "runtime"), "1 == 2 and 3 > 2");

  const vocabulary = rowsOf(markup, "vocabulary");
  assert.deepEqual(
    vocabulary.map(([suite, name, result]) => [suite, name, result]),
    [
      ["tests.test_queries", "test_gone", "failed"],
      [
        "tests.test_naming",
        "test_a_name[record-from-server]@test_naming",
        "passed",
      ],
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
