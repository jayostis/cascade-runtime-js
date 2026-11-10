import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import {
  described,
  FILE,
  leafOf,
  packageProperty,
  report,
} from "../test/report.js";
import { pageOf, pageWith, R, RUN } from "../test/tests-page.js";

const A = FILE("cascade-runtime", "a.test");

/** Two capabilities, one with a failed case, and a glossary of two terms. */
const REPORT = report(
  packageProperty("cascade-runtime", "cascade-runtime", "0.0.0", {
    capabilities: ["Alpha", "Beta"],
    glossary: [
      { term: "claim", definition: "A say-so." },
      { term: "pod", definition: "A person's own store." },
    ],
  }),
  described(
    "Alpha",
    {},
    leafOf("good alpha", A, 3) +
      leafOf("bad alpha", A, 3, { failure: "broke" }),
  ) +
    described(
      "Beta",
      {},
      leafOf("good beta one", A, 3) + leafOf("good beta two", A, 3),
    ),
);

/**
 * The page reads whole without script. With script, three buttons fold the tree or leave only what failed, and a box
 * filters a package's glossary. This runs the page's own script in Chromium, which no unit test can.
 */
describe("The tests page's controls in a browser · expand all, collapse all, failures only, the glossary filter", () => {
  let browser: Browser;
  let tab: Page;
  let html: string;

  before(async () => {
    const { tree } = await pageWith({ runtime: { report: REPORT, ...RUN } });
    html = new TextDecoder().decode(tree.get(pageOf(R)));
    browser = await chromium.launch();
    tab = await browser.newPage();
  });

  after(async () => {
    await browser?.close();
  });

  /** The runtime's part of a freshly loaded page, so that no leaf sees another's clicks. */
  async function loaded(): Promise<Locator> {
    await tab.setContent(html);
    return tab.locator(`[data-part="${R}"]`);
  }

  const visible = async (part: Locator, selector: string): Promise<number> =>
    await part
      .locator(selector)
      .evaluateAll(
        (nodes) =>
          nodes.filter((node) => (node as HTMLElement).offsetParent !== null)
            .length,
      );

  /** Each glossary term shown, with its definition, or "hidden" when the definition is hidden. */
  const shown = (part: Locator): Promise<string[]> =>
    part
      .locator(".glossary dt")
      .evaluateAll((terms) =>
        terms
          .filter((dt) => !(dt as HTMLElement).hidden)
          .map(
            (dt) =>
              `${dt.textContent?.trim()}: ${(dt.nextElementSibling as HTMLElement).hidden ? "hidden" : dt.nextElementSibling?.textContent?.trim()}`,
          ),
      );

  describe("when the page's script has run", () => {
    it("shows the controls", async () => {
      const part = await loaded();
      assert.equal(
        await part
          .locator("[data-controls]")
          .evaluate((n) => (n as HTMLElement).hidden),
        false,
      );
    });
  });

  describe('when "Collapse all" is clicked', () => {
    it("closes every level", async () => {
      const part = await loaded();
      await part.locator('[data-action="collapse-all"]').click();
      assert.equal(
        await part.locator("details:not(.glossary)[open]").count(),
        0,
      );
    });
  });

  describe('when "Expand all" is clicked', () => {
    it("opens every level", async () => {
      const part = await loaded();
      const levels = await part.locator("details:not(.glossary)").count();
      await part.locator('[data-action="collapse-all"]').click();
      await part.locator('[data-action="expand-all"]').click();
      assert.equal(
        await part.locator("details:not(.glossary)[open]").count(),
        levels,
      );
    });
  });

  describe('when "Failures only" is clicked', () => {
    it("hides each passed case and each capability with no failed case", async () => {
      const part = await loaded();
      assert.equal(await visible(part, "li.case"), 4);
      assert.equal(await visible(part, "li.capability"), 2);
      await part.locator('[data-action="failures-only"]').click();
      assert.equal(await visible(part, "li.case"), 1, "the failed case stays");
      assert.equal(await visible(part, "li.capability"), 1, "Alpha stays");
    });

    it("shows them again at a second click", async () => {
      const part = await loaded();
      await part.locator('[data-action="failures-only"]').click();
      await part.locator('[data-action="failures-only"]').click();
      assert.equal(await visible(part, "li.case"), 4);
    });
  });

  describe("when a word is typed into the glossary filter", () => {
    it("shows only the terms whose name or definition holds it, each with its definition", async () => {
      const part = await loaded();
      await part.locator("input[data-glossary-filter]").fill("store");
      assert.deepEqual(await shown(part), ["pod: A person's own store."]);
      assert.equal(
        await part
          .locator(".glossary dd")
          .evaluateAll(
            (defs) => defs.filter((dd) => (dd as HTMLElement).hidden).length,
          ),
        1,
        "the hidden term's definition is hidden with it",
      );
    });

    it('shows the "none match" line when no term holds it', async () => {
      const part = await loaded();
      await part
        .locator("input[data-glossary-filter]")
        .fill("nothing like this");
      assert.deepEqual(await shown(part), []);
      assert.equal(
        await part
          .locator(".none-match")
          .evaluate((n) => (n as HTMLElement).hidden),
        false,
      );
    });

    it("shows every term again when the box is cleared", async () => {
      const part = await loaded();
      const filter = part.locator("input[data-glossary-filter]");
      await filter.fill("store");
      await filter.fill("");
      assert.equal((await shown(part)).length, 2);
    });
  });
});
