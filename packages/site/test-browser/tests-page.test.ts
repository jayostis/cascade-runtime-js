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
import {
  pageOf,
  pageWith,
  R,
  RUN,
  THREE_PACKAGES,
} from "../test/tests-page.js";

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

  /** The glossary is generated closed; its filter box is inside it. */
  async function glossaryOpened(): Promise<Locator> {
    const part = await loaded();
    await part.locator("details.glossary > summary").click();
    return part;
  }

  describe("when a word is typed into the glossary filter", () => {
    it("shows only the terms whose name or definition holds it, each with its definition", async () => {
      const part = await glossaryOpened();
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
      const part = await glossaryOpened();
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
      const part = await glossaryOpened();
      const filter = part.locator("input[data-glossary-filter]");
      await filter.fill("store");
      await filter.fill("");
      assert.equal((await shown(part)).length, 2);
    });
  });

  describe("when the page is opened at a link's target", () => {
    const ORIGIN = "http://page.test/tests.html";
    const entryId = (): string =>
      /<dt id="([^"]+)"><dfn>pod</.exec(html)?.[1] ?? "";
    const capabilityId = (): string =>
      /<li class="capability" id="([^"]+)"[^>]*><details><summary><span class="cap-name">Beta</.exec(
        html,
      )?.[1] ?? "";

    /** The page served from a real address, so that it can load at a hash. */
    async function openedAt(hash: string): Promise<{ errors: string[] }> {
      const errors: string[] = [];
      tab.removeAllListeners("pageerror");
      tab.on("pageerror", (error) => errors.push(error.message));
      await tab.route(
        "http://page.test/**",
        async (route) =>
          await route.fulfill({ contentType: "text/html", body: html }),
      );
      await tab.goto("about:blank");
      await tab.goto(ORIGIN + hash);
      return { errors };
    }

    const open = (selector: string): Promise<boolean> =>
      tab
        .locator(selector)
        .evaluate((node) => (node as HTMLDetailsElement).open);

    it("opens the glossary around a term it is loaded at", async () => {
      assert.ok(entryId(), "the page has a term entry");
      await openedAt(`#${entryId()}`);
      assert.equal(await open("details.glossary"), true);
      assert.equal(await tab.locator(`[id="${entryId()}"]`).isVisible(), true);
    });

    it("opens the glossary when a link inside the page is followed", async () => {
      await openedAt("");
      assert.equal(await open("details.glossary"), false);
      await tab.evaluate((id) => {
        const link = document.createElement("a");
        link.href = `#${id}`;
        link.id = "probe-link";
        link.textContent = "probe";
        document.body.prepend(link);
      }, entryId());
      await tab.locator("#probe-link").click();
      assert.equal(await open("details.glossary"), true);
    });

    it("opens a capability's own details when it is loaded at the capability's id", async () => {
      assert.ok(capabilityId(), "Beta has an id and is closed");
      await openedAt(`#${capabilityId()}`);
      assert.equal(
        await tab
          .locator(`[id="${capabilityId()}"] > details`)
          .evaluate((node) => (node as HTMLDetailsElement).open),
        true,
      );
    });

    it("still wires the glossary filter when the hash is malformed", async () => {
      const { errors } = await openedAt("#%E0%A4%A");
      assert.deepEqual(errors, [], "the script raised nothing");
      assert.equal(
        await tab
          .locator("input[data-glossary-filter]")
          .evaluate((node) => (node as HTMLElement).hidden),
        false,
        "the filter box is shown",
      );
      await tab.locator("details.glossary > summary").click();
      await tab.locator("input[data-glossary-filter]").fill("store");
      assert.equal(
        await tab
          .locator(".glossary dt:not([hidden])")
          .evaluateAll((terms) => terms.length),
        1,
      );
    });
  });

  describe("when the page holds several packages", () => {
    let table: string;

    before(async () => {
      const { tree } = await pageWith({
        runtime: { report: THREE_PACKAGES(), ...RUN },
      });
      table = new TextDecoder().decode(tree.get(pageOf(R)));
    });

    /** The page of three packages from a real address, loaded at `hash`. */
    async function opened(hash = ""): Promise<{ errors: string[] }> {
      const errors: string[] = [];
      tab.removeAllListeners("pageerror");
      tab.on("pageerror", (error) => errors.push(error.message));
      await tab.unroute("http://page.test/**");
      await tab.route(
        "http://page.test/**",
        async (route) =>
          await route.fulfill({ contentType: "text/html", body: table }),
      );
      await tab.goto("about:blank");
      await tab.goto("http://page.test/tests.html" + hash);
      return { errors };
    }

    const isOpen = (selector: string): Promise<boolean> =>
      tab
        .locator(selector)
        .evaluate((node) => (node as HTMLDetailsElement).open);

    it("starts with only the package that holds a failure open", async () => {
      await opened();
      assert.equal(await isOpen("#package-beta > details"), true);
      assert.equal(await isOpen("#package-alpha > details"), false);
      assert.equal(await isOpen("#package-gamma > details"), false);
    });

    it("opens a package whose row's link is clicked, the last one included", async () => {
      await opened();
      await tab.locator('table.packages a[href="#package-gamma"]').click();
      assert.equal(await isOpen("#package-gamma > details"), true);
      assert.equal(await tab.locator("#package-gamma").isVisible(), true);
    });

    it("opens a capability's package and the capability when its link in the row is clicked", async () => {
      await opened();
      const id = "capability-alpha-writing-a-record";
      await tab.locator(`table.packages a[href="#${id}"]`).click();
      assert.equal(await isOpen("#package-alpha > details"), true);
      assert.equal(await isOpen(`#${id} > details`), true);
      assert.equal(await isOpen("#package-gamma > details"), false);
    });

    it("opens a package again when its link is clicked a second time after the package was closed", async () => {
      await opened();
      const link = tab.locator('table.packages a[href="#package-alpha"]');
      await link.click();
      await tab.locator('[data-action="collapse-all"]').click();
      assert.equal(await isOpen("#package-alpha > details"), false);
      await link.click();
      assert.equal(await isOpen("#package-alpha > details"), true);
    });

    it("hides the rows of the packages that passed when only failures are shown, and shows them again", async () => {
      await opened();
      const shown = (): Promise<string[]> =>
        tab
          .locator("table.packages tbody tr")
          .evaluateAll((rows) =>
            rows
              .filter((row) => (row as HTMLElement).offsetParent !== null)
              .map((row) => row.querySelector("code")?.textContent ?? ""),
          );
      assert.deepEqual(await shown(), ["beta", "alpha", "gamma"]);
      await tab.locator('[data-action="failures-only"]').click();
      assert.deepEqual(await shown(), ["beta"]);
      await tab.locator('[data-action="failures-only"]').click();
      assert.equal((await shown()).length, 3);
    });

    it("opens and closes every package with the page's two buttons", async () => {
      await opened();
      await tab.locator('[data-action="expand-all"]').click();
      assert.equal(
        await tab.locator("section.pkg > details:not([open])").count(),
        0,
      );
      await tab.locator('[data-action="collapse-all"]').click();
      assert.equal(await tab.locator("section.pkg > details[open]").count(), 0);
    });

    it("raises nothing at a hash that names no package", async () => {
      const { errors } = await opened("#package-nothing");
      assert.deepEqual(errors, []);
      assert.equal(await isOpen("#package-alpha > details"), false);
    });
  });

  describe("when the page holds one package", () => {
    it("has no table and starts at its capabilities", async () => {
      await tab.setContent(html);
      assert.equal(await tab.locator("table.packages").count(), 0);
      await tab.locator("li.capability").first().scrollIntoViewIfNeeded();
      assert.ok((await tab.locator("li.capability").count()) > 0);
    });
  });
});
