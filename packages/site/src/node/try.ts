import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { hospitalId } from "@cascade-runtime/demo-hospital";
import { loadHospitals } from "@cascade-runtime/demo-hospital/node";
import {
  PEOPLE,
  SIGNED_IN,
  signedInPage,
  SUMMARY,
  tryPage,
  VIEW_PACKAGES,
  WORKER,
  WORKER_DATA,
  WORKER_PAGE,
} from "../try-page.js";

const APP = fileURLToPath(new URL("../../../try/app.js", import.meta.url));
const RUNTIME_PACKAGE = fileURLToPath(
  new URL("../../../../cascade-runtime/package.json", import.meta.url),
);
const VIEW = fileURLToPath(
  new URL("../../../../cascade-runtime/starter/summary.mjs", import.meta.url),
);
const HERE = fileURLToPath(new URL(".", import.meta.url));
const SOURCE = fileURLToPath(
  new URL("../../../../demo-hospital/dist/src/", import.meta.url),
);
/** The page side of the demo hospitals: their worker's registration, and the rule that names a pull after its hospital. */
const PAGE_SIDE = `export { useDemoHospitals } from "./web/page.js";
export { hospitalId } from "./route.js";
`;

/**
 * The demo hospital's web code, `entry` or a module of the given contents, or a view package's browser build, bundled,
 * as a classic script or a module. A view package imports the others by name, as the import map serves them.
 */
async function bundled(
  entry: string | { contents: string } | { package: string },
  format: "iife" | "esm",
): Promise<Uint8Array> {
  const { outputFiles } = await build({
    ...(typeof entry === "string"
      ? { entryPoints: [join(SOURCE, "web", entry)] }
      : "package" in entry
        ? {
            entryPoints: [entry.package],
            absWorkingDir: HERE,
            external: Object.keys(VIEW_PACKAGES).filter(
              (name) => name !== entry.package,
            ),
          }
        : { stdin: { contents: entry.contents, resolveDir: SOURCE } }),
    bundle: true,
    format,
    platform: "browser",
    target: "es2023",
    write: false,
    logLevel: "warning",
  });
  const [output] = outputFiles;
  if (output === undefined)
    throw new Error(
      `esbuild built nothing of ${typeof entry === "string" ? entry : "package" in entry ? entry.package : "the page side"}`,
    );
  return output.contents;
}

/**
 * The files of `try/` but the package: the page, which offers the examples published in `samples` (their folders),
 * its app, the starter's view and the packages it imports, the demo people as the view names them, the redirect page, and the demo hospitals'
 * worker, its page side and one data file per hospital beside them. The page cannot read the data files itself: the
 * worker answers every address under them as a hospital's sign-in page. `version` is what the pages were built from.
 */
export async function tryFiles(
  samples: readonly string[],
  version: string,
): Promise<Map<string, Uint8Array>> {
  const encoder = new TextEncoder();
  const [
    hospitals,
    app,
    view,
    worker,
    workerPage,
    { demoPeople },
    runtime,
    packages,
  ] = await Promise.all([
    loadHospitals(),
    readFile(APP),
    readFile(VIEW),
    bundled("worker.js", "iife"),
    bundled({ contents: PAGE_SIDE }, "esm"),
    import(pathToFileURL(VIEW).href) as Promise<{
      demoPeople(demo: unknown): unknown;
    }>,
    readFile(RUNTIME_PACKAGE, "utf8").then(
      (text) => (JSON.parse(text) as { version: string }).version,
    ),
    Promise.all(
      Object.entries(VIEW_PACKAGES).map(
        async ([name, file]) =>
          [file, await bundled({ package: name }, "esm")] as const,
      ),
    ),
  ]);
  const files = new Map<string, Uint8Array>([
    ["index.html", encoder.encode(tryPage(samples, { version, runtime }))],
    ["app.js", app],
    [SUMMARY, view],
    [PEOPLE, encoder.encode(JSON.stringify(demoPeople(hospitals)))],
    [SIGNED_IN, encoder.encode(signedInPage())],
    [WORKER, worker],
    [WORKER_PAGE, workerPage],
    ...packages,
  ]);
  for (const loaded of hospitals)
    files.set(
      `${WORKER_DATA}${hospitalId(loaded)}.json`,
      encoder.encode(JSON.stringify(loaded)),
    );
  return files;
}
