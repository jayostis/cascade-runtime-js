// Apple Health export holding Kestrel Harbor Hospital's FHIR records as of one date.
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { AN, RANGE, KH_DRAWS } from "./data.mjs";

const BASE = "https://fhir.kestrelharborhealth.org/api/FHIR/R4";
const PT = { reference: "Patient/eJ4tQm0xWb7c9KsD2nRfVhA3" };
const fid = (s) =>
  "e" +
  createHash("sha256")
    .update(s)
    .digest("base64")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 26);
const iso = (ts) =>
  `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:00Z`;
const day = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const INTERP = { N: "Normal", H: "High", L: "Low" };
const qty = (v, u) => ({
  value: +v,
  unit: u,
  system: "http://unitsofmeasure.org",
  code: u,
});

function observation(draw, o) {
  const a = AN[o.an];
  const [lo, hi] = RANGE.KH[o.an] ?? [];
  const rr = {};
  if (lo !== undefined) rr.low = qty(lo, a.unit);
  if (hi !== undefined) rr.high = qty(hi, a.unit);
  const issued = new Date(Date.parse(iso(draw.time)) + 2.5 * 3600e3)
    .toISOString()
    .replace(".000", "");
  return {
    resourceType: "Observation",
    id: fid(`obs-${draw.key}-${o.an}`),
    meta: { versionId: "1", lastUpdated: issued },
    status: "final",
    category: [
      {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "laboratory",
            display: "Laboratory",
          },
        ],
      },
    ],
    code: {
      coding: [
        { system: "http://loinc.org", code: a.loinc.code, display: a.loinc.dn },
      ],
      text: a.name,
    },
    subject: PT,
    effectiveDateTime: iso(draw.time),
    issued,
    valueQuantity: qty(o.v, a.unit),
    interpretation: [
      {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
            code: o.interp,
            display: INTERP[o.interp],
          },
        ],
      },
    ],
    ...(Object.keys(rr).length && { referenceRange: [rr] }),
  };
}
const rx = (id, code, display, authored, status, extra = {}) => ({
  resourceType: "MedicationRequest",
  id,
  meta: {
    versionId: status === "active" ? "1" : "2",
    lastUpdated: extra.updated ?? `${authored}T17:05:00Z`,
  },
  status,
  ...(extra.reason && { statusReason: { text: extra.reason } }),
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
      { system: "http://www.nlm.nih.gov/research/umls/rxnorm", code, display },
    ],
    text: display,
  },
  subject: PT,
  authoredOn: authored,
  dosageInstruction: [
    {
      text: "Take 1 tablet by mouth once daily.",
      timing: { repeat: { frequency: 1, period: 1, periodUnit: "d" } },
      route: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "26643006",
            display: "Oral route",
          },
        ],
      },
      doseAndRate: [
        {
          doseQuantity: {
            value: 1,
            unit: "tablet",
            system:
              "http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm",
            code: "TAB",
          },
        },
      ],
    },
  ],
});
const cond = (id, code, display, onset) => ({
  resourceType: "Condition",
  id,
  meta: { versionId: "1", lastUpdated: `${onset}T17:00:00Z` },
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
    coding: [{ system: "http://snomed.info/sct", code, display }],
    text: display,
  },
  subject: PT,
  onsetDateTime: onset,
});
const imm = (id, date, cvx, display, text) => ({
  resourceType: "Immunization",
  id,
  meta: { versionId: "1", lastUpdated: `${day(date)}T18:00:00Z` },
  status: "completed",
  vaccineCode: {
    coding: [{ system: "http://hl7.org/fhir/sid/cvx", code: cvx, display }],
    text,
  },
  patient: PT,
  occurrenceDateTime: day(date),
  primarySource: true,
});
const proc = (id, date, code, display, text) => ({
  resourceType: "Procedure",
  id,
  meta: { versionId: "1", lastUpdated: `${day(date)}T20:00:00Z` },
  status: "completed",
  code: { coding: [{ system: "http://snomed.info/sct", code, display }], text },
  subject: PT,
  performedDateTime: day(date),
});

