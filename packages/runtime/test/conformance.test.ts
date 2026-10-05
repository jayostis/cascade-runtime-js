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
/** Each example and check the report must hold, by its IRI, with its name. */
const tested = new Map<string, string>();

interface Outcome {
  readonly outcome: string;
  readonly why?: string;
}

async function report(): Promise<Map<string, Outcome[]>> {
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
  return found;
}

before(async () => {
  const reported = report();
  const files = await vocabulary();
  for (const path of await featuresOf(files))
    for (const { iri, name } of (await readFeature(files, path)).examples)
      tested.set(iri, name);
  const kits = await kitsOf(files);
  assert.ok(kits.length > 0, "the vocabulary has no kit");
  for (const kit of kits)
    for (const check of Object.values(KIT_CHECKS))
      tested.set(`${files.iri}${kit}/#${check}`, check);
  outcomes = await reported;
});

test("the conformance command reports each example of every feature file and each kit's checks once, and nothing else", () => {
  assert.deepEqual([...outcomes.keys()].sort(), [...tested.keys()].sort());
  for (const [test, found] of outcomes) assert.equal(found.length, 1, test);
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

test("each example fails or passes on its own: a step no phrase reads, a step that throws, and a pod read before a later step of the same name", async () => {
  const files = new MemoryFiles("https://vocabulary.example/");
  const write = (path: string, text: string) =>
    files.write(path, new TextEncoder().encode(text));
  await write(
    "runtime/scripted-input/people.ttl",
    `<urn:uuid:1b4e6a52-8c3f-4d71-9e0a-5f2c7d8b9a10> <http://xmlns.com/foaf/0.1/name> "Ada" ;
       <http://www.w3.org/ns/pim/space#storage> <https://pod.example/> .`,
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

    Example: an entry whose file is missing
      Given a new pod for Ada on 2026-01-01 at 09:00
      When Ada enters "missing" on 2026-01-02 at 09:00
      Then that step wrote no file

    Example: a judgment filed twice, read after the first
      Given a new pod for Ada on 2026-01-01 at 09:00
      And Ada files the judgment "same" on 2026-01-02 at 09:00
      When the pod is read as it stood after "same"
      And Ada files the judgment "same" on 2026-01-03 at 09:00 (again)
      Then that step wrote 1 file
`,
  );
  const assertions = await runConformance({
    vocabulary: files,
    newStore: () => new OxigraphStore(),
    newPod: (address) => new MemoryFiles(address),
    layout: await layout(),
  });
  const outcome = new Map(
    assertions.map(({ test, outcome, why }) => [
      test.slice(test.indexOf("#") + 1),
      [outcome, why ?? ""],
    ]),
  );
  assert.equal(outcome.size, 3);
  const [cheese, why] = outcome.get("a-step-nobody-wrote") ?? [];
  assert.equal(cheese, "failed");
  assert.match(
    why ?? "",
    /^Z1\. A rule: no step of runtime\/steps\.md reads "the pod is made of cheese"/,
  );
  const [missing, stopped] =
    outcome.get("an-entry-whose-file-is-missing") ?? [];
  assert.equal(missing, "failed");
  assert.match(stopped ?? "", /^Z1\. A rule: the replay stopped at step/);
  assert.deepEqual(outcome.get("a-judgment-filed-twice-read-after-the-first"), [
    "passed",
    "",
  ]);
});
