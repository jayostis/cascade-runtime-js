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

const NAV: readonly (readonly [string, string])[] = [
  ["Understand", `${WEBSITE}/understand/`],
  ["Build", `${WEBSITE}/build/`],
  ["Reference ↗", `${HUB}/`],
  ["Community", `${WEBSITE}/community/`],
  ["GitHub ↗", ORG],
];

/** The website's head links: its fonts. */
export const chromeHead = markup`<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet">
`;

/** The website's alpha strip and header, the hub being the nav's "Reference". */
export const chromeHeader = markup`<div class="sx-strip">Alpha · We're looking for development partners. <a href="${WEBSITE}/community/partners/">Build with us →</a></div>
<header class="sx-header">
<div class="sx-bar">
<a class="sx-logo" href="${WEBSITE}/">${MARK}<span>Cascade Protocol™</span></a>
<nav class="sx-nav" aria-label="Main">
${NAV.map(([label, href]) => markup`<a href="${href}"${href === `${HUB}/` ? new Html(' aria-current="page"') : ""}>${label}</a>\n`)}</nav>
<details class="sx-menu">
<summary>Menu</summary>
<nav aria-label="Main, phone">
${NAV.map(([label, href]) => markup`<a href="${href}">${label}</a>\n`)}</nav>
</details>
</div>
</header>
`;

const column = (
  heading: string,
  links: readonly (readonly [string, string])[],
) =>
  markup`<div><h2>§ ${heading}</h2><ul>
${links.map(([label, href]) => markup`<li><a href="${href.startsWith("https://") ? href : WEBSITE + href}">${label}</a></li>\n`)}</ul></div>
`;

/** The website's footer. */
export const chromeFooter = markup`<footer class="sx-footer">
<div class="sx-footer-wrap"><div class="sx-footer-inner">
<div class="sx-footer-cols">
${column("Protocol", [
  ["Understand Cascade", "/understand/"],
  ["How it's built", "/how-its-built/"],
  ["How we know it works", "/how-we-know/"],
  ["Cascade in use", "/understand/apps/"],
  ["Security and privacy (previous version)", "/v0/docs/security/"],
  ["Compared with FHIR and others (previous version)", "/v0/docs/comparison/"],
])}${column("Build", [
  ["Quick start", "/build/"],
  ["Guides, playground and reference (previous version)", "/v0/"],
])}${column("Community", [
  ["Become a partner", "/community/partners/"],
  ["Talk with Jed and Jay", "/community/"],
  ["Contribute", "/contribute/"],
  ["Status", "/community/status/"],
  ["Build notes", "/blog/"],
  ["GitHub ↗", ORG],
])}<div><h2>§ Alpha</h2>
<p>Cascade is early and changing. We're looking for development partners.</p>
<p><a href="${WEBSITE}/community/partners/" style="color: var(--link)">Build with us →</a></p>
</div>
</div>
<div class="sx-footer-legal">
<span>Cascade Protocol™ is a trademark of Cascade Agentic Labs LLC. Spec CC BY 4.0 · code Apache 2.0.</span>
<a href="${WEBSITE}/legal/trademarks.html">Trademark policy</a>
<a href="${WEBSITE}/legal/privacy.html">POTS Check privacy</a>
<a href="${WEBSITE}/legal/terms.html">POTS Check terms</a>
</div>
</div></div>
</footer>
`;

export interface Shell {
  /** The whole `<title>`. */
  readonly title: Content;
  /** The stylesheet's address from the page. */
  readonly stylesheet: string;
  /** More in the head, after the stylesheet. */
  readonly head?: Content;
  /** The hub's own links, under the header. */
  readonly nav?: Content;
  readonly main: Content;
  /** After the footer: a script. */
  readonly after?: Content;
}

/** The one frame of every hub page: skip link, the website's strip, header and footer, around the page's own nav and main. */
export function shell({
  title,
  stylesheet,
  head,
  nav,
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
<body>
<a class="b-skip" href="#main">Skip to content</a>
${chromeHeader}${
    nav === undefined
      ? ""
      : markup`<nav class="hub-nav" aria-label="This site">
${nav}</nav>
`
  }<main id="main">
${main}</main>
${chromeFooter}${after}</body>
</html>
`;
}

/** The chrome as strings for a page of another package, which has a palette of its own: tokens scoped to the header's and footer's wrappers. */
export function chromeStrings(): {
  readonly head: string;
  readonly header: string;
  readonly footer: string;
} {
  return {
    head: `${chromeHead.text}<style>${chromeStyles(".sx-scope")}</style>\n`,
    header: markup`<div class="sx-scope">
<a class="b-skip" href="#main">Skip to content</a>
${chromeHeader}</div>
`.text,
    footer: markup`<div class="sx-scope">
${chromeFooter}</div>
`.text,
  };
}
