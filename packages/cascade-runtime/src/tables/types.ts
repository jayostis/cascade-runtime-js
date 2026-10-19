import type {
  Files,
  References,
  StoreFactory,
  TableTerms,
  Triple,
} from "@cascade-runtime/runtime";
import type { RowsWork } from "../rows.js";
import type { VersionIndexes } from "./version-indexes.js";

/** A watcher's last check of a source, as the feed's `checked.json` gives it. */
export interface Watched {
  readonly at: string;
  /** `nothing new` or `new`. */
  readonly found: string;
}

export interface HeldVersion {
  readonly iri: string;
  /** The publisher's label for it. */
  readonly label?: string;
  readonly issued?: string;
}

/** A series the app holds, as a person reads of it. */
export interface HeldSeries {
  readonly iri: string;
  readonly label: string;
  readonly kind?: string;
  readonly licence?: string;
  readonly publisher?: string;
  /** The publisher's name, when the feed gives it. */
  readonly publisherName?: string;
  /** The credit its publisher asks for. */
  readonly credit?: string;
  /** The version a pod opened now is given. */
  readonly current: HeldVersion;
  /** Every version held, the current one first, then the newest. */
  readonly versions: readonly HeldVersion[];
  readonly feed?: string;
  /** When the feed last changed, as it says. */
  readonly modified?: string;
  /** When this app last read the feed. */
  readonly checked?: string;
  /** The watcher's last check of the series' source; none when the feed does not say. */
  readonly watched?: Watched;
  /** The source the feed says it is built from. */
  readonly source?: string;
}

/** A code as written, and what a names, status or product ingredients series says of it, from the first series in the order of preference that holds it. */
export interface About {
  /** The code as written, without its code system's IRI. */
  readonly notation: string;
  readonly name?: {
    readonly label: string;
    readonly altLabels: readonly string[];
    readonly origin: string;
  };
  readonly status?: {
    readonly deprecated: boolean;
    readonly replacedBy: readonly string[];
    readonly origin: string;
  };
  /**
   * The codes the code maps to in a product ingredients series. A combination maps to its MIN, so two products
   * share an ingredient here only when each maps to the same code, not when one holds the other's ingredient.
   */
  readonly ingredients?: {
    readonly codes: readonly string[];
    readonly origin: string;
  };
}

/** A code a search found in a series. */
export interface Found {
  readonly code: string;
  /** The code as written, without its code system's IRI. */
  readonly notation: string;
  readonly about?: About;
  /** In a mapping series, the codes the code maps to. */
  readonly mapsTo: readonly { code: string; notation: string; about?: About }[];
}

/** A code, as written, with what names and status say of it. */
export interface Coded {
  readonly code: string;
  readonly notation: string;
  readonly about?: About;
}

/** Codes, at most a page of them, and how many there are. */
export interface Codes {
  readonly total: number;
  readonly codes: readonly Coded[];
}

/** Where a fact about a code comes from: a held series and its version. */
export interface Fact {
  readonly series: string;
  readonly version: string;
}

/** Where a code stands in a panel, as the row that puts it there gives it. */
export interface Placed extends Coded {
  /** The `rec:panelSequence` of the row. */
  readonly sequence?: number;
  /** The `rec:observationRequiredInPanel` of the row: `R` for a member the panel requires. */
  readonly required?: string;
}

/** A class a drug is in, by the relation its row gives. */
export interface InClass {
  /** The row's predicate: `rec:establishedPharmacologicClass`, `rec:mechanismOfAction`, `rec:physiologicEffect` or `rec:chemicalStructure`. */
  readonly relation: string;
  readonly class: Coded;
  /** The code the class is on when it is not the code asked of: FDA classes the ingredient or a precise ingredient, not a product. */
  readonly through?: Coded;
}

/**
 * A relation a code has no class for, though the drug classes table classes a different form of its ingredient:
 * RxNorm does not tie the code to that form.
 */
export interface WithheldClass {
  readonly relation: string;
  /** The ingredient a different form of which is classed. */
  readonly ingredient: Coded;
}

