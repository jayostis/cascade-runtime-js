import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";
import {
  type Claim,
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

/** Each row is a claim, checked against the pod's entry or the downloads by what it cites, and the whole verdict it gets. */
const verdicts = (rows: [string, Claim, Expected][]) => {
  for (const [what, claim, verdict] of rows)
    it(what, async () => {
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
      );
    });
};

/** Each row is a claim against one source, and whether it holds. */
const holds = (source: Source, rows: [string, Claim, boolean][]) => {
  for (const [what, claim, held] of rows)
    it(what, async () => {
      assert.equal((await checkCitation(claim, source)).ok, held);
    });
};

const recordsHold = (file: string) => ({
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
const narrativeRow = (cells: string) =>
  `<ClinicalDocument><component><structuredBody><component><section><text><table><tbody><tr>${cells}</tr></tbody></table></text></section></component></structuredBody></component></ClinicalDocument>`;

describe("checkCitation", () => {
  describe("a value", () => {
    verdicts([
      [
        "holds a lab's value, unit and date",
        { cite: ldl, value: "131", unit: "mg/dL", date: "2025-02-18" },
        ok,
      ],
      ["holds a value written as a number", { cite: ldl, value: 131 }, ok],
      [
        "holds a coded result by its text",
        { cite: fit, value: "Positive", code: "29771-3", date: "2025-11-04" },
        ok,
      ],
      [
        "holds a result in a panel by any line of it",
        {
          cite: { file: "summary.xml", line: 27 },
          value: "7.9",
          unit: "m[IU]/L",
          date: "2026-03-03",
        },
        ok,
      ],
      [
        "holds a pod entry's own result",
        { cite: { entry: LDL }, value: "131", date: "2025-02-18" },
        ok,
      ],
      [
        "refuses the reference range",
        { cite: ldl, value: "99" },
        otherwise("value 99"),
      ],
      [
        "refuses the interpretation",
        { cite: ldl, value: "H" },
        otherwise("value H"),
      ],
      [
        "refuses a result's opposite written in its range",
        { cite: fit, value: "Negative" },
        otherwise("value Negative"),
      ],
      [
        "refuses the range's low",
        { cite: { file: "summary.xml", line: 29 }, value: "0.40" },
        otherwise("value 0.40"),
      ],
      [
        "refuses a pod entry's range",
        { cite: { entry: LDL }, value: "99" },
        otherwise("value 99"),
      ],
    ]);
  });

  describe("a date", () => {
    verdicts([
      [
        "refuses the record's update time",
        { cite: fit, date: "2025-11-20" },
        otherwise("date 2025-11-20"),
      ],
      [
        "refuses a stop date claimed as the start",
        { cite: metformin, date: "2024-04-15", dateKind: "start" },
        otherwise("start 2024-04-15"),
      ],
      [
        "holds the stop date as the end",
        {
          cite: metformin,
          date: "2024-04-15",
          dateKind: "end",
          status: "completed",
        },
        ok,
      ],
      [
        "holds a medication's start with its name and code",
        {
          cite: metformin,
          name: "metformin",
          code: "861007",
          date: "2022-03-01",
          dateKind: "start",
        },
        ok,
      ],
    ]);

    describe("claimed as recorded", () => {
      verdicts([
        [
          "holds a C-CDA entry's own author time",
          {
            cite: { file: "summary.xml", line: 29 },
            date: "2026-03-04",
            dateKind: "recorded",
          },
          ok,
        ],
        [
          "holds the document's author time for an entry with none",
          {
            cite: { file: "summary.xml", line: 39 },
            date: "2026-03-10",
            dateKind: "recorded",
          },
          ok,
        ],
        [
          "holds a narrative line's date as its document's",
          {
            cite: { file: "summary.xml", line: 47 },
            date: "2026-03-10",
            dateKind: "recorded",
          },
          ok,
        ],
        [
          "refuses a day the C-CDA never states",
          {
            cite: { file: "summary.xml", line: 39 },
            date: "2026-03-03",
            dateKind: "recorded",
          },
          otherwise("recorded 2026-03-03"),
        ],
      ]);
    });
  });

  describe("a status", () => {
    verdicts([
      [
        "holds a status as the record writes it",
        { cite: condition, status: "refuted" },
        ok,
      ],
      [
        "refuses a status the record does not hold",
        { cite: condition, status: "active" },
        otherwise("status active"),
      ],
      [
        "refuses part of a status",
        { cite: metformin, status: "ted" },
        otherwise("status ted"),
      ],
      [
        "refuses an intent as a status",
        { cite: order, status: "order" },
        otherwise("status order"),
      ],
    ]);

    describe("of a condition its source refutes", () => {
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
        it(`${held ? "holds" : "refuses"} "${status}"`, async () => {
          assert.equal(
            (await checkCitation({ cite: { entry: PE }, status }, refuted)).ok,
            held,
          );
        });
    });
  });

  describe("a code", () => {
    verdicts([
      [
        "holds a FHIR code with its system",
        { cite: fit, code: "loinc:29771-3" },
        ok,
      ],
      [
        "refuses a FHIR code with another system",
        { cite: fit, code: "snomed:29771-3" },
        otherwise("code snomed:29771-3"),
      ],
      [
        "holds a pod code with its system",
        { cite: { entry: LDL }, code: "LOINC:13457-7" },
        ok,
      ],
      [
        "refuses a pod code with another system",
        { cite: { entry: LDL }, code: "snomed:13457-7" },
        otherwise("code snomed:13457-7"),
      ],
      [
        "holds a C-CDA code with its system, by the OID it names",
        { cite: { file: "summary.xml", line: 9 }, code: "cvx:187" },
        ok,
      ],
      [
        "refuses a C-CDA code with another system",
        { cite: { file: "summary.xml", line: 9 }, code: "loinc:187" },
        otherwise("code loinc:187"),
      ],
    ]);

    describe("in a pod entry", () => {
      const NS_CODES = "https://ns.cascadeprotocol.org/codes/";
      const codes = podRowsSource(async () => [
        { field: "cascade:rxNormCode", value: `${NS_CODES}rxnorm/199903` },
        {
          field: "cascade:snomedCode",
          value: "http://snomed.info/id/59282003",
        },
        { field: "cascade:testCode", value: "https://loinc.org/rdf/4548-4" },
        {
          field: "cascade:hgvsCodingDnaExpression",
          value: "NM_000249.3:c.2T>C",
        },
      ]);
      const held = async (code: string) =>
        (await checkCitation({ cite: { entry: "e" }, code }, codes)).ok;

      it("is claimed with the system its IRI shows, in any namespace", async () => {
        for (const code of [
          "rxnorm:199903",
          "snomed:59282003",
          "loinc:4548-4",
          "NM_000249.3:c.2T>C",
        ])
          assert.equal(await held(code), true, code);
      });

      it("is refused with any other system", async () => {
        for (const code of [
          "snomed:199903",
          "rxnorm:59282003",
          "loinc:59282003",
        ])
          assert.equal(await held(code), false, code);
      });
    });

    describe("of a gene change", () => {
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

      holds(variants, [
        [
          "holds its coding expression as a code",
          { cite: { entry: variant }, code: "NM_000249.3:c.2042C>T" },
          true,
        ],
        [
          "refuses its coding expression as a name",
          { cite: { entry: variant }, name: "c.2" },
          false,
        ],
      ]);
    });
  });

  describe("a name", () => {
    verdicts([
      [
        "holds a person by full name",
        {
          cite: { file: "bundle.json", resource: "Patient/p-1" },
          name: "Tamsin Vale",
          date: "1957-09-30",
        },
        ok,
      ],
    ]);

    describe("in a pod entry", () => {
      holds(person, [
        [
          "refuses a fragment of a word",
          { cite: { entry: REPORT }, name: "pulm" },
          false,
        ],
        [
          "refuses a fragment inside a word",
          { cite: { entry: REPORT }, name: "ulmonary" },
          false,
        ],
        [
          "holds whole words",
          { cite: { entry: REPORT }, name: "pulmonary embolism" },
          true,
        ],
      ]);
    });

    describe("in a download", () => {
      const patient = { file: "bundle.json", resource: "Patient/p-1" };
      holds(downloads, [
        ["refuses a fragment of a word", { cite: patient, name: "Tam" }, false],
        ["holds a whole name", { cite: patient, name: "tamsin vale" }, true],
      ]);
    });
  });

  describe("a quote", () => {
    verdicts([
      [
        "holds a report's words",
        { cite: report, quote: "No pulmonary embolism" },
        ok,
      ],
      [
        "holds narrative words on the line cited",
        {
          cite: { file: "summary.xml", line: 47 },
          quote: "repeated in 6-8 weeks",
        },
        ok,
      ],
    ]);

    describe("of a FHIR resource's dosage and instruction", () => {
      holds(downloads, [
        [
          "holds a request's dosage text",
          {
            cite: order,
            quote: "Take 1 tablet by mouth once daily in the morning.",
          },
          true,
        ],
        [
          "holds a request's patient instruction",
          { cite: order, quote: "Take with food." },
          true,
        ],
        [
          "holds a statement's dosage text",
          { cite: metformin, quote: "500 mg twice daily" },
          true,
        ],
        [
          "refuses words the dosage does not say",
          { cite: order, quote: "Take 2 tablets daily" },
          false,
        ],
      ]);
    });

    describe("in a download", () => {
      holds(downloads, [
        [
          "refuses a fragment from mid-word",
          { cite: order, quote: "ake 1 tablet by mouth" },
          false,
        ],
        [
          "holds whole words",
          { cite: order, quote: "Take 1 tablet by mouth" },
          true,
        ],
      ]);
    });

    describe("in a pod entry", () => {
      holds(person, [
        [
          "refuses a fragment from mid-word to mid-word",
          { cite: { entry: REPORT }, quote: "m. Lungs are cl" },
          false,
        ],
        [
          "refuses words that start mid-word",
          { cite: { entry: REPORT }, quote: "ungs are clear" },
          false,
        ],
        [
          "holds whole words in any case and spacing",
          { cite: { entry: REPORT }, quote: "lungs  ARE clear." },
          true,
        ],
      ]);

      describe("of a medication", () => {
        const lisinopril = "pod://p/clinical/medications.ttl#lisinopril";
        const medications = podRowsSource(async (entry) =>
          entry === lisinopril
            ? [
                {
                  field: `${NS}drugName`,
                  value: "lisinopril 10 MG Oral Tablet",
                },
                {
                  field: `${NS}dosage`,
                  value: "1 tablet by mouth every morning",
                },
              ]
            : undefined,
        );
        holds(medications, [
          [
            "holds the dosage as written",
            {
              cite: { entry: lisinopril },
              quote: "1 tablet by mouth every morning",
            },
            true,
          ],
          [
            "refuses a dosage the entry does not state",
            {
              cite: { entry: lisinopril },
              quote: "2 tablets by mouth every night",
            },
            false,
          ],
        ]);
      });

      describe("of the text a source wrote", () => {
        const colonoscopy = "pod://p/clinical/procedures.ttl#colonoscopy";
        const tsh = "pod://p/clinical/lab-results.ttl#tsh";
        const rows = podRowsSource(async (entry) =>
          entry === colonoscopy
            ? [
                { field: `${NS}procedureName`, value: "Colonoscopy" },
                {
                  field: `${NS}narrativeText`,
                  value: "Normal; repeat in 10 years.",
                },
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
        holds(rows, [
          [
            "holds the finding beside a procedure",
            { cite: { entry: colonoscopy }, quote: "repeat in 10 years" },
            true,
          ],
          [
            "holds a label across the lines of a row's text",
            { cite: { entry: tsh }, quote: "2.1 mIU/L historical result" },
            true,
          ],
          [
            "refuses a finding the entry does not state",
            { cite: { entry: colonoscopy }, quote: "repeat in 5 years" },
            false,
          ],
        ]);
      });
    });
  });

  describe("the place cited", () => {
    verdicts([
      [
        "checks nothing when no field is claimed",
        { cite: ldl },
        { ok: false, reason: "nothing to check", missing: [] },
      ],
      [
        "checks nothing for a unit alone",
        { cite: ldl, unit: "mg/dL" },
        { ok: false, reason: "nothing to check", missing: [] },
      ],
      [
        "refuses a resource there is not",
        {
          cite: { file: "bundle.json", resource: "Procedure/colonoscopy-1" },
          value: "normal",
        },
        { ok: false, reason: "no such record", missing: [] },
      ],
      [
        "refuses a line past the end",
        { cite: { file: "summary.xml", line: 400 }, value: "7.9" },
        { ok: false, reason: "no such record", missing: [] },
      ],
      [
        "holds an entry by its id, code and date",
        {
          cite: { file: "summary.xml", line: 9 },
          id: "VX-251108-2",
          code: "187",
          date: "2025-11-08",
        },
        ok,
      ],
      [
        "points to a neighbour's value in the same panel",
        {
          cite: { file: "summary.xml", line: 29 },
          value: "1.0",
          code: "3024-7",
        },
        {
          ok: false,
          reason: "not at that line",
          missing: ["value 1.0", "code 3024-7"],
          foundAt: [34],
        },
      ],
      [
        "points to a neighbour's value in the next JSON resource",
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
    ]);
  });

  describe("a pod report", () => {
    holds(person, [
      [
        "holds a report by name, code, date and quote",
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
        "holds its issue time as the recorded date",
        { cite: { entry: REPORT }, date: "2025-07-08", dateKind: "recorded" },
        true,
      ],
      [
        "refuses words the conclusion does not say",
        { cite: { entry: REPORT }, quote: "A large pulmonary embolism" },
        false,
      ],
    ]);
  });

  describe("the person", () => {
    describe("in a pod", () => {
      holds(person, [
        [
          "holds the birth date by the subject IRI",
          { cite: { entry: PERSON }, date: "1957-09-30" },
          true,
        ],
        [
          "refuses another birth date",
          { cite: { entry: PERSON }, date: "1957-09-29" },
          false,
        ],
        [
          "refuses an IRI that is not the person",
          { cite: { entry: "urn:uuid:other" }, date: "1957-09-30" },
          false,
        ],
      ]);
    });

    describe("in both arms", () => {
      const pods = { entry: PERSON };
      const patient = { file: "bundle.json", resource: "Patient/p-1" };
      const cases: [string, Claim, Claim, boolean][] = [
        [
          "reads a gender as a value",
          { cite: pods, value: "female" },
          { cite: patient, value: "female" },
          true,
        ],
        [
          "refuses another gender",
          { cite: pods, value: "male" },
          { cite: patient, value: "male" },
          false,
        ],
        [
          "reads a death as an end",
          { cite: pods, date: "2024-03-04", dateKind: "end" },
          { cite: patient, date: "2024-03-04", dateKind: "end" },
          true,
        ],
        [
          "refuses the death date as a birth date",
          { cite: pods, date: "2024-03-04" },
          { cite: patient, date: "2024-03-04" },
          false,
        ],
      ];
      for (const [what, onPod, onRecords, held] of cases)
        it(what, async () => {
          assert.equal((await checkCitation(onPod, person)).ok, held, "pod");
          assert.equal(
            (await checkCitation(onRecords, downloads)).ok,
            held,
            "records",
          );
        });
    });
  });

  describe("a pod entry named by handle", () => {
    const sha = (text: string) =>
      createHash("sha256").update(text).digest("hex");
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
    for (const [what, handle, held] of [
      [
        "holds by the start of its fragment",
        `L${sha(first!).slice(0, 8)}`,
        true,
      ],
      [
        "holds a stale handle by the record merged into the entry",
        `L${sha(later!).slice(0, 12)}`,
        true,
      ],
      [
        "refuses a handle of another view's letter",
        `C${sha(first!).slice(0, 8)}`,
        false,
      ],
      [
        "refuses a handle that names another entry",
        `L${sha("urn:uuid:other").slice(0, 8)}`,
        false,
      ],
    ] as const)
      it(what, async () => {
        assert.equal(
          (
            await checkCitation(
              { cite: { entry: handle }, name: "LDL" },
              source,
            )
          ).ok,
          held,
          handle,
        );
      });
  });
});

describe("checkAbsence", () => {
  describe("on the rows a pod question answered", () => {
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
      query: {
        tool: "ask",
        input: { question: "pod/My procedures", pod: "p" },
      },
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
      [
        "backs it when the query found nothing that matches",
        absence,
        [procedures(none)],
        { backed: true },
      ],
      [
        "refuses a claim with no query",
        { ...absence, query: undefined },
        [procedures(none)],
        { backed: false, reason: "no query" },
      ],
      [
        "refuses a query that was not run",
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
        "refuses a query that was refused",
        absence,
        [procedures("no question pod/My procedures", false)],
        { backed: false, reason: "query refused" },
      ],
      [
        "refuses a query that found it",
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
        "refuses an answer cut short",
        absence,
        [procedures({ total: 80, rows: [{ procedure: "CT" }] })],
        { backed: false, reason: "query cut short" },
      ],
      [
        "refuses a match with nothing to look for",
        { ...absence, match: {} },
        [procedures(none)],
        { backed: false, reason: "nothing to look for" },
      ],
      [
        "refuses a claim with no coverage",
        { ...absence, coverage: " " },
        [procedures(none)],
        { backed: false, reason: "no coverage" },
      ],
      [
        "backs it when every row is before the date it is absent after",
        {
          ...a1cAfter,
          query: labs.input && { tool: "ask", input: labs.input },
        },
        [labs],
        { backed: true },
      ],
      [
        "refuses a row after that date",
        {
          ...a1cAfter,
          match: { ...a1cAfter.match, after: "2026-01-01" },
          query: { tool: "ask", input: labs.input },
        },
        [labs],
        { backed: false, reason: "query found it" },
      ],
    ] as const)
      it(what, () => {
        assert.deepEqual(checkAbsence(claim, ran), backing);
      });

    describe("with a row's provenance", () => {
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

      it("does not date a row by when it was retrieved", () => {
        assert.deepEqual(
          checkAbsence(absence, ran(lab("2026-02-16T16:00:00Z"))),
          { backed: true },
          "retrieved after the day, performed before it",
        );
      });

      it("finds a row performed after the day", () => {
        assert.deepEqual(
          checkAbsence(absence, ran(lab("2026-03-01T16:00:00Z"))),
          { backed: false, reason: "query found it" },
          "performed after the day",
        );
      });
    });

    describe("held to what it is of", () => {
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

      it("refuses a question of another kind than the key item's", () => {
        assert.deepEqual(
          checkAbsence(colonoscopy, [immunizations], {
            kind: "procedure",
            terms: ["colonoscopy"],
          }),
          { backed: false, reason: "a question of another kind" },
        );
      });

      it("refuses a question of another kind, with no key item", () => {
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
      });

      it("finds what the key item's code matches", () => {
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
      });
    });

    describe("with a code that looks like a day in a row's text", () => {
      it("backs it for a row dated before the day", () => {
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
    });

    describe("on a record written long after what it records", () => {
      it("dates a row by the day performed, not the day retrieved", () => {
        const input = { pod: "p", question: "pod/My lab results" };
        assert.deepEqual(
          checkAbsence(
            {
              what: "an A1c since February",
              coverage: "every lab result",
              match: { codes: ["4548-4"], after: "2026-02-17" },
              query: { tool: "ask", input },
            },
            [
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
            ],
          ),
          { backed: true },
        );
      });
    });
  });

  describe("on a row withdrawn at its source", () => {
    const absence = {
      what: "a pulmonary embolism",
      coverage: "every record",
      match: { codes: ["59282003"], terms: ["pulmonary embolism"] },
    };

    describe("in a pod medication history row", () => {
      const input = { pod: "p", question: "pod/My medication history" };
      const podRow = (status: string) =>
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

      it("is no presence when entered in error", () => {
        assert.deepEqual(podRow("entered-in-error"), { backed: true });
      });

      it("is no presence when refuted", () => {
        assert.deepEqual(podRow("refuted"), { backed: true });
      });

      it("is a presence when active", () => {
        assert.deepEqual(podRow("active"), {
          backed: false,
          reason: "query found it",
        });
      });

      it("is no presence when ruled out", () => {
        assert.deepEqual(podRow("ruled out"), { backed: true });
      });
    });

    describe("in a pod condition history row", () => {
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

      it("is ruled out, no presence, when resolved and refuted at its source", () => {
        assert.deepEqual(
          tamsin({ status: "ruled out", verificationStatus: "refuted" }),
          { backed: true },
        );
      });

      it("is a presence when only resolved", () => {
        assert.deepEqual(tamsin({ status: "resolved" }), {
          backed: false,
          reason: "query found it",
        });
      });
    });
  });

  describe("on a compact read", () => {
    describe("by its whole views of the absence's kind", () => {
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
          "backs it when the A1c is old and the eGFR new",
          a1c,
          ran([labs([a1c2023, egfr2026]), conditions]),
          lab,
          { backed: true },
        ],
        [
          "refuses a new A1c",
          a1c,
          ran([labs([a1c2023, a1c2026])]),
          lab,
          { backed: false, reason: "query found it" },
        ],
        [
          "backs it when the new A1c was entered in error",
          a1c,
          ran([labs([a1c2023, a1c2026.replace("final", "entered-in-error")])]),
          lab,
          { backed: true },
        ],
        [
          "refuses lab results cut at a page",
          a1c,
          ran([labs([a1c2023], 2)]),
          lab,
          { backed: false, reason: "query cut short" },
        ],
        [
          "refuses a view with fewer lines than it says it shows",
          a1c,
          ran([{ ...labs([a1c2023]), total: 2, shown: 2 }]),
          lab,
          { backed: false, reason: "query cut short" },
        ],
        [
          "refuses a page with no lab results on it that goes on",
          a1c,
          ran([conditions], read, { next: { format: "compact", offset: 2 } }),
          lab,
          { backed: false, reason: "query cut short" },
        ],
        [
          "refuses a read of the entries asked for",
          a1c,
          ran([labs([a1c2023])], { ...read, entries: ["La1c00001"] }),
          lab,
          { backed: false, reason: "query cut short" },
        ],
        [
          "backs a pulmonary embolism ruled out",
          pe,
          ran([labs([a1c2023]), conditions]),
          undefined,
          { backed: true },
        ],
        [
          "refuses a read of no kind that goes on to another page",
          pe,
          ran([labs([a1c2023]), conditions], read, {
            next: { format: "compact", offset: 3 },
          }),
          undefined,
          { backed: false, reason: "query cut short" },
        ],
      ] as const)
        it(what, () => {
          assert.deepEqual(
            checkAbsence(
              { ...absence, query: { tool: "ask", input: calls[0]!.input } },
              calls,
              tied,
            ),
            backing,
          );
        });
    });

    describe("split across the pages of one read", () => {
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
          "backs it when every page is given",
          ofLabs,
          { kind: "lab" },
          [first, second, last],
          { backed: true },
        ],
        [
          "backs it when the pages come out of order",
          ofLabs,
          { kind: "lab" },
          [last, first, second],
          { backed: true },
        ],
        [
          "backs it when every page is given, of no kind",
          anywhere,
          undefined,
          [first, second, last],
          { backed: true },
        ],
        ["refuses the first page only", ofLabs, { kind: "lab" }, [first], cut],
        [
          "refuses a gap in the middle",
          ofLabs,
          { kind: "lab" },
          [first, last],
          cut,
        ],
        [
          "refuses a read with no last page",
          ofLabs,
          { kind: "lab" },
          [first, second],
          cut,
        ],
        ["refuses a gap, of no kind", anywhere, undefined, [first, last], cut],
        [
          "refuses a read with no last page, of no kind",
          anywhere,
          undefined,
          [first, second],
          cut,
        ],
        [
          "refuses the match on the last page",
          ofLabs,
          { kind: "lab" },
          [first, second, page(4, [line(5, "Hemoglobin A1c", "4548-4")], 5)],
          { backed: false, reason: "query found it" },
        ],
        [
          "refuses a last page of another read",
          ofLabs,
          { kind: "lab" },
          [
            first,
            second,
            { ...last, input: { ...last.input, entries: ["L1"] } },
          ],
          cut,
        ],
      ] as const)
        it(what, () => {
          assert.deepEqual(checkAbsence(absence, calls, tied), backing);
        });
    });

    describe("with a handle in a line", () => {
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
          "counts S1 and S2 in a conclusion against it",
          "S1 and S2",
          "Normal S1 and S2, no murmur",
          "S1 final",
          { backed: false, reason: "query found it" },
        ],
        [
          "counts S2 after a semicolon in a conclusion against it",
          "S2 is loud",
          "Normal S1; S2 is loud",
          "S1 final",
          { backed: false, reason: "query found it" },
        ],
        [
          "counts S2 alone at the start of a conclusion against it",
          "S2",
          "S2 split.",
          "S1 final",
          { backed: false, reason: "query found it" },
        ],
        [
          "strikes S2 only as the source a status is from",
          "S2",
          "No murmur",
          "S2 final",
          { backed: true },
        ],
      ] as const)
        it(what, () => {
          assert.deepEqual(
            checkAbsence(absence(term), ran(conclusion, statuses)),
            backing,
          );
        });
    });
  });
});

