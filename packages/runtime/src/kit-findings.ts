import { type AdaptersOf, EVERY_FINDING } from "./bridge.js";
import { featureStory } from "./conformance.js";
import type { Files } from "./files.js";
import { notIsomorphic, triples } from "./graphs.js";
import type { Importer } from "./importer.js";
import { kitImports } from "./kit-bridge.js";
import { kitsOf } from "./kit.js";
import { OxigraphStore } from "./oxigraph-store.js";
import { iri, type Triple } from "./rdf.js";

/** The name of the check a kit is held to beside those of `KIT_CHECKS`: its saved Bridge output is what the adapters make. */
export const KIT_FINDINGS_CHECK =
  "the-bridge-output-is-the-output-the-kit-saves";

/** What differs between the Bridge output each kit saves and what the configured adapters make of its imports. */
export interface KitFindings {
  /** One line for each import whose output differs from the kit's, with the kit's name first. */
  readonly differ: string[];
  readonly skipped: string[];
  readonly converted: number;
  readonly unaccepted: number;
  readonly acceptedUnaccepted: number;
}

/**
 * What differs, by kit, step and stem, between the Bridge output a kit saved for each document its importers find in
 * an import step's download and what the configured adapters make of it: the first to accept it converts it, and
 * where the kit saved that no adapter accepts it, none does.
 */
export async function kitFindings(options: {
  readonly vocabulary: Files;
  readonly importers: readonly Importer[];
  readonly adaptersOf: AdaptersOf;
}): Promise<KitFindings> {
  const { vocabulary: files, importers, adaptersOf } = options;
  const differ: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let converted = 0;
  let unaccepted = 0;
  let acceptedUnaccepted = 0;
  for (const kit of await kitsOf(files)) {
    const { person, steps } = await featureStory(
      files,
      `${kit}/${kit.slice(kit.lastIndexOf("/") + 1)}.feature`,
      () => new OxigraphStore(),
    );
    for (const {
      step,
      converted: saved,
      failure,
      documents,
    } of await kitImports({
      vocabulary: files,
      folder: person.folder,
      steps,
      importers,
      adaptersOf,
    })) {
      if (failure !== undefined) {
        const count = (await files.list(`${saved}/`)).length;
        if (count > 0)
          differ.push(
            `${kit} ${step.name}: its importer failed (${String(failure)}), but ${count} files are saved`,
          );
        else skipped.push(`${kit} ${step.name}`);
        continue;
      }
      const wanted = new Set(
        documents.flatMap(({ stem }) =>
          ["graph.ttl", "findings.ttl", "unaccepted.txt"].map(
            (name) => `${saved}/${stem}/${name}`,
          ),
        ),
      );
      for (const stray of await files.list(`${saved}/`))
        if (!wanted.has(stray))
          differ.push(
            `${kit} ${step.name}: ${stray} is saved, but no document of the import has such a file`,
          );
      for (const {
        stem,
        path: documentPath,
        iri: iriOf,
        offered,
        accepting,
      } of documents) {
        const at = `${saved}/${stem}/`;
        const named = `${kit} ${step.name} ${stem}`;
        const [graph, findings, refused] = await Promise.all([
          files.read(`${at}graph.ttl`),
          files.read(`${at}findings.ttl`),
          files.read(`${at}unaccepted.txt`),
        ]);
        const known = `${kit} ${iriOf}`;
        if (refused !== undefined) {
          seen.add(known);
          unaccepted++;
          if (accepting !== undefined) acceptedUnaccepted++;
          continue;
        }
        if (graph === undefined) {
          if (!seen.has(known))
            differ.push(`${named}: nothing is saved for it`);
          continue;
        }
        seen.add(known);
        converted++;
        if (accepting === undefined) {
          differ.push(`${named}: no adapter accepts it`);
          continue;
        }
        const made = await accepting.convert(offered, EVERY_FINDING);
        const path = `${files.iri}${documentPath}`;
        const expectedFindings =
          findings === undefined
            ? []
            : triples(findings, `${files.iri}${at}findings.ttl`).map(
                ([s, p, o]): Triple =>
                  o.termType === "NamedNode" && o.value === path
                    ? [s, p, iri(iriOf)]
                    : [s, p, o],
              );
        const why =
          notIsomorphic(triples(graph), triples(made.graph)) ??
          notIsomorphic(
            expectedFindings,
            triples(made.findings ?? new Uint8Array()),
          );
        if (why !== undefined) differ.push(`${named}: ${why}`);
      }
    }
  }
  return { differ, skipped, converted, unaccepted, acceptedUnaccepted };
}
