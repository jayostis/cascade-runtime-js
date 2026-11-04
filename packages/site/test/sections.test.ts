import assert from "node:assert/strict";
import { dirname } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findRoot } from "@cascade-runtime/runtime/node";
import { FRONT_PAGE, hubFiles } from "../src/front-page.js";
import type { PagesContext } from "../src/hub/context.js";
import { evalsSection } from "../src/node/hub/evals.js";
import { buildTree, type Kind, type Section } from "../src/sections.js";
import { STYLESHEET_FILE } from "../src/site.js";
import { readPage } from "./page.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const text = (what: string) => new TextEncoder().encode(what);
const read = (tree: ReadonlyMap<string, Uint8Array>, path: string) =>
  new TextDecoder().decode(tree.get(path));

/** A section that writes its one page and lists it. */
function inMemory(
  name: string,
  kind: Kind,
  more: Partial<Section<object>> = {},
): Section<object> {
  return {
    path: `${name}.html`,
    title: `The ${name}`,
    kind,
    build: async () => new Map([[`${name}.html`, text(name)]]),
    rows: async () => [{ href: `${name}.html`, label: `Row of ${name}` }],
    ...more,
  };
}

const front = (rows: Parameters<typeof hubFiles>[1]) =>
  hubFiles(["Records"], rows);

test("two in-memory sections are both built, and the front page lists both rows under their kinds, whatever the order of the list", async () => {
  const { tree, sections } = await buildTree({
    sections: [inMemory("later", "explore"), inMemory("first", "build")],
    ctx: {},
    front,
  });
  assert.deepEqual(
    [...tree.keys()].sort(),
    ["first.html", "later.html", "index.html", STYLESHEET_FILE].sort(),
  );
  const page = readPage(read(tree, FRONT_PAGE));
  assert.ok(page.hrefs.includes("first.html"));
  assert.ok(page.hrefs.includes("later.html"));
  assert.ok(
    page.said.indexOf("Row of first") < page.said.indexOf("Row of later"),
  );
  assert.deepEqual(
    sections.map(({ section }) => section.title),
    ["The later", "The first"],
  );

  const skipped = await buildTree({
    sections: [
      inMemory("a", "build"),
      inMemory("b", "build", { needsKits: true }),
    ],
    ctx: {},
    front,
    skip: ({ needsKits }) => needsKits === true,
  });
  assert.ok(!skipped.tree.has("b.html"));
  assert.ok(!read(skipped.tree, FRONT_PAGE).includes("Row of b"));
});

test("a section list is refused when two sections write one file, a section leaves its path unwritten, a row links a file the tree does not hold, or a section writes outside the tree", async () => {
  const refused: [string, Section<object>[], RegExp][] = [
    [
      "two sections write one file",
      [
        inMemory("a", "build"),
        inMemory("b", "build", {
          build: async () =>
            new Map([
              ["b.html", text("b")],
              ["a.html", text("b")],
            ]),
        }),
      ],
      /a\.html/,
    ],
    [
      "a section does not write its path",
      [inMemory("a", "build", { build: async () => new Map() })],
      /a\.html/,
    ],
    [
      "a row links a file nothing wrote",
      [
        inMemory("a", "build", {
          rows: async () => [{ href: "gone.html", label: "Gone" }],
        }),
      ],
      /gone\.html/,
    ],
    [
      "a row's second link names a file nothing wrote",
      [
        inMemory("a", "build", {
          rows: async () => [
            {
              href: "a.html",
              label: "A",
              also: { href: "gone/pod.ttl", label: "Gone" },
            },
          ],
        }),
      ],
      /gone\/pod\.ttl/,
    ],
    [
      "a section writes outside the tree",
      [
        inMemory("a", "build", {
          build: async () =>
            new Map([
              ["a.html", text("a")],
              ["../a.html", text("a")],
            ]),
        }),
      ],
      /\.\.\/a\.html/,
    ],
  ];
  for (const [what, sections, why] of refused)
    await assert.rejects(buildTree({ sections, ctx: {}, front }), why, what);
});

test("a finisher is handed the tree as written, every section's paths and rows, and what it returns joins the tree, but not over a file already there", async () => {
  const seen: string[] = [];
  const { tree } = await buildTree({
    sections: [inMemory("a", "build"), inMemory("b", "explore")],
    ctx: {},
    front,
    finishers: [
      async ({ tree: written, sections }) => {
        seen.push(...written.keys());
        return new Map([
          [
            "index.json",
            text(
              JSON.stringify(
                sections.map(({ section, paths, rows }) => [
                  section.path,
                  paths,
                  rows.length,
                ]),
              ),
            ),
          ],
        ]);
      },
    ],
  });
  assert.ok(seen.includes(FRONT_PAGE));
  assert.deepEqual(JSON.parse(read(tree, "index.json")), [
    ["a.html", ["a.html"], 1],
    ["b.html", ["b.html"], 1],
  ]);
  await assert.rejects(
    buildTree({
      sections: [inMemory("a", "build")],
      ctx: {},
      front,
      finishers: [async () => new Map([["a.html", text("again")]])],
    }),
    /a\.html/,
  );
});

test("the evals report is a section whose files all sit under evals/, and whose entry page is evals/index.html, the same in the build a pull request makes and the one that deploys", async () => {
  const files = await evalsSection.build({ root: ROOT } as PagesContext);
  assert.equal(evalsSection.path, "evals/index.html");
  assert.ok(files.has("evals/index.html"));
  assert.deepEqual(
    [...files.keys()].filter((path) => !path.startsWith("evals/")),
    [],
  );
});
