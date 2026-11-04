import { Marked } from "marked";
import { escape, Html } from "./html.js";

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WEB = /^(?:https?|mailto):/i;

/** A link that is relative or goes to the web or a mailbox; `javascript:` and `data:` are neither. */
function safe(href: string): boolean {
  const bare = [...href].filter((char) => char > " ").join("");
  return !SCHEME.test(bare) || WEB.test(bare);
}

/**
 * Raw HTML in a note is shown as text: only what the Markdown itself makes is a tag. A link or image whose scheme is not
 * http(s) or mailto, and is not relative, is shown as its text.
 */
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
  },
});

/** The one place a page renders Markdown (GFM). */
export function renderMarkdown(source: string): Html {
  return new Html(marked.parse(source, { async: false }));
}
