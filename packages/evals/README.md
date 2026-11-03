# cascade-evals

An eval harness for the pod against pasted records, on a person's own questions. On synthetic people with keys
written before any run, a person asks her questions in her own words, in chat sessions, one at a time, and the same
model answers each twice: once reaching her Cascade pod only through `cascade-mcp` (the **pod** arm), once reading
every download in full (the **records** arm, the grab bag pasted into a chat). "What should I bring up at my check-up"
is one question among several. Program checks come first; blind judges grade the rest. Runs happen on demand, never in
CI, and never on a real person's records.

Recorded runs: **[jayostis.github.io/cascade-runtime-js/evals/](https://jayostis.github.io/cascade-runtime-js/evals/)**.

## What is here

- `cases/<case>/`: a synthetic person. `case.json` (who, today, the description a report shows, the downloads and the
  order the pod imports and the records arm reads them, and her questions in sessions), `generate.mjs` (writes the
  downloads beside the vocabulary kit's copies), `key.json` (the machine-readable key: for each question, one item per
  expected fact, absence or negation, planted gap, trap or near-trap, with its evidence, the links the reasoning must
  state, and what counts as found, partly found or wrong) and `key.md` (the rationale and its guideline citations). A case must say `"synthetic": true`, and its downloads must hash to the digest its key was
  written against. A judge reads both halves of the key and is not told which arm wrote an answer, so what is true of one
  arm only (where the pod holds an item, what a view shows) goes in a `- **Pod:**` bullet of `key.md`, a `pod` field of an
  item or a `podNote` of a pre-existing item, none of which reach the judge; a test builds each case's packet and fails on
  any term that names an arm.
- `configs/`: the tiers. **smoke**: one case, one run per arm, one judge (so the judging path runs end to end). **standard**: every case, one run, one
  judge. **full**: three runs, two judges and their agreement. Each config names the subject and judge models (judges
  are cheap models picked by calibration: [calibration.md](calibration.md)) and a hard cap in tokens and dollars.
- `schemas/`: case, key, config, answer, verdict and results. `results.schema.json` is the contract a runner fills.
- `src/citations.ts`: the citation checker, exported as `cascade-evals/citations` for an app to check a model's answer:
  a cited line, FHIR resource or pod entry exists and holds the date and values claimed; an absence counts only when
  its query ran and its coverage is stated.
- `src/sessions.ts`: a subject job is one session; its `ask` command hands out the questions one at a time, each once
  the last is answered, and its calls are split at each hand-out, so each question's cost and time stand apart from the
  session's own (the grab bag's reading of every file). `src/evidence.ts`: every citation resolved mechanically, a pod
  entry to the records merged into it, their revisions and source documents, a file to its passage and download.
  `src/instances.ts`: each case, model and repeat counted for the report: both arms, and judging apart.
  `src/site.ts` (with `site-run.ts`, `site-answer.ts`, `site-graph.ts`): the report, rendered from `results.json` alone:
  a front page, a page per instance (each answer in tabs Answer, Reasoning and Show my doctor), a print view of the
  doctor cards per arm, and how the test works.
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

### One command, no orchestrator

```sh
node packages/evals/dist/src/cli.js run --config small-models            # plans; lists the jobs and the estimate against the cap
node packages/evals/dist/src/cli.js run --config small-models --run <id> --go
```

`run --config <tier|file>` plans the run (or reads the plan of `--run <id>` when it has one), prints its jobs and the
estimate against the cap, and stops. With `--go` it runs the whole eval: the meter hands out the jobs that fit the cap
(at most the config's `concurrency`), each is one `claude -p --model <alias>` child, the meter runs again when the wave
has ended, then the judges the same way, then `finish`. A run stopped part way resumes with the same `--run <id> --go`;
a job already finished is not run again. Each child's output is in `runs/<run>/logs/<job>.log`.

A child gets the prompt the meter gives (its first line is its tag, which is how its `<session id>.jsonl` transcript is
found), only the tools its prompt allows (`TOOLS` in `src/prompts.ts`: the records arm Read, Write and Bash; the pod arm
Bash and Write; a judge Read and Write), no permission prompts, and none of the user's setup: `--safe-mode` (no CLAUDE.md,
hooks, plugins, skills, MCP), `--restricted` (file tools confined to the child's folder, the run's answers folder and, for
the records arm, its downloads), `--strict-mcp-config`, and the environment variables that switch off auto-memory,
CLAUDE.md, claude.ai connectors and the PowerShell tool. Bash is allowed as `Bash(node *)` only. `--bare` is not used: it
cannot read a subscription login. `CASCADE_EVALS_CLAUDE` names another executable (a `.js` or `.mjs` file runs under node),
which is how the tests use a fake; `CASCADE_EVALS_CHILD_MINUTES` (default 60) stops a child that runs too long.

