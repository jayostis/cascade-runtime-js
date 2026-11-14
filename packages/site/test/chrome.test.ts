import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MemoryFiles, OxigraphStore } from "@cascade-runtime/runtime";
import {
  featurePod,
  findRoot,
  localVocabulary,
} from "@cascade-runtime/runtime/node";
import { type Chrome, chromeStrings } from "../src/html.js";
import { Site } from "../src/site.js";
import { STYLESHEET } from "../src/stylesheet.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const WEBSITE = "https://cascadeprotocol.org";

type Pages = Map<string, string>;

let pages: Pages;
let off: Pages;
let stylesheet: string;

const BUILT = "2026-10-02";

async function built(chrome: Chrome): Promise<{ pages: Pages; css: string }> {
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
    blob: "https://github.com/jayostis/cascade-vocabulary/blob/0123abc/",
    terms: "../terms/",
    spec: "../spec/",
    front: "../index.html",
    chrome,
  });
  const files = await site.files();
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return {
    pages: new Map(
      [...files]
        .filter(([path]) => path.endsWith(".html"))
        .map(([path, bytes]) => [path, text(bytes)]),
    ),
    css: text(files.get("site.css") ?? new Uint8Array()),
  };
}

before(async () => {
  const on = await built({ website: true, built: BUILT });
  pages = on.pages;
  stylesheet = on.css;
  off = (await built({ website: false, built: BUILT })).pages;
});

/** The attributes of each `<a>` of a block of HTML. */
const links = (html: string) =>
  [...html.matchAll(/<a\b([^>]*)>/g)].map((match) => match[1] ?? "");

