import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { MemoryFiles } from "@cascade-runtime/runtime";
import { chromium, type Browser, type Page } from "playwright";
import { PLAIN } from "../src/html.js";
import { type Served, servePages } from "../src/node/serve.js";
import { STYLESHEET } from "../src/stylesheet.js";
import {
  TERMS_PAGE,
  TERMS_SHAPES_PAGE,
  termReference,
  termShapes,
} from "../src/term-reference.js";

const TREE = "https://github.com/the-cascade-protocol/cascade-vocabulary/tree/abc123/";
const text = (value: string) => new TextEncoder().encode(value);

/** `count` properties said of one class each, so the index has `count` folded groups of one, and a long page. */
const ontology = (count: number): string =>
  `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

<https://ns.cascadeprotocol.org/cascade#> a owl:Ontology .
${Array.from(
  { length: count },
  (_, at) =>
    `cascade:Kind${at} a owl:Class .\ncascade:said${at} a owl:DatatypeProperty ; rdfs:domain cascade:Kind${at} .\n`,
).join("")}cascade:sharedA a owl:DatatypeProperty ; rdfs:domain cascade:Kind0 .
`;

const SHAPES = `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

cascade:Kind0Shape a sh:NodeShape ;
    sh:targetClass cascade:Kind0 ;
    sh:property [ sh:path cascade:said0 ; sh:node cascade:LooseShape ] .

cascade:LooseShape a sh:NodeShape ;
    sh:nodeKind sh:IRI .
`;

const WINDOW = { width: 1280, height: 600 };

/** Whether the element with the id is closed inside, in the first `<details>` round it. */
const folded = (tab: Page, id: string): Promise<boolean | null> =>
  tab.evaluate((wanted) => {
    const found = document.getElementById(wanted)?.closest("details");
    return found === null || found === undefined ? null : !found.open;
  }, id);

/** Waits for the group round the element to be open: the page's script runs on the address changing, after it. */
const opens = (tab: Page, id: string): Promise<unknown> =>
  tab.waitForFunction(
    (wanted) =>
      document.getElementById(wanted)?.closest("details")?.open === true,
    id,
  );

/** Whether the element comes inside the window within a few seconds, a pixel's rounding aside: the browser's own scroll to an address lands after the page loads, at a fraction of a pixel. */
const visible = async (tab: Page, id: string): Promise<boolean> => {
  try {
    await tab.waitForFunction(
      (wanted) => {
        const box = document.getElementById(wanted)?.getBoundingClientRect();
        return (
          box !== undefined &&
          box.height > 0 &&
          box.top >= -1 &&
          box.bottom <= window.innerHeight + 1
        );
      },
      id,
      { timeout: 3000 },
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * The index's own script runs in Chromium over a built term reference: a link to a name inside a folded group opens the
 * group and scrolls to it, one to a shape's old anchor lands on the shapes' page, and one to nothing does nothing.
 */
describe("The term reference · termReference(), termsSection", () => {
  let folder: string;
  let served: Served;
  let browser: Browser;
  let tab: Page;
  const errors: string[] = [];

  before(async () => {
    const files = new MemoryFiles(TREE);
    await files.write("ontologies/cascade.ttl", text(ontology(30)));
    await files.write("ontologies/cascade.shapes.ttl", text(SHAPES));
    await files.write("runtime/pod-layout.ttl", text("\n"));
    folder = mkdtempSync(join(tmpdir(), "terms-"));
    const pages: [string, string][] = [
      [TERMS_PAGE, await termReference(files, PLAIN)],
      [TERMS_SHAPES_PAGE, await termShapes(files, PLAIN)],
      ["site.css", STYLESHEET],
    ];
    for (const [path, body] of pages) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), body);
    }
    served = await servePages(folder);
    browser = await chromium.launch();
    tab = await browser.newPage({ viewport: WINDOW });
    tab.on("pageerror", (error) => errors.push(error.message));
  });

  after(async () => {
    await browser?.close();
    await served?.close();
    if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
  });

  const opened = async (address: string): Promise<void> => {
    await tab.goto(`${served.url}terms/${address}`);
  };

  describe("when the index is opened with no address", () => {
    it("holds every group closed", async () => {
      await opened("index.html");
      assert.equal(
        await tab.evaluate(
          () => document.querySelectorAll("details.group[open]").length,
        ),
        0,
      );
      assert.equal(await folded(tab, "cascade:said0"), true);
    });
  });

  describe("when the address names a term inside a folded group", () => {
    it("opens the group and brings the term into the window, at the first group and at the last", async () => {
      for (const id of ["cascade:said0", "cascade:said29"]) {
        await opened(`index.html#${id}`);
        assert.equal(await folded(tab, id), false, `${id} is folded`);
        assert.equal(await visible(tab, id), true, `${id} is out of view`);
      }
    });

    it("opens a group the reader's own link inside the page names, and leaves the one opened before it open", async () => {
      await opened("index.html#cascade:said3");
      await tab.evaluate(() => {
        location.hash = "cascade:said7";
      });
      await opens(tab, "cascade:said7");
      assert.equal(await folded(tab, "cascade:said7"), false);
      assert.equal(await visible(tab, "cascade:said7"), true);
      assert.equal(await folded(tab, "cascade:said3"), false);
    });

    it("scrolls back to the top, with the group still open, when the reader goes back", async () => {
      await opened("index.html");
      await tab.evaluate(() => {
        location.hash = "cascade:said12";
      });
      await opens(tab, "cascade:said12");
      await tab.goBack();
      await tab.waitForFunction(() => window.scrollY === 0);
      assert.equal(await folded(tab, "cascade:said12"), false);
    });

    it("opens the one group of a single term", async () => {
      await opened("index.html#cascade:said29");
      assert.equal(
        await tab.evaluate(
          () =>
            document
              .getElementById("cascade:said29")
              ?.closest("details")
              ?.querySelectorAll("a[id]").length,
        ),
        1,
      );
    });
  });

  describe("when the address names a shape's old anchor", () => {
    it("goes to the shapes' page, at the shape", async () => {
      await opened("index.html#cascade:LooseShape");
      await tab.waitForURL(/terms\/shapes\/index\.html#cascade:LooseShape$/);
      assert.equal(await visible(tab, "cascade:LooseShape"), true);
    });

    it("goes to the shapes' page for `#shapes`", async () => {
      await opened("index.html#shapes");
      await tab.waitForURL(/terms\/shapes\/index\.html#shapes$/);
    });

    it("stays on the index for the old anchor of a shape that is at home on a term's row", async () => {
      await opened("index.html#cascade:Kind0Shape");
      assert.match(tab.url(), /terms\/index\.html#cascade:Kind0Shape$/);
      assert.equal(await folded(tab, "cascade:Kind0Shape"), null);
    });
  });

  describe("when the address names nothing on the page", () => {
    it("stays where it is, with no group opened and no script error", async () => {
      await opened("index.html#cascade:nothing-here");
      assert.match(tab.url(), /terms\/index\.html#cascade:nothing-here$/);
      assert.equal(
        await tab.evaluate(
          () => document.querySelectorAll("details.group[open]").length,
        ),
        0,
      );
      await opened("index.html#%E0%A4%A");
      assert.deepEqual(errors, []);
    });
  });
});
