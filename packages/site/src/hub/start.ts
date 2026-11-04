import { START_PAGE, startPage } from "../front-page.js";
import type { Section } from "../sections.js";
import type { PagesContext } from "./context.js";

/** The quick start, which names one example's pod. */
export const startSection: Section<PagesContext> = {
  path: START_PAGE,
  title: "Quick start",
  kind: "build",
  source:
    "cascade-starter-kit's newest build and cascade-vocabulary's pod layout",
  needsKits: true,
  async build(ctx) {
    const start = await ctx.start();
    const shown = (await ctx.examples()).find(
      ({ folder }) => folder === start.example,
    );
    if (shown === undefined)
      throw new Error(`no example ${start.example} among the kits`);
    return new Map([
      [START_PAGE, new TextEncoder().encode(startPage(start, shown))],
    ]);
  },
  async rows() {
    return [{ href: START_PAGE, label: "Quick start" }];
  },
};
