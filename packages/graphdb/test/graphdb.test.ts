import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
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
      "<urn:x:record> a <https://ns.cascadeprotocol.org/cascade#AllergyOrIntolerance> .\n",
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

after(() => fake.close());

async function triples(ntriples: string | undefined): Promise<Set<string>> {
  return new Set(
    (await new OxigraphStore().parse(ntriples ?? "", ADDRESS)).map((triple) =>
      triple.map(written).join(" "),
    ),
  );
}

/**
 * `load` copies a pod into a GraphDB server, so that a developer can explore its records in GraphDB's workbench: it
 * creates a repository, sends each file of the pod as a named graph and the derived state as one more, and saves each
 * named question as a saved query. A load that fails leaves no half-filled repository behind, which a second load
 * would refuse. The tests run against `test/fake-graphdb.ts`, a local server that answers as GraphDB does.
 */
describe("Loading a pod into GraphDB · load(), GraphDB", () => {
  const load_ = (said?: (line: string) => void) =>
    load(new GraphDB(fake.url, "one"), pod.title, pod.store, asked, said);

  describe("load(graphdb, title, store, questions)", () => {
    let loaded: Awaited<ReturnType<typeof load>>;

    before(async () => {
      fake.reset();
      loaded = await load_();
    });

    it("creates the repository", () => {
      assert.deepEqual([...fake.repositories], ["one"]);
    });

    it("sends each file of the pod as a named graph, under the file's address", async () => {
      assert.ok(fake.graphs.has(ADDRESS + RECORD));
      assert.deepEqual(
        await triples(fake.graphs.get(ADDRESS + RECORD)),
        new Set([
          "<urn:x:record> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://ns.cascadeprotocol.org/cascade#AllergyOrIntolerance>",
        ]),
      );
    });

    it("sends the derived state as one graph, named for its lens", async () => {
      assert.deepEqual(
        await triples(fake.graphs.get(DERIVED + LENS)),
        new Set(
          pod.derived.flatMap(({ added }) =>
            added.map((triple) => triple.map(written).join(" ")),
          ),
        ),
      );
    });

    it("returns how many graphs it sent", () => {
      assert.equal(loaded.graphs, fake.graphs.size);
    });

    it("saves each named question as a saved query, under the question's name", () => {
      assert.deepEqual(
        fake.saved,
        new Map([...asked].map(([name, { text }]) => [name, text])),
      );
    });
  });

  describe("when the server refuses a graph partway through", () => {
    let error: unknown;
    const said: string[] = [];

    before(async () => {
      fake.reset();
      fake.saved = new Map([...asked.keys()].map((name) => [name, "stale"]));
      fake.refuseStatementsAfter = 1;
      error = await load_((line) => said.push(line)).catch(
        (caught: unknown) => caught,
      );
    });

    it("rejects with `GraphDBRefusal`, giving the server's status and its words", () => {
      assert.ok(error instanceof GraphDBRefusal);
      assert.match(error.message, /answered 500: refused/);
    });

    it("removes the repository it created", () => {
      assert.deepEqual([...fake.repositories], []);
    });

    it("logs that it removed the repository", () => {
      assert.match(said.join(", "), /removed the repository one/);
    });
  });

  describe("when a load is run again after one that was refused", () => {
    before(async () => {
      fake.reset();
      fake.saved = new Map([...asked.keys()].map((name) => [name, "stale"]));
      fake.refuseStatementsAfter = 1;
      await load_().catch(() => undefined);
      fake.refuseStatementsAfter = undefined;
      await load_();
    });

    it("replaces the saved queries that were there before", () => {
      assert.ok(![...fake.saved.values()].includes("stale"));
      assert.deepEqual([...fake.repositories], ["one"], "the rerun loaded");
    });
  });

  describe("when the server already holds the repository", () => {
    let error: unknown;

    before(async () => {
      fake.reset();
      fake.repositories.add("one");
      error = await load_().catch((caught: unknown) => caught);
    });

    it("rejects with `GraphDBRefusal`, saying nothing changed", () => {
      assert.ok(error instanceof GraphDBRefusal);
      assert.match(
        error.message,
        /already has a repository one; nothing changed/,
      );
    });

    it("leaves the repository as it was", () => {
      assert.equal(fake.graphs.size, 0);
      assert.deepEqual([...fake.repositories], ["one"]);
    });
  });

  describe("when the server gives no answer", () => {
    let error: unknown;

    before(async () => {
      const gone = await FakeGraphDB.start();
      const url = gone.url;
      await gone.close();
      error = await load(
        new GraphDB(url, "one"),
        pod.title,
        pod.store,
        asked,
      ).catch((caught: unknown) => caught);
    });

    it("rejects with `GraphDBRefusal`, naming the URL it asked", () => {
      assert.ok(error instanceof GraphDBRefusal);
      assert.match(error.message, /\/rest\/repositories gave no answer/);
    });
  });
});

/**
 * `ask` sends a SPARQL query to a repository and returns the rows the server answers, in the form `pod.ask()` returns
 * them, so that a question written for a pod can be tried in GraphDB.
 */
describe("Asking a GraphDB repository a question · GraphDB.ask()", () => {
  describe("ask(query)", () => {
    const query = () => asked.get("pod/How many of each kind")?.text ?? "";
    let answer: Awaited<ReturnType<GraphDB["ask"]>>;

    before(async () => {
      fake.reset();
      fake.repositories.add("one");
      fake.answer = {
        head: { vars: ["thing"] },
        results: {
          bindings: [{ thing: { type: "uri", value: "urn:x:record" } }],
        },
      };
      answer = await new GraphDB(fake.url, "one").ask(query());
    });

    it("sends the query as written", () => {
      assert.deepEqual(fake.asked, [query()]);
    });

    it("returns the rows the server answers", () => {
      assert.ok(typeof answer !== "boolean");
      assert.deepEqual(
        answer.rows.map((row) => row.get("thing")?.value),
        ["urn:x:record"],
      );
    });
  });
});
