// The calibration page: calibration.md rendered as it stands, with calibration.json's figures as a table above it.
import { type Above } from "./site-compare.js";
import { hrefTo, page } from "./site-page.js";
import { dollars, esc, modelName, thousands } from "./site-text.js";

/** The parts of `calibration.json` the page reads. */
export interface Calibration {
  readonly date: string;
  readonly issue: string;
  readonly threshold: number;
  readonly reference: {
    readonly scorer: string;
    readonly answers: number;
    readonly items: number;
    readonly excludedItems: number;
    readonly description: string;
  };
  readonly judges: readonly {
    readonly model: string;
    readonly items: number;
    readonly agreed: number;
    readonly agreement: number;
    readonly kappa: number;
    readonly gapItems: number;
    readonly gapAgreed: number;
    readonly gapAgreement: number;
    readonly gapKappa: number;
    readonly usd: number;
    readonly tokens: number;
  }[];
}

const FILES =
  "https://github.com/jayostis/cascade-runtime-js/blob/main/packages/evals/";

/** A link written in the markdown: another file of the package goes to where it is kept. */
const where = (href: string) =>
  /^(https?:|#)/.test(href) ? href : `${FILES}${href}`;

const inline = (text: string) =>
  esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_, label: string, href: string) =>
        `<a href="${where(href)}">${label}</a>`,
    );

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/** The markdown of calibration.md: headings, paragraphs, bullets (a bullet may run over lines) and tables, with code, bold and links inside. */
export function markdown(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (line.trim() === "") i += 1;
    else if (heading !== null) {
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i += 1;
    } else if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith("|"))
        rows.push(cells(lines[i++]!));
      const [top = [], , ...rest] = rows;
      out.push(
        `<div class="hl"><table class="headline"><thead><tr>${top.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rest.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
      );
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("- ")) {
        let item = lines[i++]!.slice(2);
        while (
          i < lines.length &&
          lines[i]!.startsWith("  ") &&
          lines[i]!.trim() !== ""
        )
          item += ` ${lines[i++]!.trim()}`;
        items.push(item);
      }
      out.push(
        `<ul>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</ul>`,
      );
    } else {
      let para = line;
      i += 1;
      while (
        i < lines.length &&
        lines[i]!.trim() !== "" &&
        !/^(#|\||- )/.test(lines[i]!)
      )
        para += ` ${lines[i++]!.trim()}`;
      out.push(`<p>${inline(para)}</p>`);
    }
  }
  return out.join("\n");
}

const percent = (n: number) => `${(n * 100).toFixed(1)}%`;

export function calibrationPage(
  markdownText: string,
  figures: Calibration,
  above: Above,
): string {
  const from = "calibration.html";
  const { reference: ref } = figures;
  const rows = figures.judges
    .map(
      (j) =>
        `<tr data-judge="${esc(j.model)}"><td><b>${esc(modelName(j.model))}</b></td><td>${j.agreed} of ${j.items}</td><td>${percent(j.agreement)}</td><td>${j.kappa.toFixed(3)}</td><td>${j.gapAgreed} of ${j.gapItems}, kappa ${j.gapKappa.toFixed(3)}</td><td>${dollars(j.usd)}</td><td>${thousands(j.tokens)}</td></tr>`,
    )
    .join("");
  const body = `<p class="small muted">Cascade evals · <a href="${hrefTo(from, "index.html")}">the front page</a> · <a href="${hrefTo(from, "how_it_works.html")}">how the test works</a></p>
<h1>How far the judges are trusted</h1>
<p class="lead">Judges score every answer against the key. Before one was used it was checked against ${esc(modelName(ref.scorer))}'s own scoring of ${ref.answers} answers: ${ref.items} items where every scoring agreed, ${ref.excludedItems} left out where they split. Done on ${esc(figures.date)}; the standard is ${percent(figures.threshold)} agreement, on every item and on the gap items alone.</p>
<h2>The figures</h2>
<div class="hl"><table class="headline" data-table="calibration"><thead><tr><th>Judge</th><th>Items agreed</th><th>Agreement</th><th>Kappa</th><th>Gap items only</th><th>Cost, ${ref.answers} answers</th><th>Tokens</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="small muted">From <a href="${FILES}calibration.json">calibration.json</a>; the issue is <a href="${esc(figures.issue)}">${esc(figures.issue.replace(/^.*\/issues\//, "#"))}</a>. ${esc(ref.description)}</p>
${markdown(markdownText.replace(/^# .*\n/, ""))}`;
  return page({
    path: from,
    title: "How far the judges are trusted — Cascade evals",
    crumbs: [...above, ["Cascade evals", "index.html"], ["Judge calibration"]],
    body,
  });
}
