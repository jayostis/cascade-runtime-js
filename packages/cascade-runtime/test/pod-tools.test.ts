import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { build, type Metafile } from "esbuild";
import { type Pod, type Row, Unopened } from "cascade-runtime";
import { replayKit } from "cascade-runtime/fixtures";
import {
  COMPACT_QUESTIONS,
  LEFT_OUT_OF_THE_COMPACT_READ,
  PAGE_CHARACTERS,
  type PodReads,
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

/** What each tool is given, and the function of its host it calls. A tool added to `TOOLS` needs a row. */
const RUNS: Record<string, [Record<string, unknown>, string]> = {
  list_pods: [{}, "pods"],
  find_changes: [{ pod: "p" }, "tool"],
  finding_rows: [{ pod: "p", key: "k" }, "tool"],
  lab_series: [{ pod: "p", test: "t" }, "tool"],
  timeline: [{ pod: "p" }, "tool"],
  ask: [{ pod: "p", question: "pod/My lab results" }, "ask"],
  reference_table_checks: [{ pod: "p" }, "tables"],
};

const toolNamed = (name: string) => TOOLS.find((tool) => tool.name === name)!;
const ask = toolNamed("ask");
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

/** The error a refused call is: a `Refusal` whose message says what the regular expression matches. */
const refusal = (why: RegExp) => (error: Error) =>
  error.name === "Refusal" && why.test(error.message);

/**
 * A pod of `labs` lab results, each its own view entry of one record, all from one document of one pull; the nth row's
 * record has the nth of `texts` as the text its source wrote for it.
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
/** A record of a view entry, from the document of the hospital `n` names (1 Alpha Clinic, 2 Beta Hospital). */
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
 * The host over one pod with a reclassified variant and co-ingredient medications, the tables read only when `tables`,
 * holding the series `held`; `read` names each function of the tables that is called.
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

const checks = toolNamed("reference_table_checks");

/** What `reference_table_checks` returns with the tables on, as far as these leaves read it. */
interface TableChecks {
  readonly tables: string;
  readonly reportsDifferingFromClinVar: {
    readonly held: boolean;
    readonly versions: readonly string[];
    readonly rows: readonly unknown[];
    readonly notChecked: readonly unknown[];
  };
  readonly medicationsSharingAnIngredient: {
    readonly held: boolean;
    readonly versions: readonly string[];
    readonly rows: readonly {
      readonly entries: readonly { readonly entry: string }[];
    }[];
    readonly notChecked: readonly unknown[];
  };
}

/**
 * `TOOLS` are the tools an app offers a model for reading a person's pods: each has a name, a description, a JSON
 * Schema for its input and a `run`. A tool reaches the pods only through the functions its host gives it (`PodReads`),
 * so one set of tools serves Node and a web page, and its rows name their view entries, which is what a reply cites.
 */
describe("Tools a model reads a pod with · TOOLS", () => {
  describe("TOOLS", () => {
    it("lists seven tools: `list_pods`, `find_changes`, `finding_rows`, `lab_series`, `timeline`, `ask` and `reference_table_checks`", () => {
      assert.deepEqual(TOOLS.map(({ name }) => name).sort(), [
        "ask",
        "find_changes",
        "finding_rows",
        "lab_series",
        "list_pods",
        "reference_table_checks",
        "timeline",
      ]);
    });

    it("calls exactly one function of the host's `PodReads` for each tool", async () => {
      assert.deepEqual(
        Object.keys(RUNS).sort(),
        TOOLS.map(({ name }) => name).sort(),
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
        ) as PodReads;
        await tool.run(recording, input);
        assert.deepEqual(called, [read], tool.name);
      }
    });
  });

  describe("given `find_changes`, `lab_series` or `timeline`", () => {
    it("returns the `entry` of each medication and each result, the view entry a reply cites", async () => {
      const pod = {
        ask: async (question: string) =>
          question === "pod/My lab results" ? LABS : MEDICATIONS,
        close: async () => undefined,
      } as unknown as Pod;
      const reads = podReads({
        names: async () => ["p"],
        open: async () => pod,
      });
      try {
        const run = (name: string, input: Record<string, unknown>) =>
          toolNamed(name).run(reads, { pod: "p", ...input });
        const [change] = (await run("find_changes", {})) as {
          medication: { entry: string };
        }[];
        assert.equal(
          change!.medication.entry,
          "urn:cascade:entry-medication",
          "find_changes",
        );
        const { results } = (await run("lab_series", { test: "A" })) as {
          results: { entry: string }[];
        };
        assert.deepEqual(
          results.map(({ entry }) => entry),
          LABS.map(({ entry }) => entry),
          "lab_series",
        );
        const [medication] = (await run("timeline", {})) as {
          entry: string;
        }[];
        assert.equal(
          medication!.entry,
          "urn:cascade:entry-medication",
          "timeline",
        );
      } finally {
        await reads.close();
      }
    });
  });

  describe("given `ask` with a question", () => {
    it("returns the question's `total` and at most `limit` rows from `offset`", async () => {
      const reads = labPod(400);
      try {
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
      } finally {
        await reads.close();
      }
    });

    it("returns 50 rows when no `limit` is given", async () => {
      const reads = labPod(400);
      try {
        const page = (await ask.run(reads, {
          pod: "p",
          question: "pod/My lab results",
        })) as { total: number; rows: Row[] };
        assert.deepEqual([page.total, page.rows.length], [400, 50]);
      } finally {
        await reads.close();
      }
    });

    it("throws `Refusal` when asked for rows with no question", async () => {
      const reads = labPod(1);
      try {
        await assert.rejects(
          async () => ask.run(reads, { pod: "p", format: "rows" }),
          refusal(/rows answer one question/),
        );
      } finally {
        await reads.close();
      }
    });

    it("throws `Refusal` for `entries` that is not a list of strings", async () => {
      const reads = labPod(1);
      try {
        for (const [what, entries, why] of [
          ["a string", "C12345678", /entries must be an array/],
          ["a list of a number", [1], /entries\[0\] must be a string/],
        ] as const)
          await assert.rejects(
            async () =>
              ask.run(reads, { pod: "p", question: PROVENANCE, entries }),
            refusal(why),
            what,
          );
      } finally {
        await reads.close();
      }
    });
  });
});

