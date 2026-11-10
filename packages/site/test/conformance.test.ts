import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { MemoryFiles } from "@cascade-runtime/runtime";
import type { SpecPages } from "../src/spec.js";
import {
  ASSERTIONS,
  hubWith,
  kimVocabulary,
  NAMING,
  pagesOf,
  RAN_WITH,
  TREE,
  treeText,
} from "./kim-vocabulary.js";
import { readPage } from "./page.js";

const OTHER = "https://github.com/jayostis/cascade-vocabulary/tree/def/";

/** The result of the first example of the naming feature's page. */
const resultOfOne = (pages: SpecPages): string | undefined =>
  new Map(
    [
      ...new TextDecoder()
        .decode(pages.files.get("naming.html"))
        .matchAll(
          /<details class="example ([\w-]+)">\n<summary><span[^>]*>[^<]*<\/span>([^<]*)<\/summary>/g,
        ),
    ].map(([, outcome, name]) => [name ?? "", outcome ?? ""]),
  ).get("one content is one version");

/** The warnings about the results, as their text. */
const reported = ({ warnings }: SpecPages): string[] =>
  warnings.filter(({ kind }) => kind === "report").map(({ what }) => what);

/**
 * A conformance run writes each example's result in EARL. `readSpecReport()` reads them, each example's page shows its
 * own, and the conformance page counts them for each feature, so a reader sees how much of the specification the runtime
 * passes.
 */
