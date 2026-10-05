import { markup } from "./html.js";
import { STYLESHEET_FILE } from "./site.js";
import { STYLESHEET } from "./stylesheet.js";
import { COPY } from "./terms.js";

export const FRONT_PAGE = "index.html";
const POD_ENTRY = "manifest.ttl";

/** An example's site, placed in the folder named after its kit. */
export interface Example {
  readonly folder: string;
  /** The name the vocabulary gives the kit. */
  readonly title: string;
  readonly site: ReadonlyMap<string, Uint8Array>;
}

/** One thing the tree was built from: a repository at the commit a run resolved, or a release. */
export interface Ingredient {
  readonly name: string;
  readonly version: string;
  readonly href: string;
}

export interface BuiltFrom {
  readonly ingredients: readonly Ingredient[];
  readonly at: string;
}

function frontPage(examples: readonly Example[], built: BuiltFrom): string {
  return markup`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cascade example pods</title>
<link rel="stylesheet" href="${STYLESHEET_FILE}">
</head>
<body>
<main>
<h1>Cascade example pods</h1>
<p class="prose">These are the example pods the reference runtime, cascade-runtime-js, builds from the conformance kits of
cascade-vocabulary. Each kit is a person's story, replayed into a pod, and each pod has a site that shows what it holds and
the questions that read it.</p>
<ul>
${examples.map(
  ({ folder, title }) =>
    markup`<li><a href="${folder}/index.html">${title}</a> <a class="also" href="${folder}/${COPY}${POD_ENTRY}">the pod's files</a></li>\n`,
)}</ul>
</main>
<footer>
<p class="about">Built at <time datetime="${built.at}">${built.at}</time> from:</p>
<ul class="about">
${built.ingredients.map(
  ({ name, version, href }) =>
    markup`<li><a href="${href}">${name} ${version}</a></li>\n`,
)}</ul>
</footer>
</body>
</html>
`.text;
}

/** The Pages tree: the front page, and each example's site in its folder. */
export function pagesTree(
  examples: readonly Example[],
  built: BuiltFrom,
): Map<string, Uint8Array> {
  const encoder = new TextEncoder();
  const tree = new Map<string, Uint8Array>([
    [FRONT_PAGE, encoder.encode(frontPage(examples, built))],
    [STYLESHEET_FILE, encoder.encode(STYLESHEET)],
  ]);
  for (const { folder, site } of examples)
    for (const [path, bytes] of site) tree.set(`${folder}/${path}`, bytes);
  return tree;
}
