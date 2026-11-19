import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { earl } from "../src/conformance.js";
import { MemoryFiles, readText } from "../src/files.js";
import { openDatabase } from "../src/node/sqlite.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import {
  compared,
  finalOrder,
  keyedFillFailures,
  madeScreens,
  sqlCheckAssertions,
  sqlFailures,
  sqlFunctionAssertions,
  sqlTest,
  vectorFailures,
} from "../src/sql-check.js";
import { Union } from "../src/store.js";
import {
  askedOf,
  askedWhole,
  loadStatements,
  sparqlDecimal,
  sqlAnswer,
  SQL_FUNCTION_VECTORS,
  sqlDatabaseFunctions,
  sqlFunctions,
  sqlStatements,
  STATEMENTS_SCHEMA,
} from "../src/statements.js";
import type { Database, DatabaseFunction } from "../src/database.js";
import { layout, vocabulary } from "./vocabulary.js";

const JUDGMENTS = "queries/questions/pod/How many judgments count.rq";
const MAPPED = "<https://ns.cascadeprotocol.org/cascade#SameMappedCode>";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const IN_ENTRY = `<${CASCADE}inEntry>`;

/** A pod of two records, each the one record of its entry, in the vocabulary's schema with an `asked` table. */
async function twoEntries(): Promise<Database> {
  const pod = openDatabase(":memory:", {
    functions: await sqlDatabaseFunctions(),
  });
  loadStatements(
    pod,
    `${await readText(await vocabulary(), STATEMENTS_SCHEMA)}
CREATE TABLE IF NOT EXISTS asked (term INTEGER PRIMARY KEY) STRICT;`,
    [
      {
        graph: "urn:x:file",
        ntriples: ["a", "b"]
          .flatMap((name) => [
            `<urn:x:${name}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${CASCADE}Record> .`,
            `<urn:x:${name}> ${IN_ENTRY} <urn:x:entry-${name}> .`,
            `<urn:x:entry-${name}> <${CASCADE}entryMember> <urn:x:${name}> .`,
          ])
          .join("\n"),
      },
    ],
    "test",
  );
  return pod;
}

/** A screen of one table, each entry and its record, whose fill clears the whole table when `clearsAll`. */
const screen = (name: string, fill: string, clearsAll = false): string =>
  [
    "-- part: tables",
    `CREATE TABLE ${name} (entry INTEGER PRIMARY KEY, record INTEGER NOT NULL) STRICT;`,
    "-- part: fill",
    clearsAll
      ? `DELETE FROM ${name};`
      : `DELETE FROM ${name} WHERE entry IN (SELECT o FROM quad WHERE p = (SELECT id FROM term WHERE nt = '${IN_ENTRY}') AND s IN (SELECT term FROM scope));`,
    fill,
    "-- part: finish",
    "-- part: triples",
    `SELECT NULL AS s, NULL AS p, NULL AS o FROM ${name}`,
  ].join("\n");

