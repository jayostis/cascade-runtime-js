import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { hospitalId } from "@cascade-runtime/demo-hospital";
import { loadHospitals } from "@cascade-runtime/demo-hospital/node";
import {
  SIGNED_IN,
  signedInPage,
  SUMMARY,
  tryPage,
  WORKER,
  WORKER_DATA,
  WORKER_PAGE,
} from "../try-page.js";

const APP = fileURLToPath(new URL("../../../try/app.js", import.meta.url));
const VIEW = fileURLToPath(
  new URL("../../../../cascade-runtime/starter/summary.mjs", import.meta.url),
);
const WEB = fileURLToPath(
  new URL("../../../../demo-hospital/dist/src/web/", import.meta.url),
);

/** One module of the demo hospital's web code, bundled, as a classic script or a module. */
async function bundled(
  entry: string,
  format: "iife" | "esm",
): Promise<Uint8Array> {
  const { outputFiles } = await build({
    entryPoints: [join(WEB, entry)],
    bundle: true,
    format,
    platform: "browser",
    target: "es2023",
    write: false,
    logLevel: "warning",
  });
  const [output] = outputFiles;
  if (output === undefined)
    throw new Error(`esbuild built nothing of ${entry}`);
  return output.contents;
}

/**
 * The files of `try/` but the package: the page, which offers the examples published in `samples` (their folders),
 * its app, the starter's view, the redirect page, and the demo hospitals' worker, its page side and one data file per
 * hospital beside them.
 */
export async function tryFiles(
  samples: readonly string[],
): Promise<Map<string, Uint8Array>> {
  const encoder = new TextEncoder();
  const [hospitals, app, view, worker, workerPage] = await Promise.all([
    loadHospitals(),
    readFile(APP),
    readFile(VIEW),
    bundled("worker.js", "iife"),
    bundled("page.js", "esm"),
  ]);
  const files = new Map<string, Uint8Array>([
    ["index.html", encoder.encode(tryPage(samples))],
    ["app.js", app],
    [SUMMARY, view],
    [SIGNED_IN, encoder.encode(signedInPage())],
    [WORKER, worker],
    [WORKER_PAGE, workerPage],
  ]);
  for (const loaded of hospitals)
    files.set(
      `${WORKER_DATA}${hospitalId(loaded)}.json`,
      encoder.encode(JSON.stringify(loaded)),
    );
  return files;
}
