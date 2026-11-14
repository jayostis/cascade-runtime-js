import assert from "node:assert/strict";
import { dirname } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { findRoot } from "@cascade-runtime/runtime/node";
import { FRONT_PAGE, hubFiles } from "../src/front-page.js";
import { PLAIN } from "../src/html.js";
import type { PagesContext } from "../src/hub/context.js";
import { evalsSection } from "../src/node/hub/evals.js";
import {
  buildTree,
  type Section,
  type Walk,
  type Want,
} from "../src/sections.js";
import { STYLESHEET_FILE } from "../src/site.js";
import { readPage } from "./page.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const text = (what: string) => new TextEncoder().encode(what);
const read = (tree: ReadonlyMap<string, Uint8Array>, path: string) =>
  new TextDecoder().decode(tree.get(path));

/** A section that writes its one page and lists it. */
function inMemory(
  name: string,
  want: Want,
  more: Partial<Section<object>> = {},
): Section<object> {
  return {
    path: `${name}.html`,
    title: `The ${name}`,
    want,
    build: async () => new Map([[`${name}.html`, text(name)]]),
    rows: async () => [{ href: `${name}.html`, label: `Row of ${name}` }],
    ...more,
  };
}

const front = (rows: Parameters<typeof hubFiles>[1]) =>
  hubFiles(["Records"], rows, PLAIN);

const buildOf = (
  sections: Section<object>[],
  more: Partial<Parameters<typeof buildTree<object>>[0]> = {},
) => buildTree({ sections, ctx: {}, front, ...more });

/**
 * A section is one part of the site: the files it writes and the links it lists for the front page. `buildTree()` builds
 * each section, then the front page from their links, then the finishers, and refuses a site in which a file is written
 * twice or a listed link reaches nothing.
 */
