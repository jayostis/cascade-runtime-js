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
  R,
  RUN,
  RUNTIME,
  suite,
  text,
  V,
  versioned,
} from "./tests-page.js";

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

  describe("with no failed case", () => {
    it('says "No failures."', async () => {
      const green = await pageWith({
        runtime: { report: versioned("1.2.0"), ...RUN },
      });
      assert.match(green.page.said, /No failures\./);
      const red = await pageWith({ runtime: { report: NODE, ...RUN } });
      assert.doesNotMatch(red.page.said, /No failures\./);
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
    it("shows the whole repository as one package", async () => {
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
      assert.deepEqual(packagesOf(markup, "host-thing"), ["host-thing"]);
    });
  });

  describe("with a test file outside `packages/<name>/test/`", () => {
    it("shows its cases in one package named for the repository", async () => {
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

    /**
     * The runtime's page here has no glossary, whose filter is hidden too until script runs.
     */
    it("hides nothing else", () => {
      assert.doesNotMatch(
        partOf(markup, R).replace(/<span class="controls"[\s\S]*?<\/span>/, ""),
        /\shidden[\s>]/,
      );
    });

    it("marks each case with its result and each capability with its count of failed cases", () => {
      const runtime = partOf(markup, R);
      assert.match(runtime, /<li class="case" data-result="failed">/);
      assert.match(runtime, /<li class="case" data-result="passed">/);
      assert.match(runtime, /<li class="capability" data-failed="1">/);
      assert.match(runtime, /<li class="capability" data-failed="0">/);
    });
  });
});
