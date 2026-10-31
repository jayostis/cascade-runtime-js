// node generate.mjs <downloads>: writes north-2026-10 from north-2025-02 plus what Cascade North recorded since.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";

const DIR = argv[2];
const prev = JSON.parse(
  readFileSync(join(DIR, "north-2025-02", "bundle.json"), "utf8"),
);
const BASE = "https://cascade-north.demo.invalid/fhir";
const P = "story-stopped";
const subject = { reference: `Patient/${P}` };
const entry = (resource) => ({
  fullUrl: `${BASE}/${resource.resourceType}/${resource.id}`,
  resource,
});
const meta = (t) => ({ versionId: "1", lastUpdated: t });
const LOINC = "http://loinc.org";
const lab = (id, t, code, display, text, value, extra = {}) => ({
  resourceType: "Observation",
  id: `${P}-${id}`,
  meta: meta(t),
  status: "final",
  category: [
    {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/observation-category",
          code: "laboratory",
        },
      ],
    },
  ],
  code: { coding: [{ system: LOINC, code, display }], text },
  subject,
  effectiveDateTime: t,
  ...value,
  ...extra,
});
const qty = (value, unit) => ({
  valueQuantity: {
    value,
    unit,
    system: "http://unitsofmeasure.org",
    code: unit,
  },
});
const interp = (code, display) => ({
  interpretation: [
    {
      coding: [
        {
          system:
            "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
          code,
          display,
        },
      ],
    },
  ],
});
const rr = (low, high, unit) => ({
  referenceRange: [
    {
      ...(low !== undefined && {
        low: {
          value: low,
          unit,
          system: "http://unitsofmeasure.org",
          code: unit,
        },
      }),
      ...(high !== undefined && {
        high: {
          value: high,
          unit,
          system: "http://unitsofmeasure.org",
          code: unit,
        },
      }),
    },
  ],
});
const a1c = (n, t, v) =>
  lab(
    `a1c-${n}`,
    t,
    "4548-4",
    "Hemoglobin A1c/Hemoglobin.total in Blood",
    "Hemoglobin A1c",
    qty(v, "%"),
  );

