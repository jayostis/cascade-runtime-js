// The starter's view, in the browser: pods kept in this browser's own storage, each shown as a person reads it, a way
// to make one or load a published one, and a sign-in at a test hospital that brings a record in. The view is the
// starter's `summary.mjs`, served beside it as `summary.js`; this file routes, reads the pods, and hands the view the addresses of this page.
// What the page shows is `state`; `redraw()` renders it into one root, in place, so a box, a menu, a table's sort and
// filter and a scroll stay as they were. A pod's page is drawn from its kept answers; once it is, the engine loads in
// the background, and `data-engine` on the body says when it is ready.
// It is one page: its own links and forms change the address with `history.pushState` and `route()` draws what it
// names; a `#…` link is the browser's, which opens and closes the boxes. Each pod opened stays open.
import { render as renderInto } from "preact";
import {
  appTables,
  checkTables,
  connect,
  ConnectionFailure,
  deletePod,
  DEMO_PLAN,
  openPod,
  popupSignIn,
  pull,
  pullFiles,
  searchDirectory,
  TEST_DIRECTORY,
  warm,
} from "cascade-runtime";
import { hospitalId, useDemoHospitals } from "./demo-hospitals.js";
import {
  checkedNote,
  closing,
  codesOf,
  connectionDialog,
  didNote,
  doing,
  hospitalName,
  hospitalsPage,
  html,
  layout,
  newPodDialog,
  noPods,
  noTables,
  patientName,
  personName,
  podPage,
  postButton,
  QUESTIONS,
  slug,
  STYLE,
  tableId,
  tablePage,
} from "./summary.js";

const DATABASE = "cascade-pod:";
const ANSWERS = "cascade-answers:";
const BOX = "connection";
const REGISTRATION = {
  clientId: "cascade-runtime-demo",
  redirectUri: new URL("signed-in.html", location.href).href,
  scopes: ["launch/patient", "patient/*.read"],
};
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
const tableHref = (series) =>
  `?table=${encodeURIComponent(tableId(series.iri))}`;
const CHECK = "check-tables";

const hospitalsReady = useDemoHospitals(
  new URL("demo-hospital-worker.js", location.href),
);
hospitalsReady.catch(() => undefined);

/**
 * What the page shows: the pods here and the demo people; the pod shown, by name; `page`, the pod's page as its
 * `answers`, what the tables say of their codes (`about`, once the engine is ready) and the hospital a record was just
 * brought in `from`, or another page's `title` and `body`; the
 * `connection` under way or done, with its row, step, requests answered, once pulled the files to import, and what its
 * box says (`said`); what the File menu just did (`note`), as the address said when the page opened; what the page
 * is doing (`doing`), in `data-state` on the body, and while it is busy, what it says it is doing (`saying`); the
 * reference tables this browser holds (`tables`), read once the engine is ready, and the one shown (`table`), by IRI.
 */
const state = {
  pods: [],
  people: [],
  tables: [],
  table: undefined,
  current: undefined,
  page: undefined,
  connection: undefined,
  note: undefined,
  doing: "opening",
  saying: undefined,
};
/** Each pod opened, by name, kept open until every pod is deleted. */
const open = new Map();
/** The pod shown, open. */
let pod;
/** The address's query, as `route()` last drew it. */
let routed;

const root = document.createElement("div");
const line = document.createElement("div");
const style = document.createElement("style");
style.textContent = STYLE;
document.head.append(style);

/** The names of the databases here whose name starts with `prefix`, without it. */
async function databases(prefix) {
  return (await indexedDB.databases())
    .map(({ name }) => name ?? "")
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length))
    .sort();
}

const podsHere = () => databases(DATABASE);

/** The pod named `name`, opened with `options` the first time it is asked for, and kept open. */
function podNamed(name, options) {
  if (!open.has(name)) {
    const opening = openPod(name, options);
    opening.catch(() => open.delete(name));
    open.set(name, opening);
  }
  return open.get(name);
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

/** Replaces the address with `href`, which `route()` then takes as drawn. */
function replaceAddress(href) {
  history.replaceState(null, "", href);
  routed = location.search;
}

/** Closes the box open by the address's hash, as its close link does, so that what an action shows is not hidden behind it. */
function closeDialog() {
  if (location.hash === "") return;
  location.replace("#");
  replaceAddress(location.pathname + location.search);
}

const personOf = (name) =>
  state.people.find((each) => slug(each.name) === name);

const signInButton = (fhirBase, label) =>
  postButton("sign-in", { fhirBase }, label, undefined, "Signing in…");

/** The page `state.page` names: its title and its body, the pod's page with the connection's box over it. */
function pageShown() {
  const { answers, about, from, title, body } = state.page;
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
      unheld: pod?.opened?.unheld,
      about,
    }),
  };
}

