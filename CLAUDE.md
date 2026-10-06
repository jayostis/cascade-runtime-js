# cascade-runtime-js — Agent Context

The reference implementation of cascade-vocabulary's runtime rules;
[`README.md`](README.md) names the parts. The contract is
[cascade-vocabulary](https://github.com/jayostis/cascade-vocabulary): its
`runtime/rules.md`, its feature files and its queries. This repository copies none of
it; it resolves the vocabulary as `cascade-runtime.json` says.

## The rules

- **The core knows four interfaces, `Files`, `Bridge`, `Store` and
  `IdsAndTime`, and nothing behind them.** What needs Node is under
  `packages/runtime/src/node/`; nothing else imports from there.
- **In the core, only an import and an entry session get a random ID**, from
  `IdsAndTime.newId`, random on every run, in use and in replay. Outside it, the
  package `cascade-runtime` mints a new pod's naming base and subject's ID, and
  each person's judgment's IRI, on an app's behalf; nothing else ever does.
  Everything else is named by its rule from its inputs.
- **Tests assert meaning, never bytes.** Nothing compares bytes or whole files,
  and a test never names a run-dependent thing (an import, an entry session, a
  revision) by IRI: it reaches an import through its step, a revision through
  its record and position.
- **Fewer, better, faster tests.** One test per behaviour, on the smallest input
  that shows it; before adding one, change the test that already shows the
  behaviour. No combinatorial padding. Build a pod or a dataset once and share
  it. `npm test` runs in seconds; the one run of the conformance command, every
  example of the feature files, is its slower check.
- **Bad input is a refusal, never a plain `Error` that escapes.** A step given
  input the rules refuse throws `Refusal`, from `packages/runtime/src/step.ts`:
  it writes nothing, the replay records why and goes on. Any other error stops
  the replay, and says the runtime is broken, never that an input was bad.
  Refusals are tested once, as a table of each input and the reason it is
  refused, not one test per case.
- **A rule is implemented where its examples say,** and an example is passed,
  never skipped: a step the runtime cannot yet perform fails its examples,
  naming the step's kind.

## Conventions

- Dependencies are pinned exactly.
- Conventional commits: `feat(runtime): ...`, `fix(resolver): ...`; why a change
  was made goes in its message, never in the file.
- No comment that restates a name, a type or another file.
