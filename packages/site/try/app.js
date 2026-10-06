import { openPod } from "cascade-runtime";

const NAME = "alex-rivera";
const FROM = "../alex-rivera/pod/";
const ALLERGEN = "https://ns.cascadeprotocol.org/health/v1#allergen";

const PREFIXES = `@prefix clinical: <https://ns.cascadeprotocol.org/clinical/v1#> .
@prefix health: <https://ns.cascadeprotocol.org/health/v1#> .
@prefix jdg: <https://ns.cascadeprotocol.org/judgments/v1-draft#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix rec: <https://ns.cascadeprotocol.org/records/v1-draft#> .
`;
const text = (value) => JSON.stringify(String(value));

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

const allergy = (pod, { allergen, criticality }) =>
  entry(pod, "health:AllergyRecord", [
    `health:allergen ${text(allergen)}`,
    criticality && `clinical:criticality ${text(criticality)}`,
  ]);

const status = document.querySelector("#status");
const active = document.querySelector("#active tbody");
const added = document.querySelector("#added");
const form = document.querySelector("#add");
const startOver = document.querySelector("#start-over");
let pod;

function cells(row, values) {
  const tr = document.createElement("tr");
  for (const value of values) {
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(td);
  }
  row.append(tr);
}

/** The allergen of each allergy entry joining a record the person entered: one with no document behind it. */
async function enteredAllergies() {
  const [shows, cameFrom] = await Promise.all([
    pod.ask("entry/What it shows"),
    pod.ask("entry/Where it came from"),
  ]);
  const entered = new Set(
    cameFrom.filter((row) => row.document === undefined).map((r) => r.entry),
  );
  const allergens = new Map();
  for (const row of shows)
    if (row.field === ALLERGEN && entered.has(row.entry))
      allergens.set(row.entry, row.value);
  return [...allergens.values()].sort();
}

async function show() {
  const [allergies, yours] = await Promise.all([
    pod.ask("pod/My active allergies"),
    enteredAllergies(),
  ]);
  active.replaceChildren();
  for (const { allergen, criticality } of allergies)
    cells(active, [allergen, criticality ?? ""]);
  added.replaceChildren(
    ...yours.map((allergen) => {
      const li = document.createElement("li");
      li.textContent = allergen;
      return li;
    }),
  );
}

function deleted(name) {
  return new Promise((resolve, reject) => {
    const deleting = indexedDB.deleteDatabase(name);
    deleting.onsuccess = () => resolve();
    deleting.onerror = () => reject(deleting.error);
    deleting.onblocked = () => {
      status.textContent = "Close this page in your other tabs to start over.";
    };
  });
}

/** Runs the step with the buttons off, then says how it went. */
async function busy(saying, step) {
  document.body.dataset.state = "busy";
  status.textContent = saying;
  for (const button of document.querySelectorAll("button"))
    button.disabled = true;
  try {
    status.textContent = (await step()) ?? "";
    document.body.dataset.state = "ready";
  } catch (error) {
    status.textContent = `Something went wrong: ${error.message ?? error}`;
    document.body.dataset.state = "error";
  } finally {
    for (const button of document.querySelectorAll("button"))
      button.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const allergen = new FormData(form).get("allergen").trim();
  if (allergen === "") return;
  busy(`Adding ${allergen}…`, async () => {
    const done = await pod.enter(allergy(pod, { allergen }));
    if (done.refused) return `Not saved: ${done.refused}`;
    form.reset();
    await show();
    return `${allergen} is added.`;
  });
});

startOver.addEventListener("click", () =>
  busy("Copying the published pod again…", async () => {
    await pod?.close();
    pod = undefined;
    await deleted(`cascade-pod:${NAME}`);
    pod = await openPod(NAME, { from: FROM });
    await show();
  }),
);

busy("Opening the pod…", async () => {
  pod = await openPod(NAME, { from: FROM });
  await show();
});
