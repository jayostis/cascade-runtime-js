import { FILES_JSON, type Layout } from "@cascade-runtime/runtime";
import { markup } from "./html.js";
import { STYLESHEET_FILE } from "./site.js";
import { STYLESHEET } from "./stylesheet.js";
import { COPY } from "./terms.js";

export const FRONT_PAGE = "index.html";
export const START_PAGE = "start.html";
export const EXAMPLES_PAGE = "examples.html";
export const TRY = "try/";
export const TRY_PAGE = `${TRY}index.html`;
export const CONNECT = "connect/";
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

/** What the front page and the quick start give a newcomer to start with. */
export interface Start {
  /** The line that makes an app. */
  readonly command: string;
  /** The folder it makes the app in. */
  readonly app: string;
  /** What a person hands a coding agent. */
  readonly prompt: string;
  /** The title of each kind of record a pod holds. */
  readonly kinds: readonly string[];
  /** The folder of the example the quick start and try/ name. */
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
  { kinds }: Start,
  examples: readonly Example[],
  tried: boolean,
): string {
  return markup`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cascade pods</title>
<link rel="stylesheet" href="${STYLESHEET_FILE}">
</head>
<body>
<main>
<h1>Cascade pods</h1>
<p class="prose">A pod holds one person's health records as files, and an app reads and writes it through
<code>cascade-runtime</code>.</p>
<h2 class="part">Build an app</h2>
<p class="prose">One command makes a working app on a pod, and a coding agent builds your idea on it.</p>
<ul>
<li><a href="${START_PAGE}">Quick start</a></li>
${
  tried &&
  markup`<li><a href="${TRY_PAGE}">See an app running in your browser, nothing to install</a></li>
`
}</ul>
<h2 class="part">Explore a pod</h2>
<p class="prose">A pod is one person's records as RDF files, laid out as cascade-vocabulary says, and every view and
question that reads it is a SPARQL query.</p>
<ul>
${examples.map(
  ({ folder, title }) =>
    markup`<li><a href="${folder}/index.html">Browse ${title}'s pod</a>: its records, its views, and every question with its SPARQL query. <a class="also" href="${folder}/${COPY}${POD_ENTRY}">The pod's files</a></li>\n`,
)}<li><a href="${EXAMPLES_PAGE}">Every example pod, and what built these pages</a></li>
</ul>
<h3>What a pod holds today</h3>
<ul>
${kinds.map((kind) => markup`<li>${kind}</li>\n`)}</ul>
<p class="prose">Records come in from two formats: FHIR R4, from the clinical records of an Apple Health export, and C-CDA, a
summary of care as a patient portal hands it out. The matcher joins one record across both. Vital signs, notes and daily
measurements are not yet held. The reference tables the matcher uses to join records of the same thing are alpha test data,
so a real export shows fewer automatic joins than the example pods.</p>
</main>
</body>
</html>
`.text;
}

function startPage(
  { command, app, prompt }: Start,
  { title }: Example,
  tried: boolean,
): string {
  return markup`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Start an app on a Cascade pod</title>
<link rel="stylesheet" href="${STYLESHEET_FILE}">
</head>
<body>
<nav><a href="${FRONT_PAGE}">Cascade pods</a></nav>
<main>
<h1>Start an app on a Cascade pod</h1>
<h2 class="part">1. Make the app</h2>
<p class="prose">With Node 22 or later, run this in a folder of your choice:</p>
<pre class="command"><code>${command}</code></pre>
<p class="prose">It makes the app, <code>${app}</code>, in that folder, with no pod yet.</p>
<h2 class="part">2. Hand your idea to an agent</h2>
<p class="prose">Start a coding agent in the same folder, the one holding <code>${app}</code>, and give it this prompt, with
its last line, <code>My idea: …</code>, replaced by your idea:</p>
<pre class="command"><code>${prompt}</code></pre>
<p class="prose">The agent learns how from the <code>AGENTS.md</code> at the app's root and the full guide that comes with the
installed package, and loads a pod, such as ${title}'s, when your idea needs one.</p>
${
  tried &&
  markup`<p class="prose"><a href="${TRY_PAGE}">See an app running in your browser, nothing to install</a></p>
`
}</main>
</body>
</html>
`.text;
}

/**
 * The Pages tree: the newcomer's front page, the quick start, the examples' page, each example's site in its folder with its pod's
 * files listed, the page that tries a pod in a browser, `tried`, under `try/`, and the page that connects to a demo
 * hospital, `connected`, under `connect/`, which nothing links yet.
 */
export function pagesTree(
  examples: readonly Example[],
  built: BuiltFrom,
  start: Start,
  tried: ReadonlyMap<string, Uint8Array>,
  connected: ReadonlyMap<string, Uint8Array> = new Map(),
): Map<string, Uint8Array> {
  const shown = examples.find(({ folder }) => folder === start.example);
  if (shown === undefined)
    throw new Error(`no example ${start.example} among the kits`);
  const encoder = new TextEncoder();
  const tree = new Map<string, Uint8Array>([
    [EXAMPLES_PAGE, encoder.encode(examplesPage(examples, built))],
    [STYLESHEET_FILE, encoder.encode(STYLESHEET)],
  ]);
  for (const { folder, site } of examples) {
    for (const [path, bytes] of site) tree.set(`${folder}/${path}`, bytes);
    const pod = [...site.keys()]
      .filter((path) => path.startsWith(COPY))
      .map((path) => path.slice(COPY.length))
      .filter((path) => path !== FILES_JSON)
      .sort();
    tree.set(
      `${folder}/${COPY}${FILES_JSON}`,
      encoder.encode(`${JSON.stringify(pod, null, 2)}\n`),
    );
  }
  for (const [path, bytes] of tried) tree.set(TRY + path, bytes);
  for (const [path, bytes] of connected) tree.set(CONNECT + path, bytes);
  const hasTry = tree.has(TRY_PAGE);
  tree.set(START_PAGE, encoder.encode(startPage(start, shown, hasTry)));
  tree.set(FRONT_PAGE, encoder.encode(frontPage(start, examples, hasTry)));
  return tree;
}
