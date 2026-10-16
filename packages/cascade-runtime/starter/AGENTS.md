# For an agent building on this app

This app was made from the Cascade starter. It is a demonstration, not a
foundation: rebuild it in any framework. What carries over is
`cascade-runtime`, which keeps the pods, and the pods under `pods/<name>/`. It
starts with three, Alex Rivera's, Priya Natarajan's and Martin Okafor's (two
FHIR reports of one variant, beside what ClinVar says today), loaded from the
kits the package carries; `npm run reset` puts them back as they were made, and
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
`npm run mcp` runs `mcp.mjs`, an MCP server on stdio over the pods, for
Claude Desktop, VS Code or any MCP client (the README says how to add it);
`pod-tools.mjs` holds its tools, which are `changeTools` of `cascade-runtime`
beside `list_pods`, `ask` and `worth_a_look` (`worthLines`: `worthALook` on the same
inputs the page reads), each taking the pod's name; `chat.mjs`, the
app's `POST /chat`, runs the same tools for a model and adds three that open the
app's own pages. A hosted client sends what the tools return to its provider:
never point one at a person's own pod without their say. The starter holds only
made-up records (the kits, the demo hospitals); before connecting real records,
decide whether a hosted model may see them.
`npm run model` runs `model.mjs`: it asks which model a chat uses, checks that the
model calls a tool and writes `CASCADE_MODEL_PROVIDER`, `_URL`, `_NAME` and `_KEY`
to `.env` (untracked; `--off` removes them). `model-client.mjs` is the one door to
a model: `modelFrom()` reads those settings, loads `.env` itself and gives
nothing when there are none; a model's `turn()` streams events whatever the
provider. Nothing else may know a provider's wire format or hold its key.
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
with `?code=<code>`, a code's page (`facts()`), which links to the code's own
page at its publisher where its code system has one. For a table's id it shows that
table alone, with which pods use which version (`uses()`). Check now posts to
`/tables/check`.
A pod's page names each record by its code's name in those tables
(`about(codesOf(answers))`, gathered by `codesSaid`), else by the record's own
text, and tags a retired code. Above the tiles, "Worth a look" (`worthALook`,
drawn by `worthPart`) lists what needs review, each report that differs from
ClinVar today and each pair of medications that share an ingredient, each line
linking to its entry; a line, a row and an entry carry the same tag (`TAGS`).
Below it, "What changed" (`changedPart`, over `changesIn` of the pod's
medication history and lab results) has a card for each change after a
medication started or stopped, in `CHANGED`'s words, which state an order and a
comparison of means and never a cause; each card links to its results
(`#change-<key>`) and to the trend at `/pods/<name>/trend?test=<LOINC>&medication=<RxNorm>`
(`trendPage` over `labSeriesIn` and `timelineIn`; `trendPath` in `pods.mjs`
makes the address, a view never builds one). The three people's pods hold too
little for a card; a story patient's does: Ines Calloway, at Cascade North, by
"+ New pod" and "Sign in at Cascade North". `TREND_VIEW` is the trend as a tool
a model can call, which a browser host registers with `useView`; this server's
pages register nothing, and a model reaches the trend through each
`find_changes` finding's `view` address.
Every page has the chat strip (`Chat` renders it, from the `chat` that `frame`
is given: the model's `{ provider, name, local }`, never its address or key, the
pod's name, and `suggestions`, a list of texts; `chatStrip` runs it, both in
`summary.mjs`, with `CHAT_STYLE`). It talks to `POST /chat` (`chat.mjs`). The
browser keeps the chats, in `localStorage`, each under the pod it is about, and
the open chat's ID in `sessionStorage` (`cascade.chat.open`); a tool's `open`
address moves the app there when the turn ends, and the chat goes with it. Any
element with `data-ask` (a JSON context) starts a new chat with that context,
and one with `data-ask-text` sends its text as typed. A `data-ask` click also sends
the kind's first question (`firstQuestion`), stopping a turn still running first.
A row of a tile's table opens its entry at
`/pods/<name>/entries/<id>`: what it is, where it came from (a line for each
document its records were derived from) and what else is known, which is what
Cascade did with it and what the tables say of its codes, each claim naming its
table and version. The page finds the entry by the last part of its IRI
(`entryId`); it never builds an IRI from an address. A genetic variant is a tile
and an entry like any other: its entry shows each of its reports, with the lab
it came from, beside what ClinVar says today (`variantClassification()`,
`pod.agreement()` and `labels()`, gathered by `variantsSaid`), read from the
app's current version of the series, with its credit; when that finds one
variation and a ClinVar names series holds its name, the entry is called by that
name, protein change included; it records nothing in the pod. A pod with active medications links to `/pods/<name>/classes`, its medicines
by class (`pod.medicationClasses()`, the classes named by `classesSaid`): the
classes the tables give each, one class alone at `?class=<class IRI>`, which
medicines are in none, and which have a class left out because the sources class
their ingredient's forms differently; a lab result coded in LOINC is named by LOINC's long common
name, and a code's page in the tables shows a panel's members and the classes of a
medication.
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
