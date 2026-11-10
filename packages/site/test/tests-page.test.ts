import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { suitesOf } from "../src/hub/tests.js";
import { NODE, PYTEST } from "./runner-reports.js";
import { readPage } from "./page.js";
import {
  casesOf,
  OTHER_RUN,
  PATH,
  pageOf,
  pageWith,
  partOf,
  R,
  RUN,
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

    it("throws for a runner it cannot read", () => {
      assert.throws(
        () => suitesOf([{ ...VOCABULARY, runner: "jest" }]),
        /names the runner jest, which is not one of node:test, pytest, vitest, nextest/,
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
