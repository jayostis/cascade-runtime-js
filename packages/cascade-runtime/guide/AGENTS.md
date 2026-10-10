# Building an app on a Cascade pod

## What this is

A pod holds one person's health records, from their hospitals and their own
entries, with their judgments on them, read and written only through the calls
of `cascade-runtime` below: <https://jayostis.github.io/cascade-runtime-js/>.

## What a pod holds

- **Allergies**: allergen, criticality, reactions.
- **Conditions**: name, status, onset.
- **Immunizations**: vaccine, the day given.
- **Procedures**: name, the day done.
- **Medications**: drug, RxNorm code, prescribed or on the person's list.
- **Lab results**: test, LOINC code, value, unit, the time taken.
- **Patient profile**: how each hospital names the person.

Nothing else: a daily measurement needs new terms in the vocabulary first, so
tell the person and build none of them. Records come from two formats: an Apple
Health export, unzipped, whose clinical records are FHIR R4, and a C-CDA file,
a summary of care as a patient portal hands it out.

## What an app never does

It never writes a pod's files, and reads them only through `ask`. It never
parses Turtle: it asks a question. It never names a thing: it uses the
templates' placeholders and IRIs that `ask` or a call returned. It never
imports or claims what the person has not said is theirs. It opens a folder
once, awaits each call, and passes no address. A result with `refused` is the
rules turning the person's data down: nothing was written; show them the
reason. A rejected promise is the app's mistake: an unknown question or lens,
a query that is no `SELECT`, Turtle that is not one judgment, a member that
names no record, a folder holding files but no pod, a call after `close`. Only
`look` of a folder or file that is no export is the person's doing, caught below.

## The starter

This app was made from a starter, a demonstration: rebuild it in any framework,
keeping the package and the pods, under `pods/<name>/`. It is made with two,
`alex-rivera` and `priya-natarajan`.

- `npm run help` lists every command.
- `npm run reset` removes every pod and loads those two again.
- `npm run dev` serves the app as `npm start` does, restarting it on every save.
- `npm start` serves the app; stop it with Ctrl+C or by its process, never by
  killing every Node process. A pod's page links to bringing in a record from a
  hospital of the test directory: the app's `hospitals.mjs` signs in, receiving
  the redirect on `/callback`, and serves the demo hospitals' sign-in pages
  under `/demo-hospitals/`. An option to an npm script goes after `--`.
- `npm run pod:load -- <kit> [--through <step>] [--as <name>]` replays a kit's
  story into `pods/<name>/`: `alex-rivera` is Alex Rivera's, from Apple Health
  exports, and `priya-natarajan` Priya Natarajan's, from exports and C-CDA
  files together. `--through J1` stops Alex's after her first export, leaving
  the rest to `import`.
- `npm run pod:new <name>` makes an empty pod.
- `npm run pod:reset <name>` removes a pod.
- `npm run ask -- [--pod <name>] "<question>"` prints a question's rows.
- `npm run console -- [--pod <name>]` opens a REPL with the pod as `pod`.
- `npm run kit:export -- <kit> <download>` copies a download into the app, for
  `look`: `alex-rivera x-e12` as `apple_health_export`, and
  `priya-natarajan kestrel-harbor-health-summary.xml` as that file.

## Open a pod

The examples are one app's code, top to bottom. Three stand-ins for the person,
which an app writes itself: `pickExport()` returns the folder they chose,
`askPerson(question, shown)` their yes or no, `showPerson(shown)` tells them.

```js
import { openPod } from "cascade-runtime";
const pod = await openPod("pods/mine", { title: "My records" });
```

