import {
  FRONT_PAGE,
  OWNER,
  REPOSITORIES,
  WANT_ORDER,
  WANTS,
} from "./front-page.js";
import { type Chrome, Html, markup, shell } from "./html.js";
import { renderMarkdown, renderWithHeadings } from "./markdown.js";
import {
  addressOf,
  isLocal,
  pageOf,
  type Row,
  type Walk,
  type Want,
} from "./sections.js";
import { SEARCH_SCRIPT } from "./search-script.js";
import { STYLESHEET_FILE } from "./site.js";
import { TERMS_PAGE } from "./term-reference.js";

export const LLMS_FILE = "llms.txt";
export const INDEX_FILE = "index.json";
/** The package's guide, served as it is at the root of the hub. */
export const AGENTS_FILE = "AGENTS.md";
/** The conformance section's machine-readable results, which `llms.txt` points an agent at when the tree holds them. */
const RESULTS_FILE = "conformance/results.json";

const API_FOLDER = "api/";
export const API_PAGE = `${API_FOLDER}index.html`;
export const PACKAGE_PAGE = `${API_FOLDER}package.html`;

const SUMMARY =
  "A pod holds one person's health records as files, and an app reads and writes it through `cascade-runtime`, the reference runtime. These pages are built from the repositories on every merge: how to build an app, the example pods, and what the vocabulary and the runtime promise.";

const encoder = new TextEncoder();

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decoded(text: string): string {
  return text.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (whole, decimal?: string, hex?: string, name?: string) => {
      if (name !== undefined) return ENTITIES[name.toLowerCase()] ?? whole;
      const code = Number.parseInt(decimal ?? hex ?? "", decimal ? 10 : 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    },
  );
}

const basename = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1);

const DATA = /\.(?:ttl|nt|nq|trig|jsonld|json|rdf)$/i;
const DOCUMENT = /\.(?:md|txt)$/i;

/** What a file is: a page, data (RDF and JSON), a document (Markdown and text), or any other file. */
function kindOf(path: string): "page" | "data" | "document" | "file" {
  if (/\.html?$/i.test(path)) return "page";
  if (DATA.test(path)) return "data";
  if (DOCUMENT.test(path)) return "document";
  return "file";
}

/** A page's own title, a Markdown file's first heading; any other file is titled by its name. */
function titleOf(path: string, bytes: Uint8Array | undefined): string {
  const body = (): string => new TextDecoder().decode(bytes);
  const found = /\.html?$/i.test(path)
    ? decoded(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body())?.[1] ?? "")
    : /\.md$/i.test(path)
      ? (/^# +(.+)$/m.exec(body())?.[1] ?? "")
      : "";
  const title = found.replace(/\s+/g, " ").trim();
  return title === "" ? basename(path) : title;
}

/** One file of the hub, as `index.json` lists it. */
export interface Listed {
  readonly path: string;
  readonly title: string;
  readonly kind: "page" | "data" | "document" | "file";
  readonly source: string;
}

/** What the search box looks through, and the script that ranks it; both stand at the hub's root. */
export const SEARCH_FILE = "search.json";
export const SEARCH_SCRIPT_FILE = "search.js";

/** One place the search box can go: a page, or an anchor of a page that is a term, a rule or a decision note. */
export interface SearchRow {
  readonly path: string;
  readonly title: string;
  readonly kind: "page" | "term" | "rule" | "decision" | "eval";
  /** What a term is called in words, beside its name. */
  readonly label?: string;
}

const TERM_ANCHOR =
  /<h3 id="([a-z][a-z0-9-]*:[^"]+)"><code>[^<]*<\/code>\s*([^<]*)<\/h3>/g;
const RULE_ANCHOR =
  /<section class="rule" id="([^"]+)">\s*<h2>([\s\S]*?)<\/h2>/g;
const NOTE_FOLDER = "decisions/";
const RULES_FOLDER = "spec/";
const EVALS_FOLDER = "evals/";
const SITE_NAME = / [·—] Cascade [^·—]*$/;
const REDIRECT = /http-equiv="refresh"/i;

