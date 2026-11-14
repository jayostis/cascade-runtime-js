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

const HUB = "https://jayostis.github.io/cascade-runtime-js";

const FONTS =
  "https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap";

const MARK = new Html(
  `<svg width="30" height="25" viewBox="0 0 124 104" aria-hidden="true"><rect x="7" y="7" width="58" height="46" rx="12" fill="none" stroke="#143d5c" stroke-width="13"/><rect x="33" y="29" width="58" height="46" rx="12" fill="none" stroke="#1f7fa0" stroke-width="13"/><rect x="59" y="51" width="58" height="46" rx="12" fill="none" stroke="#22b2cf" stroke-width="13"/></svg>`,
);

/** What a page's chrome is built with. */
export interface Chrome {
  /** The website's address, with no trailing slash, that the logo, nav, strip and footer link under; none links no page of the website. */
  readonly website?: string;
  /** The date the pages were built, `YYYY-MM-DD`, from the commit they are built from; none writes no date. */
  readonly built?: string;
}

/** No link to the website and no build date. */
export const PLAIN: Chrome = {};

/** A website page's path, or the hub's address, per nav item. */
const NAV: readonly (readonly [string, string | null])[] = [
  ["Understand", "/understand/"],
  ["Build", "/build/"],
  ["Contribute", "/contribute/"],
  ["Reference ↗", null],
];

/** The website's head links: its fonts. */
export const chromeHead = markup`<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet">
`;

const navLinks = (chrome: Chrome, current: boolean) =>
  NAV.map(([label, path]) =>
    path !== null && chrome.website === undefined
      ? markup`<span>${label}</span>
`
      : markup`<a href="${path === null ? `${HUB}/` : chrome.website + path}"${current && path === null ? new Html(' aria-current="page"') : ""}>${label}</a>
`,
  );

/** The website's strip and header, the hub being the nav's "Reference". */
export function chromeHeader(chrome: Chrome): Html {
  const { website } = chrome;
  return markup`<div class="sx-strip">An open standard in progress, in alpha.${
    website !== undefined &&
    markup` <a href="${website}/community/status/">See what works today →</a> · <a href="${website}/contribute/">Help shape it →</a>`
  }</div>
<header class="sx-header">
<div class="sx-bar">
${
  website !== undefined
    ? markup`<a class="sx-logo" href="${website}/">${MARK}<span>Cascade Protocol™</span></a>`
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
</header>
`;
}

const column = (
  website: string,
  heading: string,
  links: readonly (readonly [string, string])[],
) =>
  markup`<div><h2>§ ${heading}</h2><ul>
${links.map(
  ([label, path]) => markup`<li><a href="${website + path}">${label}</a></li>
`,
)}</ul></div>
`;

/** The website's footer; with no link to the website, its legal line alone. */
export function chromeFooter(chrome: Chrome): Html {
  const { website } = chrome;
  return markup`<footer class="sx-footer">
<div class="sx-footer-wrap"><div class="sx-footer-inner">
${
  website !== undefined &&
  markup`<div class="sx-footer-cols">
${column(website, "Protocol", [
  ["Understand Cascade", "/understand/"],
  ["How it's built", "/how-its-built/"],
  ["How we know it works", "/community/status/"],
  ["Cascade in use", "/understand/apps/"],
])}${column(website, "Build", [
    ["Start building", "/build/"],
    ["Previous version", "/v0/"],
  ])}${column(website, "Community", [
    ["Help shape it", "/contribute/"],
    ["Become a partner", "/community/partners/"],
    ["Talk with us", "/community/"],
    ["Status", "/community/status/"],
    ["Build notes", "/blog/"],
    ["GitHub", "/contribute/#repos"],
  ])}<div><h2>§ Working toward a standard</h2>
<p>Cascade is an open standard in progress. We build on existing standards, extend them only where they stop, and we're looking for people to build it with us.</p>
<p><a href="${website}/contribute/" style="color: var(--link)">Help shape it →</a></p>
</div>
</div>
`
}<div class="sx-footer-legal">
<span>Cascade Protocol™ is a trademark of Cascade Agentic Labs LLC. Spec CC BY 4.0 · code Apache 2.0.</span>
${
  website !== undefined &&
  markup`<a href="${website}/legal/trademarks.html">Trademark policy</a>
<a href="${website}/legal/privacy.html">POTS Check privacy</a>
<a href="${website}/legal/terms.html">POTS Check terms</a>
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
${head}</head>
<body${bodyClass === undefined ? "" : markup` class="${bodyClass}"`}>
<a class="b-skip" href="#main">Skip to content</a>
${chromeHeader(chrome)}${
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
