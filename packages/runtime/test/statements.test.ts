import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { earl } from "../src/conformance.js";
import { readText } from "../src/files.js";
import { openDatabase } from "../src/node/sqlite.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { sqlCheckAssertions, vectorFailures } from "../src/sql-check.js";
import {
  loadStatements,
  SQL_FUNCTION_VECTORS,
  sqlDatabaseFunctions,
  sqlFunctions,
  STATEMENTS_SCHEMA,
} from "../src/statements.js";
import type { Database, DatabaseFunction } from "../src/database.js";
import { layout, vocabulary } from "./vocabulary.js";

const JUDGMENTS = "queries/questions/pod/How many judgments count.rq";
const MAPPED = "<https://ns.cascadeprotocol.org/cascade#SameMappedCode>";
const XSD = "http://www.w3.org/2001/XMLSchema#";

/**
 * The vocabulary keeps a `.sql` beside each question's `.rq`, over its schema of a pod's statements in SQLite, calling six
 * functions where SQLite has no answer of its own. The runtime loads a pod into that schema, registers the functions,
 * and checks each `.sql` gives its `.rq`'s rows on every fixture, under each lens, as EARL assertions.
 */
describe("Answering the vocabulary's SQL from a pod's statements · loadStatements(), sqlFunctions(), sqlCheckAssertions()", () => {
  let db: Database;

  before(async () => {
    db = openDatabase(":memory:", { functions: await sqlDatabaseFunctions() });
  });

  after(() => db.close());

  it("gives each vector's output from its input, and refuses each input a vector marks refused", async () => {
    const { functions } = JSON.parse(await readText(await vocabulary(), SQL_FUNCTION_VECTORS)) as {
      functions: Record<string, { vectors: Parameters<typeof vectorFailures>[1] }>;
    };
    const implemented = await sqlFunctions();
    assert.deepEqual(Object.keys(functions).sort(), Object.keys(implemented).sort());
    for (const [name, { vectors }] of Object.entries(functions))
      assert.deepEqual(vectorFailures(implemented[name], vectors), [], name);
  });

  it("registers the six on a connection, each taking as many arguments as it is given, a whole number given back as an integer", () => {
    assert.deepEqual(
      db
        .prepare(
          `SELECT sparql_decimal('+', '0.1', '0.2') AS sum, sparql_decimal('floor', '-2.5') AS floor,
             typeof(sparql_compare('"a"', '"b"')) AS kind, sparql_compare('"a"', '"b"') AS compared`,
        )
        .get(),
      { sum: "0.3", floor: "-3", kind: "integer", compared: -1 },
    );
  });

  it("loads a store's graphs, each term once with its kind, lexical form, datatype and calendar keys, every record in scope", async () => {
    const pod = openDatabase(":memory:");
    loadStatements(
      pod,
      await readText(await vocabulary(), STATEMENTS_SCHEMA),
      [
        {
          graph: "urn:x:file",
          ntriples: [
            `<urn:x:a> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://ns.cascadeprotocol.org/cascade#Record> .`,
            `<urn:x:a> <urn:x:at> "2025-03-27T07:00:00.5-05:00"^^<${XSD}dateTime> .`,
            `<urn:x:a> <urn:x:said> "a\\nb"@en .`,
          ].join("\n"),
        },
      ],
      "test",
    );
    assert.deepEqual(
      pod.prepare("SELECT nt, kind, lex, datatype, lang, instant, day FROM term WHERE kind = 3 ORDER BY nt").all(),
      [
        {
          nt: `"2025-03-27T07:00:00.5-05:00"^^<${XSD}dateTime>`,
          kind: 3,
          lex: "2025-03-27T07:00:00.5-05:00",
          datatype: `${XSD}dateTime`,
          lang: null,
          instant: "2025-03-27T12:00:00.500000000000000000",
          day: "2025-03-27",
        },
        {
          nt: '"a\\nb"@en',
          kind: 3,
          lex: "a\nb",
          datatype: "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
          lang: "en",
          instant: null,
          day: null,
        },
      ],
    );
    assert.deepEqual(pod.prepare("SELECT t.nt FROM scope JOIN term t ON t.id = scope.term").all(), [{ nt: "<urn:x:a>" }]);
    assert.deepEqual(pod.prepare("SELECT built, fingerprint FROM ledger").all(), [{ built: "pod", fingerprint: "test" }]);
    pod.close();
  });

  it("asserts failed, naming the fixture, the query and the row, a .sql that drops a value from a row the fixture's manifest pins", async () => {
    const files = await vocabulary();
    const text = await readText(files, JUDGMENTS.replace(/\.rq$/, ".sql"));
    const broken =
      `SELECT verdict, CASE WHEN justification = '${MAPPED}' THEN NULL ELSE justification END AS justification, ` +
      `madeBy, judgments FROM (${text})`;
    const options = {
      vocabulary: files,
      newStore: () => new OxigraphStore(),
      layout: await layout(),
      open: (functions: readonly DatabaseFunction[]) =>
        openDatabase(":memory:", { functions }),
    };
    const held = await sqlCheckAssertions(options, ["which-judgments-count"]);
    const mine = held.filter(({ name }) => name.startsWith(JUDGMENTS.replace(/\.rq$/, ".sql")));
    assert.deepEqual(
      mine.map(({ outcome }) => outcome),
      ["passed", "passed"],
      mine.map(({ why }) => why ?? "").join("\n"),
    );
    const found = await sqlCheckAssertions(options, ["which-judgments-count"], { [JUDGMENTS]: broken });
    const everyday = found.find(({ name }) => name.endsWith("under everyday") && name.startsWith("queries/questions/pod/How many"));
    assert.equal(everyday?.outcome, "failed");
    const why = everyday?.why ?? "";
    assert.match(why, new RegExp(`which-judgments-count, under everyday, ${JUDGMENTS}, against the \\.rq: missing: [^\\n]*\\?justification=${MAPPED.replace(/[.#]/g, "\\$&")}`));
    assert.match(why, new RegExp(`how-many-count-everyday, under everyday, ${JUDGMENTS}: missing: [^\\n]*\\?justification=${MAPPED.replace(/[.#]/g, "\\$&")}`));
    const report = new TextDecoder().decode(earl(found, "cascade-runtime-js"));
    assert.ok(report.includes("<http://www.w3.org/ns/earl#failed>"));
  });
});
