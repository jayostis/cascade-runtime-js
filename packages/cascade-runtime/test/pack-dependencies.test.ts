import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import {
  mergedDependencies,
  undeclaredImports,
  vendored,
} from "../pack/dependencies.js";

const write = async (path: string, text: string) => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
};

/**
 * What `npm run build:package` checks and copies so that the published package installs with everything its compiled
 * code imports.
 */
describe("Dependencies of the packed package · mergedDependencies(), undeclaredImports(), vendored()", () => {
  describe("mergedDependencies(declarers)", () => {
    it("returns the package's own dependencies beside those of the workspaces it bundles", () => {
      assert.deepEqual(
        mergedDependencies([
          { name: "runtime", dependencies: { oxigraph: "1.0.0" } },
          { name: "cascade-runtime", dependencies: { ajv: "8.20.0" } },
          { name: "fhir-pull" },
        ]),
        { ajv: "8.20.0", oxigraph: "1.0.0" },
      );
    });

    it("throws, naming both declarers and both versions, when one name is pinned two ways", () => {
      assert.throws(
        () =>
          mergedDependencies([
            { name: "runtime", dependencies: { ajv: "6.0.0" } },
            { name: "cascade-runtime", dependencies: { ajv: "8.20.0" } },
          ]),
        /cascade-runtime pins ajv at 8.20.0, but runtime pins it at 6.0.0/,
      );
    });
  });

  describe("undeclaredImports(folder, declared)", () => {
    let dist: string;
    let undeclared: string[];

    before(async () => {
      dist = await mkdtemp(join(tmpdir(), "cr-"));
      await write(
        join(dist, "a", "reply.js"),
        [
          'import { Ajv2020 } from "ajv/dist/2020.js";',
          'import { readFile } from "node:fs/promises";',
          'import { join } from "path";',
          'import { x } from "./x.js";',
          'export * from "@s/p/sub.js";',
          'const late = await import("lazy");',
        ].join("\n"),
      );
      undeclared = await undeclaredImports(dist, { ajv: "8.20.0" });
    });

    it("returns each package the compiled code imports that is not declared, whether by an import, an export-from or a dynamic import", () => {
      assert.deepEqual(undeclared, ["@s/p", "lazy"]);
    });

    it("ignores Node's built-in modules and relative imports", () => {
      assert.equal(undeclared.length, 2);
      for (const name of ["node:fs/promises", "path", "./x.js"])
        assert.equal(undeclared.includes(name), false, name);
    });

    it("returns none once every import is declared", async () => {
      assert.equal(undeclared.length, 2);
      assert.deepEqual(
        await undeclaredImports(dist, { ajv: "1", "@s/p": "1", lazy: "1" }),
        [],
      );
    });
  });

  describe("vendored(names, from, modules)", () => {
    let modules: string;
    let copied: Record<string, string>;

    before(async () => {
      const root = await mkdtemp(join(tmpdir(), "cr-"));
      const own = join(root, "pkg");
      const manifest = (name: string, version: string, deps = {}) =>
        JSON.stringify({ name, version, dependencies: deps });
      await write(
        join(root, "node_modules", "ajv", "package.json"),
        manifest("ajv", "6.0.0"),
      );
      await write(
        join(own, "node_modules", "ajv", "package.json"),
        manifest("ajv", "8.20.0", { traverse: "^1" }),
      );
      await write(join(own, "node_modules", "ajv", "index.js"), "8");
      await write(
        join(root, "node_modules", "traverse", "package.json"),
        manifest("traverse", "1.0.0"),
      );
      modules = join(root, "stage");
      copied = await vendored(["ajv"], own, modules);
    });

    it("copies a package with everything it depends on into one flat folder", () => {
      assert.deepEqual(copied, { ajv: "8.20.0", traverse: "1.0.0" });
    });

    it("resolves each dependency from the package that needs it, not from another version above it", async () => {
      assert.equal(
        await readFile(join(modules, "ajv", "index.js"), "utf8"),
        "8",
      );
    });
  });
});
