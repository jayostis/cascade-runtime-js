# Judge calibration (#550)

Done on 2026-10-30. The numbers are in [calibration.json](calibration.json), and `test/calibration.test.ts` holds the
standard tier to them.

## What was measured

- **The answers.** The 33 answers of the hand-run comparison of 2026-10-30: Tamsin 6, Priya 18, Priya at scale 9.
- **The reference.** The comparison's two blind Opus 5.5 scorings of each answer. Six answers were scored in two rounds,
  so they have four. An item is in the reference only where every Opus scoring of it agrees: 407 items. The 4 items
  where the scorings split are left out (below).
- **The judges.** Haiku 5.5 and Sonnet 5.5, one run each, through the harness's own judge path: `judgePackets` (the
  blinding scrub, the order, the key with `pod` and `find` removed, the prompt), the meter and transcripts for the
  cost, and `gradesOf` for the verdicts. Each packet holds the answers of one Opus round, at most 9, each answer once.
  The full tier's packets hold 6.
- **Agreement** is the same verdict on the same item: found, partly or missed for a gap; raised or avoided for a trap
  or near-trap. Kappa is Cohen's, with `agreementOf`'s formula, pooled over every item of all three cases rather than
  per case.

| judge             | items agreed | agreement | kappa | gaps only (181)        | cost, 33 answers | tokens |
| ----------------- | ------------ | --------- | ----- | ---------------------- | ---------------- | ------ |
| claude-haiku-5-5  | 404 / 407    | 99.3%     | 0.987 | 181 / 181, kappa 1.000 | $0.38            | 1.66M  |
| claude-sonnet-5-5 | 404 / 407    | 99.3%     | 0.987 | 179 / 181, kappa 0.950 | $1.98            | 1.96M  |

The harness's estimate before the run was $1.67. Haiku and Sonnet agree with each other on 407 of 411 items (99.0%).

**Choice: Haiku 5.5 is the standard tier's judge.** It is the cheapest judge that reaches 95% agreement both on every item and on the
gap items alone, at about a fifth of Sonnet's cost. The full tier keeps Sonnet beside Haiku, so their agreement is still reported.

## Where the judges disagree with the reference

**Haiku 5.5**

- **Tamsin, two answers, TT1 raised** (`pod_tamsin_r1` Q5, `records_tamsin_r1` Q3). Both ask whether metformin should
  be restarted, "nothing else was started for ten months". Opus scored this neutral, because both name Jardiance as
  current. Haiku called it the trap's "nothing replaced it" wording and said itself that it was borderline.
- **Priya at scale, `pod_priyal_r1` T1 raised** (Q8, "the hospital still lists lisinopril as active", read from the
  stale 2025 copy). The Opus scorers counted this as a false question outside T1, because the answer says the drug was
  stopped. Sonnet made the same call as Haiku.

**Sonnet 5.5**

- **`guidedhaikupod_priya_r2` and `_r3`, G2 missed where Opus gave partly.** The answers name HCTZ and the sodium of 123
  but not the hospital's stop. The key's "partly" covers this; Sonnet read the item as not raised at all.
- **`pod_priyal_r1` T1 raised**, as Haiku above.

## The 4 items left out of the reference

| answer                    | item | the Opus split                       | Haiku  | Sonnet |
| ------------------------- | ---- | ------------------------------------ | ------ | ------ |
| `records_priya_r1`        | N3   | avoided / raised                     | raised | raised |
| `guidedhaikupod_priya_r3` | N3   | avoided / raised                     | raised | raised |
| `haikupod_priya_r1`       | G1   | partly / found, then partly / partly | found  | found  |
| `haikupod_priya_r3`       | G1   | partly / found, then partly / partly | found  | found  |

## What the format change costs

The comparison's answers are prose: Q, Why, "Based on" and Confidence. They predate the JSON chain the harness's
subjects write. Each was turned into the harness's answer form by program, with no model in the loop:

- the question, why and confidence were kept;
- "Based on" became one fact, its leading provider split off where there was one;
- each "Absent:" clause became an absence;
- knowledge was left empty, since the prose form folds it into Why.

`blinded()` then rendered the answers exactly as it renders a subject's. What this costs:

- **No per-fact split and no knowledge field.** Every judge saw an empty "Knowledge:" line and took the knowledge from
  Why. That bears on chain completeness, not on item verdicts, and this calibration measures only item verdicts.
- **The scrub ran on text never written for it.** It removed words such as "records", "resources" and "21 results"
  from answers the Opus scorers read whole. No disagreement above turns on a removed word.
- **The keys are the harness's** (`cases/*/key.json` and `key.md`), not the comparison's `answer_key.md` and
  `answer_key_l.md`. They hold the same items under the same ids, with the evidence rewritten as checkable claims.
- **No downloads.** The judges read only their packet. The Opus scorers also checked citations against the downloads.
  Item verdicts did not need them, but false-question counts do, so those are not calibrated here.
- **Mostly easy items.** 226 of the 407 are traps and near-traps, nearly all avoided. On the 181 gap items alone,
  Haiku agrees on all of them and Sonnet on 179.

## Seen while running

- **Haiku kept the judge discipline:** it read the packet and wrote with Write.
- **Sonnet broke it in two of five jobs.** It wrote the verdict from a Node script run through Bash, which
  the prompt does not allow. The verdicts were valid.

**What one run per judge costs.** Each judge ran once, so these numbers carry no estimate of run-to-run noise: a
second run could move a few items either way. The one lean seen is Haiku's: it raises a trap on a borderline answer
where Opus stays neutral (both Tamsin TT1 calls), so expect Haiku's trap counts to run slightly high.

Recalibrate when the judge prompt, the key format or a judge model changes. Two things a recalibration should add:
packets of the full tier's size, and false questions alongside item verdicts.
