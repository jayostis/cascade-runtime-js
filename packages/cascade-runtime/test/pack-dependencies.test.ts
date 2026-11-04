import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  mergedDependencies,
  undeclaredImports,
  vendored,
} from "../pack/dependencies.js";

const write = async (path: string, text: string) => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
};

test("the package's own dependencies are published beside its bundled workspaces', and one name pinned two ways throws", () => {
  assert.deepEqual(
    mergedDependencies([
      { name: "runtime", dependencies: { oxigraph: "1.0.0" } },
      { name: "cascade-runtime", dependencies: { ajv: "8.20.0" } },
      { name: "fhir-pull" },
    ]),
    { ajv: "8.20.0", oxigraph: "1.0.0" },
  );
  assert.throws(
    () =>
      mergedDependencies([
        { name: "runtime", dependencies: { ajv: "6.0.0" } },
        { name: "cascade-runtime", dependencies: { ajv: "8.20.0" } },
      ]),
    /cascade-runtime pins ajv at 8.20.0, but runtime pins it at 6.0.0/,
  );
});

test("a bare import of the compiled code that the package neither declares nor carries is named; built-ins and relative imports are not", async () => {
  const dist = await mkdtemp(join(tmpdir(), "cr-"));
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
  assert.deepEqual(await undeclaredImports(dist, { ajv: "8.20.0" }), [
    "@s/p",
    "lazy",
  ]);
  assert.deepEqual(
    await undeclaredImports(dist, { ajv: "1", "@s/p": "1", lazy: "1" }),
    [],
  );
});

test("a vendored package carries what it depends on, each resolved from the package that needs it, not another version above", async () => {
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
