import assert from "node:assert/strict";
import { before, test } from "node:test";
import { earl, MemoryFiles } from "@cascade-runtime/runtime";
import { readSpecReport, type SpecPages, specPages } from "../src/spec.js";
import { readPage } from "./page.js";

const TREE = "https://github.com/jayostis/cascade-vocabulary/tree/abc/";
const BLOB = "https://github.com/jayostis/cascade-vocabulary/blob/abc/";

const NOTE = `# How things are named

## Choice

| thing | prior art | what we do | borrowed or diverged |
|---|---|---|---|
| version | git blob | a hash of its content (N1) | borrowed |
| scheme | | declared per pod (#193) | ours |

## Why

**Why content names a version.** Because \`content\` is what [a source](currency.md) says
it holds.

**Why a scheme.** Pods differ.
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

  Rule: Check 2. Each final view equals expected/
`;

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

before(async () => {
  const vocabulary = new MemoryFiles(TREE);
  const text = (value: string) => new TextEncoder().encode(value);
  await vocabulary.write("decisions/README.md", text("# Notes\n"));
  await vocabulary.write("decisions/naming.md", text(NOTE));
  await vocabulary.write("runtime/naming.feature", text(FEATURE));
  await vocabulary.write("runtime/the-kit.feature", text(THE_KIT));
  await vocabulary.write("conformance/kim/kim.feature", text(KIT));
  await vocabulary.write("conformance/kim/scripted-input/people.ttl", text(""));
  await vocabulary.write(
    "conformance/kim/scripted-input/kim/bridge/E1/graph.ttl",
    text(""),
  );
  await vocabulary.write(
    "conformance/kim/scripted-input/kim/bridge/E2/graph.ttl",
    text(""),
  );
  await vocabulary.write("conformance/kim/expected/allergies.ttl", text(""));
  const feature = `${TREE}runtime/naming.feature#`;
  const report = await readSpecReport(
    earl(
      [
        {
          test: `${feature}one-content-is-one-version`,
          name: "",
          outcome: "passed",
        },
        {
          test: `${feature}a-revision-s-name`,
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
      ],
      "cascade-runtime-js",
      [{ name: "cascade-vocabulary", iri: TREE, revision: "abc" }],
    ),
  );
  built = await specPages({
    vocabulary,
    report,
    builtFrom: [],
    at: "2026-10-24T00:00:00Z",
  });
});

test("a rule with no note, and a Choice row with no rule, are each a warning, and nothing else is", () => {
  assert.deepEqual(
    built.warnings.map(({ kind, where, what }) => [kind, where, what]),
    [
      ["rule names no note", "runtime/naming.feature", "N2 names no note"],
      [
        "rule names no note",
        "runtime/the-kit.feature",
        "Check 1 names no note",
      ],
      [
        "rule names no note",
        "runtime/the-kit.feature",
        "Check 2 names no note",
      ],
      [
        "row names no rule",
        "decisions/naming.md",
        'row "scheme" names no rule (it names #193)',
      ],
    ],
  );
});

test("a rule names the note and row that ruled it, with the paragraph of the note's Why that leads with the row", () => {
  const page = readPage(pageText("naming.html"));
  assert.ok(page.ids.has("n1") && page.ids.has("n2"));
  assert.match(page.said, /Ruled by How things are named , row version/);
  assert.match(
    page.said,
    /Why content names a version\. Because content is what a source says it holds\./,
  );
  assert.doesNotMatch(page.said, /Pods differ/);
  assert.ok(page.hrefs.includes(`${BLOB}decisions/naming.md`));
  assert.ok(page.hrefs.includes(`${BLOB}decisions/naming.md#why`));
  assert.ok(page.hrefs.includes(`${BLOB}decisions/currency.md`));
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
