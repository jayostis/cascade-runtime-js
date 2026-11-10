import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";

/** What a newcomer may click to reach a thing: at most this many from a README's Docs block or the front page. */
const CLICKS = 2;

export const FRONT_TITLE = "Cascade pods";

/** A link of a row of the front page's "Find your way" table, and what it must reach. */
export interface Target {
  readonly href: string;
  /** The title of the page it reaches. */
  readonly title?: string;
  /** For a file a browser downloads and does not show: what the file starts with. */
  readonly text?: string;
}

const kit = (folder: string, name: string): Target[] => [
  { href: `${folder}/index.html`, title: `How the pod is laid out · ${name}` },
  {
    href: `${folder}/pod/manifest.ttl`,
    text: `<https://pod.${folder}.example/manifest.ttl`,
  },
];

/** The rows, by the id the front page gives them, and what each link reaches: written from the pages, not from the code that builds them. */
export const ROWS: ReadonlyMap<string, readonly Target[]> = new Map([
  [
    "want-see",
    [
      {
        href: "https://jayostis.github.io/cascade-starter-kit/try/",
        title: "Cascade",
      },
      { href: "examples.html", title: "Cascade example pods" },
    ],
  ],
  [
    "want-build",
    [
      { href: "start.html", title: "Start an app on a Cascade pod" },
      {
        href: "api/",
        title: "The cascade-runtime API: building an app on a Cascade pod",
      },
    ],
  ],
  ["want-model", [{ href: "terms/", title: "Cascade terms" }]],
  [
    "want-why",
    [{ href: "decisions/", title: "Decision notes · Cascade decision notes" }],
  ],
  [
    "want-rules",
    [{ href: "spec/", title: "The rules · Cascade runtime rules" }],
  ],
  [
    "want-conformance",
    [
      { href: "conformance/", title: "Cascade runtime conformance results" },
      {
        href: "conformance/tests/cascade-runtime-js/",
        title: "The runtime's tests · Cascade unit test reports",
      },
    ],
  ],
  [
    "want-adapters",
    [{ href: "adapters/", title: "Adapters · Cascade adapters" }],
  ],
  [
    "want-pods",
    [
      ...kit("alex-rivera", "Alex Rivera"),
      ...kit("martin-okafor", "Martin Okafor"),
      ...kit("priya-natarajan", "Priya Natarajan"),
      ...kit("tamsin-vale", "Tamsin Vale"),
    ],
  ],
  [
    "want-evals",
    [{ href: "evals/", title: "Cascade evals — ask your records a question" }],
  ],
  [
    "want-agent",
    [
      { href: "AGENTS.md", text: "# Building an app on a Cascade pod" },
      { href: "llms.txt", text: "# Cascade pods" },
      { href: "index.json", text: "{" },
    ],
  ],
  [
    "want-contribute",
    [
      {
        href: "decisions/#the-bar",
        title: "Decision notes · Cascade decision notes",
      },
      { href: "#repositories", title: FRONT_TITLE },
    ],
  ],
]);

/** The repositories the front page lists and whose README opens with a Docs block. */
export const REPOSITORIES: readonly string[] = [
  "cascade-vocabulary",
  "cascade-runtime-js",
  "cascade-bridge-spec",
  "cascade-bridge-rs",
  "cascade-bridge-adapter-fhir-r4",
  "cascade-bridge-adapter-ccda",
  "cascade-starter-kit",
  "cascade-reference-tables",
  "cascade-sandbox",
];

const OWNER = "https://github.com/jayostis";

