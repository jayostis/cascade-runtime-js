import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { findRoot } from "@cascade-runtime/runtime/node";
import {
  AGENTS_FILE,
  agentFiles,
  INDEX_FILE,
  LLMS_FILE,
} from "../src/agents.js";
import { FRONT_PAGE, hubFiles, REPOSITORIES } from "../src/front-page.js";
import type { PagesContext } from "../src/hub/context.js";
import { apiSection } from "../src/node/hub/api.js";
import { evalsSection } from "../src/node/hub/evals.js";
import { FINISHERS, SECTIONS } from "../src/node/hub/index.js";
import { trySection } from "../src/hub/try.js";
import { buildTree, type Section } from "../src/sections.js";
import { STYLESHEET_FILE } from "../src/site.js";
import { readPage } from "./page.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const GUIDE = join(ROOT, "packages", "cascade-runtime", "guide", "AGENTS.md");
const text = (what: string) => new TextEncoder().encode(what);
const read = (tree: ReadonlyMap<string, Uint8Array>, path: string) =>
  new TextDecoder().decode(tree.get(path));
/** A link of a Markdown file, as `[label](address)`. */
const links = (markdown: string) =>
  [...markdown.matchAll(/\]\(([^)\s]+)\)/g)].map(([, link]) => link ?? "");
