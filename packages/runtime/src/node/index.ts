import { useOxigraph } from "../oxigraph-engine.js";
import { chooseOxigraph } from "./oxigraph-native.js";

// The archive reader needs no Node, but only a Node host keeps archives (X1), so a browser bundle never carries it.
export * from "../archives.js";
export * from "./archive-commands.js";
export { BUILD, latestBuild } from "./bridge-build.js";
export * from "./components.js";
export * from "./encryption.js";
export * from "./folder-files.js";
export * from "./git.js";
export * from "./oxigraph-native.js";
export * from "./resolver.js";
export * from "./runtime.js";
export * from "./wasm.js";
export * from "./sqlite.js";
export * from "./story-pod.js";
export * from "./bridge-record.js";

/** In Node, a store made without an engine runs on the one `CASCADE_OXIGRAPH` asks for, chosen when the first is made. */
useOxigraph(() => chooseOxigraph());
