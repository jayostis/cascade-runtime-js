import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  type Citation,
  checkAbsence,
  checkCitation,
  checkRecordsAbsence,
  ccdaFields,
  fhirFields,
  isoDate,
  kindOfCall,
  narrativeFields,
  POD_FIELDS,
  POD_NOT_CHECKABLE,
  podRowsSource,
  quoteLongEnough,
  type Source,
} from "../src/citations.js";
import { downloadsSource } from "../src/node/downloads.js";
import { podEntryRows as rowsOfEntries } from "../src/reply.js";
import { readConfig, resolveVocabulary } from "@cascade-runtime/runtime/node";

const FOLDER = fileURLToPath(
  new URL("../../test/fixtures/citations/", import.meta.url),
);
const downloads = downloadsSource(FOLDER);
const LDL = "pod://p/clinical/lab-results.ttl#ldl";
const pod = podRowsSource(async (entry) =>
  entry === LDL
    ? [
        { field: "cascade:testName", value: "LDL cholesterol" },
        { field: "cascade:testCode", value: "http://loinc.org/rdf/13457-7" },
        { field: "cascade:resultValue", value: "131" },
        { field: "cascade:resultUnit", value: "mg/dL" },
        { field: "cascade:referenceRange", value: "<=99 mg/dL" },
        {
          field: "cascade:resultClinicallyRelevantTime",
          value: "2025-02-18T16:00:00Z",
        },
      ]
    : undefined,
);

const ldl = { file: "bundle.json", resource: "Observation/ldl-1" };
const fit = { file: "bundle.json", resource: "Observation/fit-1" };
const metformin = {
  file: "bundle.json",
  resource: "MedicationStatement/med-1",
};
const report = { file: "bundle.json", resource: "DiagnosticReport/dr-1" };
const condition = { file: "bundle.json", resource: "Condition/c-1" };
const order = { file: "bundle.json", resource: "MedicationRequest/m-1" };

/** A verdict as the test compares it: what was held, why not, what was missing and where it is. */
interface Expected {
  readonly ok: boolean;
  readonly reason?: string;
  readonly missing?: readonly string[];
  readonly foundAt?: readonly number[];
}

const ok: Expected = { ok: true };
const otherwise = (...missing: string[]): Expected => ({
  ok: false,
  reason: "says otherwise",
  missing,
});

test("a citation holds only when the cited record's own fields say what is claimed", async () => {
  const cases: [string, Citation, Expected][] = [
    [
      "a lab's value, unit and date",
      { cite: ldl, value: "131", unit: "mg/dL", date: "2025-02-18" },
      ok,
    ],
    [
      "the reference range is no value",
      { cite: ldl, value: "99" },
      otherwise("value 99"),
    ],
    [
      "the interpretation is no value",
      { cite: ldl, value: "H" },
      otherwise("value H"),
    ],
    [
      "a result's opposite, written in its range",
      { cite: fit, value: "Negative" },
      otherwise("value Negative"),
    ],
    [
      "a coded result by its text",
      { cite: fit, value: "Positive", code: "29771-3", date: "2025-11-04" },
      ok,
    ],
    [
      "the record's update time is no clinical date",
      { cite: fit, date: "2025-11-20" },
      otherwise("date 2025-11-20"),
    ],
    [
      "a stop date claimed as the start",
      { cite: metformin, date: "2024-04-15", dateKind: "start" },
      otherwise("start 2024-04-15"),
    ],
    [
      "the stop date as the end",
      {
        cite: metformin,
        date: "2024-04-15",
        dateKind: "end",
        status: "completed",
      },
      ok,
    ],
    [
      "a medication by name and code",
      {
        cite: metformin,
        name: "metformin",
        code: "861007",
        date: "2022-03-01",
        dateKind: "start",
      },
      ok,
    ],
    ["a report's words", { cite: report, quote: "No pulmonary embolism" }, ok],
    [
      "nothing a program can check",
      { cite: ldl },
      { ok: false, reason: "nothing to check", missing: [] },
    ],
    [
      "a unit alone",
      { cite: ldl, unit: "mg/dL" },
      { ok: false, reason: "nothing to check", missing: [] },
    ],
    [
      "a resource there is not",
      {
        cite: { file: "bundle.json", resource: "Procedure/colonoscopy-1" },
        value: "normal",
      },
      { ok: false, reason: "no such record", missing: [] },
    ],
    [
      "a line past the end",
      { cite: { file: "summary.xml", line: 400 }, value: "7.9" },
      { ok: false, reason: "no such record", missing: [] },
    ],
    [
      "an entry by its id, code and date",
      {
        cite: { file: "summary.xml", line: 9 },
        id: "VX-251108-2",
        code: "187",
        date: "2025-11-08",
      },
      ok,
    ],
    [
      "a result in a panel, by any line of it",
      {
        cite: { file: "summary.xml", line: 27 },
        value: "7.9",
        unit: "m[IU]/L",
        date: "2026-03-03",
      },
      ok,
    ],
    [
      "the range's low is no value",
      { cite: { file: "summary.xml", line: 29 }, value: "0.40" },
      otherwise("value 0.40"),
    ],
    [
      "a neighbour's value in the same panel",
      { cite: { file: "summary.xml", line: 29 }, value: "1.0", code: "3024-7" },
      {
        ok: false,
        reason: "not at that line",
        missing: ["value 1.0", "code 3024-7"],
        foundAt: [34],
      },
    ],
    [
      "a neighbour's value in the next JSON resource",
      {
        cite: { file: "bundle.json", line: 34 },
        value: "7.1",
        date: "2025-08-18",
      },
      {
        ok: false,
        reason: "not at that line",
        missing: ["value 7.1", "date 2025-08-18"],
        foundAt: [7],
      },
    ],
    [
      "narrative words on the line cited",
      {
        cite: { file: "summary.xml", line: 47 },
        quote: "repeated in 6-8 weeks",
      },
      ok,
    ],
    [
      "a pod entry's own result",
      { cite: { entry: LDL }, value: "131", date: "2025-02-18" },
      ok,
    ],
    ["a value written as a number", { cite: ldl, value: 131 }, ok],
    [
      "a status as the record writes it",
      { cite: condition, status: "refuted" },
      ok,
    ],
    [
      "a status the record does not hold",
      { cite: condition, status: "active" },
      otherwise("status active"),
    ],
    [
      "part of a status",
      { cite: metformin, status: "ted" },
      otherwise("status ted"),
    ],
    [
      "an intent is no status",
      { cite: order, status: "order" },
      otherwise("status order"),
    ],
    [
      "a person by full name",
      {
        cite: { file: "bundle.json", resource: "Patient/p-1" },
        name: "Tamsin Vale",
        date: "1957-09-30",
      },
      ok,
    ],
    [
      "a pod entry's range is no value",
      { cite: { entry: LDL }, value: "99" },
      otherwise("value 99"),
    ],
    [
      "a FHIR code with its system, as the compact read writes it",
      { cite: fit, code: "loinc:29771-3" },
      ok,
    ],
    [
      "a FHIR code with another system",
      { cite: fit, code: "snomed:29771-3" },
      otherwise("code snomed:29771-3"),
    ],
    [
      "a pod code with its system",
      { cite: { entry: LDL }, code: "LOINC:13457-7" },
      ok,
    ],
    [
      "a pod code with another system",
      { cite: { entry: LDL }, code: "snomed:13457-7" },
      otherwise("code snomed:13457-7"),
    ],
    [
      "a C-CDA code with its system, by the OID it names",
      { cite: { file: "summary.xml", line: 9 }, code: "cvx:187" },
      ok,
    ],
    [
      "a C-CDA code with another system",
      { cite: { file: "summary.xml", line: 9 }, code: "loinc:187" },
      otherwise("code loinc:187"),
    ],
    [
      "a C-CDA entry's own author time backs recorded",
      {
        cite: { file: "summary.xml", line: 29 },
        date: "2026-03-04",
        dateKind: "recorded",
      },
      ok,
    ],
    [
      "an entry with none is recorded when its document says its author wrote it",
      {
        cite: { file: "summary.xml", line: 39 },
        date: "2026-03-10",
        dateKind: "recorded",
      },
      ok,
    ],
    [
      "a narrative line is recorded when its document was",
      {
        cite: { file: "summary.xml", line: 47 },
        date: "2026-03-10",
        dateKind: "recorded",
      },
      ok,
    ],
    [
      "a recorded day the C-CDA never states",
      {
        cite: { file: "summary.xml", line: 39 },
        date: "2026-03-03",
        dateKind: "recorded",
      },
      otherwise("recorded 2026-03-03"),
    ],
  ];
  for (const [what, claim, verdict] of cases) {
    const {
      ok: held,
      reason,
      missing,
      foundAt,
    } = (await checkCitation(
      claim,
      "entry" in claim.cite ? pod : downloads,
    )) as Expected;
    assert.deepEqual(
      {
        ok: held,
        ...(reason ? { reason } : {}),
        ...(missing ? { missing } : {}),
        ...(foundAt ? { foundAt } : {}),
      },
      verdict,
      what,
    );
  }
});

