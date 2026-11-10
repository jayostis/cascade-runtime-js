import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { MemoryFiles } from "@cascade-runtime/runtime";
import {
  BLOB,
  hubWith,
  oddVocabulary,
  text,
  TREE,
  treeText,
} from "./kim-vocabulary.js";
import { readPage } from "./page.js";

const CURRENCY_NOTE = `# Which revision is current

Status: draft. Names are in [the naming note](naming.md); the lead is in [a query](../queries/current.rq) and [a folder](../queries/).

## Choice

| thing | prior art | what we do | borrowed or diverged |
|---|---|---|---|
| current | git | derived by the ladder (\`runtime/currency.feature\`, C2) | ours |
| heads | git | named as heads (\`runtime/currency.feature\`, C3) | ours |
| view | | materialised, \`queries/view.rq\` | ours |
| \`View\` | | said again | ours |
| a \\| b | | escaped | ours |

## Why

**Why current is derived.** (row "current") Because [the naming note](naming.md) says a name is not a rank, and [the lead](#why) is.

## Still open

- Nothing, though <script>alert(1)</script> is not run.
`;

/** Made-up rules, so that a change to the vocabulary's own does not move this fixture. One has no number, and the last names a note that is gone. */
const CURRENCY_FEATURE = `Feature: Currency
  Rule: C2. Current is derived
    decisions/currency.md, row "current". The ladder picks it.

    Example: the only revision
      Given a new pod for Kim on 2026-09-01 at 09:55

  Rule: C3. Heads are named
    decisions/currency.md, row "heads". A revision names them.

  Rule: C4. A sync unions heads
    decisions/currency.md, row "heads". A union.

  Rule: A rule with no number
    decisions/currency.md, row "a | b". Cited, and linked without an anchor.

  Rule: C5. A note that is gone
    decisions/gone.md, row "x". Nothing to link but the path.
`;

/** A vocabulary with a README of decision notes, a note with a Choice table, a note with none, and the feature that cites the first. */
async function currencyVocabulary(): Promise<MemoryFiles> {
  const files = new MemoryFiles(TREE);
  await files.write(
    "decisions/README.md",
    text(
      "# Decision notes\n\nOne note per question.\n\n## The sections\n\nA note has these.\n\n## The bar\n\nAdopt the standard.\n\n## The notes\n\n- [`currency.md`](currency.md): which revision.\n- [issue](https://github.com/jayostis/cascade-vocabulary/issues/130)\n",
    ),
  );
  await files.write("decisions/currency.md", text(CURRENCY_NOTE));
  await files.write(
    "decisions/naming.md",
    text("# How things are named\n\n## Choice\n"),
  );
  await files.write("runtime/currency.feature", text(CURRENCY_FEATURE));
  await files.write("queries/view.rq", text(""));
  return files;
}

/**
 * The vocabulary records each design question as a decision note. The site writes each as a page, so that a rule links
 * the Choice row that ruled it and the Choice row lists the rules that cite it.
 */
