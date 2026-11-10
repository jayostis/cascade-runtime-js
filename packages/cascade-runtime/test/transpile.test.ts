import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const TRANSPILE = join(ROOT, "scripts", "transpile.mjs");
const TSC = join(ROOT, "node_modules", "typescript", "bin", "tsc");

const BASE = {
  compilerOptions: {
    target: "ES2023",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    declaration: true,
    sourceMap: true,
    composite: true,
    types: [],
  },
};

async function workspace(
  sources: Record<string, string>,
  options: Record<string, string> = { rootDir: ".", outDir: "dist" },
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "transpile-"));
  const files: Record<string, string> = {
    "tsconfig.base.json": JSON.stringify(BASE),
    "packages/p/package.json": JSON.stringify({ type: "module" }),
    "packages/p/tsconfig.json": JSON.stringify({
      extends: "../../tsconfig.base.json",
      compilerOptions: options,
      include: ["src"],
    }),
    ...Object.fromEntries(
      Object.entries(sources).map(([path, text]) => [
        `packages/p/src/${path}`,
        text,
      ]),
    ),
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

function run(root: string, ...args: string[]) {
  return spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
}

const dist = (root: string, path: string) =>
  join(root, "packages", "p", "dist", "src", path);

test("a source deleted after a build takes every output of it with it at the next transpile", async () => {
  const root = await workspace({
    "gone.ts": "export const gone = 1;\n",
    "kept.ts": "export const kept = 1;\n",
  });
  try {
    assert.equal(run(root, TSC, "-b", "packages/p").status, 0);
    await rm(join(root, "packages", "p", "src", "gone.ts"));
    assert.equal(run(root, TRANSPILE).status, 0);
    assert.deepEqual(
      ["gone.js", "gone.js.map", "gone.d.ts", "gone.d.ts.map", "kept.js"].map(
        (path) => existsSync(dist(root, path)),
      ),
      [false, false, false, false, true],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a folder dropped from include takes its outputs with it at the next transpile", async () => {
  const root = await workspace({ "kept.ts": "export const kept = 1;\n" });
  try {
    const p = join(root, "packages", "p");
    const config = join(p, "tsconfig.json");
    const layout = JSON.parse(await readFile(config, "utf8")) as object;
    await mkdir(join(p, "old"));
    await writeFile(join(p, "old", "x.ts"), "export const x = 1;\n");
    await writeFile(
      config,
      JSON.stringify({ ...layout, include: ["src", "old"] }),
    );
    assert.equal(run(root, TSC, "-b", "packages/p").status, 0);
    await writeFile(config, JSON.stringify(layout));
    assert.equal(run(root, TRANSPILE).status, 0);
    assert.deepEqual(
      ["x.js", "x.js.map", "x.d.ts", "x.d.ts.map"].map((path) =>
        existsSync(join(p, "dist", "old", path)),
      ),
      [false, false, false, false],
    );
    assert.ok(existsSync(dist(root, "kept.js")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tsc -b after a transpile writes its own output again, not esbuild's", async () => {
  const root = await workspace({
    "a.ts": "// tsc keeps this comment\nexport const a = 1;\n",
  });
  try {
    assert.equal(run(root, TSC, "-b", "packages/p").status, 0);
    const later = new Date(Date.now() + 60_000);
    await utimes(join(root, "packages", "p", "src", "a.ts"), later, later);
    assert.equal(run(root, TRANSPILE).status, 0);
    assert.doesNotMatch(await readFile(dist(root, "a.js"), "utf8"), /keeps/);
    assert.equal(run(root, TSC, "-b", "packages/p").status, 0);
    assert.match(await readFile(dist(root, "a.js"), "utf8"), /keeps/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a package laid out otherwise than transpile.mjs mirrors is refused, naming what differs", async () => {
  const root = await workspace(
    { "a.ts": "export const a = 1;\n" },
    { rootDir: ".", outDir: "build" },
  );
  try {
    const refused = run(root, TRANSPILE);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /outDir is not dist/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
