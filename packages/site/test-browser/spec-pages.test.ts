import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { MemoryFiles } from "@cascade-runtime/runtime";
import { chromium, type Browser, type Page } from "playwright";
import { type Served, servePages } from "../src/node/serve.js";
import {
  kimVocabulary,
  pagesOf,
  RAN_WITH,
  text,
} from "../test/kim-vocabulary.js";

/** A feature of `count` rules, M1 on, each long enough that a screen holds a part of one. */
const featureOf = (name: string, letter: string, count: number): string =>
  `Feature: ${name}\n${Array.from({ length: count }, (_, at) => {
    const number = at + 1;
    const body = Array.from(
      { length: 6 },
      (_, paragraph) =>
        `    Paragraph ${paragraph + 1} of ${letter}${number}: the rule says what it says, at the length of a sentence that wraps on a narrow column and takes some height on a wide one.\n`,
    ).join("\n");
    return `  Rule: ${letter}${number}. Rule number ${number} of ${name}\n${body}`;
  }).join("\n")}`;

const WINDOW = { width: 1280, height: 800 };

/** The sidebar's marked link's address, or none. */
const marked = (tab: Page): Promise<string | null> =>
  tab.evaluate(
    () =>
      document
        .querySelector(".rules-nav a[aria-current]")
        ?.getAttribute("href") ?? null,
  );

/** After the page has handled its scroll: two frames. */
const settled = (tab: Page): Promise<void> =>
  tab.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );

/** The rule in view: the last one whose top is above the line, the last when the page is at its end, else the first. */
const inView = (tab: Page): Promise<string> =>
  tab.evaluate(() => {
    const sections = [...document.querySelectorAll("section.rule[id]")];
    const atEnd =
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 2;
    if (atEnd) return `#${sections[sections.length - 1]?.id}`;
    let current = sections[0];
    for (const section of sections)
      if (section.getBoundingClientRect().top <= 20) current = section;
    return `#${current?.id}`;
  });

/**
 * The page's own script runs in Chromium over a built specification: which rule its contents marks after a scroll, on
 * load at an address, after a click and at the top, and that the mark is in the sidebar's view and changes no height.
 */
describe("The specification's pages · specPages()", () => {
  let folder: string;
  let served: Served;
  let browser: Browser;
  let tab: Page;

  before(async () => {
    const vocabulary: MemoryFiles = await kimVocabulary();
    await vocabulary.write(
      "runtime/matcher.feature",
      text(featureOf("Matcher", "M", 20)),
    );
    await vocabulary.write(
      "runtime/short.feature",
      text(featureOf("Short", "S", 3)),
    );
    await vocabulary.write(
      "runtime/single.feature",
      text(featureOf("Single", "O", 1)),
    );
    const pages = await pagesOf(vocabulary, [], RAN_WITH);
    folder = mkdtempSync(join(tmpdir(), "spec-"));
    for (const [path, bytes] of pages.files) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), bytes);
    }
    served = await servePages(folder);
    browser = await chromium.launch();
    tab = await browser.newPage({ viewport: WINDOW });
  });

  after(async () => {
    await browser?.close();
    await served?.close();
    if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
  });

  const opened = async (address: string): Promise<void> => {
    await tab.goto(`${served.url}${address}`);
    await settled(tab);
  };

  describe("when the page is scrolled", () => {
    it("marks the rule in view, and keeps its link inside the sidebar", async () => {
      await opened("matcher.html");
      const height = await tab.evaluate(
        () => document.documentElement.scrollHeight,
      );
      for (let y = 0; y <= height; y += 450) {
        await tab.evaluate((to) => window.scrollTo(0, to), y);
        await settled(tab);
        assert.equal(await marked(tab), await inView(tab), `at ${y} px`);
        assert.equal(
          await tab.evaluate(() => {
            const nav = document.querySelector(".rules-nav") as HTMLElement;
            const link = nav.querySelector("a[aria-current]") as HTMLElement;
            const inside = nav.getBoundingClientRect();
            const at = link.getBoundingClientRect();
            return at.top >= inside.top - 1 && at.bottom <= inside.bottom + 1;
          }),
          true,
          `the marked link is inside the sidebar at ${y} px`,
        );
      }
    });

    it("marks the first rule, with the sidebar at its top, when it is scrolled back to the top", async () => {
      await opened("matcher.html");
      await tab.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      await settled(tab);
      assert.equal(await marked(tab), "#m20");
      await tab.evaluate(() => window.scrollTo(0, 0));
      await settled(tab);
      assert.equal(await marked(tab), "#m1");
      assert.equal(
        await tab.evaluate(
          () => (document.querySelector(".rules-nav") as HTMLElement).scrollTop,
        ),
        0,
      );
    });
  });

  describe("when the page is loaded at a rule's address", () => {
    it("marks that rule", async () => {
      await opened("matcher.html#m15");
      assert.equal(await marked(tab), "#m15");
    });
  });

  describe("when the last rule of a short page is clicked", () => {
    it("marks that rule, not the one before it", async () => {
      await opened("short.html");
      await tab.click('.rules-nav a[href="#s3"]');
      await settled(tab);
      assert.equal(await marked(tab), "#s3");
    });
  });

  describe("with a page of one rule", () => {
    it("marks that rule", async () => {
      await opened("single.html");
      assert.equal(await marked(tab), "#o1");
    });
  });

  describe("when a rule is marked", () => {
    it("keeps the height of its entry", async () => {
      await opened("matcher.html");
      await tab.evaluate(() => window.scrollTo(0, 0));
      await settled(tab);
      const heights = await tab.evaluate(() =>
        [...document.querySelectorAll(".rules-nav li")].map((li) => ({
          current: li.querySelector("a[aria-current]") !== null,
          height: (li as HTMLElement).offsetHeight,
        })),
      );
      const on = heights.filter(({ current }) => current);
      assert.equal(on.length, 1);
      const off = heights.find(({ current }) => !current);
      assert.equal(on[0]?.height, off?.height);
    });
  });
});