/**
 * `podReads(host)`, from `cascade-runtime/tools/node`, gives the tools their `PodReads` over the pods a host names,
 * such as the folders `podsIn(folder)` finds. It opens each pod once and keeps it open until `close()`, so a model's many
 * calls do not each pay for an opening.
 */
describe("Reading a folder of pods for the tools · podReads()", () => {
  it("opens a pod once for calls that arrive together", async () => {
    let opens = 0;
    const reads = podReads({
      names: async () => ["p"],
      open: async () => {
        opens += 1;
        return { ask: async () => LABS, close: async () => undefined } as never;
      },
    });
    const run = (name: string, input: Record<string, unknown>) =>
      toolNamed(name).run(reads, { pod: "p", ...input });
    await Promise.all([
      run("ask", { question: "pod/My lab results" }),
      run("ask", { question: "pod/My medication history" }),
      run("timeline", {}),
    ]);
    await reads.close();
    assert.equal(opens, 1);
  });

  it("closes each pod it opened when `close()` is called", async () => {
    let closes = 0;
    const reads = podReads({
      names: async () => ["p"],
      open: async () =>
        ({
          ask: async () => LABS,
          close: async () => {
            closes += 1;
          },
        }) as never,
    });
    await reads.ask({ pod: "p", question: "pod/My lab results" });
    assert.equal(closes, 0, "before close()");
    await reads.close();
    assert.equal(closes, 1, "after close()");
  });

  it("forgets an opening that failed, so the next call opens the pod again", async () => {
    let opens = 0;
    const reads = podReads({
      names: async () => ["p"],
      open: async () => {
        opens += 1;
        if (opens === 1) throw new Error("the disk was busy");
        return { ask: async () => LABS, close: async () => undefined } as never;
      },
    });
    const asking = () =>
      reads.ask({ pod: "p", question: "pod/My lab results" });
    try {
      await assert.rejects(asking(), /the disk was busy/);
      assert.equal((await asking()).total, LABS.length);
      assert.equal(opens, 2);
    } finally {
      await reads.close();
    }
  });

  it("throws `Refusal`, listing the pods there are, for a name the host does not have", async () => {
    const reads = podReads({
      names: async () => ["p"],
      open: async () => ({ close: async () => undefined }) as never,
    });
    await assert.rejects(
      reads.ask({ pod: "q", question: "pod/My lab results" }),
      refusal(/there is no pod q; the pods are p/),
    );
  });

  it("throws `Refusal` for an encrypted pod, which the tools never open", async () => {
    const reads = podReads({
      names: async () => ["p"],
      open: async () => {
        throw new Unopened("secret needed", "this pod is encrypted");
      },
    });
    await assert.rejects(
      reads.ask({ pod: "p", question: "pod/My lab results" }),
      refusal(/p is encrypted/),
    );
  });
});

