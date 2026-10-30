// node generate.mjs <downloads>: writes the downloads Priya made after the kit's, beside its copies.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import {
  header,
  table,
  list,
  content,
  sec,
  empty,
  plan,
  encounters,
  paragraphs,
  para,
  esc,
  allergy,
  medication,
  problem,
  immunization,
  procedure,
  organizer,
  bp,
  smoking,
} from "../generators/ccda.mjs";

const OUT = argv[2];
const write = (name, xml) =>
  writeFileSync(join(OUT, name), xml.replace(/\r\n/g, "\n"));

const DRUG = {
  lisinoprilKH: {
    code: "KH-20417",
    dn: "lisinopril 10 MG Oral Tablet",
    sys: "2.16.840.1.113883.19.5.1.9",
    sysName: "Kestrel Harbor Formulary",
  },
  lisinopril: { code: "314076", dn: "lisinopril 10 MG Oral Tablet" },
  amlodipine: { code: "197361", dn: "amlodipine 5 MG Oral Tablet" },
  losartan: { code: "979492", dn: "losartan potassium 50 MG Oral Tablet" },
  metformin: {
    code: "860975",
    dn: "24 HR metformin hydrochloride 500 MG Extended Release Oral Tablet",
  },
  hctz: { code: "199903", dn: "hydrochlorothiazide 12.5 MG Oral Capsule" },
  tamsulosin: {
    code: "863669",
    dn: "tamsulosin hydrochloride 0.4 MG Oral Capsule",
  },
  ondansetron: {
    code: "104894",
    dn: "ondansetron 4 MG Disintegrating Oral Tablet",
  },
  acetaminophen: { code: "313782", dn: "acetaminophen 325 MG Oral Tablet" },
  claritin: { code: "206805", dn: "loratadine 10 MG Oral Tablet [Claritin]" },
  fluticasone: {
    code: "1797907",
    dn: "fluticasone propionate 0.05 MG/ACTUAT Metered Dose Nasal Spray",
  },
};
const L = {
  na: { code: "2951-2", dn: "Sodium [Moles/volume] in Serum or Plasma" },
  k: { code: "2823-3", dn: "Potassium [Moles/volume] in Serum or Plasma" },
  cl: { code: "2075-0", dn: "Chloride [Moles/volume] in Serum or Plasma" },
  co2: {
    code: "2028-9",
    dn: "Carbon dioxide, total [Moles/volume] in Serum or Plasma",
  },
  bun: { code: "3094-0", dn: "Urea nitrogen [Mass/volume] in Serum or Plasma" },
  cr: { code: "2160-0", dn: "Creatinine [Mass/volume] in Serum or Plasma" },
  egfr: {
    code: "98979-8",
    dn: "Glomerular filtration rate [Volume Rate/Area] in Serum, Plasma or Blood by Creatinine-based formula (CKD-EPI 2021)/1.73 sq M",
  },
  glu: { code: "2345-7", dn: "Glucose [Mass/volume] in Serum or Plasma" },
  fglu: {
    code: "1558-6",
    dn: "Fasting glucose [Mass/volume] in Serum or Plasma",
  },
  a1c: { code: "4548-4", dn: "Hemoglobin A1c/Hemoglobin.total in Blood" },
  chol: { code: "2093-3", dn: "Cholesterol [Mass/volume] in Serum or Plasma" },
  hdl: {
    code: "2085-9",
    dn: "Cholesterol in HDL [Mass/volume] in Serum or Plasma",
  },
  tg: { code: "2571-8", dn: "Triglyceride [Mass/volume] in Serum or Plasma" },
  ldl: {
    code: "13457-7",
    dn: "Cholesterol in LDL [Mass/volume] in Serum or Plasma by calculation",
  },
  tsh: { code: "3016-3", dn: "Thyrotropin [Units/volume] in Serum or Plasma" },
  ft4: {
    code: "3024-7",
    dn: "Thyroxine (T4) free [Mass/volume] in Serum or Plasma",
  },
  osm: { code: "2692-2", dn: "Osmolality of Serum or Plasma" },
  uBlood: {
    code: "5794-3",
    dn: "Hemoglobin [Presence] in Urine by Test strip",
  },
  uProt: { code: "5804-0", dn: "Protein [Mass/volume] in Urine by Test strip" },
  uNit: { code: "5802-4", dn: "Nitrite [Presence] in Urine by Test strip" },
  uLeuk: {
    code: "5799-2",
    dn: "Leukocyte esterase [Presence] in Urine by Test strip",
  },
  uGlu: { code: "5792-7", dn: "Glucose [Mass/volume] in Urine by Test strip" },
};
const PANEL = {
  bmp: { code: "51990-0", dn: "Basic metabolic panel - Blood" },
  cmp: {
    code: "24323-8",
    dn: "Comprehensive metabolic 2000 panel - Serum or Plasma",
  },
  lipid: { code: "24331-1", dn: "Lipid 1996 panel - Serum or Plasma" },
  a1c: { code: "4548-4", dn: "Hemoglobin A1c/Hemoglobin.total in Blood" },
  thyroid: {
    code: "3016-3",
    dn: "Thyrotropin [Units/volume] in Serum or Plasma",
  },
  osm: { code: "2692-2", dn: "Osmolality of Serum or Plasma" },
  ua: { code: "24357-6", dn: "Urinalysis macro (dipstick) panel - Urine" },
};
const EGFR_U = "mL/min/{1.73_m2}";
const ASPIRIN = { code: "1191", dn: "aspirin" };
const DRUG_ALLERGY = { code: "416098002", dn: "Allergy to drug" };
const HIVES = { code: "126485001", dn: "Urticaria" };

