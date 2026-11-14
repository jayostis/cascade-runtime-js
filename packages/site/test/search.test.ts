import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { findRoot } from "@cascade-runtime/runtime/node";
import {
  agentFiles,
  INDEX_FILE,
  SEARCH_FILE,
  SEARCH_SCRIPT_FILE,
  type SearchRow,
} from "../src/agents.js";
import { PLAIN, shell } from "../src/html.js";
import { SEARCH_SCRIPT } from "../src/search-script.js";
import { buildTree, type Section } from "../src/sections.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const text = (what: string) => new TextEncoder().encode(what);
const read = (tree: ReadonlyMap<string, Uint8Array>, path: string) =>
  new TextDecoder().decode(tree.get(path));

const page = (title: string, body = "") =>
  text(
    `<!DOCTYPE html><html><head><title>${title}</title></head><body><main id="main">${body}</main></body></html>`,
  );

const TERMS = page(
  "Term reference",
  `<h3 id="cascade:Attachment"><code>cascade:Attachment</code> attachment</h3>
<h3 id="cascade:AttachmentShape"><code>cascade:AttachmentShape</code> Attachment shape</h3>
<h3 id="cascade:abatementDate"><code>cascade:abatementDate</code> Abatement Date</h3>
<div id="cascade:AttachmentShape-node">a node, not a term</div>`,
);

const RULES = page(
  "Consent · Cascade runtime rules",
  `<section class="rule" id="y1"><h2>Y1. Each tool a runtime offers a model takes one kind of act</h2></section>
<section class="rule" id="y2"><h2>Y2. A tool &quot;never&quot; offered</h2></section>`,
);

const NOTE = page(
  "What a model may do with a person&#39;s pods · Cascade decision notes",
);

const section = (
  files: Record<string, Uint8Array>,
  path = "terms/index.html",
): Section<object> => ({
  path,
  title: "A section",
  want: "see",
  build: async () => new Map(Object.entries(files)),
  rows: async () => [],
});

const SITE: Record<string, Uint8Array> = {
  "terms/index.html": TERMS,
  "spec/consent.html": RULES,
  "decisions/consent-tiers.html": NOTE,
  "guide/attachments.html": page("Attaching a file"),
  "data/pod.ttl": text("@prefix : <#> ."),
  "style.css": text("body {}"),
};

const front = () =>
  new Map([["index.html", page("Reference")]]) as Map<string, Uint8Array>;

const rowsOf = async (files: Record<string, Uint8Array> = SITE) => {
  const { tree } = await buildTree({
    sections: [section(files)],
    ctx: {},
    front,
    finishers: [agentFiles],
  });
  return {
    tree,
    rows: JSON.parse(read(tree, SEARCH_FILE)) as SearchRow[],
  };
};

type Rank = (rows: readonly SearchRow[], query: string) => SearchRow[];

/** The ranking function of the script a page loads, run on its own. */
const rank: Rank = (rows, query) => {
  const exported: { rank?: Rank } = {};
  new Function("module", "document", SEARCH_SCRIPT)(
    { exports: exported },
    { querySelector: () => null },
  );
  return (exported.rank as Rank)(rows, query);
};

/**
 * A reader who knows a name of the hub types it in the box on any hub page and goes to its page or anchor in one click. The
 * rows the box searches are `search.json`, written by `agentFiles()` beside `index.json` from the tree the sections wrote;
 * the ranking is the script `search.js`, which a page loads, and the box is the form `shell()` writes under the header.
 */
