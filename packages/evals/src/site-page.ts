// A page's frame: the crumbs, the theme button, the stylesheet and script, and the footer; and a link from one page of
// the site to another by their paths.
import { posix } from "node:path";
import { SCRIPT, STYLE } from "./site-style.js";
import { esc } from "./site-text.js";

/** The link from the page at `from` to the page at `to`, both paths from the site's root. */
export const hrefTo = (from: string, to: string) => {
  const [file, hash] = to.split("#") as [string, string?];
  const rel = posix.relative(posix.dirname(from), file);
  return `${rel === "" ? posix.basename(file) : rel}${hash === undefined ? "" : `#${hash}`}`;
};

export interface Frame {
  readonly path: string;
  readonly title: string;
  /** Each crumb with the path it opens; the last has none. */
  readonly crumbs: readonly (readonly [string, string?])[];
  readonly body: string;
  /** A page made for paper has no theme button or footer. */
  readonly print?: boolean;
}

export function page(frame: Frame): string {
  const crumbs = frame.crumbs
    .map(([label, to]) =>
      to === undefined
        ? `<span style="margin:0">${esc(label)}</span>`
        : `<a href="${hrefTo(frame.path, to)}">${esc(label)}</a><span>›</span>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(frame.title)}</title><style>${STYLE}</style></head>
<body${frame.print === true ? ` class="printpage"` : ""}><main>
<div class="top"><div class="crumbs">${crumbs}</div><button id="theme" type="button">Dark</button></div>
${frame.body}
<div class="foot">Generated from results.json and the case files by <code>npm run evals:report</code>; never edited by hand. <a href="${hrefTo(frame.path, "how_it_works.html")}">How the test works</a>.</div>
</main><script>${SCRIPT}</script></body></html>`;
}
