import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { bundleBrowser } from "../pack/browser.js";
import { entryVersion } from "../src/node/published.js";

test("the browser entry keys its answers under the version its installed package gives, fixed when it was packed, and fetches nothing of itself for it", async () => {
  const stage = await mkdtemp(join(tmpdir(), "cascade-entry-"));
  const fetchedNow = globalThis.fetch;
  try {
    const bridge = join(stage, "bridge");
    await mkdir(bridge);
    await writeFile(
      join(bridge, "cascade_bridge.js"),
      "export function initSync() {}\n",
    );
    await writeFile(join(bridge, "cascade_bridge_bg.wasm"), new Uint8Array());
    const version = await bundleBrowser(join(stage, "dist", "browser"), {
      commit: "0123456789abcdef0123456789abcdef01234567",
      dirty: false,
      components: [
        { repository: "https://github.com/example/vocabulary", commit: "abc" },
      ],
      bridge,
    });
    await writeFile(
      join(stage, "package.json"),
      JSON.stringify({
        type: "module",
        cascadeRuntime: { entryVersion: version },
      }),
    );
    const fetched: string[] = [];
    globalThis.fetch = (url) => {
      fetched.push(String(url instanceof Request ? url.url : url));
      return Promise.reject(new Error("nothing is served"));
    };
    const entry = (await import(
      pathToFileURL(join(stage, "dist", "browser", "index.js")).href
    )) as { entryVersion(): string };
    assert.equal(entry.entryVersion(), await entryVersion(stage));
    assert.deepEqual(fetched, []);
  } finally {
    globalThis.fetch = fetchedNow;
    await rm(stage, { recursive: true, force: true });
  }
});
