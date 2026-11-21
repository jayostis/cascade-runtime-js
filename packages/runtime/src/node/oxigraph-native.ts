import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import {
  type EngineParseOptions,
  type EngineQuad,
  type EngineStore,
  type EngineTerm,
  type OxigraphEngine,
  wasmOxigraph,
} from "../oxigraph-engine.js";

/** The release of this repository whose assets are the native builds this runtime loads. */
export const OXIGRAPH_NATIVE_RELEASE = "oxigraph-native-v0.5.11";
/**
 * The sha256 of each asset of that release, as the summary of the workflow run that made it gives them. The runtime
 * fetches no asset, and loads no kept file, whose sha256 is not the one here; until the release's are committed, a run
 * uses the WebAssembly build.
 */
export const OXIGRAPH_NATIVE_SHA256: Readonly<Record<string, string>> = {
  "oxigraph-native.darwin-arm64.node":
    "1fffb2ebdfc698d42538f9ea66167e3daf3a10a2522a92514f33df2a629f7dfe",
  "oxigraph-native.darwin-x64.node":
    "75e4945caa2ad4e54c7dd7f2dfbfa7b5651a54e40a56bcb8c1e63c849ab8cfb3",
  "oxigraph-native.linux-x64.node":
    "0c68f6f8c47a06b837689a3eb711b9fc0696ae61d70f7f0382543eba9d4747f1",
  "oxigraph-native.win32-x64.node":
    "b61d91cc6b39eb866104b26315072c811f98d03a9bf969d1376fd6be528c7716",
};
const RELEASES =
  "https://github.com/the-cascade-protocol/cascade-runtime-js/releases/download";
/** Which engine a run uses: `native`, `wasm`, or, unset or `auto`, native where it loads and wasm elsewhere. */
export const OXIGRAPH_CHOICE = "CASCADE_OXIGRAPH";
/** A native build's file, read in place of the one fetched and with no sha256 checked: a build its owner made or bundled. */
export const OXIGRAPH_NATIVE_FILE = "CASCADE_OXIGRAPH_NATIVE";

const RDF_LANG_STRING = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";

const require = createRequire(import.meta.url);

/** What native/oxigraph's build exports. */
export interface NativeBinding {
  oxigraphVersion(): string;
  parse(data: string | Uint8Array, options: EngineParseOptions): EngineQuad[];
  Store: new () => EngineStore;
}

/** The asset of this platform: `oxigraph-native.<platform>-<arch>.node`. */
export function nativeAsset(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  return `oxigraph-native.${platform}-${arch}.node`;
}

/**
 * Where the native build is kept once fetched: under `$XDG_CACHE_HOME`, else `~/.cache`, in `cascade-runtime`, by
 * release, so every checkout and every app on the machine shares one; `CASCADE_OXIGRAPH_NATIVE` names another file.
 */
export function nativeOxigraphFile(env = process.env): string {
  const named = env[OXIGRAPH_NATIVE_FILE];
  if (named) return named;
  const cache = env.XDG_CACHE_HOME ?? "";
  return join(
    isAbsolute(cache) ? cache : join(homedir(), ".cache"),
    "cascade-runtime",
    OXIGRAPH_NATIVE_RELEASE,
    nativeAsset(),
  );
}

/** The hashes a kept file is checked against: none, `null`, for a file `CASCADE_OXIGRAPH_NATIVE` names, which its owner built or bundled. */
function hashesOf(env = process.env): Readonly<Record<string, string>> | null {
  return env[OXIGRAPH_NATIVE_FILE] ? null : OXIGRAPH_NATIVE_SHA256;
}

/**
 * Why the bytes are not this platform's asset by the hashes given, or nothing where they are: with no bytes, only why
 * none would be.
 */
function unlike(
  bytes: Uint8Array | undefined,
  hashes: Readonly<Record<string, string>>,
  where: string,
): Error | undefined {
  const asset = nativeAsset();
  const committed = hashes[asset];
  if (committed === undefined)
    return new Error(
      `no sha256 is committed for ${asset} of ${OXIGRAPH_NATIVE_RELEASE}, so ${where} is not used`,
    );
  if (bytes === undefined) return undefined;
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== committed)
    return new Error(
      `${where} has sha256 ${actual}, where ${asset} of ${OXIGRAPH_NATIVE_RELEASE} has ${committed}`,
    );
  return undefined;
}

/** The version of the `oxigraph` package the WebAssembly build is. */
export function wasmOxigraphVersion(): string {
  return (
    JSON.parse(
      readFileSync(require.resolve("oxigraph/package.json"), "utf8"),
    ) as { version: string }
  ).version;
}

