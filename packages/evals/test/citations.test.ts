import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  type Claim,
  checkAbsence,
  checkCitation,
  checkRecordsAbsence,
  downloadsSource,
  podRowsSource,
} from "../src/citations.js";

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
  const cases: [string, Claim, Expected][] = [
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
      "a pod entry's range is no value",
      { cite: { entry: LDL }, value: "99" },
      otherwise("value 99"),
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
      "no sources",
      { ...absence, sources: [] },
      read,
      { backed: false, reason: "no sources" },
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
      await checkRecordsAbsence(claim, files, text),
      backing,
      what,
    );
});
