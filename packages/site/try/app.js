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
import { hospitalId, useDemoHospitals } from "./demo-hospitals.js";
import {
  connectionDialog,
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

/** The pod's page; `from` names the hospital a record was just brought in from, `box` is a connection's box over it. */
async function showPod(from, box) {
  const answers = Object.fromEntries(
    await Promise.all(
      QUESTIONS.map(async (question) => [question, await pod.ask(question)]),
    ),
  );
  render(
    personName(current),
    podPage(answers, {
      pod: current,
      person: personOf(current),
      from,
      connection: box,
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

/**
 * Shows the connection in its box over the pod's page: the first time, the page with the box open by its hash; after
 * that, the box's contents replaced in place, the box itself kept so that it stays the page's target.
 */
async function showConnection(view, state) {
  const html = connectionDialog({
    id: BOX,
    pod: current,
    hospital: connection.row.name,
    back: podHref(current),
    connection,
    bring: "bring",
    ...view,
  });
  const box = document.getElementById(BOX);
  if (box === null) {
    await showPod(undefined, html);
    history.replaceState(null, "", podHref(current));
    location.replace(`#${BOX}`);
  } else {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    box.replaceChildren(...parsed.getElementById(BOX).childNodes);
  }
  document.body.dataset.state = state;
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
  const now = async (view = {}, state = "busy") => {
    if (connection === shown) await showConnection(view, state);
  };
  document.getElementById(BOX)?.remove();
  await now();
  let counting = false;
  /** Shows the requests answered once a frame, and only while the step they were counted in is still the one shown. */
  const counted = () => {
    shown.requests += 1;
    if (counting) return;
    counting = true;
    const step = shown.step;
    requestAnimationFrame(() => {
      counting = false;
      if (shown.step === step) now();
    });
  };
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
        counted();
        return answer;
      },
    });
    shown.step = "pulling";
    await now();
    const pulled = await pull(signedIn, DEMO_PLAN);
    shown.files = pullFiles(
      pulled,
      `${hospitalId({ hospital: row })}-${Date.now()}`,
    );
    shown.step = "pulled";
    await now(
      {
        sources: await pod.look(shown.files),
        pulled,
        about: patientName(pulled.bundle),
      },
      "ready",
    );
  } catch (error) {
    if (!(error instanceof ConnectionFailure)) throw error;
    await failed(`Not connected: ${error.message}.`);
  } finally {
    popup?.close();
  }
}

/** Brings the pulled record into the pod, and goes back to it, noting where the record came from. */
async function bring() {
  const shown = connection;
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
    return showConnection({ failed: `Refused: ${done.refused}` });
  }
  connection = undefined;
  history.replaceState(null, "", podHref(current));
  await showPod(shown.row.name);
}

/** Makes an empty pod named after the person, unless it exists or is a sample's, which it loads, and goes to it. */
async function make(person) {
  const name = slug(person);
  if (SAMPLES.includes(name)) return load(name);
  if (name === "") {
    closeDialog();
    return render(
      "No pod made",
      "<h1>No pod made</h1>\n<p>Give a name with at least one letter from a to z, or a digit.</p>",
    );
  }
  if (!pods.includes(name))
    await (await openPod(name, { title: person.trim() })).close();
  location.assign(podHref(name));
}

/** Copies the published example pod into this browser. */
async function copy(name) {
  await (await openPod(name, { from: `../${name}/pod/` })).close();
}

/** Copies the published example pod into this browser, unless it is here already, and goes to it. */
async function load(name) {
  if (!SAMPLES.includes(name)) throw new Error(`No sample pod ${name}.`);
  if (!pods.includes(name)) await copy(name);
  location.assign(podHref(name));
}

/**
 * A browser with no pod starts with a copy of every sample; one that fails and leaves nothing behind stays a "Load"
 * choice in the new-pod box. One that leaves its database behind, or none copying because the runtime fails, throws.
 */
async function firstVisit() {
  const copies = await Promise.allSettled(SAMPLES.map(copy));
  pods = await podsHere();
  const left = SAMPLES.findIndex(
    (name, at) => copies[at].status === "rejected" && pods.includes(name),
  );
  if (left !== -1) throw copies[left].reason;
  if (pods.length === 0) await (await openPod()).close();
}

/** Runs the step with the buttons off; anything it did not expect, it shows. */
async function busy(step) {
  document.body.dataset.state = "busy";
  for (const button of document.querySelectorAll("button"))
    button.disabled = true;
  try {
    await step();
  } catch (error) {
    closeDialog();
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
  [pods, people] = await Promise.all([podsHere(), demoPeople()]);
  const query = new URLSearchParams(location.search);
  const asked = query.get("pod");
  if (asked === null && pods.length === 0) {
    await firstVisit();
    if (pods.length === 0) return render("No pods yet", noPods());
  }
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
