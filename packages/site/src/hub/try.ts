import { redirectPage, STARTER_TRY, TRY_PAGE } from "../front-page.js";
import type { Section } from "../sections.js";
import type { PagesContext } from "./context.js";

/** try/'s old page, which sends a visitor on to the starter kit's; the row goes to the starter kit's page itself. */
export const trySection: Section<PagesContext> = {
  path: TRY_PAGE,
  title: "An app running in your browser",
  kind: "build",
  async build() {
    return new Map([[TRY_PAGE, new TextEncoder().encode(redirectPage())]]);
  },
  async rows() {
    return [
      {
        href: STARTER_TRY,
        label: "See an app running in your browser, nothing to install",
      },
    ];
  },
};
