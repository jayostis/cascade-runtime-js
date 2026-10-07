# cascade-app

An app on a Cascade pod: a small web server that shows what a pod holds, and
commands to load, make, remove and ask pods. It depends only on
`cascade-runtime`, which keeps the pods; this app never writes a pod's files
itself.

Alex Rivera, whose pod `pod:load alex-rivera` loads, is the person of the kit
the package carries, made up for it.

## Start

```sh
npm run pod:load alex-rivera
npm start
```

then open <http://127.0.0.1:3000/>. With no pod, the page says which command
loads one. With one pod, it shows that pod: its active allergies, the entries
that need review, such as where Alex's two hospitals disagree, and how many
judgments count. With several, it lists them.

The server answers on `127.0.0.1` only, at the port in `PORT`, or 3000. It sees
a pod loaded while it runs; after `pod:reset` of a pod it has shown, restart it.
Stop it with Ctrl+C in its terminal.

## The commands

An option to an npm script goes after `--`, or npm keeps it for itself.

| Command                                                      | Does                                                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm start`                                                  | serves the app                                                                                                                            |
| `npm run pod:load -- <kit> [--through <step>] [--as <name>]` | replays a kit's story into `pods/<name>/`, the name being the kit's unless `--as` gives one; with `--through`, it stops after that step   |
| `npm run pod:new <name>`                                     | makes an empty pod in `pods/<name>/`, to bring your own downloads into                                                                    |
| `npm run pod:reset <name>`                                   | removes `pods/<name>/`, asking nothing                                                                                                    |
| `npm run kit:export -- <kit> <download>`                     | copies a kit's download, as `alex-rivera x-e12`, into this folder as `apple_health_export`, as a person puts their phone's download there |
| `npm run ask -- [--pod <name>] "<question>"`                 | prints a question's rows, one JSON object a line                                                                                          |
| `npm run console -- [--pod <name>]`                          | opens Node's REPL with the pod as `pod`: `await pod.ask("pod/My active allergies")`                                                       |

`--pod` may be left out when there is exactly one pod. One app can hold a kit at
two points: `npm run pod:load -- alex-rivera --through J24 --as alex-rivera-j24`
beside `alex-rivera`.

## The files

- `server.mjs`: the app, on `node:http`, with no framework and no build step.
- `pods.mjs`: what the commands share: where pods live and which one a command
  works on.
- `pod.mjs`, `kit.mjs`, `ask.mjs`, `console.mjs`: the commands.
- `AGENTS.md`: for a coding agent building on this app.

The full guide to `cascade-runtime` is in
`node_modules/cascade-runtime/guide/AGENTS.md`.
