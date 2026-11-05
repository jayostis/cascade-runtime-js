import assert from "node:assert/strict";
import { test } from "node:test";
import { FRONT_PAGE, hubFiles, STARTER_TRY } from "../src/front-page.js";
import type { PagesContext } from "../src/hub/context.js";
import { SECTIONS } from "../src/node/hub/index.js";
import { buildTree, pageOf } from "../src/sections.js";
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

test("the front page has a Find your way table with a row for each thing a reader came for, each linking its page, and links no address twice", async () => {
  const html = await frontPage();
  const rows = rowsOf(html);
  assert.deepEqual(
    [...rows].map(([id, links]) => [id, [...links].sort()]),
    [
      ["want-see", ["examples.html", STARTER_TRY]],
      ["want-build", ["api/", "start.html"]],
      ["want-model", ["terms/"]],
      ["want-why", ["decisions/"]],
      ["want-rules", ["spec/"]],
      ["want-conformance", ["conformance/", "conformance/tests/"]],
      ["want-adapters", ["adapters/"]],
      [
        "want-pods",
        KITS.flatMap((kit) => [`${kit}/index.html`, `${kit}/pod/manifest.ttl`]),
      ],
      ["want-evals", ["evals/"]],
      ["want-agent", ["AGENTS.md", "index.json", "llms.txt"]],
      ["want-contribute", ["#repositories", "decisions/#the-bar"]],
    ].map(([id, links]) => [id, [...(links as string[])].sort()]),
  );
  const all = readPage(html).hrefs;
  assert.deepEqual(
    all.filter((href, at) => all.indexOf(href) !== at),
    [],
    "an address is linked twice",
  );
});

test("the front page lists the nine repositories, each beside its purpose, the reference tables with their own site, and not the archived or private ones", async () => {
  const html = await frontPage();
  const list = /<table id="repository-list">([\s\S]*?)<\/table>/.exec(html);
  assert.ok(list, "the front page lists the repositories");
  const rows = [
    ...(list[1] ?? "").matchAll(/<tr id="([^"]+)">([\s\S]*?)<\/tr>/g),
  ];
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
    assert.ok(said.trim().length > name.length + 20, `${name} says what it is`);
  }
  assert.deepEqual(readPage(rows[7]?.[2] ?? "").hrefs, [
    `${OWNER}/cascade-reference-tables`,
    "https://jayostis.github.io/cascade-reference-tables/",
  ]);
  assert.doesNotMatch(html, /cascade-bridge-js|clinvar|health-assistant/);
});

test("the front page is refused when an address is linked twice, whether by two rows, a row's second link, or a row and a repository, and a want with no row is not written", () => {
  const front = (rows: Parameters<typeof hubFiles>[1]) => hubFiles([], rows);
  for (const [rows, twice] of [
    [
      [
        { href: "a.html", label: "A" },
        { href: "a.html", label: "B" },
      ],
      "a.html",
    ],
    [
      [
        {
          href: "a.html",
          label: "A",
          also: { href: "a.html", label: "again" },
        },
      ],
      "a.html",
    ],
    [
      [{ href: `${OWNER}/cascade-sandbox`, label: "S" }],
      `${OWNER}/cascade-sandbox`,
    ],
  ] as const)
    assert.throws(() => front(new Map([["build", rows]])), {
      message: `the front page links ${twice} twice`,
    });
  const page = new TextDecoder().decode(
    front(new Map([["build", [{ href: "a.html", label: "A" }]]])).get(
      FRONT_PAGE,
    ),
  );
  assert.deepEqual([...rowsOf(page).keys()], ["want-build", "want-contribute"]);
});
