import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { Pod, Row } from "cascade-runtime";
import { replayKit } from "cascade-runtime/fixtures";
import {
  COMPACT_QUESTIONS,
  LEFT_OUT_OF_THE_COMPACT_READ,
  PAGE_CHARACTERS,
  TOOLS,
} from "cascade-runtime/tools";
import { podReads, podsIn } from "cascade-runtime/tools/node";

const RXNORM = "https://ns.cascadeprotocol.org/codes/rxnorm/";
const LOINC = "http://loinc.org/";

const MEDICATIONS: Row[] = [
  {
    medication: "Drug 111",
    code: `${RXNORM}111`,
    started: "2024-03-04",
    entry: "urn:cascade:entry-medication",
  },
];
const LABS: Row[] = [
  ["2024-01-01", "160"],
  ["2024-02-01", "158"],
  ["2024-03-01", "165"],
  ["2024-04-01", "100"],
  ["2024-05-01", "98"],
  ["2024-06-01", "96"],
].map(([day, value], n) => ({
  performed: `${day}T16:00:00Z`,
  test: "Test A",
  code: `${LOINC}A`,
  value: value!,
  unit: "mg/dL",
  entry: `urn:cascade:entry-lab-${n}`,
}));

/** What each tool is given, and the read it calls. A tool added to `TOOLS` needs a row. */
const RUNS: Record<string, [Record<string, unknown>, string]> = {
  list_pods: [{}, "pods"],
  find_changes: [{ pod: "p" }, "tool"],
  finding_rows: [{ pod: "p", key: "k" }, "tool"],
  lab_series: [{ pod: "p", test: "t" }, "tool"],
  timeline: [{ pod: "p" }, "tool"],
  ask: [{ pod: "p", question: "pod/My lab results" }, "ask"],
  reference_table_checks: [{ pod: "p" }, "tables"],
};

test("each tool calls the one read it names, and nothing else", async () => {
  assert.deepEqual(
    TOOLS.map(({ name }) => name).sort(),
    Object.keys(RUNS).sort(),
  );
  for (const tool of TOOLS) {
    const [input, read] = RUNS[tool.name]!;
    const called: string[] = [];
    const recording = new Proxy(
      {},
      {
        get: (_, op: string) => async () => {
          called.push(op);
          if (op === "tables") return undefined;
          return op === "pods" ? { pods: [] } : { value: [] };
        },
      },
    );
    await tool.run(recording as never, input);
    assert.deepEqual(called, [read], tool.name);
  }
});

test("find_changes, lab_series and timeline name the entry of each medication and result they give", async () => {
  const pod = {
    ask: async (question: string) =>
      question === "pod/My lab results" ? LABS : MEDICATIONS,
    close: async () => undefined,
  } as unknown as Pod;
  const reads = podReads({ names: async () => ["p"], open: async () => pod });
  const run = (name: string, input: Record<string, unknown>) =>
    TOOLS.find((tool) => tool.name === name)!.run(reads, {
      pod: "p",
      ...input,
    });
  const [finding] = (await run("find_changes", {})) as {
    medication: { entry: string };
  }[];
  assert.equal(finding!.medication.entry, "urn:cascade:entry-medication");
  const { results } = (await run("lab_series", { test: "A" })) as {
    results: { entry: string }[];
  };
  assert.deepEqual(
    results.map(({ entry }) => entry),
    LABS.map(({ entry }) => entry),
  );
  const [medication] = (await run("timeline", {})) as { entry: string }[];
  assert.equal(medication!.entry, "urn:cascade:entry-medication");
  await reads.close();
});