describe("Building a site from sections · buildTree()", () => {
  describe("with two sections", () => {
    let walk: Walk<object>;

    before(async () => {
      walk = await buildOf([
        inMemory("later", "agent"),
        inMemory("first", "build"),
      ]);
    });

    it("writes each section's files, the front page and the stylesheet", () => {
      assert.deepEqual(
        [...walk.tree.keys()].sort(),
        ["first.html", "later.html", "index.html", STYLESHEET_FILE].sort(),
      );
    });

    it("lists each section's link in the front page's order of rows, whatever the order of the sections", () => {
      const page = readPage(read(walk.tree, FRONT_PAGE));
      assert.ok(page.hrefs.includes("first.html"));
      assert.ok(page.hrefs.includes("later.html"));
      assert.ok(
        page.said.indexOf("Row of first") < page.said.indexOf("Row of later"),
      );
    });

    it("returns the sections in the order given", () => {
      assert.deepEqual(
        walk.sections.map(({ section }) => section.title),
        ["The later", "The first"],
      );
    });
  });

  describe("with a section the `skip` option names", () => {
    it("leaves out its files and its link", async () => {
      const { tree } = await buildOf(
        [inMemory("a", "build"), inMemory("b", "build", { needsKits: true })],
        { skip: ({ needsKits }) => needsKits === true },
      );
      assert.ok(tree.has("a.html"));
      assert.ok(!tree.has("b.html"));
      assert.ok(!read(tree, FRONT_PAGE).includes("Row of b"));
    });
  });

  describe("with sections that cannot make one site", () => {
    /** One section listing `a.html` and writing `files` besides it. */
    const writing = (...files: string[]) =>
      inMemory("a", "build", {
        build: async () =>
          new Map(["a.html", ...files].map((one) => [one, text("a")])),
      });

    it("refuses two sections that write one file, naming the file", async () => {
      await assert.rejects(
        buildOf([
          inMemory("a", "build"),
          inMemory("b", "build", {
            build: async () =>
              new Map([
                ["b.html", text("b")],
                ["a.html", text("b")],
              ]),
          }),
        ]),
        /the section The b writes a\.html, which is already in the tree/,
      );
    });

    it("refuses a section that does not write its own entry page", async () => {
      await assert.rejects(
        buildOf([inMemory("a", "build", { build: async () => new Map() })]),
        /the section The a does not write a\.html/,
      );
    });

    it("refuses a link to a file nothing writes", async () => {
      await assert.rejects(
        buildOf([
          inMemory("a", "build", {
            rows: async () => [{ href: "gone.html", label: "Gone" }],
          }),
        ]),
        /has a row that links gone\.html, which nothing writes/,
      );
    });

    it("leaves a link for agents off the front page", async () => {
      const walk = await buildOf([
        inMemory("a", "build", {
          build: async () =>
            new Map([
              ["a.html", text("A")],
              ["data.json", text("{}")],
            ]),
          rows: async () => [
            { href: "a.html", label: "For people", audience: "people" },
            { href: "data.json", label: "For agents", audience: "agents" },
          ],
        }),
      ]);
      const page = readPage(read(walk.tree, FRONT_PAGE));
      assert.ok(page.hrefs.includes("a.html"));
      assert.ok(!page.hrefs.includes("data.json"));
    });

    it("refuses a second link to a file nothing writes", async () => {
      await assert.rejects(
        buildOf([
          inMemory("a", "build", {
            rows: async () => [
              {
                href: "a.html",
                label: "A",
                also: { href: "gone/pod.ttl", label: "Gone" },
              },
            ],
          }),
        ]),
        /has a row that links gone\/pod\.ttl, which nothing writes/,
      );
    });

    it("refuses a file outside the site: a `..` part, a `.` part or a drive path", async () => {
      for (const path of ["../a.html", "a/./b.html", "C:/x"])
        await assert.rejects(
          buildOf([writing(path)]),
          new RegExp(
            `writes ${path.replaceAll(".", "\\.")}, which is not inside the tree`,
          ),
          path,
        );
    });
  });

  describe("with a finisher", () => {
    let walk: Walk<object>;
    let seen: string[];
    let handed: unknown;

    before(async () => {
      seen = [];
      walk = await buildOf([inMemory("a", "build"), inMemory("b", "agent")], {
        finishers: [
          async ({ tree: written, sections }) => {
            seen.push(...written.keys());
            handed = sections.map(({ section, paths, rows }) => [
              section.path,
              paths,
              rows.length,
            ]);
            return new Map([["index.json", text("{}")]]);
          },
        ],
      });
    });

    it("hands it the site as written, the front page included", () => {
      assert.ok(seen.includes(FRONT_PAGE));
      assert.ok(seen.includes("a.html"));
    });

    it("hands it each section's entry page, the files it wrote and its links", () => {
      assert.deepEqual(handed, [
        ["a.html", ["a.html"], 1],
        ["b.html", ["b.html"], 1],
      ]);
    });

    it("adds the files it returns to the site", () => {
      assert.ok(walk.tree.has("index.json"));
    });

    it("refuses a file it returns that a section already wrote", async () => {
      await assert.rejects(
        buildOf([inMemory("a", "build")], {
          finishers: [async () => new Map([["a.html", text("again")]])],
        }),
        /a finisher writes a\.html, which is already in the tree/,
      );
    });

    it("accepts a section's link to a file only a finisher writes", async () => {
      const { tree } = await buildOf(
        [
          inMemory("a", "build", {
            rows: async () => [{ href: "llms.txt", label: "For models" }],
          }),
        ],
        { finishers: [async () => new Map([["llms.txt", text("x")]])] },
      );
      assert.ok(tree.has("llms.txt"));
    });
  });
});

/**
 * The evals package writes its own pages; the site imports its compiled module by path and places them. This checks
 * the wiring: a build that moved them would break the front page's link.
 */
describe("The evals pages as a section of the site · evalsSection", () => {
  describe("`evalsSection.build()`", () => {
    let files: ReadonlyMap<string, Uint8Array>;

    before(async () => {
      files = await evalsSection.build({
        root: ROOT,
        chrome: PLAIN,
      } as PagesContext);
    });

    it("writes `evals/index.html` as its entry page", () => {
      assert.equal(evalsSection.path, "evals/index.html");
      assert.ok(files.has("evals/index.html"));
    });

    it("writes every file under `evals/`", () => {
      assert.deepEqual(
        [...files.keys()].filter((path) => !path.startsWith("evals/")),
        [],
      );
    });
  });
});