A missing or empty folder is a new pod, the only time `title` is read;
`openPod()` is one in memory. `subject` is whom the records are about, `owner`
who keeps the pod, `address` a random base its names are made from: no identity
is registered under either (that comes later, jayostis/cascade-vocabulary#62).
A pod's answers are kept beside it, never in it: in `.answers/<name>/` beside
its folder. An ask by name returns what was kept until any step changes the
pod or the tables; removing a pod's folder, remove its `.answers/<name>` too.

The matcher's reference tables come from the feeds `cascade-runtime.json`
names. The pods in a folder share `.tables/` in it: the first `openPod` in a
process reads the feeds, unless `tables.checkOnOpen` is `false`, and keeps each
newer version that verifies. `(await tablesBeside("pods")).check({ cache: "no-cache" })`
checks again ("Check now"); a feed that cannot be read now says `later`, and
nothing is thrown. Opening a pod after its tables changed gives it them:
`pod.opened` says what that wrote, and `pod.opened.unheld` the versions it
names that the app does not hold, which it is matched without. A pod in memory
gets the package's starter copies.

What a page shows of the tables, the same `Tables` answers, in Node and in a
browser (`appTables()`), as plain values: `held()`, each series with its
source, licence, credit, versions and how fresh its feed is; `uses()`, the
pods last opened with each version, by name; `search(series, text, page)`, the
codes of its current version, or of several series' (a source's), that are
`text` or whose name holds it, 50 a page (`total` of them, the page after
`offset`), each with what `about(codes)` says of it (its name and status) and
the codes it maps to; `codeNamed(series, notation)`, the code written so; and
`facts(code)`, what every held table says of a code, each fact with its series
and version.
A pod's own page names a record by its code's name, else by the record's own
text, from its question's code columns in this order: `code` of
`pod/My active allergies`, `pod/My active medications`, `pod/My lab results`
and `pod/My immunizations`; `icd10`, then `snomed`, of
`pod/My active conditions`; `snomed` of `pod/My procedures`. Each holds a
code's IRI in its system, which `about` takes as it is.

An app sets its own tables in a `cascade-runtime.json` of its own, in the
folder it runs in, naming `tables` and nothing else, or in code with
`configureTables({ ... })` before the first pod opens; each field given replaces
the package's, and code wins over the file. `feeds` lists every feed the app
reads, the package's among them if it keeps it; `preference` gives each table
kind's IRI the series a person reads it from, first first; `checkOnOpen: false`
leaves only "Check now". `(await tablesBeside("pods")).about([codeIri])` gives
each code's name and status from the first series in that order that holds it.
In Node only, `builders` names sources whose builders run on this machine in
each check, a name under cascade-reference-tables' `builders/` or a path from
the file; what one builds is kept as a feed's versions are, from
`pods/.builds/<name>/`. A builder runs through cascade-reference-tables, which
the app installs itself:
`npm install --save-exact github:jayostis/cascade-reference-tables#1101d9b070dcc435098c0b1a616152f9fc64b3ea`.
A version that does not descend from the one held of its series is never kept.

In a browser, the same import, served with the package's `components/` beside
its `dist/`, runs every call. A pod's name names
its IndexedDB database, `cascade-pod:<name>`; `openPod(name, { from })` starts
an empty one as a copy of the pod published at the URL `from`: from its pack,
`<folder>.pack.json`, when one is published beside it, else as its `files.json`
lists it, with the `answers.json` and `pod.json` published beside it. Its
answers are kept in `cascade-answers:<name>`, and `deletePod(name)` deletes
both. Its address is a name, never the page's. A browser may clear its storage,
and the pod with it. A pod with kept answers opens and answers its questions
without the engine, a 4 MB module; the first call that computes loads it, and
`warm()` loads it and compiles the Bridge ahead, so both are ready when a
record arrives.
A browser has no path, so `look` and `import` take the files the person picked,
each by its path: `new Map([...input.files].map((file) => [file.webkitRelativePath || file.name, file]))`
from an `<input type="file">`, with `webkitdirectory` for an export's folder.
Node takes such a map too. The first `import` loads the Bridge, about 4.5 MB.
A browser keeps its tables in one IndexedDB database for the app,
`<name>:cascade-tables`, `name` the page's folder unless
`configureTables({ name, fetch })` says otherwise before the first pod opens.
It reads the feeds once the engine loads, and `checkTables()` is "Check now".
`configureTables` also takes `feeds`, `preference` and `checkOnOpen`, as Node
does; a browser runs no builder and reads no file of the app's.
An empty database starts from the package's starter copies, as a folder does.
A pod copied with `from` is taken as published: its first open records the
tables the browser then holds without adopting them, and a later open adopts
only tables newer than those.

