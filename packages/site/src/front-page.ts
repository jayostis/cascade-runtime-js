import type { Layout } from "@cascade-runtime/runtime";
import { markup } from "./html.js";
import { STYLESHEET_FILE } from "./site.js";
import { STYLESHEET } from "./stylesheet.js";
import { COPY } from "./terms.js";

export const FRONT_PAGE = "index.html";
export const EXAMPLES_PAGE = "examples.html";
export const TRY_PAGE = "try/index.html";
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
  /** What the runtime is configured with that the build itself did not run, such as the adapters a kit's saved output stands in for. */
  readonly configured: readonly Ingredient[];
  readonly at: string;
}

const ingredients = (listed: readonly Ingredient[]) => markup`<ul class="about">
${listed.map(
  ({ name, version, href }) =>
    markup`<li><a href="${href}">${name} ${version}</a></li>
`,
)}</ul>
`;

function examplesPage(examples: readonly Example[], built: BuiltFrom): string {
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
${ingredients(built.ingredients)}<p class="about">The runtime is configured with:</p>
${ingredients(built.configured)}</footer>
</body>
</html>
`.text;
}

/** What the front page gives a newcomer to start with. */
export interface Start {
  /** The preview notice, a sentence a line. */
  readonly notice: string;
  /** The line that makes an app. */
  readonly command: string;
  /** What a person hands a coding agent. */
  readonly prompt: string;
  /** The title of each kind of record a pod holds. */
  readonly kinds: readonly string[];
  /** The folder of the example shown as a pod. */
  readonly example: string;
}

/** The title of each view of the layout, in its order. */
export function viewTitles(layout: Layout): string[] {
  return layout.views.map(({ kind, title }) => {
    if (title === undefined)
      throw new Error(`the layout gives the view of ${kind ?? ""} no title`);
    return title;
  });
}

function frontPage(
  { notice, command, prompt, kinds, example }: Start,
  { title }: Example,
  tried: boolean,
): string {
  const lines = notice.trim().split(/\r?\n/);
  return markup`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Build an app on a Cascade pod</title>
<link rel="stylesheet" href="${STYLESHEET_FILE}">
</head>
<body>
<main>
<p class="notice">${lines.map((line, index) => markup`${index === 0 ? "" : markup`<br>\n`}${line}`)}</p>
<h1>Build an app on a Cascade pod</h1>
<p class="prose">A pod holds one person's health records as files, and an app answers questions from it. Here is one:
<a href="${example}/index.html">${title}</a>'s site shows what the pod holds and the questions that read it, and
<a href="${example}/${COPY}${POD_ENTRY}">the pod's files</a> are the pod itself.</p>
<h2 class="part">What a pod holds today</h2>
<ul>
${kinds.map((kind) => markup`<li>${kind}</li>\n`)}</ul>
<p class="prose">Records come in only from the clinical records of an Apple Health export; observations, medications, lab
results and daily measurements are not yet held. The reference tables the matcher uses to join records of the same thing are
alpha test data, so a real export shows fewer automatic joins than ${title}'s pod.</p>
<h2 class="part">Start an app</h2>
<p class="prose">With Node 22 or later, run:</p>
<pre class="command"><code>${command}</code></pre>
<p class="prose">It makes an app with no pod. Inside it, <code>npm run pod:load ${example}</code> fills one with
${title}'s, and <code>npm start</code> runs the app.</p>
<h2 class="part">Hand your idea to an agent</h2>
<p class="prose">Give a coding agent this prompt, with its last line, <code>My idea: …</code>, replaced by your idea:</p>
<pre class="command"><code>${prompt}</code></pre>
<p class="prose">The agent learns how from the <code>AGENTS.md</code> at the app's root and the full guide that comes with the
installed package.</p>
${
  tried &&
  markup`<h2 class="part">Try it in your browser</h2>
<p class="prose"><a href="${TRY_PAGE}">Open the demo</a>; there is nothing to install.</p>
`
}<h2 class="part">Further</h2>
<p class="prose"><a href="${EXAMPLES_PAGE}">Every example</a>, and what built these pages.</p>
</main>
</body>
</html>
`.text;
}

/** The Pages tree: the newcomer's front page, the examples' page, and each example's site in its folder. */
export function pagesTree(
  examples: readonly Example[],
  built: BuiltFrom,
  start: Start,
): Map<string, Uint8Array> {
  const shown = examples.find(({ folder }) => folder === start.example);
  if (shown === undefined)
    throw new Error(`no example ${start.example} among the kits`);
  const encoder = new TextEncoder();
  const tree = new Map<string, Uint8Array>([
    [EXAMPLES_PAGE, encoder.encode(examplesPage(examples, built))],
    [STYLESHEET_FILE, encoder.encode(STYLESHEET)],
  ]);
  for (const { folder, site } of examples)
    for (const [path, bytes] of site) tree.set(`${folder}/${path}`, bytes);
  tree.set(
    FRONT_PAGE,
    encoder.encode(frontPage(start, shown, tree.has(TRY_PAGE))),
  );
  return tree;
}
