// node generate.mjs <downloads> <priya-natarajan downloads>: writes Priya's downloads, 2022-2026.
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
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
  code,
  allergy,
  medication,
  problem,
  immunization,
  procedure,
  organizer,
  bp,
  smoking,
} from "../generators/ccda.mjs";
import { AN, RANGE, KH_DRAWS, NB_DRAWS } from "./data.mjs";
import { writeApple } from "./apple.mjs";

const OUT = argv[2];
const ROUND1 = argv[3]; // priya-natarajan's downloads, for the two documents that are unchanged
mkdirSync(OUT, { recursive: true });
const write = (name, xml) =>
  writeFileSync(join(OUT, name), xml.replace(/\r\n/g, "\n"));

export const DRUG = {
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
  atorvastatin: { code: "617310", dn: "atorvastatin 20 MG Oral Tablet" },
  spironolactone: { code: "313096", dn: "spironolactone 25 MG Oral Tablet" },
  tamsulosin: {
    code: "863669",
    dn: "tamsulosin hydrochloride 0.4 MG Oral Capsule",
  },
  ondansetron: {
    code: "104894",
    dn: "ondansetron 4 MG Disintegrating Oral Tablet",
  },
  claritin: { code: "206805", dn: "loratadine 10 MG Oral Tablet [Claritin]" },
  fluticasone: {
    code: "1797907",
    dn: "fluticasone propionate 0.05 MG/ACTUAT Metered Dose Nasal Spray",
  },
};
const ASPIRIN = { code: "1191", dn: "aspirin" };
const DRUG_ALLERGY = { code: "416098002", dn: "Allergy to drug" };
const INTOL = { code: "59037007", dn: "Drug intolerance" };
const HIVES = { code: "126485001", dn: "Urticaria" };

const human = (ts) => {
  const d = new Date(
    Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8) || 1),
  );
  const m = d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return ts.length <= 6
    ? `${m} ${d.getUTCFullYear()}`
    : `${m} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};
const humanTime = (ts) =>
  ts.length > 8
    ? `${human(ts)} ${ts.slice(8, 10)}:${ts.slice(10, 12)} UTC`
    : human(ts);
const before = (ts, d) => ts.slice(0, 8) < d.slice(0, 8);

// ---------- results ----------
const KH_UNIT = { na: "mmol/l", k: "mmol/l", cl: "mmol/l", co2: "mmol/l" };
function toObs(lab, o) {
  const a = AN[o.an];
  const unit = lab === "KH" && KH_UNIT[o.an] ? KH_UNIT[o.an] : a.unit;
  const [lo, hi] = RANGE[lab]?.[o.an] ?? [];
  return {
    key: o.an,
    loinc: a.loinc,
    name: a.name,
    v: { PQ: [o.v, unit] },
    interp: o.interp,
    lo: lo === undefined ? undefined : String(lo),
    hi: hi === undefined ? undefined : String(hi),
  };
}
const range = (o) => {
  const u = o.v.PQ ? o.v.PQ[1] : "";
  if (o.rangeText) return o.rangeText;
  if (o.lo !== undefined && o.hi !== undefined) return `${o.lo}-${o.hi} ${u}`;
  if (o.hi !== undefined) return `<${+o.hi + 1} ${u}`;
  if (o.lo !== undefined) return `>=${o.lo} ${u}`;
  return "";
};
const shown = (o) => (o.v.PQ ? `${o.v.PQ[0]} ${o.v.PQ[1]}` : o.v.ST);
const flag = (o) =>
  ({ H: " (High)", L: " (Low)", A: " (Abnormal)", N: "" })[o.interp ?? "N"];

// panels: [{panel, time, key, obs:[...toObs]}]
function resultsTable(
  root,
  panels,
  idOf,
  prefix,
  after = "",
  performer = null,
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
          range(o),
          humanTime(p.time),
          ...(performer ? [performer(p)] : []),
        ],
      });
      return { ...o, id: idOf(p, o, oi), textRef: rid };
    });
    return organizer({
      root,
      id: idOf(p, null),
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
    ...(performer ? ["Performed by"] : []),
  ];
  return { text: table(head, rows, after), entries };
}
function resultsList(root, panels, idOf, prefix, note = () => "") {
  const items = [];
  const entries = panels.map((p, pi) => {
    const obs = p.obs.map((o, oi) => {
      const rid = `${prefix}${pi + 1}-${oi + 1}`;
      items.push({
        id: rid,
        html: `${esc(o.name)} ${esc(shown(o))}${esc(flag(o))}, reference ${esc(range(o))}, collected ${esc(human(p.time))}${esc(note(p))}`,
      });
      return { ...o, id: idOf(p, o, oi), textRef: rid };
    });
    return organizer({
      root,
      id: idOf(p, null),
      panel: p.panel,
      time: p.time,
      obs,
    });
  });
  return { text: list(items), entries };
}
const panelsOf = (draws, lab, D) =>
  draws
    .filter((d) => before(d.time, D))
    .reverse()
    .flatMap((d) =>
      d.panels.map((p) => ({
        panel: p.panel,
        time: d.time,
        key: p.key,
        acc: d.acc,
        obs: p.obs.map((o) => toObs(lab, o)),
      })),
    );

// a plan section that also carries coded planned items
function planSection(textXml, entries) {
  return `<component>
  <section>
    <templateId root="2.16.840.1.113883.10.20.22.2.10"/>
    <templateId root="2.16.840.1.113883.10.20.22.2.10" extension="2014-06-09"/>
    <code code="18776-5" displayName="Plan of care note" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC"/>
    <title>Plan of Treatment</title>
${textXml
  .split("\n")
  .map((l) => "    " + l)
  .join("\n")}
${entries
  .map(
    (e) =>
      `    <entry>\n${e
        .split("\n")
        .map((l) => "      " + l)
        .join("\n")}\n    </entry>`,
  )
  .join("\n")}
  </section>
</component>`;
}
const plannedObs = ({
  root,
  id,
  loinc,
  low,
  high,
  textRef,
}) => `<observation classCode="OBS" moodCode="RQO">
  <templateId root="2.16.840.1.113883.10.20.22.4.44"/>
  <templateId root="2.16.840.1.113883.10.20.22.4.44" extension="2014-06-09"/>
  <id root="${root}" extension="${id}"/>
  ${code("code", { ...loinc, sys: "loinc" })}
  <text>
    <reference value="#${textRef}"/>
  </text>
  <statusCode code="active"/>
  <effectiveTime>
    <low value="${low}"/>
    <high value="${high}"/>
  </effectiveTime>