/** Renders `state` into the page's root, changing only what changed. */
function redraw() {
  const { pods, people, current, note } = state;
  const { title, body } = pageShown();
  const samples = SAMPLES.filter((name) => !pods.includes(name));
  document.title = `${title} · Cascade`;
  if (!root.isConnected) document.body.replaceChildren(root, line);
  renderInto(
    layout({
      body,
      pods,
      current,
      href: podHref,
      home: "../",
      menu: MENU,
      note,
      tables: {
        series: state.tables,
        current: state.table,
        href: tableHref,
        check: CHECK,
      },
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
                  doing: `Loading ${personName(name)}'s pod…`,
                })),
              },
      }),
    }),
    root,
  );
  showDoing();
}

/**
 * `state.doing` in `data-state` on the body; while the page is busy, every button off and the line saying what it is
 * doing, drawn in a root of its own so that it shows before the page is drawn again.
 */
function showDoing() {
  const busy = state.doing === "busy";
  document.body.dataset.state = state.doing;
  for (const button of document.querySelectorAll("button"))
    button.disabled = busy;
  if (!line.isConnected) document.body.append(line);
  renderInto(doing(busy ? state.saying : undefined), line);
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

/** What the tables say of the codes `answers` hold; nothing before the engine is ready, or when they cannot say. */
async function aboutCodes(answers) {
  if (document.body.dataset.engine !== "ready") return undefined;
  try {
    return await (await appTables()).about(codesOf(answers));
  } catch {
    return undefined;
  }
}

/** The pod's page; `from` names the hospital a record was just brought in from. */
async function showPod(from) {
  const answers = await answered();
  state.page = { answers, about: await aboutCodes(answers), from };
  state.doing = "ready";
  redraw();
}

function showHospitals(text) {
  const { current, people } = state;
  render(
    "Find a hospital",
    hospitalsPage({
      pod: current,
      rows: searchDirectory(TEST_DIRECTORY, text),
      text,
      search: `${podHref(current)}&hospitals`,
      signIn: (row) => signInButton(row.fhirBase, "Sign in"),
      people,
      back: podHref(current),
    }),
  );
}

/** Reads the reference tables this browser holds into `state.tables`. */
async function readTables() {
  state.tables = await (await appTables()).held();
}

/** The reference table `id` names, or the first with none, searched for `text`, page `shown` of what it finds. */
async function showTable(id, text, shown) {
  const tables = await appTables();
  await readTables();
  state.current = undefined;
  const series =
    id === ""
      ? state.tables[0]
      : state.tables.find((each) => tableId(each.iri) === id);
  if (series === undefined)
    return id === ""
      ? render("Reference tables", noTables())
      : render(
          "Not found",
          html`<h1>Not found</h1>
<p>This browser holds no reference table ${id}.</p>`,
        );
  state.table = series.iri;
  render(
    series.label,
    tablePage({
      series,
      searched: await tables.search(series.iri, text, shown),
      text,
      search: tableHref(series),
      page: shown,
      pageHref: (page) =>
        `${tableHref(series)}&${new URLSearchParams({ q: text, page })}`,
      uses: await tables.uses(),
      pods: state.pods,
      href: podHref,
      now: Date.now(),
    }),
  );
}

/** Check now: reads every feed past any cache, opens the pods again with what it kept, and says what it did. */
async function checkNow() {
  const checked = await checkTables();
  if (checked.some(({ kept }) => kept.length > 0)) {
    const opened = [...open.values()];
    open.clear();
    pod = undefined;
    await Promise.allSettled(opened.map(async (each) => (await each).close()));
  }
  await readTables();
  const note = checkedNote(checked, state.tables);
  await go("?table=");
  state.note = note;
  redraw();
}

/** Draws the page the address names: a pod's page, its hospitals, or no pod; the samples copied in on a first visit. */
async function route() {
  routed = location.search;
  const query = new URLSearchParams(location.search);
  state.connection = undefined;
  state.note = didNote(query, SAMPLES);
  if (state.note !== undefined) {
    const rest = new URLSearchParams(query);
    rest.delete("deleted");
    rest.delete("reset");
    replaceAddress(String(rest) === "" ? location.pathname : `?${rest}`);
  }
  state.table = undefined;
  if (query.has("table"))
    return showTable(
      query.get("table") ?? "",
      query.get("q") ?? "",
      Math.max(1, Math.trunc(Number(query.get("page")))) || 1,
    );
  const asked = query.get("pod");
  state.current = asked ?? undefined;
  if (asked === null && state.pods.length === 0) {
    if (!query.has("deleted") && !deletedAll()) await firstVisit();
    if (state.pods.length === 0) return render("No pods yet", noPods());
  }
  if (asked !== null && !state.pods.includes(asked)) {
    state.current = undefined;
    return render(
      "Not found",
      html`<h1>Not found</h1>
<p>This browser keeps no pod named ${asked}.</p>`,
    );
  }
  state.current = asked ?? state.pods[0];
  if (asked === null) replaceAddress(podHref(state.current));
  pod = await podNamed(state.current);
  if (query.has("hospitals")) return showHospitals(query.get("q") ?? "");
  await showPod();
}

/**
 * Goes to `href`, an address of this page, without leaving it: a box open by the hash is closed first. The address
 * shown already is drawn again in place of its entry in the history, not after it.
 */
function go(href) {
  closeDialog();
  if (new URL(href, location.href).search === location.search)
    history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  return route();
}

/**
 * Shows the connection in its box over the pod's page, saying `said`, and opens the box by its hash if it is not open.
 * Once Back or Forward has moved the address under the step, the box is not opened: the page follows the address
 * when the step ends.
 */
function showConnection(said, doing) {
  state.connection.said = said;
  state.doing = doing;
  redraw();
  if (location.hash === `#${BOX}` || location.search !== routed) return;
  replaceAddress(podHref(state.current));
  location.replace(`#${BOX}`);
}

/** Signs in at the hospital in `popup`, opened in the click, fetches the record, and shows what it has. */
async function signIn(fhirBase, popup) {
  const row = TEST_DIRECTORY.find((each) => each.fhirBase === fhirBase);
  if (row === undefined) {
    popup?.close();
    throw new Error("That hospital is not in the directory.");
  }
  const shown = { row, step: "signing in", requests: 0 };
  state.connection = shown;
  const answers = await answered();
  state.page = { answers, about: await aboutCodes(answers) };
  const now = (said = {}, doing = "busy") => {
    if (state.connection === shown) showConnection(said, doing);
  };
  now();
  const failed = (said) => {
    shown.step = "failed";
    return now({ failed: said }, "ready");
  };
  const demo = row.vendor === "demo";
  try {
    if (demo) await hospitalsReady;
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
      `${demo ? hospitalId({ hospital: row }) : row.vendor}-${Date.now()}`,
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

/**
 * Brings the pulled record into the pod, its box saying each part as it begins, and goes back to the pod, noting
 * where the record came from.
 */
async function bring() {
  const shown = state.connection;
  if (shown?.files === undefined) return showPod();
  shown.step = "bringing in";
  shown.bringing = undefined;
  let done;
  showConnection({}, "busy");
  try {
    done = await pod.import(shown.files, {
      aboutSubject: true,
      onProgress: (part) => {
        shown.bringing = part;
      },
    });
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
  if (location.hash === `#${BOX}`) closeDialog();
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
    await podNamed(name, { title: person.trim() });
  state.pods = await podsHere();
  return go(podHref(name));
}

/** Copies the published example pod into this browser, and keeps it open. */
async function copy(name) {
  await podNamed(name, { from: `../${name}/pod/` });
}

/** Copies the published example pod into this browser, unless it is here already, and goes to it. */
async function load(name) {
  if (!SAMPLES.includes(name)) throw new Error(`No sample pod ${name}.`);
  markDeletedAll(false);
  if (!state.pods.includes(name)) await copy(name);
  state.pods = await podsHere();
  return go(podHref(name));
}

/**
 * Closes every pod open and deletes every pod and its answers, saying so when another tab keeps one open; gives the
 * names of the pods there were.
 */
async function deleteAll() {
  const opened = [...open.values()];
  open.clear();
  pod = undefined;
  await Promise.allSettled(opened.map(async (each) => (await each).close()));
  const names = await podsHere();
  const all = new Set([...names, ...(await databases(ANSWERS))]);
  const waiting = window.setTimeout(() => {
    state.saying = "Waiting for the pods to close in your other tabs…";
    showDoing();
  }, 2000);
  const deleted = await Promise.allSettled([...all].map(deletePod));
  window.clearTimeout(waiting);
  state.pods = await podsHere();
  const failed = deleted.find(({ status }) => status === "rejected");
  if (failed !== undefined) throw failed.reason;
  return names;
}

/** File, Delete all data: then the page says how many went, and no visit copies a sample in until a pod is made again. */
async function deleteEverything() {
  const names = await deleteAll();
  markDeletedAll(true);
  return go(`?deleted=${names.length}`);
}

/** File, Reset all data: every pod deleted and every sample copied again, then the first sample's page says so. */
async function resetEverything() {
  markDeletedAll(false);
  await deleteAll();
  await Promise.all(SAMPLES.map(copy));
  state.pods = await podsHere();
  return go(SAMPLES.length === 0 ? "?reset" : `${podHref(SAMPLES[0])}&reset`);
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
 * Runs the step with the page busy, saying `saying`; while the page is busy, another step does not start. Back or
 * Forward pressed meanwhile moves the address, and the page follows it once the step ends. Anything the step did not
 * expect, it shows.
 */
async function busy(step, saying = "Working…") {
  if (state.doing === "busy") return;
  state.doing = "busy";
  state.saying = saying;
  showDoing();
  try {
    await step();
    if (location.search !== routed) await route();
  } catch (error) {
    closeDialog();
    render(
      "Something went wrong",
      html`<h1>Something went wrong</h1>
<p>${error?.message ?? String(error)}</p>`,
      "error",
    );
  }
  if (state.doing === "busy") {
    state.doing = "ready";
    showDoing();
  }
}

/** What the page says while it goes to the address in `query`. */
function opening(query) {
  const name = new URLSearchParams(query).get("pod");
  return name === null ? "Opening…" : `Opening ${personName(name)}'s pod…`;
}

closing(document);
document.addEventListener("click", (event) => {
  const link = event.target.closest?.("a[href]");
  if (link === null || link === undefined || event.defaultPrevented) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey)
    return;
  const href = link.getAttribute("href") ?? "";
  const to = new URL(href, location.href);
  if (href.startsWith("#") || to.pathname !== location.pathname) return;
  event.preventDefault();
  busy(() => go(to.search), opening(to.search));
});
document.addEventListener("submit", (event) => {
  const form = event.target;
  event.preventDefault();
  if (state.doing === "busy") return;
  const action = form.getAttribute("action") ?? "";
  const fields = new FormData(form);
  const saying = form.dataset.doing;
  if (form.method === "get") {
    const to = new URL(action, location.href);
    for (const [key, value] of fields) to.searchParams.set(key, String(value));
    busy(() => go(to.search), saying);
  } else if (action === "sign-in") {
    const popup = window.open(
      "",
      "cascade-sign-in",
      "popup,width=520,height=720",
    );
    busy(() => signIn(String(fields.get("fhirBase")), popup), saying);
  } else if (action === "bring") busy(bring, saying);
  else if (action === "load")
    busy(() => load(String(fields.get("pod"))), saying);
  else if (action === "make")
    busy(() => make(String(fields.get("person") ?? "")), saying);
  else if (action === MENU.deleteAll) busy(deleteEverything, saying);
  else if (action === MENU.resetAll) busy(resetEverything, saying);
  else if (action === CHECK) busy(checkNow, saying);
});
window.addEventListener("popstate", () => {
  if (location.search !== routed) busy(route, opening(location.search));
});

busy(async () => {
  [state.pods, state.people] = await Promise.all([podsHere(), demoPeople()]);
  await route();
}, "Opening…").then(() =>
  warm().then(
    async () => {
      document.body.dataset.engine = "ready";
      await readTables().catch(() => undefined);
      // Each page is named from its own answers, until the page shown is one that was named.
      for (
        let shown = state.page;
        shown?.answers !== undefined && shown.about === undefined;
        shown = state.page
      )
        shown.about = (await aboutCodes(shown.answers)) ?? new Map();
      if (state.page !== undefined) redraw();
      document.body.dataset.tables = "ready";
    },
    () => undefined,
  ),
);
