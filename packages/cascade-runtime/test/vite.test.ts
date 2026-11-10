import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cascadeRuntime } from "cascade-runtime/vite";
import { build } from "vite";

const write = async (root: string, files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
};

test("a browser build serves the runtime's files under the base and leaves cascade-runtime out of the bundle", async () => {
  const folder = await mkdtemp(join(tmpdir(), "vite-plugin-"));
  try {
    const installed = join(folder, "installed");
    const tree = "components/vocabulary/abc";
    await write(installed, {
      "package.json": JSON.stringify({
        name: "cascade-runtime",
        version: "1.2.3",
      }),
      "dist/browser/index.js": "export const here = import.meta.url;",
      "dist/browser/tables-worker.js": "",
      "components/cascade-runtime.json": "{}",
      "components/packed.json": JSON.stringify({
        components: [
          { repository: "https://github.com/x/vocabulary", commit: "abc" },
        ],
      }),
      "components/tables.json": "{}",
      "components/tables/files.json": JSON.stringify(["a.ttl"]),
      "components/tables/a.ttl": "",
      [`${tree}.json`]: "{}",
      [`${tree}/files.json`]: JSON.stringify(["rules.md"]),
      [`${tree}/rules.md`]: "rules",
    });
    const app = join(folder, "app");
    await write(app, {
      "index.html": `<!doctype html><html><head></head><body><script type="module" src="./main.js"></script></body></html>`,
      "main.js": `import { here } from "cascade-runtime"; document.title = here;`,
    });

    await build({
      root: app,
      base: "/made/",
      logLevel: "silent",
      configFile: false,
      plugins: [cascadeRuntime({ from: installed })],
    });

    const out = join(app, "dist");
    const served = (
      await readdir(join(out, "cascade-runtime"), { recursive: true })
    ).map((path) => path.replaceAll("\\", "/"));
    for (const path of [
      "index.js",
      "tables-worker.js",
      "components/packed.json",
      "components/tables.json",
      "components/tables/a.ttl",
      `${tree}/rules.md`,
    ])
      assert.ok(served.includes(path), `${path} is under the base`);

    const scripts = (await readdir(join(out, "assets"))).filter((name) =>
      name.endsWith(".js"),
    );
    assert.equal(scripts.length, 1);
    const bundle = await readFile(join(out, "assets", scripts[0]!), "utf8");
    assert.match(bundle, /from\s*["']cascade-runtime["']/);
    assert.doesNotMatch(bundle, /import\.meta\.url/);

    const page = await readFile(join(out, "index.html"), "utf8");
    const map = /<script type="importmap">(.*?)<\/script>/s.exec(page)?.[1];
    assert.deepEqual(JSON.parse(map ?? "null"), {
      imports: { "cascade-runtime": "/made/cascade-runtime/index.js" },
    });
  } finally {
    await rm(folder, { recursive: true, force: true, maxRetries: 5 });
  }
});