## Bring in an export

On each export or downloaded C-CDA file the person picks, `look` reads its index
and writes nothing: one source per hospital server, or per document's custodian,
with its `name`, a FHIR source's `server`, `records` by kind, a C-CDA's entries
per `sections` title, the times `received`, and `claimed`. Ask the person
whether the export is theirs; `import` it only after a yes. On a no, call nothing: the pod keeps none of it.

```js
async function recordsBy(question, by) {
  const rows = await pod.ask(question);
  return (key) =>
    rows.filter((row) => row[by] === key).map((row) => row.record);
}

async function bringIn(folder, options = {}) {
  const sources = await pod.look(folder).catch(async (error) => {
    if (!/^no importer .* reads |^\S+ cannot read /.test(error.message))
      throw error;
    await showPerson(
      "That is neither an Apple Health export nor a C-CDA file.",
    );
  });
  if (sources === undefined) return undefined;
  if (!(await askPerson("Are these records yours?", sources))) return undefined;
  const imported = await pod.import(folder, { aboutSubject: true, ...options });
  if (imported.refused) await showPerson(`Not brought in: ${imported.refused}`);
  const naming = await recordsBy("profile/Which records name it", "profile");
  const claimed = imported.claimed.map(({ profile: p }) => [p, naming(p)]);
  await showPerson({ claimed, unclaimed: imported.unclaimed });
  return imported;
}

await bringIn(pickExport());
await bringIn(pickExport());
```

The look names no patient: `claimed` means the pod holds the subject's records
from that server, or from a document that custodian wrote, not that this
export's are theirs; a second server is a source of its own, and so is a
hospital's custodian beside its server. `import` with the yes claims every profile not yet claimed, runs the
matcher (call no `match`), and writes nothing when the export is already in.

## Connect to a hospital

The same calls run in Node and in a browser:

- `connect(row, registration, { signIn })` signs the person in to the hospital a
  directory row names, as a SMART patient launch, and gives a `Connection`;
- `pull(connection, DEMO_PLAN)` fetches the record, and gives a `Pull`;
- `pod.import(pullFiles(pull, name), { aboutSubject: true })` brings it in, as
  `bringIn` does an export.

A failure is a `ConnectionFailure`, whose `kind` says why: `cancelled` when the
person said no or closed the sign-in.

**The sign-in step** differs:

- In Node, an app with a server of its own, as the starter is, sends the
  person to the authorize URL and receives the redirect on a route of its own:
  the starter's `/callback`, at its registration's redirect URI, finds the
  waiting sign-in by the redirect's `state`. An app with no server uses
  `loopbackSignIn`, which listens for the redirect itself.
- In a browser it is `popupSignIn({ popup })`. Open the popup with
  `window.open` in the click that asked to connect, since a browser blocks it
  once the click is over, and pass it in.
- The page at the registration's redirect URI, on the app's own origin, calls
  `finishSignIn()`. It hands the URL back to the window that opened the popup.
- A real hospital's login page that sends `Cross-Origin-Opener-Policy` cuts the
  popup off from that window.

**The demo hospitals** need no account:

- In Node, pass `fetch: demoFetch(hospitals)`.
- In a browser, a service worker serves them. The app hosts its file on its own
  origin, in the folder of the page, and calls `useDemoHospitals()` before
  connecting.
- Their addresses are `https:`, so a CSP's `connect-src` must allow
  `https://*.demo.invalid`.