const local = (link: string) => !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(link);
const fileOf = (link: string) => {
  const path = link.replace(/[?#].*$/, "");
  return path === "" || path.endsWith("/") ? `${path}index.html` : path;
};

const page = (title: string, body = "") =>
  text(
    `<!DOCTYPE html><html><head><title>${title}</title></head><body>${body}</body></html>`,
  );

/** A section that writes the files it is given and lists the links it is given. */
function made(
  path: string,
  title: string,
  files: Record<string, Uint8Array>,
  more: Partial<Section<object>> = {},
): Section<object> {
  return {
    path,
    title,
    want: "see",
    build: async () => new Map(Object.entries(files)),
    rows: async () => [],
    ...more,
  };
}

const front = (rows: Parameters<typeof hubFiles>[1]) =>
  hubFiles(["Records"], rows);

/** The site `sections` make with `agentFiles` as the finisher, under the context `ctx`. */
const siteOf = (
  sections: Section<object>[],
  ctx: object = {},
  frontOf: typeof front = front,
) => buildTree({ sections, ctx, front: frontOf, finishers: [agentFiles] });

/** The text of `llms.txt` over `sections`. */
const llmsOf = async (
  sections: Section<object>[],
  ctx: object = {},
  frontOf: typeof front = front,
) => read((await siteOf(sections, ctx, frontOf)).tree, LLMS_FILE);

/** The entries of `index.json`. */
const entriesOf = (tree: ReadonlyMap<string, Uint8Array>) =>
  (
    JSON.parse(read(tree, INDEX_FILE)) as {
      files: { path: string; title: string; kind: string; source: string }[];
    }
  ).files;

/** A section with one link of the site's and one of another, to see what a base address does to each. */
const SECTION_WITH_BASE_ADDRESS: Section<object>[] = [
  made(
    "a/index.html",
    "Section A",
    { "a/index.html": page("A"), [AGENTS_FILE]: text("# guide") },
    {
      want: "build",
      rows: async () => [
        { href: "a/", label: "Open A", about: "its line" },
        { href: "https://example.org/x", label: "Elsewhere" },
      ],
    },
  ),
];

/**
 * Three files at the site's root let an agent find its way without reading HTML: `llms.txt` lists the site's links in
 * groups, `index.json` lists every file with its title, kind and source, and `AGENTS.md` is the guide. `agentFiles()` is
 * a finisher: it writes them from what the sections wrote. A group is a `##` part of `llms.txt`.
 */
describe("Files for an agent · agentFiles(), llms.txt, index.json, AGENTS.md", () => {
  describe("given the site's own sections", () => {
    let tree: ReadonlyMap<string, Uint8Array>;

    before(async () => {
      ({ tree } = await buildTree({
        sections: [trySection, apiSection],
        ctx: { root: ROOT } as PagesContext,
        front,
        finishers: [agentFiles],
      }));
    });

    it("writes `llms.txt`, `index.json` and `AGENTS.md` at the root", () => {
      for (const file of [LLMS_FILE, INDEX_FILE, AGENTS_FILE])
        assert.ok(tree.has(file), `${file} is at the root`);
    });

    it("copies the guide as `AGENTS.md`, byte for byte", async () => {
      assert.deepEqual(
        Buffer.from(tree.get(AGENTS_FILE) ?? []),
        await readFile(GUIDE),
      );
    });

    it("links the three, and the API page, from the front page", () => {
      const onFront = readPage(read(tree, FRONT_PAGE)).hrefs;
      for (const link of ["api/", AGENTS_FILE, LLMS_FILE, INDEX_FILE])
        assert.ok(onFront.includes(link), `the front page links ${link}`);
    });

    it("links from `llms.txt` only files the site holds", () => {
      for (const link of links(read(tree, LLMS_FILE)).filter(local))
        assert.ok(tree.has(fileOf(link)), `llms.txt links ${link}`);
    });

    it("lists in `index.json` every file of the site but a stylesheet", () => {
      const listed = entriesOf(tree).map(({ path }) => path);
      for (const path of listed)
        assert.ok(tree.has(path), `index.json lists ${path}`);
      assert.deepEqual(
        [...listed].sort(),
        [...tree.keys()].filter((path) => !path.endsWith(".css")).sort(),
      );
    });

    it("runs as a finisher of the site's build, with the API page among its sections", () => {
      assert.ok(SECTIONS.includes(apiSection));
      assert.ok(FINISHERS.includes(agentFiles));
    });

    it("names for every section what its files are built from", () => {
      for (const section of SECTIONS)
        assert.ok(
          section.source !== undefined && section.source !== "",
          `${section.title} has a source`,
        );
    });

    it("marks the evals section as one an agent may skip", () => {
      assert.equal(evalsSection.optional, true);
    });
  });

  describe("`llms.txt`", () => {
    let llms: string;

    before(async () => {
      llms = await llmsOf(
        [
          made(
            "a/index.html",
            "Section A",
            { "a/index.html": page("A"), "a/one (two).html": page("x") },
            {
              want: "build",
              about: "what A is",
              rows: async () => [
                { href: "a/", label: "Open A", about: "its first line" },
                { href: "a/index.html", label: "Open A again" },
                { href: "https://example.org/x", label: "Elsewhere" },
                { href: "llms.txt", label: "The llms.txt itself" },
                { href: "a/one (two).html", label: "Odd [name]" },
              ],
            },
          ),
          made("c/index.html", "Section C", { "c/index.html": page("C") }),
          made(
            "b/index.html",
            "Section B",
            {
              "b/index.html": page("B"),
              "b/one.html": page("One"),
              "b/two.html": page("Two"),
            },
            { about: "what B is" },
          ),
        ],
        {},
        () => front(new Map()),
      );
    });

    it("opens with a title, then a quoted summary, then groups of links", () => {
      const lines = llms.split("\n");
      assert.match(lines[0] ?? "", /^# \S/);
      assert.match(lines[2] ?? "", /^> \S/);
      assert.ok(lines.some((line) => /^## \S/.test(line)));
    });

    it("writes each link as `- [text](address)`, then a colon and a line about it where it has one", () => {
      const items = llms.split("\n").filter((line) => line.startsWith("- "));
      assert.ok(items.length > 0);
      for (const line of items)
        assert.match(line, /^- \[.+\]\([^)\s]+\)(: \S.*)?$/);
      assert.ok(llms.includes("- [Open A](a/): its first line"));
    });

    it("takes a section's links as the section lists them, a folder and its index page once", () => {
      assert.ok(llms.includes("- [Open A](a/): its first line"));
      assert.ok(!llms.includes("Open A again"));
    });

    it("keeps a link to another site", () => {
      assert.ok(llms.includes("(https://example.org/x)"));
    });

    it("leaves itself out", () => {
      assert.ok(!llms.includes("The llms.txt itself"));
    });

    it("lists a section none of whose links is its entry page by its title and what it is", () => {
      assert.ok(llms.includes("- [Section B](b/index.html): what B is"));
    });

    it("lists no other page of a section", () => {
      assert.ok(!llms.includes("b/one.html"));
    });

    it("leaves out a section that says nothing of itself", () => {
      assert.ok(!llms.includes("Section C"));
    });

    it("escapes brackets in a link's text, and spaces and parentheses in an address", () => {
      assert.ok(llms.includes("- [Odd \\[name\\]](a/one%20%28two%29.html)"));
    });

    it("lists nothing more than those links and the repositories", () => {
      assert.equal(
        llms.split("\n- [").length - 1,
        5 +
          REPOSITORIES.length +
          REPOSITORIES.filter(({ site }) => site).length,
      );
    });
  });

  describe("with a link for the contribute row", () => {
    let llms: string;
    let group: string | undefined;

    before(async () => {
      llms = await llmsOf([
        made(
          "d/index.html",
          "Section D",
          { "d/index.html": page("D") },
          {
            rows: async () => [
              { href: "d/", label: "Open D" },
              {
                href: "d/#the-bar",
                label: "The bar",
                about: "what a change must meet",
                want: "contribute",
              },
            ],
          },
        ),
      ]);
      group = llms.split(/^## /m).find((part) => /^Contribute\n/.test(part));
    });

    it("lists it under Contribute, though it reaches into a page another link lists", () => {
      assert.ok(llms.includes("- [Open D](d/)"));
      assert.ok(group, "llms.txt has a Contribute group");
      assert.ok(
        group.includes("- [The bar](d/#the-bar): what a change must meet"),
      );
    });

    it("lists every repository under Contribute, with its own site where it has one", () => {
      assert.ok(group, "llms.txt has a Contribute group");
      for (const { name, site } of REPOSITORIES) {
        assert.ok(
          group.includes(`(https://github.com/jayostis/${name})`),
          `the Contribute group lists ${name}`,
        );
        if (site !== undefined)
          assert.ok(group.includes(`(${site})`), `and ${name}'s site`);
      }
    });
  });

  describe("with the guide and the conformance results among the site's files", () => {
    let llms: string;

    before(async () => {
      llms = await llmsOf([
        made("a/index.html", "A", {
          "a/index.html": page("A"),
          "conformance/results.json": text("{}"),
          [AGENTS_FILE]: text("# guide"),
        }),
      ]);
    });

    it("points an agent at `AGENTS.md`", () => {
      assert.ok(llms.includes("(AGENTS.md)"));
    });

    it("points an agent at `conformance/results.json`, naming its `at` and `ranWith`", () => {
      const results = llms
        .split("\n")
        .find((line) => line.includes("results.json"));
      assert.match(
        results ?? "",
        /^- \[[^\]]+\]\(conformance\/results\.json\): /,
      );
      assert.match(llms, /`at`[^\n]*built|built[^\n]*`at`/);
      assert.match(llms, /`ranWith`/);
    });
  });

  describe("with neither among the site's files", () => {
    it("points an agent at `index.json` and at neither", async () => {
      const llms = await llmsOf([
        made("a/index.html", "A", { "a/index.html": page("A") }),
      ]);
      assert.ok(llms.includes("(index.json)"));
      assert.ok(!llms.includes("AGENTS.md"));
      assert.ok(!llms.includes("results.json"));
    });
  });

  describe("with a section marked optional", () => {
    let llms: string;

    before(async () => {
      llms = await llmsOf([
        made(
          "o/index.html",
          "Optional one",
          { "o/index.html": page("O") },
          { want: "build", about: "may be skipped", optional: true },
        ),
        made(
          "a/index.html",
          "Section A",
          { "a/index.html": page("A") },
          { want: "see", about: "read this" },
        ),
      ]);
    });

    it("lists it last, under `## Optional`", () => {
      const optional = llms.indexOf("## Optional");
      assert.ok(optional > llms.indexOf("- [Section A]"), "after the rest");
      assert.ok(llms.indexOf("- [Optional one]") > optional);
    });

    it("writes no heading for a group it leaves empty", () => {
      assert.ok(!llms.includes("## Build an app"));
    });
  });

  describe("`index.json`", () => {
    let entries: ReturnType<typeof entriesOf>;
    let by: Map<string, (typeof entries)[number]>;

    before(async () => {
      const { tree } = await siteOf([
        made(
          "a/index.html",
          "Section A",
          {
            "a/index.html": page("Terms &amp; &lt;things&gt; &#39;x&#39;"),
            "a/data.ttl": text("<a> <b> <c> ."),
            "a/notes.md": text("# Notes"),
            "a/table.json": text("{}"),
            "a/blob.bin": new Uint8Array([1, 2, 3]),
            "a/style.css": text("body {}"),
          },
          { source: "the A repository" },
        ),
        made("b/index.html", "Section B", { "b/index.html": page("B") }),
      ]);
      entries = entriesOf(tree);
      by = new Map(entries.map((entry) => [entry.path, entry]));
    });

    it("gives a page its title, decoded, its kind and its section's source", () => {
      assert.deepEqual(by.get("a/index.html"), {
        path: "a/index.html",
        title: "Terms & <things> 'x'",
        kind: "page",
        source: "the A repository",
      });
    });

    it("names any other file data, a document or a file, by its extension", () => {
      assert.deepEqual(
        ["a/data.ttl", "a/table.json", "a/notes.md", "a/blob.bin"].map(
          (path) => by.get(path)?.kind,
        ),
        ["data", "data", "document", "file"],
      );
    });

    it("takes a Markdown document's title from its first heading, and another file's from its name", () => {
      assert.deepEqual(
        ["a/notes.md", "a/data.ttl", "a/table.json", "a/blob.bin"].map(
          (path) => by.get(path)?.title,
        ),
        ["Notes", "data.ttl", "table.json", "blob.bin"],
      );
    });

    it("leaves out every stylesheet", () => {
      assert.ok(!by.has("a/style.css"));
      assert.ok(!by.has(STYLESHEET_FILE));
    });

    it("gives a section's title as its source where the section names none", () => {
      assert.equal(by.get("b/index.html")?.source, "Section B");
    });

    it("lists the front page, `llms.txt` and itself", () => {
      assert.equal(by.get(FRONT_PAGE)?.title, "Cascade pods");
      assert.equal(by.get(LLMS_FILE)?.kind, "document");
      assert.equal(by.get(INDEX_FILE)?.kind, "data");
    });

    it("lists the files in the order of their paths", () => {
      const paths = entries.map(({ path }) => path);
      assert.deepEqual(paths, [...paths].sort());
    });
  });

  describe("with a section that lists its files in another order", () => {
    it("writes the same `llms.txt` and `index.json`, byte for byte", async () => {
      const files = ["a/index.html", "a/z.html", "a/m.html", "a/b.json"];
      const build = (order: readonly string[]) =>
        siteOf([
          made(
            "a/index.html",
            "Section A",
            Object.fromEntries(order.map((path) => [path, page(path)])),
            {
              want: "build",
              rows: async () => [{ href: "a/", label: "Open A" }],
            },
          ),
        ]);
      const [one, two] = [
        await build(files),
        await build([...files].reverse()),
      ];
      for (const file of [LLMS_FILE, INDEX_FILE]) {
        assert.ok(read(one.tree, file).length > 100, `${file} has content`);
        assert.equal(read(one.tree, file), read(two.tree, file));
      }
      assert.ok(read(one.tree, INDEX_FILE).includes("a/z.html"));
    });
  });

  describe("with a base address", () => {
    const base = "https://hub.example/pages/";
    let llms: string;
    let index: { base?: string; files: { path: string }[] };

    before(async () => {
      const { tree } = await siteOf(SECTION_WITH_BASE_ADDRESS, { base });
      llms = read(tree, LLMS_FILE);
      index = JSON.parse(read(tree, INDEX_FILE));
    });

    it("writes each local link of `llms.txt` under it, and a link to another site as it is", () => {
      assert.ok(llms.includes(`- [Open A](${base}a/): its line`));
      assert.ok(llms.includes(`(${base}${AGENTS_FILE})`));
      assert.ok(llms.includes(`(${base}${INDEX_FILE})`));
      assert.ok(llms.includes("(https://example.org/x)"));
    });

    it("says no longer that its links are relative", () => {
      assert.ok(!llms.includes("relative"));
      for (const link of links(llms))
        assert.ok(!local(link), `${link} is absolute`);
    });

    it("carries the base address in `index.json`, whose paths stay relative", () => {
      assert.equal(index.base, base);
      assert.ok(index.files.some(({ path }) => path === "a/index.html"));
      assert.ok(index.files.every(({ path }) => local(path)));
    });
  });

  describe("with no base address", () => {
    let llms: string;
    let index: object;

    before(async () => {
      const { tree } = await siteOf(SECTION_WITH_BASE_ADDRESS);
      llms = read(tree, LLMS_FILE);
      index = JSON.parse(read(tree, INDEX_FILE));
    });

    it("keeps the links of `llms.txt` relative, and says they are", () => {
      assert.ok(llms.includes("- [Open A](a/): its line"));
      assert.match(llms, /relative/);
    });

    it("writes no `base` in `index.json`", () => {
      assert.ok(!("base" in index));
    });
  });

  describe("with a base address that does not end in a slash", () => {
    it("refuses it", async () => {
      for (const bad of ["https://hub.example/pages", ""])
        await assert.rejects(
          siteOf(SECTION_WITH_BASE_ADDRESS, { base: bad }),
          /end in "\/"/,
          JSON.stringify(bad),
        );
    });
  });
});
