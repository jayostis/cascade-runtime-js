// The starter's view, in the browser: pods kept in this browser's own storage, each shown as a person reads it, a way
// to make one or load a published one, and a sign-in at the demo hospitals that brings a record in. The view is the
// starter's `summary.mjs`, served beside it as `summary.js`; this file routes, reads the pods, and hands the view the addresses of this page.
// What the page shows is `state`; `redraw()` renders it into one root, in place, so a box, a menu, a table's sort and
// filter and a scroll stay as they were.
import { render as renderInto } from "preact";
import {
  connect,
  ConnectionFailure,
  DEMO_PLAN,
  openPod,
  popupSignIn,
  pull,
  pullFiles,
  searchDirectory,
  TEST_DIRECTORY,
} from "cascade-runtime";
import { hospitalId, useDemoHospitals } from "./demo-hospitals.js";
import {
  connectionDialog,
  didNote,
  hospitalName,
  hospitalsPage,
  html,
  layout,
  newPodDialog,
  noPods,
  patientName,
  personName,
  podPage,
  postButton,
  QUESTIONS,
  slug,
  STYLE,
} from "./summary.js";

const DATABASE = "cascade-pod:";
const BOX = "connection";
const REGISTRATION = {
  clientId: "cascade-runtime-demo",
  redirectUri: new URL("signed-in.html", location.href).href,
  scopes: ["launch/patient", "patient/*.read"],
};
const DEMO = TEST_DIRECTORY.filter(({ vendor }) => vendor === "demo");
const SAMPLES = (document.body.dataset.samples ?? "")
  .split(" ")
  .filter(Boolean);
/** What the File menu's items do, through the `submit` listener, and what Help, About says. */
const MENU = {
  deleteAll: "delete-all",
  resetAll: "reset-all",
  about: {
    name: "Cascade try",
    version: document.body.dataset.version ?? "",
    runtime: document.body.dataset.runtime ?? "",
    code: "../",
  },
};

const podHref = (name) => `?pod=${encodeURIComponent(name)}`;

const hospitalsReady = useDemoHospitals(
  new URL("demo-hospital-worker.js", location.href),
);
hospitalsReady.catch(() => undefined);

/**
 * What the page shows: the pods here and the demo people; the pod shown, by name; `page`, the pod's page as its
 * `answers` and the hospital a record was just brought in `from`, or another page's `title` and `body`; the
 * `connection` under way or done, with its row, step, requests answered, once pulled the files to import, and what its
 * box says (`said`); what the File menu just did (`note`), as the address said when the page opened; and what the page
 * is doing (`doing`), in `data-state` on the body.
 */
const state = {
  pods: [],
  people: [],
  current: undefined,
  page: undefined,
  connection: undefined,
  note: undefined,
  doing: "opening",
};
/** The pod shown, open. */
let pod;

const root = document.createElement("div");
const style = document.createElement("style");
style.textContent = STYLE;
document.head.append(style);

async function podsHere() {
  return (await indexedDB.databases())
    .map(({ name }) => name ?? "")
    .filter((name) => name.startsWith(DATABASE))
    .map((name) => name.slice(DATABASE.length))
    .sort();
}

/** The demo people, as the view's `demoPeople` gave them when the site was built; none, when they cannot be read. */
async function demoPeople() {
  try {
    const answer = await fetch("demo-people.json");
    return answer.ok ? await answer.json() : [];
  } catch {
    return [];
  }
}

/** Closes the new-pod box, as its close link does, so that what an action in it shows is not hidden behind it. */
function closeDialog() {
  if (location.hash === "") return;
  location.replace("#");
  history.replaceState(null, "", location.pathname + location.search);
}

const personOf = (name) =>
  state.people.find((each) => slug(each.name) === name);

const signInButton = (fhirBase, label) =>
  postButton("sign-in", { fhirBase }, label);

