import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { suitesOf } from "../src/hub/tests.js";
import { NODE, PYTEST } from "./runner-reports.js";
import { readPage } from "./page.js";
import {
  barOf,
  casesOf,
  CTRF_NAME,
  CTRF_REPORT,
  CTRF_SUITE,
  timedCtrf,
  unmeasuredCtrf,
  ctrfOf,
  levelsOf,
  OTHER_RUN,
  PATH,
  pageOf,
  pageWith,
  partOf,
  R,
  RUN,
  skipReasonsOf,
  suite,
  text,
  V,
  VOCABULARY,
} from "./tests-page.js";

/**
 * The site shows the newest run on `main` of each repository whose tests it lists, a page for each at
 * `conformance/tests/<repository>/`. A suite whose report is missing or cannot be read still gets its page, which says so.
 */
describe("A page of test results for each repository · testsSection", () => {
  describe("testsSection.build(ctx)", () => {
    const NAMES = ["one", "two", "three"];
    let built: Awaited<ReturnType<typeof pageWith>>;

    before(async () => {
      built = await pageWith(
        {},
        NAMES.map((name, at) => ({
          suite: suite(`someone/${name}`, "node:test"),
          ...(at === 2
            ? {}
            : {
                run: {
                  ...RUN,
                  report: NODE,
                  url: `https://github.com/someone/${name}/actions/runs/7`,
                },
              }),
        })),
      );
    });

    it("writes each suite's page at `conformance/tests/<repository's name>/index.html`", () => {
      for (const name of NAMES)
        assert.ok(built.tree.has(pageOf(name)), `${name}'s page is written`);
    });

    it("writes no index above the pages", () => {
      assert.ok(!built.tree.has("conformance/tests/index.html"));
    });

    it("lists each suite's page on the front page", () => {
      const front = new TextDecoder().decode(built.tree.get("index.html"));
      for (const name of [R, V, ...NAMES])
        assert.ok(
          front.includes(`href="conformance/tests/${name}/"`),
          `the front page links ${name}'s page`,
        );
    });
  });

  describe("with a run's report", () => {
    let built: Awaited<ReturnType<typeof pageWith>>;

    before(async () => {
      built = await pageWith({
        runtime: { report: NODE, ...RUN },
        vocabulary: { report: PYTEST, ...OTHER_RUN },
      });
    });

    it("names the run's commit, linked to it on GitHub", () => {
      assert.ok(
        built.page.hrefs.includes(
          `https://github.com/jayostis/cascade-runtime-js/commit/${RUN.commit}`,
        ),
      );
      assert.ok(
        built.page.hrefs.includes(
          `https://github.com/jayostis/cascade-vocabulary/commit/${OTHER_RUN.commit}`,
        ),
      );
      assert.match(built.page.said, /0123456/);
      assert.match(built.page.said, /fedcba9/);
    });

    it("says when the run was made", () => {
      assert.match(built.markup, /<time datetime="2026-11-04T22:12:35Z">/);
      assert.match(built.markup, /<time datetime="2026-11-03T03:17:00Z">/);
    });

    it("links the run", () => {
      assert.ok(built.page.hrefs.includes(RUN.url));
      assert.ok(built.page.hrefs.includes(OTHER_RUN.url));
    });

    it("counts the cases that passed, failed and were skipped", () => {
      assert.match(built.page.said, /4 cases: 2 passed, 1 failed, 1 skipped/);
      assert.match(built.page.said, /3 cases: 1 passed, 1 failed, 1 skipped/);
    });
  });

  describe("with skipped cases", () => {
    const SKIPS = `<?xml version="1.0"?><testsuites name="pytest tests"><testsuite name="pytest"><testcase classname="tests.test_a" name="test_message"><skipped type="pytest.skip" message="no cascade-vocabulary checkout &amp; so on"/></testcase><testcase classname="tests.test_a" name="test_text"><skipped type="pytest.skip">only in the text</skipped></testcase><testcase classname="tests.test_a" name="test_bare"><skipped/></testcase></testsuite></testsuites>`;

    it("shows each reason as a short line: the message, else the element's text, else none", async () => {
      const { markup } = await pageWith({
        vocabulary: { report: SKIPS, ...OTHER_RUN },
      });
      assert.deepEqual(skipReasonsOf(markup, V), [
        "no cascade-vocabulary checkout & so on",
        "only in the text",
      ]);
      assert.doesNotMatch(markup, /<pre class="failure">/);
    });

    it("gives each reason as the CTRF entry's message: the message, else the element's text, else none", async () => {
      const { tree } = await pageWith({
        vocabulary: { report: SKIPS, ...OTHER_RUN },
      });
      assert.deepEqual(
        ctrfOf(tree, V).results.tests.map(({ name, status, message }) => [
          name,
          status,
          message,
        ]),
        [
          ["test_message", "skipped", "no cascade-vocabulary checkout & so on"],
          ["test_text", "skipped", "only in the text"],
          ["test_bare", "skipped", undefined],
        ],
      );
    });
  });

  describe("when the build was given no report for a suite", () => {
    it("says the results are not available", async () => {
      const { markup } = await pageWith({});
      assert.match(
        text(partOf(markup, R)),
        /Not available: this build was given no report of the newest run of the runtime's tests/,
      );
      assert.match(
        text(partOf(markup, V)),
        /Not available: this build was given no report of the newest run of the vocabulary's tests/,
      );
      assert.deepEqual(casesOf(markup, R), []);
    });
  });

  describe("with a report that is not XML", () => {
    it("says the report cannot be read, beside a link to the run", async () => {
      const { markup } = await pageWith({
        runtime: { report: "not xml at all", ...RUN },
      });
      const part = partOf(markup, R);
      assert.match(text(part), /the report of that run cannot be read/);
      assert.ok(readPage(part, PATH).hrefs.includes(RUN.url));
    });
  });

  describe("with a report cut short", () => {
    it("says the report is cut short", async () => {
      const { markup } = await pageWith({
        vocabulary: { report: PYTEST.slice(0, 400), ...OTHER_RUN },
      });
      assert.match(
        text(partOf(markup, V)),
        /Not available: the report of that run cannot be read \(the report is cut short\)/,
      );
    });
  });

  describe("with a suite whose report is CTRF", () => {
    const barFor = async (report: string) =>
      barOf(
        (await pageWith({}, [{ suite: CTRF_SUITE, run: { ...RUN, report } }]))
          .markup,
        CTRF_NAME,
      );

    it("shows no time for a report whose cases were not timed and that gives no run time", async () => {
      const { bar } = await barFor(unmeasuredCtrf());
      assert.doesNotMatch(bar, /class="duration"/);
    });

    it("shows the run time between its start and stop, not the cases' unmeasured zeros", async () => {
      const { said } = await barFor(unmeasuredCtrf(1000, 4500));
      assert.match(said, /3\.50 s/);
      assert.doesNotMatch(said, /\b0 ms/);
    });

    it("shows each case's time and, with no start and stop, their sum as the run time", async () => {
      const report = timedCtrf([2500, 40]);
      const { markup } = await pageWith({}, [
        { suite: CTRF_SUITE, run: { ...RUN, report } },
      ]);
      assert.deepEqual(
        casesOf(markup, CTRF_NAME)
          .map(([name, , time]) => [name, time])
          .sort(),
        [
          ["example-0001", "2.50 s"],
          ["example-0002", "40 ms"],
        ],
      );
      assert.match((await barFor(report)).said, /2.54 s/);
    });

    it("shows the producer's run time in the bar, not the sum of its cases, when it gives start and stop", async () => {
      const { said } = await barFor(timedCtrf([2500, 40], 1000, 9000));
      assert.match(said, /8.00 s/);
    });

    it("shows the same bar and keeps the producer's case durations when its republished CTRF is read back", async () => {
      const report = timedCtrf([2500, 0.4, 1.5]);
      const first = await pageWith({}, [
        { suite: CTRF_SUITE, run: { ...RUN, report } },
      ]);
      const written = ctrfOf(first.tree, CTRF_NAME);
      assert.deepEqual(
        written.results.tests.map((t) => t.duration),
        [2500, 0.4, 1.5],
      );
      const again = (await barFor(JSON.stringify(written))).said;
      assert.equal(again, (await barFor(report)).said);
      assert.match(again, /2.50 s/);
    });

    it("shows no time on a case of a report marked unmeasured", async () => {
      const { markup } = await pageWith({}, [
        {
          suite: CTRF_SUITE,
          run: { ...RUN, report: unmeasuredCtrf(1000, 4500) },
        },
      ]);
      assert.ok(casesOf(markup, CTRF_NAME).every(([, , time]) => time === ""));
    });

    it("shows its cases under the levels the report names", async () => {
      const { markup } = await pageWith({}, [
        { suite: CTRF_SUITE, run: { ...RUN, report: CTRF_REPORT } },
      ]);
      const levels = levelsOf(markup, CTRF_NAME).join("\n");
      assert.match(levels, /synthetic adapter fixture cases/);
      assert.match(levels, /with engine on native/);
      assert.deepEqual(
        casesOf(markup, CTRF_NAME).map(([name, result]) => [name, result]),
        [
          ["example-0001", "failed"],
          ["example-0003", "passed"],
        ],
      );
      assert.ok(
        readPage(partOf(markup, CTRF_NAME), PATH).hrefs.includes(
          `https://github.com/jayostis/cascade-bridge-adapter-fhir-r4/blob/${RUN.commit}/fixtures/manifest.ttl#L42`,
        ),
      );
    });
  });

  describe("with a report that holds no cases", () => {
    it('says "0 cases"', async () => {
      const { markup } = await pageWith({
        runtime: {
          report: `<testsuites><testsuite name="pytest" tests="0"></testsuite></testsuites>`,
          ...RUN,
        },
      });
      assert.match(text(partOf(markup, R)), /0 cases: 0 passed/);
    });
  });
});