const added = [
  {
    resourceType: "Condition",
    id: `${P}-cond-1`,
    meta: meta("2025-02-20T17:10:00Z"),
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
          code: "active",
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
          code: "confirmed",
        },
      ],
    },
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-category",
            code: "problem-list-item",
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "44054006",
          display: "Diabetes mellitus type 2",
        },
        {
          system: "http://hl7.org/fhir/sid/icd-10-cm",
          code: "E11.9",
          display: "Type 2 diabetes mellitus without complications",
        },
      ],
      text: "Type 2 diabetes mellitus",
    },
    subject,
    onsetDateTime: "2022-03-01",
    recordedDate: "2025-02-20",
  },
  lab(
    "chol-1",
    "2025-02-18T16:00:00Z",
    "2093-3",
    "Cholesterol [Mass/volume] in Serum or Plasma",
    "Cholesterol, total",
    qty(212, "mg/dL"),
    { ...interp("H", "High"), ...rr(undefined, 199, "mg/dL") },
  ),
  lab(
    "hdl-1",
    "2025-02-18T16:00:00Z",
    "2085-9",
    "Cholesterol in HDL [Mass/volume] in Serum or Plasma",
    "HDL cholesterol",
    qty(52, "mg/dL"),
    { ...interp("N", "Normal"), ...rr(50, undefined, "mg/dL") },
  ),
  lab(
    "tg-1",
    "2025-02-18T16:00:00Z",
    "2571-8",
    "Triglyceride [Mass/volume] in Serum or Plasma",
    "Triglycerides",
    qty(146, "mg/dL"),
    { ...interp("N", "Normal"), ...rr(undefined, 149, "mg/dL") },
  ),
  lab(
    "ldl-1",
    "2025-02-18T16:00:00Z",
    "13457-7",
    "Cholesterol in LDL [Mass/volume] in Serum or Plasma by calculation",
    "LDL cholesterol, calculated",
    qty(131, "mg/dL"),
    { ...interp("H", "High"), ...rr(undefined, 99, "mg/dL") },
  ),
  lab(
    "creat-1",
    "2025-02-18T16:00:00Z",
    "2160-0",
    "Creatinine [Mass/volume] in Serum or Plasma",
    "Creatinine",
    qty(0.84, "mg/dL"),
    { ...interp("N", "Normal"), ...rr(0.5, 1.1, "mg/dL") },
  ),
  lab(
    "egfr-1",
    "2025-02-18T16:00:00Z",
    "98979-8",
    "Glomerular filtration rate [Volume Rate/Area] in Serum, Plasma or Blood by Creatinine-based formula (CKD-EPI 2021)/1.73 sq M",
    "eGFR",
    qty(73, "mL/min/{1.73_m2}"),
    { ...interp("N", "Normal"), ...rr(60, undefined, "mL/min/{1.73_m2}") },
  ),
  lab(
    "k-1",
    "2025-02-18T16:00:00Z",
    "2823-3",
    "Potassium [Moles/volume] in Serum or Plasma",
    "Potassium",
    qty(4.5, "mmol/L"),
    { ...interp("N", "Normal"), ...rr(3.5, 5.1, "mmol/L") },
  ),
  {
    resourceType: "MedicationRequest",
    id: `${P}-medrx-2`,
    meta: meta("2025-02-20T17:20:00Z"),
    status: "active",
    intent: "order",
    category: [
      {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/medicationrequest-category",
            code: "outpatient",
          },
        ],
      },
    ],
    medicationCodeableConcept: {
      coding: [
        {
          system: "http://www.nlm.nih.gov/research/umls/rxnorm",
          code: "1545658",
          display: "empagliflozin 10 MG Oral Tablet",
        },
      ],
      text: "Jardiance 10 mg tablet",
    },
    subject,
    authoredOn: "2025-02-20",
    dosageInstruction: [
      {
        text: "Take 1 tablet by mouth once daily in the morning.",
        timing: { repeat: { frequency: 1, period: 1, periodUnit: "d" } },
      },
    ],
  },
  {
    resourceType: "MedicationRequest",
    id: `${P}-medrx-3`,
    meta: meta("2025-02-20T17:21:00Z"),
    status: "active",
    intent: "order",
    category: [
      {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/medicationrequest-category",
            code: "outpatient",
          },
        ],
      },
    ],
    medicationCodeableConcept: {
      coding: [
        {
          system: "http://www.nlm.nih.gov/research/umls/rxnorm",
          code: "617310",
          display: "atorvastatin 20 MG Oral Tablet",
        },
      ],
      text: "Atorvastatin 20 mg tablet",
    },
    subject,
    authoredOn: "2025-02-20",
    dosageInstruction: [
      {
        text: "Take 1 tablet by mouth once daily.",
        timing: { repeat: { frequency: 1, period: 1, periodUnit: "d" } },
      },
    ],
  },
  a1c(7, "2025-05-19T16:00:00Z", 7.6),
  // emergency department visit, 2025-07-08
  lab(
    "ddimer-1",
    "2025-07-08T21:40:00Z",
    "48065-7",
    "Fibrin D-dimer FEU [Mass/volume] in Platelet poor plasma",
    "D-dimer",
    qty(0.92, "mg/L{FEU}"),
    { ...interp("H", "High"), ...rr(undefined, 0.49, "mg/L{FEU}") },
  ),
  {
    resourceType: "Procedure",
    id: `${P}-proc-1`,
    meta: meta("2025-07-08T23:05:00Z"),
    status: "completed",
    code: {
      coding: [
        {
          system: "http://www.ama-assn.org/go/cpt",
          code: "71275",
          display:
            "Computed tomographic angiography, chest (noncoronary), with contrast material(s), including noncontrast images, if performed, and image postprocessing",
        },
      ],
      text: "CT angiography of the chest",
    },
    subject,
    performedDateTime: "2025-07-08T22:30:00Z",
  },
  {
    resourceType: "DiagnosticReport",
    id: `${P}-dr-1`,
    meta: meta("2025-07-08T23:05:00Z"),
    status: "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v2-0074",
            code: "RAD",
            display: "Radiology",
          },
        ],
      },
    ],
    code: {
      coding: [{ system: LOINC, code: "24627-2", display: "CT Chest" }],
      text: "CT angiography chest (pulmonary embolism protocol)",
    },
    subject,
    effectiveDateTime: "2025-07-08T22:30:00Z",
    issued: "2025-07-08T23:05:00Z",
    conclusion:
      "No pulmonary embolism. Lungs are clear. No pleural or pericardial effusion. Mild degenerative changes of the thoracic spine.",
  },
  {
    resourceType: "Condition",
    id: `${P}-cond-2`,
    meta: meta("2025-07-09T00:15:00Z"),
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
          code: "resolved",
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
          code: "refuted",
        },
      ],
    },
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-category",
            code: "encounter-diagnosis",
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "59282003",
          display: "Pulmonary embolism",
        },
      ],
      text: "Pulmonary embolism",
    },
    subject,
    onsetDateTime: "2025-07-08",
    abatementDateTime: "2025-07-08",
    recordedDate: "2025-07-08",
  },
  {
    resourceType: "Condition",
    id: `${P}-cond-3`,
    meta: meta("2025-07-09T00:15:00Z"),
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
          code: "resolved",
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
          code: "confirmed",
        },
      ],
    },
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-category",
            code: "encounter-diagnosis",
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "102588006",
          display: "Chest wall pain",
        },
      ],
      text: "Chest wall pain",
    },
    subject,
    onsetDateTime: "2025-07-08",
    abatementDateTime: "2025-07-22",
    recordedDate: "2025-07-08",
  },
  a1c(8, "2025-08-18T16:00:00Z", 7.1),
  lab(
    "fit-1",
    "2025-11-04T15:00:00Z",
    "29771-3",
    "Hemoglobin [Presence] in Stool from gastrointestinal lower by Immunoassay",
    "Fecal immunochemical test (FIT)",
    {
      valueCodeableConcept: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "10828004",
            display: "Positive",
          },
        ],
        text: "Positive",
      },
    },
    { ...interp("POS", "Positive"), referenceRange: [{ text: "Negative" }] },
  ),
  a1c(9, "2026-02-16T16:00:00Z", 6.9),
  lab(
    "creat-2",
    "2026-02-16T16:00:00Z",
    "2160-0",
    "Creatinine [Mass/volume] in Serum or Plasma",
    "Creatinine",
    qty(0.88, "mg/dL"),
    { ...interp("N", "Normal"), ...rr(0.5, 1.1, "mg/dL") },
  ),
  lab(
    "egfr-2",
    "2026-02-16T16:00:00Z",
    "98979-8",
    "Glomerular filtration rate [Volume Rate/Area] in Serum, Plasma or Blood by Creatinine-based formula (CKD-EPI 2021)/1.73 sq M",
    "eGFR",
    qty(69, "mL/min/{1.73_m2}"),
    { ...interp("N", "Normal"), ...rr(60, undefined, "mL/min/{1.73_m2}") },
  ),
  lab(
    "k-2",
    "2026-02-16T16:00:00Z",
    "2823-3",
    "Potassium [Moles/volume] in Serum or Plasma",
    "Potassium",
    qty(4.3, "mmol/L"),
    { ...interp("N", "Normal"), ...rr(3.5, 5.1, "mmol/L") },
  ),
];

// A pull answers each resource as it stands: the earlier resources unchanged, then the ones recorded since, by type.
const order = [
  "Patient",
  "Condition",
  "MedicationStatement",
  "MedicationRequest",
  "Procedure",
  "DiagnosticReport",
  "Observation",
];
const all = [...prev.entry, ...added.map(entry)];
all.sort(
  (a, b) =>
    order.indexOf(a.resource.resourceType) -
      order.indexOf(b.resource.resourceType) ||
    (a.resource.effectiveDateTime ?? a.resource.meta.lastUpdated).localeCompare(
      b.resource.effectiveDateTime ?? b.resource.meta.lastUpdated,
    ),
);
const out = join(DIR, "north-2026-10");
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, "bundle.json"),
  JSON.stringify({ resourceType: "Bundle", type: "collection", entry: all }),
);
writeFileSync(
  join(out, "pull.json"),
  JSON.stringify(
    {
      fhirBase: BASE,
      patient: P,
      source: "Cascade North Demo Hospital",
      retrievedAt: "2026-10-15T00:00:00Z",
      missing: [],
      denied: [],
      asOf: "2026-10-15T00:00:00Z",
    },
    null,
    2,
  ) + "\n",
);
