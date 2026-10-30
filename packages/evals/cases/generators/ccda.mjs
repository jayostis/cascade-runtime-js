// Small C-CDA R2.1 writer: header, mapped sections with entries, narrative-only sections.
export const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const SYS = {
  rxnorm: ["2.16.840.1.113883.6.88", "RxNorm"],
  snomed: ["2.16.840.1.113883.6.96", "SNOMED CT"],
  loinc: ["2.16.840.1.113883.6.1", "LOINC"],
  icd10: ["2.16.840.1.113883.6.90", "ICD-10-CM"],
  cpt: ["2.16.840.1.113883.6.12", "CPT-4"],
  cvx: ["2.16.840.1.113883.12.292", "CVX"],
};
export const code = (el, c, inner = "", extra = "") => {
  const [oid, name] = SYS[c.sys] ?? [c.sys, c.sysName];
  const dn = c.dn ? ` displayName="${esc(c.dn)}"` : "";
  return inner
    ? `<${el}${extra} code="${c.code}"${dn} codeSystem="${oid}" codeSystemName="${name}">${inner}</${el}>`
    : `<${el}${extra} code="${c.code}"${dn} codeSystem="${oid}" codeSystemName="${name}"/>`;
};
const ref = (id) => `<reference value="#${id}"/>`;
const ind = (s, n) =>
  s
    .split("\n")
    .map((l) => (l ? " ".repeat(n) + l : l))
    .join("\n");

const addr = (a, use) => `<addr use="${use}">
  <streetAddressLine>${esc(a.street)}</streetAddressLine>
  <city>${esc(a.city)}</city>
  <state>WA</state>
  <postalCode>98000</postalCode>
  <country>US</country>
</addr>`;

const PATIENT = (pid) => `<recordTarget>
  <patientRole>
    <id root="${pid.root}" extension="${pid.ext}"/>
${ind(addr({ street: "48 Alder Lane", city: "Fernhill" }, "HP"), 4)}
    <telecom use="MC" value="tel:+1(555)555-0148"/>
    <patient>
      <name use="L">
        <given>Priya</given>
        <family>Natarajan</family>
      </name>
      <administrativeGenderCode code="F" displayName="Female" codeSystem="2.16.840.1.113883.5.1" codeSystemName="AdministrativeGender"/>
      <birthTime value="19681104"/>
      <raceCode code="2028-9" displayName="Asian" codeSystem="2.16.840.1.113883.6.238" codeSystemName="Race &amp; Ethnicity - CDC"/>
      <ethnicGroupCode code="2186-5" displayName="Not Hispanic or Latino" codeSystem="2.16.840.1.113883.6.238" codeSystemName="Race &amp; Ethnicity - CDC"/>
      <languageCommunication>
        <languageCode code="en"/>
        <preferenceInd value="true"/>
      </languageCommunication>
    </patient>
  </patientRole>
</recordTarget>`;

const ORG = (o, tag) => `<${tag}>
  <id root="${o.root}"/>
  <name>${esc(o.name)}</name>
  <telecom use="WP" value="tel:+1(555)${o.tel}"/>
${ind(addr(o.addr, "WP"), 2)}
</${tag}>`;

