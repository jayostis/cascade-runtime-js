import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findRoot } from "@cascade-runtime/runtime/node";
import {
  AGENTS_FILE,
  agentFiles,
  INDEX_FILE,
  LLMS_FILE,
} from "../src/agents.js";
import { FRONT_PAGE, hubFiles } from "../src/front-page.js";
import type { PagesContext } from "../src/hub/context.js";
import { apiSection } from "../src/node/hub/api.js";
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

/** A section that writes the files it is given and lists the rows it is given. */
function made(
  path: string,
  title: string,
  files: Record<string, Uint8Array>,
  more: Partial<Section<object>> = {},
): Section<object> {
  return {
    path,
    title,
    kind: "explore",
    build: async () => new Map(Object.entries(files)),
    rows: async () => [],
    ...more,
  };
}

const front = (rows: Parameters<typeof hubFiles>[1]) =>
  hubFiles(["Records"], rows);

test("after the build, llms.txt, index.json and AGENTS.md sit at the root, every local link of llms.txt and every path of index.json names a file in the tree, and AGENTS.md is the package's guide", async () => {
  const { tree } = await buildTree({
    sections: [trySection, apiSection],
    ctx: { root: ROOT } as PagesContext,
    front,
    finishers: [agentFiles],
  });
  for (const file of [LLMS_FILE, INDEX_FILE, AGENTS_FILE])
    assert.ok(tree.has(file), `${file} is at the root`);
  assert.deepEqual(
    Buffer.from(tree.get(AGENTS_FILE) ?? []),
    await readFile(GUIDE),
  );

  assert.ok(SECTIONS.includes(apiSection) && FINISHERS.includes(agentFiles));
  const onFront = readPage(read(tree, FRONT_PAGE)).hrefs;
  for (const link of ["api/", AGENTS_FILE, LLMS_FILE, INDEX_FILE])
    assert.ok(onFront.includes(link), `the front page links ${link}`);

  const llms = read(tree, LLMS_FILE);
  for (const link of links(llms).filter(local))
    assert.ok(tree.has(fileOf(link)), `llms.txt links ${link}`);
  const index = JSON.parse(read(tree, INDEX_FILE)) as {
    files: { path: string }[];
  };
  for (const { path } of index.files)
    assert.ok(tree.has(path), `index.json lists ${path}`);
  assert.deepEqual(
    index.files.map(({ path }) => path).sort(),
    [...tree.keys()].filter((path) => !path.endsWith(".css")).sort(),
    "every page and file but the stylesheet, and index.json itself, is listed",
  );
});