test("a pod's absence is backed only by a query that ran, answered whole, and found nothing that matches", () => {
  const procedures = (answer: unknown, ok = true) => ({
    tool: "ask",
    input: { pod: "p", question: "pod/My procedures" },
    ok,
    answer: JSON.stringify(answer),
  });
  const absence = {
    what: "a colonoscopy after the positive FIT",
    coverage: "every procedure the pod holds",
    match: { codes: ["73761001"], terms: ["colonoscopy"] },
    query: { tool: "ask", input: { question: "pod/My procedures", pod: "p" } },
  };
  const none = {
    total: 1,
    rows: [{ procedure: "CT angiography of the chest" }],
  };
  const labs = {
    tool: "ask",
    input: { pod: "p", question: "pod/My lab results" },
    ok: true,
    answer: JSON.stringify({
      total: 1,
      rows: [
        {
          test: "Hemoglobin A1c",
          code: "http://loinc.org/rdf/4548-4",
          performed: "2026-02-16T16:00:00Z",
        },
      ],
    }),
  };
  const a1cAfter = {
    what: "an A1c since February",
    coverage: "every lab result the pod holds",
    match: { codes: ["4548-4"], after: "2026-02-17" },
  };
  for (const [what, claim, ran, backing] of [
    ["backed", absence, [procedures(none)], { backed: true }],
    [
      "no query",
      { ...absence, query: undefined },
      [procedures(none)],
      { backed: false, reason: "no query" },
    ],
    [
      "another query",
      absence,
      [
        {
          ...procedures(none),
          input: { pod: "p", question: "pod/My lab results" },
        },
      ],
      { backed: false, reason: "query not run" },
    ],
    [
      "a refusal backs nothing",
      absence,
      [procedures("no question pod/My procedures", false)],
      { backed: false, reason: "query refused" },
    ],
    [
      "the query found it",
      absence,
      [
        procedures({
          total: 1,
          rows: [
            {
              procedure: "Colonoscopy",
              snomed: "http://snomed.info/id/73761001",
            },
          ],
        }),
      ],
      { backed: false, reason: "query found it" },
    ],
    [
      "cut short",
      absence,
      [procedures({ total: 80, rows: [{ procedure: "CT" }] })],
      { backed: false, reason: "query cut short" },
    ],
    [
      "nothing to look for",
      { ...absence, match: {} },
      [procedures(none)],
      { backed: false, reason: "nothing to look for" },
    ],
    [
      "no coverage",
      { ...absence, coverage: " " },
      [procedures(none)],
      { backed: false, reason: "no coverage" },
    ],
    [
      "only rows before the date it is absent after",
      { ...a1cAfter, query: labs.input && { tool: "ask", input: labs.input } },
      [labs],
      { backed: true },
    ],
    [
      "a row after that date",
      {
        ...a1cAfter,
        match: { ...a1cAfter.match, after: "2026-01-01" },
        query: { tool: "ask", input: labs.input },
      },
      [labs],
      { backed: false, reason: "query found it" },
    ],
  ] as const)
    assert.deepEqual(checkAbsence(claim, ran), backing, what);
});

test("a compact read backs an absence by its whole views of the absence's kind, line by line: a date on another line, a withdrawn line or a view of another kind does not count against it, and a paged or filtered read backs nothing", () => {
  const view = (
    question: string,
    header: string,
    lines: readonly string[],
    total = lines.length,
  ) => ({
    question,
    total,
    offset: 0,
    shown: lines.length,
    text: [header, ...lines].join("\n"),
  });
  const LABS = "id\tperformed\ttest\tcode\tvalue\tunit\tstatus\tfrom";
  const a1c2023 =
    "La1c00001\t2023-03-01\tHemoglobin A1c\tloinc:4548-4\t7.1\t%\tfinal\tS1";
  const egfr2026 =
    "Lef0000001\t2026-02-16\teGFR\tloinc:98979-8\t69\tmL/min\tfinal\tS2";
  const a1c2026 =
    "La1c00002\t2026-02-16\tHemoglobin A1c\tloinc:4548-4\t6.9\t%\tfinal\tS2";
  const conditions = view(
    "pod/My condition history",
    "id\tcondition\tsnomed\tstatus\tonset\tfrom",
    [
      "Cfe000001\tPulmonary embolism\tsnomed:59282003\truled out\t2025-07-08\tS2",
      "Cd00000001\tType 2 diabetes, followed by A1c\tsnomed:44054006\tactive\t2026-03-01\tS2",
    ],
  );
  const read = { pod: "p", format: "compact" };
  const ran = (
    views: readonly object[],
    input: Readonly<Record<string, unknown>> = read,
    more = {},
  ) => [
    {
      tool: "ask",
      input,
      ok: true,
      answer: JSON.stringify({
        format: "compact",
        sources: "source\twritten by\tretrieved\nS1\tLab\t2026-05-01",
        views,
        ...more,
      }),
    },
  ];
  const a1c = {
    what: "an A1c since 2025",
    coverage: "every lab result",
    match: { codes: ["4548-4"], terms: ["A1c"], after: "2025-01-01" },
  };
  const pe = {
    what: "a pulmonary embolism",
    coverage: "every condition",
    match: { codes: ["59282003"], terms: ["pulmonary embolism"] },
  };
  const lab = { kind: "lab" } as const;
  const labs = (lines: readonly string[], total?: number) =>
    view("pod/My lab results", LABS, lines, total);
  for (const [what, absence, calls, tied, backing] of [
    [
      "an old A1c and a new eGFR",
      a1c,
      ran([labs([a1c2023, egfr2026]), conditions]),
      lab,
      { backed: true },
    ],
    [
      "a new A1c",
      a1c,
      ran([labs([a1c2023, a1c2026])]),
      lab,
      { backed: false, reason: "query found it" },
    ],
    [
      "a new A1c entered in error",
      a1c,
      ran([labs([a1c2023, a1c2026.replace("final", "entered-in-error")])]),
      lab,
      { backed: true },
    ],
    [
      "the lab results cut at a page",
      a1c,
      ran([labs([a1c2023], 2)]),
      lab,
      { backed: false, reason: "query cut short" },
    ],
    [
      "a view with fewer lines than it says it shows",
      a1c,
      ran([{ ...labs([a1c2023]), total: 2, shown: 2 }]),
      lab,
      { backed: false, reason: "query cut short" },
    ],
    [
      "a page with no lab results on it",
      a1c,
      ran([conditions], read, { next: { format: "compact", offset: 2 } }),
      lab,
      { backed: false, reason: "query cut short" },
    ],
    [
      "a read of the entries asked for",
      a1c,
      ran([labs([a1c2023])], { ...read, entries: ["La1c00001"] }),
      lab,
      { backed: false, reason: "query cut short" },
    ],
    [
      "a pulmonary embolism ruled out",
      pe,
      ran([labs([a1c2023]), conditions]),
      undefined,
      { backed: true },
    ],
    [
      "a read of no kind that goes on to another page",
      pe,
      ran([labs([a1c2023]), conditions], read, {
        next: { format: "compact", offset: 3 },
      }),
      undefined,
      { backed: false, reason: "query cut short" },
    ],
  ] as const)
    assert.deepEqual(
      checkAbsence(
        { ...absence, query: { tool: "ask", input: calls[0]!.input } },
        calls,
        tied,
      ),
      backing,
      what,
    );
  assert.equal(
    kindOfCall({
      tool: "ask",
      input: { question: "pod/My condition history" },
    }),
    "condition",
  );
  assert.equal(kindOfCall({ tool: "ask", input: read }), undefined);
});

