# Building an app on a Cascade pod

<!-- PREVIEW.md -->

## What this is

A pod holds one person's health records, from their hospitals and their own
entries, with their judgments on them. `cascade-runtime` alone reads and writes a
pod, through the calls below. Installing it is explained at
<https://jayostis.github.io/cascade-runtime-js/>.

## What a pod holds

- **Allergies**: allergen, criticality, reactions.
- **Conditions**: name, status, onset.
- **Immunizations**: vaccine, the day given.
- **Procedures**: name, the day done.
- **Patient profile**: how each hospital names the person.

Nothing else: a daily measurement, medications or lab results need new terms in
the vocabulary first, so tell the person and build none of them. Records come
only from an Apple Health export, unzipped, whose clinical records are FHIR R4.

## What an app never does

It never writes a pod's files, and reads them only through `ask`. It never
parses Turtle: it asks a question. It never names a thing: it uses the
templates' placeholders and IRIs that `ask` or a call returned. It never claims
an export without asking the person. It opens a folder once, awaits each call,
and passes no address.

A result with `refused` is the rules turning the person's data down: nothing
was written; show them the reason. A rejected promise is the app's mistake: an
unknown question or lens, a query that is no `SELECT`, Turtle that is not one
judgment, a member that names no record, a folder holding files but no pod, a
call after `close`. Only `look` of a folder that is no export is the person's
doing, and the flow below catches it.

## The starter

This app was made from a starter, a demonstration: rebuild it in any framework,
keeping the package and the pods, under `pods/<name>/` (it ships none).

- `npm start` serves the app. An option to an npm script goes after `--`.
- `npm run pod:load -- <kit> [--through <step>] [--as <name>]` replays a kit's
  story into `pods/<name>/`: `alex-rivera`, test data, no real person's.
  `--through J1` stops after her first export, leaving the rest to `import`.
- `npm run pod:new <name>` makes an empty pod, for real downloads.
- `npm run pod:reset <name>` removes a pod.
- `npm run ask -- [--pod <name>] "<question>"` prints a question's rows.
- `npm run console -- [--pod <name>]` opens a REPL with the pod as `pod`.

Alex's exports, each folder what `look` and `import` take, are at
`node_modules/cascade-runtime/components/cascade-vocabulary/<commit>/conformance/alex-rivera/scripted-input/alex/downloads/x-e<N>/apple_health_export`,
`<commit>` being the one `components/packed.json` names.

## Open a pod

The examples are one app's code, top to bottom. Three stand-ins for the person,
which an app writes itself: `pickExport()` returns the folder they chose,
`askPerson(question, shown)` their yes or no, `showPerson(shown)` tells them.

```js
import { openPod } from "cascade-runtime";

let pod = await openPod("pods/mine", { title: "My records" });
const { address, subject, owner } = pod;
await pod.close();
pod = await openPod("pods/mine");
```

