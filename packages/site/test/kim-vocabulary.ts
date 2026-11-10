import {
  type Assertion,
  earl,
  MemoryFiles,
  type TestedWith,
} from "@cascade-runtime/runtime";
import { hubFiles } from "../src/front-page.js";
import { specSection } from "../src/hub/spec.js";
import { buildTree } from "../src/sections.js";
import { readSpecReport, type SpecPages, specPages } from "../src/spec.js";

export const TREE = "https://github.com/jayostis/cascade-vocabulary/tree/abc/";
export const BLOB = "https://github.com/jayostis/cascade-vocabulary/blob/abc/";
export const NAMING = `${TREE}runtime/naming.feature#`;

export const text = (value: string) => new TextEncoder().encode(value);

export const NOTE = `# How things are named

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

export const FEATURE = `Feature: Naming
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

export const KIT = `Feature: Kim's pod
  Kim's story.

  Background: Kim's story
    Given a new pod for Kim on 2026-09-01 at 09:55 (E1)

  Rule: P1. One allergy

    Example: one allergy record
      Then the pod holds 1 allergy
`;

export const THE_KIT = `Feature: The conformance kit
  Rule: Check 1. Every example passes
    No note rules this. Its tests are the examples.

  Rule: Check 2. Each final view equals expected/
`;

export const ASSERTIONS: readonly Assertion[] = [
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

export const RAN_WITH: readonly TestedWith[] = [
  { name: "cascade-vocabulary", iri: TREE, revision: "abc" },
];

/** A vocabulary with a note, a feature that cites it, a kit and a feature of the kit's checks. */
export async function kimVocabulary(): Promise<MemoryFiles> {
  const vocabulary = new MemoryFiles(TREE);
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
  return vocabulary;
}

/** The pages of `vocabulary` with the conformance results `assertions`, run with `ranWith`. */
export async function pagesOf(
  vocabulary: MemoryFiles,
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

/** The tree the hub writes for the specification's section over `from`, given the results the context would read. */
export async function hubWith(
  from: MemoryFiles,
  ran: readonly Assertion[],
  files: { readonly earl?: Uint8Array; readonly table?: Uint8Array } = {},
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
      tests: async () => [
        {
          suite: {
            repository: "jayostis/cascade-runtime-js",
            title: "The runtime's tests",
            about: "npm test",
            workflow: "check.yml",
            artifact: "runtime-tests",
            report: "junit.xml",
            runner: "node:test" as const,
          },
        },
      ],
    },
    front: (rows) => hubFiles(["Records"], rows),
  });
  return tree;
}

const ODD_NOTE = `# Odd layouts

Names are in [a note that is gone](gone.md) and [the currency note](currency.md).

## Earlier

| thing | what we do |
|---|---|
| x | a decoy that is no Choice row |

## Choice

| thing | prior art | what we do | borrowed or diverged |
|---|---|---|---|
| x | | first (N1) | ours |
| \`a \\| b\` | | piped (N3) | ours |
| z | | waits on #193 | ours |

A line that breaks the table.

| y | | more (N2) | ours |

## Row x

Text.
`;

const ODD_FEATURE = `Feature: Odd
  Rule: N1. Cites x
    decisions/odd.md, row "x". Fine.

  Rule: N2. Cites y
    decisions/odd.md, row "y". Linked without an anchor.

  Rule: N3. Cites the piped one
    decisions/odd.md, row "a | b". Linked with an anchor.
`;

/** A vocabulary whose note has a Choice table that Markdown renders otherwise than the site reads it: a row after a line that breaks the table, an escaped pipe, an earlier table, and a heading named for a row. */
export async function oddVocabulary(): Promise<MemoryFiles> {
  const files = new MemoryFiles(TREE);
  await files.write("decisions/README.md", text("# Decision notes\n"));
  await files.write("decisions/odd.md", text(ODD_NOTE));
  await files.write("decisions/currency.md", text("# Currency\n"));
  await files.write("runtime/odd.feature", text(ODD_FEATURE));
  return files;
}

export const treeText = (tree: ReadonlyMap<string, Uint8Array>, path: string) =>
  new TextDecoder().decode(tree.get(path));
