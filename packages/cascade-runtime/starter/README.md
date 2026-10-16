# cascade-app

An app on a Cascade pod: a small web server that shows what a pod holds, and
commands to load, make, remove and ask pods. It depends only on
`cascade-runtime`, which keeps the pods; this app never writes a pod's files
itself.

The app is made with four pods, `alex-rivera`, `priya-natarajan`,
`martin-okafor` and `tamsin-vale`, loaded from the kits the package carries.
Alex Rivera, Priya Natarajan, Martin Okafor and Tamsin Vale are made up. Alex's
records come from Apple Health exports; Priya's from exports and C-CDA files
together; Martin's pod holds two FHIR reports of one variant beside what
ClinVar says today; Tamsin's two pulls from one hospital a year apart, her
metformin stopped between them. `npm run reset`
puts the app back as it was made.

## Start

```sh
npm start
```

then open <http://127.0.0.1:3000/>. The pods are on the left, named as their
people. A pod's page reads as that person's health record: how many records,
from which places; what is worth a look, such as two hospitals disagreeing on
how severe an allergy is, or a genetic report that differs from ClinVar today,
each linking to its entry; and a tile for
each kind of record, which opens a table you can sort by a heading and filter.
"+ New pod" makes a pod for anyone by name, or for one of the demo hospitals'
made-up patients in one click. Tick "Encrypt this pod with six words" there and the app
shows six words, asks for the second and the fifth, and only then makes the pod with
every file sealed; after a restart the pod's page asks for the words. The words
are the only way in and cannot be recovered. `npm run ask`, `npm run console` and
`npm run mcp` do not open an encrypted pod: they say so in one line.

Under what is worth a look, a pod with medication history and lab results has
"What changed": for each test whose results differ before and after a
medication started or stopped, a card with the two means, a small chart, the
results behind it and "Open the trend", a chart of that test over time with the
medication's start and stop dashed across it, at
`/pods/<name>/trend?test=<LOINC>&medication=<RxNorm>`. It states what changed
after what, never why. Alex's, Priya's and Martin's pods hold too little to show a card.
Ines Calloway, a made-up patient at Cascade North, does: her LDL is lower after
atorvastatin started. "+ New pod", Ines Calloway, "Sign in at Cascade North" and
"Bring it into … pod" make that pod.

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

## Chat with the pods in the app

Run `npm run model` once, then `npm start`: every page has a chat strip at the
bottom. Ask "find anything interesting" and it answers from the pod's records,
with the numbers of each change and the lab results behind it as a card under
the answer, and "Open the trend" draws it. Ask it to "open Ines Calloway's pod"
and the app goes there, with your chat. Stop ends the model's answer. Chats are
kept by your browser, under the pod they are about. Each question goes to the
model you chose with the newest part of the chat (its last 24,000 characters)
and what its tools read from the pod. Without a model the
strip only says to run `npm run model`. The chat can only read: it never
changes a pod.

An empty chat offers up to four questions worked out from the pod's own records
(not by a model), such as "Did LDL cholesterol change after atorvastatin 20 MG Oral Tablet
started?", and each What changed card, each trend and each entry has an "Ask
about this" button that opens a new chat about that one thing, named at the top
of the chat. The model is told to explain the thing, never the person.

## Ask the pods from Claude Desktop, VS Code or any MCP client

`npm run mcp` is an [MCP](https://modelcontextprotocol.io) server on stdio over
the app's pods. A client starts it; it prints nothing itself. It offers:

- `list_pods`: the pods' names.
- `find_changes`: what changed in a pod's lab results after a medication
  started or stopped, strongest first, with the numbers; `finding_rows` gives
  the lab rows behind one, `lab_series` one test's results over time and
  `timeline` each medication's start and end. They state what changed, never
  why. Each finding of `find_changes` carries `view`, the address of the trend
  that draws its results; it opens while `npm start` runs, on `PORT` if the
  client has it too, else 3000.
- `worth_a_look`: what the pod's page lists under Worth a look, in its order:
  each line's sentence, its entry's ID and its tag. It states what is flagged
  (an entry that needs review, a report that differs from ClinVar today,
  medications that share an ingredient), never why.
- `ask`: a pod's records by the name of a question (allergies, conditions,
  medications, medication history, lab results, immunizations, procedures,
  genetic variants, the person, where an entry came from), a few rows of the
  many; it never takes a query of your own.

Every tool but `list_pods` takes the pod's name. Ask "find anything interesting
in this pod" or "did anything change after I stopped metformin?" and the client
calls the tools. Restart the client's server after `npm run pod:reset` of a pod
it has shown.

**A hosted client sends what the tools return to its provider.** The pods this
app is made with, and the demo hospitals' patients, are made up. A pod you made
from your own records is yours to decide about: use a model that runs on your
machine, or leave that pod out.

**Claude Desktop.** Open Settings, Developer, Edit Config, and add the server
to `claude_desktop_config.json` (on Windows `%APPDATA%\Claude\`, on macOS
`~/Library/Application Support/Claude/`), with this app's folder in the path
(`args` must use an absolute path, as Claude Desktop starts the server from
another folder; forward slashes work on Windows too), then quit Claude Desktop
and start it again:

```json
{
  "mcpServers": {
    "cascade": {
      "command": "node",
      "args": ["C:/path/to/my-app/mcp.mjs"]
    }
  }
}
```

If Claude Desktop cannot find `node`, give the full path to it as `command`.

**VS Code.** In this app's folder, make `.vscode/mcp.json`, then start the
server from the file's Start link or from Chat in Agent mode:

```json
{
  "servers": {
    "cascade": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/mcp.mjs"]
    }
  }
}
```

## The commands

`npm run help` lists every command with what it does. An option to an npm
script goes after `--`, or npm keeps it for itself.

- `npm run dev` serves the app as `npm start` does, restarting it whenever a
  file is saved.
- `npm run reset` removes every pod and loads Alex's, Priya's, Martin's and Tamsin's again, as
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
- `npm run model` asks which model a chat will use: Google Gemini, Groq or
  OpenRouter (each gives a free key from a sign-up page), Ollama or LM Studio
  on this computer, Anthropic, or another OpenAI-compatible address. It says
  what that provider does with what it is sent, makes one real request to
  check that the model calls a tool, and keeps the choice and the key in
  `.env` beside `server.mjs`, which git ignores. A free hosted tier is for the
  example and story pods, not a person's own. Run it again to change the
  choice; `npm run model -- --off` removes it.
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
  one a command works on, deleting and resetting them all, and the addresses
  of a pod's page and its trend.
- `pod.mjs`, `kit.mjs`, `ask.mjs`, `console.mjs`: the commands, and
  `help.mjs`, which lists them.
- `mcp.mjs`, `mcp-server.mjs`: the MCP server on stdio, and the tools it
  offers.
- `model.mjs`, `model-client.mjs`: `npm run model`, and the one door to a
  model, whichever provider.
- `pod-tools.mjs`: the tools over a pod, which the MCP server and the chat
  share.
- `chat.mjs`: `POST /chat`, the chat's loop: the model's tool calls run over
  the pods, with tools that open the app's own pages.
- `AGENTS.md`: for a coding agent building on this app.

The full guide to `cascade-runtime` is in
`node_modules/cascade-runtime/guide/AGENTS.md`.
