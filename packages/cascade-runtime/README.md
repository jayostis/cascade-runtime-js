# cascade-runtime

<!-- INSTALL -->

What an app imports to keep a Cascade pod: it opens a pod in a folder, looks
into an Apple Health export or a C-CDA file a patient portal handed out,
imports it, enters and judges records, runs the
matcher and asks the vocabulary's questions. `openPod` is the whole interface;
`cascade-runtime/fixtures` adds `replayKit`, which replays a conformance kit's
story into a folder. `cascade-runtime/check` is `checkInput`, the checker of a
tool's input against the JSON Schema subset the tools use, with nothing of the
runtime behind it, in Node and in the page (in the page it carries its own
`Refusal`, so tell a refusal by its `name`, never `instanceof`). `cascade-runtime/vite` is
`cascadeRuntime()`, a Vite plugin (`vite` is an optional peer) that keeps the
runtime out of an app's browser bundle and serves its browser build beside it,
under the base, with the import map that loads it. `terms`, from each entry and from
`cascade-runtime/terms` with nothing of the runtime behind it, holds the IRIs the starter
names, keyed by the term's local name in the vocabulary's one namespace, and `codeStems`
each code system's IRI stem, keyed by the system's local name. `cascade-runtime/tools`
is the tools a model reads pods by (`TOOLS`), each with its input schema, in Node and in a
page; `cascade-runtime/tools/node` is the reads they run over a folder of pods
(`podReads(podsIn(folder))`); every row they give names its entry, and none writes or opens an
encrypted pod. `cascade-mcp` serves them over MCP.

The package needs only Node 22 or later. It carries everything a pod reads, at
the commits its build resolved: the code under its interface, the Bridge's
WebAssembly build, the vocabulary's ontologies, queries, pod layout and every
conformance kit, and each adapter's files. `components/packed.json` records
which commit of each it carries and which Bridge release, and the release notes
name them. Nothing is fetched and no other folder is read when a pod is used.

It is built from
[cascade-runtime-js](https://github.com/jayostis/cascade-runtime-js) by
`npm run build:package`, and every merge to its `main` attaches the tarball to a
pre-release `build-<commit>`. It is not on npm.

## LOINC

The package redistributes content from LOINC: its starter copies of the reference
tables hold LOINC's long common names, the status of its codes and its panels'
members, which an app names lab results and shows panels by. LOINC's notice, as
its license (§10.1) asks of every copy:

> This material contains content from LOINC (http://loinc.org). LOINC is
> copyright © Regenstrief Institute, Inc. and the Logical Observation
> Identifiers Names and Codes (LOINC) Committee and is available at no cost under
> the license at http://loinc.org/license. LOINC® is a registered United States
> trademark of Regenstrief Institute, Inc.

A page that names a code from the table shows the same credit, which the table's
series carries.