test("calls that arrive together before a pod is open open it once, and close closes it", async () => {
  let opens = 0;
  let closes = 0;
  const reads = podReads({
    names: async () => ["p"],
    open: async () => {
      opens += 1;
      return {
        ask: async () => LABS,
        close: async () => {
          closes += 1;
        },
      } as unknown as Pod;
    },
  });
  const run = (name: string, input: Record<string, unknown>) =>
    TOOLS.find((tool) => tool.name === name)!.run(reads, {
      pod: "p",
      ...input,
    });
  await Promise.all([
    run("ask", { question: "pod/My lab results" }),
    run("ask", { question: "pod/My medication history" }),
    run("timeline", {}),
  ]);
  await reads.close();
  assert.deepEqual([opens, closes], [1, 1]);
});

test("a pod that fails to open is forgotten: the next call opens it again", async () => {
  let opens = 0;
  const reads = podReads({
    names: async () => ["p"],
    open: async () => {
      opens += 1;
      if (opens === 1) throw new Error("the disk was busy");
      return { ask: async () => LABS, close: async () => undefined } as never;
    },
  });
  const ask = () => reads.ask({ pod: "p", question: "pod/My lab results" });
  await assert.rejects(ask(), /the disk was busy/);
  assert.equal((await ask()).total, LABS.length);
  assert.equal(opens, 2);
  await reads.close();
});

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const CLINVAR = "https://identifiers.org/clinvar:";
const ENTRY = "urn:cascade:entry-";
const VARIANT = `${ENTRY}variant`;
const REPORTED = `${ENTRY}report-2019`;
const UNCOVERED = `${ENTRY}variant-uncovered`;
const REPORT_ONLY = `${ENTRY}variant-report-only`;
const RECLASSIFIED = {
  "pod/My genetic variants": [
    { variant: VARIANT, gene: "MLH1", hgvs: "NM_000249.4:c.2042C>T" },
    { variant: UNCOVERED, gene: "BRCA1", hgvs: "NM_007294.4:c.68_69del" },
  ],
  "pod/What each report says of a variant": [
    {
      report: `${ENTRY}report-2024`,
      variant: VARIANT,
      classification: `${CASCADE}Pathogenic`,
      date: "2024-01-10",
    },
    {
      report: REPORTED,
      variant: VARIANT,
      classification: `${CASCADE}Benign`,
      date: "2019-05-02",
    },
    { report: `${ENTRY}report-of-a-variant-only`, variant: REPORT_ONLY },
  ],
};
const ACTIVE = `${CASCADE}MedicationActive`;
const CO_INGREDIENT = {
  "pod/My medication history": [
    {
      entry: `${ENTRY}a`,
      medication: "Drug 1001",
      code: `${RXNORM}1001`,
      lifecycle: ACTIVE,
    },
    {
      entry: `${ENTRY}b`,
      medication: "Drug 1002",
      code: `${RXNORM}1002`,
      lifecycle: ACTIVE,
    },
    {
      entry: `${ENTRY}stopped`,
      medication: "Drug 1003",
      code: `${RXNORM}1003`,
      lifecycle: `${CASCADE}MedicationStopped`,
    },
    {
      entry: `${ENTRY}same-code`,
      medication: "Drug 1002",
      code: `${RXNORM}1002`,
      lifecycle: ACTIVE,
    },
    {
      entry: `${ENTRY}a`,
      medication: "Drug 1004",
      code: `${RXNORM}1004`,
      lifecycle: ACTIVE,
    },
    {
      entry: `${ENTRY}paused`,
      medication: "Drug 1003",
      code: `${RXNORM}1003`,
      lifecycle: `${CASCADE}MedicationPaused`,
    },
    { entry: `${ENTRY}no-code`, medication: "Pain relief", lifecycle: ACTIVE },
    {
      entry: `${ENTRY}unmapped`,
      medication: "Drug 1005",
      code: `${RXNORM}1005`,
      lifecycle: ACTIVE,
    },
  ],
};
const INGREDIENTS = "urn:test:ingredients-v1";
const NAMES = "urn:test:names-v1";
const CLINVAR_VERSION = "urn:test:clinvar-v2026";
const ABOUT = new Map<string, unknown>([
  ...["1001", "1002", "1003", "1004"].map(
    (code) =>
      [
        `${RXNORM}${code}`,
        {
          notation: code,
          ingredients: { codes: [`${RXNORM}9001`], origin: INGREDIENTS },
        },
      ] as const,
  ),
  [
    `${RXNORM}9001`,
    {
      notation: "9001",
      name: { label: "ingredient a", altLabels: [], origin: NAMES },
    },
  ],
]);
const ROW = {
  variation: `${CLINVAR}90011`,
  classification: [{ iri: `${CASCADE}Pathogenic`, label: "Pathogenic" }],
};

