import assert from "node:assert/strict";
import { dirname } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type Files, MemoryFiles } from "@cascade-runtime/runtime";
import { findRoot, localVocabulary } from "@cascade-runtime/runtime/node";
import { agentFiles } from "../src/agents.js";
import type { Example } from "../src/front-page.js";
import { PLAIN } from "../src/html.js";
import type { PagesContext } from "../src/hub/context.js";
import { queriesSection } from "../src/hub/queries.js";
import { FINISHERS, SECTIONS } from "../src/node/hub/index.js";
import { buildTree } from "../src/sections.js";
import { readPage } from "./page.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const TREE = "https://github.com/jayostis/cascade-vocabulary/tree/abc123/";
const BLOB = "https://github.com/jayostis/cascade-vocabulary/blob/abc123/";
const text = (value: string) => new TextEncoder().encode(value);
const read = (tree: ReadonlyMap<string, Uint8Array>, path: string) =>
  new TextDecoder().decode(tree.get(path));

const ONTOLOGY = `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

<https://ns.cascadeprotocol.org/cascade#> a owl:Ontology .

cascade:Vaccination a owl:Class ; rdfs:label "Vaccination"@en .
cascade:vaccineCode a owl:ObjectProperty ; rdfs:domain cascade:Vaccination .
`;
const SHAPES = `@prefix sh: <http://www.w3.org/ns/shacl#> .\n`;

const VIEW = `# Each vaccination with its code. It is read from the view alone.
PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
CONSTRUCT { ?v cascade:vaccineCode ?c } WHERE { ?v cascade:vaccineCode ?c }
`;
const QUESTION = `# Every vaccine the person has had,
# newest first. A second sentence.
PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
SELECT ?vaccine WHERE { ?vaccine cascade:vaccineCode ?c }
`;
const SECOND = `# A look-alike whose name slugs as the other does.
SELECT ?s WHERE { ?s ?p ?o }
`;
const BARE = `SELECT ?s WHERE { ?s ?p ?o }
`;
const FEATURE = `Feature: Vaccines
  Rule: V1. A vaccine is coded
    My vaccines are listed by queries/questions/pod/My
    vaccines.rq and by no other.

    Example: a code
      Then the pod holds <https://ns.cascadeprotocol.org/cascade#Vaccination>
`;
const NOTE = `# Vaccines are coded\n\nThe view queries/views/vaccines.rq shows them.\n`;

async function vocabulary(): Promise<Files> {
  const files = new MemoryFiles(TREE);
  const put = (path: string, body: string) => files.write(path, text(body));
  await put("ontologies/cascade.ttl", ONTOLOGY);
  await put("ontologies/cascade.shapes.ttl", SHAPES);
  await put("queries/views/vaccines.rq", VIEW);
  await put("queries/questions/pod/My vaccines.rq", QUESTION);
  await put("queries/questions/pod/My-vaccines.rq", SECOND);
  await put("queries/derivations/no comment here.rq", BARE);
  await put("queries/labels.rq", BARE);
  await put("runtime/vaccines.feature", FEATURE);
  await put("decisions/vaccines.md", NOTE);
  return files;
}

const manyRows = Array.from({ length: 130 }, (_, n) => ({
  vaccine: `https://pod.example/v${n}`,
  vaccineLabel: `Shot ${n}`,
  given: `2025-10-${String((n % 28) + 1).padStart(2, "0")}`,
}));

/** Alex Rivera's built site, as far as the query pages read it: its answers and its explorer's views. */
function alex(answers: unknown = {}): Example {
  const files = new Map<string, Uint8Array>([
    ["answers.json", text(JSON.stringify({ everyday: answers }))],
    [
      "explorer.json",
      text(
        JSON.stringify({
          pod: { lens: "everyday" },
          queries: [{ path: "queries/views/vaccines.rq" }],
          views: [
            {
              file: "clinical/vaccines.ttl",
              query: 0,
              entries: [
                {
                  id: "clinical/vaccines.ttl#a",
                  label: "Flu shot",
                  page: "entries/flu-shot.html",
                  fields: [{ term: "cascade:vaccineCode", entry: "CVX 207" }],
                },
              ],
            },
          ],
        }),
      ),
    ],
  ]);
  return { folder: "alex-rivera", title: "Alex Rivera", site: files };
}

const contextOf = (files: Files, example: Example): PagesContext =>
  ({
    vocabulary: async () => ({ files, builtFrom: [], at: "2027-01-01" }),
    examples: async () => [example],
    chrome: PLAIN,
  }) as unknown as PagesContext;

const build = (files: Files, example: Example) =>
  queriesSection.build(contextOf(files, example));

/**
 * Every query the vocabulary publishes has a page under `queries/`, and an index of them by kind: its purpose as its
 * file states it, its text, the terms it reads, the rules and notes that name it, and for a question or a view its rows
 * on Alex Rivera's pod.
 */
