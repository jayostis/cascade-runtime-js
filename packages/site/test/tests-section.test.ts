import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { hubFiles } from "../src/front-page.js";
import type { Suite, SuiteRun, TestRun } from "../src/hub/context.js";
import { glossaryOf, Links } from "../src/hub/glossary.js";
import { readJunit } from "../src/junit.js";
import { suitesOf, testsSection } from "../src/hub/tests.js";
import { buildTree } from "../src/sections.js";
import { readPage } from "./page.js";
import { described, FILE, leafOf, packageProperty, report } from "./report.js";

const R = "cascade-runtime-js";
const V = "cascade-vocabulary";
const PATH = `conformance/tests/${R}/index.html`;
const pageOf = (name: string): string => `conformance/tests/${name}/index.html`;
const ctrfPath = (name: string): string =>
  `conformance/tests/${name}/${name}.ctrf.json`;

const suite = (
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
const RUNTIME = suite(`jayostis/${R}`, "node:test", "The runtime's tests");
const VOCABULARY = suite(`jayostis/${V}`, "pytest", "The vocabulary's tests");

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

/**
 * The pages of the runtime's suite, the vocabulary's and any others given, each with its newest run where one is given,
 * read as one text in that order.
 */
async function pageWith(
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

function text(markup: string): string {
  return markup
    .replaceAll("<wbr>", "")
    .replace(/<span class="icon" aria-hidden="true">[^<]*<\/span>/g, "")
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
  const part = markup.split(`id="${R}"`)[1] ?? "";
  assert.ok(
    part.includes(`<a href="${RUN.url}">`),
    "the run is linked in the runtime's part",
  );
  const honest = await pageWith({ runtime: { report: NODE, ...RUN } });
  assert.doesNotMatch(honest.page.said, /node counts/);
});

/** The page of the suite whose part has that id, from the part to the page's end. */
function partOf(markup: string, heading: string): string {
  return (markup.split(`id="${heading}"`)[1] ?? "").split("<!DOCTYPE")[0] ?? "";
}

/** The levels (package, file, describe) after the heading, as the text of each summary, in the page's order. */
function levelsOf(markup: string, heading: string): string[] {
  const part = partOf(markup, heading);
  return [...part.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map(([, said]) =>
    text(said ?? "").replace(/(passed|failed) (?=\d)/g, "$1, "),
  );
}

/** The cases of the tree after the heading, as their name, result and time, in the page's order. */
function casesOf(markup: string, heading: string): string[][] {
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

test("each suite's newest run shows its cases with result and time as a tree of package, capability and situation, a failed case reading failed, and the run's commit, date and link", async () => {
  const { markup, page } = await pageWith({
    runtime: { report: NODE, ...RUN },
    vocabulary: { report: PYTEST, ...OTHER_RUN },
  });

  assert.deepEqual(levelsOf(markup, R), [
    // the failing package first; a case with no describe is a capability named for its file
    "links.test.ts 1 passed, 1 failed",
    "other.test.ts 0 passed, 1 skipped",
    "outer 1 passed",
    "inner 1 passed",
  ]);
  assert.deepEqual(casesOf(markup, R), [
    ['fails <a> "q" & so on', "failed", "1.50 s"],
    ["passes", "passed", "3 ms"],
    ["skipped", "skipped", "0 ms"],
    ["deep pass", "passed", "0 ms"],
  ]);
  assert.doesNotMatch(partOf(markup, R), /<table/);
  assert.equal(failureOf(markup, R), "1 == 2 and 3 > 2");

  // pytest's xunit2, as the vocabulary uploads it today: no file and no line, a module as each case's classname
  assert.deepEqual(levelsOf(markup, V), [
    "test_naming.py 1 passed",
    "test_queries.py 0 passed, 1 failed, 1 skipped",
  ]);
  assert.deepEqual(casesOf(markup, V), [
    ["test_a_name[record-from-server]", "passed", "12 ms"],
    ["test_gone", "failed", "200 ms"],
    ["test_later", "skipped", "0 ms"],
  ]);
  assert.ok(
    page.hrefs.includes(
      `https://github.com/jayostis/cascade-vocabulary/blob/${OTHER_RUN.commit}/tests/test_queries.py`,
    ),
  );
  assert.equal(failureOf(markup, V), "assert 1 == 2 + where 1 = f()");

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
  assert.equal(casesOf(none.markup, R).length, 0);

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

/**
 * pytest 9.1.1 with xdist 3.8.0, `-n 2 --dist loadgroup -o junit_family=xunit1`, over a nested class, a parametrised test
 * in an xdist group and a module-level skip. Generated; the hostname, the folder, the object's address and the `\` of a
 * Windows path were replaced, and the `describe:N:*` properties a conftest hook writes were added beside the `title` that
 * `record_property` wrote.
 */
const level = (n: number, title: string, line?: number) =>
  `<property name="describe:${n}:title" value="${title}" />${line === undefined ? "" : `<property name="describe:${n}:line" value="${line}" />`}`;
const IMPORTING = `${level(1, "Importing a record", 4)}<property name="describe:1:description" value="What importing does." />${level(2, "when the record is unclaimed", 9)}`;
const PYTEST_XUNIT1 = `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="1" skipped="1" tests="4" time="1.875" timestamp="2026-11-10T02:49:55.771823-08:00" hostname="x"><testcase classname="tests.test_pod.TestImporting.TestWhenUnclaimed" name="test_keeps_it[a]@pods" file="tests/test_pod.py" line="11" time="0.011"><properties><property name="title" value="keeps it (a)" />${IMPORTING}</properties></testcase><testcase classname="tests.test_pod.TestImporting.TestWhenUnclaimed" name="test_refuses" file="tests/test_pod.py" line="17" time="0.003"><properties>${IMPORTING}</properties><failure message="assert 1 == 2">self = &lt;test_pod.TestImporting.TestWhenUnclaimed object at 0x1&gt;

    def test_refuses(self):
&gt;       assert 1 == 2
E       assert 1 == 2

tests/test_pod.py:19: AssertionError</failure></testcase><testcase classname="tests.test_pod.TestImporting.TestWhenUnclaimed" name="test_keeps_it[b]@pods" file="tests/test_pod.py" line="11" time="0.010"><properties><property name="title" value="keeps it (b)" />${IMPORTING}</properties></testcase><testcase classname="tests.test_pod" name="test_flat" file="tests/test_pod.py" line="21" time="0.005"><skipped type="pytest.skip" message="later">tests/test_pod.py:23: later</skipped></testcase></testsuite></testsuites>`;

/**
 * vitest 5.1.0 `--reporter=junit --includeTaskLocation`, which still writes no line: nested describes joined by ` > `, a
 * skipped `it` beside a describe, and an `it` outside any. Generated; the hostname was replaced, and the `line` property the
 * repository's reporter adds was added to one case.
 */
const VITEST = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="4" failures="1" errors="0" time="0.0194449">
    <testsuite name="test/a.test.ts" timestamp="2026-11-10T10:49:46.507Z" hostname="x" tests="4" failures="1" errors="0" skipped="1" time="0.0194449">
        <testcase classname="test/a.test.ts" name="Importing a record &gt; when the pod is empty &gt; keeps it" time="0.0044741">
            <properties><property name="line" value="5"/></properties>
        </testcase>
        <testcase classname="test/a.test.ts" name="Importing a record &gt; when the pod is empty &gt; refuses a &lt;gap&gt; &amp; &quot;so&quot;" time="0.0100671">
            <failure message="expected 1 to be 2 // Object.is equality" type="AssertionError">
AssertionError: expected 1 to be 2 // Object.is equality
 ❯ test/a.test.ts:9:17
            </failure>
        </testcase>
        <testcase classname="test/a.test.ts" name="Importing a record &gt; later" time="0">
            <skipped/>
        </testcase>
        <testcase classname="test/a.test.ts" name="stands alone" time="0.0003891">
        </testcase>
    </testsuite>
</testsuites>
`;

/**
 * cargo-nextest's JUnit, written from its documented form (no Rust toolchain here to generate one): a testsuite per test
 * binary, a case named by its module path, a `mod tests` inside it, and the `file`, `line`, `title` and `describe:N:*`
 * properties a scan of the source adds before upload.
 */
const NAMING = `<property name="file" value="crates/bridge/src/naming.rs"/>${level(1, "Naming a record", 1)}${level(2, "when the selector has a pipe")}`;
const NEXTEST = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="nextest-run" tests="3" failures="1" errors="0" uuid="9b1d4c8e-0000-4000-8000-000000000000" timestamp="2026-11-10T10:00:00.000+00:00" time="0.050">
    <testsuite name="cascade-bridge" tests="2" disabled="0" errors="0" failures="1">
        <testcase name="naming::tests::when_the_selector_has_a_pipe::escapes_it" classname="cascade-bridge" timestamp="2026-11-10T10:00:00.001+00:00" time="0.002">
            <properties>${NAMING}<property name="title" value="escapes it"/><property name="line" value="31"/></properties>
        </testcase>
        <testcase name="naming::tests::when_the_selector_has_a_pipe::keeps_the_base" classname="cascade-bridge" timestamp="2026-11-10T10:00:00.002+00:00" time="0.003">
            <properties>${NAMING}<property name="line" value="40"/></properties>
            <failure type="test failure with exit code 101">thread 'naming::tests::when_the_selector_has_a_pipe::keeps_the_base' panicked at crates/bridge/src/naming.rs:42:9:
assertion failed: kept</failure>
            <system-out></system-out>
            <system-err>note: run with RUST_BACKTRACE=1</system-err>
        </testcase>
    </testsuite>
    <testsuite name="cascade-bridge-cli::node_host" tests="1" disabled="0" errors="0" failures="0">
        <testcase name="runs_the_host" classname="cascade-bridge-cli::node_host" timestamp="2026-11-10T10:00:00.010+00:00" time="0.040">
        </testcase>
    </testsuite>
</testsuites>
`;

test("a pytest, vitest or nextest report reads as a tree of capability, situation and case, on its own page for a repository the hub did not know", async () => {
  const at = (repository: string, report: string): TestRun => ({
    ...RUN,
    report,
    url: `https://github.com/${repository}/actions/runs/7`,
  });
  const cases = [
    {
      suite: suite("someone/py-thing", "pytest"),
      report: PYTEST_XUNIT1,
      spec: { capabilities: ["Importing a record"] },
      levels: [
        "Importing a record 2 passed, 1 failed",
        "when the record is unclaimed 2 passed, 1 failed",
        "test_pod.py 0 passed, 1 skipped",
      ],
      leaves: [
        ["test_refuses", "failed", "3 ms"],
        ["keeps it (a)", "passed", "11 ms"],
        ["keeps it (b)", "passed", "10 ms"],
        ["test_flat", "skipped", "5 ms"],
      ],
      links: ["tests/test_pod.py#L18", "tests/test_pod.py#L4"],
      said: /What importing does\./,
    },
    {
      suite: suite("someone/vi-thing", "vitest"),
      report: VITEST,
      levels: [
        "Importing a record 1 passed, 1 failed, 1 skipped",
        "when the pod is empty 1 passed, 1 failed",
        "a.test.ts 1 passed",
      ],
      leaves: [
        ['refuses a <gap> & "so"', "failed", "10 ms"],
        ["keeps it", "passed", "4 ms"],
        ["later", "skipped", "0 ms"],
        ["stands alone", "passed", "0 ms"],
      ],
      links: ["test/a.test.ts#L5"],
      said: /expected 1 to be 2/,
    },
    {
      suite: suite("someone/rs-thing", "nextest"),
      report: NEXTEST,
      levels: [
        "Naming a record 1 passed, 1 failed",
        "when the selector has a pipe 1 passed, 1 failed",
        "cascade-bridge-cli::node_host 1 passed",
      ],
      leaves: [
        ["keeps_the_base", "failed", "3 ms"],
        ["escapes it", "passed", "2 ms"],
        ["runs_the_host", "passed", "40 ms"],
      ],
      links: [
        "crates/bridge/src/naming.rs#L40",
        "crates/bridge/src/naming.rs#L1",
      ],
      said: /assertion failed: kept/,
    },
  ];
  const { markup, page, tree } = await pageWith(
    {},
    cases.map(({ suite: one, report, spec }) => ({
      suite: one,
      run: { ...at(one.repository, report), ...(spec ? { spec } : {}) },
    })),
  );
  const front = new TextDecoder().decode(tree.get("index.html"));
  for (const { suite: one, levels, leaves, links, said } of cases) {
    const name = one.repository.split("/")[1] ?? "";
    assert.deepEqual(levelsOf(markup, name), levels, name);
    assert.deepEqual(casesOf(markup, name), leaves, name);
    for (const link of links)
      assert.ok(
        page.hrefs.includes(
          `https://github.com/${one.repository}/blob/${RUN.commit}/${link}`,
        ),
        `${name} links ${link}`,
      );
    assert.match(text(partOf(markup, name)), said);
    assert.ok(tree.has(ctrfPath(name)), `${name} has its CTRF`);
    assert.ok(
      front.includes(`href="conformance/tests/${name}/"`),
      `the front page links ${name}'s page`,
    );
  }
  assert.ok(!tree.has("conformance/tests/index.html"), "there is no index");
});

test("a suite that names its test folder shows its files under it, and a repository other than the runtime is one package", async () => {
  const given = {
    ...suite("someone/host-thing", "vitest"),
    tests: "host/test/",
  };
  const { markup } = await pageWith({}, [
    {
      suite: given,
      run: {
        ...RUN,
        report: VITEST.replaceAll("test/a.test.ts", "host/test/a.test.ts"),
        url: "https://github.com/someone/host-thing/actions/runs/7",
      },
    },
  ]);
  assert.deepEqual(levelsOf(markup, "host-thing"), [
    "Importing a record 1 passed, 1 failed, 1 skipped",
    "when the pod is empty 1 passed, 1 failed",
    "a.test.ts 1 passed",
  ]);
  assert.deepEqual(
    suitesOf([{ ...VOCABULARY, tests: "host/test/" }]).map((one) => one.tests),
    ["host/test/"],
  );
  assert.throws(() => suitesOf([{ ...VOCABULARY, tests: 3 }]), /tests/);
});

test("a pytest case with no hook's properties sits under its classes, at its 1-based line, named as pytest names it, and a module that failed to collect is in its file", () => {
  const bare = PYTEST_XUNIT1.replace(/<properties>.*?<\/properties>/g, "");
  const [first] = readJunit(bare).cases;
  const [broken] = readJunit(
    `<testsuites name="pytest tests"><testsuite name="pytest" timestamp="t"><testcase classname="" name="tests.test_broken" time="0.000"><error message="collection failure">ImportError</error></testcase></testsuite></testsuites>`,
  ).cases;
  assert.equal(broken?.file, "tests/test_broken.py");
  assert.equal(broken?.result, "failed");
  assert.deepEqual(
    {
      file: first?.file,
      describes: first?.describes,
      name: first?.name,
      line: first?.line,
    },
    {
      file: "tests/test_pod.py",
      describes: ["TestImporting", "TestWhenUnclaimed"],
      name: "test_keeps_it[a]",
      line: 12,
    },
  );
});

test("the suite list names each repository's workflow, artifact, report and runner, and refuses an entry missing one", () => {
  const listed = suitesOf(
    JSON.parse(
      readFileSync(new URL("../../test-suites.json", import.meta.url), "utf8"),
    ),
  );
  assert.deepEqual(
    listed.map(({ repository, workflow, runner }) => [
      repository,
      workflow,
      runner,
    ]),
    [
      ["jayostis/cascade-runtime-js", "check.yml", "node:test"],
      ["jayostis/cascade-vocabulary", "check.yml", "pytest"],
      ["jayostis/cascade-starter-kit", "check.yml", "node:test"],
      ["jayostis/cascade-sandbox", "check.yml", "node:test"],
      ["jayostis/cascade-reference-tables", "check.yml", "node:test"],
      ["jayostis/cascade-bridge-rs", "test.yml", "nextest"],
      ["jayostis/cascade-bridge-spec", "validate.yml", "pytest"],
    ],
  );
  assert.throws(
    () => suitesOf([{ ...VOCABULARY, artifact: undefined }]),
    /artifact/,
  );
  assert.throws(() => suitesOf([{ ...VOCABULARY, runner: "jest" }]), /jest/);
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
  const part = markup.split(`id="${R}"`)[1] ?? "";
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
  assert.ok(tree.has(PATH));
});

test("the CTRF file written for a report holds every case with its full path of names, status and duration, and counts as the page does", async () => {
  const { page, tree } = await pageWith({
    runtime: { report: DESCRIBED, ...RUN },
  });
  const bytes = tree.get(ctrfPath(R));
  assert.ok(bytes, `${ctrfPath(R)} is written`);
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
  const bytes = tree.get(ctrfPath(R));
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
  assert.equal(markup.split(`href="${R}.ctrf.json"`).length - 1, 1);
  const outside = NODE.replace(
    /\/home\/runner\/work\/cascade-runtime-js\/cascade-runtime-js\/packages\/site\/dist\/test\/links\.test\.js/g,
    "/home/runner/work/cascade-runtime-js/cascade-runtime-js/scripts/x.test.js",
  );
  const { markup: other } = await pageWith({
    runtime: { report: outside, ...RUN },
  });
  assert.ok(levelsOf(other, R).some((l) => /^x\.test\.js|scripts\/x/.test(l)));
});

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
  assert.deepEqual(levelsOf(markup, R), [
    "Looking up a term 1 passed",
    "Importing a health export 2 passed",
    "when nobody has claimed the patient 1 passed",
    "Apple capability 1 passed",
    "Zebra capability 1 passed",
    "Build and packaging 1 passed",
    "Packing 1 passed",
  ]);
  const part = partOf(markup, R);
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
  const said = text(partOf(markup, R));
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
  assert.doesNotMatch(text(partOf(markup, R)), /@rule/);
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
  const bytes = tree.get(ctrfPath(R));
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
          href: "../../../spec/pod-import.html#r19",
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
    { encoding: "utf8", env, cwd: dir },
  );
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

test("the reporter writes each describe's and each test's doc comment as a description property and each @rule as a rule property, with the line it is declared on and its file from where the tests ran", async () => {
  const xml = await reportOfFixture();
  const { cases } = readJunit(xml);
  const byName = new Map(cases.map((one) => [one.name, one]));
  const keeps = byName.get("keeps them");
  assert.deepEqual(keeps?.describes, ["Importing", "when unclaimed"]);
  assert.equal(
    keeps?.file,
    "x.test.ts",
    "the file is named from the directory the tests ran in, so another repository's links reach it",
  );
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
  const part = partOf(markup, R);
  assert.ok(part.indexOf("The library an app calls.") < part.indexOf("<dl"));
  assert.match(part, /<details class="glossary" open>/);
  for (const anchor of ["claim", "pod", "export"])
    assert.match(
      part,
      new RegExp(`<dt id="glossary-cascade-runtime-${anchor}"`),
    );
  assert.match(part, /claims, claimed/);
  assert.ok(part.includes('href="../../../terms/#cascade:Claim"'));
  assert.ok(part.includes('href="https://example.org/vocab#Export"'));
});

test("the first use of a term or alias in each capability links to its entry, as a whole word outside code spans and links", async () => {
  const { markup } = await pageWith({
    runtime: { report: WITH_GLOSSARY, ...RUN },
  });
  const part = partOf(markup, R);
  const importing = part.slice(
    part.indexOf(">Importing"),
    part.indexOf(">Asking<"),
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
  const asking = part.slice(part.indexOf(">Asking<"));
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
  const part = partOf(markup, R);
  assert.match(
    part,
    /<summary><span class="level-name">when the <a href="#glossary-cascade-runtime-pod">Pod<\/a> holds records/,
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
    JSON.parse(new TextDecoder().decode(files.get(ctrfPath(R)))) as {
      extra?: { glossary?: Record<string, unknown[]> };
    };
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

test("a glossary term written with a capital links only as written, so plain English is not linked", () => {
  const entries = glossaryOf(
    [
      {
        term: "Same",
        definition: "A judgment that two records are one thing.",
      },
      { term: "claim", definition: "The owner's say-so.", aliases: ["claims"] },
    ],
    "cascade-runtime",
  );
  const linked = (text: string) =>
    new Links(entries)
      .pieces(text)
      .filter((piece) => typeof piece !== "string");
  assert.deepEqual(linked("the same record, and the different one"), []);
  assert.deepEqual(linked("files a Same over them"), [
    { text: "Same", id: "glossary-cascade-runtime-same" },
  ]);
  assert.deepEqual(linked("Claims are kept"), [
    { text: "Claims", id: "glossary-cascade-runtime-claim" },
  ]);
});

/** A suite's summary bar, as its tallies and the text around them. */
function barOf(markup: string, heading: string) {
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

test("each suite's summary bar counts its results, names its package, version, commit and run time, and says unreleased only for an unreleased version", async () => {
  const { markup } = await pageWith({
    runtime: { report: NODE, ...RUN },
    vocabulary: { report: PYTEST, ...OTHER_RUN },
  });
  const runtime = barOf(markup, R);
  assert.deepEqual(runtime.tallies, { passed: 2, failed: 1, skipped: 1 });
  assert.match(runtime.said, /0123456/);

  const vocabulary = barOf(markup, V);
  assert.deepEqual(vocabulary.tallies, { passed: 1, failed: 1, skipped: 1 });
  assert.match(vocabulary.said, /fedcba9/);
  assert.match(
    vocabulary.said,
    /212 ms/,
    "a report with no declared total has its cases times added up",
  );

  const named = barOf(
    (await pageWith({ runtime: { report: GROUPED, ...RUN } })).markup,
    R,
  );
  assert.match(named.said, /cascade-runtime 0\.0\.0 unreleased/);
  const released = report(
    packageProperty("cascade-runtime", "cascade-runtime", "1.2.0", {}),
    described("A", {}, leafOf("b", pod, 2)),
  );
  const { said } = barOf(
    (await pageWith({ runtime: { report: released, ...RUN } })).markup,
    R,
  );
  assert.match(said, /cascade-runtime 1\.2\.0/);
  assert.doesNotMatch(said, /unreleased/);

  const timed = barOf(
    (await pageWith({ runtime: { report: NODE_UNLISTED, ...RUN } })).markup,
    R,
  );
  assert.match(
    timed.said,
    /132 ms/,
    "node's declared duration is the run time",
  );
});

test("a summary bar shows a failed pill only when a case failed, so a green run has no red one", async () => {
  const green = report(
    packageProperty("cascade-runtime", "cascade-runtime", "0.0.0", {}),
    described("A", {}, leafOf("b", pod, 2)),
  );
  const { tallies } = barOf(
    (await pageWith({ runtime: { report: green, ...RUN } })).markup,
    R,
  );
  assert.deepEqual(tallies, { passed: 1, skipped: 0 });
});

test("the controls are buttons that start hidden, one set on each page, over a tree whose levels and cases carry what they act on", async () => {
  const { markup } = await pageWith({
    runtime: { report: NODE, ...RUN },
    vocabulary: { report: PYTEST, ...OTHER_RUN },
  });
  const actions = (heading: string): string[] =>
    [
      ...partOf(markup, heading).matchAll(
        /<button type="button" data-action="([\w-]+)"/g,
      ),
    ].map(([, action]) => action ?? "");
  for (const heading of [R, V]) {
    assert.deepEqual(actions(heading), [
      "expand-all",
      "collapse-all",
      "failures-only",
    ]);
    assert.match(
      partOf(markup, heading),
      /<span class="controls" data-controls hidden>/,
    );
  }
  const runtime = partOf(markup, R);
  assert.match(runtime, /<li class="case" data-result="failed">/);
  assert.match(runtime, /<li class="case" data-result="passed">/);
  assert.match(runtime, /<li class="capability" data-failed="1">/);
  assert.match(runtime, /<li class="capability" data-failed="0">/);
  assert.match(partOf(markup, V), /<li class="case" data-result="failed">/);
  assert.match(markup, /<script>[\s\S]*data-action[\s\S]*<\/script>/);
  assert.doesNotMatch(
    runtime.replace(/<span class="controls"[\s\S]*?<\/span>/, ""),
    /\shidden[\s>]/,
    "nothing but the controls is hidden before script runs",
  );
});

test("a case reads as an icon and its word, the word kept for a reader without the icon", async () => {
  const { markup } = await pageWith({
    runtime: { report: NODE, ...RUN },
    vocabulary: { report: PYTEST, ...OTHER_RUN },
  });
  const status = (result: string, icon: string) =>
    `<span class="result ${result}"><span class="icon" aria-hidden="true">${icon}</span> <span class="label">${result}</span></span>`;
  for (const heading of [R, V]) {
    const part = partOf(markup, heading);
    assert.ok(part.includes(status("passed", "✓")), `${heading} passed`);
    assert.ok(part.includes(status("failed", "✗")), `${heading} failed`);
    assert.ok(part.includes(status("skipped", "○")), `${heading} skipped`);
  }
  assert.doesNotMatch(
    markup,
    /<span class="result \w+">[^<]*<\/span>/,
    "no result is only its word, or only an icon",
  );
});

test("a capability's API names after its dot are code, and a package's glossary has a filter hidden until script runs, each term followed by its definition", async () => {
  const named = report(
    "",
    described(
      "Pulling records · pull(), pullAll()",
      { description: "Fetches." },
      leafOf("fetches", pod, 3),
    ),
  );
  const { markup } = await pageWith({ runtime: { report: named, ...RUN } });
  assert.match(
    markup,
    /<span class="cap-name">Pulling records<\/span> <span class="api">pull\(\), pullAll\(\)<\/span>/,
  );

  const glossary = partOf(
    (await pageWith({ runtime: { report: WITH_GLOSSARY, ...RUN } })).markup,
    R,
  );
  assert.match(
    glossary,
    /<input type="search" class="glossary-filter" data-glossary-filter hidden [^>]*aria-label="[^"]+">/,
  );
  const dl = /<dl>([\s\S]*?)<\/dl>/.exec(glossary)?.[1] ?? "";
  const terms = dl.match(/<dt /g)?.length ?? 0;
  assert.ok(terms >= 3);
  assert.equal(dl.match(/<dd>[\s\S]*?<\/dd>/g)?.length, terms);
  assert.match(dl, /^\s*<dt [^>]*>[\s\S]*?<\/dt>\s*<dd>/);
  assert.match(glossary, /<p class="none-match" hidden>/);
});

/** Four packages with one passed case each, in the order a report lists them; `failing` names one whose case failed. */
const FOUR_PACKAGES = (failing?: string): string =>
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

/** The packages of the runtime's page, in the order the page shows them. */
const packagesOf = (markup: string): string[] =>
  [...markup.matchAll(/<h3 class="package"><code>([^<]*)<\/code>/g)].map(
    ([, name]) => name ?? "",
  );

const LISTING = { ...RUNTIME, packages: ["cascade-runtime", "site"] } as Suite;

test("a suite that lists its packages keeps the order, and refuses a list that is not names", () => {
  assert.deepEqual(
    suitesOf([{ ...VOCABULARY, packages: ["b", "a"] }])[0]?.packages,
    ["b", "a"],
  );
  for (const packages of ["site", [3], [""], { site: 1 }])
    assert.throws(
      () => suitesOf([{ ...VOCABULARY, packages }]),
      /packages/,
      JSON.stringify(packages),
    );
});

test("a page shows the packages a suite lists in that order, then the others by name, and a package with a failed case first", async () => {
  const listed = await pageWith(
    { runtime: { report: FOUR_PACKAGES(), ...RUN } },
    [],
    LISTING,
  );
  assert.deepEqual(packagesOf(listed.markup).slice(0, 4), [
    "cascade-runtime",
    "site",
    "apple-health",
    "runtime",
  ]);
  const red = await pageWith(
    { runtime: { report: FOUR_PACKAGES("runtime"), ...RUN } },
    [],
    LISTING,
  );
  assert.deepEqual(packagesOf(red.markup).slice(0, 4), [
    "runtime",
    "cascade-runtime",
    "site",
    "apple-health",
  ]);
});
