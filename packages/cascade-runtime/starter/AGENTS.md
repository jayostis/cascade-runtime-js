# For an agent building on this app

This app was made from the Cascade starter. It is a demonstration, not a
foundation: rebuild it in any framework. What carries over is
`cascade-runtime`, which keeps the pods, and the pods under `pods/<name>/`. It
starts with two, Alex Rivera's and Priya Natarajan's, loaded from the kits the
package carries; `npm run reset` puts them back as they were made, and
`npm run help` lists every command. `npm start` serves the app, and
`npm run dev` restarts it on every save.
`npm run kit:export -- alex-rivera x-e12` copies one of Alex's downloads into
the app as `apple_health_export`, and
`npm run kit:export -- priya-natarajan kestrel-harbor-health-summary.xml` one
of Priya's C-CDA files under its own name. What the pages show is in
`summary.mjs`: Preact components written with `htm`, no JSX and no build
step, plain functions from a pod's question rows to the page's elements,
which a browser can render too. Change one by editing its `` html`…` ``
template; it imports only `preact`, `preact/hooks` and `htm`. Rewrite it as
you like.
`server.mjs` answers requests, hands it the rows, and renders each page to
HTML with `preact-render-to-string`. A pod's page also brings in a
record from a hospital of the test directory: the person signs in on the
hospital's own page, and `hospitals.mjs` receives the redirect on `/callback`,
which goes back to the pod's page with the connection in a box over it
(`?connection=<n>#connection`); the demo hospitals, in `demo-hospital/`, are pretend.
The title bar's File menu posts to `/delete-all` and `/reset-all`, which call
`deleteAll` and `resetAll` in `pods.mjs`, as `npm run reset` does; Help,
About says the app's name and version and the `cascade-runtime` it runs on.
Under the pods, the sidebar lists the sources of the reference tables the pods
are matched with (`sourcesOf(held())`, from `tablesBeside`). `/tables/<id>/`
shows a source: its publisher, licence and freshness, a search over all its
tables (`search()`, `?q=&page=`, 50 codes a page) and the tables it publishes;
with `?code=<code>`, a code's page (`facts()`). For a table's id it shows that
table alone, with which pods use which version (`uses()`). Check now posts to
`/tables/check`.
A pod's page names each record by its code's name in those tables
(`about(codesOf(answers))`), else by the record's own text, and marks a
retired code.
Stop the app's server
with Ctrl+C in its terminal, or by the process you started, never by killing
every Node process.

Before changing the app, read the full guide, the version matching the package
installed: `node_modules/cascade-runtime/guide/AGENTS.md`.

An app never:

- writes a pod's files, or reads them but through `ask`;
- parses Turtle: it asks a question instead;
- names a thing: it uses the guide's placeholders and the IRIs calls return;
- imports or claims what the person has not said is theirs.
