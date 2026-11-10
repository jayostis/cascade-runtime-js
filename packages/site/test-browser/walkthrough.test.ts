import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { servePages } from "../src/node/serve.js";
import {
  FRONT_TITLE,
  REPOSITORIES,
  ROWS,
  walk,
  walkFromReadmes,
  type Target,
} from "./walk.js";

const page = (title: string, body = ""): string =>
  `<!DOCTYPE html><html><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;

/** A site whose front page has the rows of {@link ROWS}, each link reaching a page of the expected title, but for what is asked. */
function fixture(
  folder: string,
  { without, retitled }: { without?: string; retitled?: string } = {},
): void {
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  };
  const rows = [...ROWS].filter(([id]) => id !== without);
  const link = ({ href }: Target): string =>
    `<li><a href="${href}">${href}</a></li>`;
  write(
    "index.html",
    page(
      FRONT_TITLE,
      `<table id="find-your-way">${rows
        .map(
          ([id, targets]) =>
            `<tr id="${id}"><th>${id}</th><td><ul>${targets.map(link).join("")}</ul></td></tr>`,
        )
        .join(
          "",
        )}</table><h2 id="repositories">Every repository</h2>${REPOSITORIES.map(
        (name) =>
          `<p id="repository-${name}"><a href="https://github.com/jayostis/${name}">${name}</a></p>`,
      ).join("")}`,
    ),
  );
  for (const [, targets] of rows)
    for (const target of targets) {
      if (/^(https?:|#)/.test(target.href)) continue;
      const path = target.href.replace(/#.*$/, "");
      const file = path.endsWith("/") ? `${path}index.html` : path;
      const anchor = /#(.*)$/.exec(target.href)?.[1];
      write(
        file,
        target.text !== undefined
          ? target.text
          : page(
              target.title === retitled ? "Another page" : (target.title ?? ""),
              anchor === undefined ? "" : `<h2 id="${anchor}">a</h2>`,
            ),
      );
    }
}

const TREE = process.env["WALK_TREE"];
const LIVE = process.env["PAGES_URL"];
const RETITLED = "The runtime's tests · Cascade unit test reports";

/**
 * A newcomer starts at the front page or at a repository's README. `walk()` clicks every link of every row of the front
 * page in Chromium and checks the page each reaches by its title; `walkFromReadmes()` starts on GitHub. A run with
 * neither `WALK_TREE` nor `PAGES_URL` is red on purpose: a walkthrough that walked nothing must not pass.
 */
describe("Walking the site as a newcomer · walk(), walkFromReadmes()", () => {
  let browser: Browser;
  let folder: string;

  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "walkthrough-"));
    browser = await chromium.launch();
  });

  after(async () => {
    await browser?.close();
    if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
  });

  /** The walk over a fixture site made as `options` say, served from a folder of its own for the walk. */
  const walkFixture = async (options: {
    without?: string;
    retitled?: string;
  }): Promise<void> => {
    rmSync(folder, { recursive: true, force: true });
    fixture(folder, options);
    const site = await servePages(folder);
    try {
      await walk(browser, site.url, { external: false });
    } finally {
      await site.close();
    }
  };

  describe("given a front page that has every row", () => {
    it("passes", async () => {
      await walkFixture({});
    });
  });

  describe("given a front page with a row removed", () => {
    it("fails, naming the row", async () => {
      await assert.rejects(
        walkFixture({ without: "want-conformance" }),
        /want-conformance/,
      );
    });
  });

  describe("given a link that reaches a page of another title", () => {
    it("fails, naming the title it expected", async () => {
      await assert.rejects(
        walkFixture({ retitled: RETITLED }),
        new RegExp(RETITLED),
      );
    });
  });

  describe("given the built site, in `WALK_TREE`", () => {
    let served: Awaited<ReturnType<typeof servePages>> | undefined;

    before(async () => {
      if (TREE !== undefined) served = await servePages(TREE);
    });

    after(async () => {
      await served?.close();
    });

    it(
      "passes the walk of the front page's rows and repositories",
      { skip: TREE === undefined ? "WALK_TREE is not set" : false },
      async () => {
        assert.ok(served);
        await walk(browser, served.url, { external: false });
      },
    );
  });

  describe("given the deployed site, in `PAGES_URL`", () => {
    const site = LIVE?.replace(/\/?$/, "/");
    const skip = site === undefined ? "PAGES_URL is not set" : false;

    it(
      "passes the same walk, following links to other sites too",
      { skip },
      async () => {
        assert.ok(site);
        await walk(browser, site, { external: true });
      },
    );

    it(
      "reaches the front page from each README's Docs block in one click, and the quick start in a second",
      { skip },
      async () => {
        assert.ok(site);
        await walkFromReadmes(browser, site);
      },
    );
  });

  describe("given neither", () => {
    it(
      "fails, saying which to set",
      {
        skip:
          TREE === undefined && LIVE === undefined
            ? false
            : "WALK_TREE or PAGES_URL is set",
      },
      () => {
        throw new Error("set WALK_TREE or PAGES_URL to run the walkthrough");
      },
    );
  });
});
