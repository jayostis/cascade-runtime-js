import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { promisify } from "node:util";
import { runConformance } from "../src/conformance.js";
import { featuresOf, readFeature } from "../src/features.js";
import { MemoryFiles } from "../src/files.js";
import { KIT_CHECKS, kitsOf } from "../src/kit.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { layout, ROOT, vocabulary } from "./vocabulary.js";

const EARL = "http://www.w3.org/ns/earl#";
const CLI = join(ROOT, "packages", "runtime", "dist", "src", "node", "cli.js");

let outcomes: Map<string, Outcome[]>;
/** Each version the report says the runtime was run with, by doap:name. */
let requires: Map<string, string>;
/** Each example and check the report must hold, by its IRI, with its name. */
const tested = new Map<string, string>();

/** The outcome and why of each example of a feature file of broken examples, by its name, from one run. */
let broken: Map<string, readonly [string, string]>;
/** The name of each example that run reported, once for each time it reported it. */
let brokenNames: string[];

interface Outcome {
  readonly outcome: string;
  readonly why?: string;
}

async function report(): Promise<{
  found: Map<string, Outcome[]>;
  requires: Map<string, string>;
}> {
  const file = join(await mkdtemp(join(tmpdir(), "conformance-")), "earl.nt");
  await promisify(execFile)(process.execPath, [
    CLI,
    "conformance",
    "--report",
    file,
  ]);
  const store = new OxigraphStore();
  await store.loadTurtle(await readFile(file), { graph: "urn:report" });
  const { rows } = await store.select(`PREFIX earl: <${EARL}>
    SELECT ?test ?outcome ?why WHERE {
      ?assertion a earl:Assertion ; earl:test ?test ; earl:result ?result . ?result earl:outcome ?outcome
      OPTIONAL { ?result <http://purl.org/dc/terms/description> ?why }
    }`);
  const found = new Map<string, Outcome[]>();
  for (const row of rows) {
    const test = row.get("test")?.value ?? "";
    found.set(test, [
      ...(found.get(test) ?? []),
      { outcome: row.get("outcome")?.value ?? "", why: row.get("why")?.value },
    ]);
  }
  const used = await store.select(`SELECT ?name ?revision WHERE {
      ?subject a <${EARL}TestSubject> ; <http://purl.org/dc/terms/requires> ?used .
      ?used <http://usefulinc.com/ns/doap#name> ?name ; <http://usefulinc.com/ns/doap#revision> ?revision
    }`);
  return {
    found,
    requires: new Map(
      used.rows.map((row) => [
        row.get("name")?.value ?? "",
        row.get("revision")?.value ?? "",
      ]),
    ),
  };
}

async function readTested(): Promise<void> {
  const files = await vocabulary();
  for (const path of await featuresOf(files))
    for (const { iri, name } of (await readFeature(files, path)).examples)
      tested.set(iri, name);
  const kits = await kitsOf(files);
  assert.ok(kits.length > 0, "the vocabulary has no kit");
  for (const kit of kits)
    for (const check of Object.values(KIT_CHECKS))
      tested.set(`${files.iri}${kit}/#${check}`, check);
}

before(async () => {
  const [reported, ranBroken] = await Promise.all([
    report(),
    runBroken(),
    readTested(),
  ]);
  ({ found: outcomes, requires } = reported);
  const named = ranBroken.map(
    ({ test, outcome, why }) =>
      [test.slice(test.indexOf("#") + 1), [outcome, why ?? ""]] as const,
  );
  brokenNames = named.map(([name]) => name);
  broken = new Map(named);
});

test("the conformance command reports each example of every feature file and each kit's checks once, and nothing else", () => {
  assert.deepEqual([...outcomes.keys()].sort(), [...tested.keys()].sort());
  for (const [test, found] of outcomes) assert.equal(found.length, 1, test);
});

test("the report names the commit of the vocabulary and of each adapter, and the Bridge build, the run used", async () => {
  const { adapters } = JSON.parse(
    await readFile(join(ROOT, "cascade-runtime.json"), "utf8"),
  ) as { adapters: { repository: string }[] };
  assert.deepEqual(
    [...requires.keys()].sort(),
    [
      "cascade-vocabulary",
      "cascade-bridge-rs",
      ...adapters.map(({ repository }) => repository.split("/").at(-1) ?? ""),
    ].sort(),
  );
  assert.equal(
    requires.get("cascade-vocabulary"),
    (await vocabulary()).iri.split("/").at(-2),
  );
  assert.match(
    requires.get("cascade-bridge-rs") ?? "",
    /^(build-)?[0-9a-f]{40}$/,
  );
});

test("every example and each kit's checks pass", () => {
  for (const [iri, name] of tested) {
    const found = outcomes.get(iri);
    assert.deepEqual(
      found?.map(({ outcome }) => outcome),
      [`${EARL}passed`],
      `${name}: ${found?.[0]?.why}`,
    );
  }
});

