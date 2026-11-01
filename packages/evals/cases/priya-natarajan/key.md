# Answer key: Priya Natarajan

Written 2026-10-30, before any arm ran. Scorers only: never show this file, `inputs.md`'s notes or the file names'
history to an arm.

- **Evaluation "today": 2026-10-30.** Every "overdue" and "not done" below is judged on that date.
- **Priya Natarajan:** female, born 1968-11-04, **57** (58 on 2026-11-04). Never smoker. Problems: essential
  hypertension (2023), type 2 diabetes (diagnosed 2025-09-22), hay fever. Aspirin allergy (hives); lisinopril
  intolerance (cough).
- The inputs are listed in [case.json](case.json). File references below are relative to the case's downloads folder, `file:line`.
- Clinical sources are those of `../research/real_world_gaps.md` ("research", with its item number) unless named.

## Scoring rules (enough on their own for a blind scorer)

1. **Each planted gap** (G1-G6, TG1-TG2): mark it **found**, **partly** or **missed**. Found means the arm's output has
   the item's "Found" minimum. Partly means the right topic but part of that minimum is missing, or no evidence is
   named. Missed means it is not raised.
2. **False questions:** count one for each of these:
   - a raised trap (T1-T4, TT1-TT2), in the way its "Wrong" line says;
   - a raised near-trap from the near-trap lists below;
   - any other claim that the records contradict.

   Nothing else is false.

3. **Not false:** pre-existing items (P…, PT…) and generic questions. Some pre-existing items are marked "legitimate
   find" (PT6, PT7); count those as correct extra finds, reported apart from the planted-gap recall. A true statement
   that a result exists but its content is not in the records the arm saw is not false either. For example: "an eye
   exam was done in May 2026, ask what it showed" (T1), or "a CT angiogram followed the high D-dimer and its result
   isn't in my records" (TT2).
4. **Citation check:** for every record an arm cites, check that it exists in the inputs and says what the arm claims.
   Report the number cited, the number correct, and the wrong ones.
5. **Totals:** report each arm's gap score twice, with and without G5. G5 is narrative-only, so its ceiling for the pod
   arm is zero. Also note that TT2 is hard for the pod arm to fail. The refuted PE is in no `pod/My …` view; it appears
   only in `record/Why it is in no view` as `RefutedAtSource`. So TT2 is not a symmetric test of judgment.
6. **Narrative-only facts:** the pod arm cannot see them. It sees none of these:
   - the HCTZ stop reason and the April refill (G2);
   - the TSH repeat advice (G6);
   - the colonoscopy's "normal" (T4);
   - the eye exam findings (T1);
   - the CT angiogram text (TT2).

   Do not require them unless an item's "Found" line does.

## How to score

- **Gap** (G…): credit when the arm raises the question with the minimum content under "found". Partial credit is the
  scorers' call, but a find with no evidence named is not credit.
- **Trap** (T…): a false question. Penalise when the arm raises it as a gap in the way "wrong" says. Mentioning the fact
  correctly ("your colonoscopy in 2019 was normal; the next is due in 2029") is not a penalty.
- **Pre-existing** (P…): true things already in the kits' records, or true consequences of the story that were not
  planted. They are **not false**: a find of one is neither credit for a gap nor a penalty. A scorer may note them.
- **Generic** questions (the list at the end of each person) are neither credit nor penalty.
- Anything else is scored on its merits: a claim the records contradict is a false question.

> The prose half of this case's key: the rationale and its guideline citations. The machine-readable half is
> [key.json](key.json); the case itself is [case.json](case.json). Moved from the hand-run comparison of 2026-10-30
> (`epic-care-gaps/comparison/key/answer_key.md` in the-cascade-protocol), where it was written before any arm ran.
> File references are relative to the case's downloads folder; "research #N" is that comparison's
> `research/real_world_gaps.md`. Each item's "Pod" line describes the comparison's pod arm (35 questions through a
> command), not cascade-mcp's tools; key.json's `pod` field says only where the pod holds the fact.

## Priya

### Her story as the records tell it

