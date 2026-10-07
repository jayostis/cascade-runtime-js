// The starter's view, in the browser: pods kept in this browser's own storage, each shown as a person reads it, a way
// to make one or load a published one, and a sign-in at the demo hospitals that brings a record in. The view is the
// starter's `summary.mjs`, served beside it as `summary.js`; this file routes, reads the pods, and hands the view the addresses of this page.
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
import { useDemoHospitals } from "./demo-hospitals.js";
import {
  connectionPage,
  demoPeople,
  escaped,
  frame,
  hospitalName,
  hospitalsPage,
  newPodDialog,
  noPods,
  patientName,
  personName,
  podPage,
  postButton,
  QUESTIONS,
  slug,
  sortAndFilter,
} from "./summary.js";

const DATABASE = "cascade-pod:";
const REGISTRATION = {
  clientId: "cascade-runtime-demo",
  redirectUri: new URL("signed-in.html", location.href).href,
  scopes: ["launch/patient", "patient/*.read"],
};
const DEMO = TEST_DIRECTORY.filter(({ vendor }) => vendor === "demo");
const SAMPLES = (document.body.dataset.samples ?? "")
  .split(" ")
  .filter(Boolean);

/** A demo hospital's short name, its host's first label: `cascade-north`. */
const idOf = (row) => new URL(row.fhirBase).hostname.split(".")[0];
const podHref = (name) => `?pod=${encodeURIComponent(name)}`;

const hospitalsReady = useDemoHospitals(
  new URL("demo-hospital-worker.js", location.href),
);
hospitalsReady.catch(() => undefined);

let pods = [];
let people = [];
let current;
let pod;
/** The sign-in under way or done, with its row, step, requests answered, and once pulled the files to import. */
let connection;

async function podsHere() {
  return (await indexedDB.databases())
    .map(({ name }) => name ?? "")
    .filter((name) => name.startsWith(DATABASE))
    .map((name) => name.slice(DATABASE.length))
    .sort();
}

async function demoHospitals() {
  return Promise.all(
    DEMO.map(async (row) => {
      const answer = await fetch(`demo-hospitals/${idOf(row)}.json`);
      if (!answer.ok)
        throw new Error(`The demo hospital ${row.name} is not served here.`);
      return answer.json();
    }),
  );
}

/**
 * Shows `body` in the frame, under a new root that the tables' sorting and filtering listen on; `state` is what the
 * page says it is doing, in `data-state` on the body.
 */
function render(title, body, state = "ready") {
  const samples = SAMPLES.filter((name) => !pods.includes(name));
  const html = frame({
    title,
    body,
    pods,
    current,
    href: podHref,
    home: "../",
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
  });
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.title = parsed.title;
  if (document.head.querySelector("style") === null)
    document.head.append(parsed.head.querySelector("style"));
  for (const script of parsed.body.querySelectorAll("script")) script.remove();
  const root = document.createElement("div");
  root.append(...parsed.body.childNodes);
  document.body.replaceChildren(root);
  sortAndFilter(root);
  document.body.dataset.state = state;
}

const personOf = (name) => people.find((each) => slug(each.name) === name);

const signInButton = (fhirBase, label) =>
  postButton("sign-in", { fhirBase }, escaped(label));

async function showPod(from) {
  const answers = {};
  for (const question of QUESTIONS) answers[question] = await pod.ask(question);
  render(
    personName(current),
    podPage(answers, {
      pod: current,
      person: personOf(current),
      from,
      signIn: (hospital) =>
        signInButton(
          hospital.fhirBase,
          `Sign in at ${hospitalName(hospital.name)}`,
        ),
      findHospital: `${podHref(current)}&hospitals`,
    }),
  );
}

function showHospitals(text) {
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

function showConnection(view, state) {
  render(
    hospitalName(connection.row.name),
    connectionPage({
      pod: current,
      hospital: connection.row.name,
      back: podHref(current),
      connection,
      bring: "bring",
      ...view,
    }),
    state,
  );
}

/** Signs in at the hospital in `popup`, opened in the click, fetches the record, and shows what it has. */
async function signIn(fhirBase, popup) {
  const row = DEMO.find((each) => each.fhirBase === fhirBase);
  if (row === undefined) {
    popup?.close();
    throw new Error("That hospital is not in the directory.");
  }
  const shown = { row, step: "signing in", requests: 0 };
  connection = shown;
  const now = (view = {}, state = "busy") => {
    if (connection === shown) showConnection(view, state);
  };
  now();
  const failed = (said) => {
    shown.step = "failed";
    now({ failed: said }, "ready");
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
        now();
        return answer;
      },
    });
    shown.step = "pulling";
    now();
    const pulled = await pull(signedIn, DEMO_PLAN);
    shown.files = pullFiles(pulled, `${idOf(row)}-${Date.now()}`);
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
  const shown = connection;
  if (shown?.files === undefined) return;
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
    return showConnection({ failed: `Refused: ${done.refused}` });
  }
  connection = undefined;
  history.replaceState(null, "", podHref(current));
  await showPod(shown.row.name);
}

/** Makes an empty pod named after the person, unless it exists, and goes to it. */
async function make(person) {
  const name = slug(person);
  if (name === "")
    return render(
      "No pod made",
      "<h1>No pod made</h1>\n<p>Give a name with at least one letter from a to z, or a digit.</p>",
    );
  if (!pods.includes(name))
    await (await openPod(name, { title: person.trim() })).close();
  location.assign(podHref(name));
}

function deleted(name) {
  return new Promise((resolve, reject) => {
    const deleting = indexedDB.deleteDatabase(DATABASE + name);
    deleting.onsuccess = () => resolve();
    deleting.onerror = () => reject(deleting.error);
  });
}

/** Copies the published example pod into this browser, unless it is here already, and goes to it. */
async function load(name) {
  if (!SAMPLES.includes(name)) throw new Error(`No sample pod ${name}.`);
  if (!pods.includes(name))
    try {
      await (await openPod(name, { from: `../${name}/pod/` })).close();
    } catch (error) {
      await deleted(name);
      throw error;
    }
  location.assign(podHref(name));
}

/** Runs the step with the buttons off; anything it did not expect, it shows. */
async function busy(step) {
  document.body.dataset.state = "busy";
  for (const button of document.querySelectorAll("button"))
    button.disabled = true;
  try {
    await step();
  } catch (error) {
    render(
      "Something went wrong",
      `<h1>Something went wrong</h1>\n<p>${escaped(error?.message ?? error)}</p>`,
      "error",
    );
  }
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
});

busy(async () => {
  [pods, people] = await Promise.all([
    podsHere(),
    demoHospitals().then(demoPeople),
  ]);
  const query = new URLSearchParams(location.search);
  const asked = query.get("pod");
  if (asked === null && pods.length === 0)
    return render("No pods yet", noPods());
  if (asked !== null && !pods.includes(asked))
    return render(
      "Not found",
      `<h1>Not found</h1>\n<p>This browser keeps no pod named ${escaped(asked)}.</p>`,
    );
  current = asked ?? pods[0];
  if (asked === null) history.replaceState(null, "", podHref(current));
  pod = await openPod(current);
  if (query.has("hospitals")) return showHospitals(query.get("q") ?? "");
  await showPod();
});