/** Runs the conformance command, in memory, on a vocabulary whose one feature file is of broken examples. */
async function runBroken(): ReturnType<typeof runConformance> {
  const files = new MemoryFiles("https://vocabulary.example/");
  const write = (path: string, text: string) =>
    files.write(path, new TextEncoder().encode(text));
  await write(
    "runtime/scripted-input/people.ttl",
    `<urn:uuid:1b4e6a52-8c3f-4d71-9e0a-5f2c7d8b9a10> <http://xmlns.com/foaf/0.1/name> "Ada" ;
       <http://www.w3.org/ns/pim/space#storage> <https://pod.example/> .
     <urn:uuid:6d1f3b8a-2c4e-4a9f-8b7d-3e5a1c9f0b24> <http://xmlns.com/foaf/0.1/name> "Bob" ;
       <http://www.w3.org/ns/pim/space#storage> <https://bob.example/> .`,
  );
  await write(
    "runtime/scripted-input/ada/judgments/same.ttl",
    `<urn:uuid:0f4a8c26-5b3e-4d79-a1e8-6c2f9b4d7a15> a <https://ns.cascadeprotocol.org/judgments/v1-draft#Judgment> .`,
  );
  await write(
    "runtime/broken.feature",
    `Feature: Broken
  Rule: Z1. A rule
    Example: a step nobody wrote
      Given a new pod for Ada on 2026-01-01 at 09:00
      Then the pod is made of cheese

    Example: a pod read before a later step that stops the replay
      Given a new pod for Ada on 2026-01-01 at 09:00
      When the pod is read as it stood after "pod"
      And Ada enters "missing" on 2026-01-02 at 09:00
      Then the pod holds no revision

    Example: a step named with a space
      Given a new pod for Ada on 2026-01-01 at 09:00
      When Ada files the judgment "two words" on 2026-01-02 at 09:00
      Then the pod holds no revision

    Scenario Outline: two rows of one name
      Given a new pod for Ada on 2026-01-01 at 09:00
      Then the pod holds no revision

      Examples:
        | row |
        | 1   |
        | 2   |

    Example: a query that is no SELECT
      Given a new pod for Ada on 2026-01-01 at 09:00
      When the query is:
        """
        ASK { ?s ?p ?o }
        """
      Then it answers nothing

    Example: another person named
      Given a new pod for Ada on 2026-01-01 at 09:00
      Then these are named:
        | thing | name                                          |
        | Bob   | urn:uuid:6d1f3b8a-2c4e-4a9f-8b7d-3e5a1c9f0b24 |

    Example: a judgment filed twice, read after the first
      Given a new pod for Ada on 2026-01-01 at 09:00
      And Ada files the judgment "same" on 2026-01-02 at 09:00
      When the pod is read as it stood after "same"
      And Ada files the judgment "same" on 2026-01-03 at 09:00 (again)
      Then that step wrote 1 file
`,
  );
  return runConformance({
    vocabulary: files,
    newStore: () => new OxigraphStore(),
    newPod: (address) => new MemoryFiles(address),
    layout: await layout(),
  });
}

test("the run of the feature file of broken examples reports each of its examples once, and nothing else", () => {
  assert.deepEqual(brokenNames.sort(), [
    "a-judgment-filed-twice-read-after-the-first",
    "a-pod-read-before-a-later-step-that-stops-the-replay",
    "a-query-that-is-no-select",
    "a-step-named-with-a-space",
    "a-step-nobody-wrote",
    "another-person-named",
    "two-rows-of-one-name",
  ]);
});

function failed(example: string, why: RegExp): void {
  const [outcome, said] = broken.get(example) ?? [];
  assert.equal(outcome, "failed", example);
  assert.match(said ?? "", why);
}

test("a step no phrase reads fails its example, naming the phrase", () => {
  failed(
    "a-step-nobody-wrote",
    /^Z1\. A rule: no step of runtime\/steps\.md reads "the pod is made of cheese"/,
  );
});

test("a later step that stops the replay fails an example that read the pod before it", () => {
  failed(
    "a-pod-read-before-a-later-step-that-stops-the-replay",
    /^Z1\. A rule: the replay stopped at step missing:/,
  );
});

test("a step named with a space fails its example", () => {
  failed(
    "a-step-named-with-a-space",
    /^Z1\. A rule: "two words" cannot name a step/,
  );
});

test("two outline rows of one name fail", () => {
  failed(
    "two-rows-of-one-name",
    /^Z1\. A rule: two examples of runtime\/broken\.feature are named "two rows of one name"/,
  );
});

test("a query that is no SELECT fails its example", () => {
  failed("a-query-that-is-no-select", /^Z1\. A rule: the query is no SELECT/);
});

test("an example may name a person other than the pod's", () => {
  assert.deepEqual(broken.get("another-person-named"), ["passed", ""]);
});

test("a pod read before a later step of the same name is read as it stood then", () => {
  assert.deepEqual(broken.get("a-judgment-filed-twice-read-after-the-first"), [
    "passed",
    "",
  ]);
});
