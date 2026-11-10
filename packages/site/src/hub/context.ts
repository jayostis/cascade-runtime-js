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

/** One suite's newest run on main: its JUnit report, as the run wrote it, and which run it was. */
export interface TestRun {
  readonly report: string;
  readonly commit: string;
  /** When the run was made. */
  readonly at: string;
  /** The run's page. */
  readonly url: string;
  /** The `spec.json` the run's artifact held beside its report, as JSON. */
  readonly spec?: unknown;
}

/**
 * One repository's tests as `packages/site/test-suites.json` lists them: where the deploy finds its newest report, and
 * what wrote it. The page of each is `conformance/tests/<repository's name>/`.
 */
export interface Suite {
  /** `owner/name` on GitHub. */
  readonly repository: string;
  readonly title: string;
  readonly about: string;
  /** The workflow file whose push and nightly runs on main upload the report. */
  readonly workflow: string;
  readonly artifact: string;
  /** The report's file in the artifact. */
  readonly report: string;
  readonly runner: "node:test" | "pytest" | "vitest" | "nextest";
}

/** A suite and its newest run; the run is absent when the build was given none, or when it could not be fetched. */
export interface SuiteRun {
  readonly suite: Suite;
  readonly run?: TestRun;
}

/**
 * One adapter at the head of its default branch, or why there is none to read. The files are named by the adapter's tree
 * on GitHub at the commit, so a path under them is also that file's address there.
 */
export interface AdapterRead {
  /** The adapter's repository, as an address. */
  readonly repository: string;
  readonly files?: Files;
  readonly commit?: string;
  /** Why the adapter could not be read; the pages list it as not available. */
  readonly unavailable?: string;
}

/**
 * What a section of the hub's Pages tree is built from. The providers do their work on the first call and give the same
 * answer after, so a section that needs the kits asks and one that does not never pays for them.
 */
export interface PagesContext {
  /** The checkout the pages are built in. */
  readonly root: string;
  readonly log: (line: string) => void;
  /** The address the pages will be served at, ending in `/`; when unset, `llms.txt` links relative to itself. */
  readonly base?: string;
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
  /** Each listed suite, with its newest run on main. */
  tests(): Promise<readonly SuiteRun[]>;
  /** Each adapter the runtime follows, at the head of its default branch; one that could not be got is not fatal. */
  adapters(): Promise<readonly AdapterRead[]>;
}
