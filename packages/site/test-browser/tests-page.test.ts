import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { hubFiles } from "../src/front-page.js";
import { testsSection } from "../src/hub/tests.js";
import { buildTree } from "../src/sections.js";
import {
  described,
  FILE,
  leafOf,
  packageProperty,
  report,
} from "../test/report.js";

const A = FILE("cascade-runtime", "a.test");

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

async function page(): Promise<string> {
  const { tree } = await buildTree({
    sections: [testsSection],
    ctx: {
      tests: async () => [
        {
          suite: {
            repository: "jayostis/cascade-runtime-js",
            title: "The runtime's tests",
            about: "npm test, node:test over every package",
            workflow: "check.yml",
            artifact: "runtime-tests",
            report: "junit.xml",
            runner: "node:test" as const,
          },
          run: {
            report: REPORT,
            commit: "0123456789abcdef0123456789abcdef01234567",
            at: "2026-11-04T22:12:35Z",
            url: "https://github.com/jayostis/cascade-runtime-js/actions/runs/42",
          },
        },
      ],
    },
    front: (rows) => hubFiles(["Records"], rows),
  });
  const bytes = tree.get("conformance/tests/cascade-runtime-js/index.html");
  assert.ok(bytes, "the tests page is written");
  return new TextDecoder().decode(bytes);
}

test("the tests page's script expands and collapses every level, failures-only hides passing cases and the capabilities with no failure, and the glossary filter hides a term and its definition together", async () => {
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage();
    await tab.setContent(await page());
    const part = tab.locator('[data-part="cascade-runtime-js"]');
    const visible = async (selector: string): Promise<number> =>
      await part
        .locator(selector)
        .evaluateAll(
          (nodes) =>
            nodes.filter((node) => (node as HTMLElement).offsetParent !== null)
              .length,
        );

    assert.equal(
      await part
        .locator("[data-controls]")
        .evaluate((n) => (n as HTMLElement).hidden),
      false,
      "the script shows the controls",
    );

    const open = (): Promise<number> =>
      part.locator("details:not(.glossary)[open]").count();
    const levels = await part.locator("details:not(.glossary)").count();
    await part.locator('[data-action="collapse-all"]').click();
    assert.equal(await open(), 0, "collapse all closes every level");
    await part.locator('[data-action="expand-all"]').click();
    assert.equal(await open(), levels, "expand all opens every level");

    assert.equal(await visible("li.case"), 4);
    assert.equal(await visible("li.capability"), 2);
    await part.locator('[data-action="failures-only"]').click();
    assert.equal(
      await visible("li.case"),
      1,
      "only the failed case stays shown",
    );
    assert.equal(
      await visible("li.capability"),
      1,
      "the capability with no failure is hidden",
    );
    await part.locator('[data-action="failures-only"]').click();
    assert.equal(await visible("li.case"), 4, "a second click shows all again");

    const filter = part.locator("input[data-glossary-filter]");
    const shown = (): Promise<string[]> =>
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
    await filter.fill("store");
    assert.deepEqual(await shown(), ["pod: A person's own store."]);
    assert.equal(
      await part
        .locator(".glossary dd")
        .evaluateAll(
          (defs) => defs.filter((dd) => (dd as HTMLElement).hidden).length,
        ),
      1,
      "the hidden term's definition is hidden with it",
    );
    await filter.fill("nothing like this");
    assert.deepEqual(await shown(), []);
    assert.equal(
      await part
        .locator(".none-match")
        .evaluate((n) => (n as HTMLElement).hidden),
      false,
    );
    await filter.fill("");
    assert.equal((await shown()).length, 2);
  } finally {
    await browser.close();
  }
});
