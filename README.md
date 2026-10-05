# cascade-runtime-js

The reference implementation of
[cascade-vocabulary](https://github.com/jayostis/cascade-vocabulary)'s runtime
rules: a TypeScript runtime that fills a Cascade pod, loading the Bridge and
the adapters in-process. It proves itself by passing the vocabulary's rule
vectors and, later, its conformance kit.

It is being built in the steps of
[cascade-vocabulary#39](https://github.com/jayostis/cascade-vocabulary/issues/39).
Today it replays a story's pod creation; imports, entries, the matcher and the
views follow.

## Running it

Node 22 or later.

```sh
npm install
npm test                                  # the unit tests and one run of the rule vectors
npm run typecheck
npm run lint
npm run conformance -- --report earl.nt   # runs the vocabulary's rule vectors, writes the EARL report
```

`npm run conformance` is for conformance testing only, as the Bridge's command
line is. Its exit code means nothing; the report does. `--folder
<repository>=<folder>` hands in a folder for a repository, and `--manifest`
names another manifest in the vocabulary.

`npm run build:example-pod <name>` will build an example's pod from the
vocabulary's conformance kit; until the kit exists it says so and builds
nothing.

## Packages

| Package                 | What it does                                                   |
| ----------------------- | -------------------------------------------------------------- |
| `packages/runtime`      | files arrivals, names things, runs the matcher and the views   |
| `packages/apple-health` | the importer: the documents in an export and the facts of each |
| `packages/site`         | the site that documents a pod and its queries                  |
| `packages/graphdb`      | the GraphDB loader                                             |

The core in `packages/runtime/src` knows four interfaces and nothing behind
them:

| Interface    | What it does                                                            | What plugs in today                          |
| ------------ | ----------------------------------------------------------------------- | -------------------------------------------- |
| `Files`      | reads and writes bytes, by path or IRI                                  | a local folder, memory                       |
| `Bridge`     | describes and loads an adapter, asks if it accepts a document, converts | cascade-bridge-rs in a worker; saved output  |
| `Store`      | runs SPARQL over named graphs                                           | Oxigraph's JavaScript build                  |
| `IdsAndTime` | mints the ID of an import or an entry session, and gives the time       | random UUIDs; the clock or the story's times |

Code that needs Node (a local folder, git, the command line) is under
`packages/runtime/src/node/`.

## Which version of each component a run uses

`cascade-runtime.json` pins the vocabulary and the adapters by repository and
commit, and names the importers and the lens. For each, first match wins:

1. a sibling checkout, in the folder beside this one named as the repository,
   as it is on disk; the run prints its commit and how many files it has
   uncommitted;
2. a folder handed in with `--folder`, as the compatibility tooling does;
3. otherwise the pin, fetched at its commit into `build/cache/`.

A worktree's siblings are those of the checkout it was made from. An adapter
is given every file of its folder, and the vocabulary at the commit the adapter
pins, resolved the same way.

The Bridge is pinned in `package.json`, by its release's URL and the lockfile's
integrity hash. A sibling `cascade-bridge-rs` checkout's `package/dist` is used
instead only when it was built from the checkout as it is; a stale or missing
build falls through to the pin, and the run says which it used.

Each is named, as `runtime/rules.md` N8 says, by its tree at the commit it is
at, so an EARL report names the same entries on every machine.

CI checks out `cascade-vocabulary` at the pin beside this repository.
