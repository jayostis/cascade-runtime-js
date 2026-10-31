// Priya's clinical facts 2019-2026, one set of numbers that every source writes in its own way.
export const ageAt = (ts) => {
  const y = +ts.slice(0, 4),
    m = +ts.slice(4, 6),
    d = +ts.slice(6, 8);
  let a = y - 1968;
  if (m < 11 || (m === 11 && d < 4)) a -= 1;
  return a;
};
// CKD-EPI, female
export const egfr2021 = (cr, age) =>
  Math.round(
    142 *
      Math.min(cr / 0.7, 1) ** -0.241 *
      Math.max(cr / 0.7, 1) ** -1.2 *
      0.9938 ** age *
      1.012,
  );
export const egfr2009 = (cr, age) =>
  Math.round(144 * (cr / 0.7) ** (cr <= 0.7 ? -0.329 : -1.209) * 0.993 ** age);

// deterministic noise for analytes nobody looks at closely
let seed = 20201;
const rnd = () =>
  (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (lo, hi, dp) => (lo + rnd() * (hi - lo)).toFixed(dp);

export const AN = {
  glu: {
    loinc: { code: "2345-7", dn: "Glucose [Mass/volume] in Serum or Plasma" },
    name: "Glucose",
    unit: "mg/dL",
  },
  fglu: {
    loinc: {
      code: "1558-6",
      dn: "Fasting glucose [Mass/volume] in Serum or Plasma",
    },
    name: "Glucose, fasting",
    unit: "mg/dL",
  },
  bun: {
    loinc: {
      code: "3094-0",
      dn: "Urea nitrogen [Mass/volume] in Serum or Plasma",
    },
    name: "BUN",
    unit: "mg/dL",
  },
  cr: {
    loinc: {
      code: "2160-0",
      dn: "Creatinine [Mass/volume] in Serum or Plasma",
    },
    name: "Creatinine",
    unit: "mg/dL",
  },
  egfr21: {
    loinc: {
      code: "98979-8",
      dn: "Glomerular filtration rate [Volume Rate/Area] in Serum, Plasma or Blood by Creatinine-based formula (CKD-EPI 2021)/1.73 sq M",
    },
    name: "eGFR (CKD-EPI 2021)",
    unit: "mL/min/{1.73_m2}",
  },
  egfr09: {
    loinc: {
      code: "88294-4",
      dn: "Glomerular filtration rate/1.73 sq M.predicted among non-blacks [Volume Rate/Area] in Serum, Plasma or Blood by Creatinine-based formula (CKD-EPI)",
    },
    name: "eGFR, non-African American",
    unit: "mL/min/{1.73_m2}",
  },
  na: {
    loinc: { code: "2951-2", dn: "Sodium [Moles/volume] in Serum or Plasma" },
    name: "Sodium",
    unit: "mmol/L",
  },
  k: {
    loinc: {
      code: "2823-3",
      dn: "Potassium [Moles/volume] in Serum or Plasma",
    },
    name: "Potassium",
    unit: "mmol/L",
  },
  cl: {
    loinc: { code: "2075-0", dn: "Chloride [Moles/volume] in Serum or Plasma" },
    name: "Chloride",
    unit: "mmol/L",
  },
  co2: {
    loinc: {
      code: "2028-9",
      dn: "Carbon dioxide, total [Moles/volume] in Serum or Plasma",
    },
    name: "Carbon dioxide",
    unit: "mmol/L",
  },
  ca: {
    loinc: { code: "17861-6", dn: "Calcium [Mass/volume] in Serum or Plasma" },
    name: "Calcium",
    unit: "mg/dL",
  },
  tp: {
    loinc: { code: "2885-2", dn: "Protein [Mass/volume] in Serum or Plasma" },
    name: "Protein, total",
    unit: "g/dL",
  },
  alb: {
    loinc: { code: "1751-7", dn: "Albumin [Mass/volume] in Serum or Plasma" },
    name: "Albumin",
    unit: "g/dL",
  },
  tbil: {
    loinc: {
      code: "1975-2",
      dn: "Bilirubin.total [Mass/volume] in Serum or Plasma",
    },
    name: "Bilirubin, total",
    unit: "mg/dL",
  },
  alp: {
    loinc: {
      code: "6768-6",
      dn: "Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma",
    },
    name: "Alkaline phosphatase",
    unit: "U/L",
  },
  alt: {
    loinc: {
      code: "1742-6",
      dn: "Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma",
    },
    name: "ALT",
    unit: "U/L",
  },
  ast: {
    loinc: {
      code: "1920-8",
      dn: "Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma",
    },
    name: "AST",
    unit: "U/L",
  },
  chol: {
    loinc: {
      code: "2093-3",
      dn: "Cholesterol [Mass/volume] in Serum or Plasma",
    },
    name: "Cholesterol, total",
    unit: "mg/dL",
  },
  hdl: {
    loinc: {
      code: "2085-9",
      dn: "Cholesterol in HDL [Mass/volume] in Serum or Plasma",
    },
    name: "HDL cholesterol",
    unit: "mg/dL",
  },
  tg: {
    loinc: {
      code: "2571-8",
      dn: "Triglyceride [Mass/volume] in Serum or Plasma",
    },
    name: "Triglycerides",
    unit: "mg/dL",
  },
  ldl: {
    loinc: {
      code: "13457-7",
      dn: "Cholesterol in LDL [Mass/volume] in Serum or Plasma by calculation",
    },
    name: "LDL cholesterol, calculated",
    unit: "mg/dL",
  },
  a1c: {
    loinc: { code: "4548-4", dn: "Hemoglobin A1c/Hemoglobin.total in Blood" },
    name: "Hemoglobin A1c",
    unit: "%",
  },
  tsh: {
    loinc: {
      code: "3016-3",
      dn: "Thyrotropin [Units/volume] in Serum or Plasma",
    },
    name: "TSH",
    unit: "m[IU]/L",
  },
  ft4: {
    loinc: {
      code: "3024-7",
      dn: "Thyroxine (T4) free [Mass/volume] in Serum or Plasma",
    },
    name: "Free T4",
    unit: "ng/dL",
  },
  wbc: {
    loinc: {
      code: "6690-2",
      dn: "Leukocytes [#/volume] in Blood by Automated count",
    },
    name: "WBC",
    unit: "10*3/uL",
  },
  hgb: {
    loinc: { code: "718-7", dn: "Hemoglobin [Mass/volume] in Blood" },
    name: "Hemoglobin",
    unit: "g/dL",
  },
  hct: {
    loinc: {
      code: "4544-3",
      dn: "Hematocrit [Volume Fraction] of Blood by Automated count",
    },
    name: "Hematocrit",
    unit: "%",
  },
  mcv: {
    loinc: { code: "787-2", dn: "MCV [Entitic volume] by Automated count" },
    name: "MCV",
    unit: "fL",
  },
  plt: {
    loinc: {
      code: "777-3",
      dn: "Platelets [#/volume] in Blood by Automated count",
    },
    name: "Platelets",
    unit: "10*3/uL",
  },
  ualb: {
    loinc: { code: "14957-5", dn: "Microalbumin [Mass/volume] in Urine" },
    name: "Albumin, urine",
    unit: "mg/L",
  },
  ucr: {
    loinc: { code: "2161-8", dn: "Creatinine [Mass/volume] in Urine" },
    name: "Creatinine, urine",
    unit: "mg/dL",
  },
  uacr: {
    loinc: {
      code: "14959-1",
      dn: "Microalbumin/Creatinine [Mass Ratio] in Urine",
    },
    name: "Albumin/creatinine ratio, urine",
    unit: "mg/g",
  },
  ck: {
    loinc: {
      code: "2157-6",
      dn: "Creatine kinase [Enzymatic activity/volume] in Serum or Plasma",
    },
    name: "Creatine kinase (CK)",
    unit: "U/L",
  },
  osm: {
    loinc: { code: "2692-2", dn: "Osmolality of Serum or Plasma" },
    name: "Osmolality, serum",
    unit: "mosm/kg",
  },
};
export const PANEL = {
  bmp: { code: "24321-2", dn: "Basic metabolic 2000 panel - Serum or Plasma" },
  cmp: {
    code: "24323-8",
    dn: "Comprehensive metabolic 2000 panel - Serum or Plasma",
  },
  lipid: { code: "24331-1", dn: "Lipid 1996 panel - Serum or Plasma" },
  hepatic: {
    code: "24325-3",
    dn: "Hepatic function 2000 panel - Serum or Plasma",
  },
  cbc: { code: "58410-2", dn: "CBC panel - Blood by Automated count" },
  a1c: { code: "4548-4", dn: "Hemoglobin A1c/Hemoglobin.total in Blood" },
  tsh: { code: "3016-3", dn: "Thyrotropin [Units/volume] in Serum or Plasma" },
  uacr: {
    code: "14959-1",
    dn: "Microalbumin/Creatinine [Mass Ratio] in Urine",
  },
  ck: {
    code: "2157-6",
    dn: "Creatine kinase [Enzymatic activity/volume] in Serum or Plasma",
  },
  osm: { code: "2692-2", dn: "Osmolality of Serum or Plasma" },
};
// reference ranges per laboratory: [lo, hi] (either may be undefined)
export const RANGE = {
  KH: {
    glu: [70, 99],
    fglu: [70, 99],
    bun: [7, 20],
    cr: ["0.57", "1.11"],
    egfr21: [60],
    egfr09: [60],
    na: [136, 145],
    k: ["3.5", "5.1"],
    cl: [98, 107],
    co2: [22, 29],
    ca: ["8.6", "10.3"],
    tp: ["6.0", "8.3"],
    alb: ["3.5", "5.0"],
    tbil: ["0.2", "1.2"],
    alp: [40, 129],
    alt: [7, 45],
    ast: [10, 40],
    chol: [undefined, 199],
    hdl: [50],
    tg: [undefined, 149],
    ldl: [undefined, 99],
    a1c: ["4.0", "5.6"],
    tsh: ["0.40", "4.00"],
    ft4: ["0.8", "1.8"],
    wbc: ["4.0", "11.0"],
    hgb: ["12.0", "15.5"],
    hct: ["36.0", "46.0"],
    mcv: [80, 100],
    plt: [150, 400],
    ualb: [],
    ucr: [],
    uacr: [undefined, 29],
    ck: [26, 192],
    osm: [275, 295],
  },
  NB: {
    glu: [70, 99],
    fglu: [70, 99],
    bun: [6, 24],
    cr: ["0.50", "1.10"],
    egfr21: [60],
    na: [135, 145],
    k: ["3.5", "5.1"],
    cl: [96, 106],
    co2: [20, 29],
    ca: ["8.7", "10.2"],
    tp: ["6.0", "8.5"],
    alb: ["3.8", "4.9"],
    tbil: ["0.0", "1.2"],
    alp: [44, 121],
    alt: [0, 32],
    ast: [0, 40],
    chol: [undefined, 199],
    hdl: [50],
    tg: [undefined, 149],
    ldl: [undefined, 99],
    a1c: ["4.0", "5.6"],
  },
};
export const interpOf = (lab, an, v) => {
  const [lo, hi] = RANGE[lab][an] ?? [];
  if (lo !== undefined && +v < +lo) return "L";
  if (hi !== undefined && +v > +hi) return "H";
  return "N";
};

// a panel: {panel, obs:[{an, v}]}; values given as strings; missing routine values filled by noise
function bmpObs(time, lab, v, eq) {
  const cr = v.cr;
  const age = ageAt(time);
  const g =
    eq === "09"
      ? ["egfr09", String(egfr2009(+cr, age))]
      : ["egfr21", String(egfr2021(+cr, age))];
  return [
    [v.fasting === false ? "glu" : "fglu", v.glu],
    ["bun", v.bun ?? pick(11, 18, 0)],
    ["cr", cr],
    g,
    ["na", v.na ?? pick(138, 142, 0)],
    ["k", v.k],
    ["cl", v.cl ?? pick(100, 105, 0)],
    ["co2", v.co2 ?? pick(24, 28, 0)],
    ["ca", v.ca ?? pick(9.1, 9.8, 1)],
  ];
}
const cmpExtra = (v) => [
  ["tp", pick(6.8, 7.6, 1)],
  ["alb", pick(4.1, 4.6, 1)],
  ["tbil", pick(0.4, 0.8, 1)],
  ["alp", pick(62, 88, 0)],
  ["alt", v.alt ?? pick(17, 29, 0)],
  ["ast", v.ast ?? pick(18, 27, 0)],
];
const mk = (lab, list) =>
  list.map(([an, v]) => ({ an, v: String(v), interp: interpOf(lab, an, v) }));
export const bmp = (time, lab, v, eq = "21") => ({
  panel: PANEL.bmp,
  obs: mk(lab, bmpObs(time, lab, v, eq)),
});
export const cmp = (time, lab, v, eq = "21") => ({
  panel: PANEL.cmp,
  obs: mk(lab, [...bmpObs(time, lab, v, eq), ...cmpExtra(v)]),
});
export const hepatic = (lab, v) => ({
  panel: PANEL.hepatic,
  obs: mk(lab, cmpExtra(v)),
});
export const lipid = (lab, tc, hdl, tg, ldl) => ({
  panel: PANEL.lipid,
  obs: mk(lab, [
    ["chol", tc],
    ["hdl", hdl],
    ["tg", tg],
    ["ldl", ldl],
  ]),
});
export const cbc = (lab, hgb) => ({
  panel: PANEL.cbc,
  obs: mk(lab, [
    ["wbc", pick(5.2, 7.4, 1)],
    ["hgb", hgb],
    ["hct", (hgb * 2.98).toFixed(1)],
    ["mcv", pick(86, 92, 0)],
    ["plt", pick(220, 300, 0)],
  ]),
});
export const a1c = (lab, v) => ({
  panel: PANEL.a1c,
  obs: mk(lab, [["a1c", v]]),
});
export const tsh = (lab, v, ft4) => ({
  panel: PANEL.tsh,
  obs: mk(
    lab,
    ft4
      ? [
          ["tsh", v],
          ["ft4", ft4],
        ]
      : [["tsh", v]],
  ),
});

// ---------- Kestrel Harbor Hospital laboratory (primary care at Kestrel Harbor Internal Medicine to mid-2025) ----------

export const KH_DRAWS = [
  {
    key: "200114",
    time: "20200114162000+0000",
    panels: [
      cmp("2020", "KH", { glu: 104, cr: "0.78", k: "4.3" }, "09"),
      lipid("KH", 210, 52, 135, 131),
      tsh("KH", "2.10"),
      a1c("KH", "5.8"),
    ],
  },
  {
    key: "210119",
    time: "20210119160500+0000",
    panels: [
      cmp("2021", "KH", { glu: 103, cr: "0.80", k: "4.4" }, "09"),
      lipid("KH", 216, 51, 142, 137),
      tsh("KH", "2.60"),
      a1c("KH", "5.9"),
    ],
  },
  {
    key: "220125",
    time: "20220125155000+0000",
    panels: [
      cmp("2022", "KH", { glu: 107, cr: "0.81", k: "4.2" }),
      lipid("KH", 228, 50, 150, 148),
      tsh("KH", "3.10"),
      a1c("KH", "6.0"),
    ],
  },
  {
    key: "220809",
    time: "20220809154000+0000",
    panels: [
      hepatic("KH", { alt: 24, ast: 22 }),
      lipid("KH", 247, 49, 151, 168),
      a1c("KH", "6.1"),
    ],
  },
  {
    key: "221115",
    time: "20221115161000+0000",
    panels: [
      hepatic("KH", { alt: 31, ast: 29 }),
      lipid("KH", 168, 51, 120, 93),
    ],
  },
  {
    key: "230615",
    time: "20230615163000+0000",
    panels: [
      cmp("2023", "KH", { glu: 108, cr: "0.82", k: "4.2" }),
      lipid("KH", 175, 50, 128, 99),
      tsh("KH", "3.60"),
      a1c("KH", "6.1"),
      {
        panel: PANEL.uacr,
        obs: mk("KH", [
          ["ualb", "16"],
          ["ucr", "89"],
          ["uacr", "18"],
        ]),
      },
    ],
  },
  {
    key: "230706",
    time: "20230706152000+0000",
    panels: [bmp("2023", "KH", { glu: 101, cr: "0.84", k: "4.5" })],
  },
  {
    key: "231114",
    time: "20231114170000+0000",
    panels: [{ panel: PANEL.ck, obs: mk("KH", [["ck", "148"]]) }],
  },
  {
    key: "240123",
    time: "20240123160000+0000",
    panels: [
      bmp("2024", "KH", { glu: 110, cr: "0.83", k: "4.4" }),
      a1c("KH", "6.3"),
    ],
  },
  {
    key: "240820",
    time: "20240820154500+0000",
    panels: [
      cmp("2024", "KH", { glu: 112, cr: "0.85", k: "4.3" }),
      lipid("KH", 238, 49, 156, 158),
      tsh("KH", "4.60", "1.1"),
      a1c("KH", "6.4"),
    ],
  },
  {
    key: "250327",
    time: "20250327120000+0000",
    panels: [
      bmp("2025", "KH", { glu: 114, fasting: false, cr: "0.86", k: "4.1" }),
    ],
  },
  {
    key: "250610",
    time: "20250610134500+0000",
    panels: [
      bmp("2025", "KH", { glu: 117, fasting: false, cr: "0.84", k: "4.4" }),
    ],
  },
  {
    key: "260302",
    time: "20260302194000+0000",
    panels: [
      bmp("2026", "KH", {
        glu: 141,
        fasting: false,
        cr: "1.04",
        k: "3.6",
        na: 123,
        cl: 88,
        co2: 25,
      }),
      { panel: PANEL.osm, obs: mk("KH", [["osm", "256"]]) },
      cbc("KH", 12.9),
    ],
  },
  {
    key: "260303",
    time: "20260303061000+0000",
    panels: [tsh("KH", "7.90", "1.0")],
  },
  {
    key: "260305",
    time: "20260305060500+0000",
    panels: [
      bmp("2026", "KH", {
        glu: 118,
        fasting: false,
        cr: "0.92",
        k: "4.0",
        na: 133,
        cl: 97,
      }),
    ],
  },
];
// the age in bmpObs reads the draw time; the helpers above were given a year only, so recompute eGFR now
for (const d of KH_DRAWS) for (const p of d.panels) fixEgfr(p, d.time);
function fixEgfr(p, time) {
  const cr = p.obs.find((o) => o.an === "cr");
  const e = p.obs.find((o) => o.an === "egfr21" || o.an === "egfr09");
  if (!cr || !e) return;
  const age = ageAt(time);
  e.v = String(e.an === "egfr09" ? egfr2009(+cr.v, age) : egfr2021(+cr.v, age));
  e.interp = +e.v < 60 ? "L" : "N";
}

// ---------- Northbay Clinical Laboratories (Fernhill's orders, from September 2025) ----------
export const NB_DRAWS = [
  {
    key: "250922",
    acc: "NB25-265-4471",
    time: "20250922161500+0000",
    panels: [
      cmp("x", "NB", { glu: 138, cr: "0.88", k: "4.3", na: 139 }),
      lipid("NB", 221, 48, 155, 142),
      a1c("NB", "6.9"),
    ],
  },
  {
    key: "251006",
    acc: "NB25-279-0518",
    time: "20251006153000+0000",
    panels: [bmp("x", "NB", { glu: 126, cr: "0.90", k: "4.5" })],
  },
  {
    key: "251209",
    acc: "NB25-343-1180",
    time: "20251209164000+0000",
    panels: [a1c("NB", "6.7")],
  },
  {
    key: "251230",
    acc: "NB25-364-2207",
    time: "20251230155000+0000",
    panels: [bmp("x", "NB", { glu: 121, cr: "0.89", k: "3.9", na: 136 })],
  },
  {
    key: "260615",
    acc: "NB26-166-0932",
    time: "20260615153000+0000",
    panels: [
      a1c("NB", "6.6"),
      bmp("x", "NB", { glu: 124, cr: "0.93", k: "4.2", na: 134 }),
    ],
  },
  {
    key: "260817",
    acc: "NB26-229-1764",
    time: "20260817152000+0000",
    panels: [
      bmp("x", "NB", { glu: 129, cr: "0.94", k: "4.6", na: 137 }),
      lipid("NB", 226, 47, 162, 147),
    ],
  },
  {
    key: "260901",
    acc: "NB26-244-0381",
    time: "20260901151000+0000",
    panels: [bmp("x", "NB", { glu: 122, cr: "0.97", k: "4.9", na: 136 })],
  },
  {
    key: "260929",
    acc: "NB26-272-2915",
    time: "20260929151000+0000",
    panels: [bmp("x", "NB", { glu: 127, cr: "1.01", k: "5.2", na: 135 })],
  },
  {
    key: "261013",
    acc: "NB26-286-1043",
    time: "20261013152500+0000",
    panels: [
      bmp("x", "NB", { glu: 131, cr: "1.06", k: "5.6", na: 134 }),
      a1c("NB", "6.8"),
    ],
  },
];
for (const d of NB_DRAWS) for (const p of d.panels) fixEgfr(p, d.time);
// give each panel and observation a key once, so every document that carries a draw names it the same way
for (const d of [...KH_DRAWS, ...NB_DRAWS])
  d.panels.forEach((p, i) => (p.key = `${d.key}-${i}`));
