# Answer key: Priya Natarajan at scale

Written 2026-10-30, before any arm ran. Scorers only: never show this file, `inputs_l.md`'s notes or the generator to an
arm.

- **Evaluation "today": 2026-10-30.** Every "overdue" and "not done" below is judged on that date.
- **Priya Natarajan:** female, born 1968-11-04, **57** (58 on 2026-11-04). Never smoker. Problems: prediabetes
  2020-2025, hyperlipidemia (2022), essential hypertension (2023), type 2 diabetes (diagnosed 2025-09-22), hay fever.
  Aspirin allergy (hives); atorvastatin intolerance (muscle aches, Kestrel Harbor only); lisinopril intolerance (cough,
  Fernhill only).
- The inputs are listed in [case.json](case.json): 18 downloads, 2,472,816 bytes. File references below are
  relative to this file, `file:line`; `D` stands for the case's downloads folder.
- Clinical sources are those of `../research/real_world_gaps.md` ("research", with its item number) unless named.
- What changed from round 1: the same person and story, grown back to 2020 and on to October 2026, and every portal
  summary downloaded several times (Kestrel Harbor 4 C-CDAs and an Apple Health export, Fernhill 5, Alder Street
  Pharmacy 4, Northbay 2). Each planted item below depends on reading across those repeats. Round 1's G1 (Shingrix),
  G2 (HCTZ), G3 (uACR), G4 (statin), G5 (nodule) and G6 (TSH) survive in changed forms as G5, G3, G1, G2, G7 and G6.

> The prose half of this case's key: the rationale and its guideline citations. The machine-readable half is
> [key.json](key.json); the case itself is [case.json](case.json). Moved from the hand-run comparison of 2026-10-30
> (`epic-care-gaps/comparison/key/answer_key.md` in the-cascade-protocol), where it was written before any arm ran.
> File references are relative to the case's downloads folder; "research #N" is that comparison's
> `research/real_world_gaps.md`. Each item's "Pod" line describes the comparison's pod arm (35 questions through a
> command), not cascade-mcp's tools; key.json's `pod` field says only where the pod holds the fact.

## Scoring rules (enough on their own for a blind scorer)

1. **Each planted gap** (G1-G7): mark it **found**, **partly** or **missed**. Found means the arm's output has the
   item's "Found" minimum. Partly means the right topic but part of that minimum is missing, no evidence is named, or
   the item's "Partly" line applies. Missed means it is not raised.
2. **False questions:** count one for each of these:
   - a raised trap (T1-T4), in the way its "Wrong" line says;
   - a raised near-trap from the near-trap list below;
   - an item's "Wrong" line, when the arm states it;
   - any other claim that the records contradict.

   Nothing else is false. A claim an item's "Partly" line covers is scored there and is not also counted false.

3. **Not false:** pre-existing items (P…) and generic questions. Items marked "legitimate find" count as correct extra
   finds, reported apart from the planted-gap recall. A true statement that a result exists but its content is not in
   the records the arm saw is not false either.
4. **Counting copies.** The same result, medication or vaccine appears in many downloads. A copy is not an event. Any
   count, frequency or trend an arm states must count distinct events (one specimen time, one dose, one prescription).
   A count inflated by copies is a false claim (rule 2); T2 and T4 are the planted cases.
5. **Stale states.** An older download's status (a medicine "Active" in 2022 or 2024) is history, not the present. Read
   the latest statement of each source and the dates of stops. Citing an old download as the current state is false
   when a later one contradicts it (T1, G2's "Wrong", G3's "Wrong").
6. **Citation check:** for every record an arm cites, check that it exists in the inputs and says what the arm claims.
   Report the number cited, the number correct, and the wrong ones. A citation of an older copy of the same fact is
   correct.
7. **Totals:** report each arm's gap score with and without G7. G7 is narrative-only, so its ceiling for the pod arm is
   zero. Also report T4 apart (see its "Pod" line: the pod arm lacks the label that gives it away).
