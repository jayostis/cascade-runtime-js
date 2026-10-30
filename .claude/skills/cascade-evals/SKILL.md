---
name: cascade-evals
description: Run the eval harness in packages/evals (the pod through cascade-mcp against pasted records, on synthetic people), from a plan with an estimate and a hard cap to results.json and the report site. Use when asked to run an eval, a smoke, standard or full tier, or to record or report a run.
---

# Running the eval harness from Claude Code

There is no API key on this machine, so Claude Code is the runner: each subject and judge is an agent, and the
harness reads each agent's transcript for its exact per-call usage. Everything that reads or writes the run is the
harness's CLI; never write a run's files by hand.

`CLI` below is `node packages/evals/dist/src/cli.js`, from the repository root, after `npx tsc -b packages/evals`.

## 1. Plan, and show the estimate first

`CLI plan --config smoke` (or `standard`, `full`, or a config file). It prepares each case (its downloads and pod, once
per input), reuses every job whose inputs are unchanged, and prints the estimate against the cap. A standard or full
run is planned and its estimate shown to the maintainer before anything runs; run it only once they say so. A smoke
run (one case, one run per arm, no judges) needs no approval.

The plan's folder is `packages/evals/runs/<run>/` (gitignored): `plan.json`, `prompts/`, `answers/`, `judges/`.

## 2. Run

**With the Workflow tool** (the maintainer's go-ahead first; it plans the run itself):

```
Workflow({
  scriptPath: "packages/evals/workflow/eval-run.js",
  args: {
    config: "smoke",
    run: "<a new run id>",
    cli: "<absolute path of packages/evals/dist/src/cli.js>"
  }
})
```

`config` is a tier name or a config file; with `folder: "<absolute run folder>"` in place of `config` it runs a run
already planned. It plans, meters, starts the jobs the cap allows in waves, plans and runs the blind judges, and
finishes.

**Without it**, the same loop by hand:

1. `CLI meter --run <run>`: its JSON lists `next`, the jobs that may start now without passing the cap.
2. For each `next` job, start one Agent (subagent_type general-purpose, `model` the job's `alias`) whose prompt is the
   job's `prompt` text exactly as the meter gives it (its first line is the job's eval-tag, which is how the harness
   finds its transcript). Start them together, in the background, and wait for every one.
3. When every agent of the wave has finished (the meter runs between waves: a job it handed out that left no
   transcript then fails), repeat from 1 until `next` is empty.
4. `CLI judges --run <run>` writes the blind packets and plans the judges (none in a smoke run); repeat 1 to 3 for them.
5. `CLI finish --run <run>`: the program checks, grades, scores, `results.json` (validated against
   `schemas/results.schema.json`) and the site in `runs/<run>/site/`.

Never give an agent anything but its prompt: no hints about the case, the key or the other arm.

## 3. Report and record

- Report the run's `budget.spent` against `budget.estimate` and the cap, and the path of `runs/<run>/site/index.html`.
- `npm run evals:record <run>` copies `results.json`, the answers and the verdicts into `packages/evals/history/`, which
  is committed and which reuse also reads. A pull request claiming the pod answers better includes its recorded run.
- `npm run evals:report -- --history` builds the site over every recorded run; CI builds it and deploys it under
  `/evals/` from main.
