/**
 * The Bridge, as cascade-bridge-spec's engine/library.md offers it: describe and load an adapter, ask a loaded adapter
 * whether it accepts a document, and convert one. The caller names every IRI (runtime/rules.md, N8). Every call is
 * asynchronous, because a live Bridge runs off the main thread.
 */

export type BridgeErrorKind =
  "document" | "facts" | "adapter" | "vocabulary" | "missing" | "bridge";

/**
 * What a failing call throws. After kind "bridge", that loaded adapter is thrown away and the adapter loaded again;
 * any other kind leaves it as it was. Findings are data, never failures.
 */
export class BridgeError extends Error {
  override readonly name = "BridgeError";

  constructor(
    readonly kind: BridgeErrorKind,
    message: string,
    readonly map?: "adapter" | "vocabulary",
    readonly path?: string,
  ) {
    super(message);
  }
}

/** Whether a thrown value is a Bridge failure, whether this class made it or the Bridge itself threw it. */
export function isBridgeError(
  error: unknown,
): error is Error & { readonly kind: BridgeErrorKind } {
  return (
    error instanceof Error &&
    error.name === "BridgeError" &&
    typeof (error as { kind?: unknown }).kind === "string"
  );
}

export type Format = "turtle" | "ntriples";

/** Files keyed by the paths the crate or a `bridge:vocabularyFile` writes, and the IRI those paths resolve against. */
export interface Named {
  readonly iri: string;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export interface Facts {
  readonly iri: string;
  readonly bytes: Uint8Array;
}

export interface BridgeDocument {
  readonly iri: string;
  readonly bytes: Uint8Array;
  readonly envelope?: string;
  readonly facts?: Facts;
}

export interface Description {
  readonly graph: Uint8Array;
  readonly iri: string;
  readonly identifier?: string;
  readonly version?: string;
  readonly sourceMediaType?: string;
  readonly envelopes: readonly string[];
  /** The paths a load needs. */
  readonly loadFiles: readonly string[];
  readonly crateFiles: readonly string[];
  readonly vocabulary?: {
    readonly repository?: string;
    readonly files: readonly string[];
  };
}

export interface ConvertOptions {
  readonly format?: Format;
}

export interface Conversion {
  readonly graph: Uint8Array;
  readonly findings: Uint8Array;
  /** Set when the adapter names vocabulary files and was loaded with none, so the graph went unvalidated. */
  readonly unvalidated?: string;
}

export interface LoadedAdapter {
  accepts(document: BridgeDocument): Promise<boolean>;
  convert(
    document: BridgeDocument,
    options?: ConvertOptions,
  ): Promise<Conversion>;
  /** Releases the loaded adapter; no call is made on it after. */
  free(): Promise<void>;
}

/** The loaded adapters a document of a media type is offered to, in the order `cascade-runtime.json` names them. */
export type AdaptersOf = (mediaType: string) => readonly LoadedAdapter[];

export interface Bridge {
  describe(
    adapterIri: string,
    metadata: Uint8Array,
    format?: Format,
  ): Promise<Description>;
  load(adapter: Named, vocabulary?: Named): Promise<LoadedAdapter>;
}
