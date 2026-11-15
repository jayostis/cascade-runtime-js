import { readText } from "@cascade-runtime/runtime";
import type { Section } from "../sections.js";
import {
  TERM_FILES,
  TERMS_FOLDER,
  TERMS_JSON,
  TERMS_PAGE,
  termPages,
  termReference,
  termsJson,
} from "../term-reference.js";
import type { PagesContext } from "./context.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The term reference under terms/: its index, a page for each term, `terms.json` and the vocabulary's two files, read from the vocabulary the pages are built from. */
export const termsSection: Section<PagesContext> = {
  path: TERMS_PAGE,
  title: "Terms",
  want: "model",
  source: "cascade-vocabulary's ontologies, shapes, queries and runtime rules",
  async build(ctx) {
    const { files } = await ctx.vocabulary();
    return new Map<string, Uint8Array>([
      [TERMS_PAGE, encode(await termReference(files, ctx.chrome))],
      ...[...(await termPages(files, ctx.chrome))].map(
        ([path, page]): [string, Uint8Array] => [
          `${TERMS_FOLDER}${path}`,
          encode(page),
        ],
      ),
      [TERMS_JSON, encode(await termsJson(files))],
      ...(await Promise.all(
        TERM_FILES.map(async ([name, path]): Promise<[string, Uint8Array]> => [
          `${TERMS_FOLDER}${name}`,
          encode(await readText(files, path)),
        ]),
      )),
    ]);
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