/** Everything the held tables say of a code, each fact with its series and version. */
export interface Facts extends Coded {
  /** From each names series that names it, in the order of preference. */
  readonly names: readonly (Fact & {
    readonly label: string;
    readonly altLabels: readonly string[];
  })[];
  /** From each status series that holds it, in the order of preference. */
  readonly status: readonly (Fact & {
    readonly deprecated: boolean;
    readonly replacedBy: readonly Coded[];
  })[];
  /**
   * From each mapping series that maps it or maps to it: the codes it maps to, each with the other codes mapped to
   * that one, and the codes mapped to it.
   */
  readonly mappings: readonly (Fact & {
    readonly mapsTo: readonly (Coded & { readonly alongside: Codes })[];
    readonly mappedFrom: Codes;
  })[];
  /** From each variant classifications series whose current version holds it as a row's subject, in the order of preference. */
  readonly classifications: readonly (Fact & ClassificationRow)[];
  /**
   * From each panel members series whose current version holds it: the members the code has as a panel, by their
   * sequence, and the panels that have it as a member, by their codes, at most a page of them.
   */
  readonly panels: readonly (Fact & {
    readonly members: readonly Placed[];
    readonly heldBy: {
      readonly total: number;
      readonly panels: readonly Placed[];
    };
  })[];
  /**
   * From each drug classes series whose current version holds a row on the code, on its own precise ingredient or on
   * its ingredient, or on a different form of its ingredient: each class by its relation, and each relation the code has
   * no class for though a different form of its ingredient has one.
   */
  readonly classes: readonly (Fact & {
    readonly in: readonly InClass[];
    readonly withheld: readonly WithheldClass[];
  })[];
  /** The code's own page at its code system's publisher, from the vocabulary's page template; none when the code system has none. */
  readonly page?: { readonly href: string; readonly system: string };
}

/** A variant as a page asks about it: an entry's codes, as `pod/My genetic variants` gives them. */
export interface VariantAsked {
  /** `genomics:geneSymbol`. */
  readonly gene?: string;
  /** The `genomics:hgvsCDot` literals. */
  readonly hgvs: readonly string[];
  /** The `genomics:clinvarVariationId` literals. */
  readonly variations: readonly string[];
}

/** A concept and the words a person reads it by. */
export interface Concept {
  readonly iri: string;
  readonly label: string;
}

/** What a variant classifications row says of a variation. */
export interface ClassificationRow {
  /** The row's subject. */
  readonly variation: string;
  readonly classification: readonly Concept[];
  readonly reviewStatus?: Concept;
  /** An `xsd:date`. */
  readonly lastEvaluated?: string;
  readonly contributingSubmitters?: number;
  readonly submitters?: number;
}

/** What the app's current version of a held variant classifications series says of a variant. */
export type WhatClinVarSays =
  | { readonly found: "no series" }
  | {
      readonly found: "not covered";
      readonly series: string;
      readonly version: string;
      readonly genes: readonly string[];
    }
  | {
      readonly found: "not found";
      readonly series: string;
      readonly version: string;
    }
  | {
      readonly found: "rows";
      readonly series: string;
      readonly version: string;
      /** Exactly one row. */
      readonly rows: readonly ClassificationRow[];
    };

export interface Searched {
  /** The version searched, when one series is; none when the series is not held. */
  readonly version?: string;
  /** How many codes matched, of which `found` holds a page. */
  readonly total: number;
  /** How many matched codes come before the page. */
  readonly offset: number;
  /** How many codes a page holds. */
  readonly size: number;
  readonly found: readonly Found[];
}

/** What a check of one feed did. */
export interface Checked {
  readonly feed: string;
  /** The versions it kept. */
  readonly kept: readonly string[];
  /** Why the feed or a version could not be read now, to be tried later. */
  readonly later?: string;
  /** The versions that did not verify, which were not kept, each with why. */
  readonly refused: readonly { version: string; reason: string }[];
}

export interface TablesOptions {
  /** Where the versions are kept. */
  readonly files: Files;
  readonly feeds: readonly string[];
  /** The vocabulary, whose rule list every pod is given. */
  readonly vocabulary: Files;
  readonly newStore: StoreFactory;
  /** The package's starter copies: what an empty store starts from, and where a version it lacks is first read from. */
  readonly starter?: Files;
  readonly fetch?: typeof fetch;
  /** For each table kind's IRI, the series a person reads it from, first first. */
  readonly preference?: Readonly<Record<string, readonly string[]>>;
  /** The builders run locally, whose feeds are read after `feeds`. */
  readonly builds?: LocalBuilds;
  /** What reads a version's rows whole; in this thread, otherwise. */
  readonly work?: RowsWork;
}

/** Builders run on this machine, each writing a feed of its own. */
export interface LocalBuilds {
  /** Each builder's feed, in the order the builders are named. */
  readonly feeds: readonly string[];
  /** Runs every builder; what kept one from building, by its feed. */
  run(
    init: RequestInit,
  ): Promise<ReadonlyMap<string, Omit<Checked, "feed" | "kept">>>;
}

/** Rows of a version, for a query, with the descriptions of the version and its series. */
export interface Described {
  version: string;
  rows: Triple[];
  description: Triple[];
}

/** What the modules behind `Tables` read through: the one `Tables` that holds them. */
export interface TablesContext {
  readonly options: TablesOptions;
  readonly files: Files;
  references(): Promise<References>;
  terms(): Promise<TableTerms>;
  preferred(references: References, kind: string): string[];
  currentOf(
    references: References,
    kind: string,
    among?: readonly string[],
  ): Fact[];
  readonly indexes: VersionIndexes;
  about(codes: readonly string[]): Promise<Map<string, About>>;
  labels(concepts: readonly string[]): Promise<Map<string, string>>;
}