test("llms.txt is in the llmstxt.org form: a title, a quoted summary, and sections of links with a line each, taken from the sections' rows, with no row twice and nothing of the tree's pages listed one by one", async () => {
  const { tree } = await buildTree({
    sections: [
      made(
        "a/index.html",
        "Section A",
        { "a/index.html": page("A"), "a/one (two).html": page("x") },
        {
          kind: "build",
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
    ctx: {},
    front,
    finishers: [agentFiles],
  });
  const llms = read(tree, LLMS_FILE);
  const lines = llms.split("\n");
  assert.match(lines[0] ?? "", /^# \S/);
  assert.match(lines[2] ?? "", /^> \S/);
  assert.ok(lines.some((line) => /^## \S/.test(line)));
  for (const line of lines.filter((line) => line.startsWith("- ")))
    assert.match(line, /^- \[.+\]\([^)\s]+\)(: \S.*)?$/);
  assert.ok(llms.includes("- [Open A](a/): its first line"));
  assert.ok(!llms.includes("Open A again"), "a/ and a/index.html are one row");
  assert.ok(llms.includes("(https://example.org/x)"));
  assert.ok(!llms.includes("The llms.txt itself"), "it does not list itself");
  assert.ok(
    llms.includes("- [Section B](b/index.html): what B is"),
    "a section none of whose rows names its page is listed by its title and what it is",
  );
  assert.ok(
    !llms.includes("b/one.html"),
    "a section's other pages are not listed",
  );
  assert.ok(
    !llms.includes("Section C"),
    "a section that says nothing is not listed",
  );
  assert.ok(llms.includes("- [Odd \\[name\\]](a/one%20%28two%29.html)"));
  assert.equal(llms.split("\n- [").length - 1, 5);
});

test("index.json gives each page its title, kind and source, titles decoded, and a section's source is what it says it is built from or else its title", async () => {
  const { tree } = await buildTree({
    sections: [
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
    ],
    ctx: {},
    front,
    finishers: [agentFiles],
  });
  const { files } = JSON.parse(read(tree, INDEX_FILE)) as {
    files: { path: string; title: string; kind: string; source: string }[];
  };
  const by = new Map(files.map((entry) => [entry.path, entry]));
  assert.deepEqual(by.get("a/index.html"), {
    path: "a/index.html",
    title: "Terms & <things> 'x'",
    kind: "page",
    source: "the A repository",
  });
  assert.deepEqual(
    ["a/data.ttl", "a/notes.md", "a/table.json", "a/blob.bin"].map((path) => [
      by.get(path)?.kind,
      by.get(path)?.title,
    ]),
    [
      ["data", "data.ttl"],
      ["document", "Notes"],
      ["data", "table.json"],
      ["file", "blob.bin"],
    ],
  );
  assert.ok(!by.has("a/style.css") && !by.has(STYLESHEET_FILE));
  assert.equal(by.get("b/index.html")?.source, "Section B");
  assert.equal(by.get(FRONT_PAGE)?.title, "Cascade pods");
  assert.equal(by.get(LLMS_FILE)?.kind, "document");
  assert.equal(by.get(INDEX_FILE)?.kind, "data");
  assert.deepEqual(
    files.map(({ path }) => path),
    [...files.map(({ path }) => path)].sort(),
    "listed in path order, so a rebuild writes the same bytes",
  );
});

test("llms.txt points an agent at the guide, the index and the conformance results when the tree holds them, and at nothing else", async () => {
  const bare = await buildTree({
    sections: [made("a/index.html", "A", { "a/index.html": page("A") })],
    ctx: {},
    front,
    finishers: [agentFiles],
  });
  const none = read(bare.tree, LLMS_FILE);
  assert.ok(!none.includes("AGENTS.md") && !none.includes("results.json"));
  assert.ok(none.includes("(index.json)"));

  const { tree } = await buildTree({
    sections: [
      made("a/index.html", "A", {
        "a/index.html": page("A"),
        "conformance/results.json": text("{}"),
        [AGENTS_FILE]: text("# guide"),
      }),
    ],
    ctx: {},
    front,
    finishers: [agentFiles],
  });
  const llms = read(tree, LLMS_FILE);
  assert.ok(llms.includes("(AGENTS.md)"));
  const results = llms
    .split("\n")
    .find((line) => line.includes("results.json"));
  assert.match(results ?? "", /^- \[[^\]]+\]\(conformance\/results\.json\): /);
  assert.match(llms, /`at`[^\n]*built|built[^\n]*`at`/);
  assert.match(llms, /`ranWith`/);
});

test("a build writes the same llms.txt and index.json twice", async () => {
  const build = () =>
    buildTree({
      sections: [trySection, apiSection],
      ctx: { root: ROOT } as PagesContext,
      front,
      finishers: [agentFiles],
    });
  const [one, two] = [await build(), await build()];
  for (const file of [LLMS_FILE, INDEX_FILE])
    assert.equal(read(one.tree, file), read(two.tree, file));
});

test("the API page is the guide and the package README as pages: openPod and every call, code kept as code, nothing of the README's install marker, and every link resolving in the tree", async () => {
  const { tree } = await buildTree({
    sections: [
      made("start.html", "Quick start", { "start.html": page("Start") }),
      apiSection,
    ],
    ctx: { root: ROOT } as PagesContext,
    front,
    finishers: [agentFiles],
  });
  assert.equal(apiSection.path, "api/index.html");
  const guide = await readFile(GUIDE, "utf8");
  const api = readPage(read(tree, "api/index.html"));
  assert.equal(api.h1, "Building an app on a Cascade pod");
  const headings = [...guide.matchAll(/^## (.+)$/gm)].map(
    ([, heading]) => heading ?? "",
  );
  assert.ok(headings.length > 5);
  for (const heading of headings)
    assert.ok(api.said.includes(heading), heading);
  assert.ok(api.code.some((block) => block.includes("openPod(")));
  assert.ok(api.hrefs.includes("../AGENTS.md"));
  assert.ok(api.hrefs.includes("package.html"));

  const readme = read(tree, "api/package.html");
  assert.ok(!readme.includes("INSTALL"), "the marker is not shown as text");
  assert.ok(!readme.includes("<!--"));
  assert.ok(readPage(readme).said.includes("openPod"));
  for (const path of ["api/index.html", "api/package.html"])
    for (const link of readPage(read(tree, path)).hrefs.filter(local)) {
      const target = new URL(link, `http://hub/${path}`).pathname.slice(1);
      assert.ok(tree.has(fileOf(target)), `${path} links ${link}`);
    }
});
