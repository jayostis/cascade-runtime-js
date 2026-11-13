# Contributing to cascade-runtime-js

Thank you for helping. This repository is the reference runtime of the Cascade Protocol, in TypeScript: it files what
arrives into a pod and answers questions from it, in Node or entirely in a browser, and proves itself against the
vocabulary's executable examples. [`README.md`](README.md) names the parts, and [`CLAUDE.md`](CLAUDE.md) holds the rules a
change here follows; read it before you add a test or a refusal.

Report a security problem privately, by email to contact@cascadeprotocol.org, never in a public issue.

## Set up

You need Node.js 22 or newer and git.

```sh
git clone git@github.com:<you>/cascade-runtime-js.git
cd cascade-runtime-js
npm ci
```

Dependencies are pinned exactly in [`package.json`](package.json) and `package-lock.json`. Use `npm ci`, not
`npm install`, so your run measures what CI measures.

## Run the tests

These are the commands CI runs:

```sh
npm run typecheck
npm run lint
npm test
```

`npm test` transpiles without checking types, so run `npm run typecheck` before you push. `npm run format` fixes what the
formatting check in `npm run lint` finds. The suite runs in seconds. While you work, pass node's own test flags through
it, for example `npm test -- --test-name-pattern="<words from a test name>"`.

The runtime reads the vocabulary and the adapters at the repositories and versions [`cascade-runtime.json`](cascade-runtime.json) names; CI checks them out beside this repository for you.

The conformance command runs every example of the vocabulary's feature files against this runtime. It is the slower
check, so run it when you change a rule:

```sh
npm run conformance
```

## What a pull request must pass

CI runs on every pull request, and a red check is a reason not to merge. The required check is **`compatibility`**,
which reports the result of these jobs:

- **`tests and conformance`**: the conformance command over the vocabulary and the adapters, the type check, the lint,
  and the test files each package's `test/spec.json` lists as `randomOrder`, run in a random order (a test that needs
  another to run first fails here; the seed is in the log, and `--test-random-seed=N` repeats it). Then the suite, and the
  check that its results read as a specification: every test sits under a capability heading listed in its package's
  `test/spec.json`, word for word. That check runs in CI, not in `npm test`, so a new capability needs its heading added to
  `spec.json` by hand.
- **`docs site`**: builds the package and the pages, and runs the browser tests in Chromium.
- **`starter-kit`**: this pull request's package, packed, is run under the
  [starter kit](https://github.com/jayostis/cascade-starter-kit)'s tests, so a change that breaks the app a person
  starts from is seen before it merges.
- **`ready-to-merge`**: holds a pull request until every pull request it depends on can merge (see "A change that spans
  two repositories").

Other jobs run too: `starter (<system>)` makes an app on each system the package supports, `package` packs and installs
the package, and `external links` checks the links of the built pages.

## Commits and pull requests

Use conventional commits: `feat(runtime): ...`, `fix(resolver): ...`. Why a change was made goes in its message, never in
a comment in the file.

Write the pull request description so a reader can tell what changed and why. Do not put a closing keyword (`closes`,
`fixes`, `resolves`) before an issue the pull request does not finish: GitHub closes it whatever the rest of the
sentence says.

## A change that spans two repositories

A change the runtime must follow from the vocabulary, or the starter kit must follow from the runtime, is two pull
requests. Each names the other in its description, on a line of its own, with the full URL:

```
Depends-On: https://github.com/jayostis/cascade-starter-kit/pull/123
```

The short `owner/repo#123` form is rejected. The `tests and conformance` and `starter-kit` jobs then run the other
repository's pull request together with yours, and `ready-to-merge` holds each until the other can merge. Nothing pins
one repository to a commit of another: a pull request that names no other is tried against the other repository's
branch of the same name as the branch it targets, and failing that its default branch. Editing a description to add or
cut a line re-runs the checks that read it; if the named pull request changes after your checks have run, re-run yours
with `gh run rerun`.

A named pull request must be from a branch of the repository itself: one from a fork fails the check. A contributor
without write access to the other repository asks a maintainer to open the counterpart.

The full rules are in cascade-bridge-spec's
[`compatibility.md`](https://github.com/jayostis/cascade-bridge-spec/blob/main/compatibility.md). For a change to a rule,
the vocabulary's [`CONTRIBUTING.md`](https://github.com/jayostis/cascade-vocabulary/blob/main/CONTRIBUTING.md) says how
the other half is made.

## Licence

Contributions are under the licence the repository states: Apache-2.0, in [`LICENSE`](LICENSE).
