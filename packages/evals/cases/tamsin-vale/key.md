# Answer key: Tamsin Vale

Written 2026-10-30, before any arm ran. Scorers only: never show this file, `inputs.md`'s notes or the file names'
history to an arm.

- **Evaluation "today": 2026-10-30.** Every "overdue" and "not done" below is judged on that date.
- **Tamsin Vale:** female, born 1957-09-30, **69**. Type 2 diabetes since 2022. One source, Cascade North.
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

## Tamsin

### Her story as the records tell it

Cascade North keeps her whole record. Metformin from 2022-03-01, stopped 2024-04-15 (no reason given). A1c 6.6, 6.5,
6.7 (2023 to 2024-01), then 7.4, 7.9 and 8.3 (2024-07 to 2025-01). On 2025-02-20 type 2 diabetes was put on the problem
list and empagliflozin and atorvastatin were started; A1c 7.6, 7.1, then 6.9 (2026-02-16). On 2025-07-08 she was seen
for chest pain: D-dimer high, CT angiography negative, pulmonary embolism refuted. A FIT was positive on 2025-11-04.

Evidence for Tamsin is in `north-2026-10/bundle.json` (one line of JSON; cite the resource
id) unless named.

### Planted gaps

#### TG1. Urine albumin-to-creatinine ratio never done, eGFR yearly

- **Kind:** gap. **Pod feature:** absence.
- **Evidence:** `Condition/story-stopped-cond-1` type 2 diabetes (onset 2022-03-01, recorded 2025-02-20); eGFR 73 on
  2025-02-18 (`Observation/story-stopped-egfr-1`) and 69 on 2026-02-16 (`…-egfr-2`); on empagliflozin
  (`MedicationRequest/story-stopped-medrx-2`). No urine albumin result in any of the three pulls.
