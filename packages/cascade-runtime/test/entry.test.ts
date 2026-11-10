import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";
import { bundleBrowser } from "../pack/browser.js";
import { entryVersion } from "../src/node/published.js";
import { terms } from "../src/terms.js";

describe("the browser entry", () => {
  let stage: string;
  let entry: { entryVersion(): string; terms: unknown };

  before(async () => {
    stage = await mkdtemp(join(tmpdir(), "cascade-entry-"));
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
    entry = (await import(
      pathToFileURL(join(stage, "dist", "browser", "index.js")).href
    )) as typeof entry;
  });

  after(async () => {
    await rm(stage, { recursive: true, force: true });
  });

  it("keys its answers under the version its installed package gives, fixed when it was packed", async () => {
    assert.equal(entry.entryVersion(), await entryVersion(stage));
  });

  it("carries the terms", () => {
    assert.deepEqual(entry.terms, terms);
  });
});
