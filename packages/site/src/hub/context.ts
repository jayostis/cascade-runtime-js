import type { Files } from "@cascade-runtime/runtime";
import type { BuiltFrom, Example, Ingredient, Start } from "../front-page.js";
import type { SpecReport } from "../spec.js";

/** The vocabulary the pages are built from, named by the IRI of its tree. */
export interface VocabularyRead {
  readonly files: Files;
  /** The runtime and the vocabulary, at the commits the pages were built from. */
  readonly builtFrom: readonly Ingredient[];
  readonly at: string;
}

/** A conformance run's report, read; what a run wrote is empty when none was available. */
export interface Conformance {
  readonly report: SpecReport;
  /** The EARL report as the run wrote it. */
  readonly earl?: Uint8Array;
  /** The run's results rendered as a table, in Markdown. */
  readonly table?: Uint8Array;
}

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
  /** The vocabulary beside this checkout, which needs no kit. */
  vocabulary(): Promise<VocabularyRead>;
  /** The latest conformance run's report on main; empty when the build was given none, which shows every result as not run. */
  report(): Promise<Conformance>;
}
