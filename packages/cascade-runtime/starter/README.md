# cascade-app

An app on a Cascade pod: a small web server that shows what a pod holds, and
commands to load, make, remove and ask pods. It depends only on
`cascade-runtime`, which keeps the pods; this app never writes a pod's files
itself.

The app is made with two pods, `alex-rivera` and `priya-natarajan`, loaded from
the kits the package carries. Alex Rivera and Priya Natarajan are made up.
Alex's records come from Apple Health exports; Priya's from exports and C-CDA
files together. `npm run reset` puts the app back as it was made.

## Start

```sh
npm start
```

then open <http://127.0.0.1:3000/>. The pods are on the left, named as their
people. A pod's page reads as that person's health record: how many records,
from which places; what Cascade noticed, such as the same allergy recorded at
two hospitals, or two hospitals disagreeing on how severe it is; and a tile for
each kind of record, which opens a table you can sort by a heading and filter.
"+ New pod" makes a pod for anyone by name, or for one of the demo hospitals'
made-up patients in one click.

The title bar has two menus. File has "Delete all data", which removes every
pod, and "Reset all data", which does what `npm run reset` does; each first
asks you to confirm. Help has "About": this app's name and version, the
`cascade-runtime` it runs on, and where its code is.

The server answers on `127.0.0.1` only, at the port in `PORT`, or 3000. It sees
a pod loaded while it runs; after `pod:reset` of a pod it has shown, restart it.
Stop it with Ctrl+C in its terminal.

## Bring in a record from a hospital

A demo patient's pod has a Sign in button for each hospital holding them; any
pod has "Find a hospital", which searches the test directory by name or place
and lists each demo hospital's sample patients. Press Sign in:

1. Your browser goes to the hospital's own sign-in page. A demo hospital's
   asks whom to sign in as and offers Allow and Cancel.
2. The hospital sends you back to this app, at `/callback`, which opens a box
   over the pod's page.
3. The box shows the connection's steps while the record is fetched, then what
   the hospital has, and whether the pod already has records from there.
4. "Bring it into … pod" imports it as the pod's person's. The box says each
   part of the import as it goes, then closes, and the pod's page says what was
   brought in.

Cascade North and Cascade South are pretend hospitals, in `demo-hospital/`,
with made-up patients. They need no account and no network: this app serves
their sign-in pages under `/demo-hospitals/`. The SMART Health IT Sandbox is a
real test server and needs the network.

## The commands

`npm run help` lists every command with what it does. An option to an npm
script goes after `--`, or npm keeps it for itself.

- `npm run dev` serves the app as `npm start` does, restarting it whenever a
  file is saved.
- `npm run reset` removes every pod and loads Alex's and Priya's again, as
  the File menu's "Reset all data" does, through the same function in
  `pods.mjs`.
- `npm run pod:load -- <kit> [--through <step>] [--as <name>]` replays a kit's
  story into `pods/<name>/`. One app can hold a kit at two points:
  `npm run pod:load -- alex-rivera --through J24 --as alex-rivera-j24` beside
  `alex-rivera`.
- `npm run kit:export -- <kit> <download>` copies a kit's download into this
  folder as a person puts it there: `alex-rivera x-e12` as
  `apple_health_export`, `priya-natarajan kestrel-harbor-health-summary.xml` as
  that file.
- `ask` and `console` need `--pod <name>` whenever the app has more than one
  pod, as a made app does; it may be left out only when there is exactly one.

## The files

- `server.mjs`: the app, on `node:http`, with no build step: it answers
  requests, reads the pods, and renders each page to HTML with
  `preact-render-to-string`. Under the pods, the sidebar lists the reference
  tables the pods are matched with, kept in `pods/.tables/`; `/tables/<id>/`
  shows one with a search, and Check now reads their feeds again.
- `summary.mjs`: what the pages show, as [Preact](https://preactjs.com)
  components written with [`htm`](https://github.com/developit/htm), plain
  functions from a pod's answers to the page's elements, so a browser can
  render them too. To change one, edit its `` html`…` `` template as HTML:
  `${…}` puts in a value, escaped, or more elements; close every tag, `<input />`
  too; a line break between two tags drops the spaces around it. Rewrite it
  freely.
- `hospitals.mjs`: the sign-in to a hospital, the redirect back, and the pull.
- `demo-hospital/`: the pretend hospitals, a package of this app's own.
- `pods.mjs`: what the commands and the server share: where pods live, which
  one a command works on, and deleting and resetting them all.
- `pod.mjs`, `kit.mjs`, `ask.mjs`, `console.mjs`: the commands, and
  `help.mjs`, which lists them.
- `AGENTS.md`: for a coding agent building on this app.

The full guide to `cascade-runtime` is in
`node_modules/cascade-runtime/guide/AGENTS.md`.
