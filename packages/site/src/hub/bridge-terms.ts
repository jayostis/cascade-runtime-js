import type { Section } from "../sections.js";
import {
  BRIDGE_SHAPES_PAGE,
  BRIDGE_TERMS_PAGE,
  bridgeTermPages,
  bridgeTermReference,
  bridgeTermShapes,
  queryFacts,
  TERMS_FOLDER,
} from "../term-reference.js";
import type { PagesContext } from "./context.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The Bridge's term reference at `terms/bridge.html` and a page for each of its terms, read from cascade-bridge-spec's vocabulary and shapes; a term the vocabulary's own term reference describes has no page here. */
export const bridgeTermsSection: Section<PagesContext> = {
  path: BRIDGE_TERMS_PAGE,
  title: "The Bridge's terms",
  want: "conformance",
  about:
    "the test types, verdicts, gap and accounting terms an adapter and an engine are judged by, each with the shapes that use it.",
  source: "cascade-bridge-spec's vocab/bridge.ttl and shapes/",
  async build(ctx) {
    const { files } = await ctx.bridgeSpec();
    const { terms } = await queryFacts((await ctx.vocabulary()).files);
    return new Map<string, Uint8Array>([
      [BRIDGE_TERMS_PAGE, encode(await bridgeTermReference(files, ctx.chrome))],
      [BRIDGE_SHAPES_PAGE, encode(await bridgeTermShapes(files, ctx.chrome))],
      ...[...(await bridgeTermPages(files, ctx.chrome, terms))].map(
        ([path, page]): [string, Uint8Array] => [
          `${TERMS_FOLDER}${path}`,
          encode(page),
        ],
      ),
    ]);
  },
  async rows() {
    return [
      {
        href: BRIDGE_TERMS_PAGE,
        label: "Look up a Bridge term",
        about:
          "how a case is judged: the test types, verdicts, gap and accounting terms of the Bridge's own namespace, and the shapes that use them",
      },
    ];
  },
};
