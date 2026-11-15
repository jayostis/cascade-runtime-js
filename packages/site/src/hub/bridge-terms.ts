import type { Section } from "../sections.js";
import { BRIDGE_TERMS_PAGE, bridgeTermReference } from "../term-reference.js";
import type { PagesContext } from "./context.js";

/** The Bridge's term reference at `terms/bridge.html`, read from cascade-bridge-spec's vocabulary and shapes. */
export const bridgeTermsSection: Section<PagesContext> = {
  path: BRIDGE_TERMS_PAGE,
  title: "The Bridge's terms",
  want: "conformance",
  about:
    "the test types, verdicts, gap and accounting terms an adapter and an engine are judged by, each with the shapes that use it.",
  source: "cascade-bridge-spec's vocab/bridge.ttl and shapes/",
  async build(ctx) {
    const { files } = await ctx.bridgeSpec();
    const page = await bridgeTermReference(files, ctx.chrome);
    return new Map([[BRIDGE_TERMS_PAGE, new TextEncoder().encode(page)]]);
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
