import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { Suite, TestRun } from "../src/hub/context.js";
import { readJunit } from "../src/junit.js";
import {
  NEXTEST,
  NODE,
  NODE_ORDINARY_FAILURES,
  NODE_UNLISTED,
  PYTEST,
  PYTEST_XUNIT1,
  VITEST,
} from "./runner-reports.js";
import {
  casesOf,
  failureOf,
  levelsOf,
  OTHER_RUN,
  pageWith,
  partOf,
  R,
  RUN,
  suite,
  text,
  V,
} from "./tests-page.js";

/** The page of a repository the hub did not know, made from one report of its runner. */
async function pageOfOther(
  repository: string,
  runner: Suite["runner"],
  report: string,
  spec?: unknown,
) {
  const run: TestRun = {
    ...RUN,
    report,
    url: `https://github.com/${repository}/actions/runs/7`,
    ...(spec === undefined ? {} : { spec }),
  };
  const { markup, page } = await pageWith({}, [
    { suite: suite(repository, runner), run },
  ]);
  const name = repository.split("/")[1] ?? "";
  return { markup, name, page, part: partOf(markup, name) };
}

/**
 * Each runner writes JUnit XML its own way. `readJunit()` reads node:test's, pytest's, vitest's and nextest's into the
 * same cases, so a repository's page reads as capability, situation and case whatever ran its tests.
 */
