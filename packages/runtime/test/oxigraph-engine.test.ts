import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  chooseOxigraph,
  fetchNativeOxigraph,
  type NativeBinding,
  nativeAsset,
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
/** A file that is there, which the loader given never loads. */
const present = fileURLToPath(import.meta.url);
const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
/** The committed hashes, where this platform's asset hashes to `bytes`. */
const committing = (bytes: string | Uint8Array) => ({
  [nativeAsset()]: sha256(bytes),
});
const same = () => nativeEngine(bindingOf(wasmOxigraphVersion()));
const none = () => new Error("no native Oxigraph build at /nowhere");

describe("Choosing and fetching Oxigraph's native or WebAssembly build · chooseOxigraph(), nativeOxigraph(), fetchNativeOxigraph(), OxigraphStore", () => {
  it("uses the native build where it loads, unless asked for the WebAssembly build", () => {
    assert.equal(chooseOxigraph("auto", same).name, "native");
    assert.equal(chooseOxigraph("native", same).name, "native");
    assert.equal(chooseOxigraph("wasm", same), wasmOxigraph);
  });

  it("uses the WebAssembly build where no native build loads, unless asked for the native one, and then throws why", () => {
    assert.equal(chooseOxigraph("auto", none), wasmOxigraph);
    assert.throws(() => chooseOxigraph("native", none), /at \/nowhere/);
  });

  it("uses the WebAssembly build where looking for the native one throws, as under Node's permission model", () => {
    const denied = () => {
      throw new Error("Access to this API has been restricted");
    };
    assert.equal(chooseOxigraph("auto", denied), wasmOxigraph);
    assert.throws(() => chooseOxigraph("native", denied), /restricted/);
  });

  it("refuses a value of CASCADE_OXIGRAPH other than native, wasm or auto", () => {
    assert.throws(() => chooseOxigraph("fast", same), /CASCADE_OXIGRAPH/);
  });

  it("refuses a native build of another Oxigraph than the WebAssembly build's, naming both", () => {
    const refused = nativeOxigraph(present, () => bindingOf("0.0.1"), null);
    assert.ok(refused instanceof Error);
    assert.match(refused.message, /Oxigraph 0\.0\.1/);
    assert.match(refused.message, new RegExp(wasmOxigraphVersion()));
    assert.equal(
      nativeOxigraph(present, () => bindingOf(wasmOxigraphVersion()), null)
        .name,
      "native",
    );
  });

  it("says why a native build that is not there, or does not load, is not used", () => {
    const missing = nativeOxigraph("/nowhere/oxigraph.node");
    assert.ok(missing instanceof Error);
    assert.match(missing.message, /no native Oxigraph build/);
    const broken = nativeOxigraph(
      present,
      () => {
        throw new Error("not a module");
      },
      null,
    );
    assert.ok(broken instanceof Error);
    assert.match(broken.message, /does not load/);
  });

  it("loads a kept build only where its sha256 is the one committed for this platform, and a file CASCADE_OXIGRAPH_NATIVE names unchecked", () => {
    const loads = () => bindingOf(wasmOxigraphVersion());
    const kept = readFileSync(present);
    assert.equal(
      nativeOxigraph(present, loads, committing(kept)).name,
      "native",
    );
    assert.equal(nativeOxigraph(present, loads, null).name, "native");
    const other = nativeOxigraph(present, loads, committing("another build"));
    assert.ok(other instanceof Error);
    assert.match(other.message, new RegExp(`sha256 ${sha256(kept)}`));
    const uncommitted = nativeOxigraph(present, loads, {});
    assert.ok(uncommitted instanceof Error);
    assert.match(uncommitted.message, /no sha256 is committed/);
    assert.equal(
      chooseOxigraph("auto", () => nativeOxigraph(present, loads, {})),
      wasmOxigraph,
    );
  });

  it("makes each store on the engine it is given, and its renewal on the same", async () => {
    const store = new OxigraphStore({ engine: wasmOxigraph });
    assert.equal(store.engine, wasmOxigraph);
    const renewed = (await store.renewed()) as OxigraphStore;
    assert.equal(renewed.engine, wasmOxigraph);
  });

  it("makes every other store of the run on the engine CASCADE_OXIGRAPH asks for, which the suite names, wasm unless told", () => {
    const asked = process.env.CASCADE_OXIGRAPH;
    assert.ok(
      asked === "native" || asked === "wasm",
      `CASCADE_OXIGRAPH is ${asked}`,
    );
    assert.equal(new OxigraphStore().engine.name, asked);
  });

  const folder = mkdtempSync(join(tmpdir(), "oxigraph-fetch-"));
  after(() => rmSync(folder, { recursive: true, force: true }));
  /** A release that answers every request with `bytes`, counting them. */
  const releasing = (bytes: string) => {
    const release = {
      asked: 0,
      get: async (_address: string) => {
        release.asked += 1;
        return new Response(bytes);
      },
    };
    return release;
  };

  it("fetches nothing for a platform whose sha256 is not committed, and says so", async () => {
    const release = releasing("a build");
    await assert.rejects(
      fetchNativeOxigraph(join(folder, "uncommitted.node"), {}, release.get),
      /no sha256 is committed/,
    );
    assert.equal(release.asked, 0);
  });

  it("keeps no file whose sha256 is not the committed one, and names both", async () => {
    const file = join(folder, "swapped.node");
    await assert.rejects(
      fetchNativeOxigraph(
        file,
        committing("the build"),
        releasing("another build").get,
      ),
      new RegExp(`${sha256("another build")}.*${sha256("the build")}`),
    );
    assert.equal(existsSync(file), false);
    assert.deepEqual(
      readdirSync(folder).filter((name) => name.startsWith("swapped")),
      [],
    );
  });

  it("keeps a file whose sha256 is the committed one, and fetches it again only once it is not", async () => {
    const file = join(folder, "kept.node");
    const release = releasing("the build");
    assert.equal(
      await fetchNativeOxigraph(file, committing("the build"), release.get),
      file,
    );
    assert.equal(readFileSync(file, "utf8"), "the build");
    await fetchNativeOxigraph(file, committing("the build"), release.get);
    assert.equal(release.asked, 1);
    writeFileSync(file, "a stale build");
    await fetchNativeOxigraph(file, committing("the build"), release.get);
    assert.equal(release.asked, 2);
    assert.equal(readFileSync(file, "utf8"), "the build");
  });
});
