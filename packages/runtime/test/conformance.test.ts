import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { promisify } from "node:util";
import { runConformance } from "../src/conformance.js";
import { featuresOf, readFeature } from "../src/features.js";
import { MemoryFiles } from "../src/files.js";
import { KIT_CHECKS, kitsOf } from "../src/kit.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { PERFORMERS } from "../src/replay.js";
import { Shapes } from "../src/shapes.js";
import { Union } from "../src/store.js";
import { layout, RUNTIME, ROOT, vocabulary } from "./vocabulary.js";

const EARL = "http://www.w3.org/ns/earl#";
const CLI = join(ROOT, "packages", "runtime", "dist", "src", "node", "cli.js");
const newStore = () => new OxigraphStore();

interface Outcome {
  readonly outcome: string;
  readonly why?: string;
}

/** The outcome and why of each example a run reported, by its name, and the names in the order and number reported. */
interface Reported {
  readonly byName: ReadonlyMap<string, readonly [string, string]>;
  readonly names: readonly string[];
}

function reportedBy(
  assertions: Awaited<ReturnType<typeof runConformance>>,
): Reported {
  const named = assertions.map(
    ({ test, outcome, why }) =>
      [test.slice(test.indexOf("#") + 1), [outcome, why ?? ""]] as const,
  );
  return {
    byName: new Map(named),
    names: named.map(([name]) => name),
  };
}

/** A vocabulary in memory, written as the files of `texts`, and a run of its feature files. */
async function inMemory(
  texts: Record<string, string>,
  performers: Parameters<typeof runConformance>[0]["performers"],
  withShapes = false,
): ReturnType<typeof runConformance> {
  const files = new MemoryFiles("https://vocabulary.example/");
  for (const [path, text] of Object.entries(texts))
    await files.write(path, new TextEncoder().encode(text));
  return runConformance({
    runtime: RUNTIME,
    vocabulary: files,
    newStore,
    newPod: (address) => new MemoryFiles(address),
    layout: await layout(),
    performers,
    ...(withShapes ? { shapes: await Shapes.read(files, newStore) } : {}),
  });
}

const ADA_AND_BOB = {
  "runtime/scripted-input/people.ttl": `<urn:uuid:1b4e6a52-8c3f-4d71-9e0a-5f2c7d8b9a10> <http://xmlns.com/foaf/0.1/name> "Ada" ;
       <http://www.w3.org/ns/pim/space#storage> <https://pod.example/> .
     <urn:uuid:6d1f3b8a-2c4e-4a9f-8b7d-3e5a1c9f0b24> <http://xmlns.com/foaf/0.1/name> "Bob" ;
       <http://www.w3.org/ns/pim/space#storage> <https://bob.example/> .`,
  "runtime/scripted-input/ada/judgments/same.ttl": `<urn:uuid:0f4a8c26-5b3e-4d79-a1e8-6c2f9b4d7a15> a <https://ns.cascadeprotocol.org/cascade#Judgment> .`,
};
const WITH_JUDGMENTS = {
  creation: PERFORMERS.creation,
  judgment: PERFORMERS.judgment,
};

/** Runs the conformance command, in memory, on a vocabulary whose one feature file is of examples that cannot pass. */
function runBroken(): Promise<Reported> {
  return inMemory(
    {
      ...ADA_AND_BOB,
      "runtime/broken.feature": `Feature: Broken
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
`,
    },
    WITH_JUDGMENTS,
  ).then(reportedBy);
}