test("a view split across the pages of one compact read backs an absence when the pages that read gave cover it from its first row to its last, and not when one is missing, one gives the match, or the pages are of another read", () => {
  const LABS = "id\tperformed\ttest\tcode\tvalue\tunit\tstatus\tfrom";
  const line = (n: number, test = "eGFR", code = "98979-8") =>
    `L0000000${n}\t2026-02-1${n}\t${test}\tloinc:${code}\t6${n}\tmL/min\tfinal\tS1`;
  const page = (
    offset: number,
    lines: readonly string[],
    total: number,
    next?: number,
  ) => ({
    input: {
      pod: "p",
      format: "compact",
      ...(offset === 0 ? {} : { offset }),
    },
    ok: true,
    tool: "ask",
    answer: JSON.stringify({
      format: "compact",
      views: [
        {
          question: "pod/My lab results",
          total,
          offset,
          shown: lines.length,
          text: [LABS, ...lines].join("\n"),
        },
      ],
      ...(next === undefined
        ? {}
        : { next: { pod: "p", format: "compact", offset: next } }),
    }),
  });
  const first = page(0, [line(1), line(2)], 5, 2);
  const second = page(2, [line(3), line(4)], 5, 4);
  const last = page(4, [line(5)], 5);
  const query = { tool: "ask", input: first.input };
  const ofLabs = {
    what: "an A1c",
    coverage: "every lab result",
    match: { codes: ["4548-4"], terms: ["A1c"] },
    query,
  };
  const anywhere = {
    what: "an A1c",
    coverage: "every view",
    match: { terms: ["A1c"] },
    query,
  };
  const cut = { backed: false, reason: "query cut short" } as const;
  for (const [what, absence, tied, calls, backing] of [
    [
      "every page",
      ofLabs,
      { kind: "lab" },
      [first, second, last],
      { backed: true },
    ],
    [
      "the pages out of order",
      ofLabs,
      { kind: "lab" },
      [last, first, second],
      { backed: true },
    ],
    [
      "every page, of no kind",
      anywhere,
      undefined,
      [first, second, last],
      { backed: true },
    ],
    ["the first page only", ofLabs, { kind: "lab" }, [first], cut],
    ["a gap in the middle", ofLabs, { kind: "lab" }, [first, last], cut],
    ["no last page", ofLabs, { kind: "lab" }, [first, second], cut],
    ["a gap, of no kind", anywhere, undefined, [first, last], cut],
    ["no last page, of no kind", anywhere, undefined, [first, second], cut],
    [
      "the match on the last page",
      ofLabs,
      { kind: "lab" },
      [first, second, page(4, [line(5, "Hemoglobin A1c", "4548-4")], 5)],
      { backed: false, reason: "query found it" },
    ],
    [
      "a last page of another read",
      ofLabs,
      { kind: "lab" },
      [first, second, { ...last, input: { ...last.input, entries: ["L1"] } }],
      cut,
    ],
  ] as const)
    assert.deepEqual(checkAbsence(absence, calls, tied), backing, what);
});

test("a handle is struck out of a compact line only where a handle stands: a real S1 or S2 in a text counts against an absence", () => {
  const read = { pod: "p", format: "compact" };
  const ran = (conclusion: string, statuses: string) => [
    {
      tool: "ask",
      input: read,
      ok: true,
      answer: JSON.stringify({
        format: "compact",
        views: [
          {
            question: "pod/My reports, notes and documents",
            total: 1,
            offset: 0,
            shown: 1,
            text: `id\tname\tconclusion\tstatuses\nR0000cafe1\tCardiac exam\t${conclusion}\t${statuses}`,
          },
        ],
      }),
    },
  ];
  const absence = (term: string) => ({
    what: term,
    coverage: "every report",
    match: { terms: [term] },
    query: { tool: "ask", input: read },
  });
  for (const [what, term, conclusion, statuses, backing] of [
    [
      "S1 and S2 in a conclusion",
      "S1 and S2",
      "Normal S1 and S2, no murmur",
      "S1 final",
      { backed: false, reason: "query found it" },
    ],
    [
      "S2 after a semicolon in a conclusion",
      "S2 is loud",
      "Normal S1; S2 is loud",
      "S1 final",
      { backed: false, reason: "query found it" },
    ],
    [
      "S2 alone at the start of a conclusion",
      "S2",
      "S2 split.",
      "S1 final",
      { backed: false, reason: "query found it" },
    ],
    [
      "S2 only as the source a status is from",
      "S2",
      "No murmur",
      "S2 final",
      { backed: true },
    ],
  ] as const)
    assert.deepEqual(
      checkAbsence(absence(term), ran(conclusion, statuses)),
      backing,
      what,
    );
});

test("a pod citation by handle is checked against the entry it names: by the start of its fragment, or a stale one by a record merged into it", async () => {
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const [first, later] = [1, 2].map(
    (n) => `urn:uuid:00000000-0000-4000-8000-00000000000${n}`,
  );
  const entry = `pod://p/clinical/lab-results.ttl#${sha(first!)}`;
  const shows = [first, later].map((from) => ({
    entry,
    from: from!,
    field: "https://ns.cascadeprotocol.org/cascade#testName",
    value: "LDL cholesterol",
  }));
  const source = podRowsSource(
    rowsOfEntries({
      ask: async (question) =>
        question === "entry/What it shows" ? shows : [],
    }),
  );
  for (const [handle, ok] of [
    [`L${sha(first!).slice(0, 8)}`, true],
    [`L${sha(later!).slice(0, 12)}`, true],
    [`C${sha(first!).slice(0, 8)}`, false],
    [`L${sha("urn:uuid:other").slice(0, 8)}`, false],
  ] as const)
    assert.equal(
      (await checkCitation({ cite: { entry: handle }, name: "LDL" }, source))
        .ok,
      ok,
      handle,
    );
});

