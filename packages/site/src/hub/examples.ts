import { FILES_JSON, packFolder } from "@cascade-runtime/runtime";
import {
  EXAMPLES_PAGE,
  examplesPage,
  POD_ENTRY,
  POD_PACK,
  podOf,
} from "../front-page.js";
import type { Section } from "../sections.js";
import { COPY } from "../terms.js";
import type { PagesContext } from "./context.js";

/** Each kit's site in the folder named after it, with its pod's files listed and packed beside it, and the page that lists them. */
export const examplesSection: Section<PagesContext> = {
  path: EXAMPLES_PAGE,
  title: "Example pods",
  kind: "explore",
  source:
    "cascade-vocabulary's conformance kits, replayed into pods by cascade-runtime-js",
  needsKits: true,
  async build(ctx) {
    const examples = await ctx.examples();
    const encoder = new TextEncoder();
    const files = new Map<string, Uint8Array>([
      [
        EXAMPLES_PAGE,
        encoder.encode(examplesPage(examples, await ctx.builtFrom())),
      ],
    ]);
    for (const { folder, site } of examples) {
      for (const [path, bytes] of site) files.set(`${folder}/${path}`, bytes);
      const pod = podOf(site);
      const paths = [...pod.keys()];
      files.set(
        `${folder}/${COPY}${FILES_JSON}`,
        encoder.encode(`${JSON.stringify(paths, null, 2)}\n`),
      );
      files.set(
        `${folder}/${POD_PACK}`,
        encoder.encode(JSON.stringify(packFolder(paths, pod))),
      );
    }
    return files;
  },
  async rows(ctx) {
    return [
      ...(await ctx.examples()).map(({ folder, title }) => ({
        href: `${folder}/index.html`,
        label: `Browse ${title}'s pod`,
        about:
          "its records, its views, and every question with its SPARQL query.",
        also: {
          href: `${folder}/${COPY}${POD_ENTRY}`,
          label: "The pod's files",
        },
      })),
      {
        href: EXAMPLES_PAGE,
        label: "Every example pod, and what built these pages",
      },
    ];
  },
};
