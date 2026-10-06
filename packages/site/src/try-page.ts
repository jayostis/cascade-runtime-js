import { Html, markup } from "./html.js";
import { STYLESHEET_FILE } from "./site.js";

/** Where the page finds the package's browser build, beside it. */
export const TRY_PACKAGE = "cascade-runtime/";

/** The page that opens a copy of the example's published pod in the browser, named by the kit's title. */
export function tryPage(title: string): string {
  const imports = JSON.stringify({
    imports: { "cascade-runtime": `./${TRY_PACKAGE}dist/browser/index.js` },
  });
  return markup`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}'s pod in your browser</title>
<link rel="stylesheet" href="../${STYLESHEET_FILE}">
<script type="importmap">${new Html(imports)}</script>
<script type="module" src="app.js"></script>
</head>
<body data-state="opening">
<main>
<h1>${title}'s pod in your browser</h1>
<p class="prose">This is a copy of ${title}'s published pod, kept in this browser's own storage. Nothing you add here
leaves the browser.</p>
<p class="prose" id="status" role="status">Opening the pod…</p>
<h2 class="part">Active allergies</h2>
<table id="active">
<thead><tr><th>Allergen</th><th>Criticality</th></tr></thead>
<tbody></tbody>
</table>
<h2 class="part">Add an allergy</h2>
<form id="add">
<label>Allergen <input name="allergen" required autocomplete="off"></label>
<button type="submit">Add an allergy</button>
</form>
<p class="prose">Only a hospital's record gives an allergy a status, so an allergy you add is never among the active
ones above.</p>
<h2 class="part">Allergies you added</h2>
<ul id="added"></ul>
<p class="prose"><button type="button" id="start-over">Start over</button></p>
</main>
</body>
</html>
`.text;
}
