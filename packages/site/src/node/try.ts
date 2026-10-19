import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { brandsBundle, hospitalId } from "@the-cascade-protocol/sandbox";
import { loadHospitals } from "@the-cascade-protocol/sandbox/node";
import type { Pod, Tables } from "cascade-runtime/published";
import {
  BRANDS,
  BROWSER_HOST,
  PEOPLE,
  POD_API,
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
const HOST = fileURLToPath(
  new URL("../../../try/browser-host.js", import.meta.url),
);
const RUNTIME_PACKAGE = fileURLToPath(
  new URL("../../../../cascade-runtime/package.json", import.meta.url),
);
const VIEW = fileURLToPath(
  new URL("../../../../cascade-runtime/starter/summary.mjs", import.meta.url),
);
const API = fileURLToPath(
  new URL("../../../../cascade-runtime/starter/pod-api.mjs", import.meta.url),
);
const HERE = fileURLToPath(new URL(".", import.meta.url));
/** The demo hospitals' service worker, and their page side: the worker's registration, the world date, and the rule that names a pull after its hospital. */
const SANDBOX_WEB = {
  worker: "@the-cascade-protocol/sandbox/web/worker",
  page: "@the-cascade-protocol/sandbox/web",
};

/**
 * A package's browser build, bundled as a classic script or a module. A view package imports the others by name, as
 * the import map serves them.
 */
async function bundled(
  name: string,
  format: "iife" | "esm",
): Promise<Uint8Array> {
  const { outputFiles } = await build({
    entryPoints: [name],
    absWorkingDir: HERE,
    external: Object.keys(VIEW_PACKAGES).filter((other) => other !== name),
    bundle: true,
    format,
    platform: "browser",
    target: "es2023",
    write: false,
    logLevel: "warning",
  });
  const [output] = outputFiles;
  if (output === undefined) throw new Error(`esbuild built nothing of ${name}`);
  return output.contents;
}

interface PodApi {
  podApi(host: {
    pods: {
      names(): Promise<string[]>;
      title(name: string): Promise<string | undefined>;
      open(name: string): Promise<Pod>;
    };
    tables(): Promise<Tables>;
    opensEncrypted: boolean;
    unsaid(): void;
  }): { said(input: { pod: string }): Promise<unknown> };
}

/**
 * What try/'s page for a pod asks the tables of it, the names of its codes and what ClinVar says of its variants, asked
 * as the page asks them, through PodApi. The pod stays open: its caller closes it.
 */
export async function tryLooks(pod: Pod, tables: Tables): Promise<void> {
  const { podApi } = (await import(pathToFileURL(API).href)) as PodApi;
  const NAME = "pod";
  await podApi({
    pods: {
      names: async () => [NAME],
      title: async () => undefined,
      open: async () => pod,
    },
    tables: async () => tables,
    opensEncrypted: true,
    unsaid() {},
  }).said({ pod: NAME });
}

/**
 * The files of `try/` but the package: the page, which offers the examples published in `samples` (their folders),
 * its app, the starter's PodApi and the app's host for it, the starter's view and the packages it imports, the demo people as the view names them, the demo hospitals as a brands bundle, the redirect page, and the demo hospitals'
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
    host,
    view,
    api,
    worker,
    workerPage,
    { demoPeople },
    runtime,
    packages,
  ] = await Promise.all([
    loadHospitals(),
    readFile(APP),
    readFile(HOST),
    readFile(VIEW),
    readFile(API),
    bundled(SANDBOX_WEB.worker, "iife"),
    bundled(SANDBOX_WEB.page, "esm"),
    import(pathToFileURL(VIEW).href) as Promise<{
      demoPeople(demo: unknown): unknown;
    }>,
    readFile(RUNTIME_PACKAGE, "utf8").then(
      (text) => (JSON.parse(text) as { version: string }).version,
    ),
    Promise.all(
      Object.entries(VIEW_PACKAGES).map(
        async ([name, file]) => [file, await bundled(name, "esm")] as const,
      ),
    ),
  ]);
  const files = new Map<string, Uint8Array>([
    ["index.html", encoder.encode(tryPage(samples, { version, runtime }))],
    ["app.js", app],
    [SUMMARY, view],
    [POD_API, api],
    [BROWSER_HOST, host],
    [PEOPLE, encoder.encode(JSON.stringify(demoPeople(hospitals)))],
    [
      BRANDS,
      encoder.encode(
        JSON.stringify(
          brandsBundle(
            hospitals.map(({ hospital }) => hospital),
            new Date().toISOString(),
          ),
        ),
      ),
    ],
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
