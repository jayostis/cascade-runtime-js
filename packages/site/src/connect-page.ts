import { TRY } from "./front-page.js";
import { Html, markup } from "./html.js";
import { STYLESHEET_FILE } from "./site.js";
import { TRY_PACKAGE } from "./try-page.js";

/** The demo hospitals' worker, its page side and its data, beside the page, so the worker's scope is the page's folder. */
export const WORKER = "demo-hospital-worker.js";
export const WORKER_PAGE = "demo-hospitals.js";
export const WORKER_DATA = "demo-hospitals/";
export const SIGNED_IN = "signed-in.html";

/** A hospital the page offers, as the app's directory gives it. */
export interface Offered {
  readonly name: string;
  readonly fhirBase: string;
  /** The name its pull is imported under. */
  readonly id: string;
}

function head(title: string): Html {
  const imports = JSON.stringify({
    imports: {
      "cascade-runtime": `../${TRY}${TRY_PACKAGE}dist/browser/index.js`,
    },
  });
  return markup`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="../${STYLESHEET_FILE}">
<script type="importmap">${new Html(imports)}</script>`;
}

/** The page that signs in to a demo hospital, pulls the record and imports it into a pod in the browser. */
export function connectPage(hospitals: readonly Offered[]): string {
  return markup`<!DOCTYPE html>
<html lang="en">
<head>
${head("Connect to a demo hospital")}
<script type="module" src="app.js"></script>
</head>
<body data-state="opening">
<main>
<h1>Connect to a demo hospital</h1>
<p class="prose">Sign in to a demo hospital as one of its made-up patients, and the app pulls the record over SMART on
FHIR and imports it into a pod kept in this browser's own storage. The hospital is served by this page's own service
worker: nothing leaves the browser.</p>
<p class="prose" id="status" role="status">Starting the demo hospitals…</p>
<p class="prose">${hospitals.map(
    ({ name, fhirBase, id }) =>
      markup`<button type="button" class="sign-in" data-name="${name}" data-fhir-base="${fhirBase}" data-id="${id}">Sign in to ${name}</button> `,
  )}</p>
<h2 class="part">Pulled</h2>
<ul id="pulled"></ul>
<h2 class="part">Active allergies</h2>
<table id="allergies"><thead></thead><tbody></tbody></table>
<h2 class="part">Active medications</h2>
<table id="medications"><thead></thead><tbody></tbody></table>
<p class="prose"><button type="button" id="start-over">Start over</button></p>
</main>
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
<main><p class="prose">Signing you in…</p></main>
</body>
</html>
`.text;
}