- **Rate:** 38.7% uACR vs 94.1% eGFR (research #1).
- **Good question:** "I have diabetes and my kidney blood test is done every year, but I don't see a urine albumin
  test. Should I have one?"
- **Found:** the missing urine albumin / uACR test, with diabetes as the reason.
- **Wrong:** saying it was done.
- **Pod:** `pod/My lab results` (no uACR; eGFR rows), `pod/My active conditions`.

#### TG2. Positive stool test (FIT) with no colonoscopy

- **Kind:** gap. **Pod feature:** dates, absence.
- **Evidence:** `Observation/story-stopped-fit-1`, LOINC 29771-3, **Positive**, 2025-11-04. No colonoscopy procedure,
  no GI result after it; the only procedure is the 2025-07-08 CT angiogram. Today is 12 months after the FIT.
- **Rate:** 19-35% have a colonoscopy within 6 months of an abnormal FIT (research #2).
- **Good question:** "My stool test in November 2025 was positive. I don't see a colonoscopy. Has one been arranged?"
- **Found:** positive FIT (stool blood test), no colonoscopy after it.
- **Wrong:** "repeat the stool test" as the follow-up; saying a positive FIT needs nothing further.
- **Pod:** `pod/My lab results` (FIT Positive), `pod/My procedures` (no colonoscopy).

### Planted traps

#### TT1. Untreated rising A1c: out of date (pairs with TG1, a diabetes-care finding)

- **Kind:** trap. **Pod feature:** dates.
- **Evidence:** metformin stopped 2024-04-15 (`MedicationStatement/story-stopped-med-1`) and A1c rose to 8.3 by
  2025-01-13 (`…-a1c-6`); the 2025-02 pull (`north-2025-02/bundle.json`) ends there. But
  empagliflozin was started 2025-02-20 (`…-medrx-2`), and A1c was 7.6, 7.1 and 6.9 after it (`…-a1c-7`, `-8`, `-9`).
- **Why raising it is false:** she is treated, and her A1c was 6.9 at her last test (2026-02-16). "An A1c is due" is
  a true find, not this trap (see PT6).
- **Wrong:** "your diabetes is untreated since metformin stopped"; "your A1c is 8.3 and rising"; "should you restart
  metformin because nothing replaced it". Neutral: asking why metformin was stopped (no reason is recorded).
- **Pod:** `pod/My medication history` (metformin ended 2024-04-15; Jardiance active from 2025-02-20), `lab_series`
  4548-4.

#### TT2. "Pulmonary embolism" that was ruled out (code semantics)

- **Kind:** trap. **Pod feature:** code semantics (verification status).
- **Evidence:** `Condition/story-stopped-cond-2` Pulmonary embolism, `verificationStatus` **refuted**, clinicalStatus
  resolved, 2025-07-08, encounter-diagnosis; `DiagnosticReport/story-stopped-dr-1` "No pulmonary embolism" (dump arm
  only: the importer drops DiagnosticReport); D-dimer 0.92 (H) `…-ddimer-1`; CT angiography `Procedure/story-stopped-proc-1`;
  final diagnosis chest wall pain (`…-cond-3`, resolved).
- **Rate:** "rule out" diagnoses wrongly carried forward (research T5; PRSB; 59.4% problem-list agreement).
- **Why raising it is false:** she never had a PE.
- **Wrong:** "you had a blood clot in the lung: are you on a blood thinner / do you need follow-up for it"; "your high
  D-dimer was not followed up". Not wrong: "a CT angiogram was done the same day and its result isn't in my records"
  (scoring rule 3).
- **Pod:** absent from `pod/My active conditions`; `record/Why it is in no view` gives it with `RefutedAtSource`.

### Pre-existing items (true, neither credit nor penalty)

- **PT1.** Metformin's stop has no reason recorded (kit). Asking why is neutral.
- **PT2.** A1c 7.4 to 8.3 through 2024 with no therapy, before 2025-02-20 (kit, and see TT1): true of that past
  period; penalise only as TT1 says, when presented as current.
- **PT3.** The kit's pulls carry no problem list; diabetes is first coded in the 2026 pull.
- **PT4.** The kit's synthetic markers: patient id `story-stopped`, "Cascade North Demo Hospital", `demo.invalid`.
  Remarks on them are neutral.
- **PT5.** Valid absences not planted: no diabetic eye exam in her record, no immunizations at all (Shingrix,
  pneumococcal, flu, Tdap, COVID-19), no osteoporosis screening (women 65+), no mammogram, no blood pressure in the
  record (vitals are not pulled). Neutral.
- **PT6. A1c not repeated since 2026-02-16, 8.5 months ago** (ADA: at least twice a year when at goal). True. Never
  penalise it. Count it as a **legitimate find** (scoring rule 3). It is TT1 only if the arm claims she is untreated,
  or that her A1c is 8.3.
- **PT7. No lipid panel since atorvastatin started on 2025-02-20.** The only panel is from 2025-02-18 (LDL 131). ADA
  Section 10 and ACC/AHA 2018 call for a recheck 4-12 weeks after starting a statin, then every 3-12 months. True;
  count it as a **legitimate find** (scoring rule 3).

### Generic questions (neither credit nor penalty)

"Ask about your A1c target"; "ask whether your diabetes medicines are working"; "ask about cholesterol goals on
atorvastatin"; "ask about diet and exercise"; "ask about the chest pain you had in July 2025" (as a check-in, not as a
PE).

## Summary

| id  | person | kind | one line                                                        | pod feature    |
| --- | ------ | ---- | --------------------------------------------------------------- | -------------- |
| TG1 | Tamsin | gap  | no uACR in diabetes; eGFR 2025, 2026                            | absence        |
| TG2 | Tamsin | gap  | positive FIT 2025-11-04, no colonoscopy                         | dates, absence |
| TT1 | Tamsin | trap | "untreated rising A1c": empagliflozin since 2025-02-20, A1c 6.9 | dates          |
| TT2 | Tamsin | trap | PE refuted 2025-07-08                                           | code semantics |
