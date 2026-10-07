import type { Files } from "./files.js";

/** A document an importer found in an export or a download. */
export interface ExportDocument {
  /** Its path within the files the export was read from. */
  readonly path: string;
  readonly bytes: Uint8Array;
  /** What it is, offered only to the adapters whose `bridge:sourceMediaType` is the same. */
  readonly mediaType: string;
  readonly envelope?: string;
  /**
   * What the export says of the document and of its import, as Turtle about `bridge:thisDocument` and
   * `bridge:thisImport`, for the Bridge to state.
   */
  facts(importStarted: string): Uint8Array;
}

/** What an export's own index says of one of its documents, as far as it says it. */
export interface IndexEntry {
  /** The name of the source the document came from. */
  readonly source?: string;
  /** That source's server base URL, as the importer states `bridge:serverBaseUrl` in the document's facts. */
  readonly server?: string;
  /** The kind of record, as the word `rec:kind` gives it. */
  readonly kind?: string;
  /** The title of the section of the document it is an entry of, where the export has sections. */
  readonly section?: string;
  /** When it was received, an `xsd:dateTime` in UTC, or the `xsd:date` alone where the export gives no offset. */
  readonly received?: string;
}

/**
 * Finds the documents in one kind of export, a folder or a downloaded file; the runtime knows each by the name
 * `cascade-runtime.json` gives it.
 */
export interface Importer {
  readonly name: string;
  /** Each document of the export at the path, in the order they are filed, or undefined when it is no export of this kind. */
  documents(
    files: Pick<Files, "read" | "list">,
    folder: string,
  ): Promise<readonly ExportDocument[] | undefined>;
  /**
   * What the export's index says of each document, reading no document where the export has an index of its own, or
   * undefined when it is no export of this kind.
   */
  index(
    files: Pick<Files, "read" | "list">,
    folder: string,
  ): Promise<readonly IndexEntry[] | undefined>;
}