// ---------- shared clinical facts (one set of numbers, written by each source in its own way) ----------
// Fernhill-ordered draws, run by Northbay Clinical Laboratories
const DRAW = {
  sep22: "20250922161500+0000",
  dec09: "20251209164000+0000",
  jun15: "20260615153000+0000",
};
const RESULTS_FERNHILL = [
  {
    key: "a1c-0922",
    panel: PANEL.a1c,
    time: DRAW.sep22,
    obs: [
      {
        key: "a1c",
        loinc: L.a1c,
        name: "Hemoglobin A1c",
        v: { PQ: ["6.9", "%"] },
        interp: "H",
        lo: "4.0",
        hi: "5.6",
      },
    ],
  },
  {
    key: "cmp-0922",
    panel: PANEL.cmp,
    time: DRAW.sep22,
    obs: [
      {
        key: "glu",
        loinc: L.fglu,
        name: "Glucose, fasting",
        v: { PQ: ["138", "mg/dL"] },
        interp: "H",
        lo: "70",
        hi: "99",
      },
      {
        key: "na",
        loinc: L.na,
        name: "Sodium",
        v: { PQ: ["139", "mmol/L"] },
        interp: "N",
        lo: "135",
        hi: "145",
      },
      {
        key: "k",
        loinc: L.k,
        name: "Potassium",
        v: { PQ: ["4.3", "mmol/L"] },
        interp: "N",
        lo: "3.5",
        hi: "5.1",
      },
      {
        key: "cr",
        loinc: L.cr,
        name: "Creatinine",
        v: { PQ: ["0.88", "mg/dL"] },
        interp: "N",
        lo: "0.50",
        hi: "1.10",
      },
      {
        key: "egfr",
        loinc: L.egfr,
        name: "eGFR (CKD-EPI 2021)",
        v: { PQ: ["75", EGFR_U] },
        interp: "N",
        lo: "60",
      },
    ],
  },
  {
    key: "lipid-0922",
    panel: PANEL.lipid,
    time: DRAW.sep22,
    obs: [
      {
        key: "chol",
        loinc: L.chol,
        name: "Cholesterol, total",
        v: { PQ: ["221", "mg/dL"] },
        interp: "H",
        hi: "199",
      },
      {
        key: "hdl",
        loinc: L.hdl,
        name: "HDL cholesterol",
        v: { PQ: ["48", "mg/dL"] },
        interp: "L",
        lo: "50",
      },
      {
        key: "tg",
        loinc: L.tg,
        name: "Triglycerides",
        v: { PQ: ["155", "mg/dL"] },
        interp: "H",
        hi: "149",
      },
      {
        key: "ldl",
        loinc: L.ldl,
        name: "LDL cholesterol, calculated",
        v: { PQ: ["142", "mg/dL"] },
        interp: "H",
        hi: "99",
      },
    ],
  },
  {
    key: "a1c-1209",
    panel: PANEL.a1c,
    time: DRAW.dec09,
    obs: [
      {
        key: "a1c",
        loinc: L.a1c,
        name: "Hemoglobin A1c",
        v: { PQ: ["6.7", "%"] },
        interp: "H",
        lo: "4.0",
        hi: "5.6",
      },
    ],
  },
];
const RESULTS_JUNE = [
  {
    key: "a1c-0615",
    panel: PANEL.a1c,
    time: DRAW.jun15,
    obs: [
      {
        key: "a1c",
        loinc: L.a1c,
        name: "Hemoglobin A1c",
        v: { PQ: ["6.6", "%"] },
        interp: "H",
        lo: "4.0",
        hi: "5.6",
      },
    ],
  },
  {
    key: "bmp-0615",
    panel: PANEL.bmp,
    time: DRAW.jun15,
    obs: [
      {
        key: "glu",
        loinc: L.fglu,
        name: "Glucose, fasting",
        v: { PQ: ["124", "mg/dL"] },
        interp: "H",
        lo: "70",
        hi: "99",
      },
      {
        key: "na",
        loinc: L.na,
        name: "Sodium",
        v: { PQ: ["134", "mmol/L"] },
        interp: "L",
        lo: "135",
        hi: "145",
      },
      {
        key: "k",
        loinc: L.k,
        name: "Potassium",
        v: { PQ: ["4.2", "mmol/L"] },
        interp: "N",
        lo: "3.5",
        hi: "5.1",
      },
      {
        key: "cr",
        loinc: L.cr,
        name: "Creatinine",
        v: { PQ: ["0.93", "mg/dL"] },
        interp: "N",
        lo: "0.50",
        hi: "1.10",
      },
      {
        key: "egfr",
        loinc: L.egfr,
        name: "eGFR (CKD-EPI 2021)",
        v: { PQ: ["71", EGFR_U] },
        interp: "N",
        lo: "60",
      },
    ],
  },
];