describe("kindOfCall", () => {
  it("names the kind a question asks of", () => {
    assert.equal(
      kindOfCall({
        tool: "ask",
        input: { question: "pod/My condition history" },
      }),
      "condition",
    );
  });

  it("names none for a read with no question", () => {
    assert.equal(
      kindOfCall({ tool: "ask", input: { pod: "p", format: "compact" } }),
      undefined,
    );
  });
});

describe("checkRecordsAbsence", () => {
  describe("given the sources it names", () => {
    const text = (file: string) => readFile(`${FOLDER}${file}`, "utf8");
    const absence = {
      what: "a colonoscopy",
      coverage: "both documents",
      match: { terms: ["colonoscopy"], codes: ["73761001"] },
      sources: ["bundle.json", "summary.xml"],
    };
    const read = ["bundle.json", "summary.xml"];
    for (const [what, claim, files, backing] of [
      [
        "backs it when each is read whole and none holds it",
        absence,
        read,
        { backed: true },
      ],
      [
        "refuses a source not read",
        absence,
        ["bundle.json"],
        { backed: false, reason: "source not read: summary.xml" },
      ],
      [
        "refuses sources naming no file",
        { ...absence, sources: [] },
        read,
        {
          backed: false,
          reason: "sources leave out: bundle.json, summary.xml",
        },
      ],
      [
        "refuses when the records hold it",
        { ...absence, match: { terms: ["pulmonary embolism"] } },
        read,
        { backed: false, reason: "records hold it: bundle.json" },
      ],
      [
        "backs it when every record is before the date it is absent after",
        { ...absence, match: { codes: ["4548-4"], after: "2025-08-19" } },
        read,
        { backed: true },
      ],
      [
        "refuses a record after that date",
        { ...absence, match: { codes: ["4548-4"], after: "2025-08-01" } },
        read,
        { backed: false, reason: "records hold it: bundle.json" },
      ],
    ] as const)
      it(what, async () => {
        assert.deepEqual(
          await checkRecordsAbsence(claim, files, text, read),
          backing,
        );
      });

    describe("held to every file", () => {
      const all = ["bundle.json", "summary.xml"];
      const fit = {
        what: "no stool test",
        coverage: "every document",
        match: { terms: ["guaiac"] },
      };

      it("refuses sources that leave out a file", async () => {
        assert.deepEqual(
          await checkRecordsAbsence(
            { ...fit, sources: ["summary.xml"] },
            all,
            text,
            all,
          ),
          { backed: false, reason: "sources leave out: bundle.json" },
        );
      });

      it("backs it when no file holds it", async () => {
        assert.deepEqual(await checkRecordsAbsence(fit, all, text, all), {
          backed: true,
        });
      });

      it("refuses what the key item's code finds", async () => {
        assert.deepEqual(
          await checkRecordsAbsence(fit, all, text, all, {
            codes: ["29771-3"],
          }),
          { backed: false, reason: "records hold it: bundle.json" },
        );
      });
    });
  });

  describe("given a JSON download", () => {
    const doc = bundle(observation({}));
    const after = "2026-02-17";

    it("reads it as JSON", async () => {
      assert.deepEqual(await inRecords(after, [], doc, ["4548-4"]), {
        backed: true,
      });
    });

    it("reads it as JSON after a newline", async () => {
      assert.deepEqual(await inRecords(after, [], `\n${doc}`, ["4548-4"]), {
        backed: true,
      });
    });

    it("reads it as JSON after a byte-order mark", async () => {
      assert.deepEqual(await inRecords(after, [], `\uFEFF${doc}`, ["4548-4"]), {
        backed: true,
      });
    });
  });

  describe("given a record's dates", () => {
    describe("with a code that looks like a number", () => {
      const condition = (onset: string) =>
        bundle({
          resourceType: "Condition",
          id: "c",
          code: { coding: [{ code: "44054006" }], text: "Type 2 diabetes" },
          onsetDateTime: onset,
        });

      it("backs it for a record dated before the day", async () => {
        assert.deepEqual(
          await inRecords("2030-01-01", [], condition("2022-01-01"), [
            "44054006",
          ]),
          {
            backed: true,
          },
        );
      });

      it("refuses a record dated after the day", async () => {
        assert.deepEqual(
          await inRecords("2020-01-01", [], condition("2022-01-01"), [
            "44054006",
          ]),
          recordsHold("b"),
        );
      });
    });

    describe("written long after what it records", () => {
      const ccda = (author: string) =>
        `<ClinicalDocument><component><structuredBody><component><section><entry><observation classCode="OBS" moodCode="EVN"><code code="4548-4"/><effectiveTime value="20260216"/>${author}</observation></entry></section></component></structuredBody></component></ClinicalDocument>`;
      const written = '<author><time value="20261015"/></author>';

      it("keeps a FHIR resource's clinical date over its update time", async () => {
        assert.deepEqual(
          await inRecords(
            "2026-02-17",
            [],
            bundle(
              observation({ meta: { lastUpdated: "2026-10-15T16:00:00Z" } }),
            ),
            ["4548-4"],
          ),
          { backed: true },
        );
      });

      it("backs it in a C-CDA entry after the day it records", async () => {
        assert.deepEqual(
          await inRecords("2026-02-17", [], ccda(written), ["4548-4"]),
          { backed: true },
        );
      });

      it("refuses it in a C-CDA entry before the day it records", async () => {
        assert.deepEqual(
          await inRecords("2026-02-01", [], ccda(written), ["4548-4"]),
          recordsHold("b"),
        );
      });

      it("reads a participation author's time as recorded", () => {
        const participation =
          '<author><templateId root="2.16.840.1.113883.10.20.22.4.119"/><time value="20261015"/></author>';
        assert.deepEqual(ccdaFields(ccda(participation)).recorded, [
          "20261015",
        ]);
      });
    });

    describe("in a narrative row, in words", () => {
      const row = narrativeRow(
        "<td>Hemoglobin A1c 4548-4</td><td>February 16, 2026</td>",
      );

      it("backs it after a later day", async () => {
        assert.deepEqual(await inRecords("2026-02-17", [], row, ["4548-4"]), {
          backed: true,
        });
      });

      it("refuses it after the day itself", async () => {
        assert.deepEqual(
          await inRecords("2026-02-16", [], row, ["4548-4"]),
          recordsHold("b"),
        );
      });

      it("refuses it after an earlier day", async () => {
        assert.deepEqual(
          await inRecords("2026-02-01", [], row, ["4548-4"]),
          recordsHold("b"),
        );
      });
    });

    describe("that is partial", () => {
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
        it(`${backed ? "backs" : "refuses"} ${value} after ${after}`, async () => {
          assert.deepEqual(
            await inRecords(after, [], ccda(value), ["4548-4"]),
            backed ? { backed: true } : recordsHold("b"),
          );
        });

      it("backs a FHIR month after the month ends", async () => {
        assert.deepEqual(
          await inRecords(
            "2025-08-01",
            [],
            bundle(observation({ effectiveDateTime: "2025-07" })),
            ["4548-4"],
          ),
          { backed: true },
        );
      });

      it("refuses a FHIR month after a day within it", async () => {
        assert.deepEqual(
          await inRecords(
            "2025-07-15",
            [],
            bundle(observation({ effectiveDateTime: "2025-07" })),
            ["4548-4"],
          ),
          recordsHold("b"),
        );
      });

      it("is read from a time element only, not a quantity's value", async () => {
        const doc = `<ClinicalDocument><component><structuredBody><component><section><entry><observation classCode="OBS" moodCode="EVN"><code code="4548-4"/><effectiveTime value="20200101"/><value xsi:type="PQ" value="2050" unit="mg"/></observation></entry></section></component></structuredBody></component></ClinicalDocument>`;
        assert.deepEqual(await inRecords("2026-01-01", [], doc, ["4548-4"]), {
          backed: true,
        });
      });

      it("is not a year and month inside a longer number or range", async () => {
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
    });
  });

  describe("given a record withdrawn at its source", () => {
    describe("in a FHIR download", () => {
      const absence = {
        what: "a pulmonary embolism",
        coverage: "every record",
        match: { codes: ["59282003"], terms: ["pulmonary embolism"] },
      };
      const verifiedAs = (verification: string) =>
        JSON.stringify({
          resourceType: "Bundle",
          entry: [
            {
              resource: {
                resourceType: "Condition",
                id: "pe",
                verificationStatus: { coding: [{ code: verification }] },
                code: {
                  coding: [
                    { system: "http://snomed.info/sct", code: "59282003" },
                  ],
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
          async () => verifiedAs(verification),
          ["b.json"],
        );

      it("is no presence when refuted", async () => {
        assert.deepEqual(await records("refuted"), { backed: true });
      });

      it("is no presence when entered in error", async () => {
        assert.deepEqual(await records("entered-in-error"), { backed: true });
      });

      it("is a presence when confirmed", async () => {
        assert.deepEqual(await records("confirmed"), {
          backed: false,
          reason: "records hold it: b.json",
        });
      });

      describe("with an after date", () => {
        const pe = (verification: string) =>
          bundle({
            resourceType: "Condition",
            id: "pe",
            verificationStatus: { coding: [{ code: verification }] },
            code: {
              coding: [{ code: "59282003" }],
              text: "Pulmonary embolism",
            },
            onsetDateTime: "2025-07-08",
          });

        it("backs it when refuted or entered in error", async () => {
          for (const status of ["refuted", "entered-in-error"])
            assert.deepEqual(
              await inRecords("2025-01-01", ["pulmonary embolism"], pe(status)),
              { backed: true },
            );
        });

        it("refuses a confirmed record dated after the day", async () => {
          assert.deepEqual(
            await inRecords(
              "2025-01-01",
              ["pulmonary embolism"],
              pe("confirmed"),
            ),
            recordsHold("b"),
          );
        });

        it("backs it for a confirmed record dated before the day", async () => {
          assert.deepEqual(
            await inRecords(
              "2026-01-01",
              ["pulmonary embolism"],
              pe("confirmed"),
            ),
            { backed: true },
          );
        });
      });
    });

    describe("in a C-CDA entry", () => {
      const entry = (tag: string, status: string, body = "") =>
        `<ClinicalDocument><component><structuredBody><component><section><entry><observation classCode="OBS" moodCode="EVN"${tag}><code code="59282003" displayName="Pulmonary embolism"/>${status}<effectiveTime value="20250708"/>${body}</observation></entry></section></component></structuredBody></component></ClinicalDocument>`;
      const live = entry("", '<statusCode code="completed"/>');
      const negated = entry(
        ' negationInd="true"',
        '<statusCode code="completed"/>',
      );
      const nullified = entry("", '<statusCode code="nullified"/>');

      for (const after of [undefined, "2025-01-01"])
        describe(
          after === undefined ? "with no after date" : "after a date",
          () => {
            it("is a presence when live", async () => {
              assert.deepEqual(
                await inRecords(after, ["pulmonary embolism"], live, [
                  "59282003",
                ]),
                recordsHold("b"),
              );
            });

            it("is no presence when negated", async () => {
              assert.deepEqual(
                await inRecords(after, ["pulmonary embolism"], negated, [
                  "59282003",
                ]),
                { backed: true },
              );
            });

            it("is no presence when nullified", async () => {
              assert.deepEqual(
                await inRecords(after, ["pulmonary embolism"], nullified, [
                  "59282003",
                ]),
                { backed: true },
              );
            });
          },
        );
    });

    describe("in a C-CDA narrative row", () => {
      const narrative = (status: string) =>
        narrativeRow(
          `<td>Pulmonary embolism</td><td>${status}</td><td>July 8, 2025</td>`,
        );

      for (const after of [undefined, "2025-01-01"])
        describe(
          after === undefined ? "with no after date" : "after a date",
          () => {
            it("is a presence when active", async () => {
              assert.deepEqual(
                await inRecords(
                  after,
                  ["pulmonary embolism"],
                  narrative("active"),
                ),
                recordsHold("b"),
              );
            });

            it("is no presence when entered in error", async () => {
              assert.deepEqual(
                await inRecords(
                  after,
                  ["pulmonary embolism"],
                  narrative("entered in error"),
                ),
                { backed: true },
              );
            });
          },
        );

      describe("that says it was not entered in error, or lists none", () => {
        for (const status of [
          "Not entered in error",
          "Entered in error: none",
          "Entered in error: no",
        ])
          for (const after of [undefined, "2025-01-01"])
            it(`is a live row: ${status}${after === undefined ? "" : ", after a date"}`, async () => {
              assert.deepEqual(
                await inRecords(
                  after,
                  ["pulmonary embolism"],
                  narrativeRow(
                    `<td>Pulmonary embolism</td><td>${status}</td><td>July 8, 2025</td>`,
                  ),
                ),
                recordsHold("b"),
              );
            });
      });

      describe("with a negation in the cell before", () => {
        it("still withdraws on its own entered in error", async () => {
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
      });

      describe("in a cell worded around entered in error", () => {
        const row = (status: string) =>
          narrativeRow(`<td>Hives</td><td>${status}</td><td>July 8, 2025</td>`);

        it("is a live row where the cell denies it, however worded", async () => {
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
              recordsHold("b"),
              status,
            );
        });

        it("still withdraws where it names an earlier clause's negation", async () => {
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
      });
    });
  });
});

describe("narrativeFields", () => {
  describe("the recorded date", () => {
    const recorded = (line: string) =>
      narrativeFields(`<tr><td>${line}</td></tr>`).recorded;

    it("is the date after reported", () => {
      assert.deepEqual(recorded("Patient reported, May 14, 2026"), [
        "May 14, 2026",
      ]);
    });

    it("is the date after recorded", () => {
      assert.deepEqual(recorded("Recorded on 2026-05-14"), ["2026-05-14"]);
    });

    it("is not the date after started", () => {
      assert.deepEqual(recorded("Started on 2026-05-14"), []);
    });

    it("is not the date after a negated or longer word", () => {
      for (const line of [
        "Unreported 2026-05-14",
        "Not documented on 2026-05-14",
        "Never recorded 2026-05-14",
        "Misreported 2026-05-14",
      ])
        assert.deepEqual(recorded(line), [], line);
    });
  });

  describe("the status", () => {
    const status = (line: string) =>
      narrativeFields(`<paragraph>${line}</paragraph>`).status;

    it("is ruled out where a ruling out was made", () => {
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
    });

    it("is none where a ruling out was not made", () => {
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

    it("is ruled out by CT, in a paragraph", () => {
      assert.deepEqual(
        narrativeFields(
          "<paragraph>Pulmonary embolism ruled out by CT</paragraph>",
        ).status,
        ["ruled-out"],
      );
    });

    it("is none for a ruling out that has not happened", () => {
      assert.deepEqual(
        narrativeFields(
          "<paragraph>Pulmonary embolism not ruled out; to be ruled out</paragraph>",
        ).status,
        [],
      );
    });
  });
});

describe("fhirFields", () => {
  it("reads a Patient's deceasedBoolean as a value and its deceasedDateTime as an end", () => {
    const fields = fhirFields({
      resourceType: "Patient",
      deceasedBoolean: true,
      deceasedDateTime: "2024-03-04T10:00:00Z",
    });
    assert.deepEqual(fields.value, ["true"]);
    assert.deepEqual(fields.end, ["2024-03-04T10:00:00Z"]);
  });
});

describe("isoDate", () => {
  it("takes a long number as a day only when it is one", () => {
    assert.equal(isoDate("44054006"), undefined);
    assert.equal(isoDate("20250230"), undefined);
    assert.equal(isoDate("20250219120000"), "2025-02-19");
    assert.equal(isoDate("2025-13-01"), undefined);
  });
});

describe("the fields the pod checker knows", () => {
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

  /** Fields a derivation, not a view, puts on an entry. */
  const DERIVED = [
    "dateFrom",
    "medicationUseStartDateFrom",
    "prescriptionWrittenDateFrom",
    "type",
  ];

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

  describe("reading a view", () => {
    it("fails on a view with no template, saying what to do", () => {
      assert.throws(
        () => constructedBy("x.rq", "SELECT ?a WHERE { }"),
        /x\.rq has no "CONSTRUCT \{" block.*WHERE/,
      );
    });

    it("fails on a prefix it does not read, saying what to add", () => {
      assert.throws(
        () => constructedBy("x.rq", "CONSTRUCT { ?e foo:bar ?v }\nWHERE { }"),
        /x\.rq writes foo:bar, a prefix this test does not read.*add "foo"/,
      );
    });

    it("reads the fields a template writes", () => {
      assert.deepEqual(
        constructedBy(
          "x.rq",
          "CONSTRUCT { ?e cascade:testName ?v }\nWHERE { }",
        ),
        ["testName"],
      );
    });
  });

  describe("against the vocabulary's views", () => {
    let fields: string[];
    before(async () => {
      fields = await viewFields();
    });

    it("reads the views", () => {
      assert.ok(fields.length > 40, "the views were read");
    });

    it("knows every field a view constructs", () => {
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
    });

    it("lists no field as both checkable and not", () => {
      assert.deepEqual(
        POD_NOT_CHECKABLE.filter((name) => name in POD_FIELDS),
        [],
        "a field is checkable or not, never both: remove it from one of POD_FIELDS and POD_NOT_CHECKABLE",
      );
    });

    it("lists no field that no view sends", () => {
      assert.deepEqual(
        [...Object.keys(POD_FIELDS), ...POD_NOT_CHECKABLE].filter(
          (name) => !fields.includes(name) && !DERIVED.includes(name),
        ),
        [],
        "a field no view sends is no coverage: remove it from POD_FIELDS or POD_NOT_CHECKABLE, or add it to DERIVED if a derivation puts it on the entry",
      );
    });
  });
});

describe("quoteLongEnough", () => {
  it("wants three words, or all of a text that has fewer", () => {
    const texts = ["No pulmonary embolism seen", "Not seen"];
    assert.deepEqual(
      ["No pulmonary", "No pulmonary embolism", "Not seen", "seen"].map(
        (quote) => quoteLongEnough(quote, texts),
      ),
      [false, true, true, false],
    );
  });
});
