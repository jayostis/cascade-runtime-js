import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { hubFiles } from "../src/front-page.js";
import { testsSection } from "../src/hub/tests.js";
import { buildTree } from "../src/sections.js";

const attribute = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

const prop = (name: string, value: string): string =>
  `<property name="${name}" value="${attribute(value)}"/>`;

const FILE =
  "/home/runner/work/cascade-runtime-js/cascade-runtime-js/packages/cascade-runtime/dist/test/a.test.js";

const leaf = (name: string, failed: boolean): string =>
  `<testcase name="${name}" time="0.001" classname="test" file="${FILE}" line="3">${failed ? '<failure message="broke">broke</failure>' : ""}</testcase>`;

const capability = (name: string, cases: string): string =>
  `<testsuite name="${name}" time="0.001" tests="2" failures="0">${cases}</testsuite>`;

const REPORT = `<?xml version="1.0" encoding="utf-8"?><testsuites><properties>${prop(
  "package:cascade-runtime",
  JSON.stringify({
    name: "cascade-runtime",
    version: "0.0.0",
    spec: {
      capabilities: ["Alpha", "Beta"],
      glossary: [
        { term: "claim", definition: "A say-so." },
        { term: "pod", definition: "A person's own store." },
      ],
    },
  }),
)}</properties>${capability("Alpha", leaf("good alpha", false) + leaf("bad alpha", true))}${capability("Beta", leaf("good beta one", false) + leaf("good beta two", false))}</testsuites>`;

async function page(): Promise<string> {
  const { tree } = await buildTree({
    sections: [testsSection],
    ctx: {
      tests: async () => ({
        runtime: {
          report: REPORT,
          commit: "0123456789abcdef0123456789abcdef01234567",
          at: "2026-11-04T22:12:35Z",
          url: "https://github.com/jayostis/cascade-runtime-js/actions/runs/42",
        },
      }),
    },
    front: (rows) => hubFiles(["Records"], rows),
  });
  const bytes = tree.get("conformance/tests/index.html");
  assert.ok(bytes, "the tests page is written");
  return new TextDecoder().decode(bytes);
}

test("the tests page's script expands and collapses every level, failures-only hides passing cases and the capabilities with no failure, and the glossary filter hides a term and its definition together", async () => {
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage();
    await tab.setContent(await page());
    const part = tab.locator('[data-part="runtime"]');
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
