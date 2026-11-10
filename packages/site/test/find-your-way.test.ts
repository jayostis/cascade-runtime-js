import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { FRONT_PAGE, hubFiles, STARTER_TRY } from "../src/front-page.js";
import type { PagesContext } from "../src/hub/context.js";
import { SECTIONS } from "../src/node/hub/index.js";
import { addressOf, buildTree, pageOf, type Row } from "../src/sections.js";
import { readPage } from "./page.js";

const OWNER = "https://github.com/jayostis";
const KITS = ["alex-rivera", "sam-okafor"];

/** The real sections' rows over a front page, each section writing only the pages its rows and entry link. */
async function frontPage(): Promise<string> {
  const ctx = {
    examples: async () =>
      KITS.map((folder) => ({
        folder,
        title: folder.toUpperCase(),
        site: new Map(),
      })),
    tests: async () =>
      ["cascade-runtime-js", "cascade-vocabulary"].map((name) => ({
        suite: {
          repository: `jayostis/${name}`,
          title: `The tests of ${name}`,
          about: "a runner over it",
          workflow: "check.yml",
          artifact: "unit-tests",
          report: "junit.xml",
          runner: "node:test",
        },
      })),
  } as unknown as PagesContext;
  const { tree } = await buildTree({
    sections: SECTIONS.map((section) => ({
      ...section,
      build: async () => {
        const pages = new Map<string, Uint8Array>([
          [section.path, new Uint8Array()],
        ]);
        for (const { href, also } of await section.rows(ctx))
          for (const link of [href, also?.href])
            if (link !== undefined && !/^(https?:|#)/.test(link))
              pages.set(pageOf(link), new Uint8Array());
        return pages;
      },
    })),
    ctx,
    front: (rows) => hubFiles(["Records"], rows),
  });
  return new TextDecoder().decode(tree.get(FRONT_PAGE));
}

/** What a row of the table links, by the id the row has. */
function rowsOf(html: string): Map<string, string[]> {
  const table = /<table id="find-your-way">([\s\S]*?)<\/table>/.exec(html);
  assert.ok(table, "the front page has a Find your way table");
  return new Map(
    [...(table[1] ?? "").matchAll(/<tr id="([^"]+)">([\s\S]*?)<\/tr>/g)].map(
      ([, id = "", row = ""]) => [id, readPage(row).hrefs.slice()] as const,
    ),
  );
}

/** The front page of `rows` under the `build` want alone; throws when it links one address twice. */
const frontOf = (rows: Row[]) => hubFiles([], new Map([["build", rows]]));

/**
 * The front page is where a reader starts: a "Find your way" table with a row for each thing a reader came for, and a
 * list of the project's repositories. `hubFiles()` writes it from the links every section lists, and refuses to link
 * one address twice, so that each page has one place a reader finds it.
 */
describe("The front page · hubFiles()", () => {
  describe("given the site's own sections", () => {
    let html: string;

    before(async () => {
      html = await frontPage();
    });

    const repositoryRows = () => {
      const list = /<table id="repository-list">([\s\S]*?)<\/table>/.exec(html);
      assert.ok(list, "the front page lists the repositories");
      return [
        ...(list[1] ?? "").matchAll(/<tr id="([^"]+)">([\s\S]*?)<\/tr>/g),
      ];
    };

    it("lists a row for each thing a reader came for, in the table's order, each with its links", () => {
      assert.deepEqual(
        [...rowsOf(html)].map(([id, links]) => [id, [...links].sort()]),
        [
          ["want-see", ["examples.html", STARTER_TRY]],
          ["want-build", ["api/", "start.html"]],
          ["want-model", ["terms/"]],
          ["want-why", ["decisions/"]],
          ["want-rules", ["spec/"]],
          [
            "want-conformance",
            [
              "conformance/",
              "conformance/tests/cascade-runtime-js/",
              "conformance/tests/cascade-vocabulary/",
            ],
          ],
          ["want-adapters", ["adapters/"]],
          [
            "want-pods",
            KITS.flatMap((kit) => [
              `${kit}/index.html`,
              `${kit}/pod/manifest.ttl`,
            ]),
          ],
          ["want-evals", ["evals/"]],
          ["want-agent", ["AGENTS.md", "index.json", "llms.txt"]],
          ["want-contribute", ["#repositories", "decisions/#the-bar"]],
        ].map(([id, links]) => [id, [...(links as string[])].sort()]),
      );
    });

    it("links no address twice", () => {
      const all = readPage(html).hrefs.map(addressOf);
      assert.deepEqual(
        all.filter((href, at) => all.indexOf(href) !== at),
        [],
        "an address is linked twice",
      );
    });

    it("lists each live repository in order, linked, beside what it is for", () => {
      const rows = repositoryRows();
      const names = [
        "cascade-vocabulary",
        "cascade-runtime-js",
        "cascade-bridge-spec",
        "cascade-bridge-rs",
        "cascade-bridge-adapter-fhir-r4",
        "cascade-bridge-adapter-ccda",
        "cascade-starter-kit",
        "cascade-reference-tables",
        "cascade-sandbox",
      ];
      assert.deepEqual(
        rows.map(([, id]) => id),
        names.map((name) => `repository-${name}`),
      );
      for (const [, id = "", row = ""] of rows) {
        const name = id.replace("repository-", "");
        const { hrefs, said } = readPage(row);
        assert.equal(hrefs[0], `${OWNER}/${name}`);
        assert.ok(
          said.trim().length > name.length + 20,
          `${name} says what it is`,
        );
      }
    });

    it("links the reference tables' own site beside their repository", () => {
      assert.deepEqual(readPage(repositoryRows()[7]?.[2] ?? "").hrefs, [
        `${OWNER}/cascade-reference-tables`,
        "https://jayostis.github.io/cascade-reference-tables/",
      ]);
    });

    it("leaves out the archived and the private repositories", () => {
      assert.doesNotMatch(html, /cascade-bridge-js|clinvar|health-assistant/);
    });
  });

  describe("given links that reach one address twice", () => {
    it("refuses two links of one address, naming it", () => {
      assert.throws(
        () =>
          frontOf([
            { href: "a.html", label: "A" },
            { href: "a.html", label: "B" },
          ]),
        { message: "the front page links a.html twice" },
      );
    });

    it("refuses a second link that repeats its first", () => {
      assert.throws(
        () =>
          frontOf([
            {
              href: "a.html",
              label: "A",
              also: { href: "a.html", label: "again" },
            },
          ]),
        { message: "the front page links a.html twice" },
      );
    });

    it("refuses a folder and its index page as one address", () => {
      assert.throws(
        () =>
          frontOf([
            { href: "spec/", label: "A" },
            { href: "spec/index.html", label: "B" },
          ]),
        { message: "the front page links spec/index.html twice" },
      );
    });

    it("refuses a link to a repository the list already links", () => {
      assert.throws(
        () => frontOf([{ href: `${OWNER}/cascade-sandbox`, label: "S" }]),
        { message: `the front page links ${OWNER}/cascade-sandbox twice` },
      );
    });
  });

  describe("given links for one row only", () => {
    it("writes that row and the contribute row, and no other", () => {
      const page = new TextDecoder().decode(
        frontOf([{ href: "a.html", label: "A" }]).get(FRONT_PAGE),
      );
      assert.deepEqual(
        [...rowsOf(page).keys()],
        ["want-build", "want-contribute"],
      );
    });
  });
});
