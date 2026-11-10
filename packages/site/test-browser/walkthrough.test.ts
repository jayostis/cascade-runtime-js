import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
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

test("the walkthrough passes a front page that has every row, and fails, naming it, one with a row removed and one whose link reaches a page of another title", async () => {
  const folder = mkdtempSync(join(tmpdir(), "walkthrough-"));
  const browser = await chromium.launch();
  try {
    const run = async (options: {
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
    await run({});
    await assert.rejects(
      run({ without: "want-conformance" }),
      /want-conformance/,
    );
    await assert.rejects(
      run({ retitled: "The runtime's tests · Cascade unit test reports" }),
      /The runtime's tests · Cascade unit test reports/,
    );
  } finally {
    await browser.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a newcomer reaches what they came for from the front page in one click and from each README's Docs block in two, as a person does", async () => {
  const tree = process.env["WALK_TREE"];
  const live = process.env["PAGES_URL"];
  if (tree === undefined && live === undefined)
    throw new Error("set WALK_TREE or PAGES_URL to run the walkthrough");
  const served = tree === undefined ? undefined : await servePages(tree);
  const site = served?.url ?? (live as string).replace(/\/?$/, "/");
  const browser = await chromium.launch();
  try {
    await walk(browser, site, { external: live !== undefined });
    if (live !== undefined) await walkFromReadmes(browser, site);
  } finally {
    await browser.close();
    await served?.close();
  }
});