/** The engine over a native build, whose terms are plain objects in RDF/JS's shape. */
export function nativeEngine(binding: NativeBinding): OxigraphEngine {
  return {
    name: "native",
    namedNode: (value) => ({ termType: "NamedNode", value }),
    blankNode: (value) => ({ termType: "BlankNode", value }),
    literal: (value, languageOrDatatype): EngineTerm =>
      "termType" in languageOrDatatype
        ? {
            termType: "Literal",
            value,
            language: "",
            datatype: languageOrDatatype,
          }
        : {
            termType: "Literal",
            value,
            language: languageOrDatatype.language,
            datatype: { termType: "NamedNode", value: RDF_LANG_STRING },
          },
    quad: (subject, predicate, object, graph) => ({
      subject,
      predicate,
      object,
      graph,
    }),
    parse: (data, options) => binding.parse(data, options),
    newStore: () => new binding.Store(),
  };
}

/**
 * The native build in the file, if its sha256 is this platform's in the hashes given (`null` reads it unchecked), it
 * loads, and it is the Oxigraph the WebAssembly build is; else why not. A build of another Oxigraph is refused, so an
 * answer never depends on which engine gave it.
 */
export function nativeOxigraph(
  file: string = nativeOxigraphFile(),
  load: (file: string) => NativeBinding = (file) =>
    require(file) as NativeBinding,
  hashes: Readonly<Record<string, string>> | null = hashesOf(),
): OxigraphEngine | Error {
  if (!existsSync(file))
    return new Error(`no native Oxigraph build at ${file}`);
  if (hashes !== null) {
    const refused = unlike(
      readFileSync(file),
      hashes,
      `the native Oxigraph build at ${file}`,
    );
    if (refused) return refused;
  }
  let binding: NativeBinding;
  try {
    binding = load(file);
  } catch (error) {
    return new Error(`the native Oxigraph build at ${file} does not load`, {
      cause: error,
    });
  }
  const native = binding.oxigraphVersion();
  const wasm = wasmOxigraphVersion();
  if (native !== wasm)
    return new Error(
      `the native build at ${file} is Oxigraph ${native}, the WebAssembly build ${wasm}`,
    );
  return nativeEngine(binding);
}

/**
 * The engine `CASCADE_OXIGRAPH` asks for: `wasm`; `native`, which throws where no native build loads; or, unset or
 * `auto`, the native build where it loads and the WebAssembly build elsewhere: where looking for it throws too, as
 * reading the cache does under Node's permission model.
 */
export function chooseOxigraph(
  choice: string | undefined = process.env[OXIGRAPH_CHOICE],
  native: () => OxigraphEngine | Error = () => nativeOxigraph(),
): OxigraphEngine {
  switch (choice ?? "auto") {
    case "wasm":
      return wasmOxigraph;
    case "native": {
      const engine = native();
      if (engine instanceof Error) throw engine;
      return engine;
    }
    case "auto": {
      let engine: OxigraphEngine | Error;
      try {
        engine = native();
      } catch (error) {
        engine = error instanceof Error ? error : new Error(String(error));
      }
      return engine instanceof Error ? wasmOxigraph : engine;
    }
    default:
      throw new Error(
        `${OXIGRAPH_CHOICE} is "${choice}", where "native", "wasm" or "auto" was expected`,
      );
  }
}

/**
 * Fetches this platform's native build from the release into the file it is kept at, unless the file there has the
 * committed sha256, and returns the file. Bytes of another sha256 are never written, and nothing is fetched for a
 * platform with none committed. The one network call the native build makes; a run only ever reads the file.
 */
export async function fetchNativeOxigraph(
  file: string = nativeOxigraphFile(),
  hashes: Readonly<Record<string, string>> = OXIGRAPH_NATIVE_SHA256,
  get: (address: string) => Promise<Response> = fetch,
): Promise<string> {
  const uncommitted = unlike(undefined, hashes, "the release");
  if (uncommitted) throw uncommitted;
  if (existsSync(file) && !unlike(readFileSync(file), hashes, file))
    return file;
  const address = `${RELEASES}/${OXIGRAPH_NATIVE_RELEASE}/${nativeAsset()}`;
  const response = await get(address);
  if (!response.ok)
    throw new Error(
      `${address} answered ${response.status}: no native Oxigraph build for ${process.platform}-${process.arch}`,
    );
  const bytes = new Uint8Array(await response.arrayBuffer());
  const refused = unlike(bytes, hashes, address);
  if (refused) throw refused;
  await mkdir(dirname(file), { recursive: true });
  const part = `${file}.${process.pid}.part`;
  try {
    await writeFile(part, bytes);
    await rename(part, file);
  } finally {
    await rm(part, { force: true });
  }
  return file;
}