A missing or empty folder is a new pod, the only time `title` is read;
`openPod()` is one in memory. `subject` is whom the records are about, `owner`
who keeps the pod. `address` is a random base the pod's names are made from,
and nothing else: no identity is registered under it or under `subject` (that
comes later, jayostis/cascade-vocabulary#62).

## Bring in an export

The default flow, on each export the person picks. `look` reads the export's
index and writes nothing: one source per hospital server, with its `name`,
`server`, `records` by kind, the times `received`, and `claimed`. The person
says whether the export is theirs, and `import` takes the answer.

```js
async function recordsNaming(profile) {
  const rows = await pod.ask("profile/Which records name it");
  return rows.filter((row) => row.profile === profile).map((row) => row.record);
}

async function bringIn(exportFolder) {
  const sources = await pod.look(exportFolder).catch(() => undefined);
  if (sources === undefined) {
    await showPerson("That folder is not an unzipped Apple Health export.");
    return undefined;
  }
  const aboutSubject = await askPerson("Are these records about you?", sources);
  const imported = await pod.import(exportFolder, { aboutSubject });
  if (imported.refused) await showPerson(`Not brought in: ${imported.refused}`);
  const claimed = [];
  for (const { profile } of imported.claimed) {
    claimed.push({ profile, records: await recordsNaming(profile) });
  }
  await showPerson({ claimed, unclaimed: imported.unclaimed });
  return imported;
}

await bringIn(pickExport());
await bringIn(pickExport());
```

The look names no patient: `claimed` means the pod holds the subject's records
from that server, not that this export's are theirs; a second server is a
source of its own. With `aboutSubject: true`, `import` claims every profile not
yet claimed; without it, records stay in no view, their profiles `unclaimed`.
Importing again writes nothing. `import` runs the matcher: call no `match`.

## Ask

`ask` takes a question's name, or `{ query }` with the app's own `SELECT`, and
an optional `{ lens }`. Rows come in the query's order, each plain strings by
variable name, an unbound variable absent; `entry`, `record`, `profile` and
`judgment` hold IRIs, which the calls take as they are.

An entry is what an app shows: one allergy, joining its records from every
source. Search the entries in the views, never the records: a pod holds records
no view shows, another person's or ones entered in error.

```js
const allergies = await pod.ask("pod/My active allergies");
await showPerson(await pod.ask("pod/My active allergies", { lens: "export" }));

async function search(word) {
  return pod.ask({
    query: `PREFIX cascade: <https://ns.cascadeprotocol.org/core/v1#>
      SELECT DISTINCT ?entry ?view ?field ?value WHERE {
        GRAPH ?view { ?entry cascade:mergedFrom [] ; ?field ?value }
        FILTER (isLiteral(?value) && CONTAINS(LCASE(STR(?value)), LCASE(${JSON.stringify(word)})))
      } ORDER BY ?entry ?field`,
  });
}

async function recordsIn(entry) {
  const rows = await pod.ask("record/Which entry shows it");
  return rows.filter((row) => row.entry === entry).map((row) => row.record);
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
- `pod/My immunizations`: immunizations, newest first.
- `pod/My procedures`: procedures, newest first.
- `pod/The person this pod is about`: the subject.
- `pod/What each folder holds`: each folder's things by type.
- `pod/What each import brought in`: each import's or entry's revisions.
- `pod/What everything is called`: every label.
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

- `everyday`: the default; a judgment counts unless superseded, retracted, or
  made by the matcher under a table since replaced.
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
    code && `health:allergenCode <${code}>`,
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

async function entered(turtle) {
  const done = await pod.enter(turtle);
  if (done.refused) await showPerson(`Not saved: ${done.refused}`);
}

const reaction = 'Hives, then "my throat closed"\nwithin minutes';
await entered(allergy(pod, { allergen: "Peanuts", reaction }));
await entered(condition(pod, "High blood pressure", "active", "2021-03-01"));
await entered(immunization(pod, "Hepatitis B", "08", "2004-06-01"));
await entered(procedure(pod, "Appendectomy", "80146002", "2012-07-15"));
```

`criticality` is `low`, `high` or `unable-to-assess`; a condition's `status` is
`active`, `recurrence`, `relapse`, `inactive`, `remission` or `resolved`; an
allergen code is an IRI. `enter` runs the matcher. An entered allergy has no
status, which only a hospital gives: `search` finds it in the allergies view,
but `pod/My active allergies` never lists it.

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

async function judged(turtle) {
  const done = await pod.judge(turtle);
  if (done.refused) await showPerson(`Not saved: ${done.refused}`);
  return done.judgment;
}
const joinedIn = (rows) => rows.find(({ records }) => Number(records) > 1);
const oneAllergy = await recordsIn(joinedIn(allergies).entry);
const machineSame = (await pod.ask("record/Which judgments name it")).find(
  (row) => oneAllergy.includes(row.record) && row.verdict.endsWith("#Same"),
);
await judged(sameInstead(pod, oneAllergy, machineSame.judgment, "confirmed"));

const shot = joinedIn(await pod.ask("pod/My immunizations"));
await judged(different(pod, await recordsIn(shot.entry), "two shots"));

const [mine] = await search("high blood pressure");
const [theirs] = await search("hypertension");
const pair = await recordsIn(mine.entry);
pair.push(...(await recordsIn(theirs.entry)));
const joined = await judged(same(pod, pair, "the same blood pressure"));
await judged(retraction(pod, joined, "my doctor says these are different"));

const [wrong] = await recordsIn((await search("back pain"))[0].entry);
await judged(erroneous(pod, wrong, "I never had this"));
```

`sameInstead` confirms the matcher's join, so it rests on the person. A
Different wins over a Same, though a later record can join its members again.
An Erroneous record leaves every view. A judgment is never edited: a retraction
takes one back. `jdg:OwnerStatement` is the one basis a person states.

## When an export holds someone else's records

An export can carry another person's records, a child's, under a hospital the
pod has claimed: the look shows it claimed, and `import` claims that profile
too. Only `claimed`, shown to the person, catches it: retract the About of any
profile not theirs, and its records leave every view.

```js
async function confirmClaims(imported) {
  for (const { profile, judgment: claim } of imported?.claimed ?? []) {
    const records = await recordsNaming(profile);
    if (!(await askPerson("Are these your records?", { profile, records }))) {
      await judged(retraction(pod, claim, "these are someone else's records"));
    }
  }
}

await confirmClaims(await bringIn(pickExport()));
```

## The steps run separately

`import` with `{ match: false }` only files, and without `aboutSubject` claims
nothing: for a large import that defers matching, or one filed without the
claim. Claim each `unclaimed` profile with an About, then `match` the import's
`activity`; `match()` rechecks the pod. Then show `entry/What needs review`:
here a new server's record joined two the person had kept apart.

```js
const filed = await pod.import(pickExport(), { match: false });
for (const profile of filed.unclaimed) {
  const records = await recordsNaming(profile);
  if (await askPerson("Are these your records?", { profile, records })) {
    await judged(about(pod, profile));
  }
}
await pod.match(filed.activity);
await pod.match();

for (const { entry, needs } of await pod.ask("entry/What needs review")) {
  if (needs !== "judged different, still joined") continue;
  const records = await recordsIn(entry);
  if (await askPerson("Are all of these different?", records)) {
    await judged(different(pod, records, "each of these is its own"));
  }
}
await pod.close();
```

`replayKit` from `cascade-runtime/fixtures`, which `npm run pod:load` calls,
replays a kit's story into an empty folder, resolving to one
`{ step, kind, wrote, refused }` per step; `kind` is `creation`, `import`,
`entry`, `judgment`, `reference` or `matcher`.

```js
import { replayKit } from "cascade-runtime/fixtures";

await replayKit("alex-rivera", "pods/alex-rivera", { through: "J1" });
const alex = await openPod("pods/alex-rivera");
await showPerson(await alex.ask("pod/My active allergies"));
await alex.close();
```

## What it cannot do yet

- The matcher's tables are alpha test tables: a real export gets few joins.
- Alex's story runs into 2027: a record entered today orders before hers.
- Node 22 only, the pod in a folder or in memory; each call rebuilds its views.
- No server, sign-in or sharing, and not for a real person's records.
