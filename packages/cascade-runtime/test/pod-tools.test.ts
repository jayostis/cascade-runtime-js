import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
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

describe("TOOLS", () => {
  it("each calls the one read it names, and nothing else", async () => {
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

  describe("a finding, a series and a timeline", () => {
    let reads: ReturnType<typeof podReads>;
    before(() => {
      const pod = {
        ask: async (question: string) =>
          question === "pod/My lab results" ? LABS : MEDICATIONS,
        close: async () => undefined,
      } as unknown as Pod;
      reads = podReads({ names: async () => ["p"], open: async () => pod });
    });
    after(() => reads.close());
    const run = (name: string, input: Record<string, unknown>) =>
      TOOLS.find((tool) => tool.name === name)!.run(reads, {
        pod: "p",
        ...input,
      });

    it("find_changes names the entry of each medication", async () => {
      const [finding] = (await run("find_changes", {})) as {
        medication: { entry: string };
      }[];
      assert.equal(finding!.medication.entry, "urn:cascade:entry-medication");
    });

    it("lab_series names the entry of each result", async () => {
      const { results } = (await run("lab_series", { test: "A" })) as {
        results: { entry: string }[];
      };
      assert.deepEqual(
        results.map(({ entry }) => entry),
        LABS.map(({ entry }) => entry),
      );
    });

    it("timeline names the entry of each medication", async () => {
      const [medication] = (await run("timeline", {})) as { entry: string }[];
      assert.equal(medication!.entry, "urn:cascade:entry-medication");
    });
  });
});

describe("podReads", () => {
  it("opens a pod once for calls that arrive together, and close closes it", async () => {
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

  it("forgets a pod that failed to open, so the next call opens it again", async () => {
    let opens = 0;
    const reads = podReads({
      names: async () => ["p"],
      open: async () => {
        opens += 1;
        if (opens === 1) throw new Error("the disk was busy");
        return {
          ask: async () => LABS,
          close: async () => undefined,
        } as never;
      },
    });
    const ask = () => reads.ask({ pod: "p", question: "pod/My lab results" });
    await assert.rejects(ask(), /the disk was busy/);
    assert.equal((await ask()).total, LABS.length);
    assert.equal(opens, 2);
    await reads.close();
  });
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

describe("reference_table_checks", () => {
  describe("with the tables", () => {
    it("names the entries and the table row of each finding", async () => {
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
                {
                  entry: `${ENTRY}a`,
                  code: `${RXNORM}1001`,
                  origin: INGREDIENTS,
                },
                {
                  entry: `${ENTRY}b`,
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
            {
              entries: [
                {
                  entry: `${ENTRY}a`,
                  code: `${RXNORM}1001`,
                  origin: INGREDIENTS,
                },
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
  });

  describe("with the tables but no ClinVar or product ingredients series held", () => {
    const read: string[] = [];
    let reads: ReturnType<typeof tableReads>;
    let answer: unknown;
    before(async () => {
      reads = tableReads(true, read, []);
      answer = await checks!.run(reads, { pod: "p" });
    });
    after(() => reads.close());

    it("says each is not held, so no list reads as nothing found", () => {
      assert.deepEqual(answer, {
        tables: "on",
        reportsDifferingFromClinVar: { held: false },
        medicationsSharingAnIngredient: { held: false },
      });
    });

    it("asks the tables nothing for either", () => {
      assert.deepEqual(read, ["tables"]);
    });
  });

  describe("without the tables", () => {
    const read: string[] = [];
    let reads: ReturnType<typeof tableReads>;
    let answer: Record<string, unknown>;
    before(async () => {
      reads = tableReads(false, read);
      answer = (await checks!.run(reads, { pod: "p" })) as Record<
        string,
        unknown
      >;
    });
    after(() => reads.close());

    it("says they are off", () => {
      assert.equal(answer.tables, "off");
      assert.match(String(answer.said), /tables are off/);
    });

    it("gives no rows", () => {
      assert.deepEqual(Object.keys(answer).sort(), ["said", "tables"]);
    });

    it("never reads them", () => {
      assert.deepEqual(read, []);
    });
  });
});

describe("the tools entry bundled for a page", () => {
  let errors: unknown[];
  let inputs: string[];
  before(async () => {
    const bundle = await build({
      entryPoints: [
        fileURLToPath(import.meta.resolve("cascade-runtime/tools")),
      ],
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    errors = bundle.errors;
    inputs = Object.keys(bundle.metafile.inputs);
  });

  it("has nothing of Node behind it", () => {
    assert.deepEqual(errors, []);
  });

  it("holds no compact read", () => {
    assert.deepEqual(
      inputs.filter((it) => /compact-read/.test(it)),
      [],
    );
  });
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

const documentOf = (n: number) => `ni:///sha-256;${String(n).repeat(43)}`;
const entryOf = (view: string, n: number) =>
  `pod://p/${view}.ttl#${sha(`entry ${n}`)}`;
/** A record of an entry, from the document of the hospital `n` names (1 Alpha Clinic, 2 Beta Hospital). */
const recordOf = (entry: string, n: number, from: 1 | 2): Row => ({
  entry,
  record: record(n),
  import: record(900 + from),
  importLabel: "C-CDA download",
  document: documentOf(from),
  hospital: from === 1 ? "Alpha Clinic" : "Beta Hospital",
  retrieved: "2025-08-01T00:00:00Z",
});
const sourced = (n: number, from: 1 | 2) =>
  `${record(n)} from ${documentOf(from)}`;
/** The pod whose questions answer `views`, and whose records are `provenance`. */
function podOf(views: Record<string, Row[]>, provenance: Row[]) {
  return podReads({
    names: async () => ["p"],
    open: async () =>
      ({
        ask: async (question: string) =>
          question === PROVENANCE ? provenance : (views[question] ?? []),
        close: async () => undefined,
      }) as unknown as Pod,
  });
}
/** A compact view's lines, each as its cells by the header's names. */
const linesOf = (text: string) => {
  const [header = "", ...lines] = text.split("\n");
  const names = header.split("\t");
  return lines.map((line) =>
    Object.fromEntries(line.split("\t").map((cell, at) => [names[at], cell])),
  );
};
/** The first compact line of the view `question`, in a pod answering `views` with records `provenance`. */
async function compactLine(
  views: Record<string, Row[]>,
  provenance: Row[],
  question: string,
) {
  const reads = podOf(views, provenance);
  try {
    const answer = (await ask.run(reads, {
      pod: "p",
      format: "compact",
      question,
    })) as Compact;
    return linesOf(answer.views[0]!.text)[0]!;
  } finally {
    await reads.close();
  }
}

describe("ask", () => {
  it("accepts the reports, notes and documents question and asks the pod it", async () => {
    const asked: string[] = [];
    const pod = {
      ask: async (question: string) => {
        asked.push(question);
        return [];
      },
      close: async () => undefined,
    } as unknown as Pod;
    const reads = podReads({ names: async () => ["p"], open: async () => pod });
    await ask.run(reads, {
      pod: "p",
      question: "pod/My reports, notes and documents",
    });
    await reads.close();
    assert.deepEqual(asked, ["pod/My reports, notes and documents"]);
  });

  describe("in the compact read of Tamsin's pod", () => {
    const pod = "tamsin-vale";
    let kits: string;
    let reads: ReturnType<typeof podReads>;
    let answer: Compact;
    before(
      async () => {
        kits = await mkdtemp(join(tmpdir(), "compact-"));
        await replayKit("tamsin-vale", join(kits, "tamsin-vale"));
        reads = podReads(podsIn(kits));
        answer = (await ask.run(reads, { pod, format: "compact" })) as Compact;
      },
      { timeout: 120_000 },
    );
    after(async () => {
      await reads.close();
      await rm(kits, { recursive: true, force: true, maxRetries: 5 });
    });

    it("the answer is one page under the budget", () => {
      const text = JSON.stringify(answer);
      assert.ok(text.length <= PAGE_CHARACTERS, `${text.length} characters`);
      assert.equal(answer.next, undefined);
    });

    it("every view is one the compact read covers", () => {
      assert.deepEqual(
        answer.views.map(({ question }) => question),
        COMPACT_QUESTIONS,
      );
    });

    it("each view gives its count and every entry, by handles that name them", async () => {
      for (const view of answer.views) {
        const { total, rows } = await reads.ask({
          pod,
          question: view.question,
        });
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
    });

    it("no IRI appears but the person's", async () => {
      const text = JSON.stringify(answer);
      const [person] = (
        await reads.ask({ pod, question: "pod/The person this pod is about" })
      ).rows;
      assert.deepEqual(
        [...new Set(text.match(/pod:\/\/|urn:uuid:[0-9a-f-]+|ni:\/\/\//g))],
        [person!.subject],
      );
    });

    it("leaves out only views whose entries another view holds, and says so", async () => {
      const of = async (question: string) =>
        new Set(
          (await reads.ask({ pod, question })).rows.map((it) => it.entry),
        );
      for (const [subset, whole] of Object.entries(
        LEFT_OUT_OF_THE_COMPACT_READ,
      )) {
        const parent = await of(whole);
        for (const entry of await of(subset))
          assert.ok(parent.has(entry), `${subset}: ${entry} is in ${whole}`);
        assert.ok(answer.leftOut?.includes(subset), subset);
      }
    });
  });

  describe("a source's text in the compact read", () => {
    it("is shown only where it adds words its row does not already say", async () => {
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

    it("never drops a status, a conclusion or its prose for words the row says", async () => {
      const [condition, medication, report] = [
        entryOf("conditions", 1),
        entryOf("medications", 2),
        entryOf("reports", 3),
      ] as [string, string, string];
      const reads = podOf(
        {
          "pod/My condition history": [
            {
              condition: "Pulmonary embolism",
              status: "ruled out",
              statuses: `${record(1)} ruled out; ${record(2)} active`,
              entry: condition,
              sources: `${sourced(1, 1)}; ${sourced(2, 2)}`,
            },
          ],
          "pod/My medication history": [
            {
              medication: "Progress note on warfarin plan",
              status: "on-hold",
              statuses: `${record(3)} on-hold; ${record(4)} active`,
              narrativeTexts: `${record(3)} hold warfarin; warfarin plan reviewed; progress note`,
              entry: medication,
              sources: `${sourced(3, 1)}; ${sourced(4, 2)}`,
            },
          ],
          "pod/My reports, notes and documents": [
            {
              kind: "Report",
              name: "CT angiography chest (pulmonary embolism protocol)",
              conclusion: "Pulmonary embolism.",
              entry: report,
              sources: sourced(5, 1),
            },
          ],
        },
        [
          recordOf(condition, 1, 1),
          recordOf(condition, 2, 2),
          recordOf(medication, 3, 1),
          recordOf(medication, 4, 2),
          recordOf(report, 5, 1),
        ],
      );
      const { views } = (await ask.run(reads, {
        pod: "p",
        format: "compact",
      })) as Compact;
      const lines = (question: string) =>
        linesOf(views.find((it) => it.question === question)!.text)[0]!;
      const drug = lines("pod/My medication history");
      assert.deepEqual(
        [
          lines("pod/My condition history").statuses,
          drug.statuses,
          drug.narrativeTexts,
          lines("pod/My reports, notes and documents").conclusion,
        ],
        [
          "S1 ruled out; S2 active",
          "S1 on-hold; S2 active",
          "S1 hold warfarin; warfarin plan reviewed; progress note",
          "Pulmonary embolism.",
        ],
      );
      await reads.close();
    });

    it("is compared only with the values its source gave, so one contradicting its status stays", async () => {
      const entry = entryOf("conditions", 1);
      const line = await compactLine(
        {
          "pod/My condition history": [
            {
              condition: "Pulmonary embolism",
              status: "ruled out",
              statuses: `${record(1)} active; ${record(2)} ruled out`,
              narrativeTexts: `${record(1)} Pulmonary embolism ruled out; ${record(2)} Embolism, pulmonary: active`,
              entry,
              sources: `${sourced(1, 1)}; ${sourced(2, 2)}`,
            },
          ],
        },
        [recordOf(entry, 1, 1), recordOf(entry, 2, 2)],
        "pod/My condition history",
      );
      assert.equal(
        line.narrativeTexts,
        "S1 Pulmonary embolism ruled out; S2 Embolism, pulmonary: active",
      );
    });

    it("stays where its words come from the row's name and a status no source states", async () => {
      const entry = entryOf("conditions", 1);
      const line = await compactLine(
        {
          "pod/My condition history": [
            {
              condition: "Pulmonary embolism",
              verificationStatus: "refuted",
              status: "active",
              statuses: `${record(1)} active; ${record(2)} active`,
              narrativeTexts: `${record(1)} Pulmonary embolism refuted; ${record(2)} Embolism, pulmonary: active`,
              entry,
              sources: `${sourced(1, 1)}; ${sourced(2, 2)}`,
            },
          ],
        },
        [recordOf(entry, 1, 1), recordOf(entry, 2, 2)],
        "pod/My condition history",
      );
      assert.equal(line.narrativeTexts, "S1 Pulmonary embolism refuted");
    });
  });

  describe("what needs review in the compact read", () => {
    const [one, other] = [
      entryOf("medications", 1),
      entryOf("medications", 2),
    ] as [string, string];
    const review = (recordLabel: string, otherRecordLabel: string) =>
      compactLine(
        {
          "entry/What needs review": [
            {
              entry: one,
              entryLabel: "Medication entry · losartan 50 mg tablet",
              needs: "possibly the same medication",
              record: record(1),
              recordLabel,
              otherRecord: record(2),
              otherRecordLabel,
            },
          ],
        },
        [recordOf(one, 1, 1), recordOf(other, 2, 2)],
        "entry/What needs review",
      );

    it("gives a record retrieved from a document less its kind, its author and the document", async () => {
      const line = await review(
        "Medication · losartan 50 mg tablet · Clearwater · ccda_2026.xml",
        "Medication · losartan potassium 50 MG Oral Tablet · Fernhill",
      );
      assert.equal(line.record, "S1 losartan 50 mg tablet");
      assert.match(
        line.otherRecord!,
        /^S2 in M[0-9a-f]{8,} losartan potassium 50 MG Oral Tablet$/,
      );
    });

    it("gives each record by its source and its own label, so two of one source are told apart", async () => {
      const line = await review(
        "Medication · losartan 50 mg tablet · Clearwater · received 2026-11-02",
        "Medication · losartan potassium 50 MG Oral Tablet · Fernhill · received 2026-11-02",
      );
      assert.equal(line.record, "S1 losartan 50 mg tablet");
      assert.match(
        line.otherRecord!,
        /^S2 in M[0-9a-f]{8,} losartan potassium 50 MG Oral Tablet$/,
      );
    });
  });

  describe("a compact read longer than a page", () => {
    let reads: ReturnType<typeof labPod>;
    before(() => {
      reads = labPod(400);
    });
    after(() => reads.close());

    it("goes on from the offset its answer names, every row on one page under the budget", async () => {
      const shown = new Map<string, string[]>();
      let input: Record<string, unknown> = { pod: "p", format: "compact" };
      let pages = 0;
      for (;;) {
        const page = (await ask.run(reads, input)) as Compact;
        pages += 1;
        assert.ok(
          JSON.stringify(page).length <= PAGE_CHARACTERS,
          `page ${pages}`,
        );
        for (const view of page.views) {
          const ids = idsOf(view.text);
          assert.equal(ids.length, view.shown, view.question);
          assert.equal(view.offset, shown.get(view.question)?.length ?? 0);
          shown.set(view.question, [
            ...(shown.get(view.question) ?? []),
            ...ids,
          ]);
        }
        if (page.next === undefined) break;
        input = { pod: "p", ...page.next };
      }
      assert.ok(pages > 1, `${pages} page`);
      assert.deepEqual([...shown.keys()], COMPACT_QUESTIONS);
      assert.equal(new Set(shown.get("pod/My lab results")).size, 400);
    });

    it("rows from an offset with a limit end at the last row", async () => {
      const tail = (await ask.run(reads, {
        pod: "p",
        question: "pod/My lab results",
        offset: 390,
        limit: 50,
      })) as { total: number; offset: number; rows: Row[] };
      assert.deepEqual(
        [tail.total, tail.offset, tail.rows.length],
        [400, 390, 10],
      );
    });
  });

  describe("given entries to name", () => {
    const entry = `pod://p/clinical/conditions.ttl#${sha(record(1))}`;
    let reads: ReturnType<typeof podReads>;
    before(() => {
      reads = podReads({
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
    });
    after(() => reads.close());
    const named = async (handle: string) =>
      (
        (await ask.run(reads, {
          pod: "p",
          question: PROVENANCE,
          entries: [handle],
        })) as { rows: Row[] }
      ).rows.map((it) => it.entry);

    it("finds an entry by a view letter and the start of its fragment", async () => {
      assert.deepEqual(await named(`C${sha(record(1)).slice(0, 8)}`), [
        entry,
        entry,
      ]);
    });

    it("finds, for a stale handle, the entry its record is merged into now", async () => {
      assert.deepEqual(
        await named(`C${sha(record(2)).slice(0, 10)}`),
        [entry, entry],
        "the entry was named by record 2 before record 1 joined it",
      );
    });

    for (const [what, input, why] of [
      [
        "a handle of another view",
        { question: PROVENANCE, entries: [`L${sha(record(1)).slice(0, 8)}`] },
        /no entry .* has the handle/,
      ],
      [
        "a handle that names no entry",
        { question: PROVENANCE, entries: [`C${sha(record(3)).slice(0, 8)}`] },
        /no entry .* has the handle/,
      ],
      ["rows with no question", { format: "rows" }, /rows answer one question/],
      [
        "a compact read with a limit",
        { format: "compact", limit: 10 },
        /limit is for rows/,
      ],
      [
        "entries that are not a list",
        { question: PROVENANCE, entries: `C${sha(record(1)).slice(0, 8)}` },
        /entries must be an array/,
      ],
      [
        "an entry that is not a string",
        { question: PROVENANCE, entries: [1] },
        /entries\[0\] must be a string/,
      ],
    ] as const)
      it(`refuses ${what}`, async () => {
        await assert.rejects(
          async () => ask.run(reads, { pod: "p", ...input }),
          (error: Error) => error.name === "Refusal" && why.test(error.message),
          JSON.stringify(input),
        );
      });
  });

  describe("in a host that cannot make the compact read", () => {
    it("refuses, saying so", async () => {
      await assert.rejects(
        ask.run({ ask: async () => ({}) } as never, {
          pod: "p",
          format: "compact",
        }),
        (error: Error) =>
          error.name === "Refusal" &&
          /does not offer the compact read/.test(error.message),
      );
    });
  });
});
