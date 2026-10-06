# For an agent building on this app

This is an app on a Cascade pod: `server.mjs` serves a page per pod, and the
commands in `package.json` load, make, remove and ask pods under `pods/`. It
depends only on `cascade-runtime`, which opens a pod and is the only thing that
reads or writes one.

- With no pod in `pods/`, run `npm run pod:load alex-rivera` first: it loads
  Alex Rivera's pod, made-up records from two hospitals that disagree.
- `npm start` serves the app at <http://127.0.0.1:3000/>.
- `npm run ask -- [--pod <name>] "<question>"` prints a question's rows;
  `npm run console -- [--pod <name>]` gives a REPL with the pod as `pod`.
- An option to an npm script goes after `--`.

Never write a pod's files, parse its Turtle or name a thing yourself: call
`cascade-runtime`. The full guide, matching the version installed, is
`node_modules/cascade-runtime/guide/AGENTS.md`. Read it before changing the app.
