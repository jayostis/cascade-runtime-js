import { Html, markup } from "./html.js";

/** Where the page finds the package's browser build, beside it. */
export const TRY_PACKAGE = "cascade-runtime/";
/** The view the page renders, the starter's `summary.mjs`, beside the page as `.js`, a name every server types. */
export const SUMMARY = "summary.js";
/** The packages the view and the app import, each beside the page as one `.js` module, by the name they import. */
export const VIEW_PACKAGES = {
  preact: "preact.js",
  htm: "htm.js",
  "preact-render-to-string": "preact-render-to-string.js",
} as const;
/** The demo hospitals' worker, its page side and its data, beside the page, so the worker's scope is the page's folder. */
export const WORKER = "demo-hospital-worker.js";
export const WORKER_PAGE = "demo-hospitals.js";
export const WORKER_DATA = "demo-hospitals/";
export const SIGNED_IN = "signed-in.html";
/** Every person the demo hospitals hold, with the hospitals that hold them, as the view's `demoPeople` gives them. */
export const PEOPLE = "demo-people.json";

function head(title: string): Html {
  const imports = JSON.stringify({
    imports: {
      "cascade-runtime": `./${TRY_PACKAGE}dist/browser/index.js`,
      ...Object.fromEntries(
        Object.entries(VIEW_PACKAGES).map(([name, file]) => [
          name,
          `./${file}`,
        ]),
      ),
    },
  });
  return markup`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<script type="importmap">${new Html(imports)}</script>`;
}

/**
 * The page that keeps pods in the browser and shows each as a person reads it; its app writes everything it shows,
 * and offers to load a copy of each published pod in `samples`, by its folder. Its About box gives `version`, what the
 * page was built from, and `runtime`, the version of cascade-runtime it runs.
 */
export function tryPage(
  samples: readonly string[],
  { version, runtime }: { version: string; runtime: string },
): string {
  return markup`<!DOCTYPE html>
<html lang="en">
<head>
${head("Cascade in your browser")}
<script type="module" src="app.js"></script>
</head>
<body data-state="opening" data-samples="${samples.join(" ")}" data-version="${version}" data-runtime="${runtime}">
<main><p role="status">Opening…</p></main>
</body>
</html>
`.text;
}

/** The redirect URI's page: it hands the URL it was sent to back to the window that opened the sign-in. */
export function signedInPage(): string {
  return markup`<!DOCTYPE html>
<html lang="en">
<head>
${head("Signing in")}
<script type="module">import { finishSignIn } from "cascade-runtime"; finishSignIn();</script>
</head>
<body>
<main><p>Signing you in…</p></main>
</body>
</html>
`.text;
}
