import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readCtrf } from "../src/ctrf.js";

/** A CTRF report of the given tests, as cascade-bridge-spec's start action writes one. */
const reportOf = (...tests: object[]): string =>
  JSON.stringify({
    reportFormat: "CTRF",
    specVersion: "0.2.0",
    results: {
      tool: { name: "cascade-bridge-spec compatibility" },
      summary: { tests: tests.length },
      tests,
    },
  });

const LEVELS = ["synthetic adapter fixture cases", "with engine on native"];
const ONE = { name: "example-0001", status: "passed", duration: 0 };

/**
 * Some suites are not run by a test runner: an adapter's fixture cases are run by engines and judged by
 * cascade-bridge-spec's start action, which writes CTRF itself. `readCtrf` reads such a report into the same cases a
 * runner's report gives, so its page is the same tree.
 */
describe("Reading a report already in CTRF · readCtrf()", () => {
  describe("`readCtrf(json)`", () => {
    it("reads each test's `suite` as its levels, outermost first", () => {
      const [one] = readCtrf(reportOf({ ...ONE, suite: LEVELS })).cases;
      assert.deepEqual(one?.describes, LEVELS);
    });

    it("reads a level's description from `extra.levels`", () => {
      const levels = [
        { name: LEVELS[0], description: "ten cases of an adapter" },
        { name: LEVELS[1] },
      ];
      const [one] = readCtrf(
        reportOf({ ...ONE, suite: LEVELS, extra: { levels } }),
      ).cases;
      assert.equal(one?.described[0]?.description, "ten cases of an adapter");
      assert.equal(one?.described[1]?.description, undefined);
    });

    it("reads a test's `extra.description` as its description", () => {
      const [one] = readCtrf(
        reportOf({ ...ONE, extra: { description: "A document that fails." } }),
      ).cases;
      assert.equal(one?.description, "A document that fails.");
    });

    it("reads `passed`, `failed` and `skipped` as they stand, and `other` and `pending` as skipped", () => {
      const read = (status: string) =>
        readCtrf(reportOf({ ...ONE, status })).cases[0]?.result;
      assert.deepEqual(
        ["passed", "failed", "skipped", "other", "pending"].map(read),
        ["passed", "failed", "skipped", "skipped", "skipped"],
      );
    });

    it("keeps what a failed test said", () => {
      const message = "example-0001 is reported failed: <b>not markup</b>";
      const [one] = readCtrf(
        reportOf({ ...ONE, status: "failed", message }),
      ).cases;
      assert.equal(one?.message, message);
    });

    it("reads `filePath` and `line` as the case's file and line", () => {
      const [one] = readCtrf(
        reportOf({ ...ONE, filePath: "fixtures/manifest.ttl", line: 42 }),
      ).cases;
      assert.equal(one?.file, "fixtures/manifest.ttl");
      assert.equal(one?.line, 42);
    });

    it("throws, naming what is missing, for a text that is not a CTRF report", () => {
      assert.throws(() => readCtrf("<testsuites/>"), /not JSON/);
      assert.throws(() => readCtrf('{"results":{}}'), /results\.tests/);
    });
  });
});