/** A ClinVar series and a product ingredients series, each with its current version. */
const HELD = [
  {
    iri: "urn:test:clinvar",
    kind: `${CASCADE}VariantClassifications`,
    current: { iri: CLINVAR_VERSION },
  },
  {
    iri: "urn:test:ingredients",
    kind: `${CASCADE}ProductIngredients`,
    current: { iri: INGREDIENTS },
  },
];

/**
 * The reads over one pod with a reclassified variant and co-ingredient medications, the tables read only when
 * `tables`, holding the series `held`; `read` names each read of them.
 */
function tableReads(tables: boolean, read: string[] = [], held = HELD) {
  const pod = {
    ask: async (question: string) =>
      (({ ...RECLASSIFIED, ...CO_INGREDIENT }) as Record<string, Row[]>)[
        question
      ] ?? [],
    agreement: async () => {
      read.push("agreement");
      return [
        {
          report: REPORTED,
          row: ROW.variation,
          origin: CLINVAR_VERSION,
          verdict: "differs",
        },
        {
          report: `${ENTRY}report-2024`,
          row: ROW.variation,
          origin: CLINVAR_VERSION,
          verdict: "agrees",
        },
      ];
    },
    close: async () => undefined,
  } as unknown as Pod;
  return podReads(
    {
      names: async () => ["p"],
      open: async () => pod,
      tables: async () => {
        read.push("tables");
        return {
          held: async () => held,
          about: async (codes: readonly string[]) => {
            read.push("about");
            return new Map(
              codes.flatMap((code) =>
                ABOUT.has(code) ? [[code, ABOUT.get(code)]] : [],
              ),
            );
          },
          variantClassification: async ({ gene }: { gene?: string }) => {
            read.push("variantClassification");
            return gene === "MLH1"
              ? {
                  found: "rows",
                  series: "urn:test:clinvar",
                  version: CLINVAR_VERSION,
                  rows: [ROW],
                }
              : {
                  found: "not covered",
                  series: "urn:test:clinvar",
                  version: CLINVAR_VERSION,
                  genes: ["MLH1"],
                };
          },
        } as never;
      },
    },
    { tables },
  );
}

const checks = TOOLS.find(({ name }) => name === "reference_table_checks");

test("reference_table_checks gives, with the tables, each report that differs from ClinVar today and each pair of active medications in two entries whose codes share an ingredient, as rows naming the entries and the table row cited", async () => {
  const reads = tableReads(true);
  assert.deepEqual(await checks!.run(reads, { pod: "p" }), {
    tables: "on",
    reportsDifferingFromClinVar: {
      held: true,
      versions: [CLINVAR_VERSION],
      rows: [
        {
          entry: VARIANT,
          report: REPORTED,
          date: "2019-05-02",
          classification: `${CASCADE}Benign`,
          clinvar: {
            series: "urn:test:clinvar",
            version: CLINVAR_VERSION,
            variation: ROW.variation,
            classification: ROW.classification,
          },
        },
      ],
      notChecked: [
        { entry: UNCOVERED, reason: "not covered", genes: ["MLH1"] },
        { entry: REPORT_ONLY, reason: "not asked" },
      ],
    },
    medicationsSharingAnIngredient: {
      held: true,
      versions: [INGREDIENTS],
      rows: [
        {
          entries: [
            { entry: `${ENTRY}a`, code: `${RXNORM}1001`, origin: INGREDIENTS },
            { entry: `${ENTRY}b`, code: `${RXNORM}1002`, origin: INGREDIENTS },
          ],
          ingredient: {
            code: `${RXNORM}9001`,
            label: "ingredient a",
            origin: NAMES,
          },
        },
        {
          entries: [
            { entry: `${ENTRY}a`, code: `${RXNORM}1001`, origin: INGREDIENTS },
            {
              entry: `${ENTRY}same-code`,
              code: `${RXNORM}1002`,
              origin: INGREDIENTS,
            },
          ],
          ingredient: {
            code: `${RXNORM}9001`,
            label: "ingredient a",
            origin: NAMES,
          },
        },
      ],
      notChecked: [
        { entry: `${ENTRY}no-code`, reason: "no code" },
        {
          entry: `${ENTRY}unmapped`,
          code: `${RXNORM}1005`,
          reason: "no ingredients row",
        },
      ],
    },
  });
  await reads.close();
});

