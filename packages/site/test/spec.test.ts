import assert from "node:assert/strict";
import { before, test } from "node:test";
import {
  type Assertion,
  earl,
  MemoryFiles,
  type TestedWith,
} from "@cascade-runtime/runtime";
import { hubFiles } from "../src/front-page.js";
import { specSection } from "../src/hub/spec.js";
import { buildTree } from "../src/sections.js";
import {
  filesNamed,
  readSpecReport,
  rulesNamedIn,
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

test("a Choice row names a rule only inside parentheses or beside a .feature pointer, never by a bare code another list uses", async () => {
  const files = new MemoryFiles(TREE);
  const text = (value: string) => new TextEncoder().encode(value);
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
  });
  assert.deepEqual(
    pages.warnings
      .filter(({ kind }) => kind === "row names no rule")
      .map(({ what }) => what),
    ['row "steps" names no rule'],
  );
});

test("a path a row names under a nested folder of the vocabulary is found, one the folder lacks is missing, and one in a folder the vocabulary lacks is neither", async () => {
  const files = new MemoryFiles(TREE);
  await files.write(
    "conformance/kim/scripted-input/people.ttl",
    new TextEncoder().encode(""),
  );
  assert.deepEqual(
    await filesNamed(files, [
      "conformance/kim/scripted-input/people.ttl",
      "conformance/kim/scripted-input/gone.ttl",
      "pod/clinical/allergies.ttl",
    ]),
    {
      found: new Set(["conformance/kim/scripted-input/people.ttl"]),
      missing: new Set(["conformance/kim/scripted-input/gone.ttl"]),
    },
  );
});

/** The tree the hub writes for the spec's section, given the report the context would read. */
async function hubWith(
  ran: readonly Assertion[],
  files: { readonly earl?: Uint8Array; readonly table?: Uint8Array } = {},
  from: MemoryFiles = vocabulary,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const report = await readSpecReport(
    earl(ran, "cascade-runtime-js", RAN_WITH),
  );
  const { tree } = await buildTree({
    sections: [specSection],
    ctx: {
      vocabulary: async () => ({
        files: from,
        builtFrom: [],
        at: "2026-10-24T00:00:00Z",
      }),
      report: async () => ({ report, ...files }),
    },
    front: (rows) => hubFiles(["Records"], rows),
  });
  return tree;
}
const treeText = (tree: ReadonlyMap<string, Uint8Array>, path: string) =>
  new TextDecoder().decode(tree.get(path));