export function header(d) {
  const who = d.author.person
    ? `<assignedPerson>
  <name>
    <given>${esc(d.author.person.given)}</given>
    <family>${esc(d.author.person.family)}</family>
    <suffix>${esc(d.author.person.suffix)}</suffix>
  </name>
</assignedPerson>`
    : `<assignedAuthoringDevice>
  <manufacturerModelName>${esc(d.author.device.model)}</manufacturerModelName>
  <softwareName>${esc(d.author.device.software)}</softwareName>
</assignedAuthoringDevice>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <realmCode code="US"/>
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <templateId root="2.16.840.1.113883.10.20.22.1.1" extension="2015-08-01"/>
  <templateId root="2.16.840.1.113883.10.20.22.1.2" extension="2015-08-01"/>
  <id root="${d.org.root}.1" extension="${d.docId}"/>
  <code code="34133-9" displayName="Summarization of Episode Note" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC"/>
  <title>${esc(d.title)}</title>
  <effectiveTime value="${d.time}"/>
  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>
  <languageCode code="en-US"/>
${ind(PATIENT(d.patient), 2)}
  <author>
    <time value="${d.time}"/>
    <assignedAuthor>
      <id root="${d.org.root}.3" extension="${d.author.id}"/>
${ind(addr(d.org.addr, "WP"), 6)}
      <telecom use="WP" value="tel:+1(555)${d.org.tel}"/>
${ind(who, 6)}
${ind(ORG(d.org, "representedOrganization"), 6)}
    </assignedAuthor>
  </author>
  <custodian>
    <assignedCustodian>
${ind(ORG(d.org, "representedCustodianOrganization"), 6)}
    </assignedCustodian>
  </custodian>
  <documentationOf>
    <serviceEvent classCode="PCPR">
      <effectiveTime>
        <low value="${d.serviceLow}"/>
        <high value="${d.serviceHigh}"/>
      </effectiveTime>
    </serviceEvent>
  </documentationOf>
  <component>
    <structuredBody>
${d.sections.map((s) => ind(s, 6)).join("\n")}
    </structuredBody>
  </component>
</ClinicalDocument>
`;
}

// narrative helpers: a table (rows of cells; a cell may be {id, text}) or a list
const cell = (c, tag = "td") =>
  typeof c === "object" && c !== null
    ? `<${tag} ID="${c.id}">${esc(c.text)}</${tag}>`
    : `<${tag}>${esc(c)}</${tag}>`;
export function table(head, rows, after = "") {
  return `<text>
  <table border="1" width="100%">
    <thead>
      <tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>
    </thead>
    <tbody>
${rows.map((r) => `      <tr ID="${r.id}">\n${r.cells.map((c) => `        ${cell(c)}`).join("\n")}\n      </tr>`).join("\n")}
    </tbody>
  </table>${after ? "\n" + ind(after, 2) : ""}
</text>`;
}
export function list(items) {
  return `<text>
  <list>
${items.map((i) => `    <item ID="${i.id}">${i.html}</item>`).join("\n")}
  </list>
</text>`;
}
export const content = (id, text) =>
  `<content ID="${id}">${esc(text)}</content>`;

function section(tpl, ext, c, title, text, entries) {
  return `<component>
  <section>
    <templateId root="${tpl}"/>
    <templateId root="${tpl}" extension="${ext}"/>
    ${code("code", c)}
    <title>${esc(title)}</title>
${ind(text, 4)}
${entries.map((e) => ind(`<entry typeCode="DRIV">\n${ind(e, 2)}\n</entry>`, 4)).join("\n")}
  </section>
</component>`;
}
export function emptySection(tpl, ext, c, title, textLine) {
  return `<component>
  <section nullFlavor="NI">
    <templateId root="${tpl}"/>
    <templateId root="${tpl}" extension="${ext}"/>
    ${code("code", c)}
    <title>${esc(title)}</title>
    <text>${esc(textLine)}</text>
  </section>
</component>`;
}
export function narrativeSection(tpl, c, title, textXml) {
  return `<component>
  <section>
    <templateId root="${tpl}"/>
    ${code("code", c)}
    <title>${esc(title)}</title>
${ind(textXml, 4)}
  </section>
</component>`;
}
export const paragraphs = (ps) =>
  `<text>\n${ps.map((p) => `  ${p}`).join("\n")}\n</text>`;
export const para = (s) => `<paragraph>${esc(s)}</paragraph>`;

