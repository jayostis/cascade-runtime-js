import { Marked } from "marked";
import { escape, Html } from "./html.js";

/** Raw HTML in a note is shown as text: only what the Markdown itself makes is a tag. */
const marked = new Marked({
  gfm: true,
  renderer: { html: ({ text }) => escape(text) },
});

/** The one place a page renders Markdown (GFM). */
export function renderMarkdown(source: string): Html {
  return new Html(marked.parse(source, { async: false }));
}
