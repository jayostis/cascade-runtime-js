import { type Html, markup } from "../html.js";
import { NAMESPACE_HOST, termHref } from "../links.js";
import { prefixed } from "../terms.js";

/** A word a package's tests use in one sense, as its `test/spec.json` defines it. */
export interface Entry {
  readonly term: string;
  readonly definition: string;
  /** The term's IRI in cascade-vocabulary. */
  readonly vocabulary?: string;
  /** Other forms of the term that link to the same entry: plurals, verbs. */
  readonly aliases: readonly string[];
  readonly id: string;
}

/** The terms page, from a repository's tests page. */
const TERMS = "../../../terms/";

const slug = (term: string): string =>
  term
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");

/** A `spec.json` glossary's entries; one that is not a term with a definition is left out. */
export function glossaryOf(raw: unknown, folder: string): Entry[] {
  if (!Array.isArray(raw)) return [];
  const entries: Entry[] = [];
  for (const one of raw as unknown[]) {
    const given = (
      typeof one === "object" && one !== null ? one : {}
    ) as Record<string, unknown>;
    const { term, definition, vocabulary, aliases } = given;
    if (typeof term !== "string" || typeof definition !== "string") continue;
    const id = `glossary-${folder}-${slug(term)}`;
    if (slug(term) === "" || entries.some((known) => known.id === id)) continue;
    entries.push({
      term,
      definition,
      ...(typeof vocabulary === "string" ? { vocabulary } : {}),
      aliases: Array.isArray(aliases)
        ? aliases.filter((a): a is string => typeof a === "string" && a !== "")
        : [],
      id,
    });
  }
  return entries;
}

/** A glossary entry as CTRF carries it: the spec's own fields, and the anchor its page gives it. */
export const ctrfEntry = (entry: Entry) => ({
  id: entry.id,
  term: entry.term,
  definition: entry.definition,
  ...(entry.vocabulary === undefined ? {} : { vocabulary: entry.vocabulary }),
  ...(entry.aliases.length === 0 ? {} : { aliases: [...entry.aliases] }),
});

/** A piece of text, as plain words or as a use of a glossary entry. */
export type Piece = string | { readonly text: string; readonly id: string };

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const capitalised = (word: string): boolean => /^\p{Lu}/u.test(word);

/**
 * Finds the first use of each entry in the texts it is given, one capability's worth: whole words, never inside a code
 * span. A word written with a capital, a verdict such as Same, matches only as written, so English "same" is no use of
 * it; any other matches in any case.
 */
export class Links {
  private readonly used = new Set<string>();
  private readonly pattern: RegExp | undefined;
  private readonly byWord = new Map<string, Entry>();
  private readonly asWritten = new Map<string, Entry>();

  constructor(entries: readonly Entry[]) {
    const words: string[] = [];
    for (const entry of entries)
      for (const word of [entry.term, ...entry.aliases]) {
        const map = capitalised(word) ? this.asWritten : this.byWord;
        const key = capitalised(word) ? word : word.toLowerCase();
        if (map.has(key)) continue;
        map.set(key, entry);
        words.push(word);
      }
    words.sort((a, b) => b.length - a.length);
    this.pattern =
      words.length === 0
        ? undefined
        : new RegExp(
            String.raw`(?<![\p{L}\p{N}_])(?:${words.map(escapeRegExp).join("|")})(?![\p{L}\p{N}_])`,
            "giu",
          );
  }

  /** `text` in pieces; each entry is a piece only the first time. */
  pieces(text: string): Piece[] {
    const pattern = this.pattern;
    if (pattern === undefined) return [text];
    const out: Piece[] = [];
    for (const [at, part] of text.split(/(`[^`]*`)/).entries()) {
      if (at % 2 === 1 || part === "") {
        if (part !== "") out.push(part);
        continue;
      }
      let from = 0;
      for (const found of part.matchAll(pattern)) {
        const entry =
          this.asWritten.get(found[0]) ??
          this.byWord.get(found[0].toLowerCase());
        if (entry === undefined || this.used.has(entry.id)) continue;
        this.used.add(entry.id);
        const start = found.index ?? 0;
        if (start > from) out.push(part.slice(from, start));
        out.push({ text: found[0], id: entry.id });
        from = start + found[0].length;
      }
      if (from < part.length) out.push(part.slice(from));
    }
    return out;
  }

  /** `text` with the first use of each entry linked to it. */
  link(text: string): Html {
    return markup`${this.pieces(text).map((piece) => (typeof piece === "string" ? piece : markup`<a href="#${piece.id}">${piece.text}</a>`))}`;
  }
}

/** The glossary as a definition list, open until the reader closes it. */
export function glossaryList(entries: readonly Entry[]): Html {
  return markup`<details class="glossary" open><summary>Glossary</summary>
<input type="search" class="glossary-filter" data-glossary-filter hidden placeholder="Filter the glossary" aria-label="Filter the glossary">
<dl>
${entries.map(
  ({
    term,
    definition,
    vocabulary,
    aliases,
    id,
  }) => markup`<dt id="${id}"><dfn>${term}</dfn>${aliases.length === 0 ? "" : markup` <span class="aliases">(${aliases.join(", ")})</span>`}</dt>
<dd>${definition}${vocabulary === undefined ? "" : vocabularyLink(vocabulary)}</dd>
`,
)}</dl>
<p class="none-match" hidden>No entry matches.</p></details>
`;
}

/** The term's entry on the terms page; the IRI itself where the site has no page for it, and no link where it does not resolve. */
function vocabularyLink(iri: string): Html {
  const name = prefixed(iri);
  const shown = markup`<code>${name ?? iri}</code>`;
  if (name !== undefined)
    return markup` <a class="vocabulary" href="${termHref(iri, TERMS)}">${shown}</a>`;
  return NAMESPACE_HOST.test(iri)
    ? markup` ${shown}`
    : markup` <a class="vocabulary" href="${iri}">${shown}</a>`;
}