describe("Every query of the vocabulary has a page · queryPages(), queriesSection", () => {
  describe("given a small vocabulary and Alex Rivera's answers", () => {
    let tree: ReadonlyMap<string, Uint8Array>;
    let files: Files;

    before(async () => {
      files = await vocabulary();
      tree = await build(
        files,
        alex({
          "pod/My vaccines": {
            key: "k",
            rows: [
              {
                vaccine: "https://pod.example/v1",
                vaccineLabel: "Flu shot",
                given: "2025-10-15",
              },
            ],
          },
        }),
      );
    });

    it("writes the index and one page for each query, a name with spaces given a slug", () => {
      assert.deepEqual(
        [...tree.keys()].map((path) => path.replace(/--[0-9a-f]+/, "--DIGEST")).sort(),
        [
          "queries/derivations/no-comment-here.html",
          "queries/index.html",
          "queries/labels/labels.html",
          "queries/questions/pod/my-vaccines--DIGEST.html",
          "queries/questions/pod/my-vaccines--DIGEST.html",
          "queries/views/vaccines.html",
        ],
      );
    });

    it("gives two names that slug alike each a page, told apart by a digest", () => {
      const pages = [...tree.keys()].filter((path) =>
        path.startsWith("queries/questions/pod/"),
      );
      assert.equal(pages.length, 2);
      assert.notEqual(pages[0], pages[1]);
      const heads = pages.map((path) => readPage(read(tree, path)).h1).sort();
      assert.deepEqual(heads, ["My vaccines", "My-vaccines"]);
    });

    it("lists each query on the index under its kind, with the first sentence of its leading comment", () => {
      const index = readPage(read(tree, "queries/index.html"), "queries/index.html");
      for (const id of ["questions", "views", "derivations", "labels"])
        assert.ok(index.ids.has(id), `no #${id}`);
      assert.match(
        index.said,
        /Each vaccination with its code\./,
        "the view's purpose",
      );
      assert.doesNotMatch(index.said, /read from the view alone/);
      assert.match(index.said, /Every vaccine the person has had, newest first\./);
      assert.doesNotMatch(index.said, /A second sentence/);
      assert.ok(index.hrefs.includes("queries/views/vaccines.html"));
    });

    it("says a query with no comment by its filename as a phrase, and nothing more", () => {
      const index = readPage(read(tree, "queries/index.html"));
      assert.match(index.said, /no comment here/);
      const page = readPage(read(tree, "queries/derivations/no-comment-here.html"));
      assert.equal(page.h1, "no comment here");
    });

    it("shows the query's text, with each term it reads linked to the term reference", () => {
      const path = "queries/views/vaccines.html";
      const page = readPage(read(tree, path), path);
      assert.match(read(tree, path), /CONSTRUCT/);
      assert.ok(page.hrefs.includes("terms/#cascade:vaccineCode"));
      assert.match(page.said, /cascade:vaccineCode/);
    });

    it("names the rules and decision notes whose text gives its path, one that wraps a line included", () => {
      const view = readPage(
        read(tree, "queries/views/vaccines.html"),
        "queries/views/vaccines.html",
      );
      assert.ok(view.hrefs.includes("decisions/vaccines.html"));
      assert.match(view.said, /Vaccines are coded/);
      const named = [...tree.keys()].find((page) =>
        read(tree, page).includes("V1. A vaccine is coded"),
      );
      assert.ok(named, "a page names rule V1");
      assert.ok(
        readPage(read(tree, named), named).hrefs.includes(
          "spec/vaccines.html#v1",
        ),
      );
    });

    it("shows a question's rows on Alex Rivera's pod as a table, a label in place of the IRI it labels", () => {
      const page = [...tree.keys()].find((path) =>
        read(tree, path).includes("Flu shot"),
      );
      assert.ok(page, "a page shows the row");
      const html = read(tree, page);
      assert.match(html, /<table[^>]*class="[^"]*rows/);
      assert.match(html, /2025-10-15/);
      assert.doesNotMatch(html, /pod\.example\/v1/);
    });

    it("shows a view's entries on Alex Rivera's pod, each linked to its page in that pod", () => {
      const path = "queries/views/vaccines.html";
      const page = readPage(read(tree, path), path);
      assert.ok(page.hrefs.includes("alex-rivera/entries/flu-shot.html"));
      assert.match(page.said, /CVX 207/);
    });

    it("says a question with no row has none, in place of the table", () => {
      const html = [...tree]
        .filter(([path]) => path.startsWith("queries/questions/pod/"))
        .map(([, bytes]) => new TextDecoder().decode(bytes))
        .find((page) => !page.includes("Flu shot"));
      assert.ok(html, "a question page without a row");
      assert.match(
        readPage(html).said,
        /Alex Rivera's pod gives this question no rows\./,
      );
    });

    it("ends each page with its source on GitHub, at the commit read", () => {
      for (const [path, bytes] of tree) {
        if (path === "queries/index.html") continue;
        const hrefs = readPage(new TextDecoder().decode(bytes), path).hrefs;
        assert.ok(
          hrefs.at(-1)?.startsWith(BLOB),
          `${path}'s last link is ${hrefs.at(-1)}`,
        );
      }
    });

    it("lists the section's one row, `queries/`, under what a reader models", async () => {
      const rows = await queriesSection.rows(contextOf(files, alex()));
      assert.deepEqual(
        rows.map(({ href }) => href),
        ["queries/"],
      );
      assert.equal(queriesSection.want, "model");
      assert.equal(queriesSection.path, "queries/index.html");
    });
  });

  describe("given a question with more rows than a page shows", () => {
    it("shows the first hundred and says how many there are", async () => {
      const files = await vocabulary();
      const tree = await build(
        files,
        alex({ "pod/My vaccines": { key: "k", rows: manyRows } }),
      );
      const page = [...tree.keys()].find((path) =>
        read(tree, path).includes("Shot 0"),
      );
      assert.ok(page);
      const html = read(tree, page);
      assert.equal((html.match(/<tr>/g) ?? []).length, 100 + 0);
      assert.match(readPage(html).said, /first 100 of 130 rows/);
      assert.ok(readPage(html, page).hrefs.includes("alex-rivera/answers.json"));
    });
  });

  describe("given no pod of Alex Rivera", () => {
    it("builds each page and says the pod is not in this build", async () => {
      const files = await vocabulary();
      const tree = await queriesSection.build({
        ...contextOf(files, alex()),
        examples: async () => [],
      } as unknown as PagesContext);
      assert.equal(tree.size, 6);
      assert.match(
        readPage(read(tree, "queries/views/vaccines.html")).said,
        /not built here/i,
      );
    });
  });

  describe("given the vocabulary beside this checkout", () => {
    let paths: string[];
    let tree: ReadonlyMap<string, Uint8Array>;

    before(async () => {
      const { files } = await localVocabulary(ROOT);
      paths = (await files.list("queries")).filter((path) =>
        path.endsWith(".rq"),
      );
      tree = await build(files, alex());
    });

    it("has exactly one page for each .rq under queries/, and no other page but the index", () => {
      assert.ok(paths.length > 100, `${paths.length} queries`);
      const sources = new Map<string, number>();
      for (const [path, bytes] of tree) {
        if (path === "queries/index.html") continue;
        const link = readPage(new TextDecoder().decode(bytes), path).hrefs.at(-1);
        const source = decodeURI(link ?? "").replace(/^.*\/blob\/[^/]+\//, "");
        sources.set(source, (sources.get(source) ?? 0) + 1);
      }
      assert.deepEqual(
        [...sources.keys()].sort(),
        [...paths].sort(),
        "a page for each query",
      );
      assert.ok([...sources.values()].every((count) => count === 1));
    });

    it("shows every named question's and every view's page a rows table or the text for no rows", () => {
      const shown = [...tree].filter(([path]) =>
        /^queries\/(?:questions|views)\//.test(path),
      );
      assert.ok(shown.length >= 49, `${shown.length} pages`);
      for (const [path, bytes] of shown) {
        const html = new TextDecoder().decode(bytes);
        assert.ok(
          /<table[^>]*class="[^"]*rows/.test(html) ||
            /gives this (?:question|view) no rows|holds no entry/.test(html),
          `${path} shows no rows`,
        );
      }
    });

    it("links each index anchor the website links: questions, views, matcher, derivations, lenses and tables", () => {
      const { ids } = readPage(read(tree, "queries/index.html"));
      for (const id of [
        "questions",
        "views",
        "matcher",
        "derivations",
        "lenses",
        "tables",
      ])
        assert.ok(ids.has(id), `no #${id}`);
    });
  });

  describe("given the hub's sections", () => {
    it("lists the pages in search.json as kind `query`, and in index.json and llms.txt", async () => {
      const files = await vocabulary();
      const section = {
        ...queriesSection,
        build: (ctx: PagesContext) => queriesSection.build(ctx),
      };
      const ctx = contextOf(files, alex());
      const { tree } = await buildTree({
        sections: [section],
        ctx,
        front: () => new Map([["index.html", text("<html></html>")]]),
        finishers: FINISHERS,
      });
      const search = JSON.parse(read(tree, "search.json")) as {
        path: string;
        kind: string;
      }[];
      const kinds = search
        .filter(({ path }) => path.startsWith("queries/"))
        .map(({ path, kind }) => [path, kind]);
      assert.ok(kinds.length >= 6, "a row for each page");
      assert.ok(
        kinds.every(
          ([path, kind]) =>
            kind === (path === "queries/index.html" ? "page" : "query"),
        ),
      );
      assert.match(read(tree, "llms.txt"), /queries\//);
      assert.ok(read(tree, "index.json").includes('"queries/views/vaccines.html"'));
      assert.ok(typeof agentFiles === "function");
    });

    it("includes the section once, so the front page links `queries/` once", () => {
      assert.equal(
        SECTIONS.filter(({ path }) => path === "queries/index.html").length,
        1,
      );
    });
  });
});
