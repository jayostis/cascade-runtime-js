import {
  type Bridge,
  BridgeError,
  type BridgeDocument,
  type Conversion,
  type ConvertOptions,
  type Description,
  type LoadedAdapter,
  type Named,
} from "./bridge.js";
import type { Files } from "./files.js";
import { documentName } from "./names.js";

/** Where a story's import step keeps what it read and what the Bridge made of it. */
export interface SavedOutput {
  /** The folder of the export, whose files are the documents, or the one file downloaded. */
  readonly export: string;
  /** The folder holding `<document's file stem>/graph.ttl` and `findings.ttl` for each document that is converted. */
  readonly converted: string;
}

function stemOf(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

/**
 * A Bridge that answers each conversion from the output a story saved for it. It accepts a document exactly when the
 * story saved output for it, because a story saves the output of every document the Bridge accepts, and it refuses to
 * convert one it holds no output for.
 */
export class SavedOutputBridge implements Bridge {
  private constructor(
    readonly files: Files,
    readonly converted: string,
    readonly stems: ReadonlyMap<string, string>,
  ) {}

  static async of(
    files: Files,
    saved: SavedOutput,
  ): Promise<SavedOutputBridge> {
    const stems = new Map<string, string>();
    const listed = await files.list(saved.export);
    for (const path of listed.length > 0 ? listed : [saved.export]) {
      const bytes = await files.read(path);
      if (bytes !== undefined)
        stems.set(await documentName(bytes), stemOf(path));
    }
    return new SavedOutputBridge(
      files,
      saved.converted.replace(/\/?$/, "/"),
      stems,
    );
  }

  describe(adapterIri: string): Promise<Description> {
    return Promise.resolve({
      graph: new Uint8Array(),
      iri: adapterIri,
      envelopes: [],
      loadFiles: ["ro-crate-metadata.json"],
      crateFiles: ["ro-crate-metadata.json"],
    });
  }

  load(_adapter: Named, _vocabulary?: Named): Promise<LoadedAdapter> {
    return Promise.resolve({
      accepts: async (document) => (await this.#graph(document)) !== undefined,
      convert: (document, options) => this.#convert(document, options),
      free: () => Promise.resolve(),
    });
  }

  async #graph(document: BridgeDocument): Promise<Uint8Array | undefined> {
    const stem = this.stems.get(await documentName(document.bytes));
    return stem === undefined
      ? undefined
      : this.files.read(`${this.converted}${stem}/graph.ttl`);
  }

  async #convert(
    document: BridgeDocument,
    options?: ConvertOptions,
  ): Promise<Conversion> {
    if (options?.format === "ntriples")
      throw new BridgeError("bridge", "the saved output is Turtle only");
    const stem = this.stems.get(await documentName(document.bytes));
    const graph = await this.#graph(document);
    if (stem === undefined || graph === undefined) {
      throw new BridgeError(
        "document",
        `the story saves no Bridge output for ${document.iri}`,
      );
    }
    const findings =
      (await this.files.read(`${this.converted}${stem}/findings.ttl`)) ??
      new Uint8Array();
    return { graph, findings };
  }
}