- **Reference tables.** Every case's pod is given the reference tables, as an app holds them beside its pods: held once in
  `work/reference-tables/` (the package's starter copies, else the feeds `cascade-runtime.json` names, read once) and
  copied into each case's `pods/.tables/`. A pod prepared without them, or on other tables, is rebuilt, and a pod-arm
  session answered on other tables is not reused. To take newer tables, remove `work/reference-tables/`.
- **Budgets.** Every job has an estimate before it runs: the mean of recorded runs of the same case, arm and model,
  else the prior. The meter runs between waves and hands out only jobs that fit under the cap, counting each job in
  flight at its estimate until its transcript is found. It cannot stop a job already running, so the cap holds back new
  jobs; a job handed out that leaves no transcript, or writes nothing, fails and is never handed out again. A model
  `prices.json` does not price is refused at planning, since it would leave the dollar cap unchecked. The run stops
  cleanly and `results.json` says which jobs were held back.
- **Checks.** A fact names the field it relies on (value, unit, status, code, name, id, a date of a kind, or quoted
  words), and the citation checker compares each with that field of the cited record only: a FHIR resource, a C-CDA
  entry or narrative row, or a pod entry. An absence names what it looks for; a pod's is backed only by a query that ran,
  answered whole and returned nothing matching, a records one only by the files it names, each read whole, none holding
  it. Every check is recomputed at `finish`, a reused job's too.
- **Judges.** Each judge reads one packet per sitting (a case, model and repeat: both arms' answers to each question,
  under letters in an order of its own), in a folder outside the run that holds only its packet and prompt. It grades
  every key item of each question and gives a verdict on everything an answer says beyond the key (fair, true but not
  planted, speculative, contradicted). Its cost is the test's own, charged to neither arm. A reused verdict keeps the
  letters it was written to.
- **Reuse.** A session whose inputs are unchanged is not run again: the case, its downloads, the session's own
  questions, the model, the prompts, and for the pod arm the runtime's packages and the components it resolves; for a
  judge, the answers and the key. A reworded question reruns only the sessions that ask it; the records arm reruns only
  when its case, model or prompts change. Reuse reads `runs/` and `history/`.
- **Stats.** Every model call is recorded with its role, model, input, cache and output tokens, time and tool calls,
  and priced from `prices.json`. Run from Claude Code, the calls come from each agent's transcript, so the usage is the
  API's own (`usageSource: transcript`, cost `exact`). A runner on the Claude API with MCP tool use, when there is a
  key, fills the same fields from its responses (`usageSource: api`).

## Pinned runs

A config's `pins` names a commit (or `main`, its head when planned) for each repository the pod arm depends on:
cascade-vocabulary, both adapters, cascade-bridge-rs, cascade-bridge-spec (recorded; the runtime does not read it) and
cascade-runtime-js, which builds the pods and serves cascade-mcp. The run clones them side by side under
`work/pinned/<key>/`, installs and builds that runtime once (several minutes), makes each case's pod and runs its
cascade-mcp there, and records the commits in `results.json`; reuse keys on them. `configs/baseline-pre-w3.json` is
the standard tier at the commits before wave 3, `configs/baseline.json` the same on every repository's main (#551).

## Recording a run, and the habit

`runs/` is gitignored: a run's transcripts, prompts and site stay on the machine that ran it.
`npm run evals:record <run>` copies its `results.json`, answers and verdicts into `history/<date>-<commit>-<tier>/`,
which is committed. CI builds the site from `history/` on every pull request and deploys it from main under `/evals/`;
`npm run evals:report -- --history` builds it locally, and `npm run evals:report -- <run folder>` one run's.

**A pull request that claims the pod answers better includes its recorded run,** so the diff of `history/` shows the
scores move.
