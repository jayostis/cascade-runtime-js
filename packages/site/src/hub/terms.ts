import type { Section } from "../sections.js";
import { TERMS_FOLDER, TERMS_PAGE, termReference } from "../term-reference.js";
import type { PagesContext } from "./context.js";

/** The term reference under terms/, read from the vocabulary the pages are built from. */
export const termsSection: Section<PagesContext> = {
  path: TERMS_PAGE,
  title: "Terms",
  want: "model",
  source: "cascade-vocabulary's ontologies, shapes, queries and runtime rules",
  async build(ctx) {
    const page = await termReference((await ctx.vocabulary()).files);
    return new Map([[TERMS_PAGE, new TextEncoder().encode(page)]]);
  },
  async rows() {
    return [
      {
        href: TERMS_FOLDER,
        label: "Look up a term",
        about:
          "every class and property a pod carries, the shape that checks it, and the queries and rules that use it",
      },
    ];
  },
};
