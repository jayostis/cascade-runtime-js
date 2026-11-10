import assert from "node:assert/strict";
import { dirname } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  iri,
  literal,
  MemoryFiles,
  OxigraphStore,
  questions,
  tableTerms,
  written,
} from "@cascade-runtime/runtime";
import {
  featurePod,
  findRoot,
  type LocalVocabulary,
  localVocabulary,
} from "@cascade-runtime/runtime/node";
import { termHref, termId } from "../src/links.js";
import { Site, type SiteOptions, viewRules } from "../src/site.js";
import { namedInQuery } from "../src/term-reference.js";
import { type Page, readPage } from "./page.js";

const FEATURE = "runtime/matcher.feature";
const EXAMPLE =
  "the matcher joins the pair a person called different, and not the pair a person called the same";
const THROUGH = "entry";
const MERGED_FROM = "https://ns.cascadeprotocol.org/cascade#mergedFrom";
const RECORD = "https://ns.cascadeprotocol.org/cascade#Record";
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const BLOB = "https://github.com/jayostis/cascade-vocabulary/blob/0123abc/";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));

/** Each page of a site, its local links read as paths from the site's root. */
function readPages(built: ReadonlyMap<string, Uint8Array>): Map<string, Page> {
  return new Map(
    [...built]
      .filter(([path]) => path.endsWith(".html"))
      .map(([path, bytes]) => [
        path,
        readPage(new TextDecoder().decode(bytes), path),
      ]),
  );
}

let vocabulary: LocalVocabulary;
let options: SiteOptions;
let site: Site;
let files: Map<string, Uint8Array>;
let pages: Map<string, Page>;

/**
 * The pod is built from the matcher's example in which two records a person called different are joined and two called the
 * same are not. It leaves a joined view entry (for the entry's page and the view's rows), a record no view shows (for the
 * page of what is not shown) and things that share a name (for the page that lists them). If a change to that example takes
 * one of these away, the tests that need it fail on a guard before they assert anything else.
 */
before(async () => {
  vocabulary = await localVocabulary(ROOT);
  const pod = new MemoryFiles("https://pod.example/");
  await featurePod(vocabulary, FEATURE, pod, {
    example: EXAMPLE,
    through: THROUGH,
  });
  options = {
    vocabulary: vocabulary.files,
    layout: vocabulary.layout,
    build: vocabulary.build,
    pod,
    lens: vocabulary.config.lens,
    defaultLens: vocabulary.config.lens,
    newStore: () => new OxigraphStore(),
    name: "matching",
    at: "2026-03-03T08:00:00Z",
    ask: "npm run ask -- matching",
    blob: BLOB,
    terms: "../terms/",
    spec: "../spec/",
  };
  site = await Site.build(options);
  files = await site.files();
  pages = readPages(files);
});

const page = (path: string | undefined): Page => {
  const found = pages.get(path ?? "");
  assert.ok(found, `the site has no page ${path}`);
  return found;
};

const blockOf = (on: Page, title: string) => {
  const found = on.blocks.find((block) => block.title === title);
  assert.ok(found, `${on.h1} has no block ${title}`);
  return found;
};

/**
 * A pod's site shows what one pod holds, for a person learning the format: a home page, a page for each view, view entry
 * and record, and every named question of the vocabulary with its query and its answer. It is built from the pod alone,
 * so each page is what the runtime reads, not a drawing of it.
 */
