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

describe("mergedDependencies", () => {
  it("publishes the package's own dependencies beside its bundled workspaces'", () => {
    assert.deepEqual(
      mergedDependencies([
        { name: "runtime", dependencies: { oxigraph: "1.0.0" } },
        { name: "cascade-runtime", dependencies: { ajv: "8.20.0" } },
        { name: "fhir-pull" },
      ]),
      { ajv: "8.20.0", oxigraph: "1.0.0" },
    );
  });

  it("throws on one name pinned two ways", () => {
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

describe("undeclaredImports", () => {
  let dist: string;

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
  });

  it("names the bare imports the package neither declares nor carries", async () => {
    assert.deepEqual(await undeclaredImports(dist, { ajv: "8.20.0" }), [
      "@s/p",
      "lazy",
    ]);
  });

  it("names none once each is declared, built-ins and relative imports aside", async () => {
    assert.deepEqual(
      await undeclaredImports(dist, { ajv: "1", "@s/p": "1", lazy: "1" }),
      [],
    );
  });
});

describe("vendored", () => {
  it("carries a dependency from the package that needs it, not a version above", async () => {
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
    const modules = join(root, "stage");
    assert.deepEqual(await vendored(["ajv"], own, modules), {
      ajv: "8.20.0",
      traverse: "1.0.0",
    });
    assert.equal(await readFile(join(modules, "ajv", "index.js"), "utf8"), "8");
  });
});
