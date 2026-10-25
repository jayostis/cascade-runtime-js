import assert from "node:assert/strict";
import { before, test } from "node:test";
import {
  type Assertion,
  earl,
  MemoryFiles,
  type TestedWith,
} from "@cascade-runtime/runtime";
import {
  readSpecReport,
  type SpecPages,
  specPages,
  type SpecWarning,
} from "../src/spec.js";
import { readPage } from "./page.js";

const TREE = "https://github.com/jayostis/cascade-vocabulary/tree/abc/";
const BLOB = "https://github.com/jayostis/cascade-vocabulary/blob/abc/";
const NAMING = `${TREE}runtime/naming.feature#`;

const NOTE = `# How things are named

## Choice

| thing | prior art | what we do | borrowed or diverged |
|---|---|---|---|
| version | git blob | a hash of its content (N1) | borrowed |
| scheme | as N2 does | declared per pod (#193) | ours |
| order | | revisions in order (N1 to N3, Check 2) | ours |
| layout (R1) | | where files go, \`runtime/pod-layout.ttl\` | ours |
| shape | | closed, \`runtime/shapes.ttl\` | ours |

## Why

**Why content names a version.** (row "version") Because \`content\` is what [a source](currency.md) says
it holds, as [the rubric](#rubric) says, never [a script](javascript:void).

**Why a scheme.** Pods differ.

**Why a layout.** (row "layout (R1)") One place for each file.
`;

const FEATURE = `Feature: Naming
  Rule: N1. A version is named by its content
    decisions/naming.md, row "version". The name is a hash.

    Example: one content is one version
      Given a new pod for Kim on 2026-09-01 at 09:55

    Example: a version the run did not reach
      Given a new pod for Kim on 2026-09-01 at 09:55

  Rule: N2. A revision is named by its own triples

    Example: a revision's name
      Given a new pod for Kim on 2026-09-01 at 09:55

  Rule: N3. A pod declares its scheme once
    decisions/naming.md, row “scheme”. Declared at creation.

  Rule: N4. Files go where the layout says
    decisions/naming.md, row "layout (R1)". In folders.
`;

const KIT = `Feature: Kim's pod
  Kim's story.

  Background: Kim's story
    Given a new pod for Kim on 2026-09-01 at 09:55 (E1)

  Rule: P1. One allergy

    Example: one allergy record
      Then the pod holds 1 allergy
`;

const THE_KIT = `Feature: The conformance kit
  Rule: Check 1. Every example passes
    No note rules this. Its tests are the examples.

  Rule: Check 2. Each final view equals expected/
`;

const ASSERTIONS: readonly Assertion[] = [
  { test: `${NAMING}one-content-is-one-version`, name: "", outcome: "passed" },
  {
    test: `${NAMING}a-revision-s-name`,
    name: "",
    outcome: "failed",
    why: "N2: the revision has no name",
  },
  {
    test: `${TREE}conformance/kim/kim.feature#one-allergy-record`,
    name: "",
    outcome: "passed",
  },
  {
    test: `${TREE}conformance/kim/#check-2-each-final-view-equals-expected`,
    name: "",
    outcome: "failed",
    why: "allergies.ttl differs",
  },
];
const RAN_WITH: readonly TestedWith[] = [
  { name: "cascade-vocabulary", iri: TREE, revision: "abc" },
];

const vocabulary = new MemoryFiles(TREE);
let built: SpecPages;
const pageText = (path: string): string =>
  new TextDecoder().decode(built.files.get(path));

/** Each example's result on a page, by its name. */
const results = (path: string): Map<string, string> =>
  new Map(
    [
      ...pageText(path).matchAll(
        /<details class="example ([\w-]+)">\n<summary><span[^>]*>[^<]*<\/span>([^<]*)<\/summary>/g,
      ),
    ].map(([, outcome, name]) => [
      (name ?? "").replaceAll("&#39;", "'"),
      outcome ?? "",
    ]),
  );

async function pagesOf(
  assertions: readonly Assertion[],
  ranWith: readonly TestedWith[],
): Promise<SpecPages> {
  return specPages({
    vocabulary,
    report: await readSpecReport(
      earl(assertions, "cascade-runtime-js", ranWith),
    ),
    builtFrom: [],
    at: "2026-10-24T00:00:00Z",
  });
}

const reported = ({ warnings }: SpecPages): string[] =>
  warnings
    .filter(({ kind }: SpecWarning) => kind === "report")
    .map(({ what }) => what);

before(async () => {
  const text = (value: string) => new TextEncoder().encode(value);
  await vocabulary.write("decisions/README.md", text("# Notes\n"));
  await vocabulary.write("decisions/naming.md", text(NOTE));
  await vocabulary.write("runtime/naming.feature", text(FEATURE));
  await vocabulary.write("runtime/the-kit.feature", text(THE_KIT));
  await vocabulary.write("runtime/pod-layout.ttl", text(""));
  await vocabulary.write("conformance/kim/kim.feature", text(KIT));
  await vocabulary.write("conformance/kim/scripted-input/people.ttl", text(""));
  for (const step of ["E1", "E2"])
    await vocabulary.write(
      `conformance/kim/scripted-input/kim/bridge/${step}/graph.ttl`,
      text(""),
    );
  await vocabulary.write("conformance/kim/expected/allergies.ttl", text(""));
  built = await pagesOf(ASSERTIONS, RAN_WITH);
});

test("a rule with no note, a pointed row no Why paragraph names, a Choice row whose what-we-do names no rule, rule run, file or issue, and a file a row names that is none are each a warning", () => {
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
      ["row names no rule", "decisions/naming.md", 'row "shape" names no rule'],
    ],
  );
});

