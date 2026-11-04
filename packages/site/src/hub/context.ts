import type { Files } from "@cascade-runtime/runtime";
import type { BuiltFrom, Example, Start } from "../front-page.js";

/**
 * What a section of the hub's Pages tree is built from. The providers do their work on the first call and give the same
 * answer after, so a section that needs the kits asks and one that does not never pays for them.
 */
export interface PagesContext {
  /** The checkout the pages are built in. */
  readonly root: string;
  readonly log: (line: string) => void;
  /** Every kit's pod and site, built. */
  examples(): Promise<readonly Example[]>;
  /** What the pages were built from, for the examples page's footer. */
  builtFrom(): Promise<BuiltFrom>;
  /** What the quick start gives a newcomer. */
  start(): Promise<Start>;
  /** The vocabulary the pages are built from, named by the IRI of its tree at the commit read. */
  vocabulary(): Promise<Files>;
}
