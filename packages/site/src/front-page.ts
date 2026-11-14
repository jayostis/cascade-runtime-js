import { FILES_JSON, type Layout } from "@cascade-runtime/runtime";
import { type Chrome, type Content, markup, PLAIN, shell } from "./html.js";
import { FRONT_PAGE, frontPageLink } from "./links.js";
import { addressOf, type Row, type Rows, type Want } from "./sections.js";
import { STYLESHEET_FILE } from "./site.js";
import { STYLESHEET } from "./stylesheet.js";
import { COPY } from "./terms.js";

/**
 * What a reader came for, in the order the front page's table lists it and `llms.txt` groups its links: the table's
 * "I want to" column, which `llms.txt` capitalises for a heading.
 */
export const WANTS: Readonly<Record<Want, string>> = {
  see: "see it work",
  build: "build an app",
  model: "understand the data model",
  why: "know why it is built this way",
  rules: "read the rules",
  conformance: "check conformance",
  adapters: "map FHIR or C-CDA to the model",
  pods: "look inside a pod",
  evals: "see how well a model answers from a pod",
  agent: "point an agent at it",
  contribute: "contribute",
};

/** The table's rows in order. */
export const WANT_ORDER = Object.keys(WANTS) as readonly Want[];

/** The place on the front page that lists every repository, which the contribute row links. */
export const REPOSITORIES_ANCHOR = "#repositories";

export const OWNER = "https://github.com/jayostis";

export interface Repository {
  readonly name: string;
  readonly about: string;
  /** Its own site, when it has one. */
  readonly site?: string;
}

/** Every repository of the project that is live: not the archived bridge-js or clinvar, nor the private health assistant. */
export const REPOSITORIES: readonly Repository[] = [
  {
    name: "cascade-vocabulary",
    about:
      "The terms, shapes, queries and rules a pod is built and read by, and the conformance kits that test a runtime.",
  },
  {
    name: "cascade-runtime-js",
    about:
      "The reference runtime, in TypeScript: it opens a pod, runs its questions and builds these pages.",
  },
  {
    name: "cascade-bridge-spec",
    about:
      "The Cascade Bridge specification: the contract every adapter and bridge follows.",
  },
  {
    name: "cascade-bridge-rs",
    about:
      "Cascade Bridge in Rust: it runs adapters under the sparql-1.1 profile.",
  },
  {
    name: "cascade-bridge-adapter-fhir-r4",
    about: "The adapter that turns FHIR R4 JSON into Cascade records.",
  },
  {
    name: "cascade-bridge-adapter-ccda",
    about: "The adapter that turns C-CDA R2.1 XML into Cascade records.",
  },
  {
    name: "cascade-starter-kit",
    about:
      "The app template create-cascade-app makes, and the try/ page that runs one in your browser.",
  },
  {
    name: "cascade-reference-tables",
    about:
      "The reference tables the matcher joins records of the same thing by, their builders, and the feed apps read.",
    site: "https://jayostis.github.io/cascade-reference-tables/",
  },
  {
    name: "cascade-sandbox",
    about:
      "A pretend health system with a past: demo FHIR hospitals that answer as of a date, for testing apps.",
  },
];

export { FRONT_PAGE };
export const START_PAGE = "start.html";
export const EXAMPLES_PAGE = "examples.html";
/** Where try/ was: a page that sends a visitor on to the starter kit's, with the pod or table they were sent to. */
export const TRY_PAGE = "try/index.html";
/** The page that keeps pods in the browser, published by the starter kit, on the same origin as these pages. */
export const STARTER_TRY =
  "https://jayostis.github.io/cascade-starter-kit/try/";
export const POD_ENTRY = "manifest.ttl";

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

