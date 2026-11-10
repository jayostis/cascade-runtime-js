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
import { describe, it } from "node:test";
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

/**
 * `npm test` compiles with `scripts/transpile.mjs`, which strips types with esbuild and is much faster than `tsc -b`.
 * These checks hold that it leaves a `dist` that `tsc -b` would have left. Each leaf builds a workspace of its own,
 * because each one changes it.
 */
describe("Transpiling before the tests · scripts/transpile.mjs", () => {
  describe("given a workspace that `tsc -b` built once", () => {
    it("removes every output of a source file deleted since: its `.js`, `.js.map`, `.d.ts` and `.d.ts.map`", async () => {
      const root = await workspace({
        "gone.ts": "export const gone = 1;\n",
        "kept.ts": "export const kept = 1;\n",
      });
      try {
        assert.equal(run(root, TSC, "-b", "packages/p").status, 0);
        await rm(join(root, "packages", "p", "src", "gone.ts"));
        assert.equal(run(root, TRANSPILE).status, 0);
        assert.deepEqual(
          [
            "gone.js",
            "gone.js.map",
            "gone.d.ts",
            "gone.d.ts.map",
            "kept.js",
          ].map((path) => existsSync(dist(root, path))),
          [false, false, false, false, true],
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("removes the outputs of a folder dropped from `include`", async () => {
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

    it("leaves `tsc -b` to write its own output over esbuild's at the next full build", async () => {
      const root = await workspace({
        "a.ts": "// tsc keeps this comment\nexport const a = 1;\n",
      });
      try {
        assert.equal(run(root, TSC, "-b", "packages/p").status, 0);
        const later = new Date(Date.now() + 60_000);
        await utimes(join(root, "packages", "p", "src", "a.ts"), later, later);
        assert.equal(run(root, TRANSPILE).status, 0);
        assert.doesNotMatch(
          await readFile(dist(root, "a.js"), "utf8"),
          /keeps/,
        );
        assert.equal(run(root, TSC, "-b", "packages/p").status, 0);
        assert.match(await readFile(dist(root, "a.js"), "utf8"), /keeps/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe("given a package whose `tsconfig.json` it does not mirror", () => {
    it("exits with status 1, naming what differs", async () => {
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
  });
});