/** The page `state.page` names: its title and its body, the pod's page with the connection's box over it. */
function pageShown() {
  const { answers, from, title, body } = state.page;
  if (answers === undefined) return { title, body };
  const { current, connection } = state;
  return {
    title: personName(current),
    body: podPage(answers, {
      pod: current,
      person: personOf(current),
      from,
      connection:
        connection &&
        connectionDialog({
          id: BOX,
          pod: current,
          hospital: connection.row.name,
          back: podHref(current),
          connection,
          bring: "bring",
          ...connection.said,
        }),
      signIn: (hospital) =>
        signInButton(
          hospital.fhirBase,
          `Sign in at ${hospitalName(hospital.name)}`,
        ),
      findHospital: `${podHref(current)}&hospitals`,
    }),
  };
}

/** Renders `state` into the page's root, changing only what changed. */
function redraw() {
  const { pods, people, current, note } = state;
  const { title, body } = pageShown();
  const samples = SAMPLES.filter((name) => !pods.includes(name));
  document.title = `${title} · Cascade`;
  if (!root.isConnected) document.body.replaceChildren(root);
  renderInto(
    layout({
      body,
      pods,
      current,
      href: podHref,
      home: "../",
      menu: MENU,
      note,
      dialog: newPodDialog({
        people,
        pods,
        action: "make",
        more:
          samples.length === 0
            ? undefined
            : {
                said: "Or open a sample pod, already filled with records from several places.",
                choices: samples.map((name) => ({
                  label: `Load ${personName(name)}`,
                  note: "A copy of a published example pod",
                  action: "load",
                  fields: { pod: name },
                })),
              },
      }),
    }),
    root,
  );
  document.body.dataset.state = state.doing;
}

/** Shows `body` titled `title`; `doing` is what the page says it is doing. */
function render(title, body, doing = "ready") {
  state.page = { title, body };
  state.doing = doing;
  redraw();
}

/** Every question's rows from the pod shown, by question. */
async function answered() {
  return Object.fromEntries(
    await Promise.all(
      QUESTIONS.map(async (question) => [question, await pod.ask(question)]),
    ),
  );
}

/** The pod's page; `from` names the hospital a record was just brought in from. */
async function showPod(from) {
  state.page = { answers: await answered(), from };
  state.doing = "ready";
  redraw();
}

function showHospitals(text) {
  const { current, people } = state;
  render(
    "Find a hospital",
    hospitalsPage({
      pod: current,
      rows: searchDirectory(DEMO, text),
      text,
      search: `${podHref(current)}&hospitals`,
      signIn: (row) => signInButton(row.fhirBase, "Sign in"),
      people,
      back: podHref(current),
    }),
  );
}

/** Shows the connection in its box over the pod's page, saying `said`, and opens the box by its hash if it is not open. */
function showConnection(said, doing) {
  state.connection.said = said;
  state.doing = doing;
  redraw();
  if (location.hash === `#${BOX}`) return;
  history.replaceState(null, "", podHref(state.current));
  location.replace(`#${BOX}`);
}

/** Signs in at the hospital in `popup`, opened in the click, fetches the record, and shows what it has. */
async function signIn(fhirBase, popup) {
  const row = DEMO.find((each) => each.fhirBase === fhirBase);
  if (row === undefined) {
    popup?.close();
    throw new Error("That hospital is not in the directory.");
  }
  const shown = { row, step: "signing in", requests: 0 };
  state.connection = shown;
  state.page = { answers: await answered() };
  const now = (said = {}, doing = "busy") => {
    if (state.connection === shown) showConnection(said, doing);
  };
  now();
  const failed = (said) => {
    shown.step = "failed";
    return now({ failed: said }, "ready");
  };
  try {
    await hospitalsReady;
  } catch (error) {
    popup?.close();
    return failed(error.message);
  }
  try {
    const signedIn = await connect(row, REGISTRATION, {
      signIn: popupSignIn({ popup }),
      fetch: async (url, init) => {
        const answer = await globalThis.fetch(url, init);
        shown.requests += 1;
        return answer;
      },
    });
    shown.step = "pulling";
    now();
    const pulled = await pull(signedIn, DEMO_PLAN);
    shown.files = pullFiles(
      pulled,
      `${hospitalId({ hospital: row })}-${Date.now()}`,
    );
    shown.step = "pulled";
    now(
      {
        sources: await pod.look(shown.files),
        pulled,
        about: patientName(pulled.bundle),
      },
      "ready",
    );
  } catch (error) {
    if (!(error instanceof ConnectionFailure)) throw error;
    failed(`Not connected: ${error.message}.`);
  } finally {
    popup?.close();
  }
}