const FILLED = (name: string): string =>
  `INSERT INTO ${name} SELECT o, s FROM quad WHERE p = (SELECT id FROM term WHERE nt = '${IN_ENTRY}') AND s IN (SELECT term FROM scope);`;

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
    const { functions } = JSON.parse(
      await readText(await vocabulary(), SQL_FUNCTION_VECTORS),
    ) as {
      functions: Record<
        string,
        { vectors: Parameters<typeof vectorFailures>[1] }
      >;
    };
    const implemented = await sqlFunctions();
    assert.deepEqual(
      Object.keys(functions).sort(),
      Object.keys(implemented).sort(),
    );
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
      pod
        .prepare(
          "SELECT nt, kind, lex, datatype, lang, instant, day FROM term WHERE kind = 3 ORDER BY nt",
        )
        .all(),
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
    assert.deepEqual(
      pod
        .prepare("SELECT t.nt FROM scope JOIN term t ON t.id = scope.term")
        .all(),
      [{ nt: "<urn:x:a>" }],
    );
    assert.deepEqual(
      pod.prepare("SELECT built, fingerprint FROM ledger").all(),
      [{ built: "pod", fingerprint: "test" }],
    );
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
    const mine = held.filter(({ name }) =>
      name.startsWith(JUDGMENTS.replace(/\.rq$/, ".sql")),
    );
    assert.deepEqual(
      mine.map(({ outcome }) => outcome),
      ["passed", "passed"],
      mine.map(({ why }) => why ?? "").join("\n"),
    );
    const found = await sqlCheckAssertions(options, ["which-judgments-count"], {
      [JUDGMENTS]: broken,
    });
    const everyday = found.find(
      ({ name }) =>
        name.endsWith("under everyday") &&
        name.startsWith("queries/questions/pod/How many"),
    );
    assert.equal(everyday?.outcome, "failed");
    const why = everyday?.why ?? "";
    assert.match(
      why,
      new RegExp(
        `which-judgments-count, under everyday, ${JUDGMENTS}, against the \\.rq: missing: [^\\n]*\\?justification=${MAPPED.replace(/[.#]/g, "\\$&")}`,
      ),
    );
    assert.match(
      why,
      new RegExp(
        `how-many-count-everyday, under everyday, ${JUDGMENTS}: missing: [^\\n]*\\?justification=${MAPPED.replace(/[.#]/g, "\\$&")}`,
      ),
    );
    const report = new TextDecoder().decode(earl(found, "cascade-runtime-js"));
    assert.ok(report.includes("<http://www.w3.org/ns/earl#failed>"));
  });

  it("gives a list question's rows without its trailing page_key, and the key of each row as it was written", () => {
    assert.deepEqual(
      sqlAnswer(
        db,
        "SELECT '<urn:x:a>' AS entry, '34D69677.' AS page_key UNION ALL SELECT NULL, 'mnmp~'",
      ),
      {
        columns: ["entry"],
        rows: [["<urn:x:a>"], [null]],
        keys: ["34D69677.", "mnmp~"],
      },
    );
  });

  it("splits a part into its statements at each ; outside a string, a quoted name and a comment, so each is compiled once and run again", () => {
    assert.deepEqual(
      sqlStatements(
        `-- a; comment\nCREATE TABLE "a;b" (v TEXT);\nINSERT INTO [a;b] VALUES ('x;''y') /* ; */;\n-- the end\n`,
      ).map((statement) => statement.trim()),
      [
        `-- a; comment\nCREATE TABLE "a;b" (v TEXT)`,
        "INSERT INTO [a;b] VALUES ('x;''y') /* ; */",
      ],
    );
  });

  it("gives no SQL assertion, and throws nothing, for a vocabulary with no SQL", async () => {
    const empty = new MemoryFiles("urn:x:vocabulary/");
    assert.deepEqual(await sqlFunctionAssertions(empty), []);
    assert.deepEqual(
      await sqlCheckAssertions({
        vocabulary: empty,
        newStore: () => new OxigraphStore(),
        layout: await layout(),
        open: (functions) => openDatabase(":memory:", { functions }),
      }),
      [],
    );
  });

  it("asks a question bound to records through asked, leaving scope to the build, and says when the pod holds none of them", async () => {
    const pod = await twoEntries();
    const held = (table: string): unknown[] =>
      pod
        .prepare(
          `SELECT t.nt FROM ${table} JOIN term t ON t.id = ${table}.term ORDER BY t.nt`,
        )
        .all()
        .map(({ nt }) => nt);
    const scope = held("scope");
    assert.equal(askedOf(pod, ["urn:x:nowhere"]), false);
    assert.deepEqual(held("asked"), []);
    assert.equal(askedOf(pod, ["urn:x:a", "urn:x:nowhere"]), true);
    assert.deepEqual(held("asked"), ["<urn:x:a>"]);
    assert.deepEqual(held("scope"), scope);
    askedWhole(pod);
    assert.deepEqual(held("asked"), []);
    pod.close();
  });

  it("fails only the screen whose part throws, naming it and the part, and the questions that read it", async () => {
    const pod = await twoEntries();
    const failed = madeScreens(pod, [
      {
        rq: "queries/views/good.rq",
        rqText: "",
        sql: screen("good", FILLED("good")),
      },
      {
        rq: "queries/views/bad.rq",
        rqText: "",
        sql: screen("bad", "INSERT INTO nowhere VALUES (1);"),
      },
      {
        rq: "queries/questions/reads-good.rq",
        rqText: "",
        sql: "SELECT entry FROM good",
      },
      {
        rq: "queries/questions/reads-bad.rq",
        rqText: "",
        sql: "SELECT entry FROM bad",
      },
    ]);
    assert.deepEqual([...failed.keys()].sort(), [
      "queries/questions/reads-bad.rq",
      "queries/views/bad.rq",
    ]);
    assert.match(
      failed.get("queries/views/bad.rq") ?? "",
      /queries\/views\/bad\.sql fails in its fill part: .*nowhere/,
    );
    assert.match(
      failed.get("queries/questions/reads-bad.rq") ?? "",
      /reads the screen of queries\/views\/bad\.sql/,
    );
    assert.equal(pod.prepare("SELECT count(*) AS n FROM good").get()?.n, 2);
    pod.close();
  });

  it("reports a screen whose fill, keyed to a record, does not give the tables a whole fill gives", async () => {
    for (const [clearsAll, wanted] of [
      [false, 0],
      [true, 2],
    ] as const) {
      const pod = await twoEntries();
      const views = [
        {
          rq: "queries/views/s.rq",
          rqText: "",
          sql: screen("s", FILLED("s"), clearsAll),
        },
      ];
      assert.deepEqual([...madeScreens(pod, views).keys()], []);
      const found = keyedFillFailures(pod, views);
      assert.equal(found.length, wanted, found.join("\n"));
      for (const line of found)
        assert.match(
          line,
          /record \d+ unchanged: s holds \[\] a whole fill does not, and lacks/,
        );
      pod.close();
    }
  });

  it("asserts failed a manifest entry that runs the query and pins no result", async () => {
    const pod = await twoEntries();
    const store = new OxigraphStore();
    try {
      const found = await sqlFailures(
        await vocabulary(),
        {
          name: "f",
          lens: "everyday",
          union: new Union(store),
          db: pod,
          entries: [
            {
              name: "pins nothing",
              query: "queries/q.rq",
              lens: "queries/lenses/everyday.rq",
              records: [],
            },
          ],
          screens: new Map(),
          close: () => undefined,
        },
        {
          rq: "queries/q.rq",
          rqText: "SELECT ?x WHERE { ?x ?p ?o }",
          sql: "SELECT NULL AS x WHERE 0",
        },
      );
      assert.deepEqual(found, [
        "f, pins nothing: it runs queries/q.rq and pins no mf:result",
      ]);
    } finally {
      pod.close();
      store.free?.();
    }
  });

  it("refuses to load a literal Oxigraph would hold in another, canonical, form", async () => {
    const schema = await readText(await vocabulary(), STATEMENTS_SCHEMA);
    for (const literal of [
      `"01"^^<${XSD}integer>`,
      `"1.50"^^<${XSD}decimal>`,
      `"1"^^<${XSD}boolean>`,
    ]) {
      const pod = openDatabase(":memory:");
      assert.throws(
        () =>
          loadStatements(
            pod,
            schema,
            [
              {
                graph: "urn:x:g",
                ntriples: `<urn:x:a> <urn:x:p> ${literal} .`,
              },
            ],
            "test",
          ),
        /not as Oxigraph writes it/,
        literal,
      );
      pod.close();
    }
  });

  it("gives null, as the vocabulary's Python does, for a decimal operand SQLite gives as the integer 0", () => {
    assert.equal(sparqlDecimal("+", 0, "1"), null);
    assert.equal(sparqlDecimal("+", "1", 0), null);
  });

  it("names a .sql's assertion with the .sql in its fragment, so a report that shows only the fragment names the query", async () => {
    assert.ok(
      sqlTest(
        await vocabulary(),
        { rq: "queries/questions/pod/My lab results.rq" },
        "f",
        "everyday",
      ).endsWith("#queries/questions/pod/My%20lab%20results.sql/f/everyday"),
    );
  });
  it("judges an ORDER BY's ties on a STR or a SUBSTR of it by that text, and on a term by SPARQL's <", () => {
    const at = (value: string): string => `"${value}"^^<${XSD}dateTime>`;
    const unzoned = at("2024-01-01T10:00:00");
    const zoned = at("2024-01-01T05:00:00-08:00");
    const whole = { start: 1, unboundEmpty: false };
    const day = { start: 1, length: 10, unboundEmpty: true };
    assert.deepEqual(
      finalOrder("SELECT ?a ?b ?c WHERE { } ORDER BY DESC(?b) ?a STR(?c) ?c", [
        "a",
        "b",
        "c",
      ]),
      [{ column: 1 }, { column: 0 }, { column: 2, read: whole }, { column: 2 }],
    );
    assert.deepEqual(
      finalOrder(
        'SELECT ?a ?b WHERE { } ORDER BY DESC(COALESCE(SUBSTR(STR(?a), 1, 10), "")) ?b',
        ["a", "b"],
      ),
      [{ column: 0, read: day }, { column: 1 }],
    );
    assert.deepEqual(
      compared(
        ["t"],
        [[zoned], [unzoned]],
        [[unzoned], [zoned]],
        [{ column: 0 }],
      ),
      [],
    );
    assert.deepEqual(
      compared(
        ["t"],
        [[zoned], [unzoned]],
        [[unzoned], [zoned]],
        [{ column: 0, read: whole }],
      ),
      [
        `the same rows in another order, from row 1: expected ?t=${zoned}, found ?t=${unzoned}`,
      ],
    );
    assert.deepEqual(
      compared(
        ["t", "u"],
        [
          [unzoned, zoned],
          [zoned, unzoned],
        ],
        [
          [zoned, unzoned],
          [unzoned, zoned],
        ],
        [{ column: 0, read: day }],
      ),
      [],
    );
    assert.notDeepEqual(
      compared(
        ["t", "u"],
        [
          [unzoned, unzoned],
          [zoned, zoned],
        ],
        [
          [zoned, zoned],
          [unzoned, unzoned],
        ],
        [
          { column: 0, read: day },
          { column: 1, read: whole },
        ],
      ),
      [],
    );
  });
});
