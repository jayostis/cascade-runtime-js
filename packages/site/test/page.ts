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

function first(pattern: RegExp, text: string): string {
  return unescaped(pattern.exec(text)?.[1] ?? "");
}

function block(markup: string): Block {
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
                      hrefs: all(/href="([^"]*)"/g, cell),
                    },
                  ] as const,
                ],
          ),
        ),
    ),
    said: unescaped(markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")),
    hrefs: all(/href="([^"]*)"/g, markup),
  };
}

/** A page of the site as a reader sees it: its heading, its links and anchors, and each block on it. */
export function readPage(markup: string): Page {
  return {
    h1: first(/<h1>([\s\S]*?)<\/h1>/, markup),
    hrefs: all(/href="([^"]*)"/g, markup),
    ids: new Set(all(/\sid="([^"]*)"/g, markup)),
    blocks: markup
      .split('<section class="query"')
      .slice(1)
      .map((part) => block(part.split("</section>")[0] ?? "")),
  };
}
