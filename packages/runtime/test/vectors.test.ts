import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { promisify } from "node:util";
import { runManifest } from "../src/conformance.js";
import { MemoryFiles, readText, relative } from "../src/files.js";
import {
  type ManifestEntry,
  MF,
  readManifest,
  REPLAY_TEST,
} from "../src/manifest.js";
import { FolderFiles } from "../src/node/folder-files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { parseStory, type Story } from "../src/story.js";
import { ROOT, vocabulary } from "./vocabulary.js";

const EARL = "http://www.w3.org/ns/earl#";
const MANIFEST = "runtime/vectors/manifest.ttl";
const CLI = join(ROOT, "packages", "runtime", "dist", "src", "node", "cli.js");

let files: FolderFiles;
let entries: ManifestEntry[];
const stories = new Map<string, Story>();
let outcomes: Map<string, string[]>;

async function report(): Promise<Map<string, string[]>> {
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
    SELECT ?test ?outcome WHERE { ?assertion a earl:Assertion ; earl:test ?test ; earl:result/earl:outcome ?outcome }`);
  const found = new Map<string, string[]>();
  for (const row of rows) {
    const test = row.get("test")?.value ?? "";
    found.set(test, [
      ...(found.get(test) ?? []),
      row.get("outcome")?.value ?? "",
    ]);
  }
  return found;
}

before(async () => {
  const reported = report();
  files = await vocabulary();
  entries = await readManifest(files, MANIFEST, () => new OxigraphStore());
  for (const entry of entries) {
    const path = relative(files, entry.story ?? "");
    if (!stories.has(path))
      stories.set(path, parseStory(await readText(files, path)));
  }
  outcomes = await reported;
});

function storyOf(entry: ManifestEntry): Story {
  const story = stories.get(relative(files, entry.story ?? ""));
  assert.ok(story, entry.name);
  return story;
}

test("the manifest reader finds every rule vector, with its story, a step of it, its lens, query and result", async () => {
  const store = new OxigraphStore();
  await store.loadTurtle(await readText(files, MANIFEST), {
    graph: files.iri + MANIFEST,
  });
  const { rows } = await store.select(
    `SELECT (COUNT(DISTINCT ?entry) AS ?n) WHERE { ?entry <${MF}action> ?action }`,
  );
  assert.equal(entries.length, Number(rows[0]?.get("n")?.value));
  assert.equal(new Set(entries.map((entry) => entry.iri)).size, entries.length);
  for (const entry of entries) {
    assert.ok(entry.types.includes(REPLAY_TEST), entry.name);
    for (const file of [entry.lens, entry.query, entry.result]) {
      assert.ok(
        file !== undefined &&
          (await files.read(relative(files, file))) !== undefined,
        `${entry.name}: ${file}`,
      );
    }
    assert.ok(
      storyOf(entry).steps.some((step) => step.name === entry.step),
      `${entry.name}: ${entry.step}`,
    );
  }
});

test("the conformance command reports each rule vector once, and nothing else", () => {
  assert.deepEqual(
    [...outcomes.keys()].sort(),
    entries.map((entry) => entry.iri).sort(),
  );
  for (const [test, found] of outcomes) assert.equal(found.length, 1, test);
});

test("the subject the pod's creation files passes", () => {
  assert.deepEqual(
    outcomes.get(`${files.iri}${MANIFEST}#creation-files-the-subject`),
    [`${EARL}passed`],
  );
});

test("no vector passes whose story, by its step, needs an import, an entry or a matcher run", () => {
  for (const entry of entries) {
    const { steps } = storyOf(entry);
    const through = steps.slice(
      0,
      steps.findIndex((step) => step.name === entry.step) + 1,
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
