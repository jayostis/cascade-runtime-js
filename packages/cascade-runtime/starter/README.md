# cascade-app

An app on a Cascade pod: a small web server that shows what a pod holds, and
commands to load, make, remove and ask pods. It depends only on
`cascade-runtime`, which keeps the pods; this app never writes a pod's files
itself.

Alex Rivera, whose pod `pod:load alex-rivera` loads, and Priya Natarajan, whose
pod `pod:load priya-natarajan` loads, are the people of the kits the package
carries, made up for them. Alex's records come from Apple Health exports;
Priya's from exports and C-CDA files together.

## Start

```sh
npm run pod:load alex-rivera
npm start
```

then open <http://127.0.0.1:3000/>. The pods are on the left, named as their
people. A pod's page reads as that person's health record: how many records,
from which places; what Cascade noticed, such as the same allergy recorded at
two hospitals, or two hospitals disagreeing on how severe it is; and a tile for
each kind of record, which opens a table you can sort by a heading and filter.
"+ New pod" makes a pod for anyone by name, or for one of the demo hospitals'
made-up patients in one click.

The server answers on `127.0.0.1` only, at the port in `PORT`, or 3000. It sees
a pod loaded while it runs; after `pod:reset` of a pod it has shown, restart it.
Stop it with Ctrl+C in its terminal.

## Bring in a record from a hospital

A demo patient's pod has a Sign in button for each hospital holding them; any
pod has "Find a hospital", which searches the test directory by name or place
and lists each demo hospital's sample patients. Press Sign in:

1. Your browser goes to the hospital's own sign-in page. A demo hospital's
   asks whom to sign in as and offers Allow and Cancel.
2. The hospital sends you back to this app, at `/callback`.
3. The connection's page shows its steps while the record is fetched, then
   what the hospital has, and whether the pod already has records from there.
4. "Bring it into … pod" imports it as the pod's person's, and goes back to the
   pod's page.

Cascade North and Cascade South are pretend hospitals, in `demo-hospital/`,
with made-up patients. They need no account and no network: this app serves
their sign-in pages under `/demo-hospitals/`. The SMART Health IT Sandbox is a
real test server and needs the network.

## The commands

An option to an npm script goes after `--`, or npm keeps it for itself.

| Command                                                      | Does                                                                                                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm start`                                                  | serves the app                                                                                                                                                                     |
| `npm run pod:load -- <kit> [--through <step>] [--as <name>]` | replays a kit's story into `pods/<name>/`, the name being the kit's unless `--as` gives one; with `--through`, it stops after that step                                            |
| `npm run pod:new <name>`                                     | makes an empty pod in `pods/<name>/`, to bring your own downloads into                                                                                                             |
| `npm run pod:reset <name>`                                   | removes `pods/<name>/`, asking nothing                                                                                                                                             |
| `npm run kit:export -- <kit> <download>`                     | copies a kit's download into this folder as a person puts it there: `alex-rivera x-e12` as `apple_health_export`, `priya-natarajan kestrel-harbor-health-summary.xml` as that file |
| `npm run ask -- [--pod <name>] "<question>"`                 | prints a question's rows, one JSON object a line                                                                                                                                   |
| `npm run console -- [--pod <name>]`                          | opens Node's REPL with the pod as `pod`: `await pod.ask("pod/My active allergies")`                                                                                                |

`--pod` may be left out when there is exactly one pod. One app can hold a kit at
two points: `npm run pod:load -- alex-rivera --through J24 --as alex-rivera-j24`
beside `alex-rivera`.

## The files

- `server.mjs`: the app, on `node:http`, with no framework and no build step:
  it answers requests and reads the pods.
- `summary.mjs`: what the pages show, as functions from a pod's answers to
  HTML, with no import, so a browser can run it too. Rewrite it freely.
- `hospitals.mjs`: the sign-in to a hospital, the redirect back, and the pull.
- `demo-hospital/`: the pretend hospitals, a package of this app's own.
- `pods.mjs`: what the commands share: where pods live and which one a command
  works on.
- `pod.mjs`, `kit.mjs`, `ask.mjs`, `console.mjs`: the commands.
- `AGENTS.md`: for a coding agent building on this app.

The full guide to `cascade-runtime` is in
`node_modules/cascade-runtime/guide/AGENTS.md`.
