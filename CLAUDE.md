# cascade-runtime-js — Agent Context

The reference implementation of cascade-vocabulary's runtime rules;
[`README.md`](README.md) names the parts. The contract is
[cascade-vocabulary](https://github.com/jayostis/cascade-vocabulary): its
`runtime/rules.md`, its vectors and its queries. This repository copies none of
it; it resolves the vocabulary as `cascade-runtime.json` says.

## The rules

- **The core knows four interfaces, `Files`, `Bridge`, `Store` and
  `IdsAndTime`, and nothing behind them.** What needs Node is under
  `packages/runtime/src/node/`; nothing else imports from there.
- **Only an import and an entry session get a random ID**, from
  `IdsAndTime.newId`, random on every run, in use and in replay. Everything else
  is named by its rule from its inputs.
- **Tests assert meaning, never bytes.** Nothing compares bytes or whole files,
  and a test never names a run-dependent thing (an import, an entry session, a
  revision) by IRI: it reaches an import through its step, a revision through
  its record and position.
- **Fewer, better, faster tests.** One test per behaviour, on the smallest input
  that shows it; before adding one, change the test that already shows the
  behaviour. No combinatorial padding. Build a pod or a dataset once and share
  it. `npm test` runs in seconds; the one run of the conformance command, the
  vectors and the kit, is its slower check.
- **A rule is implemented where its vectors say,** and a vector is passed, never
  skipped: a step the runtime cannot yet perform fails its entries, naming the
  step's kind.

## Conventions

- Dependencies are pinned exactly.
- Conventional commits: `feat(runtime): ...`, `fix(resolver): ...`; why a change
  was made goes in its message, never in the file.
- No comment that restates a name, a type or another file.