describe("Conformance results on the specification · readSpecReport(), specSection", () => {
  let vocabulary: MemoryFiles;

  before(async () => {
    vocabulary = await kimVocabulary();
  });

  describe("`readSpecReport()`", () => {
    const test = `${NAMING}one-content-is-one-version`;
    const twice = (
      order: readonly ["passed", "failed"] | readonly ["failed", "passed"],
    ) =>
      pagesOf(
        vocabulary,
        order.map((outcome) => ({ test, name: "", outcome })),
        RAN_WITH,
      );

    it("shows a fail where one test has two results, whatever their order", async () => {
      for (const order of [
        ["passed", "failed"],
        ["failed", "passed"],
      ] as const)
        assert.equal(resultOfOne(await twice(order)), "failed", order.join());
    });

    it("warns that the test has more than one result", async () => {
      assert.deepEqual(reported(await twice(["passed", "failed"])), [
        "the report holds more than one result for this test; the worst is shown",
      ]);
    });

    it("matches results that give the vocabulary's GitHub `tree/<commit>/` address without its final `/`", async () => {
      const slashless = await pagesOf(vocabulary, ASSERTIONS, [
        { name: "cascade-vocabulary", iri: TREE.slice(0, -1), revision: "abc" },
      ]);
      assert.deepEqual(reported(slashless), []);
    });

    it("matches results of another commit of the vocabulary by path, with a warning", async () => {
      const moved = await pagesOf(
        vocabulary,
        ASSERTIONS.map((one) => ({
          ...one,
          test: one.test.replace(TREE, OTHER),
        })),
        [{ name: "cascade-vocabulary", iri: OTHER, revision: "def" }],
      );
      assert.deepEqual(reported(moved), [
        `the report was run with ${OTHER}, the pages are built from ${TREE}`,
      ]);
      assert.equal(resultOfOne(moved), "passed");
    });

    it("warns when the results name no vocabulary, and when none matches an example", async () => {
      const none = await pagesOf(
        vocabulary,
        ASSERTIONS.map((one) => ({
          ...one,
          test: one.test.replace(TREE, OTHER),
        })),
        [],
      );
      assert.deepEqual(reported(none), [
        "the report names no cascade-vocabulary it was run with",
        "no result of the report joins an example of the pages",
      ]);
    });
  });

  describe("`specSection`", () => {
    const table = new TextEncoder().encode("| rule | result |\n");
    let tree: ReadonlyMap<string, Uint8Array>;
    let conformance: ReturnType<typeof readPage>;

    before(async () => {
      tree = await hubWith(vocabulary, ASSERTIONS, {
        earl: new TextEncoder().encode("# earl\n"),
        table,
      });
      conformance = readPage(treeText(tree, "conformance/index.html"));
    });

    it("writes the specification under `spec/`, and the conformance page, its JSON, the EARL file and the table under `conformance/`", () => {
      for (const path of [
        "spec/index.html",
        "spec/naming.html",
        "spec/kim.html",
        "spec/spec.css",
        "conformance/index.html",
        "conformance/results.json",
        "conformance/earl.ttl",
        "conformance/table.md",
      ])
        assert.ok(tree.has(path), path);
    });

    it("copies the table it is given byte for byte", () => {
      assert.deepEqual(tree.get("conformance/table.md"), table);
    });

    it("links both from the front page", () => {
      const front = readPage(treeText(tree, "index.html"));
      assert.ok(front.hrefs.includes("spec/"));
      assert.ok(front.hrefs.includes("conformance/"));
    });

    it("counts for a feature its rules, its rules with no example, and its examples passed, failed and not run", () => {
      assert.match(
        conformance.said,
        /feature rules rules with no example examples pass examples fail examples not run checks pass/,
      );
      assert.match(conformance.said, /Naming 4 2 1 1 1/);
    });

    it("shows the same counts of rules on the specification's index", () => {
      const rules = readPage(treeText(tree, "spec/index.html"));
      assert.match(
        rules.said,
        /feature rules rules with no example examples pass/,
      );
      assert.match(rules.said, /The conformance kit 2 2 no example/);
    });

    it("links each feature's page, the EARL file, the table and each repository's tests page", () => {
      for (const link of [
        "../spec/naming.html",
        "earl.ttl",
        "table.md",
        "tests/cascade-runtime-js/index.html",
      ])
        assert.ok(conformance.hrefs.includes(link), link);
    });

    it("writes the same counts as `conformance/results.json`", () => {
      const json = JSON.parse(treeText(tree, "conformance/results.json")) as {
        ran: boolean;
        features: { path: string; checks?: unknown }[];
      };
      assert.equal(json.ran, true);
      assert.deepEqual(
        json.features.find(({ path }) => path === "conformance/kim/kim.feature")
          ?.checks,
        { passed: 0, failed: 1, notRun: 0 },
      );
      assert.deepEqual(
        json.features.find(({ path }) => path === "runtime/naming.feature"),
        {
          path: "runtime/naming.feature",
          name: "Naming",
          page: "spec/naming.html",
          kit: false,
          rules: 4,
          withoutExample: 2,
          passed: 1,
          failed: 1,
          notRun: 1,
        },
      );
    });
  });

  describe("with no conformance results", () => {
    let tree: ReadonlyMap<string, Uint8Array>;
    let conformance: ReturnType<typeof readPage>;

    before(async () => {
      tree = await hubWith(vocabulary, []);
      conformance = readPage(treeText(tree, "conformance/index.html"));
    });

    it("writes both pages still", () => {
      assert.ok(tree.has("spec/index.html"));
      assert.ok(tree.has("conformance/index.html"));
    });

    it("shows every example as not run", () => {
      assert.match(conformance.said, /No result of a conformance report/);
      assert.match(conformance.said, /Naming 4 2 0 0 3/);
    });

    it("leaves out the EARL file and the table, and links neither", () => {
      assert.ok(!tree.has("conformance/earl.ttl"));
      assert.ok(!tree.has("conformance/table.md"));
      assert.ok(!conformance.hrefs.includes("earl.ttl"));
      assert.ok(!conformance.hrefs.includes("table.md"));
    });

    it('says `"ran": false` in `results.json`', () => {
      const json = JSON.parse(treeText(tree, "conformance/results.json")) as {
        ran: boolean;
      };
      assert.equal(json.ran, false);
    });
  });
});
