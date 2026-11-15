// The calibration page: calibration.md, rendered as it stands by the renderer the host gives.
import { type Above } from "./site-compare.js";
import { hrefTo, page } from "./site-page.js";
import { esc } from "./site-text.js";

/** Renders Markdown to HTML; `link` says where a link written in the source goes, or undefined to show its text alone. */
export type RenderMarkdown = (
  source: string,
  link: (href: string) => string | undefined,
) => string;

const FILES =
  "https://github.com/jayostis/cascade-runtime-js/blob/main/packages/evals/";

/** A link written in the markdown: another file of the package goes to where it is kept. */
const where = (href: string) =>
  /^(https?:|mailto:)/.test(href) ? href : `${FILES}${href}`;

export function calibrationPage(
  markdown: string,
  above: Above,
  render?: RenderMarkdown,
): string {
  const from = "calibration.html";
  const source = markdown.replace(/^# .*\r?\n/, "");
  const body = `<p class="small muted">Cascade evals · <a href="${hrefTo(from, "index.html")}">the front page</a> · <a href="${hrefTo(from, "how_it_works.html")}">how the test works</a></p>
<h1>How far the judges are trusted</h1>
<p class="lead">Judges score every answer against the key. Before one was used it was checked against a reference scoring of answers already scored by hand; this is the record of that check, as the package keeps it.</p>
${render === undefined ? `<pre>${esc(source)}</pre>` : render(source, where)}`;
  return page({
    path: from,
    title: "How far the judges are trusted — Cascade evals",
    crumbs: [...above, ["Cascade evals", "index.html"], ["Judge calibration"]],
    body,
  });
}