const S = {
  allergies: [
    "2.16.840.1.113883.10.20.22.2.6.1",
    "2015-08-01",
    {
      code: "48765-2",
      dn: "Allergies and adverse reactions Document",
      sys: "loinc",
    },
  ],
  meds: [
    "2.16.840.1.113883.10.20.22.2.1.1",
    "2014-06-09",
    {
      code: "10160-0",
      dn: "History of Medication use Narrative",
      sys: "loinc",
    },
  ],
  problems: [
    "2.16.840.1.113883.10.20.22.2.5.1",
    "2015-08-01",
    { code: "11450-4", dn: "Problem list - Reported", sys: "loinc" },
  ],
  imms: [
    "2.16.840.1.113883.10.20.22.2.2.1",
    "2015-08-01",
    { code: "11369-6", dn: "History of Immunization Narrative", sys: "loinc" },
  ],
  procs: [
    "2.16.840.1.113883.10.20.22.2.7.1",
    "2014-06-09",
    { code: "47519-4", dn: "History of Procedures Document", sys: "loinc" },
  ],
  results: [
    "2.16.840.1.113883.10.20.22.2.3.1",
    "2015-08-01",
    {
      code: "30954-2",
      dn: "Relevant diagnostic tests/laboratory data Narrative",
      sys: "loinc",
    },
  ],
  vitals: [
    "2.16.840.1.113883.10.20.22.2.4.1",
    "2015-08-01",
    { code: "8716-3", dn: "Vital signs", sys: "loinc" },
  ],
  social: [
    "2.16.840.1.113883.10.20.22.2.17",
    "2015-08-01",
    { code: "29762-2", dn: "Social history Narrative", sys: "loinc" },
  ],
};
export const SECTION = S;
export const sec = (k, title, text, entries) =>
  section(S[k][0], S[k][1], S[k][2], title, text, entries);
export const empty = (k, title, line) =>
  emptySection(S[k][0], S[k][1], S[k][2], title, line);
export const plan = (textXml) =>
  narrativeSection(
    "2.16.840.1.113883.10.20.22.2.10",
    { code: "18776-5", dn: "Plan of care note", sys: "loinc" },
    "Plan of Treatment",
    textXml,
  );
export const encounters = (textXml) =>
  narrativeSection(
    "2.16.840.1.113883.10.20.22.2.22",
    {
      code: "46240-8",
      dn: "History of Hospitalizations+Outpatient visits Narrative",
      sys: "loinc",
    },
    "Encounters",
    textXml,
  );

const idEl = (root, ext) =>
  ext === null
    ? `<id nullFlavor="NI"/>`
    : `<id root="${root}" extension="${ext}"/>`;