- A hard reload bypasses the worker. The site's `try/` page shows all of
  this.
- A real browser cannot open a `.demo.invalid` address, so the app serves a
  demo hospital's sign-in page itself: `demoFetch`'s `authorizeBase` puts each
  hospital's page under the app's own origin, and the app hands every request
  there to that `fetch`. The starter does, under `/demo-hospitals/`.

In Node, from finding the hospital to its record in a pod of its own:

```js
import { demoFetch } from "@cascade-runtime/demo-hospital";
import { loadHospitals } from "@cascade-runtime/demo-hospital/node";
import {
  connect,
  DEMO_PLAN,
  pull,
  pullFiles,
  searchDirectory,
  TEST_DIRECTORY,
} from "cascade-runtime";

const app = "http://127.0.0.1:3000";
const demoHospitals = demoFetch(await loadHospitals(), {
  authorizeBase: `${app}/demo-hospitals/`,
});
const [north] = searchDirectory(TEST_DIRECTORY, "north");
const connection = await connect(
  north,
  {
    clientId: "my-app",
    redirectUri: `${app}/callback`,
    scopes: ["launch/patient", "patient/*.read", "patient/*.rs"],
  },
  {
    signIn: (authorize) => openBrowser(authorize),
    fetch: demoHospitals,
  },
);
const record = await pull(connection, DEMO_PLAN);
const hospitalPod = await openPod("pods/hospital");
const files = pullFiles(record, "cascade-north-1");
if (
  await askPerson("Are these records yours?", await hospitalPod.look(files))
) {
  const brought = await hospitalPod.import(files, { aboutSubject: true });
  if (brought.refused) await showPerson(`Not brought in: ${brought.refused}`);
}
await hospitalPod.close();
```

`openBrowser(authorize)` is the app's: it sends the person to the hospital's
page and resolves with the URL the hospital redirected back to, the redirect
URI with its `code` and `state`. The hospital's page is under the app's
`/demo-hospitals/`, which the app's server answers with `demoHospitals`.

## Ask

`ask` takes a question's name, or `{ query }` with the app's own `SELECT`, and
an optional `{ lens }`. Rows come in the query's order, each plain strings by
variable name, an unbound variable absent; `entry`, `record`, `profile` and
`judgment` hold IRIs, which the calls take as they are.

An entry is what an app shows: one allergy, joining its records from every
source. Show it first: read an allergy's criticality and status from
`pod/My active allergies` (each active, its criticality the most severe its
records give), never from `entry/What it shows`, whose fields are the latest
record's. Its records go beneath (`entry/Where it came from`,
`record/What each version says`). Search the entries in the views, never the
records: no view shows another person's records, or ones entered in error.

```js
const allergies = await pod.ask("pod/My active allergies");
const inView = await recordsBy("record/Which entry shows it", "entry");
const shown = (one) => ({ ...one, status: "active", from: inView(one.entry) });
await showPerson(allergies.map(shown));

async function search(word) {
  const found = await pod.ask({
    query: `PREFIX cascade: <https://ns.cascadeprotocol.org/core/v1#>
      SELECT DISTINCT ?entry ?view ?field ?value WHERE {
        GRAPH ?view { ?entry cascade:mergedFrom [] ; ?field ?value }
        FILTER (isLiteral(?value) && CONTAINS(LCASE(STR(?value)), LCASE(${JSON.stringify(word)})))
      } ORDER BY ?entry ?field`,
  });
  if (found.length === 0) await showPerson(`Nothing found for "${word}".`);
  return found;
}
```

### Questions

