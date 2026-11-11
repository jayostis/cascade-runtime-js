import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NODE, NODE_UNLISTED } from "./runner-reports.js";
import {
  CTRF_NAME,
  CTRF_REPORT,
  CTRF_SUITE,
  ctrfOf,
  ctrfPath,
  DESCRIBED,
  GLOSSARY,
  GROUPED,
  pageWith,
  R,
  RUN,
  WITH_GLOSSARY,
} from "./tests-page.js";

/**
 * Beside each page the site writes the same results as CTRF, a JSON format for test reports, for an agent that would
 * rather read data than a page. It holds what the page shows: levels, descriptions, rule links and the glossary.
 */
describe("Test results for an agent · <repository>.ctrf.json", () => {
  describe("with a run's report", () => {
    it("writes the file beside the suite's page", async () => {
      const { tree } = await pageWith({
        runtime: { report: DESCRIBED, ...RUN },
      });
      assert.ok(tree.has(ctrfPath(R)));
    });

    it("links the file once on the page", async () => {
      const { markup } = await pageWith({ runtime: { report: NODE, ...RUN } });
      assert.equal(markup.split(`href="${R}.ctrf.json"`).length - 1, 1);
    });

    it("holds every case with the names of the levels above it, its status and its duration", async () => {
      const { tree } = await pageWith({
        runtime: { report: DESCRIBED, ...RUN },
      });
      assert.deepEqual(
        ctrfOf(tree).results.tests.map(
          ({ suite = [], name, status, duration }) => [
            [...suite, name],
            status,
            duration,
          ],
        ),
        [
          [["a pod", "accepts a record"], "passed", 2],
          [["a pod", "rejects a gap"], "failed", 500],
        ],
      );
    });

    it("counts as the page does", async () => {
      const { page, tree } = await pageWith({
        runtime: { report: DESCRIBED, ...RUN },
      });
      const { summary } = ctrfOf(tree).results;
      assert.equal(summary["tests"], 2);
      assert.equal(summary["passed"], 1);
      assert.equal(summary["failed"], 1);
      assert.match(page.said, /2 cases: 1 passed, 1 failed, 0 skipped/);
    });

    it("counts a failure node reports outside the cases as failed", async () => {
      const { tree } = await pageWith({
        runtime: { report: NODE_UNLISTED, ...RUN },
      });
      assert.equal(ctrfOf(tree).results.summary["failed"], 1);
    });
  });

  describe("with a suite whose report is CTRF", () => {
    it("names the tool the report names, not the suite's runner", async () => {
      const { tree } = await pageWith({}, [
        { suite: CTRF_SUITE, run: { ...RUN, report: CTRF_REPORT } },
      ]);
      const written = ctrfOf(tree, CTRF_NAME) as unknown as {
        results: { tool: { name: string } };
      };
      assert.equal(
        written.results.tool.name,
        "cascade-bridge-spec compatibility",
      );
    });

    it("keeps what the report says of a case beyond its levels and description", async () => {
      const { tree } = await pageWith({}, [
        { suite: CTRF_SUITE, run: { ...RUN, report: CTRF_REPORT } },
      ]);
      const one = ctrfOf(tree, CTRF_NAME).results.tests.find(
        (t) => t.name === "example-0003",
      ) as { extra?: Record<string, unknown> } | undefined;
      assert.equal(one?.extra?.["outcome"], "passed");
      assert.equal(one?.extra?.["type"], "Isomorphic conversion test");
    });
  });

  describe("with doc comments and rules", () => {
    it("carries the description and rule links of each level above a case, and the case's own description", async () => {
      const { tree } = await pageWith({
        runtime: { report: GROUPED, ...RUN },
      });
      const one = ctrfOf(tree).results.tests.find(
        (t) => t.name === "keeps the records unclaimed",
      );
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
  });

  describe("with a glossary", () => {
    it("carries each package's glossary, and nothing for a package with none", async () => {
      const withGlossary = await pageWith({
        runtime: { report: WITH_GLOSSARY, ...RUN },
      });
      const glossary = ctrfOf(withGlossary.tree).extra?.glossary?.[
        "cascade-runtime"
      ];
      assert.equal(glossary?.length, GLOSSARY.length);
      assert.deepEqual(glossary?.[0], {
        id: "glossary-cascade-runtime-claim",
        ...GLOSSARY[0],
      });

      const without = await pageWith({
        runtime: { report: GROUPED, ...RUN },
      });
      assert.equal(ctrfOf(without.tree).extra, undefined);
    });
  });
});