/** Runs the conformance command, in memory, on a vocabulary whose examples read a pod part way through its steps. */
function runPartWay(): Promise<Reported> {
  return inMemory(
    {
      ...ADA_AND_BOB,
      "runtime/part-way.feature": `Feature: Part way
  Rule: Z1. A rule
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
    },
    WITH_JUDGMENTS,
  ).then(reportedBy);
}

const PLANTED_VERSION = "urn:uuid:0b7c9e4a-3f21-4d8e-9a65-c2d4e8f1a730";

/**
 * Runs the conformance command, in memory, on a vocabulary whose one feature file reads a version that an open gives
 * the pod, by a query the vocabulary holds.
 */
function runPlanted(): Promise<Reported> {
  const ada = "runtime/scripted-input/ada";
  return inMemory(
    {
      "runtime/scripted-input/people.ttl": `<urn:uuid:1b4e6a52-8c3f-4d71-9e0a-5f2c7d8b9a10> <http://xmlns.com/foaf/0.1/name> "Ada" ;
       <http://www.w3.org/ns/pim/space#storage> <https://pod.example/> .`,
      [`${ada}/tables/names/references.ttl`]: `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
     <urn:uuid:5e2a8c41-7d93-4b6f-a018-9c3e7f2d4b56> a cascade:ReferenceSeries ;
       <http://www.w3.org/2000/01/rdf-schema#label> "Names" ;
       cascade:tableKind cascade:CodeNames ; cascade:defaultTableVersion <${PLANTED_VERSION}> .
     <${PLANTED_VERSION}> <http://www.w3.org/ns/prov#specializationOf> <urn:uuid:5e2a8c41-7d93-4b6f-a018-9c3e7f2d4b56> ;
       <http://purl.org/pav/version> "1" .`,
      [`${ada}/tables/names/${PLANTED_VERSION.slice("urn:uuid:".length)}.ttl`]: `<http://loinc.org/rdf/2823-3> <http://www.w3.org/2004/02/skos/core#prefLabel> "Potassium" .`,
      "queries/tables/names.rq": `# Every name a held version gives.
     PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
     SELECT ?name ?version WHERE { GRAPH ?version { ?code skos:prefLabel ?name } }`,
      "runtime/planted.feature": `Feature: Planted
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
    },
    {
      creation: PERFORMERS.creation,
      open: () => Promise.resolve({ wrote: [] }),
    },
  ).then(reportedBy);
}

/** What a kit whose story has a step no performer is given for reports when the runtime runs it. */
async function runStuckKit(): Promise<
  Awaited<ReturnType<typeof runConformance>>
> {
  return inMemory(
    {
      "conformance/broken/scripted-input/people.ttl": `<urn:uuid:7c2d9e41-5a8b-4f36-b0e2-9d1a4c6f8e53> <http://xmlns.com/foaf/0.1/name> "Ben" ;
       <http://www.w3.org/ns/pim/space#storage> <https://pod.example/> .`,
      "conformance/broken/broken.feature": `Feature: Broken
  Background: Ben's story
    Given a new pod for Ben on 2026-02-01 at 08:00
`,
    },
    {},
    true,
  );
}

/**
 * A feature file states a rule's examples in steps whose wording `runtime/steps.md` fixes. `runConformance()` compiles
 * each example's steps, replays them into a pod of its own and returns one outcome for each example, failed with a
 * sentence saying why when a step cannot be read or the replay stops.
 */