describe("Searching the hub · search.json, search.js, the search box of shell()", () => {
  describe("given a tree with a term page, a rule page, a decision note and a guide", () => {
    let rows: SearchRow[];
    let tree: ReadonlyMap<string, Uint8Array>;

    before(async () => {
      ({ rows, tree } = await rowsOf());
    });

    it("lists in `search.json` every page that `index.json` lists", () => {
      const pages = (
        JSON.parse(read(tree, INDEX_FILE)) as {
          files: { path: string; kind: string }[];
        }
      ).files
        .filter(({ kind }) => kind === "page")
        .map(({ path }) => path);
      assert.ok(pages.length >= 5);
      for (const path of pages)
        assert.ok(
          rows.some((row) => row.path === path),
          `search.json lists ${path}`,
        );
    });

    it("lists each term of the term page as an anchor of it, by name and by label, and no other id", () => {
      const terms = rows.filter(({ kind }) => kind === "term");
      assert.deepEqual(
        terms.map(({ path, title, label }) => [path, title, label]),
        [
          [
            "terms/index.html#cascade:Attachment",
            "cascade:Attachment",
            "attachment",
          ],
          [
            "terms/index.html#cascade:AttachmentShape",
            "cascade:AttachmentShape",
            "Attachment shape",
          ],
          [
            "terms/index.html#cascade:abatementDate",
            "cascade:abatementDate",
            "Abatement Date",
          ],
        ],
      );
    });

    it("lists each rule of a rules page as an anchor of it, titled by its heading", () => {
      assert.deepEqual(
        rows
          .filter(({ kind }) => kind === "rule")
          .map(({ path, title }) => [path, title]),
        [
          [
            "spec/consent.html#y1",
            "Y1. Each tool a runtime offers a model takes one kind of act",
          ],
          ["spec/consent.html#y2", 'Y2. A tool "never" offered'],
        ],
      );
    });

    it("lists a decision note by its title, without the site's name after it", () => {
      assert.deepEqual(
        rows.filter(({ kind }) => kind === "decision"),
        [
          {
            path: "decisions/consent-tiers.html",
            title: "What a model may do with a person's pods",
            kind: "decision",
          },
        ],
      );
    });

    it("lists no stylesheet and no data file as a row, and no row twice", () => {
      assert.ok(!rows.some(({ path }) => /\.(?:css|ttl)$/.test(path)));
      const paths = rows.map(({ path }) => path);
      assert.equal(new Set(paths).size, paths.length);
    });

    it("writes the script beside `search.json`, and `index.json` lists both", () => {
      assert.equal(read(tree, SEARCH_SCRIPT_FILE), SEARCH_SCRIPT);
      const listed = (
        JSON.parse(read(tree, INDEX_FILE)) as { files: { path: string }[] }
      ).files.map(({ path }) => path);
      assert.ok(listed.includes(SEARCH_FILE));
      assert.ok(listed.includes(SEARCH_SCRIPT_FILE));
    });

    it("lands a term's name on its anchor first, whatever the case or a `cascade:` before it", () => {
      for (const query of [
        "Attachment",
        "attachment",
        "cascade:Attachment",
        "  ATTACHMENT ",
      ])
        assert.equal(
          rank(rows, query)[0]?.path,
          "terms/index.html#cascade:Attachment",
          query,
        );
    });

    it("lands a rule's number on the rule, and a decision's title words on the note", () => {
      assert.equal(rank(rows, "Y2")[0]?.path, "spec/consent.html#y2");
      assert.equal(
        rank(rows, "what a model may do")[0]?.path,
        "decisions/consent-tiers.html",
      );
    });

    it("ranks a name before a name that begins with it, and that before a title that holds it", () => {
      assert.deepEqual(
        rank(rows, "attachment").map(({ path }) => path),
        [
          "terms/index.html#cascade:Attachment",
          "terms/index.html#cascade:AttachmentShape",
          "guide/attachments.html",
        ],
      );
    });

    it("finds a term by a word of its label, every word of the query having to be found", () => {
      assert.equal(
        rank(rows, "abatement date")[0]?.path,
        "terms/index.html#cascade:abatementDate",
      );
      assert.deepEqual(rank(rows, "attachment abatement"), []);
    });

    it("answers nothing to an empty query, a blank one and a name nothing holds", () => {
      for (const query of ["", "   ", "zzzz-no-such-thing"])
        assert.deepEqual(rank(rows, query), [], JSON.stringify(query));
    });

    it("reads a query as text, so a pattern's characters match themselves", () => {
      for (const query of ["(", "[a-", "\\", ".*", "a|b"])
        assert.deepEqual(rank(rows, query), [], query);
    });
  });

  describe("given a tree with no term page and no rules page", () => {
    it("lists the pages alone", async () => {
      const { rows } = await rowsOf({ "a/index.html": page("A") });
      assert.deepEqual(
        rows.filter(({ kind }) => kind !== "page" && kind !== "decision"),
        [],
      );
      assert.ok(rows.some(({ path }) => path === "a/index.html"));
    });
  });

  describe("with shell()", () => {
    const box = (chrome: Parameters<typeof shell>[0]["chrome"], root?: string) =>
      shell({
        chrome,
        title: "T",
        stylesheet: "../site.css",
        ...(root !== undefined && { hubRoot: root }),
        main: "x",
      }).text;

    it("writes the box under the header, loading the script and naming the rows by their address from the page", () => {
      const html = box({ ...PLAIN, search: true }, "../");
      const header = html.indexOf("</header>");
      const form = html.indexOf('<form class="sx-find"');
      assert.ok(form > 0 && form < html.indexOf("<main"), "the box is above main");
      assert.ok(form < header, "the box is in the header");
      assert.match(html, /data-rows="\.\.\/search\.json"/);
      assert.match(html, /<script src="\.\.\/search\.js" defer><\/script>/);
      assert.match(html, /<label [^>]*for="sx-find-q"/);
    });

    it("writes no box when the pages are built with no search files beside them, or the page does not say where they are", () => {
      assert.ok(!box(PLAIN, "../").includes("sx-find"));
      assert.ok(!box({ ...PLAIN, search: true }).includes("sx-find"));
    });
  });

  describe("with the build-pages command, over the hub's own sections", () => {
    const cli = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "node",
      "cli.js",
    );
    const out = join(ROOT, "build", "pages");
    const html: string[] = [];
    const walk = (folder: string): void => {
      for (const name of readdirSync(join(out, folder))) {
        const path = folder === "" ? name : `${folder}/${name}`;
        if (statSync(join(out, path)).isDirectory()) walk(path);
        else if (path.endsWith(".html")) html.push(path);
      }
    };
    let rows: SearchRow[];

    before(() => {
      const run = spawnSync(
        process.execPath,
        [cli, "build-pages", "--no-kits", "--built", "2026-11-14"],
        { encoding: "utf8", cwd: ROOT },
      );
      assert.equal(run.status, 0, run.stderr);
      walk("");
      rows = JSON.parse(
        readFileSync(join(out, SEARCH_FILE), "utf8"),
      ) as SearchRow[];
    });

    it("puts the box on every page of the hub, the evals' own frame left alone", () => {
      assert.ok(html.length > 30);
      let boxed = 0;
      for (const path of html) {
        const page = readFileSync(join(out, path), "utf8");
        const own = path.startsWith("evals/");
        assert.equal(page.includes('class="sx-find"'), !own, path);
        if (own) continue;
        boxed++;
        const rowsAt = /data-rows="([^"]+)"/.exec(page)?.[1] ?? "";
        assert.ok(
          existsSync(join(out, posix.join(posix.dirname(path), rowsAt))),
          `${path}: ${rowsAt} is not a file`,
        );
        assert.equal(
          posix.join(posix.dirname(path), rowsAt),
          SEARCH_FILE,
          path,
        );
      }
      assert.ok(boxed > 30);
    });

    it("lands the name of a term of the vocabulary on its anchor in the term page, first", () => {
      const terms = rows.filter(({ kind }) => kind === "term");
      assert.ok(terms.length > 400, `${terms.length} terms`);
      const termPage = readFileSync(join(out, "terms", "index.html"), "utf8");
      for (const { path, title } of terms.filter((_, at) => at % 25 === 0)) {
        const name = title.replace(/^cascade:/, "");
        const first = rank(rows, name)[0];
        assert.equal(
          first?.kind === "term" ? first.title : first?.path,
          title,
          name,
        );
        assert.ok(termPage.includes(`id="${path.split("#")[1]}"`), path);
      }
    });

    it("lands every row on a file of the tree, and on an id of it when the row is an anchor", () => {
      for (const { path } of rows) {
        const [file = "", id] = path.split("#");
        assert.ok(existsSync(join(out, file)), path);
        if (id !== undefined)
          assert.ok(
            readFileSync(join(out, file), "utf8").includes(`id="${id}"`),
            path,
          );
      }
      assert.ok(rows.some(({ kind }) => kind === "rule"));
      assert.ok(rows.some(({ kind }) => kind === "decision"));
    });

    it("stays under 300 KB", () => {
      assert.ok(statSync(join(out, SEARCH_FILE)).size < 300_000);
    });
  });
});