const human = (ts) => {
  const d = new Date(
    Date.UTC(
      +ts.slice(0, 4),
      +ts.slice(4, 6) - 1,
      +ts.slice(6, 8),
      +(ts.slice(8, 10) || 0),
      +(ts.slice(10, 12) || 0),
    ),
  );
  const m = d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return `${m} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};
const humanTime = (ts) =>
  `${human(ts)} ${ts.slice(8, 10)}:${ts.slice(10, 12)} UTC`;
const range = (o) => {
  const u = o.v.PQ ? o.v.PQ[1] : "";
  if (o.lo !== undefined && o.hi !== undefined) return `${o.lo}-${o.hi} ${u}`;
  if (o.hi !== undefined) return `<${+o.hi + 1} ${u}`;
  if (o.lo !== undefined) return `>=${o.lo} ${u}`;
  return "";
};
const shown = (o) => (o.v.PQ ? `${o.v.PQ[0]} ${o.v.PQ[1]}` : o.v.ST);
const flag = (o) =>
  ({ H: " (High)", L: " (Low)", A: " (Abnormal)", N: "" })[o.interp ?? "N"];

// result tables in a source's style: tableStyle (KH, Saltmarsh, Northbay) or list (Fernhill)
function resultsTable(
  root,
  panels,
  idOf,
  prefix,
  after = "",
  extraCols = null,
) {
  const rows = [];
  const entries = panels.map((p, pi) => {
    const obs = p.obs.map((o, oi) => {
      const rid = `${prefix}${pi + 1}-${oi + 1}`;
      rows.push({
        id: rid,
        cells: [
          o.name,
          `${shown(o)}${flag(o)}`,
          o.rangeText ?? range(o),
          humanTime(p.time),
          ...(extraCols ? [extraCols] : []),
        ],
      });
      return { ...o, id: idOf(p, o, pi, oi), textRef: rid };
    });
    return organizer({
      root,
      id: idOf(p, null, pi),
      panel: p.panel,
      time: p.time,
      obs,
    });
  });
  const head = [
    "Test",
    "Result",
    "Reference range",
    "Collected",
    ...(extraCols ? ["Performed by"] : []),
  ];
  return { text: table(head, rows, after), entries };
}
function resultsList(root, panels, idOf, prefix) {
  const items = [];
  const entries = panels.map((p, pi) => {
    const obs = p.obs.map((o, oi) => {
      const rid = `${prefix}${pi + 1}-${oi + 1}`;
      items.push({
        id: rid,
        html: `${esc(o.name)} ${esc(shown(o))}${esc(flag(o))}, reference ${esc(o.rangeText ?? range(o))}, collected ${esc(human(p.time))}`,
      });
      return { ...o, id: idOf(p, o, pi, oi), textRef: rid };
    });
    return organizer({
      root,
      id: idOf(p, null, pi),
      panel: p.panel,
      time: p.time,
      obs,
    });
  });
  return { text: list(items), entries };
}

// ====================================================================================================
// Saltmarsh Regional Medical Center, emergency department visit, 2025-10-18 (downloaded 2025-10-25)
{
  const org = {
    root: "2.16.840.1.113883.19.5.3",
    name: "Saltmarsh Regional Medical Center",
    tel: "555-0230",
    addr: { street: "900 Estuary Road", city: "Saltmarsh" },
  };
  const R = org.root;
  const al = sec(
    "allergies",
    "Allergies",
    table(
      ["Substance", "Reaction", "Status"],
      [
        {
          id: "AL1",
          cells: [
            { id: "AL1-S", text: "Aspirin" },
            { id: "AL1-R", text: "Hives" },
            "Active",
          ],
        },
      ],
    ),
    [
      allergy({
        root: `${R}.4`,
        act: "SRM-AC-551",
        obs: "SRM-A-551",
        rxn: "SRM-AR-551",
        actLow: "20251018064500+0000",
        obsLow: "2016",
        type: DRUG_ALLERGY,
        rx: ASPIRIN,
        textRef: "AL1",
        subRef: "AL1-S",
        rxnRef: "AL1-R",
        reaction: HIVES,
      }),
    ],
  );
  const meds = [
    {
      id: "SRM-M-1",
      mood: "EVN",
      status: "active",
      lowNull: "UNK",
      drug: DRUG.losartan,
      name: "losartan potassium 50 MG Oral Tablet",
      instr: "1 tablet by mouth daily (home medication, patient reported)",
      start: "Home medication",
      st: "Active",
    },
    {
      id: "SRM-M-2",
      mood: "EVN",
      status: "active",
      lowNull: "UNK",
      drug: DRUG.amlodipine,
      name: "amlodipine 5 MG Oral Tablet",
      instr: "1 tablet by mouth daily (home medication, patient reported)",
      start: "Home medication",
      st: "Active",
    },
    {
      id: "SRM-M-3",
      mood: "EVN",
      status: "active",
      lowNull: "UNK",
      drug: DRUG.metformin,
      name: "metformin ER 500 MG Extended Release Oral Tablet",
      instr:
        "1 tablet by mouth daily with evening meal (home medication, patient reported)",
      start: "Home medication",
      st: "Active",
    },
    {
      id: "SRM-RX-1",
      mood: "INT",
      status: "active",
      low: "20251018",
      high: "20251101",
      periodH: 24,
      drug: DRUG.tamsulosin,
      name: "tamsulosin 0.4 MG Oral Capsule",
      instr: "Take 1 capsule by mouth once daily for 14 days.",
      start: "October 18, 2025",
      st: "Prescribed at discharge",
    },
    {
      id: "SRM-RX-2",
      mood: "INT",
      status: "active",
      low: "20251018",
      high: "20251025",
      drug: DRUG.ondansetron,
      name: "ondansetron 4 MG Disintegrating Oral Tablet",
      instr:
        "Dissolve 1 tablet on the tongue every 8 hours as needed for nausea.",
      start: "October 18, 2025",
      st: "Prescribed at discharge",
    },
    {
      id: "SRM-RX-3",
      mood: "INT",
      status: "active",
      low: "20251018",
      high: "20251101",
      dose: 2,
      drug: DRUG.acetaminophen,
      name: "acetaminophen 325 MG Oral Tablet",
      instr:
        "Take 2 tablets by mouth every 6 hours as needed for pain. Do not exceed 3,000 mg in 24 hours.",
      start: "October 18, 2025",
      st: "Prescribed at discharge",
    },
  ];
  const md = sec(
    "meds",
    "Medications",
    table(
      ["Medication", "Instructions", "Start", "Status"],
      meds.map((m, i) => ({
        id: `MD${i + 1}`,
        cells: [{ id: `MD${i + 1}-N`, text: m.name }, m.instr, m.start, m.st],
      })),
    ),
    meds.map((m, i) =>
      medication({
        root: `${R}.5`,
        ...m,
        textRef: `MD${i + 1}`,
        nameRef: `MD${i + 1}-N`,
      }),
    ),
  );
  const pr = sec(
    "problems",
    "Problems",
    table(
      ["Problem", "Noted", "Status"],
      [
        {
          id: "PB1",
          cells: [
            { id: "PB1-N", text: "Kidney stone" },
            "October 18, 2025",
            "Active",
          ],
        },
      ],
    ),
    [
      problem({
        root: `${R}.6`,
        act: "SRM-PC-1",
        obs: "SRM-P-1",
        actLow: "20251018",
        obsLow: "20251018",
        value: { code: "95570007", dn: "Kidney stone", sys: "snomed" },
        textRef: "PB1",
        nameRef: "PB1-N",
      }),
    ],
  );
  const ct = [
    `<paragraph><content styleCode="Bold">CT ABDOMEN AND PELVIS WITHOUT CONTRAST</content> (performed October 18, 2025 07:52 UTC; accession SRM-CT-2510-88412)</paragraph>`,
    para("Indication: Right flank pain radiating to the groin, hematuria."),
    para(
      "Technique: Helical CT of the abdomen and pelvis without intravenous or oral contrast. Dose reduction technique was used.",
    ),
    para(
      "Findings: There is a 4 mm calculus at the right ureterovesical junction with mild right hydroureteronephrosis and mild perinephric stranding. No other renal or ureteral calculi. The left kidney is unremarkable. The liver, gallbladder, spleen, pancreas and adrenal glands are unremarkable for a non-contrast study. The appendix is normal. No bowel obstruction. No free fluid. The urinary bladder is decompressed. Uterus and adnexa are unremarkable. Lung bases: a 7 mm solid nodule is present in the right lower lobe (series 2, image 14). No pleural effusion. No acute osseous abnormality.",
    ),
    para(
      "Impression: 1. 4 mm obstructing calculus at the right ureterovesical junction with mild right hydroureteronephrosis. 2. Incidental 7 mm solid pulmonary nodule in the right lower lobe, partially imaged. Per Fleischner Society guidelines, a non-contrast CT of the chest is recommended in 6-12 months.",
    ),
    para(
      "Electronically signed by Hannah Lindqvist, MD (Radiology), October 18, 2025 08:31 UTC.",
    ),
  ].join("\n");
  const ua = {
    key: "ua",
    panel: PANEL.ua,
    time: "20251018071000+0000",
    obs: [
      {
        key: "bl",
        loinc: L.uBlood,
        name: "Blood, urine (dipstick)",
        v: { ST: "Large (3+)" },
        interp: "A",
        rangeText: "Negative",
      },
      {
        key: "pr",
        loinc: L.uProt,
        name: "Protein, urine (dipstick)",
        v: { ST: "Negative" },
        interp: "N",
        rangeText: "Negative",
      },
      {
        key: "gl",
        loinc: L.uGlu,
        name: "Glucose, urine (dipstick)",
        v: { ST: "Negative" },
        interp: "N",
        rangeText: "Negative",
      },
      {
        key: "ni",
        loinc: L.uNit,
        name: "Nitrite, urine (dipstick)",
        v: { ST: "Negative" },
        interp: "N",
        rangeText: "Negative",
      },
      {
        key: "le",
        loinc: L.uLeuk,
        name: "Leukocyte esterase, urine (dipstick)",
        v: { ST: "Negative" },
        interp: "N",
        rangeText: "Negative",
      },
    ],
  };
  const bmpEd = {
    key: "bmp",
    panel: PANEL.bmp,
    time: "20251018070500+0000",
    obs: [
      {
        key: "na",
        loinc: L.na,
        name: "Sodium",
        v: { PQ: ["138", "mmol/L"] },
        interp: "N",
        lo: "136",
        hi: "145",
      },
      {
        key: "k",
        loinc: L.k,
        name: "Potassium",
        v: { PQ: ["3.9", "mmol/L"] },
        interp: "N",
        lo: "3.5",
        hi: "5.1",
      },
      {
        key: "bun",
        loinc: L.bun,
        name: "BUN",
        v: { PQ: ["18", "mg/dL"] },
        interp: "N",
        lo: "7",
        hi: "20",
      },
      {
        key: "cr",
        loinc: L.cr,
        name: "Creatinine",
        v: { PQ: ["1.02", "mg/dL"] },
        interp: "N",
        lo: "0.51",
        hi: "1.10",
      },
      {
        key: "egfr",
        loinc: L.egfr,
        name: "eGFR (CKD-EPI 2021)",
        v: { PQ: ["63", EGFR_U] },
        interp: "N",
        lo: "60",
      },
      {
        key: "glu",
        loinc: L.glu,
        name: "Glucose",
        v: { PQ: ["146", "mg/dL"] },
        interp: "H",
        lo: "70",
        hi: "139",
      },
    ],
  };
  const rt = resultsTable(
    `${R}.7`,
    [ua, bmpEd],
    (p, o, pi, oi) =>
      o
        ? `SRM-L-${pi + 1}${String(oi + 1).padStart(2, "0")}`
        : `SRM-LP-${pi + 1}`,
    "RS",
    ct,
  );
  const res = sec("results", "Results", rt.text, rt.entries);
  const vs = sec(
    "vitals",
    "Vital Signs",
    table(["Taken", "Blood pressure"], []).replace(
      "<tbody>\n\n    </tbody>",
      `<tbody>\n      <tr>\n        <td>October 18, 2025 06:45 UTC</td>\n        <td><content ID="VS1">158</content>/<content ID="VS2">94</content> mm[Hg]</td>\n      </tr>\n      <tr>\n        <td>October 18, 2025 11:30 UTC</td>\n        <td><content ID="VS3">136</content>/<content ID="VS4">82</content> mm[Hg]</td>\n      </tr>\n    </tbody>`,
    ),
    [
      bp({
        root: `${R}.8`,
        id: "SRM-V-1",
        time: "20251018064500+0000",
        sys: 158,
        dia: 94,
        ids: ["SRM-V-11", "SRM-V-12"],
        refs: ["VS1", "VS2"],
      }),
      bp({
        root: `${R}.8`,
        id: "SRM-V-2",
        time: "20251018113000+0000",
        sys: 136,
        dia: 82,
        ids: ["SRM-V-21", "SRM-V-22"],
        refs: ["VS3", "VS4"],
      }),
    ],
  );
  const sh = sec(
    "social",
    "Social History",
    table(
      ["Smoking status", "Recorded"],
      [{ id: "SH1", cells: ["Never smoker", "October 18, 2025"] }],
    ),
    [
      smoking({
        root: `${R}.8`,
        id: "SRM-S-1",
        time: "20251018064500+0000",
        textRef: "SH1",
      }),
    ],
  );
  const enc = encounters(
    table(
      ["Encounter", "Date", "Location", "Provider", "Diagnosis"],
      [
        {
          id: "EN1",
          cells: [
            "Emergency department visit",
            "October 18, 2025 06:40-11:55 UTC",
            "Saltmarsh Regional Medical Center Emergency Department",
            "Malik Osei, MD",
            "Right ureteral stone with renal colic",
          ],
        },
      ],
    ),
  );
  const pl = plan(
    paragraphs([
      para("Discharge instructions, October 18, 2025."),
      para(
        "You were seen for a kidney stone on the right side. The stone is small (4 mm) and is likely to pass on its own.",
      ),
      para(
        "Take tamsulosin 0.4 mg once a day for 14 days to help the stone pass. Use acetaminophen for pain and ondansetron if you feel sick to your stomach. Ibuprofen and ketorolac were not given because of your aspirin allergy.",
      ),
      para(
        "Drink plenty of fluids and strain your urine. Follow up with your primary care provider in 1 week. If the stone has not passed in 2 weeks, see urology.",
      ),
      para(
        "Return to the emergency department for fever, pain that is not controlled, or vomiting that does not stop.",
      ),
    ]),
  );
  write(
    "saltmarsh-regional-medical-center-ed-summary.xml",
    header({
      org,
      docId: "SRMC-ED-7730412-20251018",
      title:
        "Saltmarsh Regional Medical Center Emergency Department Visit Summary",
      time: "20251018125512+0000",
      patient: { root: `${R}.2`, ext: "7730412" },
      author: {
        id: "OSEI-4471",
        person: { given: "Malik", family: "Osei", suffix: "MD" },
      },
      serviceLow: "20251018",
      serviceHigh: "20251018",
      sections: [al, md, pr, res, vs, sh, enc, pl],
    }),
  );
}

// ====================================================================================================
// Fernhill Family Clinic, third and fourth downloads (2026-01-05 and 2026-06-22). Fernhill's EHR writes every medication
// with one id, as its first two downloads did.
function fernhill({ docExt, time, high, june }) {
  const org = {
    root: "2.16.840.1.113883.19.5.2",
    name: "Fernhill Family Clinic",
    tel: "555-0190",
    addr: { street: "310 Fern Street", city: "Fernhill" },
  };
  const R = org.root;
  const al = sec(
    "allergies",
    "Allergies",
    list([
      { id: "fa-1", html: `${content("fa-1-name", "Aspirin")}: hives` },
      {
        id: "fa-2",
        html: `${content("fa-2-name", "Lisinopril")}: dry cough (intolerance), September 2025`,
      },
    ]),
    [
      allergy({
        root: `${R}.4`,
        act: "ALC-77",
        obs: "AL-77",
        rxn: "ALR-77",
        actLow: "20241015",
        obsLow: "2016",
        type: DRUG_ALLERGY,
        rx: ASPIRIN,
        textRef: "fa-1",
        subRef: "fa-1-name",
        reaction: HIVES,
      }),
      allergy({
        root: `${R}.4`,
        act: "ALC-91",
        obs: "AL-91",
        rxn: "ALR-91",
        actLow: "20250922",
        obsLow: "20250922",
        type: { code: "59037007", dn: "Drug intolerance" },
        rx: { code: "29046", dn: "lisinopril" },
        textRef: "fa-2",
        subRef: "fa-2-name",
        reaction: { code: "49727002", dn: "Cough" },
        statusActive: true,
      }),
    ],
  );
  const meds = [
    {
      status: "active",
      lowNull: "UNK",
      drug: DRUG.claritin,
      name: "Claritin 10 MG Oral Tablet",
      tail: "1 tablet daily as needed; start date not recorded",
    },
    {
      status: "completed",
      low: "20241015",
      drug: DRUG.fluticasone,
      name: "fluticasone propionate 50 MCG/ACTUAT Nasal Spray",
      tail: "1 spray in each nostril daily, from October 15, 2024; completed",
      route: "nasal",
    },
    {
      status: "aborted",
      low: "20230615",
      high: "20250922",
      drug: DRUG.lisinopril,
      name: "lisinopril 10 MG Oral Tablet",
      tail: "1 tablet daily, from June 15, 2023; stopped September 22, 2025 because of dry cough, changed to losartan",
    },
    {
      status: "active",
      low: "20250922",
      drug: DRUG.losartan,
      name: "losartan potassium 50 MG Oral Tablet",
      tail: "1 tablet daily, from September 22, 2025",
    },
    {
      status: "active",
      low: "20250401",
      drug: DRUG.amlodipine,
      name: "amlodipine 5 MG Oral Tablet",
      tail: "1 tablet daily, from April 1, 2025",
    },
    {
      status: "active",
      low: "20250922",
      drug: DRUG.metformin,
      name: "metformin ER 500 MG 24 HR Extended Release Oral Tablet",
      tail: "1 tablet daily with the evening meal, from September 22, 2025",
    },
    {
      status: "active",
      low: "20251209",
      drug: DRUG.hctz,
      name: "hydrochlorothiazide 12.5 MG Oral Capsule",
      tail: "1 capsule daily, from December 9, 2025",
    },
  ];
  const md = sec(
    "meds",
    "Medications",
    list(
      meds.map((m, i) => ({
        id: `fm-${i + 1}`,
        html: `${content(`fm-${i + 1}-name`, m.name)}: ${esc(m.tail)}`,
      })),
    ),
    meds.map((m, i) =>
      medication({
        root: `${R}.5`,
        id: "RX",
        mood: "EVN",
        ...m,
        textRef: `fm-${i + 1}`,
        nameRef: `fm-${i + 1}-name`,
      }),
    ),
  );
  const pr = sec(
    "problems",
    "Problems",
    list([
      {
        id: "fp-1",
        html: `${content("fp-1-name", "Hay fever")}, since October 2024`,
      },
      {
        id: "fp-2",
        html: `${content("fp-2-name", "Essential hypertension")}, since June 2023`,
      },
      {
        id: "fp-3",
        html: `${content("fp-3-name", "Type 2 diabetes mellitus")}, since September 2025`,
      },
    ]),
    [
      problem({
        root: `${R}.6`,
        act: "PC-410",
        obs: "P-410",
        actLow: "20241015",
        obsLow: "20241015",
        value: { code: "367498001", sys: "snomed" },
        textRef: "fp-1",
        nameRef: "fp-1-name",
      }),
      problem({
        root: `${R}.6`,
        act: "PC-455",
        obs: "P-455",
        actLow: "20250922",
        obsLow: "20230615",
        value: {
          code: "59621000",
          dn: "Essential hypertension",
          sys: "snomed",
        },
        textRef: "fp-2",
        nameRef: "fp-2-name",
      }),
      problem({
        root: `${R}.6`,
        act: "PC-470",
        obs: "P-470",
        actLow: "20250922",
        obsLow: "20250922",
        value: {
          code: "44054006",
          dn: "Diabetes mellitus type 2",
          sys: "snomed",
        },
        textRef: "fp-3",
        nameRef: "fp-3-name",
      }),
    ],
  );
  const im = sec(
    "imms",
    "Immunizations",
    list([
      {
        id: "fi-1",
        html: `${content("fi-1-name", "Influenza vaccine")}, given October 15, 2024`,
      },
    ]),
    [
      immunization({
        root: `${R}.7`,
        id: null,
        date: "20241015",
        cvx: { code: "141", dn: "Influenza, seasonal, injectable" },
        textRef: "fi-1",
        nameRef: "fi-1-name",
      }),
    ],
  );
  const panels = june
    ? [...RESULTS_FERNHILL, ...RESULTS_JUNE]
    : RESULTS_FERNHILL;
  const rl = resultsList(
    `${R}.9`,
    panels,
    (p, o) => (o ? `LR-${p.key}-${o.key}` : `LRP-${p.key}`),
    "fr-",
  );
  const res = sec("results", "Results", rl.text, rl.entries);
  const vitals = [
    {
      id: "V-0922",
      time: "20250922160000+0000",
      sys: 138,
      dia: 86,
      label: "September 22, 2025",
    },
    {
      id: "V-1209",
      time: "20251209163000+0000",
      sys: 142,
      dia: 88,
      label: "December 9, 2025",
    },
    ...(june
      ? [
          {
            id: "V-0615",
            time: "20260615152000+0000",
            sys: 128,
            dia: 80,
            label: "June 15, 2026",
          },
        ]
      : []),
  ];
  const vs = sec(
    "vitals",
    "Vital Signs",
    list(
      vitals.map((v, i) => ({
        id: `fv-${i + 1}`,
        html: `${v.label}: blood pressure ${content(`fv-${i + 1}-s`, String(v.sys))}/${content(`fv-${i + 1}-d`, String(v.dia))} mm[Hg]`,
      })),
    ),
    vitals.map((v, i) =>
      bp({
        root: `${R}.7`,
        id: v.id,
        time: v.time,
        sys: v.sys,
        dia: v.dia,
        ids: [`${v.id}-1`, `${v.id}-2`],
        refs: [`fv-${i + 1}-s`, `fv-${i + 1}-d`],
      }),
    ),
  );
  const sh = sec(
    "social",
    "Social History",
    list([{ id: "fs-1", html: "Never smoker, recorded September 22, 2025" }]),
    [
      smoking({
        root: `${R}.8`,
        id: "S-0922",
        time: "20250922160000+0000",
        textRef: "fs-1",
      }),
    ],
  );
  const notes = [
    para(
      "September 22, 2025 (annual visit, Elena Marsh, MD): Fasting glucose 138 and hemoglobin A1c 6.9%: new diagnosis of type 2 diabetes. Start metformin ER 500 mg with the evening meal; referred to diabetes education. Dry cough for several months on lisinopril: stop lisinopril, start losartan 50 mg daily. Continue amlodipine 5 mg.",
    ),
    para(
      "December 9, 2025 (follow-up, Elena Marsh, MD): Cough resolved. Blood pressure 142/88, above goal. Add hydrochlorothiazide 12.5 mg daily. A1c 6.7%. Return in 3 months.",
    ),
    ...(june
      ? [
          para(
            "June 15, 2026 (follow-up, Elena Marsh, MD): Blood pressure 128/80, at goal. A1c 6.6%. Continue current medications. Return in 6 months.",
          ),
        ]
      : []),
  ];
  const pl = plan(paragraphs(notes));
  return header({
    org,
    docId: docExt,
    title: "Fernhill Family Clinic Summary of Care",
    time,
    patient: { root: `${R}.2`, ext: "20931" },
    author: {
      id: "ELM-114",
      person: { given: "Elena", family: "Marsh", suffix: "MD" },
    },
    serviceLow: "20241015",
    serviceHigh: high,
    sections: [al, md, pr, im, res, vs, sh, pl],
  });
}
write(
  "fernhill-family-clinic-summary-3.xml",
  fernhill({
    docExt: "FFC-CCD-0105-20931",
    time: "20260105171205+0000",
    high: "20260105",
    june: false,
  }),
);
write(
  "fernhill-family-clinic-summary-4.xml",
  fernhill({
    docExt: "FFC-CCD-0622-20931",
    time: "20260622180344+0000",
    high: "20260622",
    june: true,
  }),
);

// ====================================================================================================
// Kestrel Harbor Hospital, health summary after an admission 2026-03-02 to 2026-03-05 (downloaded 2026-03-10)
{
  const org = {
    root: "2.16.840.1.113883.19.5.1",
    name: "Kestrel Harbor Hospital",
    tel: "555-0100",
    addr: { street: "1200 Harbor Way", city: "Kestrel Harbor" },
  };
  const R = org.root;
  const al = sec(
    "allergies",
    "Allergies",
    table(
      ["Substance", "Reaction", "Criticality", "Status", "Noted"],
      [
        {
          id: "ALG-01",
          cells: [
            { id: "ALG-01-SUB", text: "Aspirin" },
            { id: "ALG-01-RXN", text: "Hives" },
            "Low",
            "Active",
            "August 2016",
          ],
        },
      ],
    ),
    [
      allergy({
        root: `${R}.3`,
        act: "ALGC-1001",
        obs: "ALG-1001",
        rxn: "ALGR-1001",
        actLow: "20160822151000+0000",
        obsLow: "201608",
        type: DRUG_ALLERGY,
        rx: ASPIRIN,
        textRef: "ALG-01",
        subRef: "ALG-01-SUB",
        rxnRef: "ALG-01-RXN",
        reaction: HIVES,
        severity: { code: "6736007", dn: "Moderate" },
        criticality: true,
      }),
    ],
  );
  const meds = [
    {
      id: "MED-2604",
      status: "active",
      low: "20250922",
      drug: DRUG.losartan,
      name: "losartan potassium 50 MG Oral Tablet",
      instr: "Take 1 tablet by mouth once daily.",
      start: "September 22, 2025",
      st: "Active",
    },
    {
      id: "MED-2391",
      status: "active",
      low: "20250401",
      drug: DRUG.amlodipine,
      name: "amlodipine 5 MG Oral Tablet",
      instr: "Take 1 tablet by mouth once daily.",
      start: "April 1, 2025",
      st: "Active",
    },
    {
      id: "MED-2605",
      status: "active",
      low: "20250922",
      drug: DRUG.metformin,
      name: "metformin hydrochloride 500 MG 24 HR Extended Release Oral Tablet",
      instr: "Take 1 tablet by mouth once daily with the evening meal.",
      start: "September 22, 2025",
      st: "Active",
    },
    {
      id: "MED-2611",
      status: "aborted",
      low: "20251209",
      high: "20260305",
      drug: DRUG.hctz,
      name: "hydrochlorothiazide 12.5 MG Oral Capsule",
      instr: "STOP taking this medicine.",
      start: "December 9, 2025",
      st: "Discontinued March 5, 2026 (hyponatremia)",
    },
    {
      id: "MED-2207",
      status: "aborted",
      low: "20230615",
      high: "20250922",
      drug: DRUG.lisinoprilKH,
      translation: DRUG.lisinopril,
      name: "lisinopril 10 MG Oral Tablet",
      instr: "Take 1 tablet by mouth once daily.",
      start: "June 15, 2023",
      st: "Discontinued September 22, 2025 by outside provider (cough); replaced by losartan",
    },
  ];
  const md = sec(
    "meds",
    "Medications",
    table(
      ["Medication", "Instructions", "Start", "Status"],
      meds.map((m, i) => ({
        id: `MED-0${i + 1}`,
        cells: [
          { id: `MED-0${i + 1}-NAME`, text: m.name },
          m.instr,
          m.start,
          m.st,
        ],
      })),
    ),
    meds.map((m, i) =>
      medication({
        root: `${R}.4`,
        mood: "EVN",
        periodH: 24,
        ...m,
        textRef: `MED-0${i + 1}`,
        nameRef: `MED-0${i + 1}-NAME`,
      }),
    ),
  );
  const pr = sec(
    "problems",
    "Problems",
    table(
      ["Problem", "Onset", "Status"],
      [
        {
          id: "PRB-01",
          cells: [
            { id: "PRB-01-NAME", text: "Essential hypertension" },
            "June 15, 2023",
            "Active",
          ],
        },
        {
          id: "PRB-02",
          cells: [
            { id: "PRB-02-NAME", text: "Type 2 diabetes mellitus" },
            "September 22, 2025",
            "Active",
          ],
        },
        {
          id: "PRB-03",
          cells: [
            { id: "PRB-03-NAME", text: "Hyponatremia" },
            "March 2, 2026",
            "Resolved March 5, 2026",
          ],
        },
      ],
    ),
    [
      problem({
        root: `${R}.6`,
        act: "PRBC-3310",
        obs: "PRB-3310",
        actLow: "20230615",
        obsLow: "20230615",
        value: {
          code: "59621000",
          dn: "Essential hypertension",
          sys: "snomed",
        },
        textRef: "PRB-01",
        nameRef: "PRB-01-NAME",
      }),
      problem({
        root: `${R}.6`,
        act: "PRBC-3502",
        obs: "PRB-3502",
        actLow: "20260302",
        obsLow: "20250922",
        value: {
          code: "44054006",
          dn: "Diabetes mellitus type 2",
          sys: "snomed",
        },
        textRef: "PRB-02",
        nameRef: "PRB-02-NAME",
      }),
      problem({
        root: `${R}.6`,
        act: "PRBC-3519",
        obs: "PRB-3519",
        actStatus: "completed",
        actLow: "20260302",
        actHigh: "20260305",
        obsLow: "20260302",
        obsHigh: "20260305",
        value: { code: "89627008", dn: "Hyponatremia", sys: "snomed" },
        textRef: "PRB-03",
        nameRef: "PRB-03-NAME",
        problemStatus: "resolved",
      }),
    ],
  );
  const pc = sec(
    "procs",
    "Procedures",
    table(
      ["Procedure", "Date", "Location", "Result"],
      [
        {
          id: "PRC-01",
          cells: [
            { id: "PRC-01-NAME", text: "Colonoscopy" },
            "April 16, 2019",
            "Kestrel Harbor Hospital Endoscopy",
            "Screening colonoscopy to the cecum, good preparation. Normal colon; no polyps. Repeat colonoscopy in 10 years.",
          ],
        },
      ],
    ),
    [
      procedure({
        root: `${R}.10`,
        id: "PROC-1907",
        code: { code: "73761001", dn: "Colonoscopy", sys: "snomed" },
        date: "20190416",
        textRef: "PRC-01",
        nameRef: "PRC-01-NAME",
      }),
    ],
  );
  const U = { na: "mmol/l", k: "mmol/l", cl: "mmol/l" };
  const adm = {
    key: "bmp-0302",
    panel: PANEL.bmp,
    time: "20260302194000+0000",
    obs: [
      {
        key: "na",
        loinc: L.na,
        name: "Sodium",
        v: { PQ: ["123", U.na] },
        interp: "L",
        lo: "136",
        hi: "145",
      },
      {
        key: "k",
        loinc: L.k,
        name: "Potassium",
        v: { PQ: ["3.6", U.k] },
        interp: "N",
        lo: "3.5",
        hi: "5.1",
      },
      {
        key: "cl",
        loinc: L.cl,
        name: "Chloride",
        v: { PQ: ["88", U.cl] },
        interp: "L",
        lo: "98",
        hi: "107",
      },
      {
        key: "cr",
        loinc: L.cr,
        name: "Creatinine",
        v: { PQ: ["1.04", "mg/dL"] },
        interp: "N",
        lo: "0.57",
        hi: "1.11",
      },
      {
        key: "egfr",
        loinc: L.egfr,
        name: "eGFR (CKD-EPI 2021)",
        v: { PQ: ["62", EGFR_U] },
        interp: "N",
        lo: "60",
      },
      {
        key: "glu",
        loinc: L.glu,
        name: "Glucose",
        v: { PQ: ["141", "mg/dL"] },
        interp: "H",
        lo: "70",
        hi: "99",
      },
    ],
  };
  const osm = {
    key: "osm-0302",
    panel: PANEL.osm,
    time: "20260302194000+0000",
    obs: [
      {
        key: "osm",
        loinc: L.osm,
        name: "Osmolality, serum",
        v: { PQ: ["256", "mosm/kg"] },
        interp: "L",
        lo: "275",
        hi: "295",
      },
    ],
  };
  const thy = {
    key: "tsh-0303",
    panel: PANEL.thyroid,
    time: "20260303061000+0000",
    obs: [
      {
        key: "tsh",
        loinc: L.tsh,
        name: "TSH",
        v: { PQ: ["7.9", "m[IU]/L"] },
        interp: "H",
        lo: "0.40",
        hi: "4.00",
      },
      {
        key: "ft4",
        loinc: L.ft4,
        name: "Free T4",
        v: { PQ: ["1.0", "ng/dL"] },
        interp: "N",
        lo: "0.8",
        hi: "1.8",
      },
    ],
  };
  const dis = {
    key: "bmp-0305",
    panel: PANEL.bmp,
    time: "20260305060500+0000",
    obs: [
      {
        key: "na",
        loinc: L.na,
        name: "Sodium",
        v: { PQ: ["133", U.na] },
        interp: "L",
        lo: "136",
        hi: "145",
      },
      {
        key: "k",
        loinc: L.k,
        name: "Potassium",
        v: { PQ: ["4.0", U.k] },
        interp: "N",
        lo: "3.5",
        hi: "5.1",
      },
      {
        key: "cl",
        loinc: L.cl,
        name: "Chloride",
        v: { PQ: ["97", U.cl] },
        interp: "L",
        lo: "98",
        hi: "107",
      },
      {
        key: "cr",
        loinc: L.cr,
        name: "Creatinine",
        v: { PQ: ["0.92", "mg/dL"] },
        interp: "N",
        lo: "0.57",
        hi: "1.11",
      },
      {
        key: "egfr",
        loinc: L.egfr,
        name: "eGFR (CKD-EPI 2021)",
        v: { PQ: ["70", EGFR_U] },
        interp: "N",
        lo: "60",
      },
      {
        key: "glu",
        loinc: L.glu,
        name: "Glucose",
        v: { PQ: ["118", "mg/dL"] },
        interp: "H",
        lo: "70",
        hi: "99",
      },
    ],
  };
  const ids = {
    "bmp-0302": "LABP-61200",
    "osm-0302": "LABP-61201",
    "tsh-0303": "LABP-61230",
    "bmp-0305": "LABP-61290",
  };
  let n = 61202;
  const rt = resultsTable(
    `${R}.5`,
    [adm, osm, thy, dis],
    (p, o) => (o ? `LAB-${n++}` : ids[p.key]),
    "RES-",
  );
  const res = sec("results", "Results", rt.text, rt.entries);
  const vs = sec(
    "vitals",
    "Vital Signs",
    table(["Taken", "Blood pressure"], []).replace(
      "<tbody>\n\n    </tbody>",
      `<tbody>\n      <tr>\n        <td>March 2, 2026 18:55 UTC</td>\n        <td><content ID="VS-01-S">104</content>/<content ID="VS-01-D">62</content> mm[Hg]</td>\n      </tr>\n      <tr>\n        <td>March 5, 2026 08:10 UTC</td>\n        <td><content ID="VS-02-S">126</content>/<content ID="VS-02-D">78</content> mm[Hg]</td>\n      </tr>\n    </tbody>`,
    ),
    [
      bp({
        root: `${R}.7`,
        id: "VS-9120",
        time: "20260302185500+0000",
        sys: 104,
        dia: 62,
        ids: ["VS-9121", "VS-9122"],
        refs: ["VS-01-S", "VS-01-D"],
      }),
      bp({
        root: `${R}.7`,
        id: "VS-9180",
        time: "20260305081000+0000",
        sys: 126,
        dia: 78,
        ids: ["VS-9181", "VS-9182"],
        refs: ["VS-02-S", "VS-02-D"],
      }),
    ],
  );
  const sh = sec(
    "social",
    "Social History",
    table(
      ["Smoking status", "Recorded"],
      [{ id: "SOC-01", cells: ["Never smoker", "March 2, 2026"] }],
    ),
    [
      smoking({
        root: `${R}.7`,
        id: "SH-9120",
        time: "20260302185500+0000",
        textRef: "SOC-01",
      }),
    ],
  );
  const enc = encounters(
    table(
      ["Encounter", "Dates", "Department", "Attending", "Discharge diagnosis"],
      [
        {
          id: "ENC-01",
          cells: [
            "Inpatient admission",
            "March 2, 2026 - March 5, 2026",
            "Kestrel Harbor Hospital, Internal Medicine",
            "Rahul Venkat, MD",
            "Hyponatremia, likely due to hydrochlorothiazide; dizziness with a fall at home, no injury",
          ],
        },
      ],
    ),
  );
  const pl = plan(
    paragraphs([
      para("Discharge instructions, March 5, 2026."),
      para(
        "You were admitted with dizziness and a low sodium level (123). Your sodium improved after hydrochlorothiazide was stopped and with fluid restriction.",
      ),
      para(
        "STOP taking hydrochlorothiazide. Continue losartan 50 mg once daily, amlodipine 5 mg once daily and metformin ER 500 mg with the evening meal.",
      ),
      para(
        "Follow up with your primary care provider, Elena Marsh, MD, at Fernhill Family Clinic within 1-2 weeks.",
      ),
      para(
        "Your thyroid test (TSH) was mildly high during your stay. Please have TSH and free T4 repeated in 6-8 weeks, once you have recovered.",
      ),
    ]),
  );
  write(
    "kestrel-harbor-health-summary-5.xml",
    header({
      org,
      docId: "CCD-KH48213-20260310",
      title: "Kestrel Harbor Hospital Health Summary",
      time: "20260310081544+0000",
      patient: { root: `${R}.2`, ext: "KH48213" },
      author: {
        id: "KH-EHR",
        device: {
          model: "Kestrel Harbor EHR",
          software: "Kestrel Harbor Patient Portal",
        },
      },
      serviceLow: "20160822",
      serviceHigh: "20260310",
      sections: [al, md, pr, pc, res, vs, sh, enc, pl],
    }).replace(
      `<id root="${R}.3" extension="KH-EHR"/>`,
      `<id root="${R}.8" extension="KH-EHR"/>`,
    ),
  );
}

// ====================================================================================================
// Clearwater Eye Associates, eye examination 2026-05-14 (downloaded 2026-05-20)
{
  const org = {
    root: "2.16.840.1.113883.19.5.5",
    name: "Clearwater Eye Associates",
    tel: "555-0262",
    addr: { street: "455 Lakeview Drive", city: "Kestrel Harbor" },
  };
  const R = org.root;
  const al = sec(
    "allergies",
    "Allergies",
    table(
      ["Substance", "Reaction", "Status"],
      [
        {
          id: "a1",
          cells: [
            { id: "a1s", text: "Aspirin" },
            { id: "a1r", text: "Hives" },
            "Active",
          ],
        },
      ],
    ),
    [
      allergy({
        root: `${R}.4`,
        act: "CE-AC-30177-1",
        obs: "CE-A-30177-1",
        rxn: "CE-AR-30177-1",
        actLow: "20260514",
        obsLow: "2016",
        type: DRUG_ALLERGY,
        rx: ASPIRIN,
        textRef: "a1",
        subRef: "a1s",
        rxnRef: "a1r",
        reaction: HIVES,
      }),
    ],
  );
  const meds = [
    {
      drug: DRUG.losartan,
      name: "losartan 50 mg tablet",
      instr: "1 tablet daily",
    },
    {
      drug: DRUG.amlodipine,
      name: "amlodipine 5 mg tablet",
      instr: "1 tablet daily",
    },
    {
      drug: DRUG.metformin,
      name: "metformin ER 500 mg tablet",
      instr: "1 tablet daily with dinner",
    },
    {
      drug: DRUG.hctz,
      name: "hydrochlorothiazide 12.5 mg capsule",
      instr: "1 capsule daily",
    },
    { drug: DRUG.claritin, name: "Claritin 10 mg tablet", instr: "as needed" },
  ];
  const md = sec(
    "meds",
    "Medications",
    table(
      ["Medication", "Instructions", "Source", "Status"],
      meds.map((m, i) => ({
        id: `m${i + 1}`,
        cells: [
          { id: `m${i + 1}n`, text: m.name },
          m.instr,
          "Patient reported, May 14, 2026",
          "Active",
        ],
      })),
    ),
    meds.map((m, i) =>
      medication({
        root: `${R}.5`,
        id: `CE-M-30177-${i + 1}`,
        mood: "EVN",
        status: "active",
        lowNull: "UNK",
        ...m,
        textRef: `m${i + 1}`,
        nameRef: `m${i + 1}n`,
      }),
    ),
  );
  const pr = sec(
    "problems",
    "Problems",
    table(
      ["Diagnosis", "Code", "Date"],
      [
        {
          id: "p1",
          cells: [
            {
              id: "p1n",
              text: "Type 2 diabetes mellitus without complications",
            },
            "E11.9",
            "May 14, 2026",
          ],
        },
        {
          id: "p2",
          cells: [{ id: "p2n", text: "Presbyopia" }, "H52.4", "May 14, 2026"],
        },
      ],
    ),
    [
      problem({
        root: `${R}.6`,
        act: "CE-PC-30177-1",
        obs: "CE-P-30177-1",
        actLow: "20260514",
        obsLow: "202509",
        value: {
          code: "E11.9",
          dn: "Type 2 diabetes mellitus without complications",
          sys: "icd10",
        },
        textRef: "p1",
        nameRef: "p1n",
      }),
      problem({
        root: `${R}.6`,
        act: "CE-PC-30177-2",
        obs: "CE-P-30177-2",
        actLow: "20260514",
        obsLow: "20260514",
        value: { code: "H52.4", dn: "Presbyopia", sys: "icd10" },
        textRef: "p2",
        nameRef: "p2n",
      }),
    ],
  );
  const pc = sec(
    "procs",
    "Procedures",
    table(
      ["Procedure", "Date", "Performed by", "Findings"],
      [
        {
          id: "x1",
          cells: [
            { id: "x1n", text: "Comprehensive eye examination with dilation" },
            "May 14, 2026",
            "Daniel Reyes, OD",
            "Visual acuity with correction 20/20 OD, 20/20 OS. Intraocular pressure 15 mmHg OD, 16 mmHg OS. Dilated fundus examination: no diabetic retinopathy and no macular edema in either eye. Optic nerves healthy. Lenses clear.",
          ],
        },
      ],
    ),
    [
      procedure({
        root: `${R}.7`,
        id: "CE-X-30177-1",
        code: {
          code: "92004",
          dn: "Ophthalmological services: medical examination and evaluation with initiation of diagnostic and treatment program; comprehensive, new patient, 1 or more visits",
          sys: "cpt",
        },
        date: "20260514",
        textRef: "x1",
        nameRef: "x1n",
      }),
    ],
  );
  const res = empty("results", "Results", "No laboratory results.");
  const pl = plan(
    paragraphs([
      para(
        "Assessment, May 14, 2026: Type 2 diabetes without diabetic retinopathy in either eye. Presbyopia.",
      ),
      para(
        "Plan: New reading prescription given. Return in 12 months for a dilated diabetic eye examination. A copy of this report was sent to Elena Marsh, MD, Fernhill Family Clinic.",
      ),
    ]),
  );
  write(
    "clearwater-eye-associates-visit-summary.xml",
    header({
      org,
      docId: "CEA-30177-20260514",
      title: "Clearwater Eye Associates Visit Summary",
      time: "20260514201733+0000",
      patient: { root: `${R}.2`, ext: "30177" },
      author: {
        id: "REYES-OD",
        person: { given: "Daniel", family: "Reyes", suffix: "OD" },
      },
      serviceLow: "20260514",
      serviceHigh: "20260514",
      sections: [al, md, pr, pc, res, pl],
    }),
  );
}

// ====================================================================================================
// Northbay Clinical Laboratories patient portal, results (downloaded 2026-06-18)
{
  const org = {
    root: "2.16.840.1.113883.19.5.6",
    name: "Northbay Clinical Laboratories",
    tel: "555-0275",
    addr: { street: "77 Northbay Parkway", city: "Kestrel Harbor" },
  };
  const R = org.root;
  const acc = {
    "a1c-0922": "NB25-265-4471",
    "cmp-0922": "NB25-265-4471",
    "lipid-0922": "NB25-265-4471",
    "a1c-1209": "NB25-343-1180",
    "a1c-0615": "NB26-166-0932",
    "bmp-0615": "NB26-166-0932",
  };
  const tests = {
    "a1c-0922": "A1C",
    "cmp-0922": "CMP",
    "lipid-0922": "LIPID",
    "a1c-1209": "A1C",
    "a1c-0615": "A1C",
    "bmp-0615": "BMP",
  };
  const rt = resultsTable(
    `${R}.5`,
    [...RESULTS_FERNHILL, ...RESULTS_JUNE],
    (p, o, pi, oi) =>
      o
        ? `${acc[p.key]}-${tests[p.key]}-${oi + 1}`
        : `${acc[p.key]}-${tests[p.key]}`,
    "r",
    "<paragraph>Ordering provider: Elena Marsh, MD, Fernhill Family Clinic. All tests performed at Northbay Clinical Laboratories, Kestrel Harbor, WA.</paragraph>",
  );
  const res = sec("results", "Results", rt.text, rt.entries);
  write(
    "northbay-clinical-laboratories-results.xml",
    header({
      org,
      docId: "NBL-6604918-20260618",
      title: "Northbay Clinical Laboratories Patient Results Summary",
      time: "20260618141022+0000",
      patient: { root: `${R}.2`, ext: "6604918" },
      author: {
        id: "NBL-PORTAL",
        device: { model: "Northbay LIS", software: "Northbay Patient Results" },
      },
      serviceLow: "20250922",
      serviceHigh: "20260618",
      sections: [
        empty("allergies", "Allergies", "No information"),
        empty("meds", "Medications", "No information"),
        empty("problems", "Problems", "No information"),
        res,
      ],
    }),
  );
}

// ====================================================================================================
// Alder Street Pharmacy, patient record (downloaded 2026-07-14)
{
  const org = {
    root: "2.16.840.1.113883.19.5.4",
    name: "Alder Street Pharmacy",
    tel: "555-0215",
    addr: { street: "21 Alder Street", city: "Fernhill" },
  };
  const R = org.root;
  const al = sec(
    "allergies",
    "Allergies",
    table(
      ["Substance", "Reaction", "Status"],
      [
        {
          id: "ALRG1",
          cells: [
            { id: "ALRG1-S", text: "Aspirin" },
            { id: "ALRG1-R", text: "Hives" },
            "Active",
          ],
        },
      ],
    ),
    [
      allergy({
        root: `${R}.4`,
        act: "ASP-AC-58821-1",
        obs: "ASP-A-58821-1",
        rxn: "ASP-AR-58821-1",
        actLow: "20250923",
        obsLow: "2016",
        type: DRUG_ALLERGY,
        rx: ASPIRIN,
        textRef: "ALRG1",
        subRef: "ALRG1-S",
        rxnRef: "ALRG1-R",
        reaction: HIVES,
      }),
    ],
  );
  const meds = [
    {
      id: "RX6120443",
      status: "active",
      low: "20250923",
      drug: DRUG.losartan,
      name: "losartan potassium 50 MG Oral Tablet",
      sig: "Take 1 tablet by mouth once daily",
      fill: "June 28, 2026 (90 days)",
      by: "Elena Marsh, MD",
    },
    {
      id: "RX6120444",
      status: "active",
      low: "20250923",
      drug: DRUG.metformin,
      name: "metformin ER 500 MG 24 HR Tablet",
      sig: "Take 1 tablet by mouth once daily with the evening meal",
      fill: "June 28, 2026 (90 days)",
      by: "Elena Marsh, MD",
    },
    {
      id: "RX6120502",
      status: "active",
      low: "20250927",
      drug: DRUG.amlodipine,
      name: "amlodipine 5 MG Oral Tablet",
      sig: "Take 1 tablet by mouth once daily",
      fill: "June 28, 2026 (90 days)",
      by: "Elena Marsh, MD",
    },
    {
      id: "RX6127718",
      status: "completed",
      low: "20251018",
      high: "20251101",
      drug: DRUG.tamsulosin,
      name: "tamsulosin 0.4 MG Oral Capsule",
      sig: "Take 1 capsule by mouth once daily for 14 days",
      fill: "October 18, 2025 (14 days), no refills",
      by: "Malik Osei, MD",
    },
    {
      id: "RX6131090",
      status: "active",
      low: "20251210",
      drug: DRUG.hctz,
      name: "hydrochlorothiazide 12.5 MG Oral Capsule",
      sig: "Take 1 capsule by mouth once daily",
      fill: "April 2, 2026 (90 days), 2 refills remaining",
      by: "Elena Marsh, MD",
    },
  ];
  const md = sec(
    "meds",
    "Medications",
    table(
      [
        "Medication",
        "Directions",
        "First filled",
        "Last filled",
        "Prescriber",
        "Status",
      ],
      meds.map((m, i) => ({
        id: `RXL${i + 1}`,
        cells: [
          { id: `RXL${i + 1}-N`, text: m.name },
          m.sig,
          human(m.low),
          m.fill,
          m.by,
          m.status === "active" ? "Active" : "Inactive",
        ],
      })),
    ),
    meds.map((m, i) =>
      medication({
        root: `${R}.5`,
        mood: "EVN",
        periodH: 24,
        ...m,
        textRef: `RXL${i + 1}`,
        nameRef: `RXL${i + 1}-N`,
      }),
    ),
  );
  const pharmacist = {
    root: `${R}.3`,
    ext: "OYELARAN-RPH",
    given: "Grace",
    family: "Oyelaran",
    suffix: "PharmD",
  };
  const vaccines = [
    {
      id: "VX-251108-1",
      cvx: {
        code: "140",
        dn: "Influenza, seasonal, injectable, preservative free",
      },
      name: "Influenza vaccine, trivalent, preservative free (Fluarix)",
      lot: "FL7K2A",
      site: { code: "368208006", dn: "Left upper arm structure" },
      dose: "0.5",
    },
    {
      id: "VX-251108-2",
      cvx: { code: "187", dn: "zoster vaccine recombinant" },
      name: "Zoster vaccine recombinant, adjuvanted (Shingrix)",
      lot: "7T5K9",
      site: { code: "368209003", dn: "Right upper arm structure" },
      dose: "0.5",
    },
    {
      id: "VX-251108-3",
      cvx: {
        code: "216",
        dn: "Pneumococcal conjugate PCV20, polysaccharide CRM197 conjugate, adjuvant, PF",
      },
      name: "Pneumococcal 20-valent conjugate vaccine (Prevnar 20)",
      lot: "LR4417",
      site: { code: "368208006", dn: "Left upper arm structure" },
      dose: "0.5",
    },
  ];
  const im = sec(
    "imms",
    "Immunizations",
    table(
      ["Vaccine", "Date", "Lot", "Site", "Administered by"],
      vaccines.map((v, i) => ({
        id: `IMM${i + 1}`,
        cells: [
          { id: `IMM${i + 1}-N`, text: v.name },
          "November 8, 2025",
          v.lot,
          v.site.dn.replace(" structure", ""),
          "Grace Oyelaran, PharmD",
        ],
      })),
    ),
    vaccines.map((v, i) =>
      immunization({
        root: `${R}.7`,
        id: v.id,
        date: "20251108",
        cvx: v.cvx,
        textRef: `IMM${i + 1}`,
        nameRef: `IMM${i + 1}-N`,
        lot: v.lot,
        im: true,
        site: v.site,
        doseMl: v.dose,
        performer: pharmacist,
      }),
    ),
  );
  write(
    "alder-street-pharmacy-patient-record.xml",
    header({
      org,
      docId: "ASP-58821-20260714",
      title: "Alder Street Pharmacy Patient Record",
      time: "20260714164508+0000",
      patient: { root: `${R}.2`, ext: "58821" },
      author: {
        id: "ASP-RX-SYSTEM",
        device: {
          model: "Alder Street Pharmacy System",
          software: "Alder Street Pharmacy Online",
        },
      },
      serviceLow: "20250923",
      serviceHigh: "20260714",
      sections: [
        al,
        md,
        empty("problems", "Problems", "No information"),
        im,
        empty("results", "Results", "No information"),
      ],
    }),
  );
}