export function writeApple(folder, exportDate, D) {
  const root = join(folder, "apple_health_export");
  mkdirSync(join(root, "clinical-records"), { recursive: true });
  const res = [];
  res.push({
    resourceType: "AllergyIntolerance",
    id: fid("alg-aspirin"),
    meta: { versionId: "1", lastUpdated: "2016-08-22T15:10:00Z" },
    clinicalStatus: {
      coding: [
        {
          system:
            "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
          code: "active",
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system:
            "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
          code: "confirmed",
        },
      ],
    },
    type: "allergy",
    category: ["medication"],
    criticality: "low",
    code: {
      coding: [
        {
          system: "http://www.nlm.nih.gov/research/umls/rxnorm",
          code: "1191",
          display: "aspirin",
        },
      ],
      text: "Aspirin",
    },
    patient: PT,
    onsetDateTime: "2016-08",
    reaction: [
      {
        manifestation: [
          {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: "126485001",
                display: "Urticaria",
              },
            ],
            text: "Hives",
          },
        ],
        severity: "moderate",
      },
    ],
  });
  res.push({
    resourceType: "AllergyIntolerance",
    id: fid("alg-atorvastatin"),
    meta: { versionId: "1", lastUpdated: "2023-11-14T16:30:00Z" },
    clinicalStatus: {
      coding: [
        {
          system:
            "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
          code: "active",
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system:
            "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
          code: "confirmed",
        },
      ],
    },
    type: "intolerance",
    category: ["medication"],
    criticality: "low",
    code: {
      coding: [
        {
          system: "http://www.nlm.nih.gov/research/umls/rxnorm",
          code: "83367",
          display: "atorvastatin",
        },
      ],
      text: "Atorvastatin",
    },
    patient: PT,
    onsetDateTime: "2023-09",
    recordedDate: "2023-11-14",
    reaction: [
      {
        manifestation: [
          {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: "68962001",
                display: "Muscle pain",
              },
            ],
            text: "Muscle aches",
          },
        ],
      },
    ],
  });
  res.push(
    cond(fid("cond-prediabetes"), "714628002", "Prediabetes", "2020-01-14"),
  );
  res.push(
    cond(
      fid("cond-hyperlipidemia"),
      "55822004",
      "Hyperlipidemia",
      "2022-08-09",
    ),
  );
  res.push(
    cond(fid("cond-htn"), "59621000", "Essential hypertension", "2023-06-15"),
  );
  res.push(
    rx(
      fid("medrx-atorvastatin"),
      "617310",
      "atorvastatin 20 MG Oral Tablet",
      "2022-08-09",
      "stopped",
      { reason: "Muscle aches", updated: "2023-11-14T16:42:00Z" },
    ),
  );
  res.push(
    rx(
      fid("medrx-lisinopril"),
      "314076",
      "lisinopril 10 MG Oral Tablet",
      "2023-06-15",
      "active",
    ),
  );
  res.push(
    rx(
      fid("medrx-amlodipine"),
      "197361",
      "amlodipine 5 MG Oral Tablet",
      "2025-04-01",
      "active",
    ),
  );
  for (const [k, date, cvx, dn, text] of [
    ["tdap", "20200114", "115", "Tdap", "Tdap vaccine (Boostrix)"],
    [
      "flu20",
      "20201006",
      "150",
      "Influenza, injectable, quadrivalent, preservative free",
      "Influenza vaccine, quadrivalent",
    ],
    [
      "cov1",
      "20210402",
      "208",
      "COVID-19, mRNA, LNP-S, PF, 30 mcg/0.3 mL dose",
      "COVID-19 vaccine, mRNA (Pfizer-BioNTech)",
    ],
    [
      "cov2",
      "20210423",
      "208",
      "COVID-19, mRNA, LNP-S, PF, 30 mcg/0.3 mL dose",
      "COVID-19 vaccine, mRNA (Pfizer-BioNTech)",
    ],
    [
      "flu21",
      "20211012",
      "150",
      "Influenza, injectable, quadrivalent, preservative free",
      "Influenza vaccine, quadrivalent",
    ],
    [
      "cov3",
      "20211109",
      "208",
      "COVID-19, mRNA, LNP-S, PF, 30 mcg/0.3 mL dose",
      "COVID-19 vaccine, mRNA (Pfizer-BioNTech)",
    ],
    [
      "flu22",
      "20221011",
      "150",
      "Influenza, injectable, quadrivalent, preservative free",
      "Influenza vaccine, quadrivalent",
    ],
    [
      "cov4",
      "20221011",
      "300",
      "COVID-19, mRNA, LNP-S, bivalent, PF, 30 mcg/0.3 mL dose",
      "COVID-19 vaccine, mRNA, bivalent (Pfizer-BioNTech)",
    ],
    [
      "flu23",
      "20231017",
      "150",
      "Influenza, injectable, quadrivalent, preservative free",
      "Influenza vaccine, quadrivalent",
    ],
  ])
    res.push(imm(fid(`imm-${k}`), date, cvx, dn, text));
  for (const [k, date, code, dn, text] of [
    ["colo", "20190416", "73761001", "Colonoscopy", "Colonoscopy"],
    [
      "mam20",
      "20201006",
      "24623002",
      "Screening mammography",
      "Screening mammogram, bilateral",
    ],
    [
      "mam22",
      "20221011",
      "24623002",
      "Screening mammography",
      "Screening mammogram, bilateral",
    ],
    [
      "mam24",
      "20241008",
      "24623002",
      "Screening mammography",
      "Screening mammogram, bilateral",
    ],
  ])
    res.push(proc(fid(`proc-${k}`), date, code, dn, text));
  for (const d of KH_DRAWS.filter((x) => x.time.slice(0, 8) < D))
    for (const p of d.panels)
      for (const o of p.obs) res.push(observation(d, o));

  const TYPE = {
    AllergyIntolerance: "AllergyRecord",
    Condition: "ConditionRecord",
    MedicationRequest: "MedicationRecord",
    Observation: "LabResultRecord",
    Immunization: "ImmunizationRecord",
    Procedure: "ProcedureRecord",
  };
  const lines = res.map((r) => {
    const file = `${r.resourceType}-${r.id}.json`;
    writeFileSync(join(root, "clinical-records", file), JSON.stringify(r));
    const received =
      r.resourceType === "Observation" && r.issued > "2025-03-29"
        ? r.issued.replace("T", " ").replace("Z", " +0000")
        : "2025-03-29 18:39:51 +0000";
    return ` <ClinicalRecord type="HKClinicalTypeIdentifier${TYPE[r.resourceType]}" identifier="${r.id}" sourceName="Kestrel Harbor Hospital" sourceURL="${BASE}/${r.resourceType}/${r.id}" fhirVersion="4.0.1" receivedDate="${received}" resourceFilePath="/clinical-records/${file}"/>`;
  });
  writeFileSync(
    join(root, "export.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="en_US">\n <ExportDate value="${exportDate}"/>\n${lines.join("\n")}\n</HealthData>\n`,
  );
}
