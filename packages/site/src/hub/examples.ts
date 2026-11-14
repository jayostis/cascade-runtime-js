import { FILES_JSON, packFolder } from "@cascade-runtime/runtime";
import {
  EXAMPLES_PAGE,
  examplesPage,
  POD_ENTRY,
  POD_PACK,
  podOf,
} from "../front-page.js";
import { EXPLORER_FILE } from "../explorer.js";
import type { Section } from "../sections.js";
import { COPY } from "../terms.js";
import type { PagesContext } from "./context.js";

/** Each kit's site in the folder named after it, with its pod's files listed and packed beside it, and the page that lists them. */
export const examplesSection: Section<PagesContext> = {
  path: EXAMPLES_PAGE,
  title: "Example pods",
  want: "see",
  source:
    "cascade-vocabulary's conformance kits, replayed into pods by cascade-runtime-js",
  needsKits: true,
  async build(ctx) {
    const examples = await ctx.examples();
    const encoder = new TextEncoder();
    const files = new Map<string, Uint8Array>([
      [
        EXAMPLES_PAGE,
        encoder.encode(
          examplesPage(examples, await ctx.builtFrom(), ctx.chrome),
        ),
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
      ...(await ctx.examples()).flatMap(({ folder, title }) => [
        {
          href: `${folder}/index.html`,
          label: `Browse ${title}'s pod`,
          want: "pods" as const,
          about:
            "its records, its views, and every question with its SPARQL query.",
          also: {
            href: `${folder}/${COPY}${POD_ENTRY}`,
            label: "The pod's files",
          },
          audience: "people" as const,
        },
        {
          href: `${folder}/${EXPLORER_FILE}`,
          label: `${title}'s pod as data`,
          want: "pods" as const,
          about:
            "every file, query, act and view of the pod in one JSON object; the explorer page is a script that reads it.",
          audience: "agents" as const,
        },
        {
          href: `${folder}/layout.html`,
          label: `How ${title}'s pod is laid out`,
          want: "pods" as const,
          about:
            "the pod's folders and what each holds, on a page that reads without script.",
          audience: "agents" as const,
        },
      ]),
      {
        href: EXAMPLES_PAGE,
        label: "Every example pod, and what built these pages",
      },
    ];
  },
};
