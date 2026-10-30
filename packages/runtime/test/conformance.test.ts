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
import { PERFORMERS } from "../src/replay.js";
import { Union } from "../src/store.js";
import { layout, RUNTIME, ROOT, vocabulary } from "./vocabulary.js";

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
/** The outcome and why of each example of a feature file reading a planted table, by its name, from one run. */
let planted: Map<string, readonly [string, string]>;

interface Outcome {
  readonly outcome: string;
  readonly why?: string;
}

/** The report of the conformance command, run here unless CASCADE_CONFORMANCE_REPORT names one a run already wrote. */
async function reportFile(): Promise<string> {
  const written = process.env.CASCADE_CONFORMANCE_REPORT;
  if (written) return written;
  const file = join(await mkdtemp(join(tmpdir(), "conformance-")), "earl.nt");
  await promisify(execFile)(process.execPath, [
    CLI,
    "conformance",
    "--report",
    file,
  ]);
  return file;
}

async function report(): Promise<{
  found: Map<string, Outcome[]>;
  requires: Map<string, string>;
}> {
  const file = await reportFile();
  const store = new Union(new OxigraphStore());
  await store.loadTurtle(await readFile(file), "urn:report");
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
  const [reported, ranBroken, ranPlanted] = await Promise.all([
    report(),
    runBroken(),
    runPlanted(),
    readTested(),
  ]);
  ({ found: outcomes, requires } = reported);
  const byName = (assertions: Awaited<ReturnType<typeof runConformance>>) =>
    assertions.map(
      ({ test, outcome, why }) =>
        [test.slice(test.indexOf("#") + 1), [outcome, why ?? ""]] as const,
    );
  const named = byName(ranBroken);
  brokenNames = named.map(([name]) => name);
  broken = new Map(named);
  planted = new Map(byName(ranPlanted));
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
    `<urn:uuid:0f4a8c26-5b3e-4d79-a1e8-6c2f9b4d7a15> a <https://ns.cascadeprotocol.org/cascade#Judgment> .`,
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
    runtime: RUNTIME,
    vocabulary: files,
    newStore: () => new OxigraphStore(),
    newPod: (address) => new MemoryFiles(address),
    layout: await layout(),
    performers: {
      creation: PERFORMERS.creation,
      judgment: PERFORMERS.judgment,
    },
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
    /^Z1\. A rule: the replay stopped at step missing: this runtime cannot yet perform a step of kind entry/,
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

const PLANTED_VERSION = "urn:uuid:0b7c9e4a-3f21-4d8e-9a65-c2d4e8f1a730";

/**
 * Runs the conformance command, in memory, on a vocabulary whose one feature file reads a version that an open gives
 * the pod, by a query the vocabulary holds.
 */
async function runPlanted(): ReturnType<typeof runConformance> {
  const files = new MemoryFiles("https://vocabulary.example/");
  const write = (path: string, text: string) =>
    files.write(path, new TextEncoder().encode(text));
  const ada = "runtime/scripted-input/ada";
  await write(
    "runtime/scripted-input/people.ttl",
    `<urn:uuid:1b4e6a52-8c3f-4d71-9e0a-5f2c7d8b9a10> <http://xmlns.com/foaf/0.1/name> "Ada" ;
       <http://www.w3.org/ns/pim/space#storage> <https://pod.example/> .`,
  );
  await write(
    `${ada}/tables/names/references.ttl`,
    `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
     <urn:uuid:5e2a8c41-7d93-4b6f-a018-9c3e7f2d4b56> a cascade:ReferenceSeries ;
       <http://www.w3.org/2000/01/rdf-schema#label> "Names" ;
       cascade:tableKind cascade:CodeNames ; cascade:defaultTableVersion <${PLANTED_VERSION}> .
     <${PLANTED_VERSION}> <http://www.w3.org/ns/prov#specializationOf> <urn:uuid:5e2a8c41-7d93-4b6f-a018-9c3e7f2d4b56> ;
       <http://purl.org/pav/version> "1" .`,
  );
  await write(
    `${ada}/tables/names/${PLANTED_VERSION.slice("urn:uuid:".length)}.ttl`,
    `<http://loinc.org/rdf/2823-3> <http://www.w3.org/2004/02/skos/core#prefLabel> "Potassium" .`,
  );
  await write(
    "queries/tables/names.rq",
    `# Every name a held version gives.
     PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
     SELECT ?name ?version WHERE { GRAPH ?version { ?code skos:prefLabel ?name } }`,
  );
  await write(
    "runtime/planted.feature",
    `Feature: Planted
  Rule: Z2. A rule
    Background:
      Given a new pod for Ada on 2026-01-01 at 09:00
      And the pod is opened with the tables "names" on 2026-01-01 at 09:01

    Example: after the open
      When the query "tables/names.rq" is asked
      Then it answers:
        | name        | version            |
        | "Potassium" | <${PLANTED_VERSION}> |

    Example: before the open
      When the pod is read as it stood after "pod"
      And the query "tables/names.rq" is asked
      Then it answers nothing

    Example: in the default graph
      When the query is:
        """
        SELECT ?thing WHERE {
          { ?thing <http://www.w3.org/2004/02/skos/core#prefLabel> ?name }
          UNION { ?thing prov:specializationOf/cascade:tableKind cascade:CodeNames }
        }
        """
      Then it answers:
        | thing              |
        | <${PLANTED_VERSION}> |

    Example: a query the vocabulary does not hold
      When the query "tables/none.rq" is asked
      Then it answers nothing
`,
  );
  return runConformance({
    runtime: RUNTIME,
    vocabulary: files,
    newStore: () => new OxigraphStore(),
    newPod: (address) => new MemoryFiles(address),
    layout: await layout(),
    performers: {
      creation: PERFORMERS.creation,
      open: () => Promise.resolve({ wrote: [] }),
    },
  });
}

test("a query by file answers the rows of the version an open gave, from that step on", () => {
  assert.deepEqual(
    [planted.get("after-the-open"), planted.get("before-the-open")],
    [
      ["passed", ""],
      ["passed", ""],
    ],
  );
});

test("a version's rows are outside the default graph, and its description in it", () => {
  assert.deepEqual(planted.get("in-the-default-graph"), ["passed", ""]);
});

test("a query the vocabulary does not hold fails its example", () => {
  const [outcome, why] =
    planted.get("a-query-the-vocabulary-does-not-hold") ?? [];
  assert.equal(outcome, "failed");
  assert.match(
    why ?? "",
    /the vocabulary has no query queries\/tables\/none\.rq/,
  );
});
