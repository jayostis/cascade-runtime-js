import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { readJunit, type TestCase } from "../src/junit.js";

const FIXTURE = [
  'import { describe, it } from "node:test";',
  "",
  "/**",
  " * Imports an export.",
  " * It keeps the records.",
  " *",
  " * @rule pod-import R19",
  " * @rule pod-import R20",
  " */",
  'describe("Importing", () => {',
  "  /** When nobody claimed it. */",
  '  describe("when unclaimed", () => {',
  "    /** Nothing is dropped & <nothing> is lost. */",
  '    it("keeps them", () => {});',
  "  });",
  '  it("bare", () => {});',
  "});",
  "",
  "// not a doc comment",
  'describe("Plain", () => {',
  '  it("passes", () => {});',
  "});",
  "",
].join("\n");

/**
 * `scripts/junit-reporter.mjs` is the node:test reporter the runtime's tests run with. It adds to JUnit what the page
 * needs and node leaves out: each describe's and test's doc comment, its `@rule` tags, and the line it is declared on.
 */
describe("Writing doc comments into a report · scripts/junit-reporter.mjs", () => {
  describe("with a test file's doc comments", () => {
    let folder: string;
    let xml: string;
    let byName: Map<string, TestCase>;

    /**
     * A TypeScript test file with doc comments, transpiled with a source map as scripts/transpile.mjs does, then run by the
     * reporter. The child runs as a test of its own, so it gets no `NODE_TEST_CONTEXT`, or node would report it to this run.
     */
    before(async () => {
      folder = mkdtempSync(join(tmpdir(), "reporter-"));
      const source = join(folder, "x.test.ts");
      writeFileSync(source, FIXTURE);
      await build({
        entryPoints: [source],
        outfile: join(folder, "x.test.js"),
        sourcemap: "external",
        format: "esm",
        logLevel: "silent",
      });
      const reporter = pathToFileURL(
        join(process.cwd(), "scripts", "junit-reporter.mjs"),
      ).href;
      const env = { ...process.env };
      delete env["NODE_TEST_CONTEXT"];
      const run = spawnSync(
        process.execPath,
        ["--test", `--test-reporter=${reporter}`, join(folder, "x.test.js")],
        { encoding: "utf8", env, cwd: folder },
      );
      assert.equal(run.status, 0, run.stderr);
      xml = run.stdout;
      byName = new Map(readJunit(xml).cases.map((one) => [one.name, one]));
    });

    after(() => {
      if (folder !== undefined)
        rmSync(folder, { recursive: true, force: true });
    });

    it("writes a describe's doc comment as its description, its lines joined", () => {
      const { described } = byName.get("keeps them") ?? {};
      assert.equal(
        described?.[0]?.description,
        "Imports an export. It keeps the records.",
      );
      assert.equal(described?.[1]?.description, "When nobody claimed it.");
    });

    it("writes each `@rule` tag as a rule of its describe", () => {
      const { described } = byName.get("keeps them") ?? {};
      assert.deepEqual(described?.[0]?.rules, [
        "pod-import R19",
        "pod-import R20",
      ]);
      assert.deepEqual(described?.[1]?.rules, []);
    });

    it("writes the line of the TypeScript source a describe is declared on", () => {
      const { described } = byName.get("keeps them") ?? {};
      assert.equal(described?.[0]?.line, 10);
      assert.equal(described?.[1]?.line, 12);
    });

    it("writes a test's doc comment as the case's description, markup kept as text", () => {
      assert.equal(
        byName.get("keeps them")?.description,
        "Nothing is dropped & <nothing> is lost.",
      );
    });

    it("names the file from the folder the tests ran in", () => {
      const keeps = byName.get("keeps them");
      assert.equal(keeps?.file, "x.test.ts");
      assert.deepEqual(keeps?.describes, ["Importing", "when unclaimed"]);
    });

    it("writes no description for a `//` comment, or for none", () => {
      assert.equal(byName.get("bare")?.description, undefined);
      assert.equal(byName.get("passes")?.described[0]?.description, undefined);
    });

    it("leaves no marker in the report", () => {
      assert.doesNotMatch(xml, /⁣/);
    });
  });
});