- `entry/What it shows`: each entry's fields, and the record each came from.
- `entry/What needs review`: entries a person should look at, and why.
- `entry/Where it came from`: each member's arrival, import and hospital.
- `judgment/What needs review`: Same judgments a newer version may undo.
- `judgment/Whether it counts`: whether each judgment counts, and why not.
- `judgment/Who judged what`: everything each judgment says.
- `pod/How many judgments count`: counting judgments by verdict and maker.
- `pod/How many of each kind`: things of each type.
- `pod/My active allergies`: allergies a hospital gave the status active.
- `pod/My active conditions`: conditions whose status is active.
- `pod/My active medications`: medications whose status is active.
- `pod/My immunizations`: immunizations, newest first.
- `pod/My lab results`: lab results, newest first.
- `pod/My procedures`: procedures, newest first.
- `pod/The person this pod is about`: the subject.
- `pod/What each folder holds`: each folder's things by type.
- `pod/What each import brought in`: each import's or entry's revisions.
- `pod/What everything is called`: every label.
- `pod/What was seen more than once`: entries with more than one record, by place.
- `pod/Which file states each thing`: where each thing is stated.
- `pod/Which files are out of place`: files the layout puts elsewhere.
- `pod/Which reference versions are current`: the matcher's tables in use.
- `pod/Which view lists each kind`: the views and their entry counts.
- `profile/Which judgments name it`: the About judgments on each profile.
- `profile/Which records name it`: the records naming each profile.
- `profile/Whose it is counted as`: whose each profile is, by hospital.
- `record/Its revisions, in the order they arrived`: each record's arrivals.
- `record/What each version says`: each version's statements.
- `record/Which entry shows it`: the entry each record is in.
- `record/Which judgments name it`: the judgments on each record.
- `record/Why it is in no view`: why a hidden record is hidden.

### Lenses

- `everyday`: the default; a judgment counts unless superseded, retracted or
  made under a table since replaced.
- `export`: for sharing; a matcher's join counts only on a code, or code and day.

## Enter what the person wrote

An entry names nothing itself: the session is `<urn:cascade:this-entry>`, the
record `<urn:cascade:output-0>` and its content `<urn:cascade:output-0-version>`.
One template per kind; every value typed goes in through `text()`.