/**
 * With `format: "compact"` and no question, `ask` returns the whole pod as tab-separated text, a page of at most
 * `PAGE_CHARACTERS` characters at a time: the compact read. Each line begins with a handle, a short name for its view
 * entry that a reply can cite, and each source is written by a short name, `S1`, `S2` and so on, which the page's
 * `sources` lists.
 * @rule runtime/naming.feature N13
 */
describe("Reading a whole pod in pages · ask tool", () => {
  describe("given a kit's pod, `tamsin-vale`", () => {
    let kits: string;
    let reads: ReturnType<typeof podReads>;
    let answer: Compact;
    let text: string;
    const pod = "tamsin-vale";

    before(
      async () => {
        kits = await mkdtemp(join(tmpdir(), "compact-"));
        await replayKit(pod, join(kits, pod));
        reads = podReads(podsIn(kits));
        answer = (await ask.run(reads, { pod, format: "compact" })) as Compact;
        text = JSON.stringify(answer);
      },
      { timeout: 120_000 },
    );
    after(async () => {
      await reads?.close();
      await rm(kits, { recursive: true, force: true, maxRetries: 5 });
    });

    it("returns the whole pod in one page of at most `PAGE_CHARACTERS` characters, with no `next`", () => {
      assert.ok(text.length <= PAGE_CHARACTERS, `${text.length} characters`);
      assert.equal(answer.next, undefined);
    });

    it("returns one view for each of `COMPACT_QUESTIONS`, in that order", () => {
      assert.deepEqual(
        answer.views.map(({ question }) => question),
        COMPACT_QUESTIONS,
      );
    });

    it("gives each view its `total` and one line for each row its question returns", async () => {
      for (const view of answer.views) {
        const { total } = await reads.ask({ pod, question: view.question });
        assert.deepEqual(
          [view.total, view.offset, view.shown, idsOf(view.text).length],
          [total, 0, total, total],
          view.question,
        );
      }
    });

    it("names each view entry by a handle that `entries` resolves to that view entry", async () => {
      for (const view of answer.views) {
        const { rows } = await reads.ask({ pod, question: view.question });
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

    it("writes no IRI but the subject's", async () => {
      const [person] = (
        await reads.ask({ pod, question: "pod/The person this pod is about" })
      ).rows;
      assert.deepEqual(
        [...new Set(text.match(/pod:\/\/|urn:uuid:[0-9a-f-]+|ni:\/\/\//g))],
        [person!.subject],
      );
    });

    it("names in `leftOut` each view it leaves out, every view entry of which is in the view named beside it", async () => {
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

  describe("given a pod of 400 lab results, too long for one page", () => {
    const pages: Compact[] = [];
    let reads: ReturnType<typeof labPod>;

    before(async () => {
      reads = labPod(400);
      let input: Record<string, unknown> = { pod: "p", format: "compact" };
      for (;;) {
        const page = (await ask.run(reads, input)) as Compact;
        pages.push(page);
        if (page.next === undefined) break;
        input = { pod: "p", ...page.next };
      }
    });
    after(async () => reads?.close());

    it("returns in `next` the input that asks for the page after", () => {
      assert.ok(pages.length > 1, `${pages.length} page`);
      assert.deepEqual(
        pages.slice(0, -1).map((page) => page.next !== undefined),
        pages.slice(0, -1).map(() => true),
      );
      assert.equal(pages.at(-1)!.next, undefined);
    });

    it("keeps every page within `PAGE_CHARACTERS` characters", () => {
      for (const [at, page] of pages.entries())
        assert.ok(
          JSON.stringify(page).length <= PAGE_CHARACTERS,
          `page ${at + 1}`,
        );
    });

    it("puts every row on exactly one page", () => {
      const shown = new Map<string, string[]>();
      for (const page of pages)
        for (const view of page.views) {
          const ids = idsOf(view.text);
          assert.equal(ids.length, view.shown, view.question);
          assert.equal(view.offset, shown.get(view.question)?.length ?? 0);
          shown.set(view.question, [
            ...(shown.get(view.question) ?? []),
            ...ids,
          ]);
        }
      assert.deepEqual([...shown.keys()], COMPACT_QUESTIONS);
      assert.equal(new Set(shown.get("pod/My lab results")).size, 400);
    });
  });

  describe("given the text a source wrote for a record", () => {
    /** The compact read of `question` over the pod `reads`, whose one view's first line is returned by cells. */
    async function firstLine(
      reads: ReturnType<typeof podReads>,
      question: string,
    ) {
      const { views } = (await ask.run(reads, {
        pod: "p",
        format: "compact",
        question,
      })) as Compact;
      return linesOf(views[0]!.text)[0]!;
    }
    const conditionRead = (
      row: Record<string, string>,
      entry = entryOf("conditions", 1),
    ) =>
      podOf(
        {
          "pod/My condition history": [
            {
              condition: "Pulmonary embolism",
              entry,
              sources: `${sourced(1, 1)}; ${sourced(2, 2)}`,
              ...row,
            },
          ],
        },
        [
          recordOf(entryOf("conditions", 1), 1, 1),
          recordOf(entryOf("conditions", 1), 2, 2),
        ],
      );

    it("leaves out a text that says no more than the cells of its row, a date written in words counting as the row's date", async () => {
      const reads = labPod(2, [
        "Test 0, named at the length a panel's tests are\n0 mg/dL\nJanuary 1, 2024 16:00 UTC",
        "Test 1, named at the length a panel's tests are\n1 mg/dL\nhistorical result",
      ]);
      try {
        const { views } = (await ask.run(reads, {
          pod: "p",
          format: "compact",
          question: "pod/My lab results",
        })) as Compact;
        const [header, ...lines] = views[0]!.text.split("\n");
        const at = header!.split("\t").indexOf("narrativeTexts");
        assert.equal(lines[1]!.split("\t")[at], "");
      } finally {
        await reads.close();
      }
    });

    it("keeps a text that adds words, after the short name of the source that wrote it", async () => {
      const reads = labPod(2, [
        "Test 0, named at the length a panel's tests are\n0 mg/dL\nJanuary 1, 2024 16:00 UTC",
        "Test 1, named at the length a panel's tests are\n1 mg/dL\nhistorical result",
      ]);
      try {
        const { views } = (await ask.run(reads, {
          pod: "p",
          format: "compact",
          question: "pod/My lab results",
        })) as Compact;
        const [header, ...lines] = views[0]!.text.split("\n");
        const at = header!.split("\t").indexOf("narrativeTexts");
        assert.equal(
          lines[0]!.split("\t")[at],
          "S1 Test 1, named at the length a panel's tests are\\n1 mg/dL\\nhistorical result",
        );
      } finally {
        await reads.close();
      }
    });

    it("keeps each source's status, a report's conclusion and a text's prose, though other cells say the same words", async () => {
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
      try {
        const { views } = (await ask.run(reads, {
          pod: "p",
          format: "compact",
        })) as Compact;
        const line = (question: string) =>
          linesOf(views.find((it) => it.question === question)!.text)[0]!;
        const drug = line("pod/My medication history");
        assert.equal(
          line("pod/My condition history").statuses,
          "S1 ruled out; S2 active",
          "a condition's statuses beside its status",
        );
        assert.equal(
          drug.statuses,
          "S1 on-hold; S2 active",
          "a medication's statuses",
        );
        assert.equal(
          drug.narrativeTexts,
          "S1 hold warfarin; warfarin plan reviewed; progress note",
          "a text whose words are all in the medication's name and status",
        );
        assert.equal(
          line("pod/My reports, notes and documents").conclusion,
          "Pulmonary embolism.",
          "a report's conclusion that repeats its name",
        );
      } finally {
        await reads.close();
      }
    });

    it("compares a text with the values its own source gave, not with the row's", async () => {
      const contradicting = conditionRead({
        status: "ruled out",
        statuses: `${record(1)} active; ${record(2)} ruled out`,
        narrativeTexts: `${record(1)} Pulmonary embolism ruled out; ${record(2)} Embolism, pulmonary: active`,
      });
      const refuting = conditionRead({
        verificationStatus: "refuted",
        status: "active",
        statuses: `${record(1)} active; ${record(2)} active`,
        narrativeTexts: `${record(1)} Pulmonary embolism refuted; ${record(2)} Embolism, pulmonary: active`,
      });
      try {
        assert.equal(
          (await firstLine(contradicting, "pod/My condition history"))
            .narrativeTexts,
          "S1 Pulmonary embolism ruled out; S2 Embolism, pulmonary: active",
          "a text that contradicts its own source's status",
        );
        assert.equal(
          (await firstLine(refuting, "pod/My condition history"))
            .narrativeTexts,
          "S1 Pulmonary embolism refuted",
          "a status that no source states for itself",
        );
      } finally {
        await contradicting.close();
        await refuting.close();
      }
    });
  });

  describe("given `entry/What needs review`", () => {
    const [one, other] = [
      entryOf("medications", 1),
      entryOf("medications", 2),
    ] as [string, string];
    const reviewed = (recordLabel: string, otherRecordLabel: string) =>
      podOf(
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
      );
    const lineOf = async (reads: ReturnType<typeof podOf>) => {
      const { views } = (await ask.run(reads, {
        pod: "p",
        format: "compact",
        question: "entry/What needs review",
      })) as Compact;
      return linesOf(views[0]!.text)[0]!;
    };

    it("gives each record as its source's short name and its own name, without its kind, its author, its document or when it was received", async () => {
      for (const [what, recordLabel, otherRecordLabel] of [
        [
          "a label ending in its author and document",
          "Medication · losartan 50 mg tablet · Clearwater · ccda_2026.xml",
          "Medication · losartan potassium 50 MG Oral Tablet · Fernhill",
        ],
        [
          "a label ending in when it was received",
          "Medication · losartan 50 mg tablet · Clearwater · received 2026-11-02",
          "Medication · losartan potassium 50 MG Oral Tablet · Fernhill · received 2026-11-02",
        ],
      ] as const) {
        const reads = reviewed(recordLabel, otherRecordLabel);
        try {
          assert.equal(
            (await lineOf(reads)).record,
            "S1 losartan 50 mg tablet",
            what,
          );
        } finally {
          await reads.close();
        }
      }
    });

    it("names the view entry another record is in by that view entry's handle", async () => {
      const reads = reviewed(
        "Medication · losartan 50 mg tablet · Clearwater · ccda_2026.xml",
        "Medication · losartan potassium 50 MG Oral Tablet · Fernhill",
      );
      try {
        assert.match(
          (await lineOf(reads)).otherRecord!,
          /^S2 in M[0-9a-f]{8,} losartan potassium 50 MG Oral Tablet$/,
        );
      } finally {
        await reads.close();
      }
    });
  });

  describe("given a handle in `entries`", () => {
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
    after(() => reads.close());
    const named = async (handle: string) =>
      (
        (await ask.run(reads, {
          pod: "p",
          question: PROVENANCE,
          entries: [handle],
        })) as { rows: Row[] }
      ).rows.map((it) => it.entry);

    it("returns the rows of the view entry whose name the handle begins", async () => {
      assert.deepEqual(await named(`C${sha(record(1)).slice(0, 8)}`), [
        entry,
        entry,
      ]);
    });

    it("returns, for a handle made before another record joined the view entry, the rows of the view entry that record is in now", async () => {
      assert.deepEqual(await named(`C${sha(record(2)).slice(0, 10)}`), [
        entry,
        entry,
      ]);
    });

    it("throws `Refusal`, naming the handle, when no view entry has it or its letter is another view's", async () => {
      for (const [what, handle] of [
        ["another view's letter", `L${sha(record(1)).slice(0, 8)}`],
        ["a handle of no record", `C${sha(record(3)).slice(0, 8)}`],
      ] as const)
        await assert.rejects(
          named(handle),
          (error: Error) =>
            error.name === "Refusal" &&
            error.message.includes(handle) &&
            /no entry .* has the handle/.test(error.message),
          what,
        );
    });
  });

  describe("given a host or an input that cannot give a compact read", () => {
    it("throws `Refusal` when the host offers no `compact` function", async () => {
      await assert.rejects(
        ask.run({ ask: async () => ({}) } as never, {
          pod: "p",
          format: "compact",
        }),
        refusal(/does not offer the compact read/),
      );
    });

    it("throws `Refusal` for a `limit`, which is for rows", async () => {
      const reads = labPod(1);
      try {
        await assert.rejects(
          async () =>
            ask.run(reads, { pod: "p", format: "compact", limit: 10 }),
          refusal(/limit is for rows/),
        );
      } finally {
        await reads.close();
      }
    });
  });
});

/**
 * `reference_table_checks` returns what a pod's records and the reference tables say together that no question returns:
 * each variant report that differs from ClinVar's classification today, and each pair of active medications whose codes
 * share an ingredient. It reads the tables only when the host turns them on, and it lists what it could not check, so an
 * empty list is never read as nothing found.
 * @rule runtime/lifecycle.feature L1
 */
describe("Checking a pod against the reference tables · reference_table_checks tool", () => {
  describe("with the tables on, holding a ClinVar series and a product ingredients series", () => {
    let reads: ReturnType<typeof tableReads>;
    let answer: TableChecks;
    const differing = () => answer.reportsDifferingFromClinVar;
    const sharing = () => answer.medicationsSharingAnIngredient;
    const pairs = () =>
      sharing().rows.map(({ entries }) => entries.map(({ entry }) => entry));

    before(async () => {
      reads = tableReads(true);
      answer = (await checks.run(reads, { pod: "p" })) as TableChecks;
    });
    after(async () => reads?.close());

    it("returns each report that differs from ClinVar's classification today, with the variant's view entry, the report, its date and classification, and the ClinVar row", () => {
      assert.deepEqual(differing().rows, [
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
      ]);
    });

    it("returns in `notChecked` each variant it could not check, and why: `not covered`, `not asked`", () => {
      assert.deepEqual(differing().notChecked, [
        { entry: UNCOVERED, reason: "not covered", genes: ["MLH1"] },
        { entry: REPORT_ONLY, reason: "not asked" },
      ]);
    });

    it("returns each pair of active medications in two view entries whose codes share an ingredient", () => {
      const ingredient = {
        code: `${RXNORM}9001`,
        label: "ingredient a",
        origin: NAMES,
      };
      assert.equal(sharing().rows.length, 2);
      assert.deepEqual(
        sharing().rows[0],
        {
          entries: [
            { entry: `${ENTRY}a`, code: `${RXNORM}1001`, origin: INGREDIENTS },
            { entry: `${ENTRY}b`, code: `${RXNORM}1002`, origin: INGREDIENTS },
          ],
          ingredient,
        },
        "a and b",
      );
      assert.deepEqual(
        sharing().rows[1],
        {
          entries: [
            { entry: `${ENTRY}a`, code: `${RXNORM}1001`, origin: INGREDIENTS },
            {
              entry: `${ENTRY}same-code`,
              code: `${RXNORM}1002`,
              origin: INGREDIENTS,
            },
          ],
          ingredient,
        },
        "a and same-code",
      );
    });

    it("returns no pair for a stopped or a paused medication, for two view entries that show one code, or for two codes of one view entry", () => {
      const named = pairs().flat();
      assert.ok(!named.includes(`${ENTRY}stopped`), "a stopped medication");
      assert.ok(!named.includes(`${ENTRY}paused`), "a paused medication");
      assert.ok(
        !pairs().some(
          (pair) =>
            pair.includes(`${ENTRY}b`) && pair.includes(`${ENTRY}same-code`),
        ),
        "two view entries that show one code",
      );
      assert.deepEqual(
        pairs().map((pair) => pair.filter((it) => it === `${ENTRY}a`).length),
        [1, 1],
        "two codes of one view entry, a, are never a pair",
      );
    });

    it("returns in `notChecked` each active medication it could not check, and why: `no code`, `no ingredients row`", () => {
      assert.deepEqual(sharing().notChecked, [
        { entry: `${ENTRY}no-code`, reason: "no code" },
        {
          entry: `${ENTRY}unmapped`,
          code: `${RXNORM}1005`,
          reason: "no ingredients row",
        },
      ]);
    });

    it("returns in `versions` the version of each series it read", () => {
      assert.deepEqual(differing().versions, [CLINVAR_VERSION], "ClinVar");
      assert.deepEqual(
        sharing().versions,
        [INGREDIENTS],
        "the product ingredients",
      );
    });
  });

  describe("with the tables on, holding neither series", () => {
    it("returns `held: false` for each check, and no rows", async () => {
      const reads = tableReads(true, [], []);
      try {
        const answer = (await checks.run(reads, { pod: "p" })) as Record<
          string,
          unknown
        >;
        assert.deepEqual(answer, {
          tables: "on",
          reportsDifferingFromClinVar: { held: false },
          medicationsSharingAnIngredient: { held: false },
        });
      } finally {
        await reads.close();
      }
    });

    it("asks the tables nothing further", async () => {
      const read: string[] = [];
      const reads = tableReads(true, read, []);
      try {
        await checks.run(reads, { pod: "p" });
        assert.deepEqual(read, ["tables"]);
      } finally {
        await reads.close();
      }
    });
  });

  describe("with the tables off", () => {
    it('returns `tables: "off"`, a sentence saying so in `said`, and no rows', async () => {
      const reads = tableReads(false);
      try {
        const answer = (await checks.run(reads, { pod: "p" })) as Record<
          string,
          unknown
        >;
        assert.equal(answer.tables, "off");
        assert.match(String(answer.said), /tables are off/);
        assert.deepEqual(Object.keys(answer).sort(), ["said", "tables"]);
      } finally {
        await reads.close();
      }
    });

    it("reads no table", async () => {
      const read: string[] = [];
      const reads = tableReads(false, read);
      try {
        await checks.run(reads, { pod: "p" });
        assert.deepEqual(read, []);
      } finally {
        await reads.close();
      }
    });
  });
});

describe("cascade-runtime/tools in a browser bundle", () => {
  let bundle: { errors: unknown[]; metafile: Metafile };

  before(async () => {
    bundle = await build({
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
  });

  it("bundles for a browser with no error", () => {
    assert.deepEqual(bundle.errors, []);
  });

  it("holds no file of the compact read", () => {
    assert.deepEqual(
      Object.keys(bundle.metafile.inputs).filter((it) =>
        /compact-read/.test(it),
      ),
      [],
    );
  });
});
