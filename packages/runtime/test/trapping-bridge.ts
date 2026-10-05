import type { BridgeDocument, ConvertOptions, Format } from "../src/bridge.js";
import type { BridgeGlue } from "../src/wasm-bridge.js";

/**
 * A stand-in for the package that traps, as a fault in the Bridge does, on a document whose bytes are "trap", and
 * from then on refuses every call as the package does once its instance is spoiled.
 */
const real = (await import(
  new URL(import.meta.url).searchParams.get("real") ?? ""
)) as BridgeGlue;
let spoiled = false;

function guarded<T>(call: () => T): T {
  if (spoiled)
    throw Object.assign(new Error("the instance is spoiled"), {
      name: "BridgeError",
      kind: "bridge",
    });
  return call();
}

export const initSync: BridgeGlue["initSync"] = (module) =>
  real.initSync(module);

export const describe = (
  adapterIri: string,
  metadata: Uint8Array,
  format?: Format,
): ReturnType<BridgeGlue["describe"]> =>
  guarded(() => real.describe(adapterIri, metadata, format));

export const Adapter: BridgeGlue["Adapter"] = {
  load: (adapter, vocabulary) => {
    const loaded = guarded(() => real.Adapter.load(adapter, vocabulary));
    return {
      accepts: (document: BridgeDocument) =>
        guarded(() => loaded.accepts(document)),
      convert: (document: BridgeDocument, options?: ConvertOptions) =>
        guarded(() => {
          if (new TextDecoder().decode(document.bytes) === "trap") {
            spoiled = true;
            throw new WebAssembly.RuntimeError("unreachable");
          }
          return loaded.convert(document, options);
        }),
      free: () => loaded.free(),
    };
  },
};
