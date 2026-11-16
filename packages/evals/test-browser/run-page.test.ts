import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import type { Results } from "../src/results.js";
import { renderSite } from "../src/site.js";

const recorded = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../test/fixtures/recorded-run/results.json", import.meta.url),
    ),
    "utf8",
  ),
) as Results;
const ID = "tamsin-vale.opus-5-5.r1";
const RUN = `instances/${ID}.html`;
const REASONING = `instances/${ID}.reasoning-pod-checkup.html`;

/**
 * A run's page holds the answers; each arm's reasoning and doctor's card are pages of their own. A link that named
 * a point of the reasoning on the run's page, and a link to a point on the reasoning page, both still land on it.
 * This runs the pages' own script in Chromium, which a unit test cannot.
 */
describe("The evals run page's deep links in a browser · ?open=, #point, the first and last point, a bad id", () => {
  let browser: Browser;
  let tab: Page;
  let folder: string;
  let server: Server;
  let base: string;

  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "evals-run-"));
    for (const [path, html] of renderSite([
      { name: "fixture-1", results: recorded },
    ])) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), html);
    }
    server = createServer((req, res) => {
      try {
        const path = decodeURIComponent((req.url ?? "/").split(/[?#]/)[0]!);
        const body = readFileSync(join(folder, path));
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(body);
      } catch {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    assert.ok(address !== null && typeof address === "object");
    base = `http://127.0.0.1:${address.port}/`;
    browser = await chromium.launch();
    tab = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  });

  after(async () => {
    await browser?.close();
    await new Promise<void>((done) =>
      server ? server.close(() => done()) : done(),
    );
    if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
  });

  /** The ids of the reasoning page's points, in order. */
  const points = () =>
    tab.$$eval("details.item", (all) => all.map((it) => it.id));
  const isOpen = (id: string) =>
    tab.$eval(`[id="${id}"]`, (el) => (el as HTMLDetailsElement).open);
  const inView = (id: string) =>
    tab.$eval(`[id="${id}"] > summary`, (el) => {
      const box = el.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight;
    });

  describe("when the reasoning page is opened at a point", () => {
    it("opens the last point and scrolls to it, though the first one starts open", async () => {
      await tab.goto(`${base}${REASONING}`);
      const ids = await points();
      assert.ok(ids.length >= 2, "the question has two points or more");
      const last = ids.at(-1)!;
      await tab.goto(`${base}${REASONING}#${last}`);
      assert.equal(await isOpen(last), true);
      assert.equal(await inView(last), true);
    });

    it("opens and scrolls to the first point", async () => {
      await tab.goto(`${base}${REASONING}`);
      const [first] = await points();
      await tab.goto(`${base}${REASONING}#${first}`);
      assert.equal(await isOpen(first!), true);
      assert.equal(await inView(first!), true);
    });

    it("opens and scrolls to a point when the hash changes on the page, though the browser has not moved", async () => {
      await tab.goto(`${base}${REASONING}`);
      const ids = await points();
      await tab.evaluate((id) => {
        location.hash = id;
      }, ids.at(-1)!);
      await tab.waitForFunction(
        (id) =>
          (document.getElementById(id) as HTMLDetailsElement | null)?.open,
        ids.at(-1)!,
      );
      assert.equal(await inView(ids.at(-1)!), true);
    });

    it("scrolls back to a point that is already open when its link is followed again", async () => {
      await tab.goto(`${base}${REASONING}`);
      const last = (await points()).at(-1)!;
      await tab.goto(`${base}${REASONING}#${last}`);
      await tab.evaluate(() => window.scrollTo(0, 0));
      await tab.evaluate((id) => {
        location.hash = "";
        location.hash = id;
      }, last);
      await tab.waitForFunction((id) => {
        const box = document
          .getElementById(id)!
          .querySelector("summary")!
          .getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight;
      }, last);
    });

    it("opens nothing and breaks nothing for an id the page does not hold", async () => {
      const errors: string[] = [];
      tab.on("pageerror", (e) => errors.push(e.message));
      await tab.goto(`${base}${REASONING}`);
      const started = (await tab.$$("details.item[open]")).length;
      await tab.goto(`${base}${REASONING}#no-such-point`);
      assert.deepEqual(errors, []);
      assert.equal((await tab.$$("details.item[open]")).length, started);
    });
  });

  describe("when the run's page is opened with `?open=` naming a point of the reasoning", () => {
    it("lands on that point of the reasoning page, open and in view", async () => {
      await tab.goto(`${base}${REASONING}`);
      const last = (await points()).at(-1)!;
      await tab.goto(`${base}${RUN}?open=${last}`);
      await tab.waitForURL(`**/${REASONING}*`);
      assert.equal(await isOpen(last), true);
      assert.equal(await inView(last), true);
    });

    it("lands the same way for the point as a `#` hash", async () => {
      await tab.goto(`${base}${REASONING}`);
      const last = (await points()).at(-1)!;
      await tab.goto(`${base}${RUN}#${last}`);
      await tab.waitForURL(`**/${REASONING}*`);
      assert.equal(await isOpen(last), true);
      assert.equal(await inView(last), true);
    });

    it("stays on the run's page for an id nothing holds", async () => {
      await tab.goto(`${base}${RUN}?open=pod-nothing-9`);
      assert.match(tab.url(), /\.r1\.html/);
      assert.equal((await tab.$$("svg.graph")).length, 0);
    });
  });
});
