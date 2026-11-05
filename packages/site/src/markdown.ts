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

/** A column a page adds to a table it knows, and an `id` for each of its rows. */
export interface TableAddition {
  readonly heading: string;
  /** Each body row's `id`, or none; a row beyond the list has none. */
  readonly ids: readonly (string | undefined)[];
  /** Each body row's cell in the new column. */
  readonly cells: readonly Html[];
}

export interface MarkdownOptions {
  /** Each heading carries a GitHub-style `id`. */
  readonly ids?: boolean;
  /**
   * Where a link goes, given what the source wrote; undefined shows the link's text alone. A link to a place in the
   * document (`#why`) is left as written.
   */
  readonly link?: (href: string) => string | undefined;
  /**
   * Called once per table with its header cells, its body rows' first cells, as written, and the text of the `##` heading
   * above it (none above the first); adds a column to it.
   */
  readonly table?: (
    header: readonly string[],
    firstCells: readonly string[],
    section: string,
  ) => TableAddition | undefined;
  /** Ids no heading takes, for a page that gives them to something else. */
  readonly reserved?: readonly string[];
}

/**
 * Raw HTML in a note is shown as text: only what the Markdown itself makes is a tag. A link or image whose scheme is not
 * http(s) or mailto, and is not relative, is shown as its text. With `ids`, each heading carries an `id` and is listed in
 * `headings`; a slug taken twice gets `-1`, `-2`, as GitHub does, skipping
 * any id already used; a heading with no letters or digits is `section`.
 */
function markdown({
  ids = false,
  link,
  table,
  reserved = [],
}: MarkdownOptions): {
  marked: Marked;
  headings: Heading[];
} {
  const headings: Heading[] = [];
  const taken = new Map<string, number>();
  const used = new Set<string>(reserved);
  let section = "";
  const marked = new Marked({
    gfm: true,
    renderer: {
      html: ({ text }) => escape(text),
      link(token) {
        if (!safe(token.href)) return this.parser.parseInline(token.tokens);
        if (link === undefined || token.href.startsWith("#")) return false;
        const to = link(token.href);
        if (to === undefined) return this.parser.parseInline(token.tokens);
        token.href = to;
        return false;
      },
      ...(table === undefined
        ? {}
        : {
            table(token) {
              const added = table(
                token.header.map(({ text }) => text),
                token.rows.map(([first]) => first?.text ?? ""),
                section,
              );
              if (added === undefined) return false;
              const cells = (row: typeof token.header): string =>
                row.map((cell) => this.tablecell(cell)).join("");
              const body = token.rows
                .map((row, at) => {
                  const id = added.ids[at];
                  return `<tr${id === undefined ? "" : ` id="${escape(id)}"`}>\n${cells(row)}<td>${added.cells[at]?.text ?? ""}</td>\n</tr>\n`;
                })
                .join("");
              return `<table>\n<thead>\n<tr>\n${cells(token.header)}<th>${escape(added.heading)}</th>\n</tr>\n</thead>\n<tbody>\n${body}</tbody>\n</table>\n`;
            },
          }),
      image(token) {
        return safe(token.href) ? false : escape(token.text);
      },
      ...(ids
        ? {
            heading(token) {
              const inner = this.parser.parseInline(token.tokens);
              if (token.depth === 2) section = token.text.trim();
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

/** The one place a page renders Markdown (GFM). `ids` gives each heading a GitHub-style `id`; `link` and `table` are for a page that knows its source. */
export function renderMarkdown(
  source: string,
  options: MarkdownOptions = {},
): Html {
  return new Html(markdown(options).marked.parse(source, { async: false }));
}

/** The same render with `ids`, and the headings it found, for a contents list. */
export function renderWithHeadings(
  source: string,
  options: Omit<MarkdownOptions, "ids"> = {},
): {
  readonly html: Html;
  readonly headings: readonly Heading[];
} {
  const { marked, headings } = markdown({ ...options, ids: true });
  return { html: new Html(marked.parse(source, { async: false })), headings };
}