test("a records absence is backed only by the sources it names, each read whole, none holding it", async () => {
  const text = (file: string) => readFile(`${FOLDER}${file}`, "utf8");
  const absence = {
    what: "a colonoscopy",
    coverage: "both documents",
    match: { terms: ["colonoscopy"], codes: ["73761001"] },
    sources: ["bundle.json", "summary.xml"],
  };
  const read = ["bundle.json", "summary.xml"];
  for (const [what, claim, files, backing] of [
    ["backed", absence, read, { backed: true }],
    [
      "a source not read",
      absence,
      ["bundle.json"],
      { backed: false, reason: "source not read: summary.xml" },
    ],
    [
      "sources naming no file",
      { ...absence, sources: [] },
      read,
      { backed: false, reason: "sources leave out: bundle.json, summary.xml" },
    ],
    [
      "the records hold it",
      { ...absence, match: { terms: ["pulmonary embolism"] } },
      read,
      { backed: false, reason: "records hold it: bundle.json" },
    ],
    [
      "only records before the date it is absent after",
      { ...absence, match: { codes: ["4548-4"], after: "2025-08-19" } },
      read,
      { backed: true },
    ],
    [
      "a record after that date",
      { ...absence, match: { codes: ["4548-4"], after: "2025-08-01" } },
      read,
      { backed: false, reason: "records hold it: bundle.json" },
    ],
  ] as const)
    assert.deepEqual(
      await checkRecordsAbsence(claim, files, text, read),
      backing,
      what,
    );
});

test("an absence is held to what it is of: a pod question of its kind, every file for records, and the key item it ties to", async () => {
  const immunizations = {
    tool: "ask",
    input: { pod: "p", question: "pod/My immunizations" },
    ok: true,
    answer: JSON.stringify({ total: 0, rows: [] }),
  };
  const colonoscopy = {
    what: "no colonoscopy",
    coverage: "every procedure",
    match: { terms: ["colonoscopy"] },
    query: {
      tool: "ask",
      input: { pod: "p", question: "pod/My immunizations" },
    },
  };
  assert.deepEqual(
    checkAbsence(colonoscopy, [immunizations], {
      kind: "procedure",
      terms: ["colonoscopy"],
    }),
    { backed: false, reason: "a question of another kind" },
  );
  assert.deepEqual(
    checkAbsence(
      {
        ...colonoscopy,
        what: "no urine albumin",
        match: { codes: ["14959-1"] },
      },
      [immunizations],
    ),
    { backed: false, reason: "a question of another kind" },
  );
  const labs = {
    tool: "ask",
    input: { pod: "p", question: "pod/My lab results" },
    ok: true,
    answer: JSON.stringify({
      total: 1,
      rows: [{ test: "FIT", code: "http://loinc.org/rdf/29771-3" }],
    }),
  };
  assert.deepEqual(
    checkAbsence(
      {
        what: "no stool test",
        coverage: "every result",
        match: { terms: ["guaiac"] },
        query: { tool: "ask", input: labs.input },
      },
      [labs],
      { kind: "lab", codes: ["29771-3"] },
    ),
    { backed: false, reason: "query found it" },
  );
  const text = (file: string) => readFile(`${FOLDER}${file}`, "utf8");
  const all = ["bundle.json", "summary.xml"];
  const fit = {
    what: "no stool test",
    coverage: "every document",
    match: { terms: ["guaiac"] },
  };
  assert.deepEqual(
    await checkRecordsAbsence(
      { ...fit, sources: ["summary.xml"] },
      all,
      text,
      all,
    ),
    { backed: false, reason: "sources leave out: bundle.json" },
  );
  assert.deepEqual(await checkRecordsAbsence(fit, all, text, all), {
    backed: true,
  });
  assert.deepEqual(
    await checkRecordsAbsence(fit, all, text, all, { codes: ["29771-3"] }),
    { backed: false, reason: "records hold it: bundle.json" },
  );
});

const REPORT = "pod://p/clinical/reports.ttl#ct";
const PERSON = "urn:uuid:a6bce037-019e-4220-92b1-cab8d308410a";
const NS = "https://ns.cascadeprotocol.org/cascade#";
const entryRows = (entry: string) =>
  entry === REPORT
    ? [
        {
          field: `${NS}reportName`,
          value: "CT angiography chest (pulmonary embolism protocol)",
        },
        { field: `${NS}reportCode`, value: "http://loinc.org/rdf/24627-2" },
        { field: `${NS}reportEffectiveTime`, value: "2025-07-08T22:30:00Z" },
        { field: `${NS}reportIssuedTime`, value: "2025-07-08T23:05:00Z" },
        { field: `${NS}workflowStatus`, value: "final" },
        {
          field: `${NS}reportConclusion`,
          value:
            "No pulmonary embolism. Lungs are clear. Mild degenerative changes of the thoracic spine.",
        },
      ]
    : undefined;
const person = podRowsSource(
  async (entry) => entryRows(entry),
  async () => [
    {
      subject: PERSON,
      subjectLabel: "The person this pod is about",
      dateOfBirth: "urn:uuid:04cd6e3f-922b-8f2d-ad65-81a0a7842efc 1957-09-30",
      dateOfDeath: "urn:uuid:04cd6e3f-922b-8f2d-ad65-81a0a7842efc 2024-03-04",
      administrativeGender:
        "urn:uuid:04cd6e3f-922b-8f2d-ad65-81a0a7842efc female",
    },
  ],
);

test("a pod report is read for its name, code, dates and conclusion, and the person by their subject IRI", async () => {
  const cases: [string, Citation, boolean][] = [
    [
      "a report by name, code, date and quote",
      {
        cite: { entry: REPORT },
        name: "CT angiography chest",
        code: "24627-2",
        date: "2025-07-08",
        quote: "No pulmonary embolism. Lungs are clear.",
      },
      true,
    ],
    [
      "a report's issue time is its recorded date",
      { cite: { entry: REPORT }, date: "2025-07-08", dateKind: "recorded" },
      true,
    ],
    [
      "words the conclusion does not say",
      { cite: { entry: REPORT }, quote: "A large pulmonary embolism" },
      false,
    ],
    [
      "the person's birth date",
      { cite: { entry: PERSON }, date: "1957-09-30" },
      true,
    ],
    [
      "another birth date of the person",
      { cite: { entry: PERSON }, date: "1957-09-29" },
      false,
    ],
    [
      "an IRI that is not the person",
      { cite: { entry: "urn:uuid:other" }, date: "1957-09-30" },
      false,
    ],
  ];
  for (const [what, claim, held] of cases)
    assert.equal((await checkCitation(claim, person)).ok, held, what);
});

test("a FHIR resource's dosage and instruction text can be quoted", async () => {
  const cases: [string, Citation, boolean][] = [
    [
      "a request's dosage text",
      {
        cite: order,
        quote: "Take 1 tablet by mouth once daily in the morning.",
      },
      true,
    ],
    [
      "a request's patient instruction",
      { cite: order, quote: "Take with food." },
      true,
    ],
    [
      "a statement's dosage text",
      { cite: metformin, quote: "500 mg twice daily" },
      true,
    ],
    [
      "words the dosage does not say",
      { cite: order, quote: "Take 2 tablets daily" },
      false,
    ],
  ];
  for (const [what, claim, held] of cases)
    assert.equal((await checkCitation(claim, downloads)).ok, held, what);
});

/** Nodes the views construct beside the entry, which the entry question leaves out; they are not fields. */
const APART = new Set([
  "valuesOfMember",
  "memberCurrentValues",
  "paddedDateTime",
  "paddedDateTimeProperty",
  "writtenDate",
  "referenceRangeLow",
  "referenceRangeHigh",
  "decimalValue",
  "writtenValue",
  "ucumUnit",
  "unitText",
]);