/** Brings the pulled record into the pod, and goes back to it, noting where the record came from. */
async function bring() {
  const shown = state.connection;
  if (shown?.files === undefined) return showPod();
  let done;
  try {
    done = await pod.import(shown.files, { aboutSubject: true });
  } catch (error) {
    shown.step = "failed";
    return showConnection(
      { failed: `Not brought in: ${error.message}`, retry: true },
      "error",
    );
  }
  if (done.refused !== undefined) {
    shown.step = "failed";
    return showConnection({ failed: `Refused: ${done.refused}` }, "ready");
  }
  state.connection = undefined;
  history.replaceState(null, "", podHref(state.current));
  await showPod(shown.row.name);
}

/** In this browser's storage while Delete all data is the last thing done, so that a later visit copies no sample in. */
const DELETED_ALL = "cascade-try:deleted-all";

/** Whether Delete all data was the last thing done; false when storage cannot be read. */
function deletedAll() {
  try {
    return globalThis.localStorage.getItem(DELETED_ALL) !== null;
  } catch {
    return false;
  }
}

/** Notes, or with `false` forgets, that Delete all data was the last thing done; nothing when storage cannot be written. */
function markDeletedAll(deleted) {
  try {
    if (deleted) globalThis.localStorage.setItem(DELETED_ALL, "1");
    else globalThis.localStorage.removeItem(DELETED_ALL);
  } catch {
    // Without storage, a later visit copies the samples, as a first one does.
  }
}

/** Makes an empty pod named after the person, unless it exists or is a sample's, which it loads, and goes to it. */
async function make(person) {
  markDeletedAll(false);
  const name = slug(person);
  if (SAMPLES.includes(name)) return load(name);
  if (name === "") {
    closeDialog();
    return render(
      "No pod made",
      html`<h1>No pod made</h1>
<p>Give a name with at least one letter from a to z, or a digit.</p>`,
    );
  }
  if (!state.pods.includes(name))
    await (await openPod(name, { title: person.trim() })).close();
  location.assign(podHref(name));
}

function deleted(name) {
  return new Promise((resolve, reject) => {
    const deleting = indexedDB.deleteDatabase(DATABASE + name);
    deleting.onsuccess = () => resolve();
    deleting.onerror = () => reject(deleting.error);
    deleting.onblocked = () =>
      reject(
        new Error(
          `${personName(name)}'s pod goes once this page is closed in your other tabs.`,
        ),
      );
  });
}

/** Copies the published example pod into this browser. */
async function copy(name) {
  await (await openPod(name, { from: `../${name}/pod/` })).close();
}

/** Copies the published example pod into this browser, unless it is here already, and goes to it. */
async function load(name) {
  if (!SAMPLES.includes(name)) throw new Error(`No sample pod ${name}.`);
  markDeletedAll(false);
  if (!state.pods.includes(name)) await copy(name);
  location.assign(podHref(name));
}

/** Closes the pod shown and deletes every pod's database, all of them tried; gives the names of those there were, or throws saying which stayed. */
async function deleteAll() {
  await pod?.close();
  pod = undefined;
  const names = await podsHere();
  const done = await Promise.allSettled(names.map(deleted));
  const kept = done.filter(({ status }) => status === "rejected");
  if (kept.length > 0)
    throw new Error(
      [
        "Not every pod was deleted.",
        ...kept.map(({ reason }) => reason?.message ?? reason),
      ].join(" "),
    );
  return names;
}