// a: {root, act, obs, rxn, status, actLow, obsLow, type:{code,dn}, rx:{code,dn}, textRef, subRef, rxnRef?, reaction:{code,dn}, severity?:{code,dn}, criticality?}
export function allergy(a) {
  const crit = a.criticality
    ? `
<entryRelationship typeCode="SUBJ" inversionInd="true">
  <observation classCode="OBS" moodCode="EVN">
    <templateId root="2.16.840.1.113883.10.20.22.4.145"/>
    <code code="82606-5" displayName="Allergy or intolerance criticality" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC"/>
    <statusCode code="completed"/>
    <value xsi:type="CD" code="CRITL" displayName="low criticality" codeSystem="2.16.840.1.113883.5.1063" codeSystemName="ObservationValue"/>
  </observation>
</entryRelationship>`
    : "";
  const stat = a.statusActive
    ? `
<entryRelationship typeCode="SUBJ" inversionInd="true">
  <observation classCode="OBS" moodCode="EVN">
    <templateId root="2.16.840.1.113883.10.20.22.4.28"/>
    <templateId root="2.16.840.1.113883.10.20.22.4.28" extension="2019-06-20"/>
    <code code="33999-4" displayName="Status" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC"/>
    <statusCode code="completed"/>
    <value xsi:type="CE" code="55561003" displayName="Active" codeSystem="2.16.840.1.113883.6.96" codeSystemName="SNOMED CT"/>
  </observation>
</entryRelationship>`
    : "";
  const sev = a.severity
    ? `
  <entryRelationship typeCode="SUBJ" inversionInd="true">
    <observation classCode="OBS" moodCode="EVN">
      <templateId root="2.16.840.1.113883.10.20.22.4.8"/>
      <templateId root="2.16.840.1.113883.10.20.22.4.8" extension="2014-06-09"/>
      <code code="SEV" displayName="Severity Observation" codeSystem="2.16.840.1.113883.5.4"/>
      <statusCode code="completed"/>
      ${code("value", { ...a.severity, sys: "snomed" }, "", ' xsi:type="CD"')}
    </observation>
  </entryRelationship>`
    : "";
  return `<act classCode="ACT" moodCode="EVN">
  <templateId root="2.16.840.1.113883.10.20.22.4.30"/>
  <templateId root="2.16.840.1.113883.10.20.22.4.30" extension="2015-08-01"/>
  ${idEl(a.root, a.act)}
  <code code="CONC" displayName="Concern" codeSystem="2.16.840.1.113883.5.6"/>
  <statusCode code="${a.status ?? "active"}"/>
  <effectiveTime>
    <low value="${a.actLow}"/>
  </effectiveTime>
  <entryRelationship typeCode="SUBJ">
    <observation classCode="OBS" moodCode="EVN">
      <templateId root="2.16.840.1.113883.10.20.22.4.7"/>
      <templateId root="2.16.840.1.113883.10.20.22.4.7" extension="2014-06-09"/>
      ${idEl(a.root, a.obs)}
      <code code="ASSERTION" codeSystem="2.16.840.1.113883.5.4"/>
      <text>
        ${ref(a.textRef)}
      </text>
      <statusCode code="completed"/>
      <effectiveTime>
        <low value="${a.obsLow}"/>
      </effectiveTime>
      ${code("value", { ...a.type, sys: "snomed" }, "", ' xsi:type="CD"')}
      <participant typeCode="CSM">
        <participantRole classCode="MANU">
          <playingEntity classCode="MMAT">
            ${code("code", { ...a.rx, sys: "rxnorm" }, `\n              <originalText>\n                ${ref(a.subRef)}\n              </originalText>\n            `)}
          </playingEntity>
        </participantRole>
      </participant>${ind(crit + stat, 6)}
      <entryRelationship typeCode="MFST" inversionInd="true">
        <observation classCode="OBS" moodCode="EVN">
          <templateId root="2.16.840.1.113883.10.20.22.4.9"/>
          <templateId root="2.16.840.1.113883.10.20.22.4.9" extension="2014-06-09"/>
          ${idEl(a.root, a.rxn)}
          <code code="ASSERTION" codeSystem="2.16.840.1.113883.5.4"/>${a.rxnRef ? `\n          <text>\n            ${ref(a.rxnRef)}\n          </text>` : ""}
          <statusCode code="completed"/>
          ${code("value", { ...a.reaction, sys: "snomed" }, "", ' xsi:type="CD"')}${ind(sev, 8)}
        </observation>
      </entryRelationship>
    </observation>
  </entryRelationship>
</act>`;
}

// m: {root, id, mood, status, low|lowNull, high?, textRef, nameRef, drug:{code,dn,sys}, translation?, route:'oral'|'nasal', dose, daily?:bool, prn?:bool}
export function medication(m) {
  const route =
    m.route === "nasal"
      ? `<routeCode code="C38284" displayName="NASAL" codeSystem="2.16.840.1.113883.3.26.1.1" codeSystemName="NCI Thesaurus"/>`
      : `<routeCode code="C38288" displayName="ORAL" codeSystem="2.16.840.1.113883.3.26.1.1" codeSystemName="NCI Thesaurus"/>`;
  const low = m.lowNull
    ? `<low nullFlavor="${m.lowNull}"/>`
    : `<low value="${m.low}"/>`;
  const high = m.high ? `\n  <high value="${m.high}"/>` : "";
  const period = m.periodH
    ? `\n<effectiveTime xsi:type="PIVL_TS" institutionSpecified="true" operator="A">\n  <period value="${m.periodH}" unit="h"/>\n</effectiveTime>`
    : "";
  const tr = m.translation
    ? `\n  ${code("translation", { ...m.translation, sys: "rxnorm" })}`
    : "";
  const drugCode =
    m.drug.sys === "rxnorm" || !m.drug.sys
      ? code(
          "code",
          { ...m.drug, sys: "rxnorm" },
          `\n  <originalText>\n    ${ref(m.nameRef)}\n  </originalText>${tr}\n`,
        )
      : `<code code="${m.drug.code}" displayName="${esc(m.drug.dn)}" codeSystem="${m.drug.sys}" codeSystemName="${esc(m.drug.sysName)}">\n  <originalText>\n    ${ref(m.nameRef)}\n  </originalText>${tr}\n</code>`;
  return `<substanceAdministration classCode="SBADM" moodCode="${m.mood ?? "EVN"}">
  <templateId root="2.16.840.1.113883.10.20.22.4.16"/>
  <templateId root="2.16.840.1.113883.10.20.22.4.16" extension="2014-06-09"/>
  ${idEl(m.root, m.id)}
  <text>
    ${ref(m.textRef)}
  </text>
  <statusCode code="${m.status}"/>
  <effectiveTime xsi:type="IVL_TS">
    ${low}${high}
  </effectiveTime>${ind(period, 2)}
  ${route}
  <doseQuantity value="${m.dose ?? 1}"/>
  <consumable>
    <manufacturedProduct classCode="MANU">
      <templateId root="2.16.840.1.113883.10.20.22.4.23"/>
      <templateId root="2.16.840.1.113883.10.20.22.4.23" extension="2014-06-09"/>
      <manufacturedMaterial>
${ind(drugCode, 8)}
      </manufacturedMaterial>
    </manufacturedProduct>
  </consumable>
</substanceAdministration>`;
}