test("a rule that says no note rules it, and a row that names the issue that will write its rule, are listed apart from the warnings", () => {
  assert.deepEqual(built.unnoted, ["runtime/the-kit.feature Check 1"]);
  assert.deepEqual(built.waiting, [
    { note: "decisions/naming.md", what: 'row "scheme" waits on #193' },
  ]);
  const html = pageText("the-kit.html");
  assert.match(
    readPage(
      html.slice(html.indexOf('id="check-1"'), html.indexOf('id="check-2"')),
    ).said,
    /No decision note rules this[^]*Its tests are the examples\./,
  );
  assert.match(
    readPage(pageText("index.html")).said,
    /1 rule says no note rules it, and 1 Choice row waits on the issue that will write its rule/,
  );
});

test("a Why paragraph names a row whose name holds parentheses", () => {
  const html = pageText("naming.html");
  assert.match(
    readPage(html.slice(html.indexOf('id="n4"'))).said,
    /Why a layout\. One place for each file\./,
  );
});

test("a rule names the note and row that ruled it, with the Why paragraph that names the row, and only http links in it", () => {
  const page = readPage(pageText("naming.html"));
  assert.ok(page.ids.has("n1") && page.ids.has("n2"));
  assert.match(page.said, /Ruled by How things are named , row version/);
  assert.match(
    page.said,
    /Why content names a version\. Because content is what a source says it holds, as the rubric says, never a script\./,
  );
  assert.doesNotMatch(page.said, /Pods differ|\(row/);
  assert.ok(page.hrefs.includes(`${BLOB}decisions/naming.md#why`));
  assert.ok(page.hrefs.includes(`${BLOB}decisions/currency.md`));
  assert.ok(page.hrefs.includes(`${BLOB}decisions/naming.md#rubric`));
  assert.ok(page.hrefs.every((href) => !href.startsWith("javascript:")));
});

test("a rule whose row no Why paragraph names shows the note's Why as a link alone", () => {
  const html = pageText("naming.html");
  const n3 = html.slice(html.indexOf('id="n3"'), html.indexOf('id="n4"'));
  assert.match(readPage(n3).said, /Ruled by How things are named , row scheme/);
  assert.ok(readPage(n3).hrefs.includes(`${BLOB}decisions/naming.md#why`));
  assert.doesNotMatch(n3, /blockquote/);
});

test("each example shows its latest result: pass, fail with why, or not run", () => {
  assert.deepEqual(
    results("naming.html"),
    new Map([
      ["one content is one version", "passed"],
      ["a version the run did not reach", "not-run"],
      ["a revision's name", "failed"],
    ]),
  );
  assert.match(
    readPage(pageText("naming.html")).said,
    /N2: the revision has no name/,
  );
});

test("of two results for one test a fail is shown, whatever their order, and the repeat is a warning", async () => {
  const test = `${NAMING}one-content-is-one-version`;
  for (const order of [
    ["passed", "failed"],
    ["failed", "passed"],
  ] as const) {
    const pages = await pagesOf(
      order.map((outcome) => ({ test, name: "", outcome })),
      RAN_WITH,
    );
    built = pages;
    assert.equal(
      results("naming.html").get("one content is one version"),
      "failed",
    );
    assert.deepEqual(reported(pages), [
      "the report holds more than one result for this test; the worst is shown",
    ]);
  }
  built = await pagesOf(ASSERTIONS, RAN_WITH);
});

test("a report naming its vocabulary without a trailing slash joins, one of another commit joins by path with a warning, and one of none is a warning", async () => {
  const slashless = await pagesOf(ASSERTIONS, [
    { name: "cascade-vocabulary", iri: TREE.slice(0, -1), revision: "abc" },
  ]);
  assert.deepEqual(reported(slashless), []);
  const other = "https://github.com/jayostis/cascade-vocabulary/tree/def/";
  const moved = await pagesOf(
    ASSERTIONS.map((a) => ({ ...a, test: a.test.replace(TREE, other) })),
    [{ name: "cascade-vocabulary", iri: other, revision: "def" }],
  );
  assert.deepEqual(reported(moved), [
    `the report was run with ${other}, the pages are built from ${TREE}`,
  ]);
  built = moved;
  assert.equal(
    results("naming.html").get("one content is one version"),
    "passed",
  );
  built = await pagesOf(ASSERTIONS, RAN_WITH);
  assert.deepEqual(
    reported(
      await pagesOf(
        ASSERTIONS.map((a) => ({ ...a, test: a.test.replace(TREE, other) })),
        [],
      ),
    ),
    [
      "the report names no cascade-vocabulary it was run with",
      "no result of the report joins an example of the pages",
    ],
  );
});

test("a kit's page holds its story, its scripted input, its expected views and its checks' results", () => {
  const page = readPage(pageText("kim.html"));
  assert.equal(page.h1, "Kim's pod");
  assert.match(page.said, /Background: Kim's story/);
  assert.ok(
    page.hrefs.includes(`${BLOB}conformance/kim/scripted-input/people.ttl`),
  );
  assert.ok(
    page.hrefs.includes(`${TREE}conformance/kim/scripted-input/kim/bridge/`),
  );
  assert.ok(
    page.hrefs.includes(`${BLOB}conformance/kim/expected/allergies.ttl`),
  );
  assert.match(page.said, /Check 1\. Every example passes pass/);
  assert.match(
    page.said,
    /Check 2\. Each final view equals expected\/ fail why allergies\.ttl differs/,
  );
  assert.deepEqual(
    results("kim.html"),
    new Map([["one allergy record", "passed"]]),
  );
});

test("the index links every feature's page and every kit's", () => {
  const { hrefs } = readPage(pageText("index.html"));
  for (const page of ["naming.html", "the-kit.html", "kim.html"])
    assert.ok(hrefs.includes(page), page);
});