describe("Running a feature's examples on a runtime · runConformance()", () => {
  describe("given a feature file of examples that cannot pass", () => {
    let reported: Reported;

    before(async () => {
      reported = await runBroken();
    });

    /** The example's outcome, and the sentence it failed with, which the title of its rule begins. */
    const failedWith = (example: string, why: RegExp): void => {
      const [outcome, said] = reported.byName.get(example) ?? [];
      assert.equal(outcome, "failed", example);
      assert.match(said ?? "", why);
    };

    it("returns one outcome for each example of the file, and no other", () => {
      assert.deepEqual([...reported.names].sort(), [
        "a-pod-read-before-a-later-step-that-stops-the-replay",
        "a-query-that-is-no-select",
        "a-step-named-with-a-space",
        "a-step-nobody-wrote",
        "two-rows-of-one-name",
      ]);
    });

    it("puts the title of the example's rule before each failure's sentence", () => {
      for (const [name, [, why = ""]] of reported.byName)
        assert.match(why, /^Z1\. A rule: /, name);
    });

    it("fails an example with a step no phrase of `runtime/steps.md` reads, quoting the step", () => {
      failedWith(
        "a-step-nobody-wrote",
        /no step of runtime\/steps\.md reads "the pod is made of cheese"/,
      );
    });

    it("fails an example that read the pod before a later step stopped the replay, naming that step and its kind", () => {
      failedWith(
        "a-pod-read-before-a-later-step-that-stops-the-replay",
        /the replay stopped at step missing: this runtime cannot yet perform a step of kind entry/,
      );
    });

    it("fails an example whose step is named with a space", () => {
      failedWith("a-step-named-with-a-space", /"two words" cannot name a step/);
    });

    it("fails two rows of one outline that share a name, naming the file and the name", () => {
      failedWith(
        "two-rows-of-one-name",
        /two examples of runtime\/broken\.feature are named "two rows of one name"/,
      );
    });

    it("fails an example whose query is no SELECT", () => {
      failedWith("a-query-that-is-no-select", /the query is no SELECT/);
    });
  });

  describe("given an example that names another person and one that reads the pod before a judgment is filed again", () => {
    let reported: Reported;

    before(async () => {
      reported = await runPartWay();
    });

    it("passes an example that names a person of `people.ttl` other than the pod's owner", () => {
      assert.deepEqual(reported.byName.get("another-person-named"), [
        "passed",
        "",
      ]);
    });

    /**
     * The step filed again, `again`, writes no file new to the pod, so `that step wrote 1 file` is true of `same` alone.
     */
    it("reads `that step` as the step the pod is read after, not a later step that files the same judgment again", () => {
      assert.deepEqual(
        reported.byName.get("a-judgment-filed-twice-read-after-the-first"),
        ["passed", ""],
      );
    });
  });

  describe("given a feature file that queries a table version an open gave the pod", () => {
    let reported: Reported;

    before(async () => {
      reported = await runPlanted();
    });

    it("answers a query named by its file with the version's rows, in an example read after the open", () => {
      assert.deepEqual(reported.byName.get("after-the-open"), ["passed", ""]);
    });

    it("answers nothing to that query in an example read as the pod stood before the open", () => {
      assert.deepEqual(reported.byName.get("before-the-open"), ["passed", ""]);
    });

    it("answers a query of the default graph with the version's description and none of its rows", () => {
      assert.deepEqual(reported.byName.get("in-the-default-graph"), [
        "passed",
        "",
      ]);
    });

    it("fails an example whose query file the vocabulary does not hold, naming the path", () => {
      const [outcome, why] =
        reported.byName.get("a-query-the-vocabulary-does-not-hold") ?? [];
      assert.equal(outcome, "failed");
      assert.match(
        why ?? "",
        /the vocabulary has no query queries\/tables\/none\.rq/,
      );
    });
  });

  describe("given a kit whose story has a step the runtime cannot perform", () => {
    let assertions: Awaited<ReturnType<typeof runConformance>>;

    before(async () => {
      assertions = await runStuckKit();
    });

    it("returns each of the kit's five checks as failed, naming the step's kind, and does not throw", () => {
      assert.deepEqual(
        assertions.map(({ name, outcome }) => [name, outcome]),
        Object.values(KIT_CHECKS).map((check) => [check, "failed"]),
      );
      for (const { name, why } of assertions)
        assert.match(why ?? "", /kind creation/, name);
    });
  });
});

/**
 * The conformance command runs every feature file and every kit of the vocabulary beside the runtime, and writes the
 * outcomes as an EARL report that says which commits the run used. The site's conformance page is made from that file,
 * so an example the run skipped would be missing there and nowhere else. That every example and every kit check passes
 * is check 1 of a kit, run.
 * @rule runtime/the-kit.feature Check 1
 */
