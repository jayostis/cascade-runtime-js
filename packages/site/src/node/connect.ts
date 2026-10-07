import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { hospitalId } from "@cascade-runtime/demo-hospital";
import { loadHospitals } from "@cascade-runtime/demo-hospital/node";
import {
  connectPage,
  SIGNED_IN,
  signedInPage,
  WORKER,
  WORKER_DATA,
  WORKER_PAGE,
} from "../connect-page.js";

const APP = fileURLToPath(new URL("../../../connect/app.js", import.meta.url));
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
 * The files of `connect/`: the page, its app and redirect page, and the demo hospitals' worker, its page side and
 * one data file per hospital beside them.
 */
export async function connectFiles(): Promise<Map<string, Uint8Array>> {
  const encoder = new TextEncoder();
  const [hospitals, app, worker, workerPage] = await Promise.all([
    loadHospitals(),
    readFile(APP),
    bundled("worker.js", "iife"),
    bundled("page.js", "esm"),
  ]);
  const files = new Map<string, Uint8Array>([
    ["index.html", encoder.encode(connectPage())],
    ["app.js", app],
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