Kestrel Harbor Hospital (KH) diagnosed hypertension and started lisinopril in 2023 and added amlodipine on 2025-04-01.
Fernhill Family Clinic (Dr Elena Marsh) is her primary care. On 2025-09-22 Fernhill diagnosed type 2 diabetes (A1c
6.9%, fasting glucose 138), started metformin ER, and switched lisinopril to losartan for cough. On 2025-10-18 she went to
the Saltmarsh Regional Medical Center emergency department with a kidney stone; the CT also showed a lung nodule. On
2025-11-08 Alder Street Pharmacy gave her flu, Shingrix and PCV20 vaccines. On 2025-12-09 Fernhill added
hydrochlorothiazide (HCTZ). KH admitted her 2026-03-02 to 03-05 with sodium 123 and stopped HCTZ; it also found TSH 7.9.
Clearwater Eye Associates did a dilated diabetic eye exam on 2026-05-14. Fernhill saw her on 2026-06-15 and
continued "current medications", HCTZ included. Northbay Clinical Laboratories ran Fernhill's blood tests.

### Planted gaps

#### G1. Second Shingrix dose never given (dose 1 at a pharmacy)

- **Kind:** gap. **Pod feature:** cross-source, absence, dates.
- **Evidence:** Shingrix (CVX 187) given **2025-11-08** by Alder Street Pharmacy:
  `alder-street-pharmacy-patient-record.xml:492` (immunization entry `VX-251108-2`). No second
  CVX 187 in any source. Fernhill's immunization list (the PCP) shows only the 2024-10-15 flu shot:
  `fernhill-family-clinic-summary-4.xml:568`.
