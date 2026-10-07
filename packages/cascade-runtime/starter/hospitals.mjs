// Bringing a record in from a hospital: the directory, the sign-in on the hospital's own page, the redirect back to
// this app, and the pull. The demo hospitals are pretend, answered here with no network.
import { demoFetch } from "@cascade-runtime/demo-hospital";
import { loadHospitals } from "@cascade-runtime/demo-hospital/node";
import {
  connect,
  ConnectionFailure,
  DEMO_PLAN,
  pull,
  searchDirectory,
  TEST_DIRECTORY,
} from "cascade-runtime";

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

/** A hospital's short name: a demo hospital's host, as `cascade-north`, or else its vendor. */
function idOf(row) {
  return row.vendor === "demo"
    ? new URL(row.fhirBase).hostname.split(".")[0]
    : row.vendor;
}

/**
 * The hospitals as this app, at `origin`, reaches them. It receives each hospital's redirect on its own `/callback`,
 * and serves the demo hospitals' sign-in pages under `/demo-hospitals/`.
 */
export async function hospitalsAt(origin) {
  const route = demoFetch(await loadHospitals(), {
    authorizeBase: `${origin}/demo-hospitals/`,
  });
  const registration = {
    clientId: "cascade-app",
    redirectUri: `${origin}/callback`,
    scopes: ["launch/patient", "patient/*.read", "patient/*.rs"],
  };
  /** Each sign-in waiting for its redirect, by the `state` it sent. */
  const waiting = new Map();
  const connections = new Map();
  let count = 0;

  /** Sends the person to the hospital's page with `sendTo`, and waits for `/callback` to bring them back. */
  function signIn(sendTo, page) {
    return (authorize, signal) =>
      new Promise((resolve, reject) => {
        const state = authorize.searchParams.get("state");
        const finish = (then) => {
          clearTimeout(timer);
          waiting.delete(state);
          then();
        };
        const timer = setTimeout(
          () =>
            finish(() =>
              reject(
                new ConnectionFailure(
                  "cancelled",
                  "the sign-in was not finished in time",
                ),
              ),
            ),
          SIGN_IN_TIMEOUT_MS,
        );
        signal?.addEventListener(
          "abort",
          () =>
            finish(() =>
              reject(
                new ConnectionFailure(
                  "cancelled",
                  "the connection was cancelled",
                ),
              ),
            ),
          { once: true },
        );
        waiting.set(state, {
          page,
          back: (url) => finish(() => resolve(url)),
        });
        sendTo(authorize);
      });
  }

  return {
    directory: (text) => searchDirectory(TEST_DIRECTORY, text),

    /**
     * Starts signing the pod's person in to the hospital whose FHIR base is given, and its pull after. Resolves where
     * to send the person: the hospital's page, or the connection's when it failed before that; undefined for a
     * hospital not in the directory.
     */
    async start(pod, fhirBase) {
      const row = TEST_DIRECTORY.find((each) => each.fhirBase === fhirBase);
      if (row === undefined) return undefined;
      const n = ++count;
      const page = `/pods/${encodeURIComponent(pod)}/connections/${n}`;
      let sendTo;
      const authorize = new Promise((resolve) => (sendTo = resolve));
      const connected = connect(row, registration, {
        signIn: signIn(sendTo, page),
        fetch: route,
      });
      const pulled = connected.then((connection) =>
        pull(connection, DEMO_PLAN),
      );
      pulled.catch(() => {});
      connections.set(n, {
        pod,
        row,
        name: `${idOf(row)}-${n}`,
        pulled,
        imported: undefined,
      });
      return Promise.race([
        authorize.then((url) => url.href),
        connected.then(
          () => page,
          () => page,
        ),
      ]);
    },

    /** Hands the redirect to the sign-in waiting for its `state`; gives that connection's page, or undefined. */
    back(url) {
      const sign = waiting.get(url.searchParams.get("state"));
      if (sign === undefined) return undefined;
      sign.back(url);
      return sign.page;
    },

    /** The pod's connection numbered `n`: its row, the name its pull is saved under, the pull, and its import. */
    connection(pod, n) {
      const found = connections.get(Number(n));
      return found?.pod === pod ? found : undefined;
    },

    /** A demo hospital's answer to a request for its sign-in page. */
    demo: (url, init) => route(url, init),
  };
}