8. **Three arms.** Scored arms: **full** = all 18 downloads; **latest** = each source's latest download only
   (`saltmarsh-regional-medical-center-ed-summary.xml`, `kestrel-harbor-health-summary-4.xml`,
   `clearwater-eye-associates-visit-summary.xml`, `fernhill-family-clinic-summary-5.xml`,
   `northbay-clinical-laboratories-results-2.xml`, `alder-street-pharmacy-patient-record-4.xml`); **pod** =
   `eval-priya-l` through `pod.mjs`. What each arm can see:

   | item                     | full                                         | latest                                            | pod                                                                           |
   | ------------------------ | -------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
   | G1 uACR                  | yes                                          | yes (KH-4; diabetes in Fernhill-5)                | yes: one row 2023-06-15                                                       |
   | G2 statin                | yes; stale "Active" bait in KH-1 and Alder-1 | yes (KH-4 stop, allergy, LDLs); **no stale bait** | yes: atorvastatin completed (ended 2024-08-07), allergy, LDLs; no reason text |
   | G3 HCTZ                  | yes, with reason and fills                   | yes (KH-4 stop, Fernhill-5 active, Alder-4 fills) | partly: "active"; the stop only as a non-lead member; no reason, no fills     |
   | G4 potassium             | yes, with result notes                       | yes                                               | yes via `lab_series` / lab rows; `find_changes` fails (see G4)                |
   | G5 Shingrix              | yes (3 copies)                               | yes (1 copy)                                      | yes: one row                                                                  |
   | G6 TSH                   | yes, with coded order                        | yes (KH-4 has the whole series and the order)     | partly: 7.90 H and no repeat; order not visible                               |
   | G7 nodule                | yes                                          | yes                                               | **no** (ceiling 0)                                                            |
   | T1 lisinopril            | bait present (4 stale copies)                | **n/a: no stale copy**                            | lead stopped; FHIR active member is non-lead                                  |
   | T2 A1c copies            | 5 copies                                     | 2 copies (weaker)                                 | one row, `records` 2                                                          |
   | T3 flu 2026              | only in the newest pharmacy file             | in its only pharmacy file (weaker)                | one row                                                                       |
   | T4 TSH 2025              | yes, with "historical" label                 | yes, with label                                   | separate row, no label                                                        |
   | P1 old Fernhill lists    | visible                                      | not visible                                       | merged away                                                                   |
   | P14 mammograms           | 3 dated                                      | 3 dated                                           | one merged row                                                                |
   | narrative facts (rule 9) | all                                          | all                                               | none                                                                          |

   For the **latest** arm: score T1 as **n/a**, and report T2, T3 and G2's "Wrong" apart from its other false
   questions, because that arm never sees their bait or sees less of it. State its false-question count with this
   caveat. Its gap ceiling is the full seven (each source's latest file holds everything its older ones do).

9. **Narrative-only facts:** the pod arm cannot see them. It sees none of these:
   - every encounter or visit note, discharge instruction and plan, including KH's coded planned TSH (G6);
   - the reasons in medication tables ("muscle aches", "hyponatremia", "cough"), though the atorvastatin and
     lisinopril intolerances are coded allergies the pod does carry;
   - pharmacy fill dates and refills (G3), and Fernhill's result notes of 2026-09-02 and 09-30 (G4);
   - the label "historical result from Kestrel Harbor Hospital" on Fernhill's TSH (T4);
   - the CT text (G7), the colonoscopy's and mammograms' results, the eye exam findings, vital signs.

   Do not require them unless an item's "Found" line does.

## How to score

- **Gap** (G…): credit when the arm raises the question with the minimum content under "Found". A find with no
  evidence named is partly.
- **Trap** (T…): a false question when raised as its "Wrong" line says. Mentioning the fact correctly is not a penalty.
- **Pre-existing** (P…): true things in the records that were not planted. Not false; neither credit nor penalty unless
  marked "legitimate find".
- **Generic** questions are neither credit nor penalty.
- Anything else is scored on its merits.

## Her story as the records tell it

**Kestrel Harbor Hospital (KH)** was her primary care until mid-2025 (Kestrel Harbor Internal Medicine, Susan Park, MD;
Tdap, flu, COVID-19 vaccines; mammograms 2020, 2022, 2024; colonoscopy 2019). Prediabetes from 2020 (A1c 5.8 rising to
6.4 in 2024). LDL 148 (2022-01-25), then 168 after six months of diet; **atorvastatin 20 mg started 2022-08-09** (LDL 93 and 99 on it); **stopped 2023-11-14
for muscle aches** (CK normal), coded as an intolerance; never restarted; LDL 158 off it in 2024 and she wanted to try
diet first. Hypertension 2023-06-15: **lisinopril**; a **urine albumin/creatinine ratio of 18 mg/g that day**, the only
one ever. TSH rose 2.10 (2020), 2.60, 3.10, 3.60, **4.60 H (2024-08-20)**. Amlodipine added 2025-04-01. She moved her
primary care to **Fernhill Family Clinic** (Elena Marsh, MD; first seen 2024-10-15 for hay fever). On **2025-09-22**
Fernhill diagnosed **type 2 diabetes** (A1c 6.9, LDL 142), started metformin and switched **lisinopril to losartan for
cough**; no statin, no uACR. Fernhill's labs run at **Northbay Clinical Laboratories**, whose portal and Fernhill's
both carry every result. ED visit at Saltmarsh 2025-10-18 (kidney stone; incidental lung nodule on CT). Alder Street
Pharmacy gave flu, **Shingrix dose 1** and PCV20 on 2025-11-08. Fernhill added **HCTZ** 2025-12-09. **KH admitted her
2026-03-02 to 03-05 with sodium 123, stopped HCTZ, found TSH 7.90 H** and ordered a repeat for 2026-04-14 to 04-28.
Fernhill never learned of the stop: HCTZ stays on its list, and the pharmacy keeps filling it (2026-04-02, 07-01,
09-30). Eye exam at Clearwater 2026-05-14. On **2026-08-17** Fernhill, believing her on three drugs (losartan,
amlodipine, HCTZ), added **spironolactone**; potassium then rose 4.6, 4.9, **5.2 H, 5.6 H (2026-10-13)** with
creatinine 0.94 to 1.06. The pharmacy gave the **2026-27 flu shot on 2026-10-03**.

## Planted gaps

### G1. Urine albumin/creatinine ratio done once, in 2023, never since the diabetes diagnosis

- **Kind:** gap. **Depends on scale:** absence over years among dozens of labs; the single uACR is repeated in four
  downloads, which can read as "monitored".
- **Evidence:** uACR (LOINC 14959-1) **18 mg/g on 2023-06-15**, KH, `D/kestrel-harbor-health-summary-4.xml:1819`
  (also in files 2, 4 and the Apple export, `D/export-2025-06-15/apple_health_export/clinical-records/Observation-enEtXqxasVEEMoXmTAgaSEgITeY.json`).
  None since, in any source. Diabetes from 2025-09-22, `D/fernhill-family-clinic-summary-5.xml:483`; also hypertension,
  on losartan and spironolactone. In the same period: 20 eGFR results from three labs (KH, Northbay, Saltmarsh), the
  last 61 on 2026-10-13 (`D/fernhill-family-clinic-summary-5.xml:639`).
- **Decoy inside the gap:** the ED's dipstick "Protein, urine Negative" (2025-10-18,
  `D/saltmarsh-regional-medical-center-ed-summary.xml:481`) is not a uACR.
