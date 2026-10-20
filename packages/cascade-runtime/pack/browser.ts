import { copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type BuildOptions } from "esbuild";
import {
  BRIDGE_GLUE,
  BRIDGE_WASM,
  documentName,
} from "@cascade-runtime/runtime";
import { packageVersion } from "./address.js";

const WORKSPACE = fileURLToPath(new URL("../../", import.meta.url));
const ENTRY = join(WORKSPACE, "dist", "src", "browser");
const WEB = join(WORKSPACE, "..", "runtime", "dist", "src", "web");
const WASM = "web_bg.wasm";

const BUNDLED: BuildOptions = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2023",
  logLevel: "warning",
};

export interface BrowserBuild {
  /** The commit the package is packed from. */
  readonly commit: string;
  /** Whether the checkout held uncommitted changes. */
  readonly dirty: boolean;
  /** The components the package carries, as `packed.json` records them. */
  readonly components: readonly {
    readonly repository: string;
    readonly commit: string;
  }[];
  /** The folder of the Bridge's package. */
  readonly bridge: string;
}

/** The bundled browser entry's code, without its version: what tells one uncommitted build from another. */
async function codeOf(entry: string): Promise<string> {
  const { outputFiles } = await build({
    ...BUNDLED,
    entryPoints: [entry],
    write: false,
    outdir: "out",
  });
  const [code] = outputFiles;
  if (code === undefined) throw new Error(`${entry} bundled to nothing`);
  return documentName(code.contents);
}

/**
 * Writes the browser build into `out`: the entry, the tables' worker, Argon2's and the Bridge's, the Bridge's glue
 * bundled into its worker, with Oxigraph's module and the Bridge's beside them. Gives the entry's version, fixed in
 * it here: the commit's package version, or for an uncommitted build that and its code's name, with the components.
 */
export async function bundleBrowser(
  out: string,
  packing: BrowserBuild,
): Promise<string> {
  await rm(out, { recursive: true, force: true });
  const entry = join(ENTRY, "index.js");
  const code = packing.dirty
    ? `${packageVersion(packing.commit)}+${await codeOf(entry)}`
    : packageVersion(packing.commit);
  const version = await documentName(
    new TextEncoder().encode(JSON.stringify([code, packing.components])),
  );
  await build({
    ...BUNDLED,
    entryPoints: {
      index: entry,
      "tables-worker": join(ENTRY, "tables-worker.js"),
      "argon2-worker": join(WEB, "argon2-worker.js"),
    },
    outdir: out,
    define: { CASCADE_ENTRY_VERSION: JSON.stringify(version) },
  });
  const glue = join(packing.bridge, BRIDGE_GLUE).replaceAll("\\", "/");
  await build({
    ...BUNDLED,
    stdin: {
      contents: [
        `import * as glue from ${JSON.stringify(glue)};`,
        `import { serveBridge } from "./wasm-worker.js";`,
        "serveBridge(glue);",
      ].join("\n"),
      resolveDir: WEB,
      sourcefile: "bridge-worker.js",
      loader: "js",
    },
    outfile: join(out, "wasm-worker.js"),
  });
  await copyFile(
    fileURLToPath(new URL(WASM, import.meta.resolve("oxigraph/web.js"))),
    join(out, WASM),
  );
  await copyFile(join(packing.bridge, BRIDGE_WASM), join(out, BRIDGE_WASM));
  return version;
}
