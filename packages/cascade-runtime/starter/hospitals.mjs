// The Node app's part of a sign-in at a hospital: the person goes to the hospital's own page, and the hospital sends
// them back to this app's `/callback`. And the world's date, which the demo hospitals answer as of.
import { clearTimeout, setTimeout } from "node:timers";
import { ConnectionFailure } from "cascade-runtime";

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The sign-ins waiting for `/callback`. `signIn(row, { pod, connection }, report)` is the `SignIn` of one: it hands
 * the authorize URL to `report`, and waits for the redirect that `back(url)` hands it. A demo hospital's page is told
 * the pod's name as `login_hint`, so it can preselect the patient the pod is for.
 */
export function signIns() {
  /** Each sign-in waiting for its redirect, by the `state` it sent. */
  const waiting = new Map();
  return {
    signIn:
      (row, { pod, connection }, report) =>
      (authorize, signal) =>
        new Promise((resolve, reject) => {
          if (row.vendor === "demo")
            authorize.searchParams.set("login_hint", pod);
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
          timer.unref();
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
            at: { pod, connection },
            back: (url) => finish(() => resolve(url)),
          });
          report(authorize.href);
        }),

    /** Hands the redirect to the sign-in waiting for its `state`; gives its `{ pod, connection }`, or undefined. */
    back(url) {
      const sign = waiting.get(url.searchParams.get("state"));
      if (sign === undefined) return undefined;
      sign.back(url);
      return sign.at;
    },
  };
}

/**
 * The world's date the demo hospitals of `listener` answer as of, starting at `asOf`: an instant, or undefined for
 * every version they hold.
 */
export function worldOf(listener, asOf) {
  let world = asOf;
  return {
    get: () => world,
    set(when) {
      world = when;
      listener.setWorldDate(when);
    },
  };
}