// p: {root, act, obs, actStatus, actLow, actHigh?, obsLow, obsHigh?, value:{code,dn,sys}, textRef, nameRef, problemStatus?:'active'|'resolved'}
export function problem(p) {
  const ps = p.problemStatus
    ? `
<entryRelationship typeCode="REFR">
  <observation classCode="OBS" moodCode="EVN">
    <templateId root="2.16.840.1.113883.10.20.22.4.6"/>
    <code code="33999-4" displayName="Status" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC"/>
    <statusCode code="completed"/>
    ${
      p.problemStatus === "resolved"
        ? `<value xsi:type="CD" code="413322009" displayName="Resolved" codeSystem="2.16.840.1.113883.6.96" codeSystemName="SNOMED CT"/>`
        : `<value xsi:type="CD" code="55561003" displayName="Active" codeSystem="2.16.840.1.113883.6.96" codeSystemName="SNOMED CT"/>`
    }
  </observation>
</entryRelationship>`
    : "";
  const dn = p.value.dn === undefined ? "" : "";
  return `<act classCode="ACT" moodCode="EVN">
  <templateId root="2.16.840.1.113883.10.20.22.4.3"/>
  <templateId root="2.16.840.1.113883.10.20.22.4.3" extension="2015-08-01"/>
  ${idEl(p.root, p.act)}
  <code code="CONC" displayName="Concern" codeSystem="2.16.840.1.113883.5.6"/>
  <statusCode code="${p.actStatus ?? "active"}"/>
  <effectiveTime>
    <low value="${p.actLow}"/>${p.actHigh ? `\n    <high value="${p.actHigh}"/>` : ""}
  </effectiveTime>
  <entryRelationship typeCode="SUBJ">
    <observation classCode="OBS" moodCode="EVN">
      <templateId root="2.16.840.1.113883.10.20.22.4.4"/>
      <templateId root="2.16.840.1.113883.10.20.22.4.4" extension="2015-08-01"/>
      ${idEl(p.root, p.obs)}
      <code code="55607006" displayName="Problem" codeSystem="2.16.840.1.113883.6.96" codeSystemName="SNOMED CT">
        <translation code="75326-9" displayName="Problem" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC"/>
      </code>
      <text>
        ${ref(p.textRef)}
      </text>
      <statusCode code="completed"/>
      <effectiveTime>
        <low value="${p.obsLow}"/>${p.obsHigh ? `\n        <high value="${p.obsHigh}"/>` : ""}
      </effectiveTime>
      ${code("value", p.value, `\n        <originalText>\n          ${ref(p.nameRef)}\n        </originalText>\n      `, ' xsi:type="CD"')}${ind(ps, 6)}
    </observation>
  </entryRelationship>
</act>${dn}`;
}

