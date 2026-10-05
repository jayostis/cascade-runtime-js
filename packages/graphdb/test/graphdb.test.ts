import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, test } from "node:test";
import {
  DERIVED,
  MemoryFiles,
  OxigraphStore,
  type PodBuild,
  podDataset,
  questions,
  type VocabularyQuery,
  written,
} from "@cascade-runtime/runtime";
import { findRoot, localVocabulary } from "@cascade-runtime/runtime/node";
import { GraphDB, GraphDBRefusal, load } from "../src/index.js";
import { FakeGraphDB } from "./fake-graphdb.js";

const ADDRESS = "https://pod.example/";
const LENS = "everyday";
const RECORD = "records/allergies/one.ttl";

let fake: FakeGraphDB;
let pod: PodBuild;
let asked: ReadonlyMap<string, VocabularyQuery>;

before(async () => {
  const vocabulary = await localVocabulary(
    findRoot(dirname(fileURLToPath(import.meta.url))),
  );
  const files = new MemoryFiles(ADDRESS);
  const encode = (text: string) => new TextEncoder().encode(text);
  await files.write(
    vocabulary.layout.card,
    encode(
      `<${ADDRESS}${vocabulary.layout.card}#me> <http://www.w3.org/ns/pim/space#storage> <${ADDRESS}> .\n`,
    ),
  );
  await files.write(
    RECORD,
    encode(
      "<urn:x:record> a <https://ns.cascadeprotocol.org/health/v1#AllergyRecord> .\n",
    ),
  );
  pod = await podDataset(
    files,
    vocabulary.layout,
    vocabulary.build,
    LENS,
    new OxigraphStore(),
    { title: "One record", at: "2027-01-01T00:00:00Z" },
  );
  asked = await questions(vocabulary.files);
  fake = await FakeGraphDB.start();
});

beforeEach(() => {
  fake.repositories.clear();
  fake.graphs.clear();
  fake.saved = new Map();
  fake.refuseStatementsAfter = undefined;
});

after(() => fake.close());

async function triples(ntriples: string | undefined): Promise<Set<string>> {
  return new Set(
    (await new OxigraphStore().parse(ntriples ?? "", ADDRESS)).map((triple) =>
      triple.map(written).join(" "),
    ),
  );
}

test("a load creates the repository, sends each file of the pod and the derived state as graphs of their own, and saves every question", async () => {
  const loaded = await load(
    new GraphDB(fake.url, "one"),
    pod.title,
    pod.store,
    asked,
  );

  assert.deepEqual([...fake.repositories], ["one"]);
  assert.ok(fake.graphs.has(ADDRESS + RECORD));
  assert.deepEqual(
    await triples(fake.graphs.get(ADDRESS + RECORD)),
    new Set([
      "<urn:x:record> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://ns.cascadeprotocol.org/health/v1#AllergyRecord>",
    ]),
  );
  assert.deepEqual(
    await triples(fake.graphs.get(DERIVED + LENS)),
    new Set(
      pod.derived.flatMap(({ added }) =>
        added.map((triple) => triple.map(written).join(" ")),
      ),
    ),
  );
  assert.equal(loaded.graphs, fake.graphs.size);
  assert.deepEqual(
    fake.saved,
    new Map([...asked].map(([name, { text }]) => [name, text])),
  );
});

test("a load refused partway removes the repository it created and says why, and the rerun loads, replacing the saved queries", async () => {
  fake.saved = new Map([...asked.keys()].map((name) => [name, "stale"]));
  fake.refuseStatementsAfter = 1;
  const said: string[] = [];
  await assert.rejects(
    load(new GraphDB(fake.url, "one"), pod.title, pod.store, asked, (line) =>
      said.push(line),
    ),
    (error) =>
      error instanceof GraphDBRefusal &&
      /answered 500: refused/.test(error.message),
  );
  assert.deepEqual([...fake.repositories], []);
  assert.match(said.join("\n"), /removed the repository one/);

  fake.refuseStatementsAfter = undefined;
  await load(new GraphDB(fake.url, "one"), pod.title, pod.store, asked);
  assert.ok(![...fake.saved.values()].includes("stale"));
});

test("a question asked through the loader returns the rows the server answers", async () => {
  fake.repositories.add("one");
  fake.answer = {
    head: { vars: ["thing"] },
    results: { bindings: [{ thing: { type: "uri", value: "urn:x:record" } }] },
  };
  const query = asked.get("pod/How many of each kind")?.text ?? "";
  const answer = await new GraphDB(fake.url, "one").ask(query);

  assert.deepEqual(fake.asked, [query]);
  assert.ok(typeof answer !== "boolean");
  assert.deepEqual(
    answer.rows.map((row) => row.get("thing")?.value),
    ["urn:x:record"],
  );
});