/** Follows a link by clicking it, and says what is wrong where the page it reaches is not the one expected. */
async function click(
  page: Page,
  link: ReturnType<Page["locator"]>,
  expected: Target,
  clicks: number,
  where: string,
): Promise<string[]> {
  if (clicks > CLICKS)
    return [`${where} takes ${clicks} clicks, more than ${CLICKS}`];
  const from = page.url();
  const address = new URL(expected.href, from).href;
  try {
    if (expected.text !== undefined) {
      // A browser downloads this kind of file instead of showing it, so ask for what the click would fetch.
      const response = await page.request.get(address);
      const body = response.ok() ? await response.text() : "";
      return body.startsWith(expected.text)
        ? []
        : [
            `${where}: ${address} answered ${response.status()}, and does not start with ${expected.text}`,
          ];
    }
    // The page behind a click is slow now and then, on GitHub especially: the click is tried twice, the second time
    // from the page it began on.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await link.click();
        await page.waitForURL(address, { waitUntil: "domcontentloaded" });
        break;
      } catch (error) {
        if (attempt > 0) throw error;
        await page.goto(from, { waitUntil: "domcontentloaded" });
      }
    }
  } catch (error) {
    return [
      `${where}: clicking ${expected.href} did not reach ${address}: ${String(error).split("\n")[0]}`,
    ];
  }
  const problems: string[] = [];
  const title = await page.title();
  if (title !== expected.title)
    problems.push(
      `${where}: ${expected.href} reached a page titled "${title}", not "${expected.title}"`,
    );
  const anchor = new URL(address).hash.slice(1);
  if (anchor !== "" && (await page.locator(`[id="${anchor}"]`).count()) === 0)
    problems.push(`${where}: the page has no element with id "${anchor}"`);
  return problems;
}

/**
 * From the front page, each link of each row of the table is followed in one click and must reach a page of the expected
 * title; with `external`, a link to another site is followed too, and else only its presence is checked.
 */
export async function walk(
  browser: Browser,
  site: string,
  { external }: { external: boolean },
): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const problems: string[] = [];
  try {
    for (const [id, targets] of ROWS) {
      await page.goto(site, { waitUntil: "load" });
      if ((await page.locator(`#${id}`).count()) === 0) {
        problems.push(`the front page has no row ${id}`);
        continue;
      }
      for (const target of targets) {
        const link = page.locator(`#${id} a[href="${target.href}"]`);
        if ((await link.count()) !== 1) {
          problems.push(`row ${id} does not link ${target.href}`);
          continue;
        }
        if (/^https?:/.test(target.href) && !external) continue;
        problems.push(...(await click(page, link, target, 1, `row ${id}`)));
        await page.goto(site, { waitUntil: "load" });
      }
    }
    await page.goto(site, { waitUntil: "load" });
    for (const name of REPOSITORIES)
      if (
        (await page
          .locator(`#repository-${name} a[href="${OWNER}/${name}"]`)
          .count()) !== 1
      )
        problems.push(
          `the front page lists no repository ${name} linking ${OWNER}/${name}`,
        );
  } finally {
    await context.close();
  }
  if (problems.length > 0)
    assert.fail(`the walkthrough of ${site} failed:\n${problems.join("\n")}`);
}

/** Opens the repository's page on GitHub until its README's Docs heading shows, twice at most: GitHub is slow now and then. */
async function opened(page: Page, name: string): Promise<boolean> {
  const heading = page.getByRole("heading", {
    name: "Docs",
    level: 2,
    exact: true,
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(`${OWNER}/${name}`, { waitUntil: "domcontentloaded" });
      await heading.waitFor({ timeout: 30_000 });
      return true;
    } catch {
      // try again
    }
  }
  return false;
}

/**
 * From each repository's page on GitHub, the first link under the README's Docs heading reaches the hub's front page in
 * one click, and a link of its table the page it names in the second.
 */
export async function walkFromReadmes(
  browser: Browser,
  site: string,
): Promise<void> {
  const context = await browser.newContext();
  const problems: string[] = [];
  try {
    for (const name of REPOSITORIES) {
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      try {
        if (!(await opened(page, name))) {
          problems.push(`the README of ${name} has no Docs heading on GitHub`);
          continue;
        }
        const first = page
          .getByRole("heading", { name: "Docs", level: 2, exact: true })
          .locator("xpath=following::a[not(contains(@class, 'anchor'))][1]");
        const hub = { href: site, title: FRONT_TITLE };
        const reached = await click(page, first, hub, 1, `README of ${name}`);
        problems.push(...reached);
        if (reached.length > 0) continue;
        const start = ROWS.get("want-build")?.[0];
        assert.ok(start, "ROWS has a want-build row");
        problems.push(
          ...(await click(
            page,
            page.locator(`#want-build a[href="${start.href}"]`),
            start,
            2,
            `README of ${name}, then the hub`,
          )),
        );
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }
  if (problems.length > 0)
    assert.fail(
      `the walkthrough from the READMEs failed:\n${problems.join("\n")}`,
    );
}
