# For an agent building on this app

This app was made from the Cascade starter. It is a demonstration, not a
foundation: rebuild it in any framework. What carries over is
`cascade-runtime`, which keeps the pods, and the pods under `pods/<name>/`. It
starts with none: `npm run pod:load alex-rivera` loads Alex Rivera's, from the
kit the package carries. `npm run kit:export -- alex-rivera x-e12` copies one
of her downloads into the app as `apple_health_export`. Stop the app's server
with Ctrl+C in its terminal, or by the process you started, never by killing
every Node process.

Before changing the app, read the full guide, the version matching the package
installed: `node_modules/cascade-runtime/guide/AGENTS.md`.

An app never:

- writes a pod's files, or reads them but through `ask`;
- parses Turtle: it asks a question instead;
- names a thing: it uses the guide's placeholders and the IRIs calls return;
- imports or claims what the person has not said is theirs.
