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
import { chromeStrings } from "../src/html.js";
import { Site } from "../src/site.js";
import { STYLESHEET } from "../src/stylesheet.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const WEBSITE = "https://cascadeprotocol.org";

let pages: Map<string, string>;
let stylesheet: string;

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
    blob: "https://github.com/jayostis/cascade-vocabulary/blob/0123abc/",
    terms: "../terms/",
    spec: "../spec/",
    front: "../index.html",
  });
  const files = await site.files();
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  pages = new Map(
    [...files]
      .filter(([path]) => path.endsWith(".html"))
      .map(([path, bytes]) => [path, text(bytes)]),
  );
  stylesheet = text(files.get("site.css") ?? new Uint8Array());
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

    it("links the website by absolute address and marks the nav's reference as the page it is on", () => {
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
        assert.match(
          header,
          /<a href="[^"]*" aria-current="page">Reference ↗<\/a>/,
          path,
        );
        assert.equal(header.split("aria-current").length, 2, path);
        assert.ok(footer.includes(`href="${WEBSITE}/contribute/"`), path);
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
      const { head, header, footer } = chromeStrings();
      assert.ok(head.includes(".sx-scope {"));
      assert.ok(!head.includes(":root"));
      assert.ok(header.startsWith(`<div class="sx-scope">`));
      assert.ok(footer.startsWith(`<div class="sx-scope">`));
      assert.ok(header.includes(`<a class="b-skip" href="#main">`));
    });
  });
});