- **Rate:** 38.7% uACR vs 94.1% eGFR in CKD with type 2 diabetes (research #1). ADA: uACR at diagnosis and at least
  yearly.
- **Good question:** "I was diagnosed with diabetes in September 2025 and my last urine albumin test (uACR) was in June 2023. Should I have one now?"
- **Found:** names the urine albumin / uACR / microalbumin test, that none was done since the diabetes diagnosis (or
  since 2023), with diabetes (or diabetes plus hypertension) as the reason.
- **Partly:** says uACR was "never done" (the 2023 one exists).
- **Wrong:** saying it is up to date or done regularly; citing the dipstick as a uACR; saying her kidneys need nothing
  because eGFR is normal.
- **Pod:** `pod/My lab results --where code=http://loinc.org/rdf/14959-1`: one row, 2023-06-15, `records` 2 (KH C-CDA
  and FHIR). `lab_series` 98979-8: 18 rows; 88294-4: 2 more (2020, 2021).

### G2. Statin stopped in 2023 for muscle aches, never restarted, now indicated (diabetes at 57, LDL 142 and 147)

- **Kind:** gap. **Depends on scale:** state across versions (active in the 2022 KH download and the 2024 pharmacy
  download, stopped from the 2024 KH download on) and absence of any later statin over three years.
- **Evidence:**
  - Atorvastatin 20 mg started 2022-08-09, "Active" in `D/kestrel-harbor-health-summary.xml:202` (status line 205).
    "Discontinued November 14, 2023 (muscle aches)" from `D/kestrel-harbor-health-summary-2.xml:279` on (and
    `-4.xml:303`); visit note "stop atorvastatin", `-4.xml:7901`. Coded intolerance "Muscle aches",
    `D/kestrel-harbor-health-summary-2.xml:116`. FHIR `MedicationRequest` status `stopped`,
    `D/export-2025-06-15/apple_health_export/clinical-records/MedicationRequest-eUF12sstVRv3FvUMJSAasufT5r2.json`.
  - Pharmacy: "Active, 2 refills remaining" on 2024-02-12, `D/alder-street-pharmacy-patient-record.xml:188`
    (last fill 2023-10-02); "Inactive (prescription expired August 7, 2024)" from file 10 on
    (`D/alder-street-pharmacy-patient-record-4.xml:188`).
  - No statin, ezetimibe or other lipid drug in any later list. Fernhill's lists never mention atorvastatin or the
    intolerance.
  - LDL 158 off statin (2024-08-20, KH), **142 (2025-09-22)** and **147 (2026-08-17)**,
    `D/fernhill-family-clinic-summary-5.xml:724` and `:676`. Born 1968-11-04 (every header, e.g.
    `D/fernhill-family-clinic-summary-5.xml:30`). Hyperlipidemia active on KH's list, `-4.xml:524`.
- **Rate:** about 35% of statin-eligible adults on one (research #9). ADA: moderate-intensity statin for diabetes aged
  40-75; after statin-associated muscle symptoms, rechallenge with another statin or dose (ADA Section 10; ACC/AHA
  2018).
- **Good question:** "I stopped atorvastatin in 2023 because of muscle aches. Since then I was diagnosed with diabetes
  and my LDL is 147. Should I try a different statin or another cholesterol medicine?"
- **Found:** no current statin, with diabetes (or age, or LDL 142/147) as the reason. Naming the 2023 stop for muscle
  aches is not required.
- **Partly:** says she has "never" been on a statin.
- **Wrong:** saying she takes atorvastatin now (citing file 1 or the 2024 pharmacy record); saying a statin is
  contraindicated because of the intolerance; recommending a specific drug and dose as settled.
- **Pod:** `pod/My medication history`: atorvastatin `completed`, ended **2024-08-07** (the pharmacy's expiry leads; KH's
  `stopped` and 2023-11-14 are non-lead members in `entry/What it shows`); `pod/My active allergies`: Atorvastatin; LDL
  rows (13457-7); `record/What each version says --where field=…#dateOfBirth`: 1968-11-04.

### G3. Hydrochlorothiazide stopped at the 2026-03 discharge, still active and refilled everywhere else

- **Kind:** gap. **Depends on scale:** one stop in one source against "active" in many earlier and later downloads of
  three other sources.
- **Evidence:**
  - KH stopped it: "Discontinued March 5, 2026 (hyponatremia)", `D/kestrel-harbor-health-summary-4.xml:291` (entry
    `MED-2611`, `aborted`, ended 2026-03-05); "STOP taking hydrochlorothiazide", `:7965`; sodium 123 (L) on 2026-03-02;
    discharge diagnosis "Hyponatremia, likely due to hydrochlorothiazide", `:7860`.
  - Fernhill still lists it active after the stop: `D/fernhill-family-clinic-summary-4.xml:234` and
    `D/fernhill-family-clinic-summary-5.xml:234`; on 2026-08-17 Fernhill added spironolactone because she was "on
    losartan 50 mg, amlodipine 5 mg and hydrochlorothiazide 12.5 mg", `-5.xml:3257`.
  - Alder Street Pharmacy: active and refilled after the stop, last filled 2026-07-01
    (`D/alder-street-pharmacy-patient-record-3.xml:250`) and **2026-09-30** (`-4.xml:250`); fills 2026-04-02 and 07-01
    in the fill history.
  - Clearwater's patient-reported list, 2026-05-14, has it (`D/clearwater-eye-associates-visit-summary.xml:204`).
  - Sodium 134 (L) on 2026-06-15 and 2026-10-13 (`D/fernhill-family-clinic-summary-5.xml:682`, `:640`).
- **Rate:** 50.6% had medication discrepancies 24 h after discharge; 1.5% of discontinued drugs later dispensed
  (research #6).
- **Good question:** "The hospital stopped my hydrochlorothiazide in March 2026 because my sodium was low, but my clinic
  still lists it, the pharmacy refilled it in September, and the clinic added spironolactone thinking I was on three
  blood-pressure drugs. Should I be taking it?"
- **Found:** names HCTZ (or "the water pill"), the hospital stop in March 2026, and that a later list or refill still has
  it active. The reason, the refills and the spironolactone link are optional.
- **Wrong:** advising her to keep taking it without noting the stop; saying it was stopped everywhere.
- **Pod:** `pod/My active medications`: HCTZ active, `records` 4 (Fernhill, pharmacy, KH, Clearwater). The stop is only a
  non-lead member: `workflowStatus` stopped, `medicationUseEndDate` 2026-03-05 in `entry/What it shows`. `timeline`
  shows the lead (active). Fills are not in the pod.

### G4. Potassium rising into the high range on losartan plus spironolactone, last 5.6, no recorded action

- **Kind:** gap. **Depends on scale:** a trend across 20 potassium results from three labs, each later one carried by
  two documents, with a drug started in only the latest downloads.
- **Evidence:** spironolactone 25 mg from 2026-08-17 (`D/fernhill-family-clinic-summary-5.xml:235`; pharmacy fills
  08-17, 09-15, 10-14, `D/alder-street-pharmacy-patient-record-4.xml:255`), with losartan since 2025-09-22. Potassium
  4.2 (2026-06-15), 4.6 (08-17), 4.9 (09-01), **5.2 H (09-29)**, **5.6 H (10-13)**,
  `D/fernhill-family-clinic-summary-5.xml:669` to `:641`, and Northbay
  `D/northbay-clinical-laboratories-results-2.xml:171`. Creatinine 0.94 to 1.06, eGFR 71 to 61 over the same weeks.
  Fernhill's last note (2026-09-30, narrative) asked for a repeat in 2 weeks. There is no recorded action on the 10-13
  result: it has no note, and the spironolactone is still active and was refilled 10-14. Fernhill-5 was downloaded 7
  days after it, so a call or portal message would not show.
- **Rate:** research #11 (monitoring of potassium on RAAS drugs); ACC/AHA and KDIGO: with an ARB plus an MRA, check K and
  creatinine early and reduce or stop the MRA when K exceeds 5.0-5.5.
- **Good question:** "Since spironolactone was added in August my potassium has gone up to 5.6 (October 13), on top of
  losartan. Does my dose need changing, and when is my next check?"
- **Found:** rising or high potassium (5.2/5.6, or "high twice") on spironolactone with losartan (or "since the new
  blood-pressure medicine"), raised as needing attention.
- **Wrong:** counting the copies (rule 4: "potassium high four times"); saying potassium is normal. **Not wrong:**
  saying nothing was done about the 5.6, or asking whether anyone has acted on it.
- **Pod:** `lab_series` 2823-3 and `pod/My lab results` give every value, `records` 2 for Northbay results (Fernhill and
  Northbay). `find_changes` with `313096` (or the exact name "spironolactone 25 MG Oral Tablet") and 2823-3 returns
  **"not enough results"**: KH writes `mmol/l`, Northbay and Saltmarsh `mmol/L` (both valid UCUM), and the tool counts
  the 9 `mmol/L` values (8 Northbay, Saltmarsh's 3.9) as another unit. The same split hides sodium after HCTZ
  (`199903`, 2951-2). A short name ("spironolactone", "losartan") returns an error. Tool limits worth reporting, not
  data errors.

### G5. Second Shingrix dose never given (dose 1 at the pharmacy, repeated in three downloads)

- **Kind:** gap. **Depends on scale:** one dose repeated in three pharmacy downloads; the pharmacy gave a flu shot in
  October 2026 and no Shingrix.
- **Evidence:** Shingrix (CVX 187) 2025-11-08, Alder Street Pharmacy, `D/alder-street-pharmacy-patient-record-2.xml:760`,
  `-3.xml:808`, `-4.xml:909` (entry `VX-251108-2`). No second CVX 187 anywhere. Fernhill's immunizations show only the
  2024-10-15 flu shot (`D/fernhill-family-clinic-summary-5.xml:598`); KH's none of zoster.
- **Rate:** 40.4% of adults 50+ had at least one zoster dose and 24.1% two or more RZV doses (research #4).
- **Good question:** "I had my first Shingrix shot in November 2025. The second was due within 2-6 months. Should I get
  it now?"
- **Found:** Shingrix/shingles vaccine, one dose recorded (Nov 2025, pharmacy), second missing or due.
- **Wrong:** saying the series is complete (counting the three copies as doses); saying it must be restarted; saying
  none was ever given.
- **Pod:** `pod/My immunizations`: one CVX 187 row, `given` 2025-11-08, `records` 1; source Alder Street Pharmacy.

### G6. TSH rising for six years, 7.90 at the hospital, coded repeat for April 2026 never done

- **Kind:** gap. **Depends on scale:** a slow trend over six years of annual labs, then an abnormal result whose coded
  follow-up order has no result in any of the nine later downloads.
- **Evidence:** TSH 2.10, 2.60, 3.10, 3.60, 4.60 H (2020-2024, KH), **7.90 H (2026-03-03)** with free T4 1.0 (normal),
  `D/kestrel-harbor-health-summary-4.xml:1220` and `:1226`. Coded planned observations (moodCode RQO) for TSH and free
  T4, due **2026-04-14 to 2026-04-28**, `-4.xml:7969` (entries `ORD-77104`, `ORD-77105`, line 7977); discharge
  instruction `:7967`. No TSH after 2026-03-03 in Fernhill's or Northbay's results (draws 06-15, 08-17, 09-01, 09-29,
  10-13 are BMPs, A1c and lipids).
- **Rate:** research #7 (abnormal results needing outpatient follow-up after discharge).
- **Good question:** "My TSH was 7.9 in the hospital in March 2026, after creeping up for years, and they wanted it
  repeated in April. I don't see a repeat. Should I have one?"
- **Found:** the high TSH in March 2026 and that no repeat followed. The planned date and the earlier trend are
  optional.
- **Wrong:** diagnosing hypothyroidism or advising levothyroxine as settled; saying it was repeated (see T4).
- **Pod:** TSH rows (3016-3), 7.90 on 2026-03-03 with `resultInterpretationCode` H and range 0.40-4.00 in `entry/What
it shows`. The planned order is in no question (the plan section is not read).

### G7. Incidental 7 mm lung nodule, follow-up chest CT recommended, never done (**narrative-only**)

- **Kind:** gap. **Narrative-only:** no row of any of the 35 questions on `eval-priya-l` mentions a nodule, the lung or
  Fleischner (checked 2026-10-30). Only the dump arm can see it.
- **Evidence:** Saltmarsh CT 2025-10-18, findings and impression "Incidental 7 mm solid pulmonary nodule … non-contrast
  CT of the chest is recommended in 6-12 months", `D/saltmarsh-regional-medical-center-ed-summary.xml:545` and `:546`.
  No chest CT in any later download (KH's 2026 admission included). Window closed 2026-10-18.
- **Rate:** 29% follow-up for ED CTA nodules with explicit instructions; 51.7% at one year (research #3).
- **Good question:** "A CT in October 2025 found a small lung nodule and recommended a chest CT in 6-12 months. I don't
  see one. Should I have it?"
- **Found:** a lung nodule on the October 2025 CT, a follow-up CT recommended, not done.
- **Wrong:** inventing a size or a cancer risk; saying the follow-up was done.

## Planted traps

### T1. Lisinopril "active" in four older downloads, properly stopped for cough with a replacement

- **Kind:** trap. **Depends on scale:** stale state across versions.
- **Evidence:** "Active" in KH's 2024 and 2025 C-CDAs (`D/kestrel-harbor-health-summary-2.xml:270`, `-3.xml:276`, status
  lines 273, 279), the 2025 Apple export
  (`D/export-2025-06-15/apple_health_export/clinical-records/MedicationRequest-eQgPPfguqDY5KO38qAH6c9hsjAZ.json`) and
  the 2024 pharmacy record ("Active, 3 refills remaining", `D/alder-street-pharmacy-patient-record.xml:196`). Stopped
  2025-09-22 "because of dry cough, changed to losartan" (`D/fernhill-family-clinic-summary-3.xml:230`), "Discontinued
  September 22, 2025 by outside provider (cough); replaced by losartan" (`D/kestrel-harbor-health-summary-4.xml:297`),
  "Discontinued by prescriber September 22, 2025" at the pharmacy (`D/alder-street-pharmacy-patient-record-2.xml:196`). Losartan filled since 2025-09-23.
  Lisinopril intolerance (cough) on Fernhill's allergy list.
- **Why raising it is false:** the stop is deliberate, recorded with its reason by three sources, and replaced the same
  day.
- **Wrong:** "you may be on both lisinopril and losartan"; "lisinopril was stopped, should it be restarted"; "your blood
  pressure treatment lapsed"; listing lisinopril as a current medicine.
- **Pod:** `pod/My medication history`: lisinopril `stopped`, ended 2025-09-22 (lead); the FHIR member `active` is a
  non-lead in `entry/What it shows`. `pod/My active allergies`: Lisinopril.

### T2. The same A1c in five downloads (and every result in many)

- **Kind:** trap. **Depends on scale:** duplicate copies across repeated downloads of two sources.
- **Evidence:** A1c 6.9% at 2025-09-22T16:15Z is one draw (Northbay accession NB25-265-4471), in
  `D/fernhill-family-clinic-summary-3.xml:644`, `-4.xml:654`, `-5.xml:725`,
  `D/northbay-clinical-laboratories-results.xml:473` and `-2.xml:760`. The same holds for every Fernhill-ordered
  result (up to five copies) and every KH result (up to four C-CDA copies plus the FHIR copy). Distinct A1c tests: 11
  in all (KH 7, 2020-2024; Northbay 4: 6.9, 6.7, 6.6, 6.8), 4 since the diagnosis, about every 3-4 months.
- **Rate:** an HIE's account of resent results; vendor-claimed 10-30% duplication (research T7).
- **Why raising it is false:** one blood draw, reported by the clinic and the lab, downloaded again each time.
- **Wrong:** "A1c tested several times in September 2025" or "two A1c tests on one date"; any A1c count above 11 (or
  above 4 since diagnosis); "A1c checked too often".
- **Pod:** `pod/My lab results`: one 6.9 row, `records` 2 (Fernhill, Northbay); `pod/What was seen more than once`.

### T3. 2026-27 flu shot: given, only in the pharmacy's latest download

- **Kind:** trap. **Depends on scale:** a fact present in only the newest of four downloads of one source; the
  primary-care record shows only a 2024 flu shot.
- **Evidence:** influenza vaccine (Fluarix, CVX 140, lot FL9M4C) on **2026-10-03**,
  `D/alder-street-pharmacy-patient-record-4.xml:895` and `:896` (entry `VX-261003-1`, line 929). Absent from files 3, 10
  and 15 (downloaded before it). Fernhill's list has only 2024-10-15 (`D/fernhill-family-clinic-summary-5.xml:598`).
- **Why raising it is false:** she had this season's flu shot four weeks ago.
- **Wrong:** "no flu shot this season / you are due for a flu shot"; "last flu shot November 2025". Asking about a
  2026-27 COVID-19 vaccine is not this trap (P13).
- **Pod:** `pod/My immunizations`: CVX 140, `given` 2026-10-03, source Alder Street Pharmacy.

### T4. A TSH "in September 2025" that is the 2024 result keyed into the new clinic's chart

- **Kind:** trap. **Depends on scale:** one result duplicated under a different date, which makes a trend out of
  nothing.
- **Evidence:** Fernhill's results carry "TSH 4.60 m[IU]/L (High) … collected September 22, 2025 (historical result
  from Kestrel Harbor Hospital, entered September 22, 2025)", `D/fernhill-family-clinic-summary-3.xml:645` (also `-4.xml:655`,
  `-5.xml:726`). It is KH's 4.60 of **2024-08-20** (`D/kestrel-harbor-health-summary-4.xml:1544`, KH-4 note
  `:7885`). No TSH was drawn on 2025-09-22: Northbay's 2025-09-22 accession has a CMP, a lipid panel and an A1c only.
- **Rate:** outside results abstracted at a new-patient visit and dated the day entered (research T7's mechanism of
  re-sent results).
- **Why raising it is false:** there were only two high TSH values (2024-08-20 and 2026-03-03), 19 months apart.
- **Wrong:** "TSH 4.6 in September 2025"; "TSH rose from 4.6 to 7.9 in six months"; "TSH was high three times"; "TSH was
  checked at Fernhill". Not wrong: the six-year rise 2.10 to 7.90 (true), or quoting the row with its label.
- **Pod:** `pod/My lab results`: a separate TSH row `performed` 2025-09-22, 4.60, `records` 1, source Fernhill. The pod
  does not merge it with 2024-08-20 (different time), and no question carries the "historical result" label, so the
  pod arm has only the identical value and range to go on. Report T4 apart (rule 7).

## Pre-existing items (true, not planted; neither credit nor penalty unless marked)

Consequences of growing the story, audited against the records:

- **P1.** Fernhill's 2025 lists (files 5, 7) omit KH's lisinopril and amlodipine: a past reconciliation gap, closed from
  file 9 on.
- **P2.** Fernhill's records never mention the atorvastatin intolerance; KH's never mention the lisinopril intolerance.
  True; raised with G2 or T1 it supports them, raised alone it is neutral.
- **P3.** Fluticasone is "completed" at Fernhill from file 7 on with no stop date; the pharmacy shows one fill
  (2024-10-15) and expiry 2025-10-15.
- **P4.** Claritin (loratadine) has no start date; taken as needed; not filled at the pharmacy (over the counter).
- **P5.** Prediabetes for five years (A1c 5.8 to 6.4) before the diabetes diagnosis; the 2024 TSH was to be repeated
  "with next year's labs" and was not until the 2026 admission. True of the past; raised as history, neutral.
- **P6.** KH asked for primary-care follow-up within 1-2 weeks of the 2026-03-05 discharge
  (`D/kestrel-harbor-health-summary-4.xml:7966`); the next Fernhill visit is 2026-06-15. Raised alone, neutral; raised as
  why HCTZ was never reconciled, it counts towards G3.
- **P7.** Fernhill referred her to diabetes education on 2025-09-22 (narrative); no record of it.
- **P8.** The ED's acetaminophen (INT, ending 2025-11-01) is still `active` in the ED document and in `pod/My active
medications`; the kidney stone is still an active problem. Asking whether these are current is fine.
- **P9.** Sodium 134 (L) on 2026-06-15 and 2026-10-13; part of G3's evidence; raised alone, neutral.
- **P10.** eGFR has drifted from 88 (2020) to the low 70s (2025-2026) and fell to 61 with spironolactone. True; part of
  G4's context when tied to spironolactone. "CKD" is a near-trap (below).
- **P11.** Blood pressure above goal on 2026-08-17 (148/92); vital signs are not in the pod. Neutral.
- **P12.** A1c 6.8 on 2026-10-13, up from 6.6. True, neutral (generic diabetes question).
- **P13.** Valid absences, neutral: COVID-19 vaccine since 2022-10;
  hepatitis C and HIV one-time screening; cervical screening; a yearly diabetic foot exam; a repeat urinalysis after
  the ED's 3+ blood; B12 on metformin (13 months, not yet long-term); RSV vaccine (ages 50-59 only with a risk
  condition).
- **P14.** Screening mammogram: last 2024-10-08 (BI-RADS 2, KH), biennial, so due about now. True, neutral. In the pod
  the three mammograms (2020, 2022, 2024) are merged into **one** `pod/My procedures` row dated 2024-10-08 with
  `records` 6: a pod merge defect worth reporting. A pod arm that says "one mammogram on record" is repeating it, and is
  not penalised.
- **P15.** Two diabetes rows in `pod/My active conditions` (SNOMED, and Clearwater's ICD-10 E11.9). Harmless.
- **P16.** Aspirin allergy reaction severity "Moderate" at KH; others state none. Neutral.
- **P17.** The pharmacy's atorvastatin "completed, ended 2024-08-07" (expiry) leads in the pod, not KH's 2023-11-14
  stop. Quoting either date is not false.
- **P18. Hepatitis B vaccine never given: legitimate find** (rule 3; credit optional, never false). ACIP 2022 (Weng et
  al., MMWR 2022;71:477) recommends HepB for all adults 19-59, and diabetes is a separate indication. She is 57 with no
  HepB dose in any source.
- **P19.** In the Apple Health export, the amlodipine `MedicationRequest`
  (`D/export-2025-06-15/apple_health_export/clinical-records/MedicationRequest-enaC7dYZehIDvMlt5NoHKNSLKN8.json`) has
  `authoredOn` 2025-04-01 but `export.xml` stamps it `receivedDate` 2025-03-29: received before it was written. A data
  quirk; harmless to every item. Flagging it as a data error is true and neutral.

## Near-traps (false if raised; the merged records disprove them)

- "You need a pneumococcal vaccine": PCV20 2025-11-08, `D/alder-street-pharmacy-patient-record-4.xml:902`.
- "Colorectal screening is due / no colonoscopy": normal colonoscopy 2019-04-16
  (`D/kestrel-harbor-health-summary-4.xml:751`), next 2029.
- "No diabetic eye exam / one is due": Clearwater 2026-05-14, no retinopathy
  (`D/clearwater-eye-associates-visit-summary.xml:476`), next due 2027-05. "Ask what it showed" is fine for the pod arm.
- "Tdap is due": Tdap 2020-01-14 (`D/kestrel-harbor-health-summary-4.xml:900`), next 2030.
- "You have CKD stage 3 / eGFR below 60": the lowest eGFR is 61 (2026-10-13); two below 60 at least 90 days apart would
  be needed.
- "No flu shot this season": T3.
- "You are on atorvastatin" or "you are on lisinopril": G2's and T1's "Wrong".
- Any count of tests inflated by copies: rule 4.
- A causal claim from a before/after association (the pod's `find_changes` ranks these first): "fluticasone (or
  amlodipine) raised your blood sugar / A1c", "stopping atorvastatin raised your A1c". False: her glucose and A1c have
  risen since 2020 with her diabetes; intranasal fluticasone has negligible systemic glucose effect, amlodipine is
  metabolically neutral, and statins slightly raise A1c. Not false: "eGFR dipped after losartan started" (77 to 75,
  the expected ARB effect) and "eGFR fell after spironolactone" (P10).

## Generic questions (neither credit nor penalty)

"Ask about your blood pressure goals"; "ask how your diabetes is going / your A1c target"; "ask whether all your
medicines are still needed"; "ask about diet and exercise"; "bring all your medicine bottles"; "ask whether the kidney
stone passed".

## Her other questions

Written 2026-10-31 from her records, before any arm answered them. Each of these is scored by its items alone: a negation or fact is **found**, **partly** or **missed** by its
"found" and "partly" lines in key.json, a trap is **raised** or **avoided**. Anything else an answer says is beyond the
key, and judged on its merits: fair, true but not planted, speculative, or contradicted by the records.

### "Am I still supposed to be taking lisinopril?" (lisinopril)

- **N7.** No. Fernhill stopped lisinopril on 2025-09-22 for a dry cough and changed her to losartan
  (`fernhill-family-clinic-summary-3.xml:230`); Kestrel Harbor (`kestrel-harbor-health-summary-4.xml:297`) and the
  pharmacy (`alder-street-pharmacy-patient-record-2.xml:196`) agree.
- **T5.** Four older downloads still say active (T1's evidence). Telling her to keep taking it is the trap.

### "Have I had my flu shot this season?" (flu-shot)

- **F1.** Yes: Fluarix on 2026-10-03 at Alder Street Pharmacy, lot FL9M4C
  (`alder-street-pharmacy-patient-record-4.xml:895`), only in the pharmacy's latest download.
- **T6.** Fernhill's list stops at the 2024-10-15 shot (`fernhill-family-clinic-summary-5.xml:598`): "your last flu
  shot was in 2024" or "you are due" is the trap.

## Summary

| id  | kind | one line                                                                               | depends on scale through                   |
| --- | ---- | -------------------------------------------------------------------------------------- | ------------------------------------------ |
| G1  | gap  | uACR once (2023-06-15), none since diabetes 2025-09; eGFR x20                          | absence over years; one result repeated 4x |
| G2  | gap  | atorvastatin stopped 2023-11 (muscle aches), never restarted; diabetes, LDL 142/147    | state across versions; absence             |
| G3  | gap  | HCTZ stopped at KH discharge 2026-03-05; active at Fernhill and refilled to 2026-09-30 | one stop vs many repeats                   |
| G4  | gap  | K 4.2 to 5.6 on losartan + spironolactone (from 2026-08-17), no action                 | trend across many duplicated BMPs          |
| G5  | gap  | Shingrix dose 1 2025-11-08 (pharmacy, 3 copies), no dose 2                             | one dose repeated                          |
| G6  | gap  | TSH rising to 7.90 (2026-03-03); coded repeat 2026-04-14..28 not done                  | six-year trend; absence after              |
| G7  | gap  | 7 mm lung nodule on ED CT 2025-10-18, chest CT not done                                | **narrative-only**                         |
| T1  | trap | lisinopril "active" in 4 old downloads; stopped 2025-09-22 for cough, losartan         | stale state                                |
| T2  | trap | A1c 6.9 (2025-09-22) in 5 downloads is one test                                        | duplicate copies                           |
| T3  | trap | 2026-27 flu shot 2026-10-03, only in the pharmacy's latest download                    | newest download only                       |
| T4  | trap | Fernhill's "TSH 4.60 2025-09-22" is KH's 2024-08-20 result keyed in                    | duplicate with a new date                  |
