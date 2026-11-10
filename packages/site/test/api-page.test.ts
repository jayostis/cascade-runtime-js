import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { findRoot } from "@cascade-runtime/runtime/node";
import { agentFiles } from "../src/agents.js";
import { hubFiles } from "../src/front-page.js";
import type { PagesContext } from "../src/hub/context.js";
import { apiSection } from "../src/node/hub/api.js";
import { buildTree } from "../src/sections.js";
import { readPage } from "./page.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const GUIDE = join(ROOT, "packages", "cascade-runtime", "guide", "AGENTS.md");
const read = (tree: ReadonlyMap<string, Uint8Array>, path: string) =>
  new TextDecoder().decode(tree.get(path));
const local = (link: string) => !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(link);
const fileOf = (link: string) => {
  const path = link.replace(/[?#].*$/, "");
  return path === "" || path.endsWith("/") ? `${path}index.html` : path;
};

/** The `##` headings of Markdown, and its first heading. */
const headingsOf = (markdown: string) => ({
  first: /^# (.+)$/m.exec(markdown)?.[1] ?? "",
  second: [...markdown.matchAll(/^## (.+)$/gm)].map(
    ([, heading]) => heading ?? "",
  ),
});

/**
 * The API page shows the guide and the README of the cascade-runtime package as pages, so a developer reads on the site
 * what a coding agent reads as `AGENTS.md`.
 */
describe("The API page · apiSection", () => {
  let tree: ReadonlyMap<string, Uint8Array>;
  let guide: ReturnType<typeof headingsOf>;

  before(async () => {
    ({ tree } = await buildTree({
      sections: [
        {
          path: "start.html",
          title: "Quick start",
          want: "see",
          build: async () =>
            new Map([
              ["start.html", new TextEncoder().encode("<title>Start</title>")],
            ]),
          rows: async () => [],
        },
        apiSection,
      ],
      ctx: { root: ROOT } as PagesContext,
      front: (rows) => hubFiles(["Records"], rows),
      finishers: [agentFiles],
    }));
    guide = headingsOf(await readFile(GUIDE, "utf8"));
  });

  /** Each local link of the page at `path` names a file the site holds. */
  const linksOnlyFilesOf = (path: string) => {
    for (const link of readPage(read(tree, path)).hrefs.filter(local)) {
      const target = new URL(link, `http://hub/${path}`).pathname.slice(1);
      assert.ok(tree.has(fileOf(target)), `${path} links ${link}`);
    }
  };

  describe("with `api/index.html`", () => {
    let api: ReturnType<typeof readPage>;

    before(() => {
      api = readPage(read(tree, "api/index.html"));
    });

    it("shows the guide under the guide's own title", () => {
      assert.equal(apiSection.path, "api/index.html");
      assert.equal(api.h1, guide.first);
    });

    it("shows every `##` heading of the guide", () => {
      assert.ok(guide.second.length > 5);
      for (const heading of guide.second)
        assert.ok(api.said.includes(heading), heading);
    });

    it("keeps code as code", () => {
      assert.ok(api.code.some((block) => block.includes("openPod(")));
    });

    it("links `AGENTS.md` and the page of the package's README", () => {
      assert.ok(api.hrefs.includes("../AGENTS.md"));
      assert.ok(api.hrefs.includes("package.html"));
    });

    it("opens with a contents list that links each `##` heading once, at a heading of that id", () => {
      const html = read(tree, "api/index.html");
      const anchors = api.hrefs.filter((href) => href.startsWith("#"));
      assert.equal(anchors.length, guide.second.length, "one for each heading");
      assert.equal(new Set(anchors).size, anchors.length);
      for (const anchor of anchors)
        assert.ok(api.ids.has(anchor.slice(1)), `${anchor} has a heading`);
      assert.ok(html.indexOf('href="#') < html.indexOf("<h2"));
    });

    it("links only files the site holds", () => {
      linksOnlyFilesOf("api/index.html");
    });
  });

  describe("with `api/package.html`", () => {
    it("shows the package's README, without its install marker or any comment", () => {
      const readme = read(tree, "api/package.html");
      assert.ok(!readme.includes("INSTALL"), "the marker is not shown as text");
      assert.ok(!readme.includes("<!--"));
      assert.ok(readPage(readme).said.includes("openPod"));
    });

    it("links only files the site holds", () => {
      linksOnlyFilesOf("api/package.html");
    });

    it("has no contents list", () => {
      assert.ok(
        !readPage(read(tree, "api/package.html")).hrefs.some((href) =>
          href.startsWith("#"),
        ),
      );
    });
  });
});