- **Rate:** 40.4% of adults 50+ had at least one zoster dose and 24.1% two or more RZV doses (research #4, CDC NHIS 2023).
- **Good question:** "I had my first Shingrix shot at the pharmacy in November 2025. The second dose was due 2-6 months
  later and I don't see it. Should I get it now?"
- **Found:** names Shingrix/shingles vaccine, that one dose is recorded (Nov 2025, pharmacy) and that the second is
  missing or due now.
- **Wrong:** saying the series must be restarted; saying she is not eligible (she is 57); saying no zoster vaccine was
  ever given.
- **Pod:** `pod/My immunizations`, one CVX 187 row, `given` 2025-11-08; `entry/Where it came from` gives Alder Street
  Pharmacy.

#### G2. Hydrochlorothiazide stopped at hospital discharge, still active at the clinic and the pharmacy

- **Kind:** gap. **Pod feature:** cross-source, dates (a stop in one source against "active" in three later ones).
- **Evidence:**
  - KH stopped it for hyponatremia: medication `MED-2611` status `aborted`, ended **2026-03-05**,
    `kestrel-harbor-health-summary-5.xml:334` (narrative "Discontinued March 5, 2026
    (hyponatremia)", line 223); discharge instructions "STOP taking hydrochlorothiazide", line 1256; admission
    sodium 123 (L) on 2026-03-02, `LAB-61202` line 703; problem "Hyponatremia" resolved, line 524; encounter "likely
    due to hydrochlorothiazide", line 1241.
  - Fernhill still lists it active on 2026-06-22 (`fm-7`), `fernhill-family-clinic-summary-4.xml:234`,
    and the 2026-06-15 note says "Continue current medications", line 1260. Sodium 134 (L) on 2026-06-15, line 619.
  - Alder Street Pharmacy: active, last filled **2026-04-02** (90 days, 2 refills left), after the stop:
    `alder-street-pharmacy-patient-record.xml:218` (entry `RX6131090`, line 358).
  - Clearwater's patient-reported list, 2026-05-14, has it: `clearwater-eye-associates-visit-summary.xml:204`.
- **Rate:** 50.6% of patients had medication discrepancies 24 h after discharge; 1.5% of discontinued drugs were later
  dispensed; PSNet warfarin case (research #6).
- **Good question:** "The hospital stopped my hydrochlorothiazide in March 2026 because my sodium was low, but my clinic
  and pharmacy still have it active and it was refilled in April. Should I still be taking it?"
- **Found (minimum):** names HCTZ (or "the water pill"), that the hospital stopped it in March 2026, and that a later
  list still shows it active. The reason (low sodium) and the April refill are optional: they are narrative-only, and
  the pod arm can only infer the reason (sodium 123 on 2026-03-02).
- **Wrong:** advising her to keep taking it without noting the hospital's stop; saying she stopped it and nothing is
  outstanding.
- **Pod:** `pod/My active medications` lists HCTZ active (5 records, the pharmacy's leading). The stop is visible only
  in `entry/What it shows` (a non-lead `workflowStatus` "stopped" and `medicationUseEndDate` 2026-03-05) and per record
  in `record/What each version says`; `entry/Where it came from` names the four places. The `timeline` tool shows the
  lead's status only. This item tests whether an arm looks past the lead.

#### G3. Urine albumin-to-creatinine ratio never done, eGFR done five times

- **Kind:** gap. **Pod feature:** absence, cross-source (eGFR from three places).
- **Evidence:** type 2 diabetes from 2025-09-22, `fernhill-family-clinic-summary-3.xml:549`;
  also hypertension, on losartan. eGFR 75 on 2025-09-22 (Fernhill, `fernhill-family-clinic-summary-3.xml:762`, and Northbay), 63 on 2025-10-18 (Saltmarsh,
  `saltmarsh-regional-medical-center-ed-summary.xml:769`), 62 and 70 on 2026-03-02 and 03-05
  (KH, `kestrel-harbor-health-summary-5.xml:795` and 1040), 71 on 2026-06-15 (Fernhill,
  `fernhill-family-clinic-summary-4.xml:1068`). No LOINC 9318-7, 14959-1, 32294-1 or any
  urine albumin anywhere.
- **Decoy inside the gap:** the ED's urine dipstick protein "Negative" (2025-10-18, `SRM-L-102`,
  `saltmarsh-regional-medical-center-ed-summary.xml:584`) is not a uACR.
- **Rate:** 38.7% had uACR vs 94.1% eGFR in CKD with type 2 diabetes (research #1, AJMC 2022). ADA: uACR at diagnosis
  and yearly.
- **Good question:** "I have diabetes and high blood pressure. My kidney blood test has been done several times but I
  don't see a urine albumin (uACR) test. Should I have one?"
- **Found:** names the urine albumin / albumin-creatinine / microalbumin test and that it is missing; diabetes (or
  diabetes plus hypertension) as the reason.
- **Wrong:** saying it was done (citing the dipstick); saying her kidneys need nothing because eGFR is normal.
- **Pod:** `pod/My lab results` (no uACR code; `lab_series` 98979-8 gives the five eGFRs); `pod/My active conditions`
  for the diabetes.

#### G4. No statin, with diabetes at 57 and LDL 142

- **Kind:** gap. **Pod feature:** absence, cross-source (diagnosis, lipids and age in different records).
- **Evidence:** diabetes (above); LDL 142 mg/dL (H), total cholesterol 221, HDL 48 on 2025-09-22,
  `fernhill-family-clinic-summary-3.xml:863` (also Northbay's copy). Born 1968-11-04 (every
  patient header). No statin in any medication list of any source.
- **Rate:** about 35% of statin-eligible adults on one; most with diabetes not (research #9, NHANES). ADA: moderate-
  intensity statin for diabetes aged 40-75.
- **Good question:** "I'm 57 with diabetes and my LDL was 142. Should I be on a statin?"
- **Found:** statin (or cholesterol medicine) not prescribed, with diabetes and age or the LDL as the reason.
- **Wrong:** saying she takes one; recommending a specific drug and dose as settled (a question is fine).
- **Pod:** `pod/My medication history` (no statin), `pod/My lab results` (LDL), `pod/My active conditions`,
  `record/What each version says --where field=…#dateOfBirth`.

#### G5. Incidental 7 mm lung nodule, follow-up chest CT recommended, never done (narrative-only)

- **Kind:** gap. **Pod feature: narrative-only.** The pod does not carry it: no row of any of the 35 questions on
  `eval-priya` mentions a nodule, the lung or Fleischner (checked 2026-10-30). Only the dump arm can see it; a pod arm
  can find it only by reading the document, which `pod.mjs` does not offer.
- **Evidence:** Saltmarsh ED CT abdomen/pelvis, 2025-10-18, Results section narrative: findings "a 7 mm solid nodule ...
  right lower lobe" and impression "Incidental 7 mm solid pulmonary nodule ... non-contrast CT of the chest is
  recommended in 6-12 months", `saltmarsh-regional-medical-center-ed-summary.xml:545` and 546. The ED discharge instructions (line 985 on) do not mention it. No chest CT anywhere afterwards; no source's
  problem list names it. Never smoker (low risk; Fleischner: CT at 6-12 months for a 6-8 mm solid nodule). The window
  closed 2026-10-18.
- **Rate:** 29% follow-up for ED CTA nodules with explicit report instructions; 51.7% completed at one year (research #3).
- **Good question:** "A CT at Saltmarsh in October 2025 found a small lung nodule and recommended a chest CT in 6-12
  months. I don't see one. Should I have it?"
- **Found:** a lung nodule on the October 2025 CT, a follow-up CT recommended, not done.
- **Wrong:** inventing a size or a cancer risk the report does not give; saying the follow-up was done.

#### G6. TSH 7.9 at the hospital, repeat recommended in 6-8 weeks, never repeated

- **Kind:** gap. **Pod feature:** dates (an abnormal result with nothing after it), absence.
- **Evidence:** TSH 7.9 m[IU]/L (H, 0.40-4.00) and free T4 1.0 (normal) on 2026-03-03, KH `LAB-61209`,
  `kestrel-harbor-health-summary-5.xml:889`. Discharge instructions: "have TSH and free T4
  repeated in 6-8 weeks", line 1258 (narrative). No later TSH in any source (Fernhill's 2026-06-15 panel and
  Northbay's results have none).
- **Rate:** nearest analogue research #7: 30-40% of tests pending at discharge are actionable, 65-84% of summaries
  omit them. This one was resulted but the follow-up depended on the outpatient side.
- **Good question:** "My thyroid test (TSH) was high in the hospital in March 2026 and they said to repeat it. Has it
  been repeated?"
- **Found:** the high TSH in March 2026 and that no repeat followed. (The 6-8 week instruction is narrative; an arm
  that flags the high TSH without repeat on its own reasoning gets full credit.)
- **Wrong:** diagnosing hypothyroidism or advising levothyroxine as settled.
- **Pod:** `pod/My lab results` (one TSH row) or `lab_series` 3016-3; the H flag and range in `entry/What it shows`.

### Planted traps

#### T1. Diabetic eye exam: done, by an optometrist (pairs with G3/G4, absence of a diabetes check)

- **Kind:** trap. **Pod feature:** cross-source.
- **Evidence:** Clearwater Eye Associates, 2026-05-14: procedure CPT 92004 "Comprehensive eye examination with
  dilation", `clearwater-eye-associates-visit-summary.xml:486`; findings "no diabetic
  retinopathy and no macular edema in either eye", line 476; diagnosis E11.9; plan: return in 12 months. Fernhill's own
  records never mention an eye exam.
- **Rate:** eye exams reach plans mostly as optometrist claims; ~50% done in commercial plans (research T1, #8).
- **Why raising it is false:** the exam was 5.5 months ago and the next is due 2027-05.
- **Wrong:** "you have no diabetic eye exam on record" or "you are due for one".
- **Pod:** `pod/My procedures` (2026-05-14, Clearwater via `entry/Where it came from`).

#### T2. Lisinopril stopped for cough and replaced by losartan (pairs with G2, a stopped drug)

- **Kind:** trap. **Pod feature:** dates, cross-source (the old FHIR copy still says active).
- **Evidence:** Fernhill: lisinopril `aborted`, ended 2025-09-22, "stopped ... because of dry cough, changed to
  losartan", `fernhill-family-clinic-summary-3.xml:230` and 306; lisinopril intolerance
  (cough), `AL-91`, line 174; losartan started 2025-09-22. KH agrees on 2026-03-10: `MED-2207` ended 2025-09-22,
  `kestrel-harbor-health-summary-5.xml:367`; losartan `MED-2604`, line 238. Losartan is active at
  the pharmacy, last filled 2026-06-28. Only Apple Health's 2023 FHIR `MedicationRequest` copy
  (`x-e8/apple_health_export/clinical-records/MedicationRequest-medrx-lisinopril-1.json`) still says `active`.
- **Rate:** discontinuation with a documented reason is the reconciliation ideal (research T3, PSNet).
- **Why raising it is false:** the stop was deliberate, the reason is recorded, the replacement started the same day,
  and both current lists agree.
- **Wrong:** "your lisinopril was stopped, should it be restarted"; "you may be on both lisinopril and losartan";
  "your blood pressure treatment lapsed". Neutral (no penalty): asking that the old hospital FHIR entry be updated.
- **Pod:** `pod/My medication history` (lisinopril stopped, ended 2025-09-22; losartan active from 2025-09-23),
  `pod/My active allergies` (Lisinopril).

#### T3. The same results arriving twice (duplicate merge)

- **Kind:** trap. **Pod feature:** duplicate merge.
- **Evidence:** every Fernhill-ordered result is in both Fernhill's C-CDA and Northbay's, same specimen time, same
  value: e.g. A1c 6.6% at 2026-06-15T15:30Z, `fernhill-family-clinic-summary-4.xml:940` and
  `northbay-clinical-laboratories-results.xml:556`; likewise the 2025-09-22 A1c, CMP and lipids
  and the 2025-12-09 A1c.
- **Rate:** an HIE's account of loops resending results; vendor-claimed 10-30% duplication (research T7).
- **Why raising it is false:** one blood draw each, reported by the clinic and by the lab.
- **Wrong:** "you had two A1c tests on 15 June 2026" (or on any date here); counting the copies as separate tests in a
  trend or a frequency ("A1c checked 6 times").
- **Pod:** `pod/My lab results` shows one row with `records` 2; `pod/What was seen more than once`.

#### T4. Colorectal screening not due: normal colonoscopy in 2019

- **Kind:** trap. **Pod feature:** cross-source, dates.
- **Evidence:** KH procedure colonoscopy (SNOMED 73761001) 2019-04-16,
  `kestrel-harbor-health-summary-5.xml:569`; result "Normal colon; no polyps. Repeat
  colonoscopy in 10 years", line 559. Fernhill's records have no colorectal screening.
- **Rate:** USPSTF 2021: 10-year interval after a normal colonoscopy (research T4; not fetched there).
- **Why raising it is false:** next due 2029.
- **Wrong:** "you are due/overdue for colorectal cancer screening"; "no colonoscopy on record".
- **Pod:** `pod/My procedures` (Colonoscopy 2019-04-16). The "normal" is only in the narrative; an arm that says "due
  in 2029 if it was normal" is correct.

### Pre-existing items (true, neither credit nor penalty)

From the kit's records (files 1-9):

- **P1.** Fernhill's 2025 medication lists (files 5, 7) omit lisinopril and amlodipine, which KH prescribed: a past
  reconciliation gap, closed by Fernhill's 2026 lists.
- **P2.** Aspirin reaction severity is "Mild" in KH's first two C-CDAs and "Moderate" from the third on; other sources
  state none.
- **P3.** Fluticasone is "completed" at Fernhill (file 7 on) with no stop date.
- **P4.** Claritin (brand loratadine) has no start date; taken as needed.
- **P5.** BP 148/92 on lisinopril (KH, 2025-03-27) led to amlodipine; later readings are lower. Vital signs are not in
  the pod.
- **P6.** Two files do not import: `export_cda.xml` (HealthKit heart-rate CDA) and `kestrel-harbor-health-summary-4.xml`
  (cut off). Saying one is unreadable or truncated is true.
- **P7.** Apple Health's FHIR copies are from 2025 and still show lisinopril active (see T2).

From the story added here, true but not planted:

- **P8.** The ED discharge medicines (ondansetron, acetaminophen; INT, end dates 2025-10-25 and 2025-11-01) still say
  `active` in the ED's document and in `pod/My active medications`; the kidney stone is still an active problem. Asking
  whether these are current is fine.
- **P9.** KH asked for primary-care follow-up within 1-2 weeks of the 2026-03-05 discharge; the next Fernhill visit in
  the records is 2026-06-15. Raised alone, neutral; raised as the reason HCTZ was never reconciled, it counts towards G2.
- **P10.** Fernhill referred her to diabetes education on 2025-09-22 (narrative); no record of it.
- **P11.** Sodium 134 (L) on 2026-06-15: true and part of G2's evidence; raised alone, neutral.
- **P12.** NSAIDs and aspirin allergy: the ED avoided ibuprofen and ketorolac because of it. Advice to avoid NSAIDs is
  true, neutral.
- **P13.** Valid absences not planted: hepatitis B vaccine (ACIP: adults 19-59; diabetes), Tdap/Td, COVID-19, a 2026-27
  flu shot, mammogram, cervical screening, one-time hepatitis C and HIV screening, a repeat lipid panel. Neutral.
- **P14.** More true absences, neutral:
  - a yearly comprehensive diabetic foot exam (ADA Section 12);
  - a repeat urinalysis to confirm that the 3+ blood seen in the ED on 2025-10-18 cleared (AUA/SUFU 2020);
  - B12 on metformin (13 months in, not yet "long-term");
  - RSV vaccine (ACIP: ages 50-59 only with a risk condition).
- **P8 also covers tamsulosin.** The ED lists it as active (INT, ending 2025-11-01). In the pod it is completed,
  because the pharmacy's record leads.

### Near-traps, Priya (false if raised; the merged records disprove them)

- "You need a pneumococcal vaccine": PCV20 was given 2025-11-08 at Alder Street Pharmacy
  (`alder-street-pharmacy-patient-record.xml:533`).
- "No flu shot since 2024": a flu shot was given 2025-11-08 at the pharmacy. Asking about a **2026-27** flu shot is
  fine (P13).
- "Your kidney function is declining" or "you have CKD stage 3": her eGFRs are 75, 63, 62, 70 and 71, none below 60.
  The two dips came during acute illnesses and recovered.
- "You had two A1c tests in June 2026" (or on any one date): this is T3.

### Generic questions (neither credit nor penalty)

"Ask about your blood pressure goals"; "ask how your diabetes is going / your A1c target"; "ask whether your
medicines are all still needed"; "ask about diet and exercise"; "ask whether the kidney stone passed / whether to see
urology"; "bring all your medicine bottles to your next visit".

## Her other questions

Written 2026-10-31 from her records, before any arm answered them. The scoring rules above score the check-up
question; each of these is scored by its items alone: a negation or fact is **found**, **partly** or **missed** by its
"found" and "partly" lines in key.json, a trap is **raised** or **avoided**. Anything else an answer says is beyond the
key, and judged on its merits: fair, true but not planted, speculative, or contradicted by the records.

### "Am I still supposed to be taking lisinopril?" (lisinopril)

- **N4.** No. Fernhill stopped lisinopril on 2025-09-22 because of a dry cough and changed her to losartan
  (`fernhill-family-clinic-summary-3.xml:230`, 306); the intolerance is recorded (AL-91, line 174, 187); Kestrel Harbor
  agrees (`kestrel-harbor-health-summary-5.xml:367`) and lists losartan active (line 238).
- **T5.** Only Apple Health's 2023 FHIR copy (`x-e8/.../MedicationRequest-medrx-lisinopril-1.json`) still says active,
  which is the app she means. Telling her to keep taking it, or to take it with losartan, is the trap.

## Summary

| id  | person | kind | one line                                                                                | pod feature                  |
| --- | ------ | ---- | --------------------------------------------------------------------------------------- | ---------------------------- |
| G1  | Priya  | gap  | Shingrix dose 1 at pharmacy 2025-11-08, no dose 2                                       | cross-source, absence, dates |
| G2  | Priya  | gap  | HCTZ stopped at KH discharge 2026-03-05, still active at Fernhill, refilled at pharmacy | cross-source, dates          |
| G3  | Priya  | gap  | no uACR in diabetes + hypertension; eGFR x5 from three places                           | absence, cross-source        |
| G4  | Priya  | gap  | no statin, diabetes at 57, LDL 142                                                      | absence, cross-source        |
| G5  | Priya  | gap  | 7 mm lung nodule on ED CT 2025-10-18, chest CT in 6-12 months not done                  | **narrative-only**           |
| G6  | Priya  | gap  | TSH 7.9 on 2026-03-03, repeat advised, none                                             | dates, absence               |
| T1  | Priya  | trap | diabetic eye exam done at Clearwater 2026-05-14                                         | cross-source                 |
| T2  | Priya  | trap | lisinopril stopped for cough 2025-09-22, losartan started                               | dates, cross-source          |
| T3  | Priya  | trap | each Fernhill result also in Northbay's document                                        | duplicate merge              |
| T4  | Priya  | trap | normal colonoscopy 2019-04-16, next 2029                                                | cross-source, dates          |