/** The field names one view's CONSTRUCT template writes; it throws, saying what to do, on a view or a prefix it cannot read. */
function constructedBy(file: string, text: string): string[] {
  const from = text.indexOf("CONSTRUCT {");
  const to = text.search(/^WHERE/m);
  if (from === -1 || to < from)
    throw new Error(
      `${file} has no "CONSTRUCT {" block ending at a line that starts with WHERE, so its fields cannot be read: ` +
        `put the template in that shape, or teach this test the view's shape`,
    );
  const template = text.slice(from, to);
  const prefix = /\b([A-Za-z]\w*):([A-Za-z_]\w*)/g;
  const names: string[] = [];
  for (const [, at, name] of template.matchAll(prefix)) {
    if (!["cascade", "prov", "obo"].includes(at!))
      throw new Error(
        `${file} writes ${at}:${name}, a prefix this test does not read, so a field could be missed: ` +
          `add "${at}" to the prefixes read in constructedBy, then map the field in POD_FIELDS or POD_NOT_CHECKABLE`,
      );
    if (/^[a-z]|^RO_/.test(name!) && !APART.has(name!)) names.push(name!);
  }
  if (/<https?:/.test(template))
    throw new Error(
      `${file} writes a field by full IRI, which this test does not read: write it with a prefix`,
    );
  return names;
}

/** The field names the vocabulary's views construct on an entry. */
async function viewFields(): Promise<string[]> {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const { folder } = await resolveVocabulary(root, await readConfig(root));
  const dir = join(folder, "queries", "views");
  const names = new Set<string>();
  for (const file of (await readdir(dir)).filter((it) => it.endsWith(".rq")))
    for (const name of constructedBy(
      file,
      await readFile(join(dir, file), "utf8"),
    ))
      names.add(name);
  return [...names].sort();
}

test("a view this test cannot read fails saying so and what to do", () => {
  assert.throws(
    () => constructedBy("x.rq", "SELECT ?a WHERE { }"),
    /x\.rq has no "CONSTRUCT \{" block.*WHERE/,
  );
  assert.throws(
    () => constructedBy("x.rq", "CONSTRUCT { ?e foo:bar ?v }\nWHERE { }"),
    /x\.rq writes foo:bar, a prefix this test does not read.*add "foo"/,
  );
  assert.deepEqual(
    constructedBy("x.rq", "CONSTRUCT { ?e cascade:testName ?v }\nWHERE { }"),
    ["testName"],
  );
});

test("every field the vocabulary's views construct is a kind of field or on the not-checkable list", async () => {
  const fields = await viewFields();
  assert.ok(fields.length > 40, "the views were read");
  const unmapped = fields.filter(
    (name) => !(name in POD_FIELDS) && !POD_NOT_CHECKABLE.includes(name),
  );
  assert.deepEqual(
    unmapped,
    [],
    `the views construct ${unmapped.join(", ")}, which the checker does not know. If a view now sends a field: map it in ` +
      `POD_FIELDS, or list it in POD_NOT_CHECKABLE. If the vocabulary change is not on this branch: land this runtime ` +
      `PR with the vocabulary PR, each naming the other on a Depends-On line. If it is a helper node beside the entry: ` +
      `add it to APART in this test`,
  );
  assert.deepEqual(
    POD_NOT_CHECKABLE.filter((name) => name in POD_FIELDS),
    [],
    "a field is checkable or not, never both: remove it from one of POD_FIELDS and POD_NOT_CHECKABLE",
  );
  assert.deepEqual(
    [...Object.keys(POD_FIELDS), ...POD_NOT_CHECKABLE].filter(
      (name) => !fields.includes(name) && !DERIVED.includes(name),
    ),
    [],
    "a field no view sends is no coverage: remove it from POD_FIELDS or POD_NOT_CHECKABLE, or add it to DERIVED if a derivation puts it on the entry",
  );
});

/** Fields a derivation, not a view, puts on an entry. */
const DERIVED = [
  "dateFrom",
  "medicationUseStartDateFrom",
  "prescriptionWrittenDateFrom",
  "type",
];

test("a quote holds as whole words, not as a fragment of a word, in both arms", async () => {
  const cases: [string, Citation, boolean][] = [
    [
      "pod: a fragment from mid-word to mid-word",
      { cite: { entry: REPORT }, quote: "m. Lungs are cl" },
      false,
    ],
    [
      "pod: words that start mid-word",
      { cite: { entry: REPORT }, quote: "ungs are clear" },
      false,
    ],
    [
      "pod: whole words, any case and spacing",
      { cite: { entry: REPORT }, quote: "lungs  ARE clear." },
      true,
    ],
    [
      "records: a fragment from mid-word",
      { cite: order, quote: "ake 1 tablet by mouth" },
      false,
    ],
    [
      "records: whole words",
      { cite: order, quote: "Take 1 tablet by mouth" },
      true,
    ],
  ];
  for (const [what, claim, held] of cases)
    assert.equal(
      (
        await checkCitation(
          claim,
          claim.cite && "entry" in claim.cite ? person : downloads,
        )
      ).ok,
      held,
      what,
    );
});

test("both arms read the person alike: a death is an end, a gender a value", async () => {
  const pods = { entry: PERSON };
  const patient = { file: "bundle.json", resource: "Patient/p-1" };
  const cases: [string, Citation, Citation, boolean][] = [
    [
      "gender",
      { cite: pods, value: "female" },
      { cite: patient, value: "female" },
      true,
    ],
    [
      "another gender",
      { cite: pods, value: "male" },
      { cite: patient, value: "male" },
      false,
    ],
    [
      "the death as an end",
      { cite: pods, date: "2024-03-04", dateKind: "end" },
      { cite: patient, date: "2024-03-04", dateKind: "end" },
      true,
    ],
    [
      "the death date as a birth date",
      { cite: pods, date: "2024-03-04" },
      { cite: patient, date: "2024-03-04" },
      false,
    ],
  ];
  for (const [what, onPod, onRecords, held] of cases) {
    assert.equal((await checkCitation(onPod, person)).ok, held, `pod: ${what}`);
    assert.equal(
      (await checkCitation(onRecords, downloads)).ok,
      held,
      `records: ${what}`,
    );
  }
});

test("a pod medication's dosage text is quoted from the entry", async () => {
  const lisinopril = "pod://p/clinical/medications.ttl#lisinopril";
  const medications = podRowsSource(async (entry) =>
    entry === lisinopril
      ? [
          { field: `${NS}drugName`, value: "lisinopril 10 MG Oral Tablet" },
          { field: `${NS}dosage`, value: "1 tablet by mouth every morning" },
        ]
      : undefined,
  );
  const cases: [string, Citation, boolean][] = [
    [
      "the dosage as written",
      { cite: { entry: lisinopril }, quote: "1 tablet by mouth every morning" },
      true,
    ],
    [
      "a dosage the entry does not state",
      { cite: { entry: lisinopril }, quote: "2 tablets by mouth every night" },
      false,
    ],
  ];
  for (const [what, claim, held] of cases)
    assert.equal((await checkCitation(claim, medications)).ok, held, what);
});

test("the text a source wrote for a procedure or a lab result is quoted from the entry", async () => {
  const colonoscopy = "pod://p/clinical/procedures.ttl#colonoscopy";
  const tsh = "pod://p/clinical/lab-results.ttl#tsh";
  const rows = podRowsSource(async (entry) =>
    entry === colonoscopy
      ? [
          { field: `${NS}procedureName`, value: "Colonoscopy" },
          { field: `${NS}narrativeText`, value: "Normal; repeat in 10 years." },
        ]
      : entry === tsh
        ? [
            { field: `${NS}testName`, value: "TSH" },
            {
              field: `${NS}narrativeText`,
              value: "TSH\n2.1 mIU/L\nhistorical result",
            },
          ]
        : undefined,
  );
  const cases: [string, Citation, boolean][] = [
    [
      "the finding beside a procedure",
      { cite: { entry: colonoscopy }, quote: "repeat in 10 years" },
      true,
    ],
    [
      "a label across the lines of a row's text",
      { cite: { entry: tsh }, quote: "2.1 mIU/L historical result" },
      true,
    ],
    [
      "a finding the entry does not state",
      { cite: { entry: colonoscopy }, quote: "repeat in 5 years" },
      false,
    ],
  ];
  for (const [what, claim, held] of cases)
    assert.equal((await checkCitation(claim, rows)).ok, held, what);
});