describe("Reading a report from each test runner · readJunit()", () => {
  describe("with a node:test report", () => {
    let markup: string;

    before(async () => {
      ({ markup } = await pageWith({ runtime: { report: NODE, ...RUN } }));
    });

    it("reads a describe as a level and a describe inside it as the level under", () => {
      assert.deepEqual(levelsOf(markup, R).slice(2), [
        "outer 1 passed",
        "inner 1 passed",
      ]);
      assert.equal(casesOf(markup, R).at(-1)?.[0], "deep pass");
    });

    it("reads a case with no describe under its file's name", () => {
      assert.deepEqual(levelsOf(markup, R).slice(0, 2), [
        "links.test.ts 1 passed, 1 failed",
        "other.test.ts 0 passed, 1 skipped",
      ]);
    });

    it("reads each case's result and time", () => {
      assert.deepEqual(casesOf(markup, R), [
        ['fails <a> "q" & so on', "failed", "1.50 s"],
        ["passes", "passed", "3 ms"],
        ["skipped", "skipped", "0 ms"],
        ["deep pass", "passed", "0 ms"],
      ]);
    });

    it("keeps what a failed case said, its markup shown as text", () => {
      assert.equal(failureOf(markup, R), "1 == 2 and 3 > 2");
    });
  });

  describe("with a pytest report", () => {
    let markup: string;
    let hrefs: readonly string[];

    before(async () => {
      const built = await pageWith({
        vocabulary: { report: PYTEST, ...OTHER_RUN },
      });
      markup = built.markup;
      hrefs = built.page.hrefs;
    });

    it("reads each case under its module's file", () => {
      assert.deepEqual(levelsOf(markup, V), [
        "test_naming.py 1 passed",
        "test_queries.py 0 passed, 1 failed, 1 skipped",
      ]);
      assert.deepEqual(casesOf(markup, V), [
        ["test_a_name[record-from-server]", "passed", "12 ms"],
        ["test_gone", "failed", "200 ms"],
        ["test_later", "skipped", "0 ms"],
      ]);
    });

    it("links the module's file at the commit run", () => {
      assert.ok(
        hrefs.includes(
          `https://github.com/jayostis/cascade-vocabulary/blob/${OTHER_RUN.commit}/tests/test_queries.py`,
        ),
      );
    });

    it("keeps the assertion's explanation", () => {
      assert.equal(failureOf(markup, V), "assert 1 == 2 + where 1 = f()");
    });
  });

  describe("with a pytest report that carries the hook's properties", () => {
    let built: Awaited<ReturnType<typeof pageOfOther>>;

    before(async () => {
      built = await pageOfOther("someone/py-thing", "pytest", PYTEST_XUNIT1, {
        capabilities: ["Importing a record"],
      });
    });

    it("reads the capability and situation the properties name, with the capability's description", () => {
      assert.deepEqual(levelsOf(built.markup, built.name), [
        "Importing a record 2 passed, 1 failed",
        "when the record is unclaimed 2 passed, 1 failed",
        "test_pod.py 0 passed, 1 skipped",
      ]);
      assert.match(text(built.part), /What importing does\./);
    });

    it("names a parametrised case by its title and its parameter", () => {
      assert.deepEqual(
        casesOf(built.markup, built.name).filter(([name]) =>
          name?.startsWith("keeps it"),
        ),
        [
          ["keeps it (a)", "passed", "11 ms"],
          ["keeps it (b)", "passed", "10 ms"],
        ],
      );
    });

    it("links a case at its line and a capability at its own", () => {
      for (const link of ["tests/test_pod.py#L18", "tests/test_pod.py#L4"])
        assert.ok(
          built.page.hrefs.includes(
            `https://github.com/someone/py-thing/blob/${RUN.commit}/${link}`,
          ),
          link,
        );
    });
  });

  describe("readJunit(xml)", () => {
    it("reads a pytest case with no properties under its classes, at its line counted from 1", () => {
      const bare = PYTEST_XUNIT1.replace(/<properties>.*?<\/properties>/g, "");
      const [first] = readJunit(bare).cases;
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

    it("reads a module that failed to collect as a failed case in the module's file", () => {
      const [broken] = readJunit(
        `<testsuites name="pytest tests"><testsuite name="pytest" timestamp="t"><testcase classname="" name="tests.test_broken" time="0.000"><error message="collection failure">ImportError</error></testcase></testsuite></testsuites>`,
      ).cases;
      assert.equal(broken?.file, "tests/test_broken.py");
      assert.equal(broken?.result, "failed");
    });
  });

  describe("with a vitest report", () => {
    it("reads nested suites as capability and situation, and a case outside them under its file", async () => {
      const { markup, name, page, part } = await pageOfOther(
        "someone/vi-thing",
        "vitest",
        VITEST,
      );
      assert.deepEqual(levelsOf(markup, name), [
        "Importing a record 1 passed, 1 failed, 1 skipped",
        "when the pod is empty 1 passed, 1 failed",
        "a.test.ts 1 passed",
      ]);
      assert.deepEqual(casesOf(markup, name), [
        ['refuses a <gap> & "so"', "failed", "10 ms"],
        ["keeps it", "passed", "4 ms"],
        ["later", "skipped", "0 ms"],
        ["stands alone", "passed", "0 ms"],
      ]);
      assert.ok(
        page.hrefs.includes(
          `https://github.com/someone/vi-thing/blob/${RUN.commit}/test/a.test.ts#L5`,
        ),
      );
      assert.match(text(part), /expected 1 to be 2/);
    });
  });

  describe("with a nextest report", () => {
    let built: Awaited<ReturnType<typeof pageOfOther>>;

    before(async () => {
      built = await pageOfOther("someone/rs-thing", "nextest", NEXTEST);
    });

    it("reads the modules below `tests` as the levels its properties name, and a test with none under its binary", () => {
      assert.deepEqual(levelsOf(built.markup, built.name), [
        "Naming a record 1 passed, 1 failed",
        "when the selector has a pipe 1 passed, 1 failed",
        "cascade-bridge-cli::node_host 1 passed",
      ]);
      assert.deepEqual(casesOf(built.markup, built.name), [
        ["keeps_the_base", "failed", "3 ms"],
        ["escapes it", "passed", "2 ms"],
        ["runs_the_host", "passed", "40 ms"],
      ]);
      assert.match(text(built.part), /assertion failed: kept/);
    });

    it("links a case in the source file a property names", () => {
      for (const link of [
        "crates/bridge/src/naming.rs#L40",
        "crates/bridge/src/naming.rs#L1",
      ])
        assert.ok(
          built.page.hrefs.includes(
            `https://github.com/someone/rs-thing/blob/${RUN.commit}/${link}`,
          ),
          link,
        );
    });
  });
});

/**
 * node:test's JUnit drops a failure that belongs to no case: a hook that throws, or a test that fails after its
 * subtests. The report's count still includes it, so the page compares the two and says when they differ.
 */
describe("Failures node:test leaves out of its report · declaredFailures()", () => {
  describe("with a report that counts more failures than it lists", () => {
    let built: Awaited<ReturnType<typeof pageWith>>;

    before(async () => {
      built = await pageWith({
        runtime: { report: NODE_UNLISTED, ...RUN },
      });
    });

    it("says how many failures node counts and how many the report lists", () => {
      assert.match(built.page.said, /3 cases: 3 passed, 0 failed, 0 skipped/);
      assert.match(
        built.page.said,
        /node counts 1 failure but the report lists 0 failed cases/,
      );
    });

    it("links the run's log", () => {
      assert.ok(partOf(built.markup, R).includes(`<a href="${RUN.url}">`));
    });
  });

  describe("with a report whose count is its failed cases and the tests that hold them", () => {
    it("says nothing", async () => {
      const { page } = await pageWith({
        runtime: { report: NODE_ORDINARY_FAILURES, ...RUN },
      });
      assert.match(page.said, /3 cases: 0 passed, 3 failed, 0 skipped/);
      assert.doesNotMatch(page.said, /node counts|Failed outside/);
    });
  });
});