// i: {root, id|null, date, cvx:{code,dn}, textRef, nameRef, lot?, route?, site?, performer?}
export function immunization(i) {
  const route = i.im
    ? `\n  <routeCode code="C28161" displayName="INTRAMUSCULAR" codeSystem="2.16.840.1.113883.3.26.1.1" codeSystemName="NCI Thesaurus"/>`
    : "";
  const site = i.site
    ? `\n  ${code("approachSiteCode", { ...i.site, sys: "snomed" })}`
    : "";
  const dose = i.doseMl
    ? `\n  <doseQuantity value="${i.doseMl}" unit="mL"/>`
    : "";
  const lot = i.lot
    ? `\n        <lotNumberText>${esc(i.lot)}</lotNumberText>`
    : "";
  const perf = i.performer
    ? `\n  <performer>\n    <assignedEntity>\n      <id root="${i.performer.root}" extension="${i.performer.ext}"/>\n      <assignedPerson>\n        <name>\n          <given>${esc(i.performer.given)}</given>\n          <family>${esc(i.performer.family)}</family>\n          <suffix>${esc(i.performer.suffix)}</suffix>\n        </name>\n      </assignedPerson>\n    </assignedEntity>\n  </performer>`
    : "";
  return `<substanceAdministration classCode="SBADM" moodCode="EVN" negationInd="false">
  <templateId root="2.16.840.1.113883.10.20.22.4.52"/>
  <templateId root="2.16.840.1.113883.10.20.22.4.52" extension="2015-08-01"/>
  ${idEl(i.root, i.id)}
  <text>
    ${ref(i.textRef)}
  </text>
  <statusCode code="completed"/>
  <effectiveTime value="${i.date}"/>${route}${site}${dose}
  <consumable>
    <manufacturedProduct classCode="MANU">
      <templateId root="2.16.840.1.113883.10.20.22.4.54"/>
      <templateId root="2.16.840.1.113883.10.20.22.4.54" extension="2014-06-09"/>
      <manufacturedMaterial>
        ${code("code", { ...i.cvx, sys: "cvx" }, `\n          <originalText>\n            ${ref(i.nameRef)}\n          </originalText>\n        `)}${lot}
      </manufacturedMaterial>
    </manufacturedProduct>
  </consumable>${perf}
</substanceAdministration>`;
}

// p: {root, id, code:{code,dn,sys}, date, textRef, nameRef}
export function procedure(p) {
  return `<procedure classCode="PROC" moodCode="EVN">
  <templateId root="2.16.840.1.113883.10.20.22.4.14"/>
  <templateId root="2.16.840.1.113883.10.20.22.4.14" extension="2014-06-09"/>
  ${idEl(p.root, p.id)}
  ${code("code", p.code, `\n    <originalText>\n      ${ref(p.nameRef)}\n    </originalText>\n  `)}
  <text>
    ${ref(p.textRef)}
  </text>
  <statusCode code="completed"/>
  <effectiveTime value="${p.date}"/>
</procedure>`;
}