test("a name holds as whole words in both arms, and a gene change's coding expression is a code, not a name", async () => {
  const variant = "pod://p/genetics.ttl#v1";
  const variants = podRowsSource(async (entry) =>
    entry === variant
      ? [
          {
            field: `${NS}hgvsCodingDnaExpression`,
            value: "NM_000249.3:c.2042C>T",
          },
        ]
      : undefined,
  );
  const patient = { file: "bundle.json", resource: "Patient/p-1" };
  const cases: [string, Citation, Source, boolean][] = [
    [
      "pod: a fragment of a word",
      { cite: { entry: REPORT }, name: "pulm" },
      person,
      false,
    ],
    [
      "pod: a fragment inside a word",
      { cite: { entry: REPORT }, name: "ulmonary" },
      person,
      false,
    ],
    [
      "pod: whole words",
      { cite: { entry: REPORT }, name: "pulmonary embolism" },
      person,
      true,
    ],
    [
      "records: a fragment of a word",
      { cite: patient, name: "Tam" },
      downloads,
      false,
    ],
    [
      "records: a whole name",
      { cite: patient, name: "tamsin vale" },
      downloads,
      true,
    ],
    [
      "a coding expression is no name",
      { cite: { entry: variant }, name: "c.2" },
      variants,
      false,
    ],
    [
      "a coding expression is a code",
      { cite: { entry: variant }, code: "NM_000249.3:c.2042C>T" },
      variants,
      true,
    ],
  ];
  for (const [what, claim, source, held] of cases)
    assert.equal((await checkCitation(claim, source)).ok, held, what);
});

test("a pod code is claimed with the system the compact read shows for its IRI, whichever vocabulary namespace it is in, and only that one", async () => {
  const NS_CODES = "https://ns.cascadeprotocol.org/codes/";
  const codes = podRowsSource(async () => [
    { field: "cascade:rxNormCode", value: `${NS_CODES}rxnorm/199903` },
    { field: "cascade:snomedCode", value: "http://snomed.info/id/59282003" },
    { field: "cascade:testCode", value: "https://loinc.org/rdf/4548-4" },
    { field: "cascade:hgvsCodingDnaExpression", value: "NM_000249.3:c.2T>C" },
  ]);
  const held = async (code: string) =>
    (await checkCitation({ cite: { entry: "e" }, code }, codes)).ok;
  for (const code of [
    "rxnorm:199903",
    "snomed:59282003",
    "loinc:4548-4",
    "NM_000249.3:c.2T>C",
  ])
    assert.equal(await held(code), true, code);
  for (const code of ["snomed:199903", "rxnorm:59282003", "loinc:59282003"])
    assert.equal(await held(code), false, code);
});

test("a narrative line's date after reported or recorded is its recorded date, and one after started is not", () => {
  const recorded = (line: string) =>
    narrativeFields(`<tr><td>${line}</td></tr>`).recorded;
  assert.deepEqual(recorded("Patient reported, May 14, 2026"), [
    "May 14, 2026",
  ]);
  assert.deepEqual(recorded("Recorded on 2026-05-14"), ["2026-05-14"]);
  assert.deepEqual(recorded("Started on 2026-05-14"), []);
  for (const line of [
    "Unreported 2026-05-14",
    "Not documented on 2026-05-14",
    "Never recorded 2026-05-14",
    "Misreported 2026-05-14",
  ])
    assert.deepEqual(recorded(line), [], line);
});

test("a Patient's deceasedBoolean is a value and its deceasedDateTime an end", () => {
  const fields = fhirFields({
    resourceType: "Patient",
    deceasedBoolean: true,
    deceasedDateTime: "2024-03-04T10:00:00Z",
  });
  assert.deepEqual(fields.value, ["true"]);
  assert.deepEqual(fields.end, ["2024-03-04T10:00:00Z"]);
});

test("an absence is not found in a row's provenance: the date a pod row was retrieved is not the date of what it records", () => {
  const input = { pod: "p", question: "pod/My lab results" };
  const lab = (performed: string) => ({
    test: "Hemoglobin A1c",
    code: "http://loinc.org/rdf/4548-4",
    performed,
    entry: "pod://p/clinical/lab-results.ttl#a1c",
    sources:
      "urn:uuid:91490b7d from ni:///sha-256;Uh, retrieved 2026-10-15T00:00:00Z, written by Cascade North Demo Hospital",
  });
  const ran = (...rows: unknown[]) => [
    {
      tool: "ask",
      input,
      ok: true,
      answer: JSON.stringify({ total: rows.length, rows }),
    },
  ];
  const absence = {
    what: "an A1c since February",
    coverage: "every lab result the pod holds",
    match: { codes: ["4548-4"], after: "2026-02-17" },
    query: { tool: "ask", input },
  };
  assert.deepEqual(
    checkAbsence(absence, ran(lab("2026-02-16T16:00:00Z"))),
    { backed: true },
    "retrieved after the day, performed before it",
  );
  assert.deepEqual(
    checkAbsence(absence, ran(lab("2026-03-01T16:00:00Z"))),
    { backed: false, reason: "query found it" },
    "performed after the day",
  );
});

test("a refuted or entered-in-error record is no presence, in both arms", async () => {
  const absence = {
    what: "a pulmonary embolism",
    coverage: "every record",
    match: { codes: ["59282003"], terms: ["pulmonary embolism"] },
  };
  const condition = (verification: string) =>
    JSON.stringify({
      resourceType: "Bundle",
      entry: [
        {
          resource: {
            resourceType: "Condition",
            id: "pe",
            verificationStatus: { coding: [{ code: verification }] },
            code: {
              coding: [{ system: "http://snomed.info/sct", code: "59282003" }],
              text: "Pulmonary embolism",
            },
            onsetDateTime: "2025-07-08",
          },
        },
      ],
    });
  const records = async (verification: string) =>
    checkRecordsAbsence(
      absence,
      ["b.json"],
      async () => condition(verification),
      ["b.json"],
    );
  assert.deepEqual(await records("refuted"), { backed: true });
  assert.deepEqual(await records("entered-in-error"), { backed: true });
  assert.deepEqual(await records("confirmed"), {
    backed: false,
    reason: "records hold it: b.json",
  });
  const input = { pod: "p", question: "pod/My medication history" };
  const pod = (status: string) =>
    checkAbsence({ ...absence, query: { tool: "ask", input } }, [
      {
        tool: "ask",
        input,
        ok: true,
        answer: JSON.stringify({
          total: 1,
          rows: [{ medication: "Pulmonary embolism", status }],
        }),
      },
    ]);
  assert.deepEqual(pod("entered-in-error"), { backed: true });
  assert.deepEqual(pod("refuted"), { backed: true });
  assert.deepEqual(pod("active"), { backed: false, reason: "query found it" });
  assert.deepEqual(pod("ruled out"), { backed: true });

  const history = { pod: "p", question: "pod/My condition history" };
  const tamsin = (row: Record<string, string>) =>
    checkAbsence({ ...absence, query: { tool: "ask", input: history } }, [
      {
        tool: "ask",
        input: history,
        ok: true,
        answer: JSON.stringify({
          total: 1,
          rows: [
            {
              condition: "Pulmonary embolism",
              snomed: "http://snomed.info/id/59282003",
              onset: "2025-07-08",
              abated: "2025-07-08",
              ...row,
            },
          ],
        }),
      },
    ]);
  assert.deepEqual(
    tamsin({ status: "ruled out", verificationStatus: "refuted" }),
    { backed: true },
    "resolved and refuted at its source: ruled out, no presence",
  );
  assert.deepEqual(tamsin({ status: "resolved" }), {
    backed: false,
    reason: "query found it",
  });
  assert.deepEqual(
    narrativeFields("<paragraph>Pulmonary embolism ruled out by CT</paragraph>")
      .status,
    ["ruled-out"],
  );
  assert.deepEqual(
    narrativeFields(
      "<paragraph>Pulmonary embolism not ruled out; to be ruled out</paragraph>",
    ).status,
    [],
    "a ruling out that has not happened withdraws nothing",
  );
});

