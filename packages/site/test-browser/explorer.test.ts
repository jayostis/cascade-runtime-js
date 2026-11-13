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
import {
  EXPLORER_FILE,
  type ExplorerData,
  type ExplorerEntry,
} from "../src/explorer.js";
import { type Served, servePages } from "../src/node/serve.js";
import { Site } from "../src/site.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const KIT = "tamsin-vale";
/** A kit whose pod has entries of several records, matcher judgments and a disagreement between records. */
const JOINED = "priya-natarajan";

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
  let joined: ExplorerData;
  let servedJoined: Served;
  const folders: string[] = [];

  /** A kit's pod built and written out as the site, then served. */
  async function site(kit: string): Promise<{
    folder: string;
    data: ExplorerData;
    served: Served;
  }> {
    const vocabulary = await localVocabulary(ROOT);
    const pod = new MemoryFiles("https://pod.example/");
    await featurePod(vocabulary, `conformance/${kit}/${kit}.feature`, pod, {});
    const built = await (
      await Site.build({
        vocabulary: vocabulary.files,
        layout: vocabulary.layout,
        build: vocabulary.build,
        pod,
        lens: vocabulary.config.lens,
        defaultLens: vocabulary.config.lens,
        newStore: () => new OxigraphStore(),
        name: kit,
        at: "2026-03-03T08:00:00Z",
        ask: `npm run ask -- ${kit}`,
        kit,
      })
    ).files();
    const folder = mkdtempSync(join(tmpdir(), "explorer-"));
    for (const [path, bytes] of built) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), bytes);
    }
    return {
      folder,
      data: JSON.parse(
        new TextDecoder().decode(built.get(EXPLORER_FILE)),
      ) as ExplorerData,
      served: await servePages(folder),
    };
  }

  before(async () => {
    const small = await site(KIT);
    folder = small.folder;
    data = small.data;
    served = small.served;
    const big = await site(JOINED);
    folders.push(big.folder);
    joined = big.data;
    servedJoined = big.served;
    browser = await chromium.launch();
    tab = await browser.newPage();
  });

  after(async () => {
    await browser?.close();
    await served?.close();
    await servedJoined?.close();
    for (const each of [folder, ...folders])
      if (each !== undefined) rmSync(each, { recursive: true, force: true });
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

    it("keeps each path of the directory table whole at a desktop width", async () => {
      await opened(1440);
      const wraps = await tab
        .locator("#ins table")
        .first()
        .locator("tbody tr td:first-child")
        .evaluateAll((cells) =>
          cells.map((cell) => getComputedStyle(cell).whiteSpace),
        );
      assert.ok(wraps.length > 0);
      for (const wrap of wraps) assert.equal(wrap, "nowrap");
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
      assert.ok(row.wrote.length > 0, "the act wrote files");
      assert.equal(
        await tab.locator("#ins details.ex li a[data-go^='p:']").count(),
        row.wrote.length,
        "each file it wrote is listed once, under its folder",
      );
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
      for (const control of ["#ins .back", "#stepline .back"]) {
        await tab.locator('.act[data-step="0"]').click();
        await tab.locator(control).click();
        assert.equal(
          await tab.locator(".act.cur").getAttribute("data-step"),
          String(last),
          control,
        );
      }
      await tab.goto(`${served.url}index.html#%7Elog&step=0`);
      await tab.reload();
      await tab.waitForSelector(".row", { state: "attached" });
      assert.match((await tab.locator("#ins h1").textContent()) ?? "", /Act 0/);
    });

    it("scrolls the log so that the selected act is in view, from the slider and from an address", async () => {
      await tab.route("**/explorer.json", async (route) => {
        const response = await route.fetch();
        const changed = (await response.json()) as ExplorerData;
        const last = changed.log.at(-1) as ExplorerData["log"][number];
        await route.fulfill({
          response,
          json: {
            ...changed,
            log: [...changed.log, ...Array.from({ length: 30 }, () => last)],
          },
        });
      });
      try {
        await opened();
        const inView = () =>
          tab.evaluate(() => {
            const pane = document
              .getElementById("log")
              ?.getBoundingClientRect();
            const row = document
              .querySelector(".act.cur")
              ?.getBoundingClientRect();
            return (
              pane !== undefined &&
              row !== undefined &&
              row.top >= pane.top - 1 &&
              row.bottom <= pane.bottom + 1
            );
          });
        await tab.fill("#rng", "25");
        assert.ok(await inView(), "act 25 is out of view after the slider");
        await tab.locator('.act[data-step="4"]').scrollIntoViewIfNeeded();
        await tab.locator('.act[data-step="4"]').click();
        assert.ok(await inView(), "act 4 is out of view after a click");
        await tab.goto(`${served.url}index.html#%7Elog&step=30`);
        await tab.reload();
        await tab.waitForSelector(".row", { state: "attached" });
        assert.ok(
          await inView(),
          "act 30 is out of view when opened by address",
        );
      } finally {
        await tab.unroute("**/explorer.json");
      }
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
      const target = data.files.find((file) => file.kind === kind);
      assert.ok(target, kind);
      return openFile(target);
    };
    const openFile = async (target: ExplorerData["files"][number]) => {
      await opened();
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
      assert.doesNotMatch(
        text,
        /^(?!@prefix).*<https:\/\/ns\.cascadeprotocol\.org\/cascade#/m,
      );
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

    it("lists under 'Read by' for a materialized view only the questions and the labels query, never its writer, a derivation or a matcher", async () => {
      const target = await open("view");
      const read = tab.locator("#ins .card", { hasText: "Read by" });
      const paths = await read
        .locator("a[data-go^='q:']")
        .evaluateAll((links) =>
          links.map((link) => link.getAttribute("data-go")?.slice(2) ?? ""),
        );
      assert.ok(paths.length > 0, "no query reads the view");
      const writer = data.queries[target.writtenBy ?? -1]?.path;
      assert.ok(writer, "the view has a writer");
      for (const path of paths) {
        const query = data.queries.find((each) => each.path === path);
        assert.ok(query, path);
        assert.ok(
          query.group.startsWith("questions/") || path === "queries/labels.rq",
          `${path} (${query.group}) is listed as reading a built file`,
        );
        assert.notEqual(path, writer, "the view's writer is listed");
      }
    });

    it("makes a document's subject, which is the hash of its bytes, a link to the bytes", async () => {
      const bytes = data.files.find(
        (each) => each.kind === "bytes" && each.document !== undefined,
      );
      assert.ok(bytes, "the pod stores bytes under a document");
      const document = data.files[bytes.document ?? -1];
      assert.ok(document);
      await openFile(document);
      assert.ok(
        (await tab.locator(`#body a[data-go="p:${bytes.path}"]`).count()) > 0,
        "the Turtle does not link the bytes",
      );
      assert.ok(
        (await tab
          .locator("#ins .card", { hasText: "Names and is named by" })
          .locator(`a[data-go="p:${bytes.path}"]`)
          .count()) > 0,
        "the card for names does not list the bytes",
      );
    });

    it("prints an entry before the members whose names extend its own", async () => {
      let pairs = 0;
      for (const view of data.files.filter((each) => each.kind === "view")) {
        await openFile(view);
        const subjects = ((await tab.locator("#body").textContent()) ?? "")
          .split("\n")
          .flatMap((line) => /^<(#[^>]*)>/.exec(line)?.[1] ?? []);
        subjects.forEach((later, at) => {
          const earlier = subjects.findIndex(
            (each) => each !== later && later.startsWith(each),
          );
          if (earlier < 0) return;
          pairs += 1;
          assert.ok(earlier < at, `${later} is before ${subjects[earlier]}`);
        });
      }
      assert.ok(pairs > 0, "no view of the pod has an entry with members");
    });

    it("hangs a wrapped line of the Turtle under its own start on a phone", async () => {
      const target = data.files.find((each) => each.kind === "revision");
      assert.ok(target);
      await tab.setViewportSize({ width: 390, height: 800 });
      await tab.goto(`${served.url}index.html`);
      await tab.waitForSelector(".row", { state: "attached" });
      await tab.click('[data-pane="tree"]');
      await tab.fill("#flt", target.path.split("/").at(-1) ?? "");
      await tab.locator(`#tree [data-go="p:${target.path}"]`).click();
      await tab.waitForFunction(
        () =>
          !(
            document.getElementById("body")?.textContent ?? "Loading"
          ).startsWith("Loading"),
      );
      const wrapped = await tab.locator("#body .ln").evaluateAll((lines) =>
        lines.flatMap((line) => {
          const range = document.createRange();
          range.selectNodeContents(line);
          const rects = [...range.getClientRects()].filter(
            (rect) => rect.width > 0,
          );
          const tops = [...new Set(rects.map((rect) => Math.round(rect.top)))];
          if (tops.length < 2) return [];
          const left = (top: number) =>
            Math.min(
              ...rects
                .filter((rect) => Math.round(rect.top) === top)
                .map((rect) => rect.left),
            );
          return [[left(tops[0] ?? 0), left(tops[1] ?? 0)]];
        }),
      );
      assert.ok(wrapped.length > 0, "no line of the Turtle wraps at 390 px");
      for (const [first, next] of wrapped)
        assert.ok((next ?? 0) > (first ?? 0), `${next} is not under ${first}`);
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

    it("gives each source its own colour in the legend, the same on every label tag", async () => {
      await opened();
      const kinds = ["pod", "vocabulary", "query", "layout", "kit", "fixed"];
      const colour = (selector: string) =>
        tab
          .locator(selector)
          .first()
          .evaluate((tag) => getComputedStyle(tag).color);
      const legend = await Promise.all(
        kinds.map((kind) => colour(`header.top .legend .src.${kind}`)),
      );
      assert.equal(new Set(legend).size, kinds.length, legend.join(" "));
      for (const kind of ["pod", "layout", "fixed"])
        assert.equal(
          await colour(`#ins .src.${kind}`),
          await colour(`header.top .legend .src.${kind}`),
          kind,
        );
    });

    it("draws, on the root, how it fits together, each box opening its folder", async () => {
      await opened();
      const boxes = tab.locator("#ins .flow .box");
      assert.ok((await boxes.count()) >= 5, "the strip's five stages");
      await tab.locator("#ins .flow .box", { hasText: "derivations/" }).click();
      assert.match(
        (await tab.locator("#ins h1").textContent()) ?? "",
        /queries\/derivations\//,
      );
    });
  });

  /** The joined kit's pod, opened. */
  async function openedJoined(width = 1400): Promise<void> {
    await tab.setViewportSize({ width, height: width < 600 ? 800 : 900 });
    await tab.goto(`${servedJoined.url}index.html`);
    await tab.waitForSelector(".row", { state: "attached" });
  }

  /** A node of the joined pod, opened from its address. */
  async function joinedAt(id: string, ready: string): Promise<void> {
    await openedJoined();
    await tab.goto(`${servedJoined.url}index.html#${encodeURIComponent(id)}`);
    await tab.waitForSelector(ready);
  }

  const pathOf = (index: number | undefined, from = data): string =>
    from.files[index ?? -1]?.path ?? "";

  const entryWhere = (
    from: ExplorerData,
    predicate: (entry: ExplorerEntry) => boolean,
  ): ExplorerEntry => {
    for (const view of from.views) {
      const entry = view.entries.find(predicate);
      if (entry !== undefined) return entry;
    }
    throw new Error("the kit's pod has no such entry");
  };
  const fileOfEntry = (entry: ExplorerEntry): string =>
    entry.id.split("#")[0] ?? "";

  describe("when an act's kit steps and cases are shown", () => {
    it("gives each kit step the sentence the feature states for it", async () => {
      await opened();
      const at = data.log.findIndex((row) => row.kitSteps.length > 0);
      const step = data.log[at]?.kitSteps[0];
      assert.ok(step?.text);
      await tab.locator(`.act[data-step="${at}"]`).click();
      assert.ok(
        ((await tab.locator("#ins").textContent()) ?? "").includes(step.text),
        step.text,
      );
    });

    it("opens a kit case to the steps its example states, with their tables", async () => {
      await openedJoined();
      const found = joined.kit?.cases.find((each) =>
        each.steps?.some((step) => step.table !== undefined),
      );
      assert.ok(found?.steps, "a case with a table");
      await tab.locator(`.act[data-step="${found.row}"]`).click();
      const open = tab.locator("#ins details.case", { hasText: found.example });
      await open.locator("summary").first().click();
      const step = found.steps.find((each) => each.table !== undefined);
      assert.equal(
        await open.locator("table").first().locator("tbody tr").count(),
        (step?.table?.length ?? 1) - 1,
      );
    });
  });

  describe("when a materialized view is open", () => {
    const joiner = () => entryWhere(joined, (each) => each.members.length > 1);

    it("lists its entries in the tree below it, and an entry opens", async () => {
      await joinedAt(`p:${fileOfEntry(joiner())}`, "#ins table.entries");
      const entry = joiner();
      const view = joined.views.find(
        (each) => each.file === fileOfEntry(entry),
      );
      const rows = tab.locator(`#tree .row[data-go^="p:${view?.file}#"]`);
      assert.equal(await rows.count(), view?.entries.length);
      await tab.locator(`#tree [data-go="p:${entry.id}"]`).click();
      assert.ok(await tab.locator("#ins table.et").isVisible());
    });

    it("lists on the file's panel each entry, the records it joins and the judgments between them", async () => {
      const entry = joiner();
      await joinedAt(`p:${fileOfEntry(entry)}`, "#ins table.entries");
      const row = tab.locator("#ins table.entries tbody tr", {
        has: tab.locator(`a[data-go="p:${entry.id}"]`),
      });
      assert.equal(
        await row.locator(`a[data-go^="p:records/"]`).count(),
        entry.members.length,
      );
      assert.equal(
        await row.locator(`a[data-go^="p:judgments/"]`).count(),
        entry.within.length,
      );
    });

    it("opens an entry as one column for each record it joins, the fields they disagree on shaded", async () => {
      const entry = entryWhere(joined, (each) =>
        each.fields.some((field) => field.disagree),
      );
      await joinedAt(`p:${entry.id}`, "#ins table.et");
      const table = tab.locator("#ins table.et");
      assert.equal(
        await table.locator("thead th").count(),
        2 + entry.members.length + (entry.others?.length ?? 0),
        "a column for the field, the entry and each record",
      );
      assert.equal(
        await table.locator("tbody tr.diff").count(),
        entry.fields.filter((field) => field.disagree).length,
      );
      assert.equal(
        await table.locator("tbody tr").count(),
        entry.fields.length,
      );
    });

    it("names the judgments that join an entry's records, and whether each counts", async () => {
      const entry = entryWhere(joined, (each) => each.within.length > 0);
      await joinedAt(`p:${entry.id}`, "#ins table.et");
      const within = tab.locator("#ins .within li");
      assert.equal(await within.count(), entry.within.length);
      for (const index of entry.within) {
        const counts = joined.files[index]?.judgment?.counts;
        const row = tab.locator("#ins .within li", {
          has: tab.locator(`a[data-go="p:${pathOf(index, joined)}"]`),
        });
        assert.match(
          (await row.textContent()) ?? "",
          counts === false ? /does not count/ : /counts/,
        );
      }
    });

    it("shows an entry's own statements only, not another entry's", async () => {
      const entry = entryWhere(
        joined,
        (each) =>
          each.members.length > 1 &&
          (joined.views.find((view) => view.file === fileOfEntry(each))?.entries
            .length ?? 0) > 1,
      );
      await joinedAt(`p:${entry.id}`, "#ins table.et");
      await tab.waitForFunction(
        () =>
          !(
            document.getElementById("body")?.textContent ?? "Loading"
          ).startsWith("Loading"),
      );
      const turtle = (await tab.locator("#ins pre.turtle").textContent()) ?? "";
      assert.ok(turtle.includes("mergedFrom"), "the entry's own statements");
      const siblings = joined.views
        .flatMap((view) => view.entries)
        .filter(
          (each) =>
            each.id !== entry.id && fileOfEntry(each) === fileOfEntry(entry),
        );
      assert.ok(siblings.length > 0);
      for (const other of siblings)
        assert.ok(
          !turtle.includes((other.id.split("#")[1] ?? "?").slice(0, 8)),
          "another entry's subject",
        );
    });
  });

  describe("when a record is open", () => {
    const multiple = () => {
      const record = joined.files.find(
        (each) => each.kind === "record" && (each.arrivals?.length ?? 0) > 1,
      );
      assert.ok(record?.arrivals);
      return record;
    };

    it("lists its arrivals in time order: the revision, the version it sets and the act that wrote it", async () => {
      const record = multiple();
      await joinedAt(`p:${record.path}`, "#ins table.arrivals tbody tr");
      const rows = tab.locator("#ins table.arrivals tbody tr");
      assert.equal(await rows.count(), record.arrivals?.length);
      const revisions = await rows
        .locator("td:nth-child(2) a")
        .evaluateAll((links) =>
          links.map((link) => link.getAttribute("data-go")),
        );
      assert.deepEqual(
        revisions,
        record.arrivals?.map(
          (arrival) => `p:${pathOf(arrival.revision, joined)}`,
        ),
      );
      assert.ok(
        (await rows.first().locator("td a[data-step]").count()) > 0,
        "the act that wrote the revision",
      );
    });

    it("follows a revision's version to the version file, and links the entry that shows the record", async () => {
      const record = multiple();
      const version = record.arrivals?.[0]?.version;
      assert.ok(version !== undefined);
      assert.ok(record.entry !== undefined, "the record is in an entry");
      await joinedAt(`p:${record.path}`, "#ins table.arrivals tbody tr");
      assert.ok(
        await tab
          .locator(`#ins a[data-go="p:${record.entry}"]`)
          .first()
          .isVisible(),
      );
      await tab
        .locator(
          `#ins table.arrivals a[data-go="p:${pathOf(version, joined)}"]`,
        )
        .first()
        .click();
      assert.match((await tab.locator("#ins h1").textContent()) ?? "", /\.ttl/);
      assert.ok(
        (await tab.locator("#ins .crumbs").textContent())?.includes(
          pathOf(version, joined).split("/")[1] ?? "?",
        ),
      );
    });
  });

  describe("when a judgment is open", () => {
    const by = (who: "matcher" | "person") => {
      const found = joined.files.find((each) => each.judgment?.by === who);
      assert.ok(found?.judgment, who);
      return { path: found.path, judgment: found.judgment };
    };

    it("says what a matcher's judgment decides: its verdict, who made it, whether it counts, and each member", async () => {
      const { path, judgment } = by("matcher");
      await joinedAt(`p:${path}`, "#ins .judging");
      const panel = (await tab.locator("#ins .judging").textContent()) ?? "";
      assert.match(panel, /the matcher/);
      assert.match(panel, /same/i);
      assert.match(
        panel,
        judgment.counts === false ? /does not count/ : /counts/,
      );
      assert.equal(
        await tab.locator("#ins .judging .members a[data-go^='p:']").count(),
        judgment.members.length,
      );
    });

    it("names the rule a matcher's judgment was made under, and opens the query the rule's hash finds", async () => {
      const { path, judgment } = by("matcher");
      const rule = joined.matcherRules[judgment.rule ?? -1];
      const query = joined.queries[rule?.query ?? -1];
      assert.ok(query, "the rule names a query");
      await joinedAt(`p:${path}`, "#ins .judging");
      const link = tab.locator(`#ins .judging a[data-go="q:${query.path}"]`);
      assert.ok(await link.first().isVisible());
      assert.match(
        (await tab.locator("#ins .judging").textContent()) ?? "",
        /hash/,
      );
      await link.first().click();
      assert.ok(
        (await tab.locator("#ins .crumbs").textContent())?.includes(query.name),
      );
    });

    it("says that a person made a person's judgment, and links the lens that decides whether it counts", async () => {
      const { path } = by("person");
      await joinedAt(`p:${path}`, "#ins .judging");
      assert.match(
        (await tab.locator("#ins .judging").textContent()) ?? "",
        /a person/,
      );
      assert.ok(
        await tab
          .locator('#ins .judging a[data-go^="q:queries/lenses/"]')
          .first()
          .isVisible(),
      );
    });
  });

  describe("when a query is open", () => {
    const ordered = () =>
      joined.queries.filter((each) => each.order !== undefined);
    const earlier = (each: ExplorerData["queries"][number]) =>
      ordered().filter(
        (other) =>
          (other.order ?? 0) < (each.order ?? 0) &&
          other.writes.some((term) => each.reads.includes(term)),
      );
    const derivation = () => {
      const found = ordered().find((each) => earlier(each).length > 1);
      assert.ok(found, "a derivation that reads what earlier ones derived");
      return found;
    };

    it("says its step of the build, and lists what it reads from the derivations that ran before it", async () => {
      const found = derivation();
      await joinedAt(`q:${found.path}`, "#ins details.ex");
      assert.match(
        (await tab.locator("#ins .chips").textContent()) ?? "",
        new RegExp(`step ${(found.order ?? 0) + 1} of ${ordered().length}`),
      );
      const listed = await tab
        .locator("#ins table.derivedby a[data-go^='q:']")
        .evaluateAll((links) =>
          links.map((link) => link.getAttribute("data-go")),
        );
      assert.deepEqual(
        [...listed].sort(),
        earlier(found)
          .map((other) => `q:${other.path}`)
          .sort(),
      );
    });

    it("shows the query's text open under its header comment", async () => {
      const found = derivation();
      await joinedAt(`q:${found.path}`, "#ins details.ex");
      const text = tab.locator("#ins details.ex[open] pre.code");
      await text.first().waitFor();
      assert.match(
        (await text.first().textContent()) ?? "",
        /CONSTRUCT|SELECT/,
      );
    });

    it("lists, for a question, the files the build wrote that it reads", async () => {
      const builtTerms = new Set(
        joined.files
          .filter((file) => file.writer === "build")
          .flatMap((file) => (file.terms ?? []).map((i) => joined.termList[i])),
      );
      const question = joined.queries.find(
        (each) =>
          each.group.startsWith("questions/") &&
          each.reads.some((term) => builtTerms.has(term)),
      );
      assert.ok(question, "a question that reads a built file");
      await joinedAt(`q:${question.path}`, "#ins details.ex");
      const reads = tab.locator("#ins table.reads a[data-go^='p:']");
      assert.ok((await reads.count()) > 0, "a file it reads");
      for (const go of await reads.evaluateAll((links) =>
        links.map((link) => link.getAttribute("data-go")),
      ))
        assert.equal(
          joined.files.find((file) => `p:${file.path}` === go)?.writer,
          "build",
          String(go),
        );
    });
  });

  describe("when the Solid chain is shown", () => {
    it("lays out, on the root, the hops from the card to a view, each file's link opening the file", async () => {
      await opened();
      assert.equal(
        await tab.locator("#ins .hops .hop").count(),
        data.chain.length + 1,
      );
      const first = data.chain[0];
      assert.ok(first);
      await tab
        .locator(`#ins .hops .hop a[data-go="p:${pathOf(first.file)}"]`)
        .first()
        .click();
      assert.match((await tab.locator("#ins h1").textContent()) ?? "", /card/);
    });

    it("marks, on each file of the chain, which hop it is, and follows each triple's object to the next file", async () => {
      await opened();
      for (const [index, hop] of data.chain.entries()) {
        await tab.goto(
          `${served.url}index.html#${encodeURIComponent(`p:${pathOf(hop.file)}`)}`,
        );
        const marked = tab.locator("#ins .hops .hop.hl");
        await marked.waitFor();
        assert.equal(await marked.count(), 1);
        assert.equal(
          ((await marked.locator(".n").first().textContent()) ?? "").trim(),
          String(index + 1),
        );
        const next = hop.triples.find((triple) => triple.go !== undefined);
        if (next?.go !== undefined)
          assert.ok(
            await marked
              .locator(`a[data-go="p:${pathOf(next.go)}"]`)
              .first()
              .isVisible(),
            `the link from hop ${index + 1}`,
          );
      }
    });

    it("lists each registration of the type index with the class it holds and the file it points at", async () => {
      await opened();
      const index = data.chain.at(-1);
      assert.ok(index?.registrations?.length);
      await tab.goto(
        `${served.url}index.html#${encodeURIComponent(`p:${pathOf(index.file)}`)}`,
      );
      await tab.waitForSelector("#ins .hop.hl table");
      assert.equal(
        await tab.locator("#ins .hop.hl table tbody tr").count(),
        index.registrations.length,
      );
    });

    it("opens from the demo's last stop with the card's hop marked", async () => {
      await opened();
      await tab
        .locator(".stop", { hasText: "How an app finds things" })
        .click();
      assert.equal(await tab.locator("#ins .hop.hl").count(), 1);
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