// o: {root, id, panel:{code,dn}, time, obs:[{id, loinc:{code,dn}, textRef, v:{PQ:[value,unit]}|{ST:text}, interp?:'N'|'H'|'L'|'A', lo?, hi?, unit?}]}
const INTERP = { N: "Normal", H: "High", L: "Low", A: "Abnormal" };
export function organizer(o) {
  const comps = o.obs.map((x) => {
    let value;
    if (x.v.PQ)
      value = `<value xsi:type="PQ" value="${x.v.PQ[0]}" unit="${esc(x.v.PQ[1])}"/>`;
    else value = `<value xsi:type="ST">${esc(x.v.ST)}</value>`;
    const interp = x.interp
      ? `\n<interpretationCode code="${x.interp}" displayName="${INTERP[x.interp]}" codeSystem="2.16.840.1.113883.5.83" codeSystemName="ObservationInterpretation"/>`
      : "";
    let rr = "";
    if (x.rangeText) {
      rr = `\n<referenceRange>\n  <observationRange>\n    <text>${esc(x.rangeText)}</text>\n  </observationRange>\n</referenceRange>`;
    } else if (x.lo !== undefined || x.hi !== undefined) {
      const u = x.v.PQ[1];
      rr = `\n<referenceRange>\n  <observationRange>\n    <value xsi:type="IVL_PQ">${x.lo !== undefined ? `\n      <low value="${x.lo}" unit="${esc(u)}"/>` : ""}${x.hi !== undefined ? `\n      <high value="${x.hi}" unit="${esc(u)}"/>` : ""}\n    </value>\n  </observationRange>\n</referenceRange>`;
    }
    return `<component>
  <observation classCode="OBS" moodCode="EVN">
    <templateId root="2.16.840.1.113883.10.20.22.4.2"/>
    <templateId root="2.16.840.1.113883.10.20.22.4.2" extension="2015-08-01"/>
    <id root="${o.root}" extension="${x.id}"/>
    ${code("code", { ...x.loinc, sys: "loinc" })}
    <text>
      ${ref(x.textRef)}
    </text>
    <statusCode code="completed"/>
    <effectiveTime value="${o.time}"/>
    ${value}${ind(interp + rr, 4)}
  </observation>
</component>`;
  });
  return `<organizer classCode="BATTERY" moodCode="EVN">
  <templateId root="2.16.840.1.113883.10.20.22.4.1"/>
  <templateId root="2.16.840.1.113883.10.20.22.4.1" extension="2015-08-01"/>
  <id root="${o.root}" extension="${o.id}"/>
  ${code("code", { ...o.panel, sys: "loinc" })}
  <statusCode code="completed"/>
  <effectiveTime>
    <low value="${o.time}"/>
    <high value="${o.time}"/>
  </effectiveTime>
${comps.map((c) => ind(c, 2)).join("\n")}
</organizer>`;
}

// vitals: {root, id, time, sys, dia, ids:[a,b], refs:[r1,r2]}
export function bp(v) {
  const one = (id, c, dn, val, r) => `<component>
  <observation classCode="OBS" moodCode="EVN">
    <templateId root="2.16.840.1.113883.10.20.22.4.27"/>
    <templateId root="2.16.840.1.113883.10.20.22.4.27" extension="2014-06-09"/>
    <id root="${v.root}" extension="${id}"/>
    <code code="${c}" displayName="${dn}" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC"/>
    <text>
      ${ref(r)}
    </text>
    <statusCode code="completed"/>
    <effectiveTime value="${v.time}"/>
    <value xsi:type="PQ" value="${val}" unit="mm[Hg]"/>
  </observation>
</component>`;
  return `<organizer classCode="CLUSTER" moodCode="EVN">
  <templateId root="2.16.840.1.113883.10.20.22.4.26"/>
  <templateId root="2.16.840.1.113883.10.20.22.4.26" extension="2015-08-01"/>
  <id root="${v.root}" extension="${v.id}"/>
  <code code="46680005" displayName="Vital signs" codeSystem="2.16.840.1.113883.6.96" codeSystemName="SNOMED CT">
    <translation code="74728-7" displayName="Vital signs, weight, height, head circumference, oximetry, BMI, and BSA panel - HL7.CCDAr1.1" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC"/>
  </code>
  <statusCode code="completed"/>
  <effectiveTime value="${v.time}"/>
${ind(one(v.ids[0], "8480-6", "Systolic blood pressure", v.sys, v.refs[0]), 2)}
${ind(one(v.ids[1], "8462-4", "Diastolic blood pressure", v.dia, v.refs[1]), 2)}
</organizer>`;
}

export function smoking(s) {
  return `<observation classCode="OBS" moodCode="EVN">
  <templateId root="2.16.840.1.113883.10.20.22.4.78"/>
  <templateId root="2.16.840.1.113883.10.20.22.4.78" extension="2014-06-09"/>
  <id root="${s.root}" extension="${s.id}"/>
  <code code="72166-2" displayName="Tobacco smoking status" codeSystem="2.16.840.1.113883.6.1" codeSystemName="LOINC"/>
  <text>
    ${ref(s.textRef)}
  </text>
  <statusCode code="completed"/>
  <effectiveTime value="${s.time}"/>
  <value xsi:type="CD" code="266919005" displayName="Never smoked tobacco" codeSystem="2.16.840.1.113883.6.96" codeSystemName="SNOMED CT"/>
</observation>`;
}
