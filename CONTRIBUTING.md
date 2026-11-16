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

The runtime reads the vocabulary and the adapters from the repositories [`cascade-runtime.json`](cascade-runtime.json) names; CI checks them out beside this repository.

The conformance command runs every example of the vocabulary's feature files against this runtime. It is the slower
check, so run it when you change a rule:

```sh
npm run conformance
```

To repeat a random-order run, transpile, then run the script on the package with the seed from the log, which it passes
to node:

```sh
node scripts/transpile.mjs
node scripts/random-order.mjs cascade-runtime --test-random-seed=N
```

## What a pull request must pass

CI runs on every pull request, and a red check is a reason not to merge. Two checks are required, **`compatibility`**
and **`ready-to-merge`**. `compatibility` reports the result of the first three jobs below (and `runtime tests` on the
nightly run); `ready-to-merge` is its own check.

- **`tests and conformance`**: the conformance command over the vocabulary and the adapters, the type check, the lint,
  and the test files each package's `test/spec.json` lists as `randomOrder`, run in a random order (a test that needs
  another to run first fails here; the seed is in the log). Then the suite, and the check that its results read as a
  specification: every test in a file a package lists as `shaped` sits under a capability heading listed in its
  `test/spec.json`, word for word. That check runs in CI, not in `npm test`, so a new capability needs its heading added to
  `spec.json` by hand.
