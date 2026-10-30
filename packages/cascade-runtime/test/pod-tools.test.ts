import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { Pod, Row } from "cascade-runtime";
import { TOOLS } from "cascade-runtime/tools";
import { podReads } from "cascade-runtime/tools/node";

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
const RECLASSIFIED = {
  "pod/My genetic variants": [
    { variant: VARIANT, gene: "MLH1", hgvs: "NM_000249.4:c.2042C>T" },
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
  ],
};
const INGREDIENTS = "urn:test:ingredients-v1";
const NAMES = "urn:test:names-v1";
const CLINVAR_VERSION = "urn:test:clinvar-v2026";
const ABOUT = new Map<string, unknown>([
  ...["1001", "1002", "1003"].map(
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

/** The reads over one pod with a reclassified variant and co-ingredient medications, the tables read only when `tables`; `read` names each read of them. */
function tableReads(tables: boolean, read: string[] = []) {
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
          about: async (codes: readonly string[]) =>
            new Map(
              codes.flatMap((code) =>
                ABOUT.has(code) ? [[code, ABOUT.get(code)]] : [],
              ),
            ),
          variantClassification: async () => ({
            found: "rows",
            series: "urn:test:clinvar",
            version: CLINVAR_VERSION,
            rows: [ROW],
          }),
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
    reportsDifferingFromClinVar: [
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
    medicationsSharingAnIngredient: [
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
  });
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