test("reference_table_checks with the tables but no ClinVar or product ingredients series held says each is not held, so no list reads as nothing found, and asks the tables nothing for either", async () => {
  const read: string[] = [];
  const reads = tableReads(true, read, []);
  assert.deepEqual(await checks!.run(reads, { pod: "p" }), {
    tables: "on",
    reportsDifferingFromClinVar: { held: false },
    medicationsSharingAnIngredient: { held: false },
  });
  assert.deepEqual(read, ["tables"]);
  await reads.close();
});

test("reference_table_checks without the tables says they are off, gives no rows and never reads them", async () => {
  const read: string[] = [];
  const reads = tableReads(false, read);
  const answer = (await checks!.run(reads, { pod: "p" })) as Record<
    string,
    unknown
  >;
  assert.equal(answer.tables, "off");
  assert.match(String(answer.said), /tables are off/);
  assert.deepEqual(Object.keys(answer).sort(), ["said", "tables"]);
  assert.deepEqual(read, []);
  await reads.close();
});

test("the tools bundle for a page: nothing of Node is behind them", async () => {
  const { errors } = await build({
    entryPoints: [fileURLToPath(import.meta.resolve("cascade-runtime/tools"))],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  assert.deepEqual(errors, []);
});

test("ask offers the question a model reads every report's and note's text by, and asks the pod it", async () => {
  const asked: string[] = [];
  const pod = {
    ask: async (question: string) => {
      asked.push(question);
      return [];
    },
    close: async () => undefined,
  } as unknown as Pod;
  const reads = podReads({ names: async () => ["p"], open: async () => pod });
  await TOOLS.find((tool) => tool.name === "ask")!.run(reads, {
    pod: "p",
    question: "pod/My reports, notes and documents",
  });
  await reads.close();
  assert.deepEqual(asked, ["pod/My reports, notes and documents"]);
});

const ask = TOOLS.find((tool) => tool.name === "ask")!;
const PROVENANCE = "entry/Where it came from";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const record = (n: number) =>
  `urn:uuid:00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DOCUMENT = `ni:///sha-256;${"d".repeat(43)}`;

interface Compact {
  readonly views: readonly {
    readonly question: string;
    readonly total: number;
    readonly offset: number;
    readonly shown: number;
    readonly text: string;
  }[];
  readonly leftOut?: string;
  readonly next?: Record<string, unknown>;
}
const idsOf = (text: string) =>
  text
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split("\t")[0]!);

let kits: string;
before(
  async () => {
    kits = await mkdtemp(join(tmpdir(), "compact-"));
    await replayKit("tamsin-vale", join(kits, "tamsin-vale"));
  },
  { timeout: 120_000 },
);
after(() => rm(kits, { recursive: true, force: true, maxRetries: 5 }));

test("ask's compact read of Tamsin's pod is one answer under the page budget, with every entry of every view it covers, each view's count, handles that name their entries, and no IRI but the person's", async () => {
  const reads = podReads(podsIn(kits));
  const pod = "tamsin-vale";
  const answer = (await ask.run(reads, { pod, format: "compact" })) as Compact;
  const text = JSON.stringify(answer);
  assert.ok(text.length <= PAGE_CHARACTERS, `${text.length} characters`);
  assert.equal(answer.next, undefined);
  assert.deepEqual(
    answer.views.map(({ question }) => question),
    COMPACT_QUESTIONS,
  );
  for (const view of answer.views) {
    const { total, rows } = await reads.ask({ pod, question: view.question });
    assert.deepEqual(
      [view.total, view.offset, view.shown, idsOf(view.text).length],
      [total, 0, total, total],
      view.question,
    );
    const entries = new Set(rows.flatMap(({ entry }) => entry ?? []));
    if (entries.size === 0) continue;
    const named = (await ask.run(reads, {
      pod,
      question: PROVENANCE,
      entries: [...new Set(idsOf(view.text))],
    })) as { rows: Row[] };
    assert.deepEqual(
      new Set(named.rows.map(({ entry }) => entry)),
      entries,
      view.question,
    );
  }
  const [person] = (
    await reads.ask({ pod, question: "pod/The person this pod is about" })
  ).rows;
  assert.deepEqual(
    [...new Set(text.match(/pod:\/\/|urn:uuid:[0-9a-f-]+|ni:\/\/\//g))],
    [person!.subject],
  );
  const of = async (question: string) =>
    new Set((await reads.ask({ pod, question })).rows.map((it) => it.entry));
  for (const [subset, whole] of Object.entries(LEFT_OUT_OF_THE_COMPACT_READ)) {
    const parent = await of(whole);
    for (const entry of await of(subset))
      assert.ok(parent.has(entry), `${subset}: ${entry} is in ${whole}`);
    assert.ok(answer.leftOut?.includes(subset), subset);
  }
  await reads.close();
});

/**
 * A pod of `labs` lab results, each its own entry of one record, all from one document of one pull; the nth row's record
 * has the nth of `texts` as the text its source wrote for it.
 */
function labPod(labs: number, texts: readonly string[] = []) {
  const rows: Row[] = Array.from({ length: labs }, (_, n) => ({
    performed: `2024-${String(1 + (n % 12)).padStart(2, "0")}-01T16:00:00Z`,
    test: `Test ${n}, named at the length a panel's tests are`,
    code: `${LOINC}rdf/${n}-0`,
    value: String(n),
    unit: "mg/dL",
    records: "1",
    ...(texts[n] === undefined
      ? {}
      : { narrativeTexts: `${record(n)} ${texts[n]}` }),
    entry: `pod://p/clinical/lab-results.ttl#${sha(record(n))}`,
    sources: `${record(n)} from ${DOCUMENT}, retrieved 2024-02-01T00:00:00Z, written by Lab`,
  }));
  const provenance: Row[] = rows.map(({ entry }, n) => ({
    entry: entry!,
    record: record(n),
    import: record(1_000_000),
    importLabel: "FHIR pull",
    document: DOCUMENT,
    hospital: "Lab",
    retrieved: "2024-02-01T00:00:00Z",
  }));
  return podReads({
    names: async () => ["p"],
    open: async () =>
      ({
        ask: async (question: string) =>
          question === "pod/My lab results"
            ? rows
            : question === PROVENANCE
              ? provenance
              : [],
        close: async () => undefined,
      }) as unknown as Pod,
  });
}

test("a source's text for an entry is shown only where it adds words its row does not already say, a date written in words being the row's date", async () => {
  const reads = labPod(2, [
    "Test 0, named at the length a panel's tests are\n0 mg/dL\nJanuary 1, 2024 16:00 UTC",
    "Test 1, named at the length a panel's tests are\n1 mg/dL\nhistorical result",
  ]);
  const { views } = (await ask.run(reads, {
    pod: "p",
    format: "compact",
    question: "pod/My lab results",
  })) as Compact;
  const [header, ...lines] = views[0]!.text.split("\n");
  const at = header!.split("\t").indexOf("narrativeTexts");
  assert.deepEqual(
    lines.map((line) => line.split("\t")[at]),
    [
      "S1 Test 1, named at the length a panel's tests are\\n1 mg/dL\\nhistorical result",
      "",
    ],
  );
  await reads.close();
});

test("a read longer than a page goes on from the offset its answer names: every page under the budget, every row on exactly one", async () => {
  const reads = labPod(400);
  const shown = new Map<string, string[]>();
  let input: Record<string, unknown> = { pod: "p", format: "compact" };
  let pages = 0;
  for (;;) {
    const page = (await ask.run(reads, input)) as Compact;
    pages += 1;
    assert.ok(JSON.stringify(page).length <= PAGE_CHARACTERS, `page ${pages}`);
    for (const view of page.views) {
      const ids = idsOf(view.text);
      assert.equal(ids.length, view.shown, view.question);
      assert.equal(view.offset, shown.get(view.question)?.length ?? 0);
      shown.set(view.question, [...(shown.get(view.question) ?? []), ...ids]);
    }
    if (page.next === undefined) break;
    input = { pod: "p", ...page.next };
  }
  assert.ok(pages > 1, `${pages} page`);
  assert.deepEqual([...shown.keys()], COMPACT_QUESTIONS);
  assert.equal(new Set(shown.get("pod/My lab results")).size, 400);
  const tail = (await ask.run(reads, {
    pod: "p",
    question: "pod/My lab results",
    offset: 390,
    limit: 50,
  })) as { total: number; offset: number; rows: Row[] };
  assert.deepEqual([tail.total, tail.offset, tail.rows.length], [400, 390, 10]);
  await reads.close();
});

test("a handle names its entry by a view letter and the start of the entry's fragment, a stale one the entry its record is merged into now; a handle that names none, entries not a list of strings, rows with no question and a compact read with a limit are refused", async () => {
  const entry = `pod://p/clinical/conditions.ttl#${sha(record(1))}`;
  const reads = podReads({
    names: async () => ["p"],
    open: async () =>
      ({
        ask: async (question: string) =>
          question === PROVENANCE
            ? [1, 2].map((n) => ({ entry, record: record(n) }))
            : [],
        close: async () => undefined,
      }) as unknown as Pod,
  });
  const named = async (handle: string) =>
    (
      (await ask.run(reads, {
        pod: "p",
        question: PROVENANCE,
        entries: [handle],
      })) as { rows: Row[] }
    ).rows.map((it) => it.entry);
  assert.deepEqual(await named(`C${sha(record(1)).slice(0, 8)}`), [
    entry,
    entry,
  ]);
  assert.deepEqual(
    await named(`C${sha(record(2)).slice(0, 10)}`),
    [entry, entry],
    "the entry was named by record 2 before record 1 joined it",
  );
  for (const [input, why] of [
    [
      { question: PROVENANCE, entries: [`L${sha(record(1)).slice(0, 8)}`] },
      /no entry .* has the handle/,
    ],
    [
      { question: PROVENANCE, entries: [`C${sha(record(3)).slice(0, 8)}`] },
      /no entry .* has the handle/,
    ],
    [{ format: "rows" }, /rows answer one question/],
    [{ format: "compact", limit: 10 }, /limit is for rows/],
    [
      { question: PROVENANCE, entries: `C${sha(record(1)).slice(0, 8)}` },
      /entries must be an array/,
    ],
    [{ question: PROVENANCE, entries: [1] }, /entries\[0\] must be a string/],
  ] as const)
    await assert.rejects(
      async () => ask.run(reads, { pod: "p", ...input }),
      (error: Error) => error.name === "Refusal" && why.test(error.message),
      JSON.stringify(input),
    );
  await reads.close();
});