/** File, Delete all data: then the page says how many went, and no visit copies a sample in until a pod is made again. */
async function deleteEverything() {
  const names = await deleteAll();
  markDeletedAll(true);
  location.assign(`?deleted=${names.length}`);
}

/** File, Reset all data: every pod deleted and every sample copied again, then the first sample's page says so. */
async function resetEverything() {
  markDeletedAll(false);
  await deleteAll();
  await Promise.all(SAMPLES.map(copy));
  location.assign(
    SAMPLES.length === 0 ? "?reset" : `${podHref(SAMPLES[0])}&reset`,
  );
}

/**
 * A browser with no pod starts with a copy of every sample; one that fails and leaves nothing behind stays a "Load"
 * choice in the new-pod box. One that leaves its database behind, or none copying because the runtime fails, throws.
 */
async function firstVisit() {
  const copies = await Promise.allSettled(SAMPLES.map(copy));
  state.pods = await podsHere();
  const left = SAMPLES.findIndex(
    (name, at) => copies[at].status === "rejected" && state.pods.includes(name),
  );
  if (left !== -1) throw copies[left].reason;
  if (state.pods.length === 0) await (await openPod()).close();
}

/**
 * Runs the step with the buttons off; anything it did not expect, it shows. A step that ends showing a page here, not
 * going to another, turns the buttons on again, since the page keeps them.
 */
async function busy(step) {
  state.doing = "busy";
  document.body.dataset.state = state.doing;
  const off = [...document.querySelectorAll("button")];
  for (const button of off) button.disabled = true;
  try {
    await step();
  } catch (error) {
    closeDialog();
    render(
      "Something went wrong",
      html`<h1>Something went wrong</h1>
<p>${error?.message ?? String(error)}</p>`,
      "error",
    );
  }
  if (state.doing !== "busy") for (const button of off) button.disabled = false;
}

document.addEventListener("submit", (event) => {
  const form = event.target;
  event.preventDefault();
  const action = form.getAttribute("action") ?? "";
  const fields = new FormData(form);
  if (form.method === "get") {
    const to = new URL(action, location.href);
    for (const [key, value] of fields) to.searchParams.set(key, String(value));
    location.assign(to);
  } else if (action === "sign-in") {
    const popup = window.open(
      "",
      "cascade-sign-in",
      "popup,width=520,height=720",
    );
    busy(() => signIn(String(fields.get("fhirBase")), popup));
  } else if (action === "bring") busy(bring);
  else if (action === "load") busy(() => load(String(fields.get("pod"))));
  else if (action === "make")
    busy(() => make(String(fields.get("person") ?? "")));
  else if (action === MENU.deleteAll) busy(deleteEverything);
  else if (action === MENU.resetAll) busy(resetEverything);
});

busy(async () => {
  [state.pods, state.people] = await Promise.all([podsHere(), demoPeople()]);
  const query = new URLSearchParams(location.search);
  state.note = didNote(query, SAMPLES);
  if (state.note !== undefined) {
    const rest = new URLSearchParams(query);
    rest.delete("deleted");
    rest.delete("reset");
    history.replaceState(
      null,
      "",
      String(rest) === "" ? location.pathname : `?${rest}`,
    );
  }
  const asked = query.get("pod");
  if (asked === null && state.pods.length === 0) {
    if (!query.has("deleted") && !deletedAll()) await firstVisit();
    if (state.pods.length === 0) return render("No pods yet", noPods());
  }
  if (asked !== null && !state.pods.includes(asked))
    return render(
      "Not found",
      html`<h1>Not found</h1>
<p>This browser keeps no pod named ${asked}.</p>`,
    );
  state.current = asked ?? state.pods[0];
  if (asked === null) history.replaceState(null, "", podHref(state.current));
  pod = await openPod(state.current);
  if (query.has("hospitals")) return showHospitals(query.get("q") ?? "");
  await showPod();
});
