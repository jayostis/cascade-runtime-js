// What PodApi needs of this browser: the pods kept in IndexedDB, the tables the browser entry holds, the published
// samples a pod is copied from, and the demo hospitals try/'s own service worker answers, signed in at in a popup.
import {
  appTables,
  checkTables,
  ConnectionFailure,
  deletePod,
  directoryOf,
  openPod,
  podTitle,
  popupSignIn,
  TEST_DIRECTORY,
} from "cascade-runtime";
import {
  hospitalId,
  setWorldDate,
  useDemoHospitals,
  worldDate,
} from "./demo-hospitals.js";

const DATABASE = "cascade-pod:";
const ANSWERS = "cascade-answers:";
const WORKER = new URL("demo-hospital-worker.js", location.href);
/** How long a deletion waits before it says the pods are held open in other tabs. */
const OTHER_TABS_MS = 2000;

/** The names of the databases here whose name starts with `prefix`, without it. */
async function databases(prefix) {
  return (await indexedDB.databases())
    .map(({ name }) => name ?? "")
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length))
    .sort();
}

/** The directory: the demo hospitals' rows, from the brands bundle the site was built with, then the test directory's; the test directory alone, when the bundle cannot be read. */
async function demoDirectory() {
  try {
    const answer = await fetch("demo-brands.json");
    return answer.ok
      ? [...directoryOf(await answer.json(), "demo"), ...TEST_DIRECTORY]
      : TEST_DIRECTORY;
  } catch {
    return TEST_DIRECTORY;
  }
}

/** Opens and closes a pod in memory, which loads the engine a pod computes with. */
export async function warmEngine() {
  await (await openPod()).close();
}

/**
 * The host `podApi` reads and writes this browser's pods through. `waiting(text)` is told when a deletion waits for
 * the pods to close in other tabs. The page sets `popup`, a window it opened in the click that signs in, before it
 * calls `connect`: the sign-in goes on in it.
 */
export function browserHost({ waiting = () => {} } = {}) {
  const demoHospitals = useDemoHospitals(WORKER);
  demoHospitals.catch(() => undefined);
  const directory = demoDirectory();
  const host = {
    popup: undefined,
    pods: {
      names: () => databases(DATABASE),
      title: (name) => podTitle(name),
      open: (name, options) => openPod(name, options),
      /** Deletes the pods and their answers, with `all` every answers database; never the tables. */
      async remove(names, { all = false } = {}) {
        const gone = all
          ? [...new Set([...names, ...(await databases(ANSWERS))])]
          : names;
        const slow = window.setTimeout(
          () => waiting("Waiting for the pods to close in your other tabs…"),
          OTHER_TABS_MS,
        );
        const deleted = await Promise.allSettled(gone.map(deletePod));
        window.clearTimeout(slow);
        const failed = deleted.find(({ status }) => status === "rejected");
        if (failed !== undefined) throw failed.reason;
      },
    },
    samples: (document.body.dataset.samples ?? "").split(" ").filter(Boolean),
    copySample: (name) => openPod(name, { from: `../${name}/pod/` }),
    tables: (pod) => appTables(pod),
    checkTables: () => checkTables(),
    opensEncrypted: true,
    unsaid() {},
    world: {
      get: () => worldDate(WORKER).catch(() => undefined),
      async set(asOf) {
        await demoHospitals;
        await setWorldDate(WORKER, asOf);
      },
    },
    hospitals: {
      directory: async () => directory,
      registration: {
        clientId: "cascade-runtime-demo",
        redirectUri: new URL("signed-in.html", location.href).href,
      },
      fetch: (url, init) => fetch(url, init),
      /** Resolves once the service worker answers a demo hospital; else rejects as a hospital that cannot answer. */
      async ready(row) {
        if (row.vendor !== "demo") return;
        try {
          await demoHospitals;
        } catch (error) {
          host.popup?.close();
          host.popup = undefined;
          throw new ConnectionFailure("hospital-error", error.message);
        }
      },
      signIn(row, { pod }, report) {
        const popup = host.popup;
        host.popup = undefined;
        return (authorize, signal) => {
          if (row.vendor === "demo")
            authorize.searchParams.set("login_hint", pod);
          report(authorize.href);
          return popupSignIn({ popup })(authorize, signal).finally(() =>
            popup?.close(),
          );
        };
      },
      pullName: (row) =>
        row.vendor === "demo" ? hospitalId({ hospital: row }) : row.vendor,
    },
  };
  return host;
}