</observation>`;

function vitalsTable(R, prefix, rows, idRoot) {
  const body = rows
    .map(
      (v, i) =>
        `      <tr>\n        <td>${esc(humanTime(v.time))}</td>\n        <td><content ID="${prefix}${i + 1}-S">${v.sys}</content>/<content ID="${prefix}${i + 1}-D">${v.dia}</content> mm[Hg]</td>\n      </tr>`,
    )
    .join("\n");
  const text = table(["Taken", "Blood pressure"], []).replace(
    "<tbody>\n\n    </tbody>",
    `<tbody>\n${body}\n    </tbody>`,
  );
  return sec(
    "vitals",
    "Vital Signs",
    text,
    rows.map((v, i) =>
      bp({
        root: idRoot,
        id: v.id,
        time: v.time,
        sys: v.sys,
        dia: v.dia,
        ids: [`${v.id}1`, `${v.id}2`],
        refs: [`${prefix}${i + 1}-S`, `${prefix}${i + 1}-D`],
      }),
    ),
  );
}

// ====================================================================================================
// Kestrel Harbor Hospital (Kestrel Harbor Internal Medicine was her primary care to June 2025)
const KH_ORG = {
  root: "2.16.840.1.113883.19.5.1",
  name: "Kestrel Harbor Hospital",
  tel: "555-0100",
  addr: { street: "1200 Harbor Way", city: "Kestrel Harbor" },
};
const KH_VISITS = [
  {
    time: "20200114160000+0000",
    what: "Office visit, annual physical",
    where: "Kestrel Harbor Internal Medicine",
    who: "Susan Park, MD",
    dx: "Routine adult health examination; prediabetes",
    bp: [132, 84],
    id: "VS-4120",
    note: "Annual physical. Fasting glucose 104 and hemoglobin A1c 5.8%: prediabetes. Diet and activity counselling. LDL 131. Tdap given. Screening mammogram ordered.",
  },
  {
    time: "20210119160000+0000",
    what: "Office visit, annual physical",
    where: "Kestrel Harbor Internal Medicine",
    who: "Susan Park, MD",
    dx: "Routine adult health examination; prediabetes",
    bp: [134, 86],
    id: "VS-4733",
    note: "Annual physical. A1c 5.9%. LDL 137. Ten-year cardiovascular risk low; no statin. Continue lifestyle measures.",
  },
  {
    time: "20220125153000+0000",
    what: "Office visit, annual physical",
    where: "Kestrel Harbor Internal Medicine",
    who: "Susan Park, MD",
    dx: "Routine adult health examination; prediabetes; elevated LDL",
    bp: [136, 86],
    id: "VS-5390",
    note: "Annual physical. LDL 148, A1c 6.0%. Discussed a statin; she prefers to work on diet for six months first. Repeat lipids in 6 months.",
  },
  {
    time: "20220809152000+0000",
    what: "Office visit, follow-up",
    where: "Kestrel Harbor Internal Medicine",
    who: "Susan Park, MD",
    dx: "Hyperlipidemia; prediabetes",
    bp: [138, 88],
    id: "VS-5710",
    note: "LDL 168 after six months of diet changes. Start atorvastatin 20 mg daily. Recheck lipids and liver tests in 3 months.",
  },
  {
    time: "20221115160000+0000",
    what: "Office visit, follow-up",
    where: "Kestrel Harbor Internal Medicine",
    who: "Susan Park, MD",
    dx: "Hyperlipidemia",
    bp: [136, 84],
    id: "VS-5904",
    note: "LDL 93 on atorvastatin 20 mg. ALT 31, normal. Tolerating well. Continue. Annual visit in the new year.",
  },
  {
    time: "20230615161000+0000",
    what: "Office visit, annual physical",
    where: "Kestrel Harbor Internal Medicine",
    who: "Susan Park, MD",
    dx: "Essential hypertension; hyperlipidemia; prediabetes",
    bp: [152, 96],
    id: "VS-6618",
    note: "Blood pressure 152/96 today and 148/94 at the May nurse check; home readings similar: essential hypertension. Start lisinopril 10 mg daily; BMP in 3 weeks. Urine albumin/creatinine ratio 18 mg/g. LDL 99 on atorvastatin. A1c 6.1%.",
  },
  {
    time: "20231114163000+0000",
    what: "Office visit",
    where: "Kestrel Harbor Internal Medicine",
    who: "Susan Park, MD",
    dx: "Myalgia, statin-related",
    bp: [130, 82],
    id: "VS-7046",
    note: "Aching in the thighs and shoulders for about two months. CK 148, normal. Likely statin-related muscle symptoms: stop atorvastatin. Reassess in 4-6 weeks.",
  },
  {
    time: "20240123154000+0000",
    what: "Office visit, follow-up",
    where: "Kestrel Harbor Internal Medicine",
    who: "Susan Park, MD",
    dx: "Essential hypertension; prediabetes",
    bp: [132, 82],
    id: "VS-7213",
    note: "Muscle aches resolved off atorvastatin. Blood pressure at goal on lisinopril; potassium 4.4. A1c 6.3%. Discuss a different statin at the annual visit.",
  },
  {
    time: "20240820152500+0000",
    what: "Office visit, annual physical",
    where: "Kestrel Harbor Internal Medicine",
    who: "Susan Park, MD",
    dx: "Routine adult health examination; hyperlipidemia; prediabetes; subclinical hypothyroidism",
    bp: [134, 84],
    id: "VS-7690",
    note: "Annual physical. LDL 158 off statin. She would like to keep working on diet before trying another statin. A1c 6.4%. TSH 4.60 with normal free T4: repeat with next year's labs.",
  },
  {
    time: "20250327114000+0000",
    what: "Office visit, follow-up",
    where: "Kestrel Harbor Internal Medicine",
    who: "Susan Park, MD",
    dx: "Essential hypertension",
    bp: [148, 92],
    id: "VS-7700",
    note: "Blood pressure 148/92 on lisinopril 10 mg. Send home readings for one week. Potassium 4.1.",
  },
  {
    time: "20250610133000+0000",
    what: "Office visit, follow-up",
    where: "Kestrel Harbor Internal Medicine",
    who: "Susan Park, MD",
    dx: "Essential hypertension",
    bp: [130, 80],
    id: "VS-8012",
    note: "Home readings averaged 146/90; amlodipine 5 mg was started April 1. Blood pressure 130/80 today. Potassium 4.4. She is moving her primary care to Fernhill Family Clinic, closer to home.",
  },
];
const KH_ADMIT = {
  time: "20260302185500+0000",
  what: "Inpatient admission",
  when: "March 2, 2026 - March 5, 2026",
  where: "Kestrel Harbor Hospital, Internal Medicine",
  who: "Rahul Venkat, MD",
  dx: "Hyponatremia, likely due to hydrochlorothiazide; dizziness with a fall at home, no injury",
};
const KH_IMMS = [
  {
    id: "IMM-30117",
    date: "20200114",
    cvx: { code: "115", dn: "Tdap" },
    name: "Tdap vaccine (Boostrix)",
  },
  {
    id: "IMM-31402",
    date: "20201006",
    cvx: {
      code: "150",
      dn: "Influenza, injectable, quadrivalent, preservative free",
    },
    name: "Influenza vaccine, quadrivalent",
  },
  {
    id: "IMM-32088",
    date: "20210402",
    cvx: { code: "208", dn: "COVID-19, mRNA, LNP-S, PF, 30 mcg/0.3 mL dose" },
    name: "COVID-19 vaccine, mRNA (Pfizer-BioNTech), dose 1",
  },
  {
    id: "IMM-32241",
    date: "20210423",
    cvx: { code: "208", dn: "COVID-19, mRNA, LNP-S, PF, 30 mcg/0.3 mL dose" },
    name: "COVID-19 vaccine, mRNA (Pfizer-BioNTech), dose 2",
  },
  {
    id: "IMM-33590",
    date: "20211012",
    cvx: {
      code: "150",
      dn: "Influenza, injectable, quadrivalent, preservative free",
    },
    name: "Influenza vaccine, quadrivalent",
  },
  {
    id: "IMM-33812",
    date: "20211109",
    cvx: { code: "208", dn: "COVID-19, mRNA, LNP-S, PF, 30 mcg/0.3 mL dose" },
    name: "COVID-19 vaccine, mRNA (Pfizer-BioNTech), booster",
  },
  {
    id: "IMM-35904",
    date: "20221011",
    cvx: {
      code: "150",
      dn: "Influenza, injectable, quadrivalent, preservative free",
    },
    name: "Influenza vaccine, quadrivalent",
  },
  {
    id: "IMM-35905",
    date: "20221011",
    cvx: {
      code: "300",
      dn: "COVID-19, mRNA, LNP-S, bivalent, PF, 30 mcg/0.3 mL dose",
    },
    name: "COVID-19 vaccine, mRNA, bivalent (Pfizer-BioNTech)",
  },
  {
    id: "IMM-38017",
    date: "20231017",
    cvx: {
      code: "150",
      dn: "Influenza, injectable, quadrivalent, preservative free",
    },
    name: "Influenza vaccine, quadrivalent",
  },
];
const KH_PROCS = [
  {
    id: "PROC-1907",
    date: "20190416",
    code: { code: "73761001", dn: "Colonoscopy", sys: "snomed" },
    name: "Colonoscopy",
    where: "Kestrel Harbor Hospital Endoscopy",
    result:
      "Screening colonoscopy to the cecum, good preparation. Normal colon; no polyps. Repeat colonoscopy in 10 years.",
  },
  {
    id: "PROC-2210",
    date: "20201006",
    code: { code: "24623002", dn: "Screening mammography", sys: "snomed" },
    name: "Screening mammogram, bilateral",
    where: "Kestrel Harbor Breast Imaging",
    result: "BI-RADS 1: negative. Scattered fibroglandular density.",
  },
  {
    id: "PROC-2611",
    date: "20221011",
    code: { code: "24623002", dn: "Screening mammography", sys: "snomed" },
    name: "Screening mammogram, bilateral",
    where: "Kestrel Harbor Breast Imaging",
    result: "BI-RADS 1: negative. Scattered fibroglandular density.",
  },
  {
    id: "PROC-3187",
    date: "20241008",
    code: { code: "24623002", dn: "Screening mammography", sys: "snomed" },
    name: "Screening mammogram, bilateral",
    where: "Kestrel Harbor Breast Imaging",
    result:
      "BI-RADS 2: benign. Stable benign-appearing calcifications, left breast. Routine screening.",
  },
];
const KH_ADMIT_VITALS = [
  { id: "VS-9120", time: "20260302185500+0000", sys: 104, dia: 62 },
  { id: "VS-9180", time: "20260305081000+0000", sys: 126, dia: 78 },
];

function kestrel(D, docTime) {
  const R = KH_ORG.root;
  const after = (d) => !before(D, d); // D >= d
  const admitted = after("20260310");
  // allergies
  const alRows = [
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
  ];
  const alEntries = [
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
  ];
  if (after("20231114")) {
    alRows.push({
      id: "ALG-02",
      cells: [
        { id: "ALG-02-SUB", text: "Atorvastatin" },
        { id: "ALG-02-RXN", text: "Muscle aches (intolerance)" },
        "Low",
        "Active",
        "November 2023",
      ],
    });
    alEntries.push(
      allergy({
        root: `${R}.3`,
        act: "ALGC-1377",
        obs: "ALG-1377",
        rxn: "ALGR-1377",
        actLow: "20231114163000+0000",
        obsLow: "202309",
        type: INTOL,
        rx: { code: "83367", dn: "atorvastatin" },
        textRef: "ALG-02",
        subRef: "ALG-02-SUB",
        rxnRef: "ALG-02-RXN",
        reaction: { code: "68962001", dn: "Muscle pain" },
        statusActive: true,
      }),
    );
  }
  const al = sec(
    "allergies",
    "Allergies",
    table(["Substance", "Reaction", "Criticality", "Status", "Noted"], alRows),
    alEntries,
  );
  // medications
  const meds = [];
  if (admitted) {
    meds.push({
      id: "MED-2604",
      status: "active",
      low: "20250922",
      drug: DRUG.losartan,
      name: "losartan potassium 50 MG Oral Tablet",
      instr: "Take 1 tablet by mouth once daily.",
      start: "September 22, 2025",
      st: "Active",
    });
    meds.push({
      id: "MED-2605",
      status: "active",
      low: "20250922",
      drug: DRUG.metformin,
      name: "metformin hydrochloride 500 MG 24 HR Extended Release Oral Tablet",
      instr: "Take 1 tablet by mouth once daily with the evening meal.",
      start: "September 22, 2025",
      st: "Active",
    });
  }
  if (after("20250401"))
    meds.push({
      id: "MED-2391",
      status: "active",
      low: "20250401",
      drug: DRUG.amlodipine,
      name: "amlodipine 5 MG Oral Tablet",
      instr: "Take 1 tablet by mouth once daily.",
      start: "April 1, 2025",
      st: "Active",
    });
  if (admitted)
    meds.push({
      id: "MED-2611",
      status: "aborted",
      low: "20251209",
      high: "20260305",
      drug: DRUG.hctz,
      name: "hydrochlorothiazide 12.5 MG Oral Capsule",
      instr: "STOP taking this medicine.",
      start: "December 9, 2025",
      st: "Discontinued March 5, 2026 (hyponatremia)",
    });
  if (after("20230615"))
    meds.push(
      admitted
        ? {
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
          }
        : {
            id: "MED-2207",
            status: "active",
            low: "20230615",
            drug: DRUG.lisinoprilKH,
            translation: DRUG.lisinopril,
            name: "lisinopril 10 MG Oral Tablet",
            instr: "Take 1 tablet by mouth once daily.",
            start: "June 15, 2023",
            st: "Active",
          },
    );
  if (after("20220809"))
    meds.push(
      after("20231114")
        ? {
            id: "MED-1874",
            status: "aborted",
            low: "20220809",
            high: "20231114",
            drug: DRUG.atorvastatin,
            name: "atorvastatin 20 MG Oral Tablet",
            instr: "Take 1 tablet by mouth once daily.",
            start: "August 9, 2022",
            st: "Discontinued November 14, 2023 (muscle aches)",
          }
        : {
            id: "MED-1874",
            status: "active",
            low: "20220809",
            drug: DRUG.atorvastatin,
            name: "atorvastatin 20 MG Oral Tablet",
            instr: "Take 1 tablet by mouth once daily.",
            start: "August 9, 2022",
            st: "Active",
          },
    );
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
  // problems
  const probs = [];
  probs.push(
    admitted
      ? {
          row: [
            "Prediabetes",
            "January 14, 2020",
            "Resolved March 2, 2026 (now type 2 diabetes)",
          ],
          p: {
            act: "PRBC-2810",
            obs: "PRB-2810",
            actStatus: "completed",
            actLow: "20200114",
            actHigh: "20260302",
            obsLow: "20200114",
            obsHigh: "20250922",
            value: { code: "714628002", dn: "Prediabetes", sys: "snomed" },
            problemStatus: "resolved",
          },
        }
      : {
          row: ["Prediabetes", "January 14, 2020", "Active"],
          p: {
            act: "PRBC-2810",
            obs: "PRB-2810",
            actLow: "20200114",
            obsLow: "20200114",
            value: { code: "714628002", dn: "Prediabetes", sys: "snomed" },
          },
        },
  );
  if (after("20220809"))
    probs.push({
      row: ["Hyperlipidemia", "August 9, 2022", "Active"],
      p: {
        act: "PRBC-3044",
        obs: "PRB-3044",
        actLow: "20220809",
        obsLow: "20220809",
        value: { code: "55822004", dn: "Hyperlipidemia", sys: "snomed" },
      },
    });
  if (after("20230615"))
    probs.push({
      row: ["Essential hypertension", "June 15, 2023", "Active"],
      p: {
        act: "PRBC-3310",
        obs: "PRB-3310",
        actLow: "20230615",
        obsLow: "20230615",
        value: {
          code: "59621000",
          dn: "Essential hypertension",
          sys: "snomed",
        },
      },
    });
  if (admitted) {
    probs.push({
      row: ["Type 2 diabetes mellitus", "September 22, 2025", "Active"],
      p: {
        act: "PRBC-3502",
        obs: "PRB-3502",
        actLow: "20260302",
        obsLow: "20250922",
        value: {
          code: "44054006",
          dn: "Diabetes mellitus type 2",
          sys: "snomed",
        },
      },
    });
    probs.push({
      row: ["Hyponatremia", "March 2, 2026", "Resolved March 5, 2026"],
      p: {
        act: "PRBC-3519",
        obs: "PRB-3519",
        actStatus: "completed",
        actLow: "20260302",
        actHigh: "20260305",
        obsLow: "20260302",
        obsHigh: "20260305",
        value: { code: "89627008", dn: "Hyponatremia", sys: "snomed" },
        problemStatus: "resolved",
      },
    });
  }
  const pr = sec(
    "problems",
    "Problems",
    table(
      ["Problem", "Onset", "Status"],
      probs.map((x, i) => ({
        id: `PRB-0${i + 1}`,
        cells: [
          { id: `PRB-0${i + 1}-NAME`, text: x.row[0] },
          x.row[1],
          x.row[2],
        ],
      })),
    ),
    probs.map((x, i) =>
      problem({
        root: `${R}.6`,
        ...x.p,
        textRef: `PRB-0${i + 1}`,
        nameRef: `PRB-0${i + 1}-NAME`,
      }),
    ),
  );
  // procedures
  const procs = KH_PROCS.filter((p) => after(p.date));
  const pc = sec(
    "procs",
    "Procedures",
    table(
      ["Procedure", "Date", "Location", "Result"],
      procs.map((p, i) => ({
        id: `PRC-0${i + 1}`,
        cells: [
          { id: `PRC-0${i + 1}-NAME`, text: p.name },
          human(p.date),
          p.where,
          p.result,
        ],
      })),
    ),
    procs.map((p, i) =>
      procedure({
        root: `${R}.10`,
        id: p.id,
        code: p.code,
        date: p.date,
        textRef: `PRC-0${i + 1}`,
        nameRef: `PRC-0${i + 1}-NAME`,
      }),
    ),
  );
  // immunizations
  const imms = KH_IMMS.filter((x) => after(x.date)).reverse();
  const im = sec(
    "imms",
    "Immunizations",
    table(
      ["Vaccine", "Date", "Status"],
      imms.map((x, i) => ({
        id: `IMM-0${i + 1}`,
        cells: [
          { id: `IMM-0${i + 1}-NAME`, text: x.name },
          human(x.date),
          "Completed",
        ],
      })),
    ),
    imms.map((x, i) =>
      immunization({
        root: `${R}.11`,
        id: x.id,
        date: x.date,
        cvx: x.cvx,
        textRef: `IMM-0${i + 1}`,
        nameRef: `IMM-0${i + 1}-NAME`,
        im: true,
        doseMl: x.cvx.code === "208" || x.cvx.code === "300" ? "0.3" : "0.5",
      }),
    ),
  );
  // results: every KH draw before D, newest first
  let n = 0;
  const ids = new Map();
  for (const d of KH_DRAWS)
    d.panels.forEach((p) => {
      ids.set(p.key, 40000 + n * 20);
      n++;
    });
  const rt = resultsTable(
    `${R}.5`,
    panelsOf(KH_DRAWS, "KH", D),
    (p, o, oi) =>
      o ? `LAB-${ids.get(p.key) + oi + 1}` : `LABP-${ids.get(p.key)}`,
    "RES-",
  );
  const res = sec("results", "Results", rt.text, rt.entries);
  // vitals
  const vrows = KH_VISITS.filter((v) => before(v.time, D))
    .map((v) => ({ id: v.id, time: v.time, sys: v.bp[0], dia: v.bp[1] }))
    .concat(admitted ? KH_ADMIT_VITALS : [])
    .reverse();
  const vs = vitalsTable(R, "VS-", vrows, `${R}.7`);
  const sh = sec(
    "social",
    "Social History",
    table(
      ["Smoking status", "Recorded"],
      [{ id: "SOC-01", cells: ["Never smoker", "January 14, 2020"] }],
    ),
    [
      smoking({
        root: `${R}.7`,
        id: "SH-4120",
        time: "20200114160000+0000",
        textRef: "SOC-01",
      }),
    ],
  );
  const visits = KH_VISITS.filter((v) => before(v.time, D));
  const encRows = [
    ...(admitted
      ? [
          {
            id: "ENC-00",
            cells: [
              KH_ADMIT.what,
              KH_ADMIT.when,
              KH_ADMIT.where,
              KH_ADMIT.who,
              KH_ADMIT.dx,
              "See discharge instructions.",
            ],
          },
        ]
      : []),
    ...visits
      .slice()
      .reverse()
      .map((v, i) => ({
        id: `ENC-${String(i + 1).padStart(2, "0")}`,
        cells: [v.what, human(v.time), v.where, v.who, v.dx, v.note],
      })),
  ];
  const enc = encounters(
    table(
      [
        "Encounter",
        "Date",
        "Department",
        "Provider",
        "Diagnosis",
        "Visit summary",
      ],
      encRows,
    ),
  );
  let pl;
  if (admitted) {
    pl = planSection(
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
          "Your thyroid test (TSH) was high during your stay. Please have TSH and free T4 repeated in 6-8 weeks, once you have recovered.",
        ),
        `<list>\n  <item ID="PLN-01">TSH, due April 14, 2026 - April 28, 2026</item>\n  <item ID="PLN-02">Free T4, due April 14, 2026 - April 28, 2026</item>\n</list>`,
      ]),
      [
        plannedObs({
          root: `${R}.12`,
          id: "ORD-77104",
          loinc: AN.tsh.loinc,
          low: "20260414",
          high: "20260428",
          textRef: "PLN-01",
        }),
        plannedObs({
          root: `${R}.12`,
          id: "ORD-77105",
          loinc: AN.ft4.loinc,
          low: "20260414",
          high: "20260428",
          textRef: "PLN-02",
        }),
      ],
    );
  } else {
    const last = visits[visits.length - 1];
    const next =
      {
        20221128: "Annual physical due January 2023.",
        20240203: "Annual physical due August 2024.",
        20250403: "Follow-up in 2 months.",
      }[D] ?? "";
    pl = plan(
      paragraphs([
        para(
          `Most recent visit, ${human(last.time)} (${last.who}): ${last.note}`,
        ),
        para(next),
      ]),
    );
  }
  return header({
    org: KH_ORG,
    docId: `CCD-KH48213-${D}`,
    title: "Kestrel Harbor Hospital Health Summary",
    time: docTime,
    patient: { root: `${R}.2`, ext: "KH48213" },
    author: {
      id: "KH-EHR",
      device: {
        model: "Kestrel Harbor EHR",
        software: "Kestrel Harbor Patient Portal",
      },
    },
    serviceLow: "20160822",
    serviceHigh: D,
    sections: [al, md, pr, pc, im, res, vs, sh, enc, pl],
  }).replace(
    `<id root="${R}.3" extension="KH-EHR"/>`,
    `<id root="${R}.8" extension="KH-EHR"/>`,
  );
}

// ====================================================================================================
// Fernhill Family Clinic (first visit October 2024; her primary care from September 2025)
const FH_ORG = {
  root: "2.16.840.1.113883.19.5.2",
  name: "Fernhill Family Clinic",
  tel: "555-0190",
  addr: { street: "310 Fern Street", city: "Fernhill" },
};
const FH_VISITS = [
  {
    time: "20241015160000+0000",
    bp: [130, 82],
    id: "V-1015",
    note: "October 15, 2024 (new patient visit, Elena Marsh, MD): Sneezing, itchy eyes and congestion every autumn: seasonal allergic rhinitis. Start fluticasone nasal spray; loratadine as needed. Influenza vaccine given. Primary care is at Kestrel Harbor Internal Medicine for now.",
  },
  {
    time: "20250922160000+0000",
    bp: [138, 86],
    id: "V-0922",
    note: "September 22, 2025 (annual visit, establishing primary care, Elena Marsh, MD): Fasting glucose 138 and hemoglobin A1c 6.9%: new diagnosis of type 2 diabetes. Start metformin ER 500 mg with the evening meal; referred to diabetes education. Dry cough for several months on lisinopril: stop lisinopril, start losartan 50 mg daily; BMP in 2 weeks. Continue amlodipine 5 mg. LDL 142.",
  },
  {
    time: "20251209163000+0000",
    bp: [142, 88],
    id: "V-1209",
    note: "December 9, 2025 (follow-up, Elena Marsh, MD): Cough resolved. Blood pressure 142/88, above goal. Add hydrochlorothiazide 12.5 mg daily; BMP in 3 weeks. A1c 6.7%. Return in 3 months.",
  },
  {
    time: "20260615152000+0000",
    bp: [128, 80],
    id: "V-0615",
    note: "June 15, 2026 (follow-up, Elena Marsh, MD): Blood pressure 128/80, at goal. A1c 6.6%. Sodium 134. Continue current medications. Return in 2 months for blood pressure.",
  },
  {
    time: "20260817151000+0000",
    bp: [148, 92],
    id: "V-0817",
    note: "August 17, 2026 (follow-up, Elena Marsh, MD): Blood pressure 148/92 and home readings 140s/90s on losartan 50 mg, amlodipine 5 mg and hydrochlorothiazide 12.5 mg. Add spironolactone 25 mg daily. BMP in 2 weeks. LDL 147. A1c due in October.",
  },
];
const FH_RESULT_NOTES = [
  {
    time: "20260902",
    note: "September 2, 2026 (result note, Elena Marsh, MD): Potassium 4.9, creatinine 0.97. Continue spironolactone. Repeat BMP in 4 weeks.",
  },
  {
    time: "20260930",
    note: "September 30, 2026 (result note, Elena Marsh, MD): Potassium 5.2, slightly high. Limit high-potassium foods and salt substitutes. Repeat BMP in 2 weeks.",
  },
];
// At the first primary-care visit Fernhill keyed the last thyroid result from her Kestrel Harbor records into its chart.
const FH_OUTSIDE = {
  key: "hx-tsh",
  time: "20250922",
  panels: [
    {
      panel: {
        code: "3016-3",
        dn: "Thyrotropin [Units/volume] in Serum or Plasma",
      },
      obs: [
        {
          key: "tsh",
          loinc: AN.tsh.loinc,
          name: "TSH",
          v: { PQ: ["4.60", "m[IU]/L"] },
          interp: "H",
          lo: "0.40",
          hi: "4.00",
        },
      ],
    },
  ],
};

function fernhill(D, docTime) {
  const R = FH_ORG.root;
  const after = (d) => !before(D, d);
  const established = after("20250922");
  const alItems = [
    { id: "fa-1", html: `${content("fa-1-name", "Aspirin")}: hives` },
  ];
  const alEntries = [
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
  ];
  if (established) {
    alItems.push({
      id: "fa-2",
      html: `${content("fa-2-name", "Lisinopril")}: dry cough (intolerance), September 2025`,
    });
    alEntries.push(
      allergy({
        root: `${R}.4`,
        act: "ALC-91",
        obs: "AL-91",
        rxn: "ALR-91",
        actLow: "20250922",
        obsLow: "20250922",
        type: INTOL,
        rx: { code: "29046", dn: "lisinopril" },
        textRef: "fa-2",
        subRef: "fa-2-name",
        reaction: { code: "49727002", dn: "Cough" },
        statusActive: true,
      }),
    );
  }
  const al = sec("allergies", "Allergies", list(alItems), alEntries);
  const meds = [
    {
      id: "FM-1001",
      status: "active",
      lowNull: "UNK",
      drug: DRUG.claritin,
      name: "Claritin 10 MG Oral Tablet",
      tail: "1 tablet daily as needed; start date not recorded",
    },
    after("20250801")
      ? {
          id: "FM-1002",
          status: "completed",
          low: "20241015",
          drug: DRUG.fluticasone,
          name: "fluticasone propionate 50 MCG/ACTUAT Nasal Spray",
          tail: "1 spray in each nostril daily, from October 15, 2024; completed",
          route: "nasal",
        }
      : {
          id: "FM-1002",
          status: "active",
          low: "20241015",
          drug: DRUG.fluticasone,
          name: "fluticasone propionate 50 MCG/ACTUAT Nasal Spray",
          tail: "1 spray in each nostril daily, from October 15, 2024",
          route: "nasal",
        },
  ];
  if (established)
    meds.push(
      {
        id: "FM-1150",
        status: "aborted",
        low: "20230615",
        high: "20250922",
        drug: DRUG.lisinopril,
        name: "lisinopril 10 MG Oral Tablet",
        tail: "1 tablet daily, from June 15, 2023; stopped September 22, 2025 because of dry cough, changed to losartan",
      },
      {
        id: "FM-1151",
        status: "active",
        low: "20250922",
        drug: DRUG.losartan,
        name: "losartan potassium 50 MG Oral Tablet",
        tail: "1 tablet daily, from September 22, 2025",
      },
      {
        id: "FM-1152",
        status: "active",
        low: "20250401",
        drug: DRUG.amlodipine,
        name: "amlodipine 5 MG Oral Tablet",
        tail: "1 tablet daily, from April 1, 2025",
      },
      {
        id: "FM-1153",
        status: "active",
        low: "20250922",
        drug: DRUG.metformin,
        name: "metformin ER 500 MG 24 HR Extended Release Oral Tablet",
        tail: "1 tablet daily with the evening meal, from September 22, 2025",
      },
    );
  if (after("20251209"))
    meds.push({
      id: "FM-1188",
      status: "active",
      low: "20251209",
      drug: DRUG.hctz,
      name: "hydrochlorothiazide 12.5 MG Oral Capsule",
      tail: "1 capsule daily, from December 9, 2025",
    });
  if (after("20260817"))
    meds.push({
      id: "FM-1240",
      status: "active",
      low: "20260817",
      drug: DRUG.spironolactone,
      name: "spironolactone 25 MG Oral Tablet",
      tail: "1 tablet daily, from August 17, 2026",
    });
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
        mood: "EVN",
        ...m,
        textRef: `fm-${i + 1}`,
        nameRef: `fm-${i + 1}-name`,
      }),
    ),
  );
  const probs = [
    {
      html: "Hay fever, since October 2024",
      name: "Hay fever",
      p: {
        act: "PC-410",
        obs: "P-410",
        actLow: "20241015",
        obsLow: "20241015",
        value: {
          code: "367498001",
          dn: "Seasonal allergic rhinitis",
          sys: "snomed",
        },
      },
    },
  ];
  if (established)
    probs.push(
      {
        name: "Essential hypertension",
        tail: ", since June 2023",
        p: {
          act: "PC-455",
          obs: "P-455",
          actLow: "20250922",
          obsLow: "20230615",
          value: {
            code: "59621000",
            dn: "Essential hypertension",
            sys: "snomed",
          },
        },
      },
      {
        name: "Type 2 diabetes mellitus",
        tail: ", since September 2025",
        p: {
          act: "PC-470",
          obs: "P-470",
          actLow: "20250922",
          obsLow: "20250922",
          value: {
            code: "44054006",
            dn: "Diabetes mellitus type 2",
            sys: "snomed",
          },
        },
      },
    );
  const pr = sec(
    "problems",
    "Problems",
    list(
      probs.map((x, i) => ({
        id: `fp-${i + 1}`,
        html: `${content(`fp-${i + 1}-name`, x.name)}${esc(x.tail ?? ", since October 2024")}`,
      })),
    ),
    probs.map((x, i) =>
      problem({
        root: `${R}.6`,
        ...x.p,
        textRef: `fp-${i + 1}`,
        nameRef: `fp-${i + 1}-name`,
      }),
    ),
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
  let res;
  const panels = panelsOf(NB_DRAWS, "NB", D);
  if (after("20250923")) {
    // the keyed-in outside result sits in date order among the clinic's own
    const outside = FH_OUTSIDE.panels.map((p) => ({
      ...p,
      time: FH_OUTSIDE.time,
      key: FH_OUTSIDE.key,
    }));
    const i = panels.findIndex((p) => p.time.slice(0, 8) < "20250922");
    panels.splice(i < 0 ? panels.length : i, 0, ...outside);
  }
  if (panels.length) {
    const rl = resultsList(
      `${R}.9`,
      panels,
      (p, o) => (o ? `LR-${p.key}-${o.key}` : `LRP-${p.key}`),
      "fr-",
      (p) =>
        p.key === FH_OUTSIDE.key
          ? " (historical result from Kestrel Harbor Hospital, entered September 22, 2025)"
          : "",
    );
    res = sec("results", "Results", rl.text, rl.entries);
  } else res = empty("results", "Results", "No results.");
  const visits = FH_VISITS.filter((v) => before(v.time, D));
  const vs = sec(
    "vitals",
    "Vital Signs",
    list(
      visits.map((v, i) => ({
        id: `fv-${i + 1}`,
        html: `${human(v.time)}: blood pressure ${content(`fv-${i + 1}-s`, String(v.bp[0]))}/${content(`fv-${i + 1}-d`, String(v.bp[1]))} mm[Hg]`,
      })),
    ),
    visits.map((v, i) =>
      bp({
        root: `${R}.7`,
        id: v.id,
        time: v.time,
        sys: v.bp[0],
        dia: v.bp[1],
        ids: [`${v.id}-1`, `${v.id}-2`],
        refs: [`fv-${i + 1}-s`, `fv-${i + 1}-d`],
      }),
    ),
  );
  const sh = sec(
    "social",
    "Social History",
    list([{ id: "fs-1", html: "Never smoker, recorded October 15, 2024" }]),
    [
      smoking({
        root: `${R}.8`,
        id: "S-1015",
        time: "20241015160000+0000",
        textRef: "fs-1",
      }),
    ],
  );
  const notes = [
    ...visits.map((v) => ({ t: v.time, n: v.note })),
    ...FH_RESULT_NOTES.filter((r) => before(r.time, D)).map((r) => ({
      t: r.time,
      n: r.note,
    })),
  ]
    .sort((a, b) => (a.t < b.t ? -1 : 1))
    .map((x) => para(x.n));
  const pl = plan(paragraphs(notes));
  return header({
    org: FH_ORG,
    docId: `FFC-CCD-${D.slice(4)}-20931`,
    title: "Fernhill Family Clinic Summary of Care",
    time: docTime,
    patient: { root: `${R}.2`, ext: "20931" },
    author: {
      id: "ELM-114",
      person: { given: "Elena", family: "Marsh", suffix: "MD" },
    },
    serviceLow: "20241015",
    serviceHigh: D,
    sections: [al, md, pr, im, res, vs, sh, pl],
  });
}

// ====================================================================================================
// Northbay Clinical Laboratories patient portal
const NB_ORG = {
  root: "2.16.840.1.113883.19.5.6",
  name: "Northbay Clinical Laboratories",
  tel: "555-0275",
  addr: { street: "77 Northbay Parkway", city: "Kestrel Harbor" },
};
const TEST = {
  "24323-8": "CMP",
  "24321-2": "BMP",
  "24331-1": "LIPID",
  "4548-4": "A1C",
};
function northbay(D, docTime) {
  const R = NB_ORG.root;
  const rt = resultsTable(
    `${R}.5`,
    panelsOf(NB_DRAWS, "NB", D),
    (p, o, oi) =>
      o
        ? `${p.acc}-${TEST[p.panel.code]}-${oi + 1}`
        : `${p.acc}-${TEST[p.panel.code]}`,
    "r",
    "<paragraph>Ordering provider: Elena Marsh, MD, Fernhill Family Clinic. All tests performed at Northbay Clinical Laboratories, Kestrel Harbor, WA.</paragraph>",
    (p) => `Northbay Clinical Laboratories, accession ${p.acc}`,
  );
  const res = sec("results", "Results", rt.text, rt.entries);
  return header({
    org: NB_ORG,
    docId: `NBL-6604918-${D}`,
    title: "Northbay Clinical Laboratories Patient Results Summary",
    time: docTime,
    patient: { root: `${R}.2`, ext: "6604918" },
    author: {
      id: "NBL-PORTAL",
      device: { model: "Northbay LIS", software: "Northbay Patient Results" },
    },
    serviceLow: "20250922",
    serviceHigh: D,
    sections: [
      empty("allergies", "Allergies", "No information"),
      empty("meds", "Medications", "No information"),
      empty("problems", "Problems", "No information"),
      res,
    ],
  });
}

// ====================================================================================================
// Alder Street Pharmacy patient record (her pharmacy since August 2022)
const AS_ORG = {
  root: "2.16.840.1.113883.19.5.4",
  name: "Alder Street Pharmacy",
  tel: "555-0215",
  addr: { street: "21 Alder Street", city: "Fernhill" },
};
const addDays = (d, n) => {
  const t = new Date(
    Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) + n * 864e5,
  );
  return t.toISOString().slice(0, 10).replace(/-/g, "");
};
const every = (first, days, until, firstDays = days) => {
  const out = [[first, firstDays]];
  let d = addDays(first, firstDays);
  while (d < until) {
    out.push([d, days]);
    d = addDays(d, days);
  }
  return out;
};
const RX = [
  {
    id: "RX4418820",
    drug: DRUG.atorvastatin,
    name: "atorvastatin 20 MG Oral Tablet",
    sig: "Take 1 tablet by mouth once daily",
    by: "Susan Park, MD",
    first: "20220809",
    fills: [
      ["20220809", 30],
      ["20220908", 90],
      ["20221207", 90],
      ["20230307", 90],
      ["20230605", 90],
      ["20231002", 90],
    ],
    state: (D) =>
      D < "20240807"
        ? { status: "active", refills: "2 refills remaining" }
        : {
            status: "completed",
            high: "20240807",
            st: "Inactive (prescription expired August 7, 2024)",
          },
  },
  {
    id: "RX5230117",
    drug: DRUG.lisinopril,
    name: "lisinopril 10 MG Oral Tablet",
    sig: "Take 1 tablet by mouth once daily",
    by: "Susan Park, MD",
    first: "20230615",
    fills: every("20230615", 90, "20250921", 30),
    state: (D) =>
      D < "20250922"
        ? { status: "active", refills: "3 refills remaining" }
        : {
            status: "aborted",
            high: "20250922",
            st: "Discontinued by prescriber September 22, 2025",
          },
  },
  {
    id: "RX5890311",
    drug: DRUG.fluticasone,
    name: "fluticasone propionate 50 MCG/ACTUAT Nasal Spray, 16 g",
    sig: "1 spray in each nostril once daily",
    by: "Elena Marsh, MD",
    first: "20241015",
    route: "nasal",
    fills: [["20241015", 30]],
    state: (D) =>
      D < "20251015"
        ? { status: "active", refills: "1 refill remaining" }
        : {
            status: "completed",
            high: "20251015",
            st: "Inactive (prescription expired October 15, 2025)",
          },
  },
  {
    id: "RX6044102",
    drug: DRUG.amlodipine,
    name: "amlodipine 5 MG Oral Tablet",
    sig: "Take 1 tablet by mouth once daily",
    by: "Susan Park, MD",
    first: "20250401",
    fills: every("20250401", 90, "20261025"),
    state: () => ({ status: "active", refills: "refills remaining" }),
  },
  {
    id: "RX6120443",
    drug: DRUG.losartan,
    name: "losartan potassium 50 MG Oral Tablet",
    sig: "Take 1 tablet by mouth once daily",
    by: "Elena Marsh, MD",
    first: "20250923",
    fills: every("20250923", 90, "20261025", 30),
    state: () => ({ status: "active", refills: "refills remaining" }),
  },
  {
    id: "RX6120444",
    drug: DRUG.metformin,
    name: "metformin ER 500 MG 24 HR Tablet",
    sig: "Take 1 tablet by mouth once daily with the evening meal",
    by: "Elena Marsh, MD",
    first: "20250923",
    fills: every("20250923", 90, "20261025", 30),
    state: () => ({ status: "active", refills: "refills remaining" }),
  },
  {
    id: "RX6127718",
    drug: DRUG.tamsulosin,
    name: "tamsulosin 0.4 MG Oral Capsule",
    sig: "Take 1 capsule by mouth once daily for 14 days",
    by: "Malik Osei, MD",
    first: "20251018",
    fills: [["20251018", 14]],
    state: () => ({
      status: "completed",
      high: "20251101",
      st: "Inactive (completed)",
    }),
  },
  {
    id: "RX6127719",
    drug: DRUG.ondansetron,
    name: "ondansetron 4 MG Disintegrating Oral Tablet",
    sig: "Dissolve 1 tablet on the tongue every 8 hours as needed for nausea",
    by: "Malik Osei, MD",
    first: "20251018",
    fills: [["20251018", 4]],
    state: () => ({
      status: "completed",
      high: "20251025",
      st: "Inactive (completed)",
    }),
  },
  {
    id: "RX6131090",
    drug: DRUG.hctz,
    name: "hydrochlorothiazide 12.5 MG Oral Capsule",
    sig: "Take 1 capsule by mouth once daily",
    by: "Elena Marsh, MD",
    first: "20251210",
    fills: [
      ["20251210", 30],
      ["20260109", 90],
      ["20260402", 90],
      ["20260701", 90],
      ["20260930", 90],
    ],
    state: () => ({ status: "active", refills: "refills remaining" }),
  },
  {
    id: "RX6150872",
    drug: DRUG.spironolactone,
    name: "spironolactone 25 MG Oral Tablet",
    sig: "Take 1 tablet by mouth once daily",
    by: "Elena Marsh, MD",
    first: "20260817",
    fills: [
      ["20260817", 30],
      ["20260915", 30],
      ["20261014", 30],
    ],
    state: () => ({ status: "active", refills: "refills remaining" }),
  },
];
const AS_VACCINES = [
  {
    id: "VX-251108-1",
    date: "20251108",
    cvx: {
      code: "140",
      dn: "Influenza, seasonal, injectable, preservative free",
    },
    name: "Influenza vaccine, trivalent, preservative free (Fluarix)",
    lot: "FL7K2A",
    site: { code: "368208006", dn: "Left upper arm structure" },
  },
  {
    id: "VX-251108-2",
    date: "20251108",
    cvx: { code: "187", dn: "zoster vaccine recombinant" },
    name: "Zoster vaccine recombinant, adjuvanted (Shingrix)",
    lot: "7T5K9",
    site: { code: "368209003", dn: "Right upper arm structure" },
  },
  {
    id: "VX-251108-3",
    date: "20251108",
    cvx: {
      code: "216",
      dn: "Pneumococcal conjugate PCV20, polysaccharide CRM197 conjugate, adjuvant, PF",
    },
    name: "Pneumococcal 20-valent conjugate vaccine (Prevnar 20)",
    lot: "LR4417",
    site: { code: "368208006", dn: "Left upper arm structure" },
  },
  {
    id: "VX-261003-1",
    date: "20261003",
    cvx: {
      code: "140",
      dn: "Influenza, seasonal, injectable, preservative free",
    },
    name: "Influenza vaccine, trivalent, preservative free (Fluarix)",
    lot: "FL9M4C",
    site: { code: "368208006", dn: "Left upper arm structure" },
  },
];
function pharmacy(D, docTime) {
  const R = AS_ORG.root;
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
        actLow: "20220809",
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
  const rxs = RX.filter((r) => r.first < D).map((r) => {
    const fills = r.fills.filter(([d]) => d < D);
    const s = r.state(D);
    const [lastD, lastN] = fills[fills.length - 1];
    return {
      ...r,
      ...s,
      fillsShown: fills,
      last: `${human(lastD)} (${lastN} days)`,
      st: s.st ?? "Active",
      low: r.first,
    };
  });
  const rows = rxs.map((m, i) => ({
    id: `RXL${i + 1}`,
    cells: [
      { id: `RXL${i + 1}-N`, text: m.name },
      m.sig,
      human(m.first),
      m.last,
      m.by,
      m.status === "active" ? `Active, ${m.refills}` : m.st,
    ],
  }));
  const fillRows = rxs
    .flatMap((m) =>
      m.fillsShown.map(([d, n]) => [
        d + m.id,
        `      <tr>\n        <td>${esc(human(d))}</td>\n        <td>${esc(m.id)}</td>\n        <td>${esc(m.name)}</td>\n        <td>${n} days</td>\n      </tr>`,
      ]),
    )
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map((x) => x[1]);
  const fillTable = `<paragraph>Fill history</paragraph>\n<table border="1" width="100%">\n  <thead>\n    <tr><th>Filled</th><th>Rx number</th><th>Medication</th><th>Days supply</th></tr>\n  </thead>\n  <tbody>\n${fillRows.join("\n")}\n  </tbody>\n</table>`;
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
      rows,
      fillTable,
    ),
    rxs.map((m, i) =>
      medication({
        root: `${R}.5`,
        mood: "EVN",
        periodH: m.drug === DRUG.ondansetron ? undefined : 24,
        id: m.id,
        status: m.status,
        low: m.low,
        high: m.high,
        drug: m.drug,
        route: m.route,
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
  const vx = AS_VACCINES.filter((v) => v.date < D).reverse();
  const im = vx.length
    ? sec(
        "imms",
        "Immunizations",
        table(
          ["Vaccine", "Date", "Lot", "Site", "Administered by"],
          vx.map((v, i) => ({
            id: `IMM${i + 1}`,
            cells: [
              { id: `IMM${i + 1}-N`, text: v.name },
              human(v.date),
              v.lot,
              v.site.dn.replace(" structure", ""),
              "Grace Oyelaran, PharmD",
            ],
          })),
        ),
        vx.map((v, i) =>
          immunization({
            root: `${R}.7`,
            id: v.id,
            date: v.date,
            cvx: v.cvx,
            textRef: `IMM${i + 1}`,
            nameRef: `IMM${i + 1}-N`,
            lot: v.lot,
            im: true,
            site: v.site,
            doseMl: "0.5",
            performer: pharmacist,
          }),
        ),
      )
    : empty("imms", "Immunizations", "No immunizations on file.");
  return header({
    org: AS_ORG,
    docId: `ASP-58821-${D}`,
    title: "Alder Street Pharmacy Patient Record",
    time: docTime,
    patient: { root: `${R}.2`, ext: "58821" },
    author: {
      id: "ASP-RX-SYSTEM",
      device: {
        model: "Alder Street Pharmacy System",
        software: "Alder Street Pharmacy Online",
      },
    },
    serviceLow: "20220809",
    serviceHigh: D,
    sections: [
      al,
      md,
      empty("problems", "Problems", "No information"),
      im,
      empty("results", "Results", "No information"),
    ],
  });
}

// ====================================================================================================
const FILES = [];
const out = (name, xml) => {
  write(name, xml);
  FILES.push(name);
};
out(
  "kestrel-harbor-health-summary.xml",
  kestrel("20221128", "20221128193307+0000"),
);
out(
  "kestrel-harbor-health-summary-2.xml",
  kestrel("20240203", "20240203171140+0000"),
);
out(
  "alder-street-pharmacy-patient-record.xml",
  pharmacy("20240212", "20240212200418+0000"),
);
out(
  "kestrel-harbor-health-summary-3.xml",
  kestrel("20250403", "20250403160922+0000"),
);
out(
  "fernhill-family-clinic-summary.xml",
  fernhill("20250520", "20250520172210+0000"),
);
writeApple(
  join(OUT, "export-2025-06-15"),
  "2025-06-15 08:02:37 +0000",
  "20250615",
);
FILES.push("export-2025-06-15");
out(
  "fernhill-family-clinic-summary-2.xml",
  fernhill("20250812", "20250812154030+0000"),
);
copyFileSync(
  join(ROUND1, "saltmarsh-regional-medical-center-ed-summary.xml"),
  join(OUT, "saltmarsh-regional-medical-center-ed-summary.xml"),
);
FILES.push("saltmarsh-regional-medical-center-ed-summary.xml");
out(
  "fernhill-family-clinic-summary-3.xml",
  fernhill("20260105", "20260105171205+0000"),
);
out(
  "alder-street-pharmacy-patient-record-2.xml",
  pharmacy("20260110", "20260110183355+0000"),
);
out(
  "kestrel-harbor-health-summary-4.xml",
  kestrel("20260310", "20260310081544+0000"),
);
copyFileSync(
  join(ROUND1, "clearwater-eye-associates-visit-summary.xml"),
  join(OUT, "clearwater-eye-associates-visit-summary.xml"),
);
FILES.push("clearwater-eye-associates-visit-summary.xml");
out(
  "northbay-clinical-laboratories-results.xml",
  northbay("20260618", "20260618141022+0000"),
);
out(
  "fernhill-family-clinic-summary-4.xml",
  fernhill("20260622", "20260622180344+0000"),
);
out(
  "alder-street-pharmacy-patient-record-3.xml",
  pharmacy("20260714", "20260714164508+0000"),
);
out(
  "fernhill-family-clinic-summary-5.xml",
  fernhill("20261020", "20261020162751+0000"),
);
out(
  "northbay-clinical-laboratories-results-2.xml",
  northbay("20261024", "20261024093115+0000"),
);
out(
  "alder-street-pharmacy-patient-record-4.xml",
  pharmacy("20261025", "20261025190246+0000"),
);