export function examplesPage(
  examples: readonly Example[],
  built: BuiltFrom,
  chrome: Chrome = PLAIN,
): string {
  return shell({
    chrome,
    title: "Cascade example pods",
    stylesheet: STYLESHEET_FILE,
    nav: markup`${frontPageLink(0)}\n`,
    main: markup`<h1>Cascade example pods</h1>
<p class="prose">These are the example pods the reference runtime, cascade-runtime-js, builds from the conformance kits of
cascade-vocabulary. Each kit is a person's story, replayed into a pod, and each pod has a site that shows what it holds and
the questions that read it.</p>
<ul>
${examples.map(
  ({ folder, title }) =>
    markup`<li><a href="${folder}/index.html">${title}</a> <a class="also" href="${folder}/${COPY}${POD_ENTRY}">the pod's files</a></li>\n`,
)}</ul>
<footer>
<p class="about">Built at <time datetime="${built.at}">${built.at}</time> from:</p>
${ingredients(built.ingredients)}<p class="about">The runtime is configured with:</p>
${ingredients(built.configured)}</footer>
`,
  }).text;
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
  /** The folder of the example the quick start names. */
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

const entry = ({ href, label, about, also }: Row): Content =>
  markup`<li><a href="${href}">${label}</a>${about === undefined ? "" : markup`: ${about}`}${also === undefined ? "" : markup` <a class="also" href="${also.href}">${also.label}</a>`}</li>
`;

/** The rows by what they are wanted for, the link to the list of repositories among those of the contribute row. */
function withRepositories(rows: Rows): Rows {
  return new Map([
    ...rows,
    [
      "contribute",
      [
        ...(rows.get("contribute") ?? []),
        { href: REPOSITORIES_ANCHOR, label: "Every repository" },
      ],
    ],
  ]);
}

/** Refuses a page that links an address twice: a reader who finds one in two places wonders which is the real one. */
function checkOnce(rows: Rows): void {
  const seen = new Set<string>();
  const once = (href: string): void => {
    const address = addressOf(href);
    if (seen.has(address))
      throw new Error(`the front page links ${href} twice`);
    seen.add(address);
  };
  for (const listed of rows.values())
    for (const { href, also } of listed) {
      once(href);
      if (also !== undefined) once(also.href);
    }
  for (const { name, site } of REPOSITORIES) {
    once(`${OWNER}/${name}`);
    if (site !== undefined) once(site);
  }
}

const findYourWay = (rows: Rows): Content => markup`<table id="find-your-way">
<thead><tr><th scope="col">I want to&hellip;</th><th scope="col">Go here</th></tr></thead>
<tbody>
${WANT_ORDER.flatMap((want) => {
  const listed = rows.get(want) ?? [];
  return listed.length === 0
    ? []
    : [
        markup`<tr id="want-${want}"><th scope="row">${WANTS[want]}</th><td><ul>
${listed.map(entry)}</ul></td></tr>
`,
      ];
})}</tbody>
</table>
`;

const repositories = markup`<h2 id="repositories">Every repository</h2>
<table id="repository-list">
<tbody>
${REPOSITORIES.map(
  ({ name, about, site }) =>
    markup`<tr id="repository-${name}"><th scope="row"><a href="${OWNER}/${name}">${name}</a></th><td>${about}${site === undefined ? "" : markup` <a class="also" href="${site}">its site</a>`}</td></tr>
`,
)}</tbody>
</table>
`;

function frontPage(
  kinds: readonly string[],
  listed: Rows,
  chrome: Chrome,
): string {
  const rows = withRepositories(listed);
  checkOnce(rows);
  return shell({
    chrome,
    title: "Cascade Protocol reference",
    stylesheet: STYLESHEET_FILE,
    main: markup`<h1>Cascade Protocol reference</h1>
<p class="prose">A pod holds one person's health records as files, and an app reads and writes it through
<code>cascade-runtime</code>.</p>
<h2 id="find-your-way-heading">Find your way</h2>
${findYourWay(rows)}<h3>What a pod holds today</h3>
<ul>
${kinds.map((kind) => markup`<li>${kind}</li>\n`)}</ul>
<p class="prose">Records come in from two formats: FHIR R4, from the clinical records of an Apple Health export, and C-CDA, a
summary of care as a patient portal hands it out. The matcher joins one record across both. Vital signs, notes and daily
measurements are not yet held. The reference tables the matcher uses to join records of the same thing are alpha test data,
so a real export shows fewer automatic joins than the example pods.</p>
${repositories}`,
  }).text;
}

export function startPage(
  { command, app, prompt }: Start,
  { title }: Example,
  chrome: Chrome = PLAIN,
): string {
  return shell({
    chrome,
    title: "Start an app on a Cascade pod",
    stylesheet: STYLESHEET_FILE,
    nav: markup`<a href="${FRONT_PAGE}">Cascade Protocol reference</a>\n`,
    main: markup`<h1>Start an app on a Cascade pod</h1>
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
<p class="prose"><a href="${STARTER_TRY}">See an app running in your browser, nothing to install</a></p>
`,
  }).text;
}

/**
 * try/'s old page: it sends the visitor on to the starter kit's try/ with the query and fragment they came with, which
 * name a pod or a table. The old page's demo hospitals' worker, registered for this folder, is unregistered first: its
 * script is gone, so it would otherwise stay registered here for good.
 */
export function redirectPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cascade in your browser has moved</title>
<link rel="canonical" href="${STARTER_TRY}">
<meta http-equiv="refresh" content="5; url=${STARTER_TRY}">
<script>
(async () => {
  const to = new URL(${JSON.stringify(STARTER_TRY)});
  to.search = location.search;
  to.hash = location.hash;
  try {
    const here = new URL("./", location.href).href;
    await Promise.race([
      (async () => {
        const registered = (await navigator.serviceWorker?.getRegistrations()) ?? [];
        await Promise.all(
          registered.filter(({ scope }) => scope === here).map((r) => r.unregister()),
        );
      })(),
      new Promise((done) => setTimeout(done, 1000)),
    ]);
  } catch {}
  location.replace(to.href);
})();
</script>
</head>
<body>
<main>
<p>This page has moved to <a href="${STARTER_TRY}">${STARTER_TRY}</a>.</p>
<p><a href="../${FRONT_PAGE}">Cascade Protocol reference</a></p>
</main>
</body>
</html>
`;
}

/** The pack of an example's pod beside its folder, which a browser copies the pod from in one request. */
export const POD_PACK = `${COPY.slice(0, -1)}.pack.json`;

/** The pod's files of an example's site, by their paths in the pod, sorted. */
export function podOf(
  site: ReadonlyMap<string, Uint8Array>,
): Map<string, Uint8Array> {
  return new Map(
    [...site]
      .filter(([path]) => path.startsWith(COPY))
      .map(([path, bytes]) => [path.slice(COPY.length), bytes] as const)
      .filter(([path]) => path !== FILES_JSON)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/** The front page, from the rows every section added, and the stylesheet every page of the tree links. */
export function hubFiles(
  kinds: readonly string[],
  rows: Rows,
  chrome: Chrome = PLAIN,
): Map<string, Uint8Array> {
  const encoder = new TextEncoder();
  return new Map([
    [FRONT_PAGE, encoder.encode(frontPage(kinds, rows, chrome))],
    [STYLESHEET_FILE, encoder.encode(STYLESHEET)],
  ]);
}
