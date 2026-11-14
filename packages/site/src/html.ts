import { chromeStyles } from "./stylesheet.js";

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&#34;",
  "'": "&#39;",
};

/** HTML: only the literal parts of a `markup` template become tags; anything put in it is text. */
export class Html {
  constructor(readonly text: string) {}
}

export type Content =
  Html | string | number | null | undefined | false | readonly Content[];

export function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function render(content: Content): string {
  if (content instanceof Html) return content.text;
  if (Array.isArray(content)) return content.map(render).join("");
  if (content === null || content === undefined || content === false) return "";
  return escape(String(content));
}

export function markup(
  strings: TemplateStringsArray,
  ...values: readonly Content[]
): Html {
  return new Html(
    strings.reduce(
      (text, literal, index) =>
        text + render(values[index - 1] as Content) + literal,
    ),
  );
}

const WEBSITE = "https://cascadeprotocol.org";
const HUB = "https://jayostis.github.io/cascade-runtime-js";
const ORG = "https://github.com/the-cascade-protocol";

const FONTS =
  "https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap";

const MARK = new Html(
  `<svg width="30" height="25" viewBox="0 0 124 104" aria-hidden="true"><rect x="7" y="7" width="58" height="46" rx="12" fill="none" stroke="#143d5c" stroke-width="13"/><rect x="33" y="29" width="58" height="46" rx="12" fill="none" stroke="#1f7fa0" stroke-width="13"/><rect x="59" y="51" width="58" height="46" rx="12" fill="none" stroke="#22b2cf" stroke-width="13"/></svg>`,
);

/** What a page's chrome is built with. */
export interface Chrome {
  /** Whether the logo, nav, strip and footer link to cascadeprotocol.org; off until the website answers at the addresses they name. */
  readonly website: boolean;
  /** The date the pages were built, `YYYY-MM-DD`, from the commit they are built from; none writes no date. */
  readonly built?: string;
  /** Whether `search.json` and `search.js` stand at the hub's root beside the pages, so a page that knows where the root is gets the search box. */
  readonly search?: boolean;
}

/** No link to the website and no build date. */
export const PLAIN: Chrome = { website: false };

const NAV: readonly (readonly [string, string])[] = [
  ["Understand", `${WEBSITE}/understand/`],
  ["Build", `${WEBSITE}/build/`],
  ["Standards", `${WEBSITE}/standards/`],
  ["Contribute", `${WEBSITE}/contribute/`],
  ["Reference ↗", `${HUB}/`],
];

/** The website's head links: its fonts. */
export const chromeHead = markup`<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet">
`;

const navLinks = (chrome: Chrome, current: boolean) =>
  NAV.map(([label, href]) =>
    href.startsWith(WEBSITE) && !chrome.website
      ? markup`<span>${label}</span>
`
      : markup`<a href="${href}"${current && href === `${HUB}/` ? new Html(' aria-current="page"') : ""}>${label}</a>
`,
  );

/** The box that searches the hub's terms, rules, decisions and pages: shown by `search.js` once it has loaded. */
const searchBox = (hubRoot: string) => markup`<div class="sx-find-wrap">
<form class="sx-find" role="search" data-rows="${hubRoot}search.json" hidden>
<label class="sx-find-label" for="sx-find-q">Search this reference</label>
<input id="sx-find-q" type="search" placeholder="Search terms, rules, decisions and pages" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="sx-find-list" aria-autocomplete="list">
<ul id="sx-find-list" role="listbox" aria-label="Results" hidden></ul>
</form>
</div>
`;

/** The website's strip and header, the hub being the nav's "Reference"; with `hubRoot` (the address of the hub's root from the page) and `chrome.search`, the search box under the bar. */
export function chromeHeader(chrome: Chrome, hubRoot?: string): Html {
  return markup`<div class="sx-strip">An open standard in progress, in alpha.${
    chrome.website &&
    markup` <a href="${WEBSITE}/community/status/">See what works today →</a> · <a href="${WEBSITE}/contribute/">Help shape it →</a>`
  }</div>
<header class="sx-header">
<div class="sx-bar">
${
  chrome.website
    ? markup`<a class="sx-logo" href="${WEBSITE}/">${MARK}<span>Cascade Protocol™</span></a>`
    : markup`<span class="sx-logo">${MARK}<span>Cascade Protocol™</span></span>`
}
<nav class="sx-nav" aria-label="Main">
${navLinks(chrome, true)}</nav>
<details class="sx-menu">
<summary>Menu</summary>
<nav aria-label="Main, phone">
${navLinks(chrome, false)}</nav>
</details>
</div>
${chrome.search === true && hubRoot !== undefined && searchBox(hubRoot)}</header>
`;
}

