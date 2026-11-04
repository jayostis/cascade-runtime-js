/** A cell of an answer: its term in N-Triples, and the links in it. */
export interface Cell {
  readonly value: string;
  readonly hrefs: readonly string[];
}

/** A block of a page: one query, with its rows by shown column. */
export interface Block {
  readonly id?: string;
  readonly title: string;
  readonly path: string;
  readonly text: string;
  readonly rows: readonly ReadonlyMap<string, Cell>[];
  /** The block's text, its tags left out. */
  readonly said: string;
  readonly hrefs: readonly string[];
}

export interface Page {
  readonly h1: string;
  /** The page's text, its tags left out. */
  readonly said: string;
  /** The text of each preformatted block, as it is. */
  readonly code: readonly string[];
  readonly hrefs: readonly string[];
  readonly ids: ReadonlySet<string>;
  readonly blocks: readonly Block[];
}

function unescaped(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#34;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function all(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].map((match) => unescaped(match[1] ?? ""));
}

/** Where the site sits on its server for {@link rooted}: one folder down, so a link may climb out of it. */
const SERVER = "https://site.example/";
const SITE = `${SERVER}site/`;

/** A page's local link as a path from the site's root, `../` before it when it climbs out; any other as written. */
function rooted(href: string, page: string | undefined): string {
  if (page === undefined || /^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  const { href: resolved } = new URL(href, SITE + page);
  return resolved.startsWith(SITE)
    ? resolved.slice(SITE.length)
    : `../${resolved.slice(SERVER.length)}`;
}

function links(markup: string, page: string | undefined): string[] {
  return all(/href="([^"]*)"/g, markup).map((href) => rooted(href, page));
}

function first(pattern: RegExp, text: string): string {
  return unescaped(pattern.exec(text)?.[1] ?? "");
}

function block(markup: string, page: string | undefined): Block {
  const id = /^ id="([^"]*)"/.exec(markup)?.[1];
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(markup)?.[1] ?? "";
  return {
    ...(id === undefined ? {} : { id }),
    title: first(/<h2>([\s\S]*?)<\/h2>/, markup),
    path: first(/<summary>The query: <code>([\s\S]*?)<\/code>/, markup),
    text: first(/<pre><code>([\s\S]*?)<\/code><\/pre>/, markup),
    rows: [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(
      ([, row]) =>
        new Map(
          [
            ...(row ?? "").matchAll(
              /<td data-label="\??([^"]*)">([\s\S]*?)<\/td>/g,
            ),
          ].flatMap(([, column, cell]) =>
            cell === undefined || cell === ""
              ? []
              : [
                  [
                    column ?? "",
                    {
                      value: first(/<data value="([^"]*)"/, cell),
                      hrefs: links(cell, page),
                    },
                  ] as const,
                ],
          ),
        ),
    ),
    said: said(markup),
    hrefs: links(markup, page),
  };
}

function said(markup: string): string {
  return unescaped(markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}

/**
 * A page of the site as a reader sees it: its heading, its links and anchors, and each block on it. Given the page's
 * path, its local links are read as paths from the site's root.
 */
export function readPage(markup: string, page?: string): Page {
  return {
    h1: first(/<h1>([\s\S]*?)<\/h1>/, markup),
    said: said(markup),
    code: all(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g, markup),
    hrefs: links(markup, page),
    ids: new Set(all(/\sid="([^"]*)"/g, markup)),
    blocks: markup
      .split('<section class="query"')
      .slice(1)
      .map((part) => block(part.split("</section>")[0] ?? "", page)),
  };
}
