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

/** Finds the documents in one kind of export; the runtime knows each by the name `cascade-runtime.json` gives it. */
export interface Importer {
  readonly name: string;
  /** Each document of the export in the folder, in the order they are filed, or undefined when it is no export of this kind. */
  documents(
    files: Pick<Files, "read" | "list">,
    folder: string,
  ): Promise<readonly ExportDocument[] | undefined>;
}
