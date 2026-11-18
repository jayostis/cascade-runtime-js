import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  chooseOxigraph,
  type NativeBinding,
  nativeEngine,
  nativeOxigraph,
  wasmOxigraphVersion,
} from "../src/node/oxigraph-native.js";
import { wasmOxigraph } from "../src/oxigraph-engine.js";
import { OxigraphStore } from "../src/oxigraph-store.js";

/** A binding that says it is the Oxigraph `version` and is never otherwise called. */
const bindingOf = (version: string): NativeBinding => ({
  oxigraphVersion: () => version,
  parse: () => [],
  Store: class {} as unknown as NativeBinding["Store"],
});
/** A file that is there, which the loader given never reads. */
const present = fileURLToPath(import.meta.url);
const same = () => nativeEngine(bindingOf(wasmOxigraphVersion()));
const none = () => new Error("no native Oxigraph build at /nowhere");

describe("Choosing Oxigraph's native or WebAssembly build · chooseOxigraph(), nativeOxigraph(), OxigraphStore", () => {
  it("uses the native build where it loads, unless asked for the WebAssembly build", () => {
    assert.equal(chooseOxigraph("auto", same).name, "native");
    assert.equal(chooseOxigraph("native", same).name, "native");
    assert.equal(chooseOxigraph("wasm", same), wasmOxigraph);
  });

  it("uses the WebAssembly build where no native build loads, unless asked for the native one, and then throws why", () => {
    assert.equal(chooseOxigraph("auto", none), wasmOxigraph);
    assert.throws(() => chooseOxigraph("native", none), /at \/nowhere/);
  });

  it("refuses a value of CASCADE_OXIGRAPH other than native, wasm or auto", () => {
    assert.throws(() => chooseOxigraph("fast", same), /CASCADE_OXIGRAPH/);
  });

  it("refuses a native build of another Oxigraph than the WebAssembly build's, naming both", () => {
    const refused = nativeOxigraph(present, () => bindingOf("0.0.1"));
    assert.ok(refused instanceof Error);
    assert.match(refused.message, /Oxigraph 0\.0\.1/);
    assert.match(refused.message, new RegExp(wasmOxigraphVersion()));
    assert.equal(
      nativeOxigraph(present, () => bindingOf(wasmOxigraphVersion())).name,
      "native",
    );
  });

  it("says why a native build that is not there, or does not load, is not used", () => {
    const missing = nativeOxigraph("/nowhere/oxigraph.node");
    assert.ok(missing instanceof Error);
    assert.match(missing.message, /no native Oxigraph build/);
    const broken = nativeOxigraph(present, () => {
      throw new Error("not a module");
    });
    assert.ok(broken instanceof Error);
    assert.match(broken.message, /does not load/);
  });

  it("makes each store on the engine it is given, and its renewal on the same", async () => {
    const store = new OxigraphStore({ engine: wasmOxigraph });
    assert.equal(store.engine, wasmOxigraph);
    const renewed = (await store.renewed()) as OxigraphStore;
    assert.equal(renewed.engine, wasmOxigraph);
  });

  it("makes every other store of the run on the engine CASCADE_OXIGRAPH asks for", () => {
    const asked = process.env.CASCADE_OXIGRAPH;
    const name = new OxigraphStore().engine.name;
    if (asked === "native" || asked === "wasm") assert.equal(name, asked);
    else assert.ok(name === "native" || name === "wasm", name);
  });
});
