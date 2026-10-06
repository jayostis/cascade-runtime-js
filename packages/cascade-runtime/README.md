# cascade-runtime

<!-- INSTALL -->

What an app imports to keep a Cascade pod: it opens a pod in a folder, looks
into an Apple Health export, imports it, enters and judges records, runs the
matcher and asks the vocabulary's questions. `openPod` is the whole interface;
`cascade-runtime/fixtures` adds `replayKit`, which replays a conformance kit's
story into a folder.

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
