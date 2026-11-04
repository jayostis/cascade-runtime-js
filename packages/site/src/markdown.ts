import { Marked } from "marked";
import { escape, Html } from "./html.js";

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WEB = /^(?:https?|mailto):/i;

/** A link that is relative or goes to the web or a mailbox; `javascript:` and `data:` are neither. */
function safe(href: string): boolean {
  const bare = [...href].filter((char) => char > " ").join("");
  return !SCHEME.test(bare) || WEB.test(bare);
}

/** A heading of a rendered document. */
export interface Heading {
  readonly depth: number;
  /** The heading as HTML, its links left out. */
  readonly html: string;
  /** The `id` its element carries. */
  readonly id: string;
}

const TEXT_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#34;": '"',
  "&#39;": "'",
};

/** GitHub's slug of a heading's text: lower case, punctuation dropped, each space a hyphen. */
function slug(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#34|#39);/g, (it) => TEXT_ENTITIES[it] ?? it)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_ -]/gu, "")
    .replace(/ /g, "-");
}

/**
 * Raw HTML in a note is shown as text: only what the Markdown itself makes is a tag. A link or image whose scheme is not
 * http(s) or mailto, and is not relative, is shown as its text. With `ids`, each heading carries an `id` and is listed in
 * `headings`; a slug taken twice gets `-1`, `-2`, as GitHub does, skipping
 * any id already used; a heading with no letters or digits is `section`.
 */
function markdown(ids: boolean): { marked: Marked; headings: Heading[] } {
  const headings: Heading[] = [];
  const taken = new Map<string, number>();
  const used = new Set<string>();
  const marked = new Marked({
    gfm: true,
    renderer: {
      html: ({ text }) => escape(text),
      link(token) {
        return safe(token.href) ? false : this.parser.parseInline(token.tokens);
      },
      image(token) {
        return safe(token.href) ? false : escape(token.text);
      },
      ...(ids
        ? {
            heading(token) {
              const inner = this.parser.parseInline(token.tokens);
              const base = slug(inner) || "section";
              let seen = taken.get(base) ?? 0;
              let id = seen === 0 ? base : `${base}-${seen}`;
              while (used.has(id)) id = `${base}-${++seen}`;
              taken.set(base, seen + 1);
              used.add(id);
              headings.push({
                depth: token.depth,
                html: inner.replace(/<\/?a\b[^>]*>/g, ""),
                id,
              });
              return `<h${token.depth} id="${id}">${inner}</h${token.depth}>\n`;
            },
          }
        : {}),
    },
  });
  return { marked, headings };
}

/** The one place a page renders Markdown (GFM). `ids` gives each heading a GitHub-style `id`; nothing else changes. */
export function renderMarkdown(
  source: string,
  { ids = false }: { readonly ids?: boolean } = {},
): Html {
  return new Html(markdown(ids).marked.parse(source, { async: false }));
}

/** The same render with `ids`, and the headings it found, for a contents list. */
export function renderWithHeadings(source: string): {
  readonly html: Html;
  readonly headings: readonly Heading[];
} {
  const { marked, headings } = markdown(true);
  return { html: new Html(marked.parse(source, { async: false })), headings };
}