/**
 * `packages/site/test-suites.json` lists each repository whose tests get a page: where the site's build finds its newest report,
 * which runner wrote it, and in what order its packages are shown. `suitesOf()` reads the list and refuses an entry the
 * build could not use.
 */
describe("Listing the repositories whose tests are shown · suitesOf(), test-suites.json", () => {
  describe("suitesOf(list)", () => {
    it("keeps the test folder a suite names", () => {
      assert.deepEqual(
        suitesOf([{ ...VOCABULARY, tests: "host/test/" }]).map(
          (one) => one.tests,
        ),
        ["host/test/"],
      );
    });

    it("keeps the order of the packages a suite lists", () => {
      assert.deepEqual(
        suitesOf([{ ...VOCABULARY, packages: ["b", "a"] }])[0]?.packages,
        ["b", "a"],
      );
    });

    it("throws, naming the field, for a suite that lacks one", () => {
      assert.throws(
        () => suitesOf([{ ...VOCABULARY, artifact: undefined }]),
        /suite 1 of the list names no artifact/,
      );
    });

    it("reads a suite whose runner is `ctrf`", () => {
      assert.equal(
        suitesOf([{ ...VOCABULARY, runner: "ctrf" }])[0]?.runner,
        "ctrf",
      );
    });

    it("throws for a runner it cannot read", () => {
      assert.throws(
        () => suitesOf([{ ...VOCABULARY, runner: "jest" }]),
        /names the runner jest, which is not one of node:test, pytest, vitest, nextest, ctrf/,
      );
    });

    it('throws for a test folder that is not text ending in "/"', () => {
      for (const tests of [3, "host/test"])
        assert.throws(
          () => suitesOf([{ ...VOCABULARY, tests }]),
          /names the tests .*, which is not a folder ending in \//,
          String(tests),
        );
    });

    it("throws for a repository that is not `owner/name`", () => {
      assert.throws(
        () => suitesOf([{ ...VOCABULARY, repository: "cascade-vocabulary" }]),
        /names the repository cascade-vocabulary, which is not owner\/name/,
      );
    });

    it("throws for `packages` that is not a list of names", () => {
      for (const packages of ["site", [3], [""], { site: 1 }])
        assert.throws(
          () => suitesOf([{ ...VOCABULARY, packages }]),
          /which is not a list of package names/,
          JSON.stringify(packages),
        );
    });

    it("throws for a list that is not a list", () => {
      for (const list of [{}, "x", null])
        assert.throws(() => suitesOf(list), /the suite list is not a list/);
    });
  });
});

const checkedIn = (): ReturnType<typeof suitesOf> =>
  suitesOf(
    JSON.parse(
      readFileSync(new URL("../../test-suites.json", import.meta.url), "utf8"),
    ),
  );

/**
 * The list as it is in the repository, which the site's build reads to find each repository's newest report: a refusal here
 * would stop the site from building.
 */
describe("The suite list as checked in · test-suites.json", () => {
  describe("suitesOf(list)", () => {
    it("reads the checked-in list without a refusal, the runtime's suite in it", () => {
      const listed = checkedIn();
      assert.ok(
        listed.some((one) => one.repository === "jayostis/cascade-runtime-js"),
      );
    });

    it("lists for the runtime's suite exactly the folders of `packages/`", () => {
      const runtime = checkedIn().find(
        (one) => one.repository === "jayostis/cascade-runtime-js",
      );
      const folders = readdirSync(new URL("../../../", import.meta.url), {
        withFileTypes: true,
      })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      assert.deepEqual([...(runtime?.packages ?? [])].sort(), folders.sort());
    });
  });
});