```js
const PREFIXES = `@prefix clinical: <https://ns.cascadeprotocol.org/clinical/v1#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix health: <https://ns.cascadeprotocol.org/health/v1#> .
@prefix jdg: <https://ns.cascadeprotocol.org/judgments/v1-draft#> .
@prefix npx: <http://purl.org/nanopub/x/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix rec: <https://ns.cascadeprotocol.org/records/v1-draft#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;
const text = (value) => JSON.stringify(String(value));
const day = (value) => `${text(value)}^^xsd:date`;
function iri(value) {
  if (/^[a-z][a-z\d+.-]*:[^\s<>"{}|\\^`]+$/i.test(value)) return `<${value}>`;
  throw new Error(`${text(value)} is no IRI`);
}

function entry(pod, type, statements) {
  return `${PREFIXES}
<urn:cascade:this-entry> a prov:Activity ; rdfs:label "entered by the person" ;
  prov:qualifiedAssociation [ prov:agent <${pod.owner}> ; prov:hadRole jdg:patient ] .
<urn:cascade:output-0> a ${type} .
<urn:cascade:output-0-version> prov:specializationOf <urn:cascade:output-0> ;
  ${statements.filter(Boolean).join(" ;\n  ")} ;
  rec:patient <${pod.subject}> .
`;
}

const allergy = (pod, { allergen, code, criticality, reaction }) =>
  entry(pod, "health:AllergyRecord", [
    `health:allergen ${text(allergen)}`,
    code && `health:allergenCode ${iri(code)}`,
    criticality && `clinical:criticality ${text(criticality)}`,
    reaction && `health:reaction ${text(reaction)}`,
  ]);
const condition = (pod, name, status, onset) =>
  entry(pod, "health:ConditionRecord", [
    `health:conditionName ${text(name)}`,
    `health:status ${text(status)}`,
    onset && `health:onsetDate ${day(onset)}`,
  ]);
const immunization = (pod, vaccine, code, given) =>
  entry(pod, "health:ImmunizationRecord", [
    `health:vaccineName ${text(vaccine)}`,
    `health:vaccineCode ${text(code)}`,
    `health:administrationDate ${day(given)}`,
  ]);
const procedure = (pod, name, snomed, performed) =>
  entry(pod, "clinical:Procedure", [
    `clinical:procedureName ${text(name)}`,
    `clinical:snomedCode ${text(snomed)}`,
    `clinical:procedureDate ${day(performed)}`,
  ]);

async function saved(step) {
  const done = await step;
  if (done.refused) await showPerson(`Not saved: ${done.refused}`);
  return done.judgment;
}
const entered = (turtle) => saved(pod.enter(turtle));

const reaction = 'Hives, then "my throat closed"\nwithin minutes';
await entered(allergy(pod, { allergen: "Peanuts", reaction }));
await entered(condition(pod, "High blood pressure", "active", "2021-03-01"));
await entered(immunization(pod, "Hepatitis B", "08", "2004-06-01"));
await entered(procedure(pod, "Appendectomy", "80146002", "2012-07-15"));
```

`criticality` is `low`, `high` or `unable-to-assess`; a condition's `status` is
`active`, `recurrence`, `relapse`, `inactive`, `remission` or `resolved`; an
allergen or condition name is never blank, else `enter` refuses it; an allergen
code is an absolute IRI, else `iri()` throws. `enter` runs the matcher. Only a
hospital's record gives an entry a status: an entered allergy joined to none is
in `search`, never in `pod/My active allergies`.

## Judge

A judgment is `<urn:cascade:this-judgment>`, by the owner as the patient, on
records, never entries. The package adds its time, and to a Same, Different or
Erroneous each member's current version as `prov:used`.

```js
function judgment(pod, reason, statements) {
  return `${PREFIXES}
<urn:cascade:this-judgment> a jdg:Judgment ;
  ${[...statements, reason && `dct:description ${text(reason)}`].filter(Boolean).join(" ;\n  ")} ;
  prov:wasAttributedTo <${pod.owner}> ;
  prov:qualifiedAttribution [ a prov:Attribution ; prov:agent <${pod.owner}> ; prov:hadRole jdg:patient ] .
<${pod.owner}> a prov:Person .
`;
}
const members = (records) => records.map((one) => `prov:hadMember <${one}>`);

const about = (pod, profile) =>
  judgment(pod, undefined, [
    "jdg:verdict jdg:About",
    `jdg:subject <${pod.subject}>`,
    "jdg:basis jdg:OwnerStatement",
    `prov:hadMember <${profile}>`,
  ]);
const same = (pod, records, reason) =>
  judgment(pod, reason, ["jdg:verdict jdg:Same", ...members(records)]);
const sameInstead = (pod, records, machineSame, reason) =>
  judgment(pod, reason, [
    "jdg:verdict jdg:Same",
    ...members(records),
    `npx:supersedes <${machineSame}>`,
  ]);
const different = (pod, records, reason) =>
  judgment(pod, reason, ["jdg:verdict jdg:Different", ...members(records)]);
const erroneous = (pod, record, reason) =>
  judgment(pod, reason, ["jdg:verdict jdg:Erroneous", ...members([record])]);
const retraction = (pod, earlier, reason) =>
  judgment(pod, reason, [`npx:retracts <${earlier}>`]);

const judged = (turtle) => saved(pod.judge(turtle));
const inEntry = await recordsBy("record/Which entry shows it", "entry");
const oneAllergy = inEntry(allergies.find((row) => row.records > 1)?.entry);
async function machineJoins() {
  const counts = await pod.ask("judgment/Whether it counts");
  const said = await pod.ask("judgment/Who judged what");
  const joins = new Map();
  for (const { judgment: j, author, verdict, member } of said)
    if (author !== pod.owner && verdict?.endsWith("#Same"))
      if (counts.some((c) => c.judgment === j && c.counts === "true"))
        joins.set(j, [...(joins.get(j) ?? []), member]);
  return joins;
}
for (const [machineSame, records] of await machineJoins())
  if (records.some((one) => oneAllergy.includes(one)))
    await judged(sameInstead(pod, oneAllergy, machineSame, "confirmed"));

async function sameAs(word, other, reason) {
  const [[mine], [theirs]] = [await search(word), await search(other)];
  if (!mine || !theirs) return undefined;
  const pair = [...inEntry(mine.entry), ...inEntry(theirs.entry)];
  return judged(same(pod, pair, reason));
}
const joined = await sameAs("high blood pressure", "hypertension", "same");
if (joined) await judged(retraction(pod, joined, "my doctor disagrees"));
await sameAs("bronchitis", "asthma", "the chest problem was my asthma");

const neverHad = inEntry((await search("back pain"))[0]?.entry);
for (const one of neverHad) await judged(erroneous(pod, one, "never had it"));
```

A Same or Different names the records the person means, typically two: "the new
asthma record is not the same as the old one". Offer it per record or pair
inside an entry, never one Different over a whole group, which overrides the
person's own Sames. A Different wins over a Same, though a later record can
rejoin them. `sameInstead` rests the matcher's join on the person. An Erroneous
record leaves every view. A retraction takes a judgment back; none is edited.
`jdg:OwnerStatement` is the one basis a person states.

## When an export holds someone else's records

An export can carry another person's records, a child's, under a hospital the
look shows claimed, and `import` claims that profile too. Only `claimed`, shown
to the person, catches it: retract the About of any profile not theirs.

```js
const isMine = (profile, naming) =>
  askPerson("Are these your records?", { profile, records: naming(profile) });
async function confirmClaims(imported) {
  const naming = await recordsBy("profile/Which records name it", "profile");
  for (const { profile, judgment: claim } of imported?.claimed ?? [])
    if (!(await isMine(profile, naming)))
      await judged(retraction(pod, claim, "these are someone else's records"));
}

await confirmClaims(await bringIn(pickExport()));
```

## The steps run separately

After the yes, `import` with `{ match: false }` only files, and without
`aboutSubject` claims nothing, so each profile is asked about alone: claim each
`unclaimed` one with an About, then `match` the import's `activity`; `match()`
rechecks the pod. Then offer each counting join of the matcher's, a pair at a
time, filing a Different over a pair the person says no to. `replayKit`, behind
`npm run pod:load`, fills an empty folder with a kit's story, for tests only.

```js
const fileOnly = { aboutSubject: false, match: false };
const filed = await bringIn(pickExport(), fileOnly);
const naming = await recordsBy("profile/Which records name it", "profile");
for (const profile of filed?.unclaimed ?? [])
  if (await isMine(profile, naming)) await judged(about(pod, profile));
if (filed?.activity) await pod.match(filed.activity);
await pod.match();
for (const records of (await machineJoins()).values())
  for (const [i, one] of records.entries())
    for (const other of records.slice(i + 1))
      if (!(await askPerson("Are these the same?", [one, other])))
        await judged(different(pod, [one, other], "not the same"));
await pod.close();

import { replayKit } from "cascade-runtime/fixtures"; // in a test only
await replayKit("alex-rivera", "pods/alex-rivera", { through: "J1" });
const her = await openPod("pods/alex-rivera");
await showPerson(await her.ask("pod/My active allergies", { lens: "export" }));
await her.close();
```

## What it cannot do yet

- The feed is a draft: until it publishes a series, a rule reading its kind
  joins nothing.
- Alex's story runs into 2027: a record entered today orders before hers.
- Node 22 or later, the pod in a folder or in memory; each call rebuilds its views.
- Sign-in reaches only the test directory: the demo hospitals and the SMART
  launcher, no real hospital. A sign-in lasts one pull: no refresh, no staying
  signed in.
- No server or sharing.
