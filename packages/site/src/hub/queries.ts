import {
  QUERIES_FOLDER,
  QUERIES_PAGE,
  queryPages,
  ROWS_OF,
} from "../query-pages.js";
import type { Section } from "../sections.js";
import type { PagesContext } from "./context.js";

/** A page for every query of the vocabulary under queries/, and an index of them by kind. */
export const queriesSection: Section<PagesContext> = {
  path: QUERIES_PAGE,
  title: "Queries",
  want: "model",
  source:
    "cascade-vocabulary's queries, and the rows of the example pod's answers",
  needsKits: true,
  async build(ctx) {
    return queryPages({
      vocabulary: (await ctx.vocabulary()).files,
      example: (await ctx.examples()).find(
        ({ folder }) => folder === ROWS_OF.folder,
      ),
      chrome: ctx.chrome,
    });
  },
  async rows() {
    return [
      {
        href: QUERIES_FOLDER,
        label: "Read a query",
        about:
          "every named question, view, matcher rule and derivation, what it is for, its SPARQL, the terms it reads and its rows on the example pod",
      },
    ];
  },
};
