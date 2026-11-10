/** What node:test's junit reporter writes: a file's cases at the top, a describe nested, `>` bare, `"` escaped twice. */
export const NODE = `<?xml version="1.0" encoding="utf-8"?>
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
export const PYTEST = `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="1" skipped="1" tests="3" time="392.878" timestamp="2026-11-04T22:12:49.141566+00:00" hostname="runnervm7aw5e"><testcase classname="tests.test_naming" name="test_a_name[record-from-server]@test_naming" time="0.012" /><testcase classname="tests.test_queries" name="test_gone" time="0.200"><failure message="assert 1 == 2&#10; +  where 1 = f()">def test_gone():
&gt;       assert 1 == 2
E       assert 1 == 2</failure></testcase><testcase classname="tests.test_queries" name="test_later" time="0.000"><skipped type="pytest.skip" message="later" /></testcase></testsuite></testsuites>`;

/**
 * node 24.16 `--test-reporter=junit` on a describe whose `after` hook throws and a test with a subtest that throws after it:
 * both parents say failures="0" and hold only their passing children, and only the `fail` comment records the failure.
 * Generated, not written; only the hostname and the file's folder were replaced.
 */
export const NODE_UNLISTED = `<?xml version="1.0" encoding="utf-8"?>
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
export const NODE_ORDINARY_FAILURES = `<?xml version="1.0" encoding="utf-8"?>
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

/** The properties a hook writes for the `n`th level of a case: its title and, when given, the line it starts on. */
const level = (n: number, title: string, line?: number) =>
  `<property name="describe:${n}:title" value="${title}" />${line === undefined ? "" : `<property name="describe:${n}:line" value="${line}" />`}`;
const IMPORTING = `${level(1, "Importing a record", 4)}<property name="describe:1:description" value="What importing does." />${level(2, "when the record is unclaimed", 9)}`;

/**
 * pytest 9.1.1 with xdist 3.8.0, `-n 2 --dist loadgroup -o junit_family=xunit1`, over a nested class, a parametrised test
 * in an xdist group and a module-level skip. Generated; the hostname, the folder, the object's address and the `\` of a
 * Windows path were replaced, and the `describe:N:*` properties a conftest hook writes were added beside the `title` that
 * `record_property` wrote.
 */
export const PYTEST_XUNIT1 = `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="1" skipped="1" tests="4" time="1.875" timestamp="2026-11-10T02:49:55.771823-08:00" hostname="x"><testcase classname="tests.test_pod.TestImporting.TestWhenUnclaimed" name="test_keeps_it[a]@pods" file="tests/test_pod.py" line="11" time="0.011"><properties><property name="title" value="keeps it (a)" />${IMPORTING}</properties></testcase><testcase classname="tests.test_pod.TestImporting.TestWhenUnclaimed" name="test_refuses" file="tests/test_pod.py" line="17" time="0.003"><properties>${IMPORTING}</properties><failure message="assert 1 == 2">self = &lt;test_pod.TestImporting.TestWhenUnclaimed object at 0x1&gt;

    def test_refuses(self):
&gt;       assert 1 == 2
E       assert 1 == 2

tests/test_pod.py:19: AssertionError</failure></testcase><testcase classname="tests.test_pod.TestImporting.TestWhenUnclaimed" name="test_keeps_it[b]@pods" file="tests/test_pod.py" line="11" time="0.010"><properties><property name="title" value="keeps it (b)" />${IMPORTING}</properties></testcase><testcase classname="tests.test_pod" name="test_flat" file="tests/test_pod.py" line="21" time="0.005"><skipped type="pytest.skip" message="later">tests/test_pod.py:23: later</skipped></testcase></testsuite></testsuites>`;

/**
 * vitest 5.1.0 `--reporter=junit --includeTaskLocation`, which still writes no line: nested describes joined by ` > `, a
 * skipped `it` beside a describe, and an `it` outside any. Generated; the hostname was replaced, and the `line` property the
 * repository's reporter adds was added to one case.
 */
export const VITEST = `<?xml version="1.0" encoding="UTF-8" ?>
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

const NAMING = `<property name="file" value="crates/bridge/src/naming.rs"/>${level(1, "Naming a record", 1)}${level(2, "when the selector has a pipe")}`;

/**
 * cargo-nextest's JUnit, written from its documented form (no Rust toolchain here to generate one): a testsuite per test
 * binary, a case named by its module path, a `mod tests` inside it, and the `file`, `line`, `title` and `describe:N:*`
 * properties a scan of the source adds before upload.
 */
export const NEXTEST = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="nextest-run" tests="3" failures="1" errors="0" uuid="9b1d4c8e-0000-4000-8000-000000000000" timestamp="2026-11-10T10:00:00.000+00:00" time="0.050">
    <testsuite name="cascade-bridge" tests="2" disabled="0" errors="0" failures="1">
        <testcase name="naming::tests::naming_a_record::when_the_selector_has_a_pipe::escapes_it" classname="cascade-bridge" timestamp="2026-11-10T10:00:00.001+00:00" time="0.002">
            <properties>${NAMING}<property name="title" value="escapes it"/><property name="line" value="31"/></properties>
        </testcase>
        <testcase name="naming::tests::naming_a_record::when_the_selector_has_a_pipe::keeps_the_base" classname="cascade-bridge" timestamp="2026-11-10T10:00:00.002+00:00" time="0.003">
            <properties>${NAMING}<property name="line" value="40"/></properties>
            <failure type="test failure with exit code 101">thread 'naming::tests::naming_a_record::when_the_selector_has_a_pipe::keeps_the_base' panicked at crates/bridge/src/naming.rs:42:9:
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
