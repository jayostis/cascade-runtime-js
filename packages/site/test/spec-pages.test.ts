import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { earl, MemoryFiles } from "@cascade-runtime/runtime";
import { PLAIN } from "../src/html.js";
import {
  filesNamed,
  readSpecReport,
  rulesNamedIn,
  type SpecPages,
  specPages,
} from "../src/spec.js";
import {
  ASSERTIONS,
  BLOB,
  FEATURE,
  hubWith,
  kimVocabulary,
  oddVocabulary,
  pagesOf,
  RAN_WITH,
  text,
  TREE,
  treeText,
} from "./kim-vocabulary.js";
import { readPage } from "./page.js";

/** The text of one page of `pages`. */
const pageText = (pages: SpecPages, path: string): string =>
  new TextDecoder().decode(pages.files.get(path));

/** Each example's result on a page, by its name. */
const results = (pages: SpecPages, path: string): Map<string, string> =>
  new Map(
    [
      ...pageText(pages, path).matchAll(
        /<details class="example ([\w-]+)">\n<summary><span[^>]*>[^<]*<\/span>([^<]*)<\/summary>/g,
      ),
    ].map(([, outcome, name]) => [
      (name ?? "").replaceAll("&#39;", "'"),
      outcome ?? "",
    ]),
  );

/** The warnings of `built` of one kind, as their text. */
const warned = (built: SpecPages, kind: string): string[] =>
  built.warnings.filter((one) => one.kind === kind).map(({ what }) => what);

/**
 * The specification is the vocabulary's features. `specPages()` writes a page for each feature and each kit: every
 * rule with the decision note that ruled it, and every example with its latest conformance result.
 */
