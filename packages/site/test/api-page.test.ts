import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { findRoot } from "@cascade-runtime/runtime/node";
import {
  agentFiles,
  apiPages,
  SEARCH_FILE,
  type SearchRow,
} from "../src/agents.js";
import { hubFiles } from "../src/front-page.js";
import { PLAIN } from "../src/html.js";
import type { PagesContext } from "../src/hub/context.js";
import { apiSection } from "../src/node/hub/api.js";
import { callNames } from "../src/node/hub/calls.js";
import { SEARCH_SCRIPT } from "../src/search-script.js";
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

/** The ranking function of the script a page loads, run on its own. */
const rank = (
  rows: readonly SearchRow[],
  query: string,
): readonly SearchRow[] => {
  const module: {
    exports: { rank?: (r: readonly SearchRow[], q: string) => SearchRow[] };
  } = { exports: {} };
  new Function("module", "document", SEARCH_SCRIPT)(module, {
    querySelector: () => null,
  });
  return module.exports.rank?.(rows, query) ?? [];
};

/** The `##` headings of Markdown, and its first heading. */
const headingsOf = (markdown: string) => ({
  first: /^# (.+)$/m.exec(markdown)?.[1] ?? "",
  second: [...markdown.matchAll(/^## (.+)$/gm)].map(
    ([, heading]) => heading ?? "",
  ),
});

/**
 * The API page shows the guide and the README of the `cascade-runtime` package as pages, so a developer reads on the site
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
      ctx: { root: ROOT, chrome: PLAIN } as PagesContext,
      front: (rows) => hubFiles(["Records"], rows, PLAIN),
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

  describe("with `search.json`", () => {
    let rows: SearchRow[];
    let calls: SearchRow[];
    let api: string;

    before(() => {
      rows = JSON.parse(read(tree, SEARCH_FILE)) as SearchRow[];
      calls = rows.filter(({ kind }) => kind === "call");
      api = read(tree, "api/index.html");
    });

    it("has a row for each call the page names bare, at an anchor the page holds once", () => {
      for (const name of ["look", "ask", "enter", "judge", "close"]) {
        const row = calls.find(({ title }) => title === name);
        assert.equal(row?.path, `api/index.html#call-${name}`, name);
        assert.equal(api.split(`id="call-${name}"`).length, 2, name);
      }
    });

    it("has a row for a call the page names only as an argument of another", () => {
      assert.ok(calls.some(({ title }) => title === "pullFiles"));
    });

    it("has no row for a helper of an example, so the query `text` finds no call", () => {
      for (const name of ["text", "iri"])
        assert.ok(!calls.some(({ title }) => title === name), name);
      assert.deepEqual(
        rank(rows, "text").filter(({ kind }) => kind === "call"),
        [],
      );
    });

    it("lands the rows on more than one place of the page, each at the first mention", () => {
      assert.ok(new Set(calls.map(({ path }) => path)).size > calls.length / 2);
    });
  });

  describe("given the package as it stands, `callNames()`", () => {
    it("holds the functions the index exports and the methods of `Pod`, and no class, property or helper", async () => {
      const names = await callNames(ROOT);
      for (const name of ["openPod", "pullFiles", "look", "retitle", "ask"])
        assert.ok(names.has(name), name);
      for (const name of ["Refusal", "titled", "text", "iri"])
        assert.ok(!names.has(name), name);
    });
  });

  describe("given calls named in code spans, `apiPages()`", () => {
    const named = new Set(["look", "import", "pullFiles", "ask", "judge"]);
    const html = new TextDecoder().decode(
      apiPages(
        "# T\n\n## A\n\n`look` first, `await pod.ask(q)`, then `pod.import(pullFiles(pull, name), { x })`, then `look()` again, and `pod.titled`.\n\n```ts\nawait pod.look(x);\n```\n\n## Judge\n\nNo span names it.\n",
        "# R\n",
        PLAIN,
        named,
      ).get("api/index.html"),
    );

    it("puts an empty anchor before the first span that names each call, bare, with a parenthesis or as an argument, and in a heading that is the call alone", () => {
      assert.deepEqual(
        [...html.matchAll(/<span id="call-([^"]+)"><\/span>/g)].map(
          ([, name]) => name,
        ),
        ["look", "ask", "import", "pullFiles", "judge"],
      );
    });

    it("shows the guide's text as it is, and anchors no code block or property", () => {
      assert.ok(html.includes("<code>pod.titled</code>"));
      assert.ok(html.includes("<code>look()</code>"));
      assert.ok(!html.includes('id="call-titled"'));
      assert.equal(html.split('id="call-look"').length, 2);
      assert.ok(
        html.includes('<h2 id="judge"><span id="call-judge"></span>Judge</h2>'),
      );
      assert.ok(html.includes('<li><a href="#judge">Judge</a></li>'));
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