const words = (html: string): string =>
  decoded(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

/**
 * The rows of `search.json`: every page of `listed`, and the anchors the reader looks for by name inside pages that are
 * not one page each: the term reference's terms of every namespace, and the rules of the spec's pages. A page is titled
 * without the site's name after it, a decision note and an evals page are told by their kind, and a page that only
 * redirects is no row.
 */
function searchRows(
  listed: readonly Listed[],
  tree: ReadonlyMap<string, Uint8Array>,
): SearchRow[] {
  const rows: SearchRow[] = [];
  for (const { path, title, kind } of listed) {
    if (kind !== "page") continue;
    const html = (): string => new TextDecoder().decode(tree.get(path));
    if (REDIRECT.test(html())) continue;
    const note =
      path.startsWith(NOTE_FOLDER) && path !== `${NOTE_FOLDER}index.html`;
    rows.push({
      path,
      title: title.replace(SITE_NAME, ""),
      kind: note ? "decision" : path.startsWith(EVALS_FOLDER) ? "eval" : "page",
    });
    if (path === TERMS_PAGE)
      for (const [, id = "", label = ""] of html().matchAll(TERM_ANCHOR))
        rows.push({
          path: `${path}#${id}`,
          title: id,
          kind: "term",
          label: words(label),
        });
    else if (path.startsWith(RULES_FOLDER))
      for (const [, id = "", heading = ""] of html().matchAll(RULE_ANCHOR))
        rows.push({
          path: `${path}#${id}`,
          title: words(heading),
          kind: "rule",
        });
  }
  return rows;
}

const link = (label: string, href: string): string =>
  `[${label.replace(/[[\]\\]/g, "\\$&")}](${href.replace(/[\s()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)})`;

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

function item(label: string, href: string, about?: string): string {
  return `- ${link(label, href)}${about === undefined || oneLine(about) === "" ? "" : `: ${oneLine(about)}`}`;
}

/**
 * `llms.txt` and `index.json`, written from the tree as it stands once every section and the front page are in it, so
 * a page another step adds is indexed with no change here. `llms.txt` is in the llmstxt.org form: it lists each
 * section's rows, which name the kinds of page and each kit's root, never every page; `index.json` lists every file
 * but the stylesheets, each with its title, kind and what it is built from. Links are relative to the file, because the
 * hub does not depend on the address it is served at; a build given the address it will be served at (`base`, ending in
 * `/`) puts it before every local link in `llms.txt` and names it in `index.json`, whose paths stay relative to it.
 */
export async function agentFiles<Ctx extends { readonly base?: string }>(
  { tree, sections }: Walk<Ctx>,
  { base }: Ctx,
): Promise<ReadonlyMap<string, Uint8Array>> {
  if (base !== undefined && !base.endsWith("/"))
    throw new Error(
      `the base address ${JSON.stringify(base)} must end in "/", or a link joined to it names another file`,
    );
  const at = (href: string): string =>
    base !== undefined && isLocal(href) ? `${base}${href}` : href;
  const title = titleOf(FRONT_PAGE, tree.get(FRONT_PAGE));
  const sourceOf = new Map<string, string>([
    [FRONT_PAGE, "the sections' rows"],
    [LLMS_FILE, "the tree the build wrote"],
    [INDEX_FILE, "the tree the build wrote"],
    [SEARCH_FILE, "the tree the build wrote"],
    [SEARCH_SCRIPT_FILE, "the search box's script"],
  ]);
  for (const { section, paths } of sections)
    for (const path of paths)
      sourceOf.set(path, section.source ?? section.title);

  const files: Listed[] = [
    ...new Set([
      ...tree.keys(),
      LLMS_FILE,
      INDEX_FILE,
      SEARCH_FILE,
      SEARCH_SCRIPT_FILE,
    ]),
  ]
    .filter((path) => !/\.css$/i.test(path))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((path) => ({
      path,
      title: titleOf(path, tree.get(path)),
      kind: kindOf(path),
      source: sourceOf.get(path) ?? "the build",
    }));

  const listed = new Set<string>([LLMS_FILE]);
  const once = (href: string): boolean => {
    const target = addressOf(href);
    if (listed.has(target)) return false;
    listed.add(target);
    return true;
  };

  const forAgents = [
    ...(tree.has(AGENTS_FILE) && once(AGENTS_FILE)
      ? [
          item(
            AGENTS_FILE,
            at(AGENTS_FILE),
            "the guide to building an app on a pod, with every call of `cascade-runtime` and code for each",
          ),
        ]
      : []),
    ...(once(INDEX_FILE)
      ? [
          item(
            INDEX_FILE,
            at(INDEX_FILE),
            "every page and file of this site, each with its title, kind and what it is built from",
          ),
        ]
      : []),
    ...(tree.has(RESULTS_FILE) && once(RESULTS_FILE)
      ? [
          item(
            "Conformance results as JSON",
            at(RESULTS_FILE),
            "the latest run on main, by feature and rule. `at` is when this site was built, not when the run was made; the vocabulary the run used is the `cascade-vocabulary` entry of `ranWith`, while `vocabulary` is the one these pages were read from",
          ),
        ]
      : []),
  ];

  const wanted = new Map<Want, string[]>();
  const optional: string[] = [];
  for (const { section, rows } of sections) {
    const named = rows.some(({ href }) => pageOf(href) === section.path);
    const own: readonly Row[] =
      named || section.about === undefined
        ? []
        : [{ href: section.path, label: section.title, about: section.about }];
    for (const { href, label, about, want = section.want, audience } of [
      ...rows,
      ...own,
    ])
      if (audience !== "people" && once(href)) {
        const lines =
          section.optional === true ? optional : (wanted.get(want) ?? []);
        lines.push(item(label, at(href), about));
        if (section.optional !== true) wanted.set(want, lines);
      }
  }
  wanted.set("contribute", [
    ...(wanted.get("contribute") ?? []),
    ...REPOSITORIES.flatMap(({ name, about, site }) => [
      item(name, `${OWNER}/${name}`, about),
      ...(site === undefined ? [] : [item(`${name} site`, site)]),
    ]),
  ]);
  const parts = WANT_ORDER.filter((want) => wanted.has(want));

  const llms = [
    `# ${title}`,
    "",
    `> ${SUMMARY}`,
    "",
    `${base === undefined ? "Links here are relative to the address of this file." : `Links here are absolute, under ${base}.`} Start with the guide, then read the index to find anything else.`,
    "",
    ...(forAgents.length === 0
      ? []
      : ["## For an agent", "", ...forAgents, ""]),
    ...parts.flatMap((want) => [
      `## ${WANTS[want].charAt(0).toUpperCase()}${WANTS[want].slice(1)}`,
      "",
      ...(wanted.get(want) ?? []),
      "",
    ]),
    ...(optional.length === 0 ? [] : ["## Optional", "", ...optional, ""]),
  ].join("\n");

  return new Map([
    [LLMS_FILE, encoder.encode(llms)],
    [
      INDEX_FILE,
      encoder.encode(
        `${JSON.stringify(base === undefined ? { title, files } : { title, base, files }, null, 2)}\n`,
      ),
    ],
    [SEARCH_FILE, encoder.encode(JSON.stringify(searchRows(files, tree)))],
    [SEARCH_SCRIPT_FILE, encoder.encode(SEARCH_SCRIPT)],
  ]);
}

const bar = (here: "guide" | "package") => markup`
<a href="../${FRONT_PAGE}">Cascade Protocol reference</a>
${here === "guide" ? markup`<a href="package.html">The package</a>` : markup`<a href="index.html">The guide</a>`}
<a href="../${AGENTS_FILE}">${AGENTS_FILE}</a>
`;

function documentPage(
  chrome: Chrome,
  title: string,
  here: "guide" | "package",
  lead: Html,
  source: string,
  contents = false,
): string {
  const { html, headings } = contents
    ? renderWithHeadings(source)
    : { html: renderMarkdown(source), headings: [] };
  const list = headings.filter(({ depth }) => depth === 2);
  return shell({
    chrome,
    title,
    stylesheet: `../${STYLESHEET_FILE}`,
    hubRoot: "../",
    nav: bar(here),
    main: markup`${lead}${
      list.length === 0
        ? ""
        : markup`<p class="about">On this page</p>
<ul class="contents">
${list.map(({ id, html: label }) => markup`<li><a href="#${id}">${new Html(label)}</a></li>\n`)}</ul>
`
    }<article class="document">
${html}</article>
`,
  }).text;
}

/** The README's marker where the package's install line goes, which a page has no install line for. */
const INSTALL_MARKER = /^<!-- INSTALL -->\r?\n(?:\r?\n)?/m;

/**
 * The API page and the package page: the guide an agent reads and the package's README, rendered as they are. The guide
 * is `AGENTS.md` at the hub's root byte for byte; the page is that same text as a page.
 */
export function apiPages(
  guide: string,
  readme: string,
  chrome: Chrome,
): ReadonlyMap<string, Uint8Array> {
  return new Map([
    [
      API_PAGE,
      encoder.encode(
        documentPage(
          chrome,
          "The cascade-runtime API: building an app on a Cascade pod",
          "guide",
          markup`<p class="about">This page is the guide a coding agent reads, <a href="../${AGENTS_FILE}">${AGENTS_FILE}</a>, as a page. What the package is and holds: <a href="package.html">the package</a>.</p>
`,
          guide,
          true,
        ),
      ),
    ],
    [
      PACKAGE_PAGE,
      encoder.encode(
        documentPage(
          chrome,
          "cascade-runtime, the package",
          "package",
          markup`<p class="about">The calls are on <a href="index.html">the guide</a>.</p>
`,
          readme.replace(INSTALL_MARKER, ""),
        ),
      ),
    ],
  ]);
}