describe("Decision notes as pages · specSection", () => {
  let tree: ReadonlyMap<string, Uint8Array>;
  let rule: ReturnType<typeof readPage>;
  let html: string;
  let note: ReturnType<typeof readPage>;

  /** The Choice row of the note's page with this id, as far as its end. */
  const row = (id: string) =>
    readPage(
      html.slice(
        html.indexOf(`id="${id}"`),
        html.indexOf("</tr>", html.indexOf(`id="${id}"`)),
      ),
    );
  const specLinks = (id: string) =>
    row(id).hrefs.filter((href) => href.startsWith("../spec/"));

  before(async () => {
    tree = await hubWith(await currencyVocabulary(), []);
    rule = readPage(treeText(tree, "spec/currency.html"));
    html = treeText(tree, "decisions/currency.html");
    note = readPage(html);
  });

  describe("with a decision note", () => {
    it("writes a page for each note, and an index of them", () => {
      for (const path of [
        "decisions/index.html",
        "decisions/currency.html",
        "decisions/naming.html",
      ])
        assert.ok(tree.has(path), path);
    });

    it("links, from a rule, the note's page at the Choice row the rule names, and at its Why", () => {
      assert.ok(rule.hrefs.includes("../decisions/currency.html#row-current"));
      assert.ok(rule.hrefs.includes("../decisions/currency.html#row-heads"));
      assert.ok(rule.hrefs.includes("../decisions/currency.html#why"));
      assert.ok(rule.hrefs.includes("../decisions/currency.html"));
      assert.ok(
        !rule.hrefs.some((href) => href.endsWith("decisions/currency.md")),
      );
    });

    it("links, from a rule's quoted paragraph, another note as its page", () => {
      assert.ok(rule.hrefs.includes("../decisions/naming.html"));
    });

    it("gives each heading of the note an id", () => {
      assert.equal(note.h1, "Which revision is current");
      for (const id of ["why", "choice", "still-open"])
        assert.ok(note.ids.has(id), id);
    });

    it("links the note's own file on GitHub", () => {
      assert.ok(note.hrefs.includes(`${BLOB}decisions/currency.md`));
    });

    it("sends the note's links to other notes to their pages, and to other files to GitHub", () => {
      assert.ok(note.hrefs.includes("naming.html"));
      assert.ok(note.hrefs.includes("#why"));
      assert.ok(note.hrefs.includes(`${BLOB}queries/current.rq`));
      assert.ok(note.hrefs.includes(`${TREE}queries/`));
    });

    it("shows raw HTML in a note as text", () => {
      assert.doesNotMatch(html, /<script/);
      assert.ok(html.includes("&lt;script&gt;"));
    });
  });

  describe("with a Choice row", () => {
    it("lists the rules that cite it, in the feature's order", () => {
      assert.deepEqual(specLinks("row-current"), ["../spec/currency.html#c2"]);
      assert.deepEqual(specLinks("row-heads"), [
        "../spec/currency.html#c3",
        "../spec/currency.html#c4",
      ]);
    });

    it("says when no rule cites it", () => {
      assert.match(row("row-view").said, /No rule cites this row/);
      assert.deepEqual(specLinks("row-view"), []);
    });

    it("gives two Choice rows of one name two anchors", () => {
      assert.ok(note.ids.has("row-view"));
      assert.ok(note.ids.has("row-view-2"));
      assert.match(row("row-view-2").said, /No rule cites this row/);
    });

    it("keeps an escaped pipe in its name", () => {
      assert.match(row("row-a-b").said, /a \| b escaped ours/);
    });

    it("links a rule that has no number by its page alone", () => {
      assert.deepEqual(specLinks("row-a-b"), ["../spec/currency.html"]);
    });
  });

  describe("with a rule that names a note the vocabulary lacks", () => {
    it("links the note's path on GitHub", () => {
      assert.ok(rule.hrefs.includes(`${BLOB}decisions/gone.md`));
    });
  });

  describe("with `decisions/index.html`", () => {
    let indexHtml: string;
    let index: ReturnType<typeof readPage>;

    before(() => {
      indexHtml = treeText(tree, "decisions/index.html");
      index = readPage(indexHtml);
    });

    it("lists every note, and each Choice row no rule cites", () => {
      assert.equal(index.h1, "Decision notes");
      assert.ok(index.hrefs.includes("currency.html"));
      assert.ok(index.hrefs.includes("naming.html"));
      assert.ok(index.hrefs.includes("currency.html#row-view"));
      assert.ok(!index.hrefs.includes("currency.html#row-heads"));
    });

    it("links the README it is written from, on GitHub", () => {
      assert.ok(index.hrefs.includes(`${BLOB}decisions/README.md`));
    });

    it("puts the list of notes and the table of every note before the format of a note", () => {
      const at = (id: string) => indexHtml.indexOf(`id="${id}"`);
      assert.ok(at("the-notes") > 0);
      assert.ok(at("the-notes") < at("every-note"));
      assert.ok(at("every-note") < at("the-sections"));
      assert.ok(at("the-sections") < at("the-bar"));
    });

    it("is linked from the front page", () => {
      assert.ok(
        readPage(treeText(tree, "index.html")).hrefs.includes("decisions/"),
      );
    });
  });

  describe("with a note whose table Markdown renders otherwise than the site reads it", () => {
    let odd: ReadonlyMap<string, Uint8Array>;
    let index: ReturnType<typeof readPage>;
    let oddRule: ReturnType<typeof readPage>;
    let oddHtml: string;

    before(async () => {
      odd = await hubWith(await oddVocabulary(), []);
      index = readPage(treeText(odd, "spec/index.html"));
      oddRule = readPage(treeText(odd, "spec/odd.html"));
      oddHtml = treeText(odd, "decisions/odd.html");
    });

    it("gives no anchor to a Choice row the rendered table lacks, and links its rule to the note alone", () => {
      assert.ok(!oddHtml.includes('id="row-y"'));
      assert.ok(!oddRule.hrefs.includes("../decisions/odd.html#row-y"));
      assert.ok(oddRule.hrefs.includes("../decisions/odd.html"));
    });

    it("keeps one anchor for a Choice row that a heading is also named for", () => {
      assert.equal(oddHtml.match(/id="row-x"/g)?.length, 1);
      assert.ok(oddRule.hrefs.includes("../decisions/odd.html#row-x"));
    });

    it("anchors a Choice row whose name is a code span with an escaped pipe", () => {
      assert.ok(oddRule.hrefs.includes("../decisions/odd.html#row-a-b"));
      assert.match(oddHtml, /id="row-a-b"[^]*?\.\.\/spec\/odd\.html#n3/);
    });

    it("takes an earlier table of the note for no Choice table", () => {
      const row = oddHtml.slice(oddHtml.indexOf('id="row-x"'));
      assert.match(row.slice(0, row.indexOf("</tr>")), /first/);
    });

    it("keeps a link to a note that is gone on GitHub, and one to a note that exists as its page", () => {
      const note = readPage(oddHtml);
      assert.ok(note.hrefs.includes(`${BLOB}decisions/gone.md`));
      assert.ok(note.hrefs.includes("currency.html"));
    });

    it("lists the note and its waiting Choice row on the specification's index, linking no note on GitHub", () => {
      assert.ok(index.hrefs.includes("../decisions/odd.html"));
      assert.ok(index.hrefs.includes("../decisions/odd.html#row-z"));
      assert.ok(
        !index.hrefs.some((href) => href.startsWith(`${BLOB}decisions/`)),
      );
    });
  });
});
