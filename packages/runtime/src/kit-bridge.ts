import type { AdaptersOf, BridgeDocument, LoadedAdapter } from "./bridge.js";
import type { Files } from "./files.js";
import type { Importer } from "./importer.js";
import { documentName } from "./names.js";
import type { Step } from "./story.js";

/** A document an import step of a kit's story hands to the Bridge. */
export interface KitDocument {
  /** The name of the folder under the step's converted folder that holds its output. */
  readonly stem: string;
  /** Its path in the vocabulary, which the findings name it by when the Bridge's command line made them. */
  readonly path: string;
  /** Its N5 name. */
  readonly iri: string;
  /** The document as the runtime offers it to an adapter. */
  readonly offered: BridgeDocument;
  /** The first adapter of its media type that accepts it, if any. */
  readonly accepting: LoadedAdapter | undefined;
  /** Whether an earlier import step of the story handed the same document on. */
  readonly repeated: boolean;
}

/** One import step of a kit's story and the documents its importer found, or why it found none. */
export interface KitImport {
  readonly step: Step;
  /** Where the kit saves the step's output, in the vocabulary. */
  readonly converted: string;
  readonly failure?: unknown;
  readonly documents: readonly KitDocument[];
}

function stemOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * The documents each import step of a kit's story hands to the Bridge, as an import hands them: the first importer
 * that reads the download finds them, each is named by N5 and carries the facts its step's time gives, and the first
 * adapter of its media type that accepts it is the one to convert it.
 */
export async function kitImports(options: {
  readonly vocabulary: Pick<Files, "read" | "list">;
  /** The folder the story's steps name their files under. */
  readonly folder: string;
  readonly steps: readonly Step[];
  readonly importers: readonly Importer[];
  readonly adaptersOf: AdaptersOf;
}): Promise<KitImport[]> {
  const imports: KitImport[] = [];
  const seen = new Set<string>();
  for (const step of options.steps) {
    const { happened } = step;
    if (happened.kind !== "import") continue;
    const converted = `${options.folder}/${happened.converted}`;
    let found: Awaited<ReturnType<Importer["documents"]>>;
    try {
      for (const importer of options.importers)
        if (
          (found = await importer.documents(
            options.vocabulary,
            `${options.folder}/${happened.export}`,
          ))
        )
          break;
    } catch (failure) {
      imports.push({ step, converted, failure, documents: [] });
      continue;
    }
    const documents: KitDocument[] = [];
    for (const document of found ?? []) {
      const iri = await documentName(document.bytes);
      const offered: BridgeDocument = {
        iri,
        bytes: document.bytes,
        envelope: document.envelope,
        facts: { iri: `${iri}#facts`, bytes: document.facts(step.when) },
      };
      let accepting: LoadedAdapter | undefined;
      for (const adapter of options.adaptersOf(document.mediaType))
        if (await adapter.accepts(offered)) {
          accepting = adapter;
          break;
        }
      documents.push({
        stem: stemOf(document.path),
        path: document.path,
        iri,
        offered,
        accepting,
        repeated: seen.has(iri),
      });
    }
    for (const { iri } of documents) seen.add(iri);
    imports.push({ step, converted, documents });
  }
  return imports;
}