describe("The pages of a pod · Site.build(), Site.files()", () => {
  describe("given a pod in which the matcher joined two records", () => {
    it("shows every named question of the vocabulary with its query's text", async () => {
      const shown = new Map(
        [...pages.values()].flatMap(({ blocks }) =>
          blocks.map((block) => [block.path, block.text] as const),
        ),
      );
      for (const { path, text } of (await questions(vocabulary.files)).values())
        assert.equal(shown.get(path), text, path);
    });
  });

  describe("`index.html`", () => {
    it("shows each folder of the pod that holds a record", () => {
      const folders = blockOf(
        page("index.html"),
        "What each folder holds",
      ).rows.map((row) => row.get("folder")?.value);
      const filed = vocabulary.layout.recordPlacements.filter(({ folder }) =>
        site.pod.files.some((path) => path.startsWith(folder ?? "")),
      );
      assert.ok(filed.length > 0);
      for (const { folder } of filed)
        assert.ok(folders.includes(written(literal(`/${folder}`))), folder);
    });

    it("shows which view lists each kind of record, with every view of the pod", () => {
      assert.deepEqual(
        new Set(
          blockOf(page("index.html"), "Which view lists each kind").rows.map(
            (row) => row.get("view")?.value,
          ),
        ),
        new Set(site.views.map((view) => written(view))),
      );
    });
  });

  describe("with a view's page", () => {
    it("links the view's file in the site's copy of the pod", () => {
      for (const view of site.views) {
        const path = view.value.slice(site.pod.address.length);
        assert.ok(page(site.page(view)).hrefs.includes(`pod/${path}`), path);
      }
    });

    it("lists the view entries its question returns, column for column", async () => {
      const [view] = site.views.filter((view) =>
        (
          site.pod.built.get(view.value.slice(site.pod.address.length)) ?? []
        ).some(([, predicate]) => predicate.value === MERGED_FROM),
      );
      assert.ok(view, "no view lists an entry");
      const shows = blockOf(page(site.page(view)), "What it shows");
      const query = (await questions(vocabulary.files)).get(
        "entry/What it shows",
      );
      const { rows } = await site.pod.store.select(query?.text ?? "");
      const shown = site.question("entry/What it shows").of("view", view).shown;
      const expected = rows
        .filter((row) => row.get("view")?.value === view.value)
        .map((row) =>
          [...row]
            .filter(([column]) => shown.includes(column))
            .map(([column, term]) => `${column}=${written(term)}`)
            .sort(),
        );
      const found = shows.rows.map((row) =>
        [...row].map(([column, cell]) => `${column}=${cell.value}`).sort(),
      );
      assert.ok(found.length > 0);
      assert.deepEqual(found, expected);
    });
  });

  describe("with a view entry's page", () => {
    it("links the page of each record the view entry joins", () => {
      const joined = [...site.pod.built.values()]
        .flat()
        .filter(([, predicate]) => predicate.value === MERGED_FROM);
      assert.ok(joined.length > 0);
      for (const [entry, , record] of joined)
        assert.ok(
          page(site.page(entry)).hrefs.includes(site.page(record) ?? ""),
          `${entry.value} ${record.value}`,
        );
    });
  });

  describe("with the page of anything the pod holds", () => {
    it("lists the files of the pod that state it, each linked to its copy in the site", () => {
      const things = [...site.things.values()].flat();
      assert.ok(things.length > 0);
      for (const thing of things) {
        const stated = blockOf(
          page(site.page(thing)),
          "Which file states each thing",
        );
        assert.ok(stated.rows.length > 0, thing.value);
        for (const row of stated.rows) {
          const [href] = row.get("file")?.hrefs ?? [];
          assert.ok(href?.startsWith("pod/") && files.has(href), thing.value);
        }
      }
    });
  });

  describe("`pipeline.html`", () => {
    let pipeline: Page;
    const queryOf = ({ path }: { path: string }) =>
      path.slice(path.lastIndexOf("/") + 1, -3);
    const cellsOf = (blocks: Page["blocks"]) =>
      blocks.flatMap(({ rows }) => rows.flatMap((row) => [...row.values()]));

    before(() => {
      pipeline = page("pipeline.html");
    });

    it("shows each query of the lens in the order it ran", () => {
      const queries = site.pod.derived.map(queryOf);
      const ids = pipeline.blocks.flatMap(({ id }) => id ?? []);
      assert.deepEqual(
        ids.filter((id) => queries.includes(id)),
        queries,
      );
    });

    it("shows each other lens beside it", () => {
      const others = [...site.pipeline.keys()].filter(
        (lens) => lens !== vocabulary.config.lens,
      );
      assert.ok(others.length > 0);
      for (const lens of others) assert.ok(pipeline.ids.has(lens), lens);
    });

    it("links a class, wherever a page shows it, to the query that first wrote it", () => {
      const writesRecord = site.pod.derived.find(({ added }) =>
        added.some(
          ([, predicate, value]) =>
            predicate.value === TYPE && value.value === RECORD,
        ),
      );
      assert.ok(writesRecord);
      const linksOf = (term: string): string[] =>
        cellsOf(pipeline.blocks)
          .filter(({ value }) => value === written(iri(term)))
          .flatMap(({ hrefs }) => hrefs);
      assert.ok(
        linksOf(RECORD).includes(`pipeline.html#${queryOf(writesRecord)}`),
      );
      assert.ok(
        !linksOf(TYPE).some((href) => href.startsWith("pipeline.html")),
      );
    });

    it("links no page from an answer under another lens", () => {
      const otherLens = pipeline.blocks.filter(({ said }) =>
        said.includes("--lens"),
      );
      assert.ok(otherLens.length > 0);
      assert.ok(
        !cellsOf(otherLens).some(({ hrefs }) =>
          hrefs.some((href) => href.endsWith(".html")),
        ),
      );
    });
  });

  describe("`not-shown.html`", () => {
    let hidden: ReturnType<typeof blockOf>;

    before(() => {
      hidden = blockOf(page("not-shown.html"), "Why it is in no view");
      assert.ok(hidden.rows.length > 0);
    });

    it("lists each record no view shows, with why", () => {
      for (const row of hidden.rows) assert.ok(row.get("why")?.value);
    });

    it("links each such record to its page", () => {
      for (const row of hidden.rows)
        assert.ok(
          row.get("record")?.hrefs.some((href) => pages.has(href)),
          row.get("record")?.value,
        );
    });
  });

  describe("with a lens other than the default", () => {
    let run: Page["blocks"];
    let other: string;
    let fallback: string;

    before(async () => {
      fallback = vocabulary.config.lens;
      const found = [...site.pipeline.keys()].find((lens) => lens !== fallback);
      assert.ok(found);
      other = found;
      const built = await (
        await Site.build({ ...options, lens: other, defaultLens: fallback })
      ).files();
      run = readPage(
        new TextDecoder().decode(built.get("index.html")),
      ).blocks.filter(({ said }) => said.includes("Run it yourself"));
      assert.ok(run.length > 0);
    });

    it("names that lens in every command a page prints", () => {
      for (const { title, said } of run)
        assert.ok(said.includes(`--lens ${other}`), title);
    });

    it("says the pod's own view files are written under the default lens only", () => {
      for (const { title, said } of run)
        assert.ok(said.includes(`under the ${fallback} lens only`), title);
    });
  });

  describe("with the default lens", () => {
    it("names no lens in a command", () => {
      for (const { title, said } of page("index.html").blocks)
        assert.ok(!said.includes("--lens"), title);
    });
  });
});

