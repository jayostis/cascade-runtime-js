import type { SignIn } from "../connect/connect.js";
import { ConnectionFailure } from "../connect/outcome.js";

/** What a sign-in's return page posts to the window that opened the sign-in. */
const RETURNED = "cascade-runtime:signed-in";
/** How often the opener looks whether the person closed the popup. */
const CLOSED_POLL_MS = 250;

export interface PopupOptions {
  /**
   * The window to sign in in, opened by the app in the click that asked for it: a browser blocks `window.open` once
   * that click is over, and `connect` asks the hospital's discovery first. With none, one is opened.
   */
  readonly popup?: Window | null;
}

interface Returned {
  readonly type: typeof RETURNED;
  readonly url: string;
}

function returned(data: unknown): URL | undefined {
  const message = data as Partial<Returned> | null;
  if (message?.type !== RETURNED || typeof message.url !== "string")
    return undefined;
  try {
    return new URL(message.url);
  } catch {
    return undefined;
  }
}

/**
 * Signs in in a popup: takes it to the authorize URL, and gives back the URL the hospital sent it to, as the redirect
 * page's `finishSignIn()` posts it. Only a message from that popup, of this page's own origin, is read.
 */
export function popupSignIn(options: PopupOptions = {}): SignIn {
  return (authorize, signal) =>
    new Promise<URL>((resolve, reject) => {
      const popup =
        options.popup === undefined
          ? window.open("", "cascade-sign-in", "popup,width=520,height=720")
          : options.popup;
      if (popup === null) {
        reject(
          new ConnectionFailure(
            "sign-in-unavailable",
            "the browser blocked the sign-in's popup",
          ),
        );
        return;
      }
      const finish = (end: () => void): void => {
        window.removeEventListener("message", onMessage);
        clearInterval(watching);
        signal?.removeEventListener("abort", onAbort);
        popup.close();
        end();
      };
      const onMessage = (event: MessageEvent): void => {
        if (event.origin !== location.origin || event.source !== popup) return;
        const url = returned(event.data);
        if (url !== undefined) finish(() => resolve(url));
      };
      const onAbort = (): void =>
        finish(() =>
          reject(new ConnectionFailure("cancelled", "the sign-in was stopped")),
        );
      window.addEventListener("message", onMessage);
      // The return page posts and then closes itself, and its message is a task of its own: a popup seen closed is a
      // cancellation only once it is still closed, with no message, on the next look.
      let seenClosed = false;
      const watching = setInterval(() => {
        if (!popup.closed) return;
        if (!seenClosed) {
          seenClosed = true;
          return;
        }
        finish(() =>
          reject(
            new ConnectionFailure("cancelled", "the person closed the sign-in"),
          ),
        );
      }, CLOSED_POLL_MS);
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      popup.location.href = authorize.href;
    });
}

/**
 * What the page at the redirect URI calls: it gives the URL it was sent to, with its code and state, to the window
 * that opened the sign-in, and to nothing of another origin, then closes.
 */
export function finishSignIn(): void {
  const opener = window.opener as Window | null;
  const message: Returned = { type: RETURNED, url: location.href };
  opener?.postMessage(message, location.origin);
  window.close();
}
