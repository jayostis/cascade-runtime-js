import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { promisify } from "node:util";
import { runManifest } from "../src/conformance.js";
import { MemoryFiles, readText, relative } from "../src/files.js";
import { readManifest } from "../src/manifest.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { parseStory } from "../src/story.js";
import { ROOT, vocabulary } from "./vocabulary.js";

const EARL = "http://www.w3.org/ns/earl#";
const MANIFEST = "runtime/vectors/manifest.ttl";
const CLI = join(ROOT, "packages", "runtime", "dist", "src", "node", "cli.js");

let outcomes: Map<string, string[]>;
let entryIris: string[];

before(async () => {
  const report = join(await mkdtemp(join(tmpdir(), "conformance-")), "earl.nt");
  await promisify(execFile)(
    process.execPath,
    [CLI, "conformance", "--report", report],
    { cwd: ROOT },
  );
  const store = new OxigraphStore();
  await store.loadTurtle(await readFile(report), { graph: "urn:report" });
  const { rows } = await store.select(`PREFIX earl: <${EARL}>
    SELECT ?test ?outcome WHERE { ?assertion a earl:Assertion ; earl:test ?test ; earl:result/earl:outcome ?outcome }`);
  outcomes = new Map();
  for (const row of rows) {
    const test = row.get("test")?.value ?? "";
    outcomes.set(test, [
      ...(outcomes.get(test) ?? []),
      row.get("outcome")?.value ?? "",
    ]);
  }
  const files = await vocabulary();
  entryIris = (
    await readManifest(files, MANIFEST, () => new OxigraphStore())
  ).map((entry) => entry.iri);
});

test("the conformance command reports each rule vector once, and nothing else", () => {
  assert.deepEqual([...outcomes.keys()].sort(), [...entryIris].sort());
  for (const [test, found] of outcomes) assert.equal(found.length, 1, test);
});

test("the subject the pod's creation files passes", async () => {
  const files = await vocabulary();
  assert.deepEqual(
    outcomes.get(`${files.iri}${MANIFEST}#creation-files-the-subject`),
    [`${EARL}passed`],
  );
});

test("no vector passes whose story, by its step, needs an import, an entry or a matcher run", async () => {
  const files = await vocabulary();
  for (const entry of await readManifest(
    files,
    MANIFEST,
    () => new OxigraphStore(),
  )) {
    const story = parseStory(
      await readText(files, relative(files, entry.story ?? "")),
    );
    const through = story.steps.slice(
      0,
      story.steps.findIndex((step) => step.name === entry.step) + 1,
    );
    if (
      through.some((step) =>
        ["import", "entry", "matcher"].includes(step.happened.kind),
      )
    ) {
      assert.notDeepEqual(
        outcomes.get(entry.iri),
        [`${EARL}passed`],
        entry.name,
      );
    }
  }
});

test("an entry of a type the runner does not know is inapplicable", async () => {
  const vocabularyFiles = new MemoryFiles("https://vocabulary.example/");
  await vocabularyFiles.write(
    "manifest.ttl",
    new TextEncoder().encode(`
      @prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .
      <> a mf:Manifest ; mf:entries ( <#other> ) .
      <#other> a <https://tests.example/OtherTest> ; mf:name "other" ; mf:action [] .`),
  );
  const [assertion, ...others] = await runManifest({
    vocabulary: vocabularyFiles,
    manifest: "manifest.ttl",
    newStore: () => new OxigraphStore(),
    newPod: (address) => new MemoryFiles(address),
  });
  assert.equal(others.length, 0);
  assert.equal(assertion?.outcome, "inapplicable");
});