/**
 * From an answer a reader can reach the query that gave it, each rule that governs it and each vocabulary term it
 * names; this holds every link of a pod's site to an address that exists.
 */
describe("Where a pod's pages link · Site.files(), Site.page(), viewRules()", () => {
  describe("`Site.files()`", () => {
    it("resolves every local link to a file it wrote, and every anchor to an id on that page", () => {
      const broken: string[] = [];
      for (const [path, { hrefs }] of pages)
        for (const href of hrefs) {
          if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("../"))
            continue;
          const [file = "", anchor] = href.split("#");
          const target = file === "" ? path : file;
          if (
            !files.has(target) ||
            (anchor !== undefined && !pages.get(target)?.ids.has(anchor))
          )
            broken.push(`${path} -> ${href}`);
        }
      assert.deepEqual(broken, []);
    });

    it("links out of its own folder only to the term reference and the specification", () => {
      const out = ["../terms/#", "../spec/"];
      const outside: string[] = [];
      for (const [path, { hrefs }] of pages)
        for (const href of hrefs)
          if (
            href.startsWith("../") &&
            !out.some((folder) => href.startsWith(folder))
          )
            outside.push(`${path} -> ${href}`);
      assert.deepEqual(outside, []);
    });

    it("links no address on `ns.cascadeprotocol.org` and no code's own IRI", () => {
      const hrefs = [...pages.values()].flatMap((one) => one.hrefs);
      const spaces = site.codeSystems.map(({ uriSpace }) => uriSpace);
      assert.deepEqual(
        hrefs.filter(
          (href) =>
            /^https?:\/\/ns\.cascadeprotocol\.org(?:[:/?#]|$)/i.test(href) ||
            spaces.some((space) => href.startsWith(space)),
        ),
        [],
      );
      assert.ok(!site.labels.has("https://ns.cascadeprotocol.org/cascade#"));
    });

    it("names a vocabulary term in every link to the term reference", () => {
      const ids = new Set([...site.labels.keys()].map(termId));
      const terms = [...pages.values()]
        .flatMap((one) => one.hrefs)
        .filter((href) => href.startsWith("../terms/#"));
      assert.ok(terms.length > 0);
      for (const href of terms)
        assert.ok(
          ids.has(decodeURIComponent(href.slice("../terms/#".length))),
          href,
        );
    });

    it("links each query's file on GitHub at the commit built", () => {
      const blocks = [...pages].flatMap(([path, { blocks }]) =>
        blocks.map((block) => [path, block] as const),
      );
      assert.ok(blocks.length > 0);
      for (const [path, { title, path: query, hrefs }] of blocks)
        assert.ok(
          hrefs.some(
            (href) =>
              !/\s/.test(href) && decodeURIComponent(href) === BLOB + query,
          ),
          `${path}: ${title}`,
        );
    });

    it("links, from a named question, each vocabulary term its query names", () => {
      const used = page("views/allergies.html").blocks.flatMap(({ hrefs }) =>
        hrefs.filter((href) => href.startsWith("../terms/#")),
      );
      assert.ok(
        used.length > 0,
        "no question block links a term its query names",
      );
      const block = site.question("pod/Which view lists each kind");
      const [first] = [...namedInQuery(block.query.text)].filter((one) =>
        site.labels.has(one),
      );
      assert.ok(first);
      assert.ok(
        page("index.html").blocks.some(
          ({ path, hrefs }) =>
            path === block.query.path &&
            hrefs.includes(termHref(first, "../terms/")),
        ),
      );
    });

    it("links, from a view's page, each rule that names the view", () => {
      // Rule A15 of `runtime/arrivals.feature` names `clinical/allergies.ttl` today; if the feature renumbers, change this.
      assert.ok(
        page("views/allergies.html").hrefs.includes(
          "../spec/arrivals.html#a15",
        ),
      );
    });
  });

  describe("`Site.page()`", () => {
    it("names a view's page by its folder and its file: `views/allergies.html`", () => {
      const allergies = site.views.find(({ value }) =>
        value.endsWith("/allergies.ttl"),
      );
      assert.ok(allergies);
      assert.equal(site.page(allergies), "views/allergies.html");
      assert.equal(page("views/allergies.html").h1, "clinical/allergies.ttl");
    });

    it("gives every view and every other thing a page of its own that the site holds", () => {
      const things = [...site.views, ...[...site.things.values()].flat()];
      const addressed = things.map((thing) => site.page(thing) ?? "");
      assert.ok(addressed.every((path) => files.has(path)));
      assert.equal(
        new Set(addressed).size,
        new Set(things.map(({ value }) => value)).size,
      );
    });

    it("names no page by a bare digest", () => {
      assert.deepEqual(
        [...files.keys()].filter((path) =>
          /(^|\/)[0-9a-f]{64}\.html$/.test(path),
        ),
        [],
      );
    });
  });

  describe("with things that share a name", () => {
    it("lists them on a page at the plain address, each linked, saying how many there are", () => {
      const things = [...site.views, ...[...site.things.values()].flat()];
      const addressed = things.map((thing) => site.page(thing) ?? "");
      const shared = addressed.filter((path) => path.includes("--"));
      assert.ok(shared.length > 1);
      for (const path of shared) {
        const plain = path.replace(/--[0-9a-f]+\.html$/, ".html");
        assert.ok(!addressed.includes(plain), plain);
        const listing = pages.get(plain);
        assert.ok(listing, `no page ${plain} lists the things named alike`);
        assert.ok(
          listing.hrefs.includes(path),
          `${plain} does not list ${path}`,
        );
        assert.match(listing.said, /\d+ things are called this/);
      }
    });
  });

  describe("`viewRules()`", () => {
    let ruled: (end: string) => string[];

    before(async () => {
      const placed = vocabulary.layout.views.flatMap(({ file, writtenBy }) =>
        file === undefined || writtenBy === undefined
          ? []
          : [{ iri: file, names: [file, writtenBy] }],
      );
      const named = await viewRules(vocabulary.files, placed);
      ruled = (end) =>
        (
          named.get(
            placed.find(({ iri: one }) => one.endsWith(end))?.iri ?? "",
          ) ?? []
        ).map(({ path, number }) => `${path}#${number}`);
    });

    it("finds the rules whose text names a view's file or the query that writes it", () => {
      // Rule C9 names `clinical/conditions.ttl` today; if the feature renumbers, change this.
      assert.ok(ruled("conditions.ttl").some((rule) => rule.endsWith("#C9")));
    });

    it("finds none for a view no rule names", () => {
      assert.deepEqual(ruled("immunizations.ttl"), []);
    });
  });
});

describe("Text, times and codes as a page shows them · markup, shown(), code(), codePage()", () => {
  describe("`Site.codeSystems`", () => {
    it("holds the code systems the vocabulary's tables register", async () => {
      const { codeSystems } = await tableTerms(
        vocabulary.files,
        options.newStore,
      );
      assert.ok(codeSystems.length > 0);
      assert.deepEqual(site.codeSystems, codeSystems);
    });
  });
});
