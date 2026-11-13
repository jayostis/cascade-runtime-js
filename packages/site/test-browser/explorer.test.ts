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

  describe("when a row of the log is picked", () => {
    const picked = () => {
      const at = data.log.findIndex(
        (row) => row.how === "snapshot" && row.act !== undefined,
      );
      assert.ok(at >= 0, "the kit's pod has an act that left a snapshot");
      return { at, row: data.log[at] as ExplorerData["log"][number] };
    };

    it("opens the act: its snapshot, its parent, its set hash, its file, and the files it wrote by folder", async () => {
      await opened();
      const { at, row } = picked();
      await tab.locator(`.act[data-step="${at}"]`).click();
      const panel = (await tab.locator("#ins").textContent()) ?? "";
      assert.ok(panel.includes(row.snapshot ?? "?"), "the snapshot");
      assert.ok(panel.includes(row.setHash ?? "?"), "the set hash");
      assert.ok(
        await tab
          .locator(`#ins a[data-go="p:${data.files[row.act ?? 0]?.path}"]`)
          .first()
          .isVisible(),
        "the act's file is a link",
      );
      if (row.parent !== undefined)
        assert.ok(
          panel.includes(data.log[row.parent]?.snapshot ?? "?"),
          "the parent snapshot",
        );
      const folders = new Set(
        row.wrote.map((file) =>
          (data.files[file]?.path ?? "").replace(/[^/]*$/, ""),
        ),
      );
      assert.equal(await tab.locator("#ins details.ex").count(), folders.size);
    });

    it("lists the kit's steps that fall there, performed or not, and the cases checked after it", async () => {
      await opened();
      const kit = data.kit;
      assert.ok(kit);
      const at = data.log.findIndex(
        (row, index) =>
          row.kitSteps.length > 0 &&
          kit.cases.some((each) => each.row === index),
      );
      assert.ok(at >= 0, "a row with a kit step and a case");
      await tab.locator(`.act[data-step="${at}"]`).click();
      const panel = (await tab.locator("#ins").textContent()) ?? "";
      for (const step of data.log[at]?.kitSteps ?? [])
        assert.ok(panel.includes(step.name), step.name);
      for (const each of kit.cases.filter((one) => one.row === at))
        assert.ok(panel.includes(each.rule), each.rule);
    });

    it("shows loudly a file its snapshot names that the pod does not hold", async () => {
      await tab.route("**/explorer.json", async (route) => {
        const response = await route.fetch();
        const changed = (await response.json()) as ExplorerData;
        const rows = changed.log.map((row, index) =>
          index === 1 ? { ...row, missing: ["records/gone.ttl"] } : row,
        );
        await route.fulfill({ response, json: { ...changed, log: rows } });
      });
      try {
        await opened();
        await tab.locator('.act[data-step="1"]').click();
        const alarm = tab.locator("#ins .missing");
        assert.ok(await alarm.isVisible());
        assert.match((await alarm.textContent()) ?? "", /records\/gone\.ttl/);
      } finally {
        await tab.unroute("**/explorer.json");
      }
    });

    it("has a control that returns to the last act, and a copied address opens the act", async () => {
      await opened();
      const last = data.log.length - 1;
      await tab.locator('.act[data-step="0"]').click();
      assert.equal(
        await tab.locator(".act.cur").getAttribute("data-step"),
        "0",
      );
      assert.match(decodeURIComponent(new URL(tab.url()).hash), /~log/);
      await tab
        .locator("#ins [data-step], #stepline [data-step]")
        .last()
        .click();
      assert.equal(
        await tab.locator(".act.cur").getAttribute("data-step"),
        String(last),
      );
      await tab.goto(`${served.url}index.html#%7Elog&step=0`);
      await tab.reload();
      await tab.waitForSelector(".row", { state: "attached" });
      assert.match((await tab.locator("#ins h1").textContent()) ?? "", /Act 0/);
    });

    it("moves to the selected pane on a phone", async () => {
      await opened(390);
      await tab.click('[data-pane="log"]');
      await tab.locator('.act[data-step="0"]').click();
      assert.equal(await tab.locator(".pane.on").getAttribute("data-p"), "ins");
    });
  });

  describe("when a file of the pod is open", () => {
    const open = async (kind: string) => {
      await opened();
      const target = data.files.find((file) => file.kind === kind);
      assert.ok(target, kind);
      await tab.fill("#flt", target.path.split("/").at(-1) ?? "");
      await tab.locator(`#tree [data-go="p:${target.path}"]`).click();
      await tab.waitForFunction(
        () =>
          !(
            document.getElementById("body")?.textContent ?? "Loading"
          ).startsWith("Loading"),
      );
      return target;
    };

    it("shows its statements as Turtle, with prefixes and grouped subjects, and no line a screen cannot hold", async () => {
      await open("record");
      const text = (await tab.locator("#body").textContent()) ?? "";
      assert.match(
        text,
        /^@prefix cascade: <https:\/\/ns\.cascadeprotocol\.org\/cascade#> \./m,
      );
      assert.ok(!text.includes("<https://ns.cascadeprotocol.org/cascade#"));
      assert.match(text, /^ {4}a /m);
      assert.ok(
        text.split("\n").every((line) => line.length < 120),
        "a line is longer than 120 characters",
      );
      const [wide, shown] = await tab
        .locator("#body")
        .evaluate((pre) => [pre.scrollWidth, pre.clientWidth]);
      assert.ok((wide ?? 0) <= (shown ?? 0), `${wide} > ${shown}`);
    });

    it("makes each IRI that names another file of the pod a numbered link that opens it", async () => {
      await open("revision");
      const links = tab.locator("#body a[data-go^='p:']");
      assert.ok((await links.count()) > 0, "no link in the Turtle");
      assert.ok((await tab.locator("#body .num").count()) > 0);
      const go = (await links.first().getAttribute("data-go")) ?? "";
      await links.first().click();
      assert.equal(
        await tab.locator("#ins .crumbs b").textContent(),
        go
          .slice(2)
          .split("/")
          .at(-1)
          ?.replace(/^([0-9a-f]{8})[0-9a-f-]{20,}/, "$1…"),
      );
    });

    it("lists the queries whose WHERE uses its terms under 'Read by', marked as approximate", async () => {
      const target = await open("record");
      const terms = (target.terms ?? []).map((index) => data.termList[index]);
      const readers = data.queries.filter((query) =>
        query.reads.some((term) => terms.includes(term)),
      );
      assert.ok(readers.length > 0, "a query reads a term of a record");
      const read = tab.locator("#ins .card", { hasText: "Read by" });
      assert.ok((await read.locator("a[data-go^='q:']").count()) > 0);
      assert.match((await read.textContent()) ?? "", /approximate/i);
    });
  });

  describe("when a folder of the pod is open", () => {
    it("labels the third card 'Contains', and lists the queries that read what it holds", async () => {
      await opened();
      const folder = data.files.find((file) => file.kind === "record");
      assert.ok(folder);
      const path = `${folder.path.split("/")[0]}/`;
      await tab.locator(`#tree [data-go="p:${path}"]`).click();
      const titles = await tab.locator("#ins .card h4").allTextContents();
      assert.deepEqual(titles, ["Written by", "Read by", "Contains"]);
      const read = tab.locator("#ins .card", { hasText: "Read by" });
      assert.ok((await read.locator("a[data-go^='q:']").count()) > 0);
    });
  });

  describe("when the explorer is drawn", () => {
    it("draws the tree as a directory: a folder icon, open or closed, and a file icon on each row", async () => {
      await opened();
      const dirs = tab.locator("#tree .row.dir .ic svg");
      assert.ok((await dirs.count()) > 0, "no folder icon");
      assert.ok((await tab.locator("#tree .row.file .ic svg").count()) > 0);
      const closed = await dirs.first().getAttribute("class");
      const first = tab.locator("#tree .row.dir").first();
      await first.locator(".tw").click();
      const after = await tab
        .locator("#tree .row.dir")
        .first()
        .locator(".ic svg")
        .getAttribute("class");
      assert.notEqual(after, closed, "open and closed look the same");
    });

    it("has a top bar with the pod's name and address, the legend of the source tags and the eight stops of the demo", async () => {
      await opened();
      const bar = tab.locator("header.top");
      const text = (await bar.textContent()) ?? "";
      assert.ok(text.includes(data.pod.title));
      assert.ok(text.includes(data.pod.address));
      for (const kind of ["pod", "vocabulary", "layout", "fixed"])
        assert.ok(
          (await bar.locator(`.legend .src.${kind}`).count()) === 1,
          kind,
        );
      const stops = await tab.locator(".stops .stop").allTextContents();
      assert.deepEqual(stops, [
        "Pod",
        "Log",
        "Records",
        "Judgments",
        "View definitions",
        "Materialized views",
        "Queries",
        "How an app finds things",
      ]);
      await tab.locator(".stops .stop", { hasText: "Queries" }).click();
      assert.match(
        (await tab.locator("#ins h1").textContent()) ?? "",
        /queries/,
      );
      await tab.locator(".stops .stop", { hasText: "Records" }).click();
      assert.match(
        (await tab.locator("#ins h1").textContent()) ?? "",
        /records/,
      );
      await tab.locator(".stops .stop", { hasText: "Log" }).click();
      assert.match((await tab.locator("#ins h1").textContent()) ?? "", /Act/);
    });

    it("draws, on the root, how it fits together, each box opening its folder", async () => {
      await opened();
      const boxes = tab.locator("#ins .flow .box");
      assert.equal(await boxes.count(), 7);
      await tab.locator("#ins .flow .box", { hasText: "derivations/" }).click();
      assert.match(
        (await tab.locator("#ins h1").textContent()) ?? "",
        /queries\/derivations\//,
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
