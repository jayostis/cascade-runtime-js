import type { Files } from "./files.js";

/** A document an importer found in an export. */
export interface ExportDocument {
  /** Its path within the files the export was read from. */
  readonly path: string;
  readonly bytes: Uint8Array;
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
  /** When it was received, an `xsd:dateTime` in UTC. */
  readonly received?: string;
}

/** Finds the documents in one kind of export; the runtime knows each by the name `cascade-runtime.json` gives it. */
export interface Importer {
  readonly name: string;
  /** Each document of the export in the folder, in the order they are filed, or undefined when it is no export of this kind. */
  documents(
    files: Pick<Files, "read" | "list">,
    folder: string,
  ): Promise<readonly ExportDocument[] | undefined>;
  /** What the export's index says of each document, reading no document, or undefined when it is no export of this kind. */
  index(
    files: Pick<Files, "read" | "list">,
    folder: string,
  ): Promise<readonly IndexEntry[] | undefined>;
}
