import type { Section } from "../sections.js";
import { TERMS_PAGE } from "../term-reference.js";
import type { PagesContext } from "./context.js";

export const termsSection: Section<PagesContext> = {
  path: TERMS_PAGE,
  title: "Terms",
  kind: "build",
  async build() {
    return new Map([[TERMS_PAGE, new Uint8Array()]]);
  },
  async rows() {
    return [];
  },
};
