import { createServer } from "node:http";
import type { SignIn } from "../connect/connect.js";
import { ConnectionFailure } from "../connect/outcome.js";

export interface LoopbackOptions {
  /** Takes the person to the authorize URL: opens a browser, or prints it. */
  readonly open: (authorize: URL) => void | Promise<void>;
  readonly timeoutMs?: number;
}

const DONE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Signed in</title></head>
  <body><p>You are signed in. You can close this tab.</p></body>
</html>
`;

/**
 * Sign-in through the person's own browser: listens on `127.0.0.1` at the redirect URI's registered port, and takes
 * the first redirect to its path with the `state` sent.
 */
export function loopbackSignIn(options: LoopbackOptions): SignIn {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  return (authorize, signal) =>
    new Promise<URL>((resolve, reject) => {
      const redirect = new URL(
        authorize.searchParams.get("redirect_uri") ?? "about:blank",
      );
      const state = authorize.searchParams.get("state");
      if (
        redirect.protocol !== "http:" ||
        redirect.hostname !== "127.0.0.1" ||
        redirect.port === ""
      ) {
        reject(
          new ConnectionFailure(
            "sign-in-unavailable",
            "a loopback sign-in needs a redirect URI of http://127.0.0.1:<port>/",
          ),
        );
        return;
      }
      let settled = false;
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", redirect.origin);
        if (
          settled ||
          url.pathname !== redirect.pathname ||
          url.searchParams.get("state") !== state
        ) {
          response.writeHead(400, { "Content-Type": "text/plain" });
          response.end("This is not the sign-in this app is waiting for.\n");
          return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(DONE);
        finish(() => resolve(url));
      });
      const finish = (then: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", aborted);
        server.close();
        server.closeAllConnections();
        then();
      };
      const aborted = () =>
        finish(() =>
          reject(
            new ConnectionFailure("cancelled", "the connection was cancelled"),
          ),
        );
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
        timeoutMs,
      );
      if (signal?.aborted) {
        aborted();
        return;
      }
      signal?.addEventListener("abort", aborted, { once: true });
      server.on("error", (error: NodeJS.ErrnoException) =>
        finish(() =>
          reject(
            new ConnectionFailure(
              "sign-in-unavailable",
              `the loopback sign-in could not listen on port ${redirect.port}: ${error.code ?? "error"}`,
            ),
          ),
        ),
      );
      server.listen(Number(redirect.port), "127.0.0.1", () => {
        Promise.resolve()
          .then(() => options.open(authorize))
          .catch((error: unknown) => finish(() => reject(error)));
      });
    });
}
