import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  type Claim,
  checkAbsence,
  checkCitation,
  checkRecordsAbsence,
  downloadsSource,
  POD_FIELDS,
  POD_NOT_CHECKABLE,
  podRowsSource,
} from "../src/citations.js";
import {
  entryRows as entryRowsOf,
  PINNED_QUESTIONS,
  personRows as personRowsOf,
} from "../src/checks.js";
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
  const cases: [string, Claim, boolean][] = [
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
  const cases: [string, Claim, boolean][] = [
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

/** The field names the vocabulary's views construct on an entry; the nodes the entry question leaves out are not fields. */
async function viewFields(): Promise<string[]> {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const { folder } = await resolveVocabulary(root, await readConfig(root));
  const dir = join(folder, "queries", "views");
  const apart = new Set([
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
  const names = new Set<string>();
  for (const file of (await readdir(dir)).filter((it) => it.endsWith(".rq"))) {
    const text = await readFile(join(dir, file), "utf8");
    const template = text.slice(
      text.indexOf("CONSTRUCT {"),
      text.search(/^WHERE/m),
    );
    for (const [, name] of template.matchAll(
      /\b(?:cascade|prov|obo):([a-z_A-Z]\w*)/g,
    ))
      if (/^[a-z]|^RO_/.test(name!) && !apart.has(name!)) names.add(name!);
  }
  return [...names].sort();
}

test("every field the vocabulary's views construct is a kind of field or on the not-checkable list", async () => {
  const fields = await viewFields();
  assert.ok(fields.length > 40, "the views were read");
  const unmapped = fields.filter(
    (name) => !(name in POD_FIELDS) && !POD_NOT_CHECKABLE.includes(name),
  );
  assert.deepEqual(unmapped, []);
  assert.deepEqual(
    POD_NOT_CHECKABLE.filter((name) => name in POD_FIELDS),
    [],
    "a field is checkable or not, never both",
  );
  assert.deepEqual(
    [...Object.keys(POD_FIELDS), ...POD_NOT_CHECKABLE].filter(
      (name) => !fields.includes(name) && !DERIVED.includes(name),
    ),
    [],
    "a field no view sends is no coverage",
  );
});

/** Fields a derivation, not a view, puts on an entry. */
const DERIVED = [
  "dateFrom",
  "medicationUseStartDateFrom",
  "prescriptionWrittenDateFrom",
  "type",
];

test("the pinned runtime is asked every question the checks read", async () => {
  const asked: string[] = [];
  const recorder = {
    async ask(question: string) {
      asked.push(question);
      return [];
    },
  };
  await entryRowsOf(recorder)("x");
  await personRowsOf(recorder)();
  assert.equal(asked.length, 2);
  for (const question of asked)
    assert.ok(PINNED_QUESTIONS.includes(question), question);
});

test("a quote holds as whole words, not as a fragment of a word, in both arms", async () => {
  const cases: [string, Claim, boolean][] = [
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
  const cases: [string, Claim, Claim, boolean][] = [
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