describe("Every hub page carries the website's header, footer and tokens", () => {
  describe("given the pages of a pod's site", () => {
    it("has a skip link, then the alpha strip, header and footer, around `main`", () => {
      assert.ok(pages.size > 4);
      for (const [path, html] of pages) {
        const order = [
          `<a class="b-skip" href="#main">`,
          `<div class="sx-strip">`,
          `<header class="sx-header">`,
          `<main id="main">`,
          `<footer class="sx-footer">`,
        ].map((marker) => html.indexOf(marker));
        assert.ok(
          order.every((at) => at >= 0),
          `${path} lacks a part`,
        );
        assert.deepEqual(
          order,
          [...order].sort((a, b) => a - b),
          `${path} has its parts out of order`,
        );
      }
    });

    it("shows the approved strip and nav, the nav's reference marked as the page it is on", () => {
      for (const [path, html] of pages) {
        assert.ok(
          html.includes(
            `<div class="sx-strip">An open standard in progress, in alpha. <a href="${WEBSITE}/community/status/">See what works today →</a> · <a href="${WEBSITE}/contribute/">Help shape it →</a></div>`,
          ),
          path,
        );
        const header = html.slice(
          html.indexOf(`<header class="sx-header">`),
          html.indexOf("</header>"),
        );
        const nav = header.slice(
          header.indexOf(`<nav class="sx-nav"`),
          header.indexOf("</nav>"),
        );
        assert.deepEqual(
          [...nav.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map(([, label]) => label),
          ["Understand", "Build", "Standards", "Contribute", "Reference ↗"],
          path,
        );
        assert.match(
          header,
          /<a href="[^"]*" aria-current="page">Reference ↗<\/a>/,
          path,
        );
        assert.equal(header.split("aria-current").length, 2, path);
      }
    });

    it("links the website by absolute address from the header and the footer", () => {
      for (const [path, html] of pages) {
        const header = html.slice(
          html.indexOf(`<header class="sx-header">`),
          html.indexOf("</header>"),
        );
        const footer = html.slice(html.indexOf(`<footer class="sx-footer">`));
        for (const attributes of [...links(header), ...links(footer)])
          assert.match(
            attributes,
            /href="https:\/\//,
            `${path}: ${attributes} is not absolute`,
          );
        assert.ok(footer.includes(`href="${WEBSITE}/contribute/"`), path);
        assert.ok(footer.includes("Talk with us"), path);
        assert.ok(footer.includes("§ Working toward a standard"), path);
        assert.ok(!footer.includes("Talk with Jed and Jay"), path);
        assert.ok(!footer.includes("§ Alpha"), path);
      }
    });

    it("links nothing at the website with the switch off: the strip is text and the footer is its legal line", () => {
      assert.ok(off.size > 4);
      for (const [path, html] of off) {
        const chrome =
          html.slice(
            html.indexOf(`<div class="sx-strip">`),
            html.indexOf(`<main id="main">`),
          ) + html.slice(html.indexOf(`<footer class="sx-footer">`));
        assert.ok(!chrome.includes(WEBSITE), `${path} links the website`);
        assert.ok(
          html.includes(
            `<div class="sx-strip">An open standard in progress, in alpha.</div>`,
          ),
          path,
        );
        const footer = html.slice(html.indexOf(`<footer class="sx-footer">`));
        assert.deepEqual(links(footer), [], path);
        assert.ok(!footer.includes("<h2>"), `${path} has a column`);
        assert.ok(footer.includes("is a trademark of Cascade Agentic Labs"), path);
        const header = html.slice(
          html.indexOf(`<header class="sx-header">`),
          html.indexOf("</header>"),
        );
        assert.match(
          header,
          /<a href="https:\/\/jayostis\.github\.io\/cascade-runtime-js\/" aria-current="page">Reference ↗<\/a>/,
          path,
        );
      }
    });

    it("writes the build date it was given in the footer, on every page, with the switch on or off", () => {
      for (const group of [pages, off])
        for (const [path, html] of group) {
          const footer = html.slice(html.indexOf(`<footer class="sx-footer">`));
          assert.ok(footer.includes(`Built on ${BUILT}.`), path);
        }
    });

    it("keeps the pod's own links in a nav of their own, under the header", () => {
      for (const [path, html] of pages) {
        assert.equal(html.split('<nav class="hub-nav"').length, 2, path);
        assert.ok(
          html.indexOf('<nav class="hub-nav"') > html.indexOf("</header>"),
          path,
        );
      }
    });
  });

  describe("with the stylesheet", () => {
    it("takes the website's token names and values, with one look and no dark mode", () => {
      for (const sheet of [stylesheet, STYLESHEET]) {
        assert.match(sheet, /--ink: #14202a;/);
        assert.match(sheet, /--link: #0b6a8a;/);
        assert.match(sheet, /--rule: #c9d1d6;/);
        assert.ok(!sheet.includes("prefers-color-scheme"));
        assert.ok(!/--(text|quiet|line|panel)\b/.test(sheet));
      }
    });

    it("sets the page's width on `main`, not on `body`, so the strip, header and footer run across", () => {
      assert.match(stylesheet, /\nmain, nav\.hub-nav \{ max-width: 68rem;/);
      assert.ok(!/\nnav \{/.test(stylesheet));
      assert.ok(!/\nbody \{[^}]*max-width/.test(stylesheet));
    });
  });

  describe("with the source of the site", () => {
    it("lets only the chrome write a page's frame, bar the page that redirects", () => {
      const src = join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "src",
      );
      const folders = [src, join(src, "hub")];
      const framed = folders.flatMap((folder) =>
        readdirSync(folder)
          .filter((name) => name.endsWith(".ts"))
          .filter((name) =>
            readFileSync(join(folder, name), "utf8").includes(
              "<!DOCTYPE html>",
            ),
          )
          .map((name) => name),
      );
      assert.deepEqual(framed.sort(), ["front-page.ts", "html.ts"]);
    });
  });

  describe("with the chrome for a page of another package", () => {
    it("scopes the tokens to the wrappers it puts around the header and footer", () => {
      const { head, header, footer } = chromeStrings({
        website: false,
        built: BUILT,
      });
      assert.ok(head.includes(".sx-scope {"));
      assert.ok(!head.includes(":root"));
      assert.ok(header.startsWith(`<div class="sx-scope">`));
      assert.ok(footer.startsWith(`<div class="sx-scope">`));
      assert.ok(header.includes(`<a class="b-skip" href="#main">`));
      assert.ok(footer.includes(`Built on ${BUILT}.`));
      assert.ok(!header.includes(WEBSITE) && !footer.includes(WEBSITE));
    });
  });
});
