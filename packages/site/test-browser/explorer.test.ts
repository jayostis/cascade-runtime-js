import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { MemoryFiles, OxigraphStore } from "@cascade-runtime/runtime";
import {
  featurePod,
  findRoot,
  localVocabulary,
} from "@cascade-runtime/runtime/node";
import { EXPLORER_FILE, type ExplorerData } from "../src/explorer.js";
import { type Served, servePages } from "../src/node/serve.js";
import { Site } from "../src/site.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const KIT = "tamsin-vale";

/**
 * The explorer's app, run in Chromium over a small kit's pod: no unit test can say whether the page's script opens a node,
 * hides the files a later act wrote, or fits a phone's width.
 */
describe("The pod explorer in a browser · opening a node, the log's slider, a phone's width", () => {
  let folder: string;
  let served: Served;
  let browser: Browser;
  let data: ExplorerData;
  let tab: Page;

  before(async () => {
    const vocabulary = await localVocabulary(ROOT);
    const pod = new MemoryFiles("https://pod.example/");
    await featurePod(vocabulary, `conformance/${KIT}/${KIT}.feature`, pod, {});
    const site = await Site.build({
      vocabulary: vocabulary.files,
      layout: vocabulary.layout,
      build: vocabulary.build,
      pod,
      lens: vocabulary.config.lens,
      defaultLens: vocabulary.config.lens,
      newStore: () => new OxigraphStore(),
      name: KIT,
      at: "2026-03-03T08:00:00Z",
      ask: `npm run ask -- ${KIT}`,
      kit: KIT,
    });
    const built = await site.files();
    folder = mkdtempSync(join(tmpdir(), "explorer-"));
    for (const [path, bytes] of built) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), bytes);
    }
    data = JSON.parse(
      new TextDecoder().decode(built.get(EXPLORER_FILE)),
    ) as ExplorerData;
    served = await servePages(folder);
    browser = await chromium.launch();
    tab = await browser.newPage();
  });

  after(async () => {
    await browser?.close();
    await served?.close();
    if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
  });

  async function opened(width = 1400): Promise<void> {
    await tab.setViewportSize({ width, height: width < 600 ? 800 : 900 });
    await tab.goto(`${served.url}index.html`);
    await tab.waitForSelector(".row", { state: "attached" });
  }

  /** The files the tree lists; the filter lists every file that matches, whichever folder is closed. */
  const files = () => tab.locator('#tree .row[data-go^="p:"]:not(.dir)');

  describe("when a node is clicked", () => {
    it("opens a file in the inspector with its Turtle and a breadcrumb from the pod", async () => {
      await opened();
      const target = data.files.find((file) => file.kind === "record");
      assert.ok(target);
      await tab.fill("#flt", target.path.split("/").at(-1) ?? "");
      await tab.locator(`#tree [data-go="p:${target.path}"]`).click();
      assert.match((await tab.locator("#ins h1").textContent()) ?? "", /\.ttl/);
      await tab.waitForFunction(
        () =>
          !(
            document.getElementById("body")?.textContent ?? "Loading"
          ).startsWith("Loading"),
      );
      assert.match(
        (await tab.locator("#ins pre.code").textContent()) ?? "",
        /@prefix|<| a /,
      );
      assert.ok(await tab.locator("#ins .crumbs a").first().isVisible());
    });

    it("opens a query of the vocabulary with the terms it reads", async () => {
      await opened();
      const query = data.queries.find((each) => each.reads.length > 0);
      assert.ok(query);
      await tab.fill("#flt", query.path.split("/").at(-1) ?? "");
      await tab.locator(`#tree [data-go="q:${query.path}"]`).click();
      await tab.waitForSelector("#ins details.ex");
      assert.ok(await tab.locator("#ins .card i.term").first().isVisible());
    });
  });

  describe("when the log's slider is moved to the first act", () => {
    it("hides the files that later acts wrote and returns them at the last", async () => {
      await opened();
      const last = data.log.length - 1;
      assert.ok(last > 0, "the kit's pod has more than one act");
      await tab.fill("#flt", ".ttl");
      const atEnd = await files().count();
      await tab.fill("#rng", "0");
      const atStart = await files().count();
      assert.ok(
        atStart < atEnd,
        `${atStart} files after act 0, ${atEnd} at the end`,
      );
      await tab.fill("#rng", String(last));
      assert.equal(await files().count(), atEnd);
      assert.equal(
        await tab.locator(".act.cur").getAttribute("data-step"),
        String(last),
      );
    });
  });

  describe("on a phone's width", () => {
    it("shows one pane at a time under tabs, with no sideways scroll in any", async () => {
      await opened(390);
      for (const pane of ["tree", "ins", "log"]) {
        await tab.click(`[data-pane="${pane}"]`);
        assert.equal(await tab.locator(".pane.on").count(), 1);
        const [scroll, inner] = await tab.evaluate(() => [
          document.documentElement.scrollWidth,
          window.innerWidth,
        ]);
        assert.ok(scroll <= (inner ?? 0), `${pane}: ${scroll} > ${inner}`);
      }
    });
  });
});
