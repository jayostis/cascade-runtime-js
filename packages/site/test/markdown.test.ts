import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderMarkdown } from "../src/markdown.js";

const SOURCE =
  "# Top\n\n## What `a pod` holds & more\n\n### Same\n\n### Same\n\ntext\n";

/** The `id` of each heading in `html`, in order. */
const idsOf = (html: string): (string | undefined)[] =>
  [...html.matchAll(/ id="([^"]*)"/g)].map((match) => match[1]);

/**
 * The decision notes, the guide and the format notes are Markdown written elsewhere; this is the one place the site
 * turns Markdown into HTML. Only what the Markdown itself makes is a tag: raw HTML and script links are shown as text.
 */
describe("Rendering Markdown as a page · renderMarkdown()", () => {
  describe("`renderMarkdown()`", () => {
    it("renders a heading, a code span, a link, a table and a fenced block with its language", () => {
      const html = renderMarkdown(
        "# Title\n\nA `code` span and a [link](https://example.org/).\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ttl\nx:a x:b x:c .\n```\n",
      ).text;
      assert.match(html, /<h1>Title<\/h1>/);
      assert.match(html, /<code>code<\/code>/);
      assert.match(html, /<a href="https:\/\/example\.org\/">link<\/a>/);
      assert.match(html, /<table>[\s\S]*<td>1<\/td>/);
      assert.match(
        html,
        /<pre><code class="language-ttl">x:a x:b x:c \.\n<\/code><\/pre>/,
      );
    });

    it("shows raw HTML as text", () => {
      const html = renderMarkdown("<script>alert(1)</script>\n").text;
      assert.ok(!html.includes("<script>"));
      assert.ok(html.includes("&lt;script&gt;"));
    });

    it("shows a `javascript:` or `data:` link as its text alone", () => {
      const html = renderMarkdown(
        "[x](javascript:alert(1)) [y](data:text/html,a)",
      ).text;
      assert.ok(!/javascript:|data:/i.test(html), html);
      assert.ok(html.includes("x") && html.includes("y"));
    });

    it("keeps a relative link and an `http:` link", () => {
      const html = renderMarkdown(
        "[ok](../a.md) [web](http://example.org/)",
      ).text;
      assert.match(html, /<a href="\.\.\/a\.md">ok<\/a>/);
      assert.match(html, /<a href="http:\/\/example\.org\/">web<\/a>/);
    });
  });

  describe("with `ids`", () => {
    it("gives each heading GitHub's slug of its text as its id", () => {
      const html = renderMarkdown(SOURCE, { ids: true }).text;
      assert.match(html, /<h2 id="what-a-pod-holds--more">/);
      assert.match(html, /<h3 id="same">Same<\/h3>/);
    });

    it("numbers a slug taken twice, skipping an id a heading already has", () => {
      assert.match(
        renderMarkdown(SOURCE, { ids: true }).text,
        /<h3 id="same-1">Same<\/h3>/,
      );
      assert.deepEqual(
        idsOf(
          renderMarkdown("## Same\n\n## Same\n\n## Same-1\n", { ids: true })
            .text,
        ),
        ["same", "same-1", "same-1-1"],
      );
    });

    it("names a heading with no letter or digit `section`", () => {
      assert.deepEqual(
        idsOf(renderMarkdown("## !!!\n\n## ???\n", { ids: true }).text),
        ["section", "section-1"],
      );
    });

    it("changes nothing else in the page", () => {
      assert.equal(
        renderMarkdown(SOURCE, { ids: true }).text.replace(/ id="[^"]*"/g, ""),
        renderMarkdown(SOURCE).text,
      );
    });
  });

  describe("with no `ids`", () => {
    it("gives no heading an id", () => {
      const plain = renderMarkdown(SOURCE).text;
      assert.ok(!plain.includes("id="));
      assert.equal(renderMarkdown(SOURCE, { ids: false }).text, plain);
    });
  });
});