const column = (
  heading: string,
  links: readonly (readonly [string, string])[],
) =>
  markup`<div><h2>§ ${heading}</h2><ul>
${links.map(
  ([
    label,
    href,
  ]) => markup`<li><a href="${href.startsWith("https://") ? href : WEBSITE + href}">${label}</a></li>
`,
)}</ul></div>
`;

/** The website's footer; with no link to the website, its legal line alone. */
export function chromeFooter(chrome: Chrome): Html {
  return markup`<footer class="sx-footer">
<div class="sx-footer-wrap"><div class="sx-footer-inner">
${
  chrome.website &&
  markup`<div class="sx-footer-cols">
${column("Protocol", [
  ["Understand Cascade", "/understand/"],
  ["How it's built", "/how-its-built/"],
  ["How we know it works", "/how-we-know/"],
  ["Cascade in use", "/understand/apps/"],
  ["Security and privacy (previous version)", "/v0/docs/security/"],
  ["Compared with FHIR and others (previous version)", "/v0/docs/comparison/"],
])}${column("Build", [
    ["Start building", "/build/"],
    ["Guides, playground and reference (previous version)", "/v0/"],
  ])}${column("Community", [
    ["Help shape it", "/contribute/"],
    ["Become a partner", "/community/partners/"],
    ["Talk with us", "/community/"],
    ["Status", "/community/status/"],
    ["Build notes", "/blog/"],
    ["GitHub ↗", ORG],
  ])}<div><h2>§ Working toward a standard</h2>
<p>Cascade is an open standard in progress. We build on existing standards, extend them only where they stop, and we're looking for people to build it with us.</p>
<p><a href="${WEBSITE}/contribute/" style="color: var(--link)">Help shape it →</a></p>
</div>
</div>
`
}<div class="sx-footer-legal">
<span>Cascade Protocol™ is a trademark of Cascade Agentic Labs LLC. Spec CC BY 4.0 · code Apache 2.0.</span>
${
  chrome.website &&
  markup`<a href="${WEBSITE}/legal/trademarks.html">Trademark policy</a>
<a href="${WEBSITE}/legal/privacy.html">POTS Check privacy</a>
<a href="${WEBSITE}/legal/terms.html">POTS Check terms</a>
`
}</div>
${
  chrome.built !== undefined &&
  markup`<p class="sx-footer-built">Built on ${chrome.built}.</p>
`
}</div></div>
</footer>
`;
}

export interface Shell {
  readonly chrome: Chrome;
  /** The whole `<title>`. */
  readonly title: Content;
  /** The stylesheet's address from the page. */
  readonly stylesheet: string;
  /** More in the head, after the stylesheet. */
  readonly head?: Content;
  /** The hub's own links, under the header. */
  readonly nav?: Content;
  /** The body's class, for a page whose styles are scoped to it. */
  readonly bodyClass?: string;
  /** The address of the hub's root from this page, ending in `/`, where `search.json` and `search.js` stand; a page that gives none has no search box. */
  readonly hubRoot?: string;
  readonly main: Content;
  /** After the footer: a script. */
  readonly after?: Content;
}

/** The one frame of every hub page: skip link, the website's strip, header and footer, around the page's own nav and main. */
export function shell({
  chrome,
  title,
  stylesheet,
  head,
  nav,
  bodyClass,
  hubRoot,
  main,
  after,
}: Shell): Html {
  return markup`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${chromeHead}<link rel="stylesheet" href="${stylesheet}">
${head}${
    chrome.search === true &&
    hubRoot !== undefined &&
    markup`<script src="${hubRoot}search.js" defer></script>
`
  }</head>
<body${bodyClass === undefined ? "" : markup` class="${bodyClass}"`}>
<a class="b-skip" href="#main">Skip to content</a>
${chromeHeader(chrome, hubRoot)}${
    nav === undefined
      ? ""
      : markup`<nav class="hub-nav" aria-label="This site">
${nav}</nav>
`
  }<main id="main">
${main}</main>
${chromeFooter(chrome)}${after}</body>
</html>
`;
}

/** The chrome as strings for a page of another package, which has a palette of its own: tokens scoped to the header's and footer's wrappers. */
export function chromeStrings(chrome: Chrome): {
  readonly head: string;
  readonly header: string;
  readonly footer: string;
} {
  return {
    head: `${chromeHead.text}<style>${chromeStyles(".sx-scope")}</style>\n`,
    header: markup`<div class="sx-scope">
<a class="b-skip" href="#main">Skip to content</a>
${chromeHeader(chrome)}</div>
`.text,
    footer: markup`<div class="sx-scope">
${chromeFooter(chrome)}</div>
`.text,
  };
}