test("a citation of a condition its source refutes holds as ruled out, never as resolved", async () => {
  const PE = "pod://p/clinical/conditions.ttl#pe";
  const refuted = podRowsSource(async (entry) =>
    entry === PE
      ? [
          { field: `${NS}conditionName`, value: "Pulmonary embolism" },
          { field: `${NS}clinicalStatus`, value: "resolved" },
          { field: `${NS}verificationStatus`, value: "refuted" },
        ]
      : undefined,
  );
  for (const [status, held] of [
    ["ruled out", true],
    ["ruled-out", true],
    ["refuted", true],
    ["resolved", false],
    ["active", false],
  ] as const)
    assert.equal(
      (await checkCitation({ cite: { entry: PE }, status }, refuted)).ok,
      held,
      status,
    );
});

test("only a ruling out that was made withdraws a narrative line", () => {
  const status = (line: string) =>
    narrativeFields(`<paragraph>${line}</paragraph>`).status;
  for (const line of [
    "Pulmonary embolism was ruled out by CT",
    "Pulmonary embolism ruled out",
    "Pulmonary embolism has been ruled out",
    "On May 3, 2025, PE was ruled out by CTA",
    "May 2025: pulmonary embolism ruled out",
    "CTA obtained to rule out PE, PE ruled out",
    "Chest pain thought to be musculoskeletal, PE ruled out",
    "Patient unable to walk far, PE ruled out by CTA",
    "No acute distress, PE ruled out",
  ])
    assert.deepEqual(status(line), ["ruled-out"], line);
  for (const line of [
    "Pulmonary embolism could not be ruled out",
    "Pulmonary embolism not yet ruled out",
    "Pulmonary embolism hasn't been ruled out",
    "Pulmonary embolism has not been ruled out",
    "Pulmonary embolism should be ruled out",
    "Pulmonary embolism must be ruled out",
    "Pulmonary embolism needs to be ruled out",
    "Pulmonary embolism: to rule out",
  ])
    assert.deepEqual(status(line), [], line);
});

const held = (file: string) => ({
  backed: false,
  reason: `records hold it: ${file}`,
});
const inRecords = (
  after: string | undefined,
  terms: string[],
  doc: string,
  codes: string[] = [],
) =>
  checkRecordsAbsence(
    {
      what: "x",
      coverage: "every record",
      match: { codes, terms, ...(after === undefined ? {} : { after }) },
    },
    ["b"],
    async () => doc,
    ["b"],
  );
const observation = (fields: Record<string, unknown>) => ({
  resourceType: "Observation",
  id: "o",
  code: { coding: [{ code: "4548-4" }], text: "Hemoglobin A1c" },
  effectiveDateTime: "2026-02-16",
  ...fields,
});
const bundle = (...resources: unknown[]) =>
  JSON.stringify({
    resourceType: "Bundle",
    entry: [
      ...resources.map((resource) => ({ resource })),
      {
        resource: {
          resourceType: "Patient",
          id: "pt",
          birthDate: "2026-03-01",
        },
      },
    ],
  });

test("a JSON download that starts with a newline or a byte-order mark is read as JSON", async () => {
  const doc = bundle(observation({}));
  const after = "2026-02-17";
  assert.deepEqual(await inRecords(after, [], doc, ["4548-4"]), {
    backed: true,
  });
  assert.deepEqual(await inRecords(after, [], `\n${doc}`, ["4548-4"]), {
    backed: true,
  });
  assert.deepEqual(await inRecords(after, [], `\uFEFF${doc}`, ["4548-4"]), {
    backed: true,
  });
});

test("a code is not a date: a long number is a day only when it is one", async () => {
  const condition = (onset: string) =>
    bundle({
      resourceType: "Condition",
      id: "c",
      code: { coding: [{ code: "44054006" }], text: "Type 2 diabetes" },
      onsetDateTime: onset,
    });
  assert.deepEqual(
    await inRecords("2030-01-01", [], condition("2022-01-01"), ["44054006"]),
    {
      backed: true,
    },
  );
  assert.deepEqual(
    await inRecords("2020-01-01", [], condition("2022-01-01"), ["44054006"]),
    held("b"),
  );
  assert.equal(isoDate("44054006"), undefined);
  assert.equal(isoDate("20250230"), undefined);
  assert.equal(isoDate("20250219120000"), "2025-02-19");
  assert.equal(isoDate("2025-13-01"), undefined);
  const input = { pod: "p", question: "pod/My active conditions" };
  assert.deepEqual(
    checkAbsence(
      {
        what: "x",
        coverage: "every condition",
        match: { codes: ["44054006"], after: "2030-01-01" },
        query: { tool: "ask", input },
      },
      [
        {
          tool: "ask",
          input,
          ok: true,
          answer: JSON.stringify({
            total: 1,
            rows: [{ condition: "T2DM 44054006", onset: "2022-01-01" }],
          }),
        },
      ],
    ),
    { backed: true },
  );
});

test("a record is dated by its clinical dates, not by when it was written: the same A1c has the same verdict in both arms", async () => {
  const absence = {
    what: "an A1c since February",
    coverage: "every lab result",
    match: { codes: ["4548-4"], after: "2026-02-17" },
  };
  assert.deepEqual(
    await inRecords(
      "2026-02-17",
      [],
      bundle(observation({ meta: { lastUpdated: "2026-10-15T16:00:00Z" } })),
      ["4548-4"],
    ),
    { backed: true },
  );
  const input = { pod: "p", question: "pod/My lab results" };
  assert.deepEqual(
    checkAbsence({ ...absence, query: { tool: "ask", input } }, [
      {
        tool: "ask",
        input,
        ok: true,
        answer: JSON.stringify({
          total: 1,
          rows: [
            {
              test: "Hemoglobin A1c 4548-4",
              performed: "2026-02-16",
              sources: [{ retrieved: "2026-10-15" }],
            },
          ],
        }),
      },
    ]),
    { backed: true },
  );
  const ccda = (author: string) =>
    `<ClinicalDocument><component><structuredBody><component><section><entry><observation classCode="OBS" moodCode="EVN"><code code="4548-4"/><effectiveTime value="20260216"/>${author}</observation></entry></section></component></structuredBody></component></ClinicalDocument>`;
  const written = '<author><time value="20261015"/></author>';
  assert.deepEqual(
    await inRecords("2026-02-17", [], ccda(written), ["4548-4"]),
    { backed: true },
  );
  assert.deepEqual(
    await inRecords("2026-02-01", [], ccda(written), ["4548-4"]),
    held("b"),
  );
  const participation =
    '<author><templateId root="2.16.840.1.113883.10.20.22.4.119"/><time value="20261015"/></author>';
  assert.deepEqual(ccdaFields(ccda(participation)).recorded, ["20261015"]);
});

