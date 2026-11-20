import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/** The script, as the compiled test reaches it: this file is in packages/site/dist/test. */
const SCRIPT = new URL("../../../../scripts/test-files.mjs", import.meta.url);
const { compiledTests } = (await import(SCRIPT.href)) as {
  compiledTests: (group?: "listed" | "unlisted") => string[];
};

const files = (group?: "listed" | "unlisted"): string[] =>
  compiledTests(group).map((path) => path.split("\\").join("/"));

/**
 * `scripts/test-files.mjs` names the compiled test files `scripts/test.mjs` runs. CI runs the files each package's
 * `test/spec.json` lists as `randomOrder` in a random order and the rest as written, so the suite is run once, whole.
 */
describe("Choosing the files a suite runs · scripts/test-files.mjs", () => {
  describe("with the suite in two parts, listed and unlisted", () => {
    it("names every file once between them", () => {
      const all = files();
      const parts = [...files("listed"), ...files("unlisted")];
      assert.ok(all.length > 100, `${all.length} files`);
      assert.deepEqual([...parts].sort(), [...all].sort());
      assert.equal(new Set(parts).size, parts.length);
    });

    it("names a file its package lists as randomOrder in the listed part only", () => {
      const { randomOrder } = JSON.parse(
        readFileSync("packages/site/test/spec.json", "utf8"),
      ) as { randomOrder: string[] };
      const [first = ""] = randomOrder;
      const compiled = `packages/site/dist/test/${first.replace(/\.ts$/, ".js")}`;
      assert.ok(files("listed").includes(compiled), compiled);
      assert.ok(!files("unlisted").includes(compiled), compiled);
    });
  });
});
