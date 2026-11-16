import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { Suite } from "../src/hub/context.js";
import { described, FILE, leafOf, report } from "./report.js";
import { NODE, NODE_UNLISTED, PYTEST, VITEST } from "./runner-reports.js";
import {
  barOf,
  casesOf,
  DESCRIBED,
  FOUR_PACKAGES,
  GROUPED,
  groupedWith,
  levelsOf,
  OTHER_RUN,
  packagesOf,
  pageWith,
  partOf,
  pod,
  promisesOf,
  R,
  RUN,
  RUNTIME,
  rowsOf,
  suite,
  text,
  THREE_PACKAGES,
  V,
  verdictOf,
  versioned,
  WIDE_PACKAGE,
  WITH_GLOSSARY,
} from "./tests-page.js";
import { SCRIPT } from "../src/hub/tests.js";

const A = FILE("cascade-runtime", "a.test");
const BASE = `https://github.com/jayostis/cascade-runtime-js/blob/${RUN.commit}/packages/cascade-runtime/test/`;

/**
 * A page reads top to bottom as a specification: each package, its capabilities in the order its `test/spec.json` gives,
 * the situations under each, and the cases. Build checks come last, closed, since they are not part of the specification.
 */
describe("Packages, capabilities and situations as a tree · testsSection, spec.json", () => {
  describe("with cases in several packages", () => {
    const LISTING: Suite = {
      ...RUNTIME,
      packages: ["cascade-runtime", "site"],
    };

    it("shows a package that holds a failed case first", async () => {
      const unlisted = await pageWith({ runtime: { report: NODE, ...RUN } });
      assert.deepEqual(packagesOf(unlisted.markup, R), ["site", "runtime"]);

      const listed = await pageWith(
        { runtime: { report: FOUR_PACKAGES("runtime"), ...RUN } },
        [],
        LISTING,
      );
      assert.equal(packagesOf(listed.markup, R)[0], "runtime");
    });

    it("shows the packages a suite lists in the order it lists them", async () => {
      const { markup } = await pageWith(
        { runtime: { report: FOUR_PACKAGES(), ...RUN } },
        [],
        LISTING,
      );
      assert.deepEqual(packagesOf(markup, R).slice(0, 2), [
        "cascade-runtime",
        "site",
      ]);
    });

    it("shows a package the suite does not list after the listed, by name", async () => {
      const { markup } = await pageWith(
        { runtime: { report: FOUR_PACKAGES(), ...RUN } },
        [],
        LISTING,
      );
      assert.deepEqual(packagesOf(markup, R).slice(2), [
        "apple-health",
        "runtime",
      ]);
    });
  });

  describe("with several packages: the table that opens the page", () => {
    let markup: string;
    let rows: ReturnType<typeof rowsOf>;

    before(async () => {
      ({ markup } = await pageWith({
        runtime: { report: THREE_PACKAGES(), ...RUN },
      }));
      rows = rowsOf(markup, R);
    });

    it("has one row for each package, the one holding a failure first", () => {
      assert.deepEqual(
        rows.map((row) => row.package),
        ["beta", "alpha", "gamma"],
      );
    });

    it("turns the row of a package holding a failure red and says how many failed", () => {
      assert.deepEqual(
        rows.map((row) => [row.failing, row.failed]),
        [
          [true, 1],
          [false, 0],
          [false, 0],
        ],
      );
      assert.match(rows[0]?.cases ?? "", /^2 .*1 failed/);
      assert.doesNotMatch(rows[1]?.cases ?? "", /failed/);
    });

    it("says what each package is for, and its case count", () => {
      assert.equal(rows[0]?.about, "Checks a record against its shape.");
      assert.equal(rows[1]?.about, "Reads what a hospital sends.");
      assert.equal(rows[2]?.about, "");
      assert.match(rows[1]?.cases ?? "", /^4$/);
    });

    it("links each capability, in the order the package's spec gives, to its id on the page", () => {
      assert.deepEqual(
        rows[1]?.capabilities.map((one) => one.label),
        ["Reading a record", "Writing a record"],
      );
      for (const { id } of rows.flatMap((row) => row.capabilities))
        assert.ok(
          markup.includes(`<li class="capability" id="${id}"`),
          `${id} is a capability of the page`,
        );
      assert.deepEqual(
        rows[1]?.capabilities.map((one) => one.id),
        [
          "capability-alpha-reading-a-record",
          "capability-alpha-writing-a-record",
        ],
      );
    });

    it("links each package to its section, which starts open only where a case failed", () => {
      assert.equal(rows.length, 3);
      for (const row of rows)
        assert.ok(
          partOf(markup, R).includes(
            `<section class="pkg" id="${row.href}" data-failed="${row.failed}"><details${row.failing ? " open" : ""}>`,
          ),
          `${row.package}'s section`,
        );
    });

    it("does not list the build capabilities among a package's", () => {
      assert.equal(rows.length, 3);
      assert.ok(!rows[1]?.capabilities.some((one) => one.label === "Packing"));
    });

    it("heads the table with what each package promises, and how many packages and capabilities there are", () => {
      assert.equal(
        promisesOf(markup, R),
        "What each package promises · 3 packages, 4 capabilities",
      );
    });

    it("labels each cell, so that the table stacked on a narrow screen says what a number is", () => {
      for (const row of rows)
        assert.deepEqual(row.labels, [
          "What it is for",
          "Capabilities",
          "Cases",
        ]);
    });

    it("turns red the link of the capability that failed, and no other", () => {
      assert.deepEqual(
        rows.flatMap((row) =>
          row.capabilities.filter((one) => one.failed).map((one) => one.label),
        ),
        ["Checking a shape"],
      );
    });
  });

  describe("with a package of more capabilities than a row shows", () => {
    const shown = async (failing?: number) => {
      const rows = rowsOf(
        (
          await pageWith({
            runtime: { report: WIDE_PACKAGE(failing), ...RUN },
          })
        ).markup,
        R,
      );
      return {
        wide: rows.find((row) => row.package === "wide"),
        narrow: rows.find((row) => row.package === "narrow"),
      };
    };

    it("shows the first six, and says how many more there are, linking the package", async () => {
      const { wide, narrow } = await shown();
      assert.deepEqual(
        wide?.capabilities.map((one) => one.label),
        Array.from({ length: 6 }, (_, n) => `Capability ${n + 1}`),
      );
      assert.deepEqual(wide?.more, {
        href: "package-wide",
        said: "and 3 more",
      });
      assert.equal(narrow?.capabilities.length, 2);
      assert.equal(narrow?.more, undefined);
    });

    it("gives only the first sentence of what a package is for", async () => {
      const { wide } = await shown();
      assert.equal(wide?.about, "Says what it does.");
    });

    it("shows a capability that failed, before the others, though it is beyond the sixth", async () => {
      const { wide } = await shown(9);
      assert.deepEqual(
        wide?.capabilities.map((one) => [one.label, one.failed]),
        [
          ["Capability 9", true],
          ["Capability 1", false],
          ["Capability 2", false],
          ["Capability 3", false],
          ["Capability 4", false],
          ["Capability 5", false],
        ],
      );
      assert.equal(wide?.more?.said, "and 3 more");
    });
  });

  describe("with one package", () => {
    it("has no table and no package level: the page starts at the capabilities", async () => {
      const { markup } = await pageWith({
        runtime: { report: GROUPED, ...RUN },
      });
      const part = partOf(markup, R);
      assert.doesNotMatch(part, /<table class="packages">/);
      assert.deepEqual(packagesOf(markup, R), []);
      assert.match(text(part), /The library an app calls\./);
      assert.match(part, /<li class="capability"/);
    });
  });

  describe("with a package's `spec.json`", () => {
    let markup: string;
    let levels: string[];
    const placeOfCapability = (name: string): number =>
      levels.findIndex((level) => level.startsWith(`${name} `));

    before(async () => {
      ({ markup } = await pageWith({ runtime: { report: GROUPED, ...RUN } }));
      levels = levelsOf(markup, R);
    });

    it("shows the package's `about` line", () => {
      assert.match(text(partOf(markup, R)), /The library an app calls\./);
    });

    it("groups a capability's cases from several files under one heading", () => {
      assert.equal(
        levels.filter((level) => level === "Importing a health export 2 passed")
          .length,
        1,
      );
    });

    it("orders the capabilities as `capabilities` lists them", () => {
      assert.ok(
        placeOfCapability("Looking up a term") <
          placeOfCapability("Importing a health export"),
        "the report writes them the other way round",
      );
    });

    it("puts a capability the list lacks after the listed ones, by name", () => {
      const listed = placeOfCapability("Importing a health export");
      const apple = placeOfCapability("Apple capability");
      const zebra = placeOfCapability("Zebra capability");
      assert.ok(listed < apple && apple < zebra, levels.join("\n"));
    });

    it("puts the capabilities `build` names last, in a section that starts closed", () => {
      assert.ok(
        placeOfCapability("Build and packaging") >
          placeOfCapability("Zebra capability"),
      );
      assert.ok(
        placeOfCapability("Packing") > placeOfCapability("Build and packaging"),
      );
      assert.ok(partOf(markup, R).includes('<details class="build">'));
    });

    it("opens the build section when a case in it failed", async () => {
      const failed = await pageWith({
        runtime: { report: groupedWith("broke"), ...RUN },
      });
      assert.ok(
        partOf(failed.markup, R).includes('<details class="build" open>'),
      );
    });
  });

  describe("with a package's version", () => {
    const said = async (version: string): Promise<string> =>
      (await pageWith({ runtime: { report: versioned(version), ...RUN } })).page
        .said;
    const UNRELEASED =
      /unreleased: what main does today, not a compatibility promise/;

    it("names the package, its version and the commit", async () => {
      const line = await said("0.0.0");
      assert.match(line, /cascade-runtime 0\.0\.0/);
      assert.match(line, /0123456/);
    });

    it('says "unreleased" for 0.0.0', async () => {
      assert.match(await said("0.0.0"), UNRELEASED);
    });

    it('says "unreleased" for a prerelease', async () => {
      assert.match(await said("1.2.0-rc.1"), UNRELEASED);
    });

    it("says no more than the version for a release", async () => {
      const line = await said("1.2.0");
      assert.match(line, /cascade-runtime 1\.2\.0/);
      assert.doesNotMatch(line, /unreleased/);
    });
  });

  describe("with a capability", () => {
    let groupedPage: Awaited<ReturnType<typeof pageWith>>;
    let describedPage: Awaited<ReturnType<typeof pageWith>>;

    before(async () => {
      groupedPage = await pageWith({ runtime: { report: GROUPED, ...RUN } });
      describedPage = await pageWith({
        runtime: { report: DESCRIBED, ...RUN },
      });
    });

    it("shows its description, paragraph by paragraph", () => {
      const part = partOf(groupedPage.markup, R);
      assert.ok(
        part.includes('<p class="what">Reads an export into the pod.</p>'),
      );
      assert.ok(part.includes('<p class="what">The pod keeps it.</p>'));
    });

    it("links each file it comes from, at the line it starts on there", () => {
      assert.ok(groupedPage.page.hrefs.includes(`${BASE}pod.test.ts#L4`));
      assert.ok(groupedPage.page.hrefs.includes(`${BASE}pod-more.test.ts#L30`));
    });

    it("shows the API names after its dot as code", async () => {
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
    });

    it("names the capability once, not on each case", () => {
      const said = text(partOf(describedPage.markup, R));
      assert.equal((said.match(/a pod/g) ?? []).length, 1);
    });

    it("counts the passed and failed cases under each level", () => {
      const said = text(partOf(describedPage.markup, R));
      assert.match(
        said.slice(said.indexOf("a pod")),
        /^a pod\b.{0,40}1 passed.{0,20}1 failed/,
      );
    });

    it("shows a situation's description", () => {
      assert.match(
        text(partOf(groupedPage.markup, R)),
        /A patient nobody claimed\./,
      );
    });
  });

  describe("with a case", () => {
    it("shows a failed case before a passed one", async () => {
      const { markup } = await pageWith({
        runtime: { report: DESCRIBED, ...RUN },
      });
      assert.deepEqual(
        casesOf(markup, R).map(([name]) => name),
        ["rejects a gap", "accepts a record"],
        "the file writes the passed case first",
      );
    });

    it("links the case to its line at the commit run", async () => {
      const { page } = await pageWith({
        runtime: { report: DESCRIBED, ...RUN },
      });
      assert.ok(
        page.hrefs.includes(`${BASE}pod.test.ts#L20`),
        "the failed case",
      );
      assert.ok(
        page.hrefs.includes(`${BASE}pod.test.ts#L10`),
        "the passed case",
      );
    });

    it("shows the case's own description", async () => {
      const { markup } = await pageWith({
        runtime: { report: GROUPED, ...RUN },
      });
      assert.match(text(partOf(markup, R)), /Nothing is dropped\./);
    });

    it("shows its result as an icon and a word", async () => {
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

    it("opens a situation only when a case in it failed", async () => {
      const { markup } = await pageWith({
        runtime: {
          report: report(
            "",
            described(
              "Cap one",
              { line: 1 },
              described(
                "when x",
                { line: 3 },
                leafOf("good", A, 5) +
                  leafOf("bad", A, 9, { failure: "broke" }),
              ) + described("when y", { line: 11 }, leafOf("fine", A, 12)),
            ),
          ),
          ...RUN,
        },
      });
      assert.match(
        markup,
        /<details open><summary><span class="level-name">when x</,
      );
      assert.match(
        markup,
        /<details><summary><span class="level-name">when y</,
      );
    });

    it("orders passed cases as their file writes them", async () => {
      const file = FILE("cascade-runtime", "order.test");
      const { markup } = await pageWith({
        runtime: {
          report: report(
            "",
            described(
              "Cap",
              { line: 1 },
              leafOf("written second", file, 30) +
                leafOf("written first", file, 10),
            ),
          ),
          ...RUN,
        },
      });
      assert.deepEqual(
        casesOf(markup, R).map(([name]) => name),
        ["written first", "written second"],
        "the report lists them the other way round",
      );
    });
  });

  describe("with more than 30 cases directly under one level", () => {
    const FIRST = FILE("cascade-runtime", "one.test");
    const SECOND = FILE("cascade-runtime", "two.test");
    /** `n` cases of one test run with different parameters, as a parametrized test reports them. */
    const params = (
      name: string,
      file: string,
      line: number,
      n: number,
      failing = 0,
    ) =>
      Array.from({ length: n }, (_, at) =>
        leafOf(
          `${name} [p${at + 1}]`,
          file,
          line,
          at + 1 === failing ? { failure: "broke" } : {},
        ),
      ).join("");
    const pageOfLevel = async (inner: string) =>
      (
        await pageWith({
          runtime: {
            report: report(
              "",
              described("Cap", {}, described("when many", {}, inner)),
            ),
            ...RUN,
          },
        })
      ).markup;

    it("folds the cases of each test run with parameters under a level of that test's name", async () => {
      const markup = await pageOfLevel(
        params("does a", FIRST, 3, 12) +
          params("does b", FIRST, 9, 12) +
          params("does c", FIRST, 15, 12),
      );
      assert.deepEqual(levelsOf(markup, R), [
        "Cap 36 passed",
        "when many 36 passed",
        "does a 12 passed",
        "does b 12 passed",
        "does c 12 passed",
      ]);
      assert.equal(casesOf(markup, R).length, 36);
    });

    it("leaves 30 cases as they are", async () => {
      const markup = await pageOfLevel(
        params("does a", FIRST, 3, 15) + params("does b", FIRST, 9, 15),
      );
      assert.deepEqual(levelsOf(markup, R), [
        "Cap 30 passed",
        "when many 30 passed",
      ]);
    });

    it("opens, and shows first, the folded level that holds a failed case", async () => {
      const markup = await pageOfLevel(
        params("does a", FIRST, 3, 12) +
          params("does b", FIRST, 9, 12, 5) +
          params("does c", FIRST, 15, 12),
      );
      assert.deepEqual(levelsOf(markup, R).slice(2), [
        "does b 11 passed, 1 failed",
        "does a 12 passed",
        "does c 12 passed",
      ]);
      assert.match(
        markup,
        /<details open><summary><span class="level-name">does b</,
      );
      assert.match(
        markup,
        /<details><summary><span class="level-name">does a</,
      );
    });

    it("marks a folded level that failed nothing, so that `failures only` hides it", async () => {
      const markup = await pageOfLevel(
        params("does a", FIRST, 3, 20) + params("does b", FIRST, 9, 20, 1),
      );
      assert.match(
        markup,
        /<li data-group data-failed="0"><details><summary><span class="level-name">does a</,
      );
      assert.match(
        markup,
        /<li data-group data-failed="1"><details open><summary><span class="level-name">does b</,
      );
    });

    it("leaves a test that ran once outside every folded level", async () => {
      const markup = await pageOfLevel(
        params("does a", FIRST, 3, 15) +
          params("does b", FIRST, 9, 15) +
          leafOf("stands alone", FIRST, 20),
      );
      assert.deepEqual(levelsOf(markup, R).slice(2), [
        "does a 15 passed",
        "does b 15 passed",
      ]);
      assert.deepEqual(
        casesOf(markup, R).filter(([name]) => name === "stands alone"),
        [["stands alone", "passed", ""]],
      );
    });

    it("folds the cases of different tests by their file when none is run with parameters", async () => {
      const once = (file: string, from: number, n: number) =>
        Array.from({ length: n }, (_, at) =>
          leafOf(`does ${file.slice(-9)} ${at}`, file, from + at),
        ).join("");
      const markup = await pageOfLevel(
        once(FIRST, 1, 16) + once(SECOND, 1, 15),
      );
      assert.deepEqual(levelsOf(markup, R).slice(2), [
        "one.test.ts 16 passed",
        "two.test.ts 15 passed",
      ]);
    });

    it("leaves the cases of different tests of one file as they are", async () => {
      const markup = await pageOfLevel(
        Array.from({ length: 40 }, (_, at) =>
          leafOf(`does ${at}`, FIRST, at + 1),
        ).join(""),
      );
      assert.deepEqual(levelsOf(markup, R), [
        "Cap 40 passed",
        "when many 40 passed",
      ]);
    });
  });

  describe("with a suite that names its test folder", () => {
    it("shows its files without the folder", async () => {
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
    });
  });

  describe("with a repository other than the runtime's", () => {
    it("reads the whole repository as one package, which has no level of its own", async () => {
      const { markup } = await pageWith({}, [
        {
          suite: suite("someone/host-thing", "vitest"),
          run: {
            ...RUN,
            report: VITEST.replaceAll(
              "test/a.test.ts",
              "packages/a/test/a.test.ts",
            ),
            url: "https://github.com/someone/host-thing/actions/runs/7",
          },
        },
      ]);
      assert.deepEqual(packagesOf(markup, "host-thing"), []);
      assert.doesNotMatch(
        partOf(markup, "host-thing"),
        /<table class="packages">/,
      );
    });
  });

  describe("with a test file outside `packages/<name>/test/`", () => {
    it("shows its cases in one package named for the repository, the other cases staying under `runtime`", async () => {
      const outside = NODE.replace(
        /\/home\/runner\/work\/cascade-runtime-js\/cascade-runtime-js\/packages\/site\/dist\/test\/links\.test\.js/g,
        "/home/runner/work/cascade-runtime-js/cascade-runtime-js/scripts/x.test.js",
      );
      const { markup } = await pageWith({
        runtime: { report: outside, ...RUN },
      });
      assert.deepEqual(packagesOf(markup, R), [R, "runtime"]);
      assert.equal(
        levelsOf(markup, R).filter((level) => level.includes("x.test.js"))
          .length,
        1,
        "both cases are under one level",
      );
    });
  });
});

/**
 * A `@rule` tag in a describe's doc comment names a rule of the vocabulary that the API's behaviour bears on. The page shows it as a
 * link to the rule, so a reader can go from what the package does to the requirement behind it.
 */
describe("Linking a capability to the rules it bears on · @rule", () => {
  describe("with a `@rule` tag that names a feature and a rule", () => {
    it("links the rule on the feature's page", async () => {
      const { page } = await pageWith({
        runtime: { report: GROUPED, ...RUN },
      });
      assert.ok(
        page.hrefs.includes("spec/pod-import.html#r19"),
        page.hrefs.join("\n"),
      );
    });
  });

  describe("with a `@rule` tag that names a kit's feature and one of its checks", () => {
    it("links the kit check on the kit's page", async () => {
      const kit = report(
        "",
        described(
          "Kits",
          { rules: ["conformance/some-kit/some-kit.feature Check 3"] },
          leafOf("runs", pod, 3),
        ),
      );
      const { page } = await pageWith({ runtime: { report: kit, ...RUN } });
      assert.ok(page.hrefs.includes("spec/some-kit.html#check-3"));
    });
  });

  describe("with a description that carries tags", () => {
    it("leaves the tags out of the description", async () => {
      const { markup } = await pageWith({
        runtime: { report: GROUPED, ...RUN },
      });
      assert.doesNotMatch(text(partOf(markup, R)), /@rule/);
    });
  });
});

/**
 * The bar stays at the top of a page while it scrolls: which run this is, how it went and how long it took. Its three
 * buttons need script, so they are hidden until script runs and the page reads whole without them.
 */
describe("The summary bar and its controls · testsSection", () => {
  describe("with a run's cases", () => {
    let markup: string;

    before(async () => {
      ({ markup } = await pageWith({
        runtime: { report: NODE, ...RUN },
        vocabulary: { report: PYTEST, ...OTHER_RUN },
      }));
    });

    it("counts the passed, failed and skipped cases", () => {
      assert.deepEqual(barOf(markup, R).tallies, {
        passed: 2,
        failed: 1,
        skipped: 1,
      });
      assert.deepEqual(barOf(markup, V).tallies, {
        passed: 1,
        failed: 1,
        skipped: 1,
      });
    });

    it("names the run's commit", () => {
      assert.match(barOf(markup, R).said, /0123456/);
      assert.match(barOf(markup, V).said, /fedcba9/);
    });

    it("shows a failed count only when a case failed", async () => {
      const green = await pageWith({
        runtime: { report: versioned("0.0.0"), ...RUN },
      });
      assert.deepEqual(barOf(green.markup, R).tallies, {
        passed: 1,
        skipped: 0,
      });
      assert.equal(barOf(markup, R).tallies["failed"], 1);
    });

    it("shows the run time the report declares", async () => {
      const { markup: declared } = await pageWith({
        runtime: { report: NODE_UNLISTED, ...RUN },
      });
      assert.match(barOf(declared, R).said, /132 ms/);
    });

    it("adds up the cases' times for a report that declares none", () => {
      assert.match(barOf(markup, V).said, /212 ms/);
    });
  });

  describe("with a run's verdict", () => {
    it("says in one line that all cases pass, with the commit, when it was run and how long it took", async () => {
      const { markup } = await pageWith({
        runtime: { report: GROUPED, ...RUN },
      });
      const { result, said } = verdictOf(markup, R);
      assert.equal(result, "passed");
      assert.match(said, /^All 6 cases pass\b/);
      assert.match(said, /0123456/);
      assert.match(said, /2026-11-04 22:12 UTC/);
      assert.doesNotMatch(said, /T22:12:35Z/);
      assert.match(said, /\d+ ms/);
    });

    it("links the run in that line, and says nothing of the run again below it", async () => {
      const { markup } = await pageWith({
        runtime: { report: GROUPED, ...RUN },
      });
      const part = partOf(markup, R);
      const line = /<span class="verdict[\s\S]*?<\/span>\n/.exec(part)?.[0];
      assert.ok(
        line?.includes(`<a href="${RUN.url}">the run</a>`),
        "the verdict links the run",
      );
      assert.equal(part.split(`href="${RUN.url}"`).length - 1, 1);
      assert.doesNotMatch(text(part), /run at|The run of commit/);
    });

    it("says in red how many of the cases fail", async () => {
      const { markup } = await pageWith({
        runtime: { report: NODE, ...RUN },
      });
      const { result, said } = verdictOf(markup, R);
      assert.equal(result, "failed");
      assert.match(said, /^1 of 4 cases fail\b/);
    });

    it("counts a single case in the singular", async () => {
      const one = await pageWith({
        runtime: { report: versioned("1.2.0"), ...RUN },
      });
      assert.match(verdictOf(one.markup, R).said, /^The 1 case passes\b/);
    });

    it("gives the counts once: the verdict, and no sentence repeating them", async () => {
      const { markup } = await pageWith({
        runtime: { report: NODE, ...RUN },
      });
      assert.doesNotMatch(text(partOf(markup, R)), /4 cases: 2 passed/);
      assert.doesNotMatch(text(partOf(markup, R)), /No failures/);
    });
  });

  describe("with the packages a report names", () => {
    it('names the package and its version, tagged "unreleased" for an unreleased one', async () => {
      const { markup } = await pageWith({
        runtime: { report: GROUPED, ...RUN },
      });
      assert.match(barOf(markup, R).said, /cascade-runtime 0\.0\.0 unreleased/);
    });

    it("leaves the tag off a released version", async () => {
      const { markup } = await pageWith({
        runtime: { report: versioned("1.2.0"), ...RUN },
      });
      const { said } = barOf(markup, R);
      assert.match(said, /cascade-runtime 1\.2\.0/);
      assert.doesNotMatch(said, /unreleased/);
    });
  });

  describe("when the page's script has not run", () => {
    let markup: string;

    before(async () => {
      ({ markup } = await pageWith({
        runtime: { report: NODE, ...RUN },
        vocabulary: { report: PYTEST, ...OTHER_RUN },
      }));
    });

    it("hides the three controls: expand all, collapse all, failures only", () => {
      for (const heading of [R, V]) {
        const part = partOf(markup, heading);
        const actions = [
          ...part.matchAll(/<button type="button" data-action="([\w-]+)"/g),
        ].map(([, action]) => action);
        assert.deepEqual(actions, [
          "expand-all",
          "collapse-all",
          "failures-only",
        ]);
        assert.match(part, /<span class="controls" data-controls hidden>/);
      }
    });

    it("hides only the three controls, where the package has no glossary", () => {
      assert.doesNotMatch(
        partOf(markup, R).replace(/<span class="controls"[\s\S]*?<\/span>/, ""),
        /\shidden[\s>]/,
      );
    });
  });

  describe("with a run's cases", () => {
    it("marks each case with its result and each capability with its count of failed cases", async () => {
      const { markup } = await pageWith({
        runtime: { report: NODE, ...RUN },
      });
      const runtime = partOf(markup, R);
      assert.match(runtime, /<li class="case" data-result="failed">/);
      assert.match(runtime, /<li class="case" data-result="passed">/);
      assert.match(
        runtime,
        /<li class="capability" id="[^"]+" data-failed="1">/,
      );
      assert.match(
        runtime,
        /<li class="capability" id="[^"]+" data-failed="0">/,
      );
    });
  });

  describe("with a run that holds no failure", () => {
    it("opens no capability, situation or glossary", async () => {
      const { markup } = await pageWith({
        runtime: { report: WITH_GLOSSARY, ...RUN },
      });
      const part = partOf(markup, R);
      assert.match(part, /<details class="glossary">/);
      assert.match(part, /<li class="capability"/);
      assert.doesNotMatch(part, /<details[^>]* open[ >]/);
    });
  });

  describe("with one failing case", () => {
    it("opens that case's capability and situation and no other", async () => {
      const { markup } = await pageWith({
        runtime: {
          report: report(
            "",
            described(
              "Cap one",
              { line: 1 },
              described(
                "when x",
                { line: 3 },
                leafOf("bad", A, 9, { failure: "broke" }),
              ) + described("when y", { line: 11 }, leafOf("fine", A, 12)),
            ) +
              described(
                "Cap two",
                { line: 20 },
                described("when z", { line: 21 }, leafOf("ok", A, 22)),
              ),
          ),
          ...RUN,
        },
      });
      const part = partOf(markup, R);
      assert.equal(part.match(/<details open>/g)?.length, 2);
      assert.match(
        part,
        /<details open><summary><span class="cap-name">Cap one</,
      );
      assert.match(
        part,
        /<details open><summary><span class="level-name">when x</,
      );
      assert.match(part, /<details><summary><span class="cap-name">Cap two</);
    });
  });

  describe("with capabilities", () => {
    it("gives each a readable id, unique on the page", async () => {
      const { markup } = await pageWith({
        runtime: { report: GROUPED, ...RUN },
      });
      const part = partOf(markup, R);
      const ids = [
        ...part.matchAll(/<li class="capability"[^>]* id="([^"]+)"/g),
      ].map((one) => one[1]);
      const all = part.match(/<li class="capability"/g) ?? [];
      assert.ok(ids.length > 0);
      assert.equal(ids.length, all.length, "every capability has an id");
      assert.equal(new Set(ids).size, ids.length, "ids are unique");
      assert.ok(ids.includes("capability-cascade-runtime-looking-up-a-term"));
    });

    it("keeps an id when functions are added to the heading, and suffixes the second of two with one name", async () => {
      const idsOf = async (...names: string[]): Promise<string[]> => {
        const { markup } = await pageWith({
          runtime: {
            report: report(
              "",
              names
                .map((name) => described(name, {}, leafOf("ok", A, 3)))
                .join(""),
            ),
            ...RUN,
          },
        });
        return [
          ...partOf(markup, R).matchAll(
            /<li class="capability"[^>]* id="([^"]+)"/g,
          ),
        ].map((one) => one[1] ?? "");
      };
      const [plain = ""] = await idsOf("Looking up");
      assert.deepEqual(await idsOf("Looking up · lookUp"), [plain]);
      assert.deepEqual(
        await idsOf("Looking up · lookUp", "Looking up · find"),
        [plain, `${plain}-2`],
      );
    });
  });

  describe("with the page's script", () => {
    interface Node {
      readonly tagName: string;
      open?: boolean;
      readonly parentElement: Node | null;
      scrollIntoView?: () => void;
    }
    const run = (hash: string) => {
      const glossary: Node = {
        tagName: "DETAILS",
        open: false,
        parentElement: null,
      };
      let scrolled = 0;
      const entry: Node = {
        tagName: "DT",
        parentElement: glossary,
        scrollIntoView: () => {
          scrolled++;
        },
      };
      const heard: Record<string, () => void> = {};
      const location = { hash };
      new Function("document", "location", "window", SCRIPT)(
        {
          querySelectorAll: () => [],
          addEventListener: () => undefined,
          getElementById: (id: string) => (id === "entry" ? entry : null),
        },
        location,
        {
          addEventListener: (type: string, fn: () => void) => {
            heard[type] = fn;
          },
        },
      );
      return { glossary, heard, location, scrolled: () => scrolled };
    };

    it("opens every closed part around a link's target on load", () => {
      const loaded = run("#entry");
      assert.equal(loaded.glossary.open, true);
      assert.equal(loaded.scrolled(), 1);
    });

    it("opens them again when the hash changes", () => {
      const loaded = run("");
      assert.equal(loaded.glossary.open, false);
      loaded.location.hash = "#entry";
      assert.ok(loaded.heard["hashchange"], "listens for hashchange");
      loaded.heard["hashchange"]?.();
      assert.equal(loaded.glossary.open, true);
    });

    it("does nothing for a hash that names nothing", () => {
      assert.equal(run("#missing").glossary.open, false);
    });
  });
});
