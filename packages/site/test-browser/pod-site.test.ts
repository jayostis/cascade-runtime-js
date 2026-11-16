import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MemoryFiles, OxigraphStore } from "@cascade-runtime/runtime";
import {
  featurePod,
  findRoot,
  localVocabulary,
} from "@cascade-runtime/runtime/node";
import { chromium, type Browser, type Page } from "playwright";
import { PLAIN } from "../src/html.js";
import { type Served, servePages } from "../src/node/serve.js";
import { Site } from "../src/site.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const WINDOW = { width: 1280, height: 600 };

/** Whether the section with the id is inside a closed phase. */
const folded = (tab: Page, id: string): Promise<boolean | null> =>
  tab.evaluate((wanted) => {
    const found = document
      .getElementById(wanted)
      ?.closest<HTMLDetailsElement>("details.group");
    return found === null || found === undefined ? null : !found.open;
  }, id);

/** Waits for the phase round the section to be open: the page's script runs on the address changing, after it. */
const opens = (tab: Page, id: string): Promise<unknown> =>
  tab.waitForFunction(
    (wanted) =>
      document
        .getElementById(wanted)
        ?.closest<HTMLDetailsElement>("details.group")?.open === true,
    id,
  );

/** Whether the section's top comes inside the window within a few seconds, a pixel's rounding aside. */
const visible = async (tab: Page, id: string): Promise<boolean> => {
  try {
    await tab.waitForFunction(
      (wanted) => {
        const box = document.getElementById(wanted)?.getBoundingClientRect();
        return (
          box !== undefined &&
          box.height > 0 &&
          box.top >= -1 &&
          box.top <= window.innerHeight
        );
      },
      id,
      { timeout: 3000 },
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * The pipeline page's phases run in Chromium over a built pod: an address that names a step inside a closed phase opens the
 * phase and brings the step into the window, whether the browser opened the phase first or not.
 */
describe("The pages of a pod · Site.build(), Site.files()", () => {
  let folder: string;
  let served: Served;
  let browser: Browser;
  let tab: Page;
  let first: string;
  let last: string;
  let middle: string;
  let file: string;
  const errors: string[] = [];

  before(async () => {
    const vocabulary = await localVocabulary(ROOT);
    const pod = new MemoryFiles("https://pod.example/");
    await featurePod(vocabulary, "runtime/matcher.feature", pod, {
      example:
        "the matcher joins the pair a person called different, and not the pair a person called the same",
      through: "entry",
    });
    const site = await Site.build({
      vocabulary: vocabulary.files,
      layout: vocabulary.layout,
      build: vocabulary.build,
      pod,
      lens: vocabulary.config.lens,
      defaultLens: vocabulary.config.lens,
      newStore: () => new OxigraphStore(),
      name: "matching",
      at: "2026-03-03T08:00:00Z",
      ask: "npm run ask -- matching",
      terms: "../terms/",
      queries: "../queries/",
      spec: "../spec/",
      chrome: PLAIN,
    });
    const names = site.pod.derived.map(({ path }) =>
      path.slice(path.lastIndexOf("/") + 1, -3),
    );
    [first = "", last = ""] = [names.at(0), names.at(-1)];
    middle = names[Math.floor(names.length / 2)] ?? "";
    file = [...site.built.values()][0]?.answer.title ?? "";
    folder = mkdtempSync(join(tmpdir(), "pod-"));
    for (const [path, bytes] of await site.files()) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), bytes);
    }
    served = await servePages(folder);
    browser = await chromium.launch();
    tab = await browser.newPage({ viewport: WINDOW });
    tab.on("pageerror", (error) => errors.push(error.message));
  });

  after(async () => {
    await browser?.close();
    await served?.close();
    if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
  });

  const opened = async (address: string): Promise<void> => {
    await tab.goto(`${served.url}${address}`);
  };

  describe("when the pipeline page is opened with no address", () => {
    it("holds every phase closed", async () => {
      await opened("pipeline.html");
      assert.equal(
        await tab.evaluate(
          () => document.querySelectorAll("details.group[open]").length,
        ),
        0,
      );
      assert.equal(await folded(tab, first), true);
    });
  });

  describe("when the address names a step inside a closed phase", () => {
    it("opens the phase and brings the step into the window, at the first step, one in the middle and the last", async () => {
      for (const id of [first, middle, last]) {
        await opened(`pipeline.html#${id}`);
        assert.equal(await folded(tab, id), false, `${id} is folded`);
        assert.equal(await visible(tab, id), true, `${id} is out of view`);
      }
    });

    it("scrolls to the step when the browser opened the phase before the script ran", async () => {
      await opened("pipeline.html");
      await tab.evaluate((id) => {
        const phase = document
          .getElementById(id)
          ?.closest<HTMLDetailsElement>("details");
        if (phase) phase.open = true;
      }, last);
      await tab.evaluate((id) => {
        location.hash = id;
      }, last);
      assert.equal(await visible(tab, last), true);
    });

    it("opens the phase a link inside the page names, and leaves the one opened before it open", async () => {
      await opened(`pipeline.html#${first}`);
      await tab.evaluate((id) => {
        location.hash = id;
      }, last);
      await opens(tab, last);
      assert.equal(await visible(tab, last), true);
      assert.equal(await folded(tab, first), false);
    });

    it("scrolls back to the top, with the phase still open, when the reader goes back", async () => {
      await opened("pipeline.html");
      await tab.evaluate((id) => {
        location.hash = id;
      }, middle);
      await opens(tab, middle);
      await tab.goBack();
      await tab.waitForFunction(() => window.scrollY === 0);
      assert.equal(await folded(tab, middle), false);
    });

    it("opens the fold of the files it writes for the address of one of them", async () => {
      await opened(`pipeline.html#${file}`);
      assert.equal(await folded(tab, file), false);
      assert.equal(await visible(tab, file), true);
    });
  });

  describe("when the address names nothing on the page", () => {
    it("stays where it is, with no phase opened and no script error", async () => {
      await opened("pipeline.html#nothing-here");
      assert.equal(
        await tab.evaluate(
          () => document.querySelectorAll("details.group[open]").length,
        ),
        0,
      );
      await opened("pipeline.html#%E0%A4%A");
      assert.deepEqual(errors, []);
    });
  });
});