test("a C-CDA record that is negated, nullified or entered in error is no presence", async () => {
  const entry = (tag: string, status: string, body = "") =>
    `<ClinicalDocument><component><structuredBody><component><section><entry><observation classCode="OBS" moodCode="EVN"${tag}><code code="59282003" displayName="Pulmonary embolism"/>${status}<effectiveTime value="20250708"/>${body}</observation></entry></section></component></structuredBody></component></ClinicalDocument>`;
  const live = entry("", '<statusCode code="completed"/>');
  const negated = entry(
    ' negationInd="true"',
    '<statusCode code="completed"/>',
  );
  const nullified = entry("", '<statusCode code="nullified"/>');
  for (const after of [undefined, "2025-01-01"]) {
    assert.deepEqual(
      await inRecords(after, ["pulmonary embolism"], live, ["59282003"]),
      held("b"),
    );
    assert.deepEqual(
      await inRecords(after, ["pulmonary embolism"], negated, ["59282003"]),
      { backed: true },
    );
    assert.deepEqual(
      await inRecords(after, ["pulmonary embolism"], nullified, ["59282003"]),
      { backed: true },
    );
  }
  const narrative = (status: string) =>
    `<ClinicalDocument><component><structuredBody><component><section><text><table><tbody><tr><td>Pulmonary embolism</td><td>${status}</td><td>July 8, 2025</td></tr></tbody></table></text></section></component></structuredBody></component></ClinicalDocument>`;
  for (const after of [undefined, "2025-01-01"]) {
    assert.deepEqual(
      await inRecords(after, ["pulmonary embolism"], narrative("active")),
      held("b"),
    );
    assert.deepEqual(
      await inRecords(
        after,
        ["pulmonary embolism"],
        narrative("entered in error"),
      ),
      { backed: true },
    );
  }
});

test("a withdrawn record with an after date holds nothing", async () => {
  const pe = (verification: string) =>
    bundle({
      resourceType: "Condition",
      id: "pe",
      verificationStatus: { coding: [{ code: verification }] },
      code: { coding: [{ code: "59282003" }], text: "Pulmonary embolism" },
      onsetDateTime: "2025-07-08",
    });
  for (const status of ["refuted", "entered-in-error"])
    assert.deepEqual(
      await inRecords("2025-01-01", ["pulmonary embolism"], pe(status)),
      { backed: true },
    );
  assert.deepEqual(
    await inRecords("2025-01-01", ["pulmonary embolism"], pe("confirmed")),
    held("b"),
  );
  assert.deepEqual(
    await inRecords("2026-01-01", ["pulmonary embolism"], pe("confirmed")),
    { backed: true },
  );
});

const narrativeRow = (cells: string) =>
  `<ClinicalDocument><component><structuredBody><component><section><text><table><tbody><tr>${cells}</tr></tbody></table></text></section></component></structuredBody></component></ClinicalDocument>`;

test("a narrative row that says it was not entered in error, or lists none, is a live row", async () => {
  for (const status of [
    "Not entered in error",
    "Entered in error: none",
    "Entered in error: no",
  ])
    for (const after of [undefined, "2025-01-01"])
      assert.deepEqual(
        await inRecords(
          after,
          ["pulmonary embolism"],
          narrativeRow(
            `<td>Pulmonary embolism</td><td>${status}</td><td>July 8, 2025</td>`,
          ),
        ),
        held("b"),
        status,
      );
});

test("a narrative row dated in words is dated: it backs an absence after a later day and not after an earlier one", async () => {
  const row = narrativeRow(
    "<td>Hemoglobin A1c 4548-4</td><td>February 16, 2026</td>",
  );
  assert.deepEqual(await inRecords("2026-02-17", [], row, ["4548-4"]), {
    backed: true,
  });
  assert.deepEqual(
    await inRecords("2026-02-16", [], row, ["4548-4"]),
    held("b"),
  );
  assert.deepEqual(
    await inRecords("2026-02-01", [], row, ["4548-4"]),
    held("b"),
  );
});

test("a partial date is the whole period it names: it backs an absence after a day only if the period ends before it", async () => {
  const ccda = (value: string) =>
    `<ClinicalDocument><component><structuredBody><component><section><entry><observation classCode="OBS" moodCode="EVN"><code code="4548-4"/><effectiveTime value="${value}"/></observation></entry></section></component></structuredBody></component></ClinicalDocument>`;
  for (const [value, after, backed] of [
    ["2025", "2026-01-01", true],
    ["2025", "2025-12-31", false],
    ["2025", "2025-06-01", false],
    ["202507", "2025-08-01", true],
    ["202507", "2025-07-31", false],
    ["202507", "2025-07-15", false],
  ] as const)
    assert.deepEqual(
      await inRecords(after, [], ccda(value), ["4548-4"]),
      backed ? { backed: true } : held("b"),
      `${value} after ${after}`,
    );
  assert.deepEqual(
    await inRecords(
      "2025-08-01",
      [],
      bundle(observation({ effectiveDateTime: "2025-07" })),
      ["4548-4"],
    ),
    { backed: true },
  );
  assert.deepEqual(
    await inRecords(
      "2025-07-15",
      [],
      bundle(observation({ effectiveDateTime: "2025-07" })),
      ["4548-4"],
    ),
    held("b"),
  );
});

test("a negation in one cell does not negate the next cell's entered in error", async () => {
  assert.deepEqual(
    await inRecords(
      undefined,
      ["hives"],
      narrativeRow(
        "<td>Hives</td><td>No</td><td>Entered in error</td><td>July 8, 2025</td>",
      ),
    ),
    { backed: true },
  );
});

test("a cell that denies being entered in error, however it is worded, is a live row; one that names an earlier clause's negation still withdraws", async () => {
  const row = (status: string) =>
    narrativeRow(`<td>Hives</td><td>${status}</td><td>July 8, 2025</td>`);
  for (const status of [
    "Has not been entered in error",
    "Not marked as entered in error",
    "No longer entered in error",
    "Entered in error? No",
    "Entered in error - no",
    "Entered in error (none)",
    "Entered in error: not",
  ])
    assert.deepEqual(
      await inRecords(undefined, ["hives"], row(status)),
      held("b"),
      status,
    );
  for (const status of [
    "Not applicable; entered in error",
    "No known allergy. Entered in error",
    "Entered in error: Yes",
  ])
    assert.deepEqual(
      await inRecords(undefined, ["hives"], row(status)),
      { backed: true },
      status,
    );
});

test("a partial date is read from a time element only, not from a quantity's value", async () => {
  const doc = `<ClinicalDocument><component><structuredBody><component><section><entry><observation classCode="OBS" moodCode="EVN"><code code="4548-4"/><effectiveTime value="20200101"/><value xsi:type="PQ" value="2050" unit="mg"/></observation></entry></section></component></structuredBody></component></ClinicalDocument>`;
  assert.deepEqual(await inRecords("2026-01-01", [], doc, ["4548-4"]), {
    backed: true,
  });
});

test("a year and month inside a longer number or range is no partial date", async () => {
  assert.deepEqual(
    await inRecords(
      "2026-01-01",
      [],
      narrativeRow(
        "<td>Hemoglobin A1c 4548-4 lot 1000-2050-12</td><td>January 5, 2025</td>",
      ),
      ["4548-4"],
    ),
    { backed: true },
  );
});

test("a quote is three words, or all of a text that has fewer", () => {
  const texts = ["No pulmonary embolism seen", "Not seen"];
  assert.deepEqual(
    ["No pulmonary", "No pulmonary embolism", "Not seen", "seen"].map((quote) =>
      quoteLongEnough(quote, texts),
    ),
    [false, true, true, false],
  );
});
