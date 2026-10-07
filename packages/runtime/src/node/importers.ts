import { appleHealthExport } from "@cascade-runtime/apple-health";
import { ccdaDownload } from "@cascade-runtime/ccda-download";
import type { Importer } from "../importer.js";

const IMPORTERS: ReadonlyMap<string, Importer> = new Map(
  [appleHealthExport, ccdaDownload].map((importer) => [
    importer.name,
    importer,
  ]),
);

/** The importers by the names `cascade-runtime.json` gives them, in its order. */
export function importersNamed(names: readonly string[]): Importer[] {
  return names.map((name) => {
    const importer = IMPORTERS.get(name);
    if (importer === undefined)
      throw new Error(
        `cascade-runtime.json names the importer ${name}, and this runtime has none of that name`,
      );
    return importer;
  });
}
