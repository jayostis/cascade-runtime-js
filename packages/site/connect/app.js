import {
  connect,
  ConnectionFailure,
  DEMO_PLAN,
  openPod,
  popupSignIn,
  pull,
  pullFiles,
} from "cascade-runtime";
import { useDemoHospitals } from "./demo-hospitals.js";

const POD = "connect-demo";
const REGISTRATION = {
  clientId: "cascade-runtime-demo",
  redirectUri: new URL("signed-in.html", location.href).href,
  scopes: ["launch/patient", "patient/*.read"],
};

const status = document.querySelector("#status");
const pulled = document.querySelector("#pulled");
const allergies = document.querySelector("#allergies");
const medications = document.querySelector("#medications");
const startOver = document.querySelector("#start-over");
let pod;

/** The rows in a table, one column per field, the pod's own address left out of each value. */
function table(element, rows) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort();
  const header = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    th.textContent = column;
    header.append(th);
  }
  element.querySelector("thead").replaceChildren(header);
  element.querySelector("tbody").replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement("tr");
      for (const column of columns) {
        const td = document.createElement("td");
        const value = row[column] ?? "";
        td.textContent = value.startsWith(pod.address)
          ? value.slice(pod.address.length)
          : value;
        tr.append(td);
      }
      return tr;
    }),
  );
}

async function show() {
  table(allergies, await pod.ask("pod/My active allergies"));
  table(medications, await pod.ask("pod/My active medications"));
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
    status.textContent =
      error instanceof ConnectionFailure
        ? `Not connected (${error.kind}): ${error.message}`
        : `Something went wrong: ${error.message ?? error}`;
    document.body.dataset.state = "error";
  } finally {
    for (const button of document.querySelectorAll("button"))
      button.disabled = false;
  }
}

for (const button of document.querySelectorAll("button.sign-in"))
  button.addEventListener("click", () => {
    const { name, fhirBase, id } = button.dataset;
    const popup = window.open(
      "",
      "cascade-sign-in",
      "popup,width=520,height=720",
    );
    busy(`Signing in to ${name}…`, async () => {
      try {
        const connection = await connect(
          { name, vendor: "demo", fhirBase },
          REGISTRATION,
          { signIn: popupSignIn({ popup }) },
        );
        status.textContent = `Pulling your record from ${name}…`;
        const record = await pull(connection, DEMO_PLAN);
        pulled.replaceChildren(
          ...record.bundle.entry.map(({ resource }) => {
            const li = document.createElement("li");
            li.textContent = `${resource.resourceType}/${resource.id}`;
            return li;
          }),
        );
        status.textContent = `Importing your record from ${name}…`;
        const imported = await pod.import(pullFiles(record, id), {
          aboutSubject: true,
        });
        if (imported.refused) return `Not imported: ${imported.refused}`;
        await show();
        return `Imported ${record.bundle.entry.length} resources from ${name}.`;
      } finally {
        popup?.close();
      }
    });
  });

startOver.addEventListener("click", () =>
  busy("Starting over…", async () => {
    await pod?.close();
    pod = undefined;
    await new Promise((resolve, reject) => {
      const deleting = indexedDB.deleteDatabase(`cascade-pod:${POD}`);
      deleting.onsuccess = () => resolve();
      deleting.onerror = () => reject(deleting.error);
    });
    pod = await openPod(POD);
    pulled.replaceChildren();
    await show();
  }),
);

busy("Starting the demo hospitals…", async () => {
  await useDemoHospitals(new URL("demo-hospital-worker.js", location.href));
  pod = await openPod(POD);
  await show();
});