describe("The specification's pages · specPages()", () => {
  let built: SpecPages;

  before(async () => {
    built = await pagesOf(await kimVocabulary(), ASSERTIONS, RAN_WITH);
  });

  describe("with a feature", () => {
    it("gives each rule an anchor from its number", () => {
      const { ids } = readPage(pageText(built, "naming.html"));
      assert.ok(ids.has("n1"));
      assert.ok(ids.has("n2"));
    });

    it("shows each example's latest result: passed, failed with why, or not run", () => {
      assert.deepEqual(
        results(built, "naming.html"),
        new Map([
          ["one content is one version", "passed"],
          ["a version the run did not reach", "not-run"],
          ["a revision's name", "failed"],
        ]),
      );
      assert.match(
        readPage(pageText(built, "naming.html")).said,
        /N2: the revision has no name/,
      );
    });
  });

  describe("with a rule that names its decision note and Choice row", () => {
    let page: ReturnType<typeof readPage>;

    before(() => {
      page = readPage(pageText(built, "naming.html"));
    });

    it("names the note and the Choice row that ruled it", () => {
      assert.match(page.said, /Ruled by How things are named , row version/);
    });

    it("quotes the Why paragraph that names the Choice row, and no other", () => {
      assert.match(
        page.said,
        /Why content names a version\. Because content is what a source says it holds, as the rubric says, never a script\./,
      );
      assert.doesNotMatch(page.said, /Pods differ|\(row/);
    });

    it("quotes the paragraph of a Choice row whose name holds parentheses", () => {
      const html = pageText(built, "naming.html");
      assert.match(
        readPage(html.slice(html.indexOf('id="n4"'))).said,
        /Why a layout\. One place for each file\./,
      );
    });

    it("links the note's Why, and each link of the paragraph from where the note is", () => {
      assert.ok(page.hrefs.includes(`${BLOB}decisions/naming.md#why`));
      assert.ok(page.hrefs.includes(`${BLOB}decisions/currency.md`));
      assert.ok(page.hrefs.includes(`${BLOB}decisions/naming.md#rubric`));
    });

    it("shows a link whose scheme is not http as its text alone", () => {
      assert.ok(page.hrefs.every((href) => !href.startsWith("javascript:")));
      assert.match(page.said, /never a script\./);
    });

    it("links the note's Why alone when no paragraph names the Choice row", () => {
      const html = pageText(built, "naming.html");
      const n3 = html.slice(html.indexOf('id="n3"'), html.indexOf('id="n4"'));
      assert.match(
        readPage(n3).said,
        /Ruled by How things are named , row scheme/,
      );
      assert.ok(readPage(n3).hrefs.includes(`${BLOB}decisions/naming.md#why`));
      assert.doesNotMatch(n3, /blockquote/);
    });
  });

  describe("with a rule that says no note rules it", () => {
    it("says so under the rule, with the rule's own reason", () => {
      const html = pageText(built, "the-kit.html");
      assert.match(
        readPage(
          html.slice(
            html.indexOf('id="check-1"'),
            html.indexOf('id="check-2"'),
          ),
        ).said,
        /No decision note rules this[^]*Its tests are the examples\./,
      );
    });

    it("lists the rule in `unnoted`, apart from the warnings", () => {
      assert.deepEqual(built.unnoted, ["runtime/the-kit.feature Check 1"]);
      assert.ok(
        !built.warnings.some(({ what }) => what.includes("Check 1 names")),
      );
    });
  });

  describe("with a Choice row that names the issue that will write its rule", () => {
    it("lists it in `waiting`, apart from the warnings", () => {
      assert.deepEqual(built.waiting, [
        {
          note: "decisions/naming.md",
          id: "row-scheme",
          what: 'row "scheme" waits on #193',
        },
      ]);
      assert.ok(!built.warnings.some(({ what }) => what.includes("#193")));
    });

    it("counts it, and the rules no note rules, on the index page", () => {
      assert.match(
        readPage(pageText(built, "index.html")).said,
        /1 rule says no note rules it, and 1 Choice row waits on the issue that will write its rule/,
      );
    });
  });

  describe("with a kit", () => {
    let page: ReturnType<typeof readPage>;

    before(() => {
      page = readPage(pageText(built, "kim.html"));
    });

    it("shows the kit's name and its story", () => {
      assert.equal(page.h1, "Kim's pod");
      assert.match(page.said, /Background: Kim's story/);
    });

    it("links the input its story runs on and its expected views on GitHub", () => {
      for (const link of [
        `${BLOB}conformance/kim/scripted-input/people.ttl`,
        `${TREE}conformance/kim/scripted-input/kim/bridge/`,
        `${BLOB}conformance/kim/expected/allergies.ttl`,
      ])
        assert.ok(page.hrefs.includes(link), link);
    });

    it("shows each check's result, with why for one that failed", () => {
      assert.match(page.said, /Check 1\. Every example passes pass/);
      assert.match(
        page.said,
        /Check 2\. Each final view equals expected\/ fail why allergies\.ttl differs/,
      );
    });

    it("shows each example's result", () => {
      assert.deepEqual(
        results(built, "kim.html"),
        new Map([["one allergy record", "passed"]]),
      );
    });
  });

  describe("`index.html`", () => {
    it("links every feature's page and every kit's", () => {
      const { hrefs } = readPage(pageText(built, "index.html"));
      for (const page of ["naming.html", "the-kit.html", "kim.html"])
        assert.ok(hrefs.includes(page), page);
    });
  });
});

/**
 * A rule should name the decision note that ruled it, and a note's Choice row the rule it led to. `specPages()` returns a
 * warning for each that does not, and the specification's index lists them, so a decision with no rule, or a rule with no
 * reason, shows.
 */
describe("Warnings about rules and decision notes · specPages().warnings, rulesNamedIn(), filesNamed()", () => {
  describe("`specPages()`", () => {
    let built: SpecPages;

    before(async () => {
      built = await pagesOf(await kimVocabulary(), ASSERTIONS, RAN_WITH);
    });

    it("warns about a rule that names no note", () => {
      assert.deepEqual(
        built.warnings
          .filter(({ kind }) => kind === "rule names no note")
          .map(({ where, what }) => [where, what]),
        [
          ["runtime/naming.feature", "N2 names no note"],
          ["runtime/the-kit.feature", "Check 2 names no note"],
        ],
      );
    });

    it("warns about a Choice row a rule names that no Why paragraph names", () => {
      assert.deepEqual(warned(built, "no Why paragraph names the row"), [
        'no paragraph of its Why names row "scheme", which N3 names',
      ]);
    });

    it("warns about a Choice row that names a file the vocabulary lacks", () => {
      assert.deepEqual(warned(built, "pointer names nothing"), [
        'row "shape" names runtime/shapes.ttl, which is no file',
      ]);
    });

    it("warns about a Choice row that names no rule, run of rules, file or issue", () => {
      // The note's other four rows each name one: (N1), (#193), (N1 to N3, Check 2) and `runtime/pod-layout.ttl`.
      assert.deepEqual(warned(built, "row names no rule"), [
        'row "shape" names no rule',
      ]);
    });

    it("returns no other warning", () => {
      assert.deepEqual(
        built.warnings.map(({ kind, where, what }) => [kind, where, what]),
        [
          ["rule names no note", "runtime/naming.feature", "N2 names no note"],
          [
            "no Why paragraph names the row",
            "decisions/naming.md",
            'no paragraph of its Why names row "scheme", which N3 names',
          ],
          [
            "rule names no note",
            "runtime/the-kit.feature",
            "Check 2 names no note",
          ],
          [
            "pointer names nothing",
            "decisions/naming.md",
            'row "shape" names runtime/shapes.ttl, which is no file',
          ],
          [
            "row names no rule",
            "decisions/naming.md",
            'row "shape" names no rule',
          ],
        ],
      );
    });

    it("takes no bare code that another list uses for a rule", async () => {
      const files = new MemoryFiles(TREE);
      await files.write("decisions/README.md", text("# Notes\n"));
      await files.write(
        "decisions/review.md",
        text(`# Review

## Choice

| thing | prior art | what we do | borrowed or diverged |
|---|---|---|---|
| steps | | C1 and A1/A2 are steps of the conformance review, not rules | ours |
| rule in parentheses | | a hash of its content (N1) | ours |
| rule by pointer | | \`runtime/naming.feature\` N3 says so | ours |
`),
      );
      await files.write("runtime/naming.feature", text(FEATURE));
      await files.write(
        "runtime/currency.feature",
        text(`Feature: Currency
  Rule: C1. A revision is current when nothing outranks it

    Example: the only revision
      Given a new pod for Kim on 2026-09-01 at 09:55
`),
      );
      const pages = await specPages({
        vocabulary: files,
        report: await readSpecReport(earl([], "cascade-runtime-js", RAN_WITH)),
        builtFrom: [],
        at: "2026-10-24T00:00:00Z",
        chrome: PLAIN,
      });
      assert.deepEqual(warned(pages, "row names no rule"), [
        'row "steps" names no rule',
      ]);
    });

    it("warns about a Choice row the rendered table lacks", async () => {
      const tree = await hubWith(await oddVocabulary(), []);
      const { said } = readPage(treeText(tree, "spec/index.html"));
      assert.match(said, /row "y" has no row in the table the page renders/);
      assert.doesNotMatch(said, /row "x" has no row/);
      assert.doesNotMatch(said, /row "a \| b" has no row/);
    });
  });

  describe("`rulesNamedIn()`", () => {
    const named = (cell: string) => [...new Set(rulesNamedIn(cell))].sort();

    it("finds a rule named in parentheses, and each rule of a run such as `M1 to M3`", () => {
      assert.deepEqual(named("a hash (M7)"), ["M7"]);
      assert.deepEqual(named("a range (M1 to M3, Check 2)"), [
        "Check 2",
        "M1",
        "M2",
        "M3",
      ]);
    });

    it('finds the rule after the word "rule"', () => {
      // `rulesNamedIn` finds one rule after "rules": `R13` is not found.
      assert.deepEqual(named("as rule M7 says; rules R12 and R13 too"), [
        "M7",
        "R12",
      ]);
    });

    it("finds a rule named by a possessive", () => {
      assert.deepEqual(named("kept as M14's table says"), ["M14"]);
    });

    it("finds the rule beside a `.feature` pointer, and not a code further off", () => {
      assert.deepEqual(
        named("`runtime/currency.feature`, C2 says so; C1 writes it"),
        ["C2"],
      );
      assert.deepEqual(
        named(
          "`runtime/naming.feature` N3 and conformance-review C2 and item A5",
        ),
        ["N3"],
      );
    });

    it("finds none among bare codes", () => {
      assert.deepEqual(
        named("C1 writes it, A1/A2 follow, M4 and L1 say so"),
        [],
      );
    });

    it('finds none in a code after "item" or "conformance-review"', () => {
      assert.deepEqual(
        named("(conformance-review C3; the lean of item C1; rule N1)"),
        ["N1"],
      );
    });
  });

  describe("`filesNamed()`", () => {
    let named: Awaited<ReturnType<typeof filesNamed>>;

    before(async () => {
      const files = new MemoryFiles(TREE);
      await files.write("conformance/kim/scripted-input/people.ttl", text(""));
      named = await filesNamed(files, [
        "conformance/kim/scripted-input/people.ttl",
        "conformance/kim/scripted-input/gone.ttl",
        "pod/clinical/allergies.ttl",
      ]);
    });

    it("finds a path under a nested folder of the vocabulary", () => {
      assert.deepEqual(
        named.found,
        new Set(["conformance/kim/scripted-input/people.ttl"]),
      );
    });

    it("lists as missing a path its folder lacks", () => {
      assert.deepEqual(
        named.missing,
        new Set(["conformance/kim/scripted-input/gone.ttl"]),
      );
    });

    it("lists a path in a folder the vocabulary lacks as neither", () => {
      assert.ok(!named.found.has("pod/clinical/allergies.ttl"));
      assert.ok(!named.missing.has("pod/clinical/allergies.ttl"));
    });
  });
});