describe("Reporting a conformance run · npm run conformance -- --report <file>", () => {
  describe("given the report of one run over the vocabulary", () => {
    let outcomes: Map<string, Outcome[]>;
    /** Each version the report says the runtime was run with, by doap:name. */
    let requires: Map<string, string>;
    /** Each example and check the report must hold, by its IRI, with its name. */
    const tested = new Map<string, string>();

    /** The report of the conformance command, run here unless CASCADE_CONFORMANCE_REPORT names one a run already wrote. */
    async function reportFile(): Promise<string> {
      const written = process.env.CASCADE_CONFORMANCE_REPORT;
      if (written) return written;
      const file = join(
        await mkdtemp(join(tmpdir(), "conformance-")),
        "earl.nt",
      );
      await promisify(execFile)(process.execPath, [
        CLI,
        "conformance",
        "--report",
        file,
      ]);
      return file;
    }

    async function readReport(): Promise<void> {
      const store = new Union(new OxigraphStore());
      await store.loadTurtle(await readFile(await reportFile()), "urn:report");
      const { rows } = await store.select(`PREFIX earl: <${EARL}>
        SELECT ?test ?outcome ?why WHERE {
          ?assertion a earl:Assertion ; earl:test ?test ; earl:result ?result . ?result earl:outcome ?outcome
          OPTIONAL { ?result <http://purl.org/dc/terms/description> ?why }
        }`);
      outcomes = new Map();
      for (const row of rows) {
        const test = row.get("test")?.value ?? "";
        outcomes.set(test, [
          ...(outcomes.get(test) ?? []),
          {
            outcome: row.get("outcome")?.value ?? "",
            why: row.get("why")?.value,
          },
        ]);
      }
      const used = await store.select(`SELECT ?name ?revision WHERE {
          ?subject a <${EARL}TestSubject> ; <http://purl.org/dc/terms/requires> ?used .
          ?used <http://usefulinc.com/ns/doap#name> ?name ; <http://usefulinc.com/ns/doap#revision> ?revision
        }`);
      requires = new Map(
        used.rows.map((row) => [
          row.get("name")?.value ?? "",
          row.get("revision")?.value ?? "",
        ]),
      );
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
      await Promise.all([readReport(), readTested()]);
    });

    it("holds one assertion for each example of every feature file and each check of every kit, and no other", () => {
      assert.deepEqual([...outcomes.keys()].sort(), [...tested.keys()].sort());
      for (const [test, found] of outcomes) assert.equal(found.length, 1, test);
    });

    it("reports every example and every kit check as passed", () => {
      for (const [iri, name] of tested) {
        const found = outcomes.get(iri);
        assert.deepEqual(
          found?.map(({ outcome }) => outcome),
          [`${EARL}passed`],
          `${name}: ${found?.[0]?.why}`,
        );
      }
    });

    it("names the commit of the vocabulary it ran", async () => {
      assert.equal(
        requires.get("cascade-vocabulary"),
        (await vocabulary()).iri.split("/").at(-2),
      );
    });

    it("names cascade-bridge-rs and each adapter repository of `cascade-runtime.json`, and no other", async () => {
      const { adapters } = JSON.parse(
        await readFile(join(ROOT, "cascade-runtime.json"), "utf8"),
      ) as { adapters: { repository: string }[] };
      assert.deepEqual(
        [...requires.keys()].sort(),
        [
          "cascade-vocabulary",
          "cascade-bridge-rs",
          ...adapters.map(
            ({ repository }) => repository.split("/").at(-1) ?? "",
          ),
        ].sort(),
      );
    });

    it("names the Bridge by a commit, or by a build of one", () => {
      assert.match(
        requires.get("cascade-bridge-rs") ?? "",
        /^(build-)?[0-9a-f]{40}$/,
      );
    });
  });
});