test("the hub's spec section writes the spec's pages and the conformance table with one result per feature, both linked from the front page", async () => {
  const table = new TextEncoder().encode("| rule | result |\n");
  const tree = await hubWith(ASSERTIONS, {
    earl: new TextEncoder().encode("# earl\n"),
    table,
  });
  for (const path of [
    "spec/index.html",
    "spec/naming.html",
    "spec/kim.html",
    "spec/spec.css",
    "conformance/index.html",
    "conformance/results.json",
    "conformance/earl.ttl",
    "conformance/table.md",
  ])
    assert.ok(tree.has(path), path);
  assert.deepEqual(tree.get("conformance/table.md"), table);
  const front = readPage(treeText(tree, "index.html"));
  assert.ok(front.hrefs.includes("spec/index.html"));
  assert.ok(front.hrefs.includes("conformance/index.html"));

  const conformance = readPage(treeText(tree, "conformance/index.html"));
  assert.match(conformance.said, /Naming 4 1 1 1/);
  assert.match(conformance.said, /Kim's pod 1 1 0 0 0 1 /);
  assert.ok(conformance.hrefs.includes("../spec/naming.html"));
  assert.ok(conformance.hrefs.includes("earl.ttl"));
  assert.ok(conformance.hrefs.includes("table.md"));

  const json = JSON.parse(treeText(tree, "conformance/results.json")) as {
    ran: boolean;
    features: { path: string; checks?: unknown }[];
  };
  assert.equal(json.ran, true);
  assert.deepEqual(
    json.features.find(({ path }) => path === "conformance/kim/kim.feature")
      ?.checks,
    { passed: 0, failed: 1, notRun: 0 },
  );
  assert.deepEqual(
    json.features.find(({ path }) => path === "runtime/naming.feature"),
    {
      path: "runtime/naming.feature",
      name: "Naming",
      page: "spec/naming.html",
      kit: false,
      rules: 4,
      passed: 1,
      failed: 1,
      notRun: 1,
    },
  );
});

test("with no conformance report the section still writes both, every result is not run, and the report's files are not linked", async () => {
  const tree = await hubWith([]);
  assert.ok(tree.has("spec/index.html") && tree.has("conformance/index.html"));
  assert.ok(!tree.has("conformance/earl.ttl"));
  assert.ok(!tree.has("conformance/table.md"));
  const conformance = readPage(treeText(tree, "conformance/index.html"));
  assert.match(conformance.said, /No result of a conformance report/);
  assert.match(conformance.said, /Naming 4 0 0 3/);
  assert.ok(!conformance.hrefs.includes("earl.ttl"));
  const json = JSON.parse(treeText(tree, "conformance/results.json")) as {
    ran: boolean;
  };
  assert.equal(json.ran, false);
});

test("a rule is named in parentheses, beside a .feature pointer, after the word rule, or by a possessive, and a code after item or conformance-review names none", () => {
  const named = (cell: string) => [...new Set(rulesNamedIn(cell))].sort();
  assert.deepEqual(named("a hash (M7)"), ["M7"]);
  assert.deepEqual(named("a range (M1 to M3, Check 2)"), [
    "Check 2",
    "M1",
    "M2",
    "M3",
  ]);
  assert.deepEqual(named("as rule M7 says; rules R12 and R13 too"), [
    "M7",
    "R12",
  ]);
  assert.deepEqual(named("kept as M14's table says"), ["M14"]);
  assert.deepEqual(
    named("`runtime/currency.feature`, C2 says so; C1 writes it"),
    ["C2"],
  );
  assert.deepEqual(named("C1 writes it, A1/A2 follow, M4 and L1 say so"), []);
  assert.deepEqual(
    named("(conformance-review C3; the lean of item C1; rule N1)"),
    ["N1"],
  );
  assert.deepEqual(
    named("`runtime/naming.feature` N3 and conformance-review C2 and item A5"),
    ["N3"],
  );
});

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

test("the hub writes each decision note as a page: a rule links the note's row, the row lists the rules that cite it and says when none does, and a note's links to other notes are pages", async () => {
  const files = new MemoryFiles(TREE);
  const text = (value: string) => new TextEncoder().encode(value);
  await files.write(
    "decisions/README.md",
    text(
      "# Decision notes\n\nOne note per question.\n\n## The notes\n\n- [`currency.md`](currency.md): which revision.\n- [issue](https://github.com/jayostis/cascade-vocabulary/issues/130)\n",
    ),
  );
  await files.write("decisions/currency.md", text(CURRENCY_NOTE));
  await files.write(
    "decisions/naming.md",
    text("# How things are named\n\n## Choice\n"),
  );
  await files.write("runtime/currency.feature", text(CURRENCY_FEATURE));
  await files.write("queries/view.rq", text(""));
  const tree = await hubWith([], {}, files);
  for (const path of [
    "decisions/index.html",
    "decisions/currency.html",
    "decisions/naming.html",
  ])
    assert.ok(tree.has(path), path);

  const rule = readPage(treeText(tree, "spec/currency.html"));
  assert.ok(rule.hrefs.includes("../decisions/currency.html#row-current"));
  assert.ok(rule.hrefs.includes("../decisions/currency.html#row-heads"));
  assert.ok(rule.hrefs.includes("../decisions/currency.html#why"));
  assert.ok(rule.hrefs.includes("../decisions/currency.html"));
  assert.ok(rule.hrefs.includes("../decisions/naming.html"));
  assert.ok(!rule.hrefs.some((href) => href.endsWith("decisions/currency.md")));

  const html = treeText(tree, "decisions/currency.html");
  const note = readPage(html);
  assert.equal(note.h1, "Which revision is current");
  assert.ok(["why", "choice", "still-open"].every((id) => note.ids.has(id)));
  assert.ok(note.hrefs.includes(`${BLOB}decisions/currency.md`));
  assert.ok(note.hrefs.includes("naming.html"));
  assert.ok(note.hrefs.includes("#why"));
  assert.ok(note.hrefs.includes(`${BLOB}queries/current.rq`));
  assert.ok(note.hrefs.includes(`${TREE}queries/`));
  assert.doesNotMatch(html, /<script/);
  const row = (id: string) =>
    readPage(
      html.slice(
        html.indexOf(`id="${id}"`),
        html.indexOf("</tr>", html.indexOf(`id="${id}"`)),
      ),
    );
  assert.deepEqual(
    row("row-current").hrefs.filter((href) => href.startsWith("../spec/")),
    ["../spec/currency.html#c2"],
  );
  assert.deepEqual(
    row("row-heads").hrefs.filter((href) => href.startsWith("../spec/")),
    ["../spec/currency.html#c3", "../spec/currency.html#c4"],
  );
  assert.match(row("row-view").said, /No rule cites this row/);
  assert.ok(!row("row-view").hrefs.some((href) => href.includes("spec/")));
  assert.match(row("row-view-2").said, /No rule cites this row/);
  assert.match(row("row-a-b").said, /a \| b escaped ours/);
  assert.deepEqual(
    row("row-a-b").hrefs.filter((href) => href.startsWith("../spec/")),
    ["../spec/currency.html"],
  );
  assert.ok(rule.hrefs.includes(`${BLOB}decisions/gone.md`));

  const index = readPage(treeText(tree, "decisions/index.html"));
  assert.equal(index.h1, "Decision notes");
  assert.ok(index.hrefs.includes("currency.html"));
  assert.ok(index.hrefs.includes("currency.html#row-view"));
  assert.ok(!index.hrefs.includes("currency.html#row-heads"));
  assert.ok(index.hrefs.includes("naming.html"));
  assert.ok(index.hrefs.includes(`${BLOB}decisions/README.md`));
  assert.ok(
    readPage(treeText(tree, "index.html")).hrefs.includes(
      "decisions/index.html",
    ),
  );
});
