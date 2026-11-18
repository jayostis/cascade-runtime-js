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
const RELEASES =
  "https://github.com/jayostis/cascade-runtime-js/releases/download";
/** Which engine a run uses: `native`, `wasm`, or, unset or `auto`, native where it loads and wasm elsewhere. */
export const OXIGRAPH_CHOICE = "CASCADE_OXIGRAPH";
/** A native build's file, read in place of the one fetched. */
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
 * The native build in the file, if it loads and is the Oxigraph the WebAssembly build is; else why not. A build of
 * another Oxigraph is refused, so an answer never depends on which engine gave it.
 */
export function nativeOxigraph(
  file: string = nativeOxigraphFile(),
  load: (file: string) => NativeBinding = (file) =>
    require(file) as NativeBinding,
): OxigraphEngine | Error {
  if (!existsSync(file))
    return new Error(`no native Oxigraph build at ${file}`);
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
 * `auto`, the native build where it loads and the WebAssembly build elsewhere.
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
      const engine = native();
      return engine instanceof Error ? wasmOxigraph : engine;
    }
    default:
      throw new Error(
        `${OXIGRAPH_CHOICE} is "${choice}", where "native", "wasm" or "auto" was expected`,
      );
  }
}

/**
 * Fetches this platform's native build from the release into the file it is kept at, unless it is there, and returns
 * the file. The one network call the native build makes; a run only ever reads the file.
 */
export async function fetchNativeOxigraph(
  file: string = nativeOxigraphFile(),
): Promise<string> {
  if (existsSync(file)) return file;
  const address = `${RELEASES}/${OXIGRAPH_NATIVE_RELEASE}/${nativeAsset()}`;
  const response = await fetch(address);
  if (!response.ok)
    throw new Error(
      `${address} answered ${response.status}: no native Oxigraph build for ${process.platform}-${process.arch}`,
    );
  await mkdir(dirname(file), { recursive: true });
  const part = `${file}.${process.pid}.part`;
  try {
    await writeFile(part, new Uint8Array(await response.arrayBuffer()));
    await rename(part, file);
  } finally {
    await rm(part, { force: true });
  }
  return file;
}
