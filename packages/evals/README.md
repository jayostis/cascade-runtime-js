# cascade-evals

An eval harness for the pod against pasted records. On synthetic people with keys written before any run, the same
model answers the same task twice: once reaching the pod only through `cascade-mcp` (the **pod** arm), once reading
every download in full (the **records** arm, the records pasted into a chat). Program checks come first; blind judges
score the rest. Runs happen on demand, never in CI, and never on a real person's records.

Recorded runs: **[jayostis.github.io/cascade-runtime-js/evals/](https://jayostis.github.io/cascade-runtime-js/evals/)**.

## What is here

- `cases/<case>/`: a synthetic person. `case.json` (who, today, the description a report shows, the downloads and the
  order the pod imports and the records arm reads them), `generate.mjs` (writes the downloads beside the vocabulary
  kit's copies), `key.json` (the machine-readable key: one item per gap, trap or near-trap, with its evidence, the
  links the reasoning must state, and what counts as found, partly found or wrong) and `key.md` (the rationale and its
  guideline citations). A case must say `"synthetic": true`, and its downloads must hash to the digest its key was
  written against.
- `configs/`: the tiers. **smoke**: one case, one run per arm, programs only. **standard**: every case, one run, one
  judge. **full**: three runs, two judges and their agreement. Each config names the subject and judge models (judges
  are cheap models picked by calibration, #550) and a hard cap in tokens and dollars.
- `schemas/`: case, key, config, answer, verdict and results. `results.schema.json` is the contract a runner fills.
- `src/citations.ts`: the citation checker, exported as `cascade-evals/citations` for an app to check a model's answer:
  a cited line, FHIR resource or pod entry exists and holds the date and values claimed; an absence counts only when
  its query ran and its coverage is stated.
- `workflow/eval-run.js` and the skill `.claude/skills/cascade-evals/`: how Claude Code runs it.
- `prices.json` (dated list prices) and `priors.json` (the first estimates, from the hand-run comparison of
  2026-10-30, until recorded runs replace them).

## Running it

```sh
npx tsc -b packages/evals
node packages/evals/dist/src/cli.js plan --config smoke      # prepares the case, prints the estimate against the cap
```

then the skill's loop, or the workflow, runs the jobs the cap allows and `finish` writes `runs/<run>/results.json` and
`runs/<run>/site/`. `node packages/evals/dist/src/cli.js` with no command lists every command.

- **Budgets.** Every job has an estimate before it runs: the mean of recorded runs of the same case, arm and model,
  else the prior. No job starts that would pass the cap; the run stops cleanly and `results.json` says which were
  held back.
- **Reuse.** A job whose inputs are unchanged is not run again: the case, its downloads, the model, the prompt, and for
  the pod arm the runtime's packages and the components it resolves; for a judge, the answers and the key. The records
  arm reruns only when its case, model or prompt changes. Reuse reads `runs/` and `history/`.
- **Stats.** Every model call is recorded with its role, model, input, cache and output tokens, time and tool calls,
  and priced from `prices.json`. Run from Claude Code, the calls come from each agent's transcript, so the usage is the
  API's own (`usageSource: transcript`, cost `exact`). A runner on the Claude API with MCP tool use, when there is a
  key, fills the same fields from its responses (`usageSource: api`).

## Recording a run, and the habit

`runs/` is gitignored: a run's transcripts, prompts and site stay on the machine that ran it.
`npm run evals:record <run>` copies its `results.json`, answers and verdicts into `history/<date>-<commit>-<tier>/`,
which is committed. CI builds the site from `history/` on every pull request and deploys it from main under `/evals/`;
`npm run evals:report -- --history` builds it locally, and `npm run evals:report -- <run folder>` one run's.

**A pull request that claims the pod answers better includes its recorded run,** so the diff of `history/` shows the
scores move.
