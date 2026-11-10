import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";
import { Refusal } from "cascade-runtime";
import { bundleBrowser } from "../pack/browser.js";
import { browserBuildVersion } from "../src/node/published.js";
import { terms } from "../src/terms.js";

/**
 * A bundler that honours the `browser` condition gives a web page its own build of the package, the browser entry
 * point, with the same calls as in Node. A page also relies on that build's types, on its `terms`, and on the version
 * it files kept answers under, `browserBuildVersion()`, which answers published from Node must carry to be read in the
 * page. A Vite app serves that build beside its bundle with `cascadeRuntime()` from `cascade-runtime/vite`.
 */
describe("Importing the package in a web page · browserBuildVersion(), cascadeRuntime()", () => {
  describe("given the packed browser entry point", () => {
    let stage: string;
    let version: string;
    let entry: { browserBuildVersion(): string; terms: unknown };
    let check: {
      checkInput(schema: object, input: unknown): void;
    };

    before(async () => {
      stage = await mkdtemp(join(tmpdir(), "cascade-entry-"));
      const bridge = join(stage, "bridge");
      await mkdir(bridge);
      await writeFile(
        join(bridge, "cascade_bridge.js"),
        "export function initSync() {}\n",
      );
      await writeFile(join(bridge, "cascade_bridge_bg.wasm"), new Uint8Array());
      version = await bundleBrowser(join(stage, "dist", "browser"), {
        commit: "0123456789abcdef0123456789abcdef01234567",
        dirty: false,
        components: [
          {
            repository: "https://github.com/example/vocabulary",
            commit: "abc",
          },
        ],
        bridge,
      });
      await writeFile(
        join(stage, "package.json"),
        JSON.stringify({
          type: "module",
          cascadeRuntime: { browserBuildVersion: version },
        }),
      );
      const packed = (file: string) =>
        pathToFileURL(join(stage, "dist", "browser", file)).href;
      entry = (await import(packed("index.js"))) as typeof entry;
      check = (await import(packed("check.js"))) as typeof check;
    });

    after(async () => {
      await rm(stage, { recursive: true, force: true });
    });

    it("returns from `browserBuildVersion()` the version that `browserBuildVersion(folder)` of `cascade-runtime/published` returns in Node for the same packed package", async () => {
      assert.equal(
        entry.browserBuildVersion(),
        await browserBuildVersion(stage),
      );
      assert.equal(entry.browserBuildVersion(), version);
    });

    it("exports `terms` as the Node entry point does", () => {
      assert.deepEqual(entry.terms, terms);
    });

    it("throws from its own copy of `checkInput`, in `check.js`, an error named `Refusal` that is no instance of Node's `Refusal`", () => {
      assert.throws(
        () =>
          check.checkInput(
            {
              type: "object",
              properties: { person: { type: "string" } },
              required: ["person"],
            },
            {},
          ),
        (error: unknown) =>
          error instanceof Error &&
          error.name === "Refusal" &&
          /person is required/.test(error.message) &&
          !(error instanceof Refusal),
      );
    });
  });

  describe("browserBuildVersion(folder)", () => {
    let unpacked: string;

    before(async () => {
      unpacked = await mkdtemp(join(tmpdir(), "cascade-unpacked-"));
      await writeFile(
        join(unpacked, "package.json"),
        JSON.stringify({ type: "module" }),
      );
    });

    after(async () => {
      await rm(unpacked, { recursive: true, force: true });
    });

    it("throws, saying the package is not packed, for a folder whose `package.json` records no version", async () => {
      await assert.rejects(
        browserBuildVersion(unpacked),
        /is not a packed package/,
      );
    });
  });
});
