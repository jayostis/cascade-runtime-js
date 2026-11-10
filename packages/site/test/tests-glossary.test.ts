import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { glossaryOf, Links } from "../src/hub/glossary.js";
import {
  GLOSSARY,
  GROUPED,
  hrefsTo,
  pageWith,
  partOf,
  R,
  RUN,
  WITH_GLOSSARY,
} from "./tests-page.js";

/**
 * A package's `spec.json` defines the words its tests use in one sense. The page lists them once under the package and
 * links the first use of each in every capability, so a reader meets no word the page has not defined.
 */
describe("A package's glossary on its page · glossaryOf(), Links", () => {
  describe("with a `glossary` in the package's `spec.json`", () => {
    let part: string;

    before(async () => {
      const { markup } = await pageWith({
        runtime: { report: WITH_GLOSSARY, ...RUN },
      });
      part = partOf(markup, R);
    });

    it("lists the glossary under the `about` line, open", () => {
      assert.ok(
        part.indexOf("The library an app calls.") < part.indexOf("<dl"),
      );
      assert.match(part, /<details class="glossary" open>/);
    });

    it("anchors each definition by its package and its term", () => {
      for (const anchor of ["claim", "pod", "export"])
        assert.match(
          part,
          new RegExp(`<dt id="glossary-cascade-runtime-${anchor}"`),
        );
    });

    it("shows a term's aliases beside it", () => {
      assert.match(part, /claims, claimed/);
    });

    it("links a term to the term reference when it names a term of the vocabulary", () => {
      assert.ok(part.includes('href="../../../terms/#cascade:Claim"'));
    });

    it("links any other address as it is given", () => {
      assert.ok(part.includes('href="https://example.org/vocab#Export"'));
    });

    it("follows each term with its definition, one for one", () => {
      const dl = /<dl>([\s\S]*?)<\/dl>/.exec(part)?.[1] ?? "";
      const terms = dl.match(/<dt /g)?.length ?? 0;
      assert.equal(terms, GLOSSARY.length);
      assert.equal(dl.match(/<dd>[\s\S]*?<\/dd>/g)?.length, terms);
      assert.match(dl, /^\s*<dt [^>]*>[\s\S]*?<\/dt>\s*<dd>/);
    });

    it('holds a filter and a "none match" line, hidden until script runs', () => {
      assert.match(
        part,
        /<input type="search" class="glossary-filter" data-glossary-filter hidden [^>]*aria-label="[^"]+">/,
      );
      assert.match(part, /<p class="none-match" hidden>/);
    });
  });

  describe("with a term used in a capability", () => {
    let part: string;
    let importing: string;
    let asking: string;

    before(async () => {
      const { markup } = await pageWith({
        runtime: { report: WITH_GLOSSARY, ...RUN },
      });
      part = partOf(markup, R);
      importing = part.slice(
        part.indexOf(">Importing"),
        part.indexOf(">Asking<"),
      );
      asking = part.slice(part.indexOf(">Asking<"));
    });

    /** The capability "Importing" with its description changed so that its first use of "claim" is a level's name and a leaf's. */
    const withNamesFirst = async (): Promise<string> =>
      partOf(
        (
          await pageWith({
            runtime: {
              report: WITH_GLOSSARY.replace(
                /"A claim is kept[^"]*"/,
                '"Reads."',
              ).replace("holds claims", "holds records"),
              ...RUN,
            },
          })
        ).markup,
        R,
      );

    it("links only the first use in a capability to its definition", () => {
      assert.equal(hrefsTo(importing, "claim"), 1);
      assert.equal(hrefsTo(importing, "pod"), 1);
      assert.match(
        importing,
        /<a href="#glossary-cascade-runtime-claim">claim<\/a> is kept in the <a href="#glossary-cascade-runtime-pod">pod<\/a>\./,
      );
      assert.match(importing, /Claims stay/, "a later use is plain text");
    });

    it("links an alias as it is written", async () => {
      assert.match(
        await withNamesFirst(),
        /<a href="#glossary-cascade-runtime-claim">claimed<\/a>/,
      );
    });

    it("leaves a term inside a code span or a longer word alone", () => {
      assert.doesNotMatch(importing, /`claim`<\/a>|>claim<\/a>`/);
      assert.doesNotMatch(importing, /dis<a|>disclaimed/);
    });

    it("links the first use again in the next capability", () => {
      assert.equal(hrefsTo(asking, "claim"), 1);
      assert.equal(hrefsTo(asking, "export"), 1, "a leaf name links");
    });

    it("links a use in a level's name and in a leaf's name, the leaf keeping its link to the source", async () => {
      const names = await withNamesFirst();
      assert.match(
        names,
        /<summary><span class="level-name">when the <a href="#glossary-cascade-runtime-pod">Pod<\/a> holds records/,
      );
      assert.match(
        names,
        /<a href="[^"]*pod\.test\.ts#L12">keeps what was <\/a><a href="#glossary-cascade-runtime-claim">claimed<\/a>/,
      );
    });

    it("puts no link inside a link", () => {
      assert.doesNotMatch(part, /<a [^>]*>[^<]*<a /);
    });
  });

  describe("Links.pieces(text)", () => {
    const entries = glossaryOf(
      [
        {
          term: "Same",
          definition: "A judgment that two records are one thing.",
        },
        {
          term: "claim",
          definition: "The owner's say-so.",
          aliases: ["claims"],
        },
      ],
      "cascade-runtime",
    );
    /** The pieces of `text` that link, from a `Links` that has linked nothing yet. */
    const linked = (text: string) =>
      new Links(entries)
        .pieces(text)
        .filter((piece) => typeof piece !== "string");

    it("links a term defined with a capital only where the text writes the capital", () => {
      assert.deepEqual(linked("the same record, and the different one"), []);
      assert.deepEqual(linked("files a Same over them"), [
        { text: "Same", id: "glossary-cascade-runtime-same" },
      ]);
    });

    it("links a lower-case term where it begins a sentence", () => {
      assert.deepEqual(linked("Claims are kept"), [
        { text: "Claims", id: "glossary-cascade-runtime-claim" },
      ]);
    });
  });

  describe("with no `glossary`", () => {
    it("shows none", async () => {
      const { markup } = await pageWith({
        runtime: { report: GROUPED, ...RUN },
      });
      assert.doesNotMatch(markup, /class="glossary"/);
    });
  });
});
