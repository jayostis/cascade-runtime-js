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

  describe("when the pod's root is open", () => {
    it("names, for a folder of the directory table, the layout files that fill it", async () => {
      await opened();
      const cells = await tab
        .locator("#ins table")
        .first()
        .locator("tbody tr td:nth-child(2)")
        .allTextContents();
      assert.ok(cells.length > 0);
      assert.ok(
        cells.some((cell) => cell.trim() !== ""),
        "every row of the layout column is empty",
      );
    });

    it("says 'judgments', 'records', 'revisions' and 'versions' in the singular for a count of one", async () => {
      await opened();
      for (let step = 0; step < data.log.length; step += 1) {
        await tab.fill("#rng", String(step));
        const line =
          (await tab.locator("#ins p.gen").first().textContent()) ?? "";
        assert.doesNotMatch(
          line,
          /\b1 (records|revisions|versions|judgments)\b/,
        );
      }
    });
  });

  describe("when a file or a query is open", () => {
    const cards = async () =>
      tab.locator("#ins .card").evaluateAll((all) =>
        all.map((card) => ({
          title: card.querySelector("h4")?.textContent ?? "",
          text: card.textContent ?? "",
        })),
      );

    it("puts the files that name a file, and those it names, in the card for names, and not under 'Read by'", async () => {
      await opened();
      const target = data.files.find((file) => file.namedBy.length > 0);
      assert.ok(target, "the kit's pod has a file another file names");
      const named = data.files[target.namedBy[0] ?? 0];
      assert.ok(named);
      await tab.fill("#flt", target.path.split("/").at(-1) ?? "");
      await tab.locator(`#tree [data-go="p:${target.path}"]`).click();
      const shown = await cards();
      assert.deepEqual(
        shown.map(({ title }) => title),
        ["Written by", "Read by", "Names and is named by"],
      );
      const read = shown.find(({ title }) => title === "Read by");
      const names = shown.find(
        ({ title }) => title === "Names and is named by",
      );
      assert.ok(read && names);
      const short = named.path.split("/").at(-1)?.slice(0, 8) ?? "";
      assert.ok(names.text.includes(short), "a file that names it is missing");
      assert.ok(
        !read.text.includes(short),
        "a file that names it is under Read by",
      );
    });

    it("labels a query's cards by what the query does with terms: 'Reads' and 'Writes'", async () => {
      await opened();
      const query = data.queries.find((each) => each.reads.length > 0);
      assert.ok(query);
      await tab.fill("#flt", query.path.split("/").at(-1) ?? "");
      await tab.locator(`#tree [data-go="q:${query.path}"]`).click();
      const titles = (await cards()).map(({ title }) => title);
      assert.ok(titles.includes("Reads"), titles.join(", "));
      assert.ok(titles.includes("Writes"), titles.join(", "));
      assert.ok(!titles.includes("Read by"), titles.join(", "));
      assert.ok(!titles.includes("Names and is named by"), titles.join(", "));
    });

    it("sets a query's header comment as paragraphs, not as lines broken where the source wrapped them", async () => {
      await opened();
      const query = data.queries.find((each) => each.reads.length > 0);
      assert.ok(query);
      await tab.fill("#flt", query.path.split("/").at(-1) ?? "");
      await tab.locator(`#tree [data-go="q:${query.path}"]`).click();
      await tab.waitForSelector("#ins details.ex");
      const header =
        (await tab.locator("#ins .prose").first().textContent()) ?? "";
      assert.ok(header.trim() !== "", "the query has a header comment");
      assert.ok(!header.trim().includes("\n"), header);
    });

    it("spaces the term chips", async () => {
      await opened();
      const query = data.queries.find((each) => each.reads.length > 1);
      assert.ok(query);
      await tab.fill("#flt", query.path.split("/").at(-1) ?? "");
      await tab.locator(`#tree [data-go="q:${query.path}"]`).click();
      const margin = await tab
        .locator("#ins .card i.term")
        .first()
        .evaluate((chip) => parseFloat(getComputedStyle(chip).marginRight));
      assert.ok(margin > 0, `margin-right ${margin}`);
    });
  });

  describe("when the log has an act that carries a label", () => {
    it("names the act by its type and its label", async () => {
      await opened();
      const labelled = data.log
        .map((row, at) => ({ row, at }))
        .filter(
          ({ row }) =>
            row.how === "snapshot" &&
            row.label !== undefined &&
            row.type !== undefined &&
            data.terms[row.type]?.label !== undefined,
        );
      assert.ok(
        labelled.length > 0,
        "the kit has a labelled act with a typed term",
      );
      for (const { row, at } of labelled) {
        const shown =
          (await tab.locator(`.act[data-step="${at}"] .what`).textContent()) ??
          "";
        assert.equal(
          shown,
          `${data.terms[row.type ?? ""]?.label} · ${row.label}`,
        );
      }
    });
  });

  describe("when the slider is moved and the page is loaded again", () => {
    it("keeps the act in the address, so that a copied link opens at it", async () => {
      await opened();
      await tab.fill("#rng", "0");
      assert.match(new URL(tab.url()).hash, /step=0$/);
      await tab.reload();
      await tab.waitForSelector(".row", { state: "attached" });
      assert.equal(
        await tab.locator(".act.cur").getAttribute("data-step"),
        "0",
      );
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