- **`docs site`**: builds the package and the pages, and runs the browser tests in Chromium.
- **`starter-kit (...)`**: four jobs (`suites`, `browser`, `app`, and `app, chat,mcp`) in which this pull request's
  package, packed, is run under the [starter kit](https://github.com/jayostis/cascade-starter-kit)'s tests, so a change
  that breaks the app a person starts from is seen before it merges.
- **`ready-to-merge`**: holds a pull request until every pull request it depends on can merge (see "A change that spans
  two repositories").

Other jobs run too: `starter (<system>)` makes an app on each system the package supports, `package` packs the package,
`package-install (<system>)` installs it, and `external links` checks the links of the built pages.

## Working on this repository

The runtime loads the Bridge and the adapters in-process. The vocabulary's
conformance kits are four people's stories: Alex Rivera's, from Apple Health
exports, Priya Natarajan's, from exports and C-CDA files together, Martin
Okafor's, two FHIR reports of one variant beside what ClinVar says today, and
Tamsin Vale's, one hospital's record pulled twice a year apart.

Node 22 or later. To build Alex's pod and the site that documents it, with
`priya-natarajan`, `martin-okafor` or `tamsin-vale` in place of `alex-rivera` for the others:

```sh
npm install
npm run build:example alex-rivera        # the pod, then the site
npm run build:example-pod alex-rivera    # generates build/alex-rivera/pod from the story
npm run build:example-site alex-rivera   # generates build/alex-rivera/site from that pod
npm run build:pages                      # the whole Pages tree in build/pages: every kit's pod and site, the newcomer's page, the eval report, the spec and the conformance results
npm run build:pages -- --no-kits         # the same without what is made of the kits, which is most of the time
npm run build:pages -- --no-explorers    # the same without the adapters' explorers, which need Python 3.10+ with rdflib; without the flag a build that cannot make one fails
npm run build:pages -- --report earl.ttl # with that conformance report, its table.md beside it, in spec/ and conformance/; without one every result reads not run
npm run build:spec                       # every rule beside its note and its result in build/conformance/earl.nt, in build/spec
```

`npm run build:pages` also makes each adapter's explorer with
cascade-bridge-spec's `scripts/adapter_explorer.py`, read from the sibling
checkout or else its default branch, so it needs Python 3.10 or later with
`rdflib` (`PYTHON` names the interpreter when it is not `python3`). An adapter
whose explorer cannot be made is listed as not available and the build goes on.

Open `build/alex-rivera/site/index.html`. The pod is the vocabulary's
`conformance/alex-rivera/` replayed with the Bridge's saved output, so it needs
only Node, and with the kit's own tables, which `npm run conformance` and
`npm run build:example` need. `npm run build:pages` replays each kit on the
package's starter copies instead, as a made app's `replayKit` does, so that a
published pod cites only the tables a pod the app creates is given. The site is
built from any pod folder: `--pod <folder>` reads another, `--out <folder>`
writes elsewhere and `--lens <lens>` builds it under another lens. Every
question on the site says how to ask it yourself:

Beside the page the site writes `explorer.json`, the data of the pod's explorer:
the pod's files with what wrote each, its log, its views and their entries, the
queries that define them, and, for a kit's pod, the kit's steps and cases. It
leaves out the files' bodies, the queries' text and the answers' rows, which are
read from `pod/`, `queries/` (every query of the vocabulary) and `answers.json`.
Its type is `ExplorerData` in `packages/site/src/explorer.ts`.

```sh
npm run ask -- <name> "<question>"            # one question's rows, under the runtime's lens
npm run graphdb -- <name> <GraphDB's URL>     # a repository <name>, holding the pod and its questions
```

### Running it

```sh
npm test                                  # the unit tests, and one run of the conformance command, types unchecked
npm run typecheck                         # before a push
npm run lint
npm run conformance -- --report earl.nt   # every example and each kit's checks, as one EARL report
```

`npm run conformance` is for conformance testing only, as the Bridge's command
line is. Its exit code means nothing; the report does. It reads every feature
file of the vocabulary, under `runtime/` and each kit's under `conformance/`,
with Gherkin's own parser, and reports each example, and each kit's four checks
that are not examples (the final views equal `expected/`, every file conforms to
the vocabulary's shapes, every name follows its rule, every file is where the
layout says). Each step of `runtime/steps.md` is implemented once, in
`packages/runtime/src/phrases.ts`; the steps examples share are replayed once,
and a failed example's report names its rule and the step that failed.
`--folder <repository>=<folder>` hands in a folder for a repository, and
`--feature <path>` runs only that feature file of the vocabulary.

`npm test` runs the command once and asserts on its report. With
`CASCADE_CONFORMANCE_REPORT=<report>` it asserts on that report instead and
does not run the command; CI hands it the report its compatibility check wrote.

An eval run (the pod against the same records read as files, judged blind) is
one command, and a finished run is committed by recording it. CI publishes
every recorded run at
[the eval runs](https://jayostis.github.io/cascade-runtime-js/evals/):

```sh
node packages/evals/dist/src/cli.js run --config small-models   # plans; prints the jobs and the estimate
node packages/evals/dist/src/cli.js run --run <id> --go         # the subjects, the judges, then finish
npm run evals:record packages/evals/runs/<id>                   # copies it into packages/evals/history/
npm run evals:report -- --history                               # the published site, built locally
```

[`packages/evals/README.md`](packages/evals/README.md) says what a run holds,
the configs, and how it is scored.

### The developer story

There are two, one per epic. `developer-story/allergies.mjs` is what an app would write against the package
`cascade-runtime`: open a pod, look at Alex's first export, import it as hers
and print her active allergies. It is the developer story of
[#20](https://github.com/jayostis/cascade-runtime-js/issues/20) and that epic's
acceptance test. `packages/runtime/test/developer-story.test.ts` runs it and
compares its rows with the replay of her story through `J1`.

`developer-story/medications.mjs` is the developer story of
[#70](https://github.com/jayostis/cascade-runtime-js/issues/70) and its
acceptance test. Priya Natarajan's first Apple Health export and first C-CDA
download from Kestrel Harbor Hospital, synthetic, are in her kit's
`scripted-input/priya/downloads/` in the vocabulary. The script looks at each
and imports it as hers, then prints her active medications: lisinopril, which
both formats carry, as one entry, and amlodipine, which only the C-CDA has. The
same test file runs it and checks those rows.

### The package

`packages/cascade-runtime` is the package an app installs. It is not on npm:

```sh
npm run build:package    # build/cascade-runtime-0.0.0-commit-<commit>.tgz, build/cascade-mcp-0.0.0-commit-<commit>.tgz and build/release-notes.md
```

The tarball holds the package's code, the workspaces under it and the Bridge's
build, bundled, and the vocabulary's and each adapter's files at the head of
each default branch when it ran, which `components/packed.json` records.
Installed, it reads nothing outside its own folder. CI installs it into an empty
folder on Linux, Windows and macOS and runs the developer story there, and every
merge to `main` attaches it to the pre-release `build-<commit>` under
[releases](https://github.com/jayostis/cascade-runtime-js/releases), from which
an app installs it by its URL. `cascade-mcp`, packed beside it, depends on it at
the same commit: install the two tarballs in one `npm install`, then run
`npx --no-install cascade-mcp --pods <folder>` in that folder. `--no-install` matters:
without it, npx run elsewhere fetches whatever npm's registry calls `cascade-mcp`.

The pack keeps the reference tables' row files it fetches in
`~/.cache/cascade-runtime/rows` (under `$XDG_CACHE_HOME` when that is set), or
in the folder `CASCADE_ROWS_CACHE` names; `CASCADE_ROWS_CACHE=""` keeps none.
Each pack drops the files no pack has read for 30 days, and the folder is safe
to delete.

### Which version of each component a run uses

Nothing pins a version, as
[cascade-bridge-spec's `compatibility.md`](https://github.com/jayostis/cascade-bridge-spec/blob/main/compatibility.md)
says. `cascade-runtime.json` names the vocabulary and the adapters by
repository, and names the importers and the lens. For each, first match wins:

1. a sibling checkout, in the folder beside this one named as the repository,
   as it is on disk; the run prints its commit and how many files it has
   uncommitted;
2. a folder handed in with `--folder`, as the compatibility tooling does;
3. otherwise the head of its default branch as it is when the run starts,
   fetched into `build/cache/`; the run prints the branch and the commit.

A worktree looks for each sibling beside itself first, then beside the checkout
it was made from. An adapter is given every file of its folder, and the
vocabulary repository its `bridge:cascadeVocabularyRepository` names, resolved
the same way.

The Bridge is a build cascade-bridge-rs publishes as the release
`build-<commit>`, for every commit of its default branch and every head of a
pull request from the repository itself. A sibling `cascade-bridge-rs`
checkout's `package/dist`, then that of a checkout handed in with `--folder`,
is used only when it was built from the checkout as it is; otherwise the release
of the commit that checkout is at, and a checkout with uncommitted files and no
build of them stops the run. With no checkout, the commit is picked as a
counterpart is: in CI, the head of an open cascade-bridge-rs pull request reached
by `Depends-On:` lines, else the head of its branch named like the one the run
is on, else the newest commit of its default branch with a release; locally, the
last. Each pull request is read as the compatibility tooling read it, from the file
it names in `CASCADE_PULL_REQUESTS`, else from GitHub's API, except that with no
token the pull request under test is the one the run's event carries, so a run
naming nothing asks the API nothing. A picked commit with no release yet stops the run, saying how it was
picked. The release is downloaded into `build/cache/` and checked against the
digest it gives. The run says which it used, and why a checkout's build was passed over.

Each is named, as `runtime/rules.md` N8 says, by its tree at the commit it is
at, so an EARL report names the same entries on every machine.

CI runs the compatibility check on every pull request and nightly, never on a
push to `main`. `compatibility.json` declares this repository to it as a
runtime: it checks the vocabulary and the adapters out beside this repository,
picked as any counterpart is, and runs `npm run conformance` on them. The tests
and the pod build then read those checkouts. The check is two jobs side by side,
the tests with conformance and the browser, and `compatibility` is the job that
reports once both have. CI publishes each kit's pod and site,
Alex's, Priya's, Martin's and Tamsin's, as an artifact, and on a push to `main` builds the pages from the head of every
default branch and deploys them.

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
