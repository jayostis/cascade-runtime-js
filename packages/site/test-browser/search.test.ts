import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import type { SearchRow } from "../src/agents.js";
import { Html, PLAIN, shell } from "../src/html.js";
import { type Served, servePages } from "../src/node/serve.js";
import { SEARCH_SCRIPT } from "../src/search-script.js";
import { STYLESHEET } from "../src/stylesheet.js";

const ROWS: SearchRow[] = [
  {
    path: "terms/index.html#cascade:Attachment",
    title: "cascade:Attachment",
    kind: "term",
    label: "attachment",
  },
  {
    path: "terms/index.html#cascade:AttachmentShape",
    title: "cascade:AttachmentShape",
    kind: "term",
    label: "Attachment shape",
  },
  { path: "guide/attachments.html", title: "Attaching a file", kind: "page" },
];

const page = (hubRoot: string, main: string): string =>
  shell({
    chrome: { ...PLAIN, search: true },
    title: "A page",
    stylesheet: `${hubRoot}site.css`,
    hubRoot,
    main: new Html(main),
  }).text;

/**
 * A reader types in the hub's box and gets a list of places to go. The script `search.js` and the box `shell()` writes are
 * run in Chromium over a small hub, which no unit test can: a click's anchor, the arrows' wrap, Enter, Escape, and a page
 * with no script.
 */
describe("Searching the hub in a browser · a click, the arrows, Enter, Escape, no script", () => {
  let folder: string;
  let served: Served;
  let browser: Browser;
  let tab: Page;

  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "search-"));
    const files: Record<string, string> = {
      "index.html": page("", "<p>The front page</p>"),
      "terms/index.html": page(
        "../",
        `<h3 id="cascade:Attachment">cascade:Attachment</h3><h3 id="cascade:AttachmentShape">cascade:AttachmentShape</h3>${"<p>filler</p>".repeat(200)}`,
      ),
      "guide/attachments.html": page("../", "<p>Attaching a file</p>"),
      "search.json": JSON.stringify(ROWS),
      "search.js": SEARCH_SCRIPT,
      "site.css": STYLESHEET,
    };
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), text);
    }
    served = await servePages(folder);
    browser = await chromium.launch();
    tab = await browser.newPage();
  });

  after(async () => {
    await browser?.close();
    await served?.close();
    if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
  });

  const list = () => tab.locator("#sx-find-list");
  const typed = async (address: string, text: string): Promise<void> => {
    await tab.unrouteAll();
    await tab.goto(`${served.url}${address}`);
    await tab.waitForSelector("form.sx-find:not([hidden])");
    await tab.fill("#sx-find-q", text);
    await list().waitFor({ state: "visible" });
  };
  const selected = () =>
    tab.locator('#sx-find-list li[aria-selected="true"]').allTextContents();

  describe("when a result is clicked", () => {
    it("goes to the page and its anchor", async () => {
      await typed("index.html", "attachment");
      await tab.locator("#sx-find-list li").first().click();
      await tab.waitForURL(/terms\/index\.html#cascade:Attachment$/);
    });

    it("closes the list when the result is an anchor of the page already open", async () => {
      await typed("terms/index.html", "attachment");
      await tab.locator("#sx-find-list li").nth(1).click();
      await tab.waitForURL(/#cascade:AttachmentShape$/);
      assert.ok(await list().isHidden());
    });
  });

  describe("when the arrows are pressed", () => {
    it("moves down the results and wraps to the first after the last, and up from none to the last", async () => {
      await typed("index.html", "attachment");
      const results = await tab.locator("#sx-find-list li").count();
      assert.equal(results, 3);
      const seen: string[] = [];
      for (let at = 0; at < results + 1; at += 1) {
        await tab.keyboard.press("ArrowDown");
        seen.push((await selected())[0] ?? "");
      }
      assert.equal(
        seen[0],
        seen[results],
        "the fourth press is the first again",
      );
      assert.equal(new Set(seen).size, results);
      await tab.fill("#sx-find-q", "attachment");
      await tab.keyboard.press("ArrowUp");
      assert.equal(
        (await selected())[0],
        await tab.locator("#sx-find-list li").last().textContent(),
      );
    });
  });

  describe("when Enter is pressed", () => {
    it("goes to the first result, or to the one the arrows chose", async () => {
      await typed("index.html", "attachment");
      await tab.keyboard.press("Enter");
      await tab.waitForURL(/terms\/index\.html#cascade:Attachment$/);
      await typed("index.html", "attachment");
      await tab.keyboard.press("ArrowDown");
      await tab.keyboard.press("ArrowDown");
      await tab.keyboard.press("Enter");
      await tab.waitForURL(/terms\/index\.html#cascade:AttachmentShape$/);
    });

    it("waits for search.json when it has not arrived, then goes to the first result", async () => {
      await tab.unrouteAll();
      await tab.route("**/search.json", async (route) => {
        await new Promise((done) => setTimeout(done, 600));
        await route.continue();
      });
      await tab.goto(`${served.url}index.html`);
      await tab.waitForSelector("form.sx-find:not([hidden])");
      await tab.fill("#sx-find-q", "attachment");
      await tab.keyboard.press("Enter");
      await tab.waitForURL(/terms\/index\.html#cascade:Attachment$/);
      await tab.unrouteAll();
    });
  });

  describe("when Escape is pressed", () => {
    it("empties the box and closes the list", async () => {
      await typed("index.html", "attachment");
      await tab.keyboard.press("Escape");
      assert.equal(await tab.inputValue("#sx-find-q"), "");
      assert.ok(await list().isHidden());
    });
  });

  describe("when focus leaves the box", () => {
    it("closes the list", async () => {
      await typed("index.html", "attachment");
      await tab.keyboard.press("Tab");
      assert.ok(await list().isHidden());
    });
  });

  describe("when search.json fails to load", () => {
    it("says so, and loads it again on the next key", async () => {
      await tab.unrouteAll();
      let refused = true;
      await tab.route("**/search.json", async (route) => {
        if (refused) await route.abort();
        else await route.continue();
      });
      await tab.goto(`${served.url}index.html`);
      await tab.waitForSelector("form.sx-find:not([hidden])");
      await tab.fill("#sx-find-q", "att");
      await list().waitFor({ state: "visible" });
      assert.match((await list().textContent()) ?? "", /could not be loaded/);
      refused = false;
      await tab.fill("#sx-find-q", "attachment");
      await tab.waitForSelector("#sx-find-list li[role=option]");
      assert.equal(await tab.locator("#sx-find-list li").count(), 3);
      await tab.unrouteAll();
    });
  });

  describe("given no script", () => {
    it("shows no box", async () => {
      const bare = await browser.newContext({ javaScriptEnabled: false });
      const quiet = await bare.newPage();
      await quiet.goto(`${served.url}index.html`);
      assert.ok(await quiet.locator("form.sx-find").isHidden());
      await bare.close();
    });
  });
});
