// The build at the path given loads, is the Oxigraph Cargo.lock pins, refuses an option it does not read, and, given
// --panic-probe and a build with the panic-probe feature, throws a panic in Rust as a JavaScript error.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import console from "node:console";
import { createRequire } from "node:module";
import process from "node:process";
import { URL } from "node:url";

const [file, probe] = process.argv.slice(2);
const binding = createRequire(import.meta.url)(file);

if (probe === "--panic-probe") {
  assert.throws(() => binding.panics(), /a panic in the binding/);
  console.log(
    "a panic in Rust throws a JavaScript error, and the process goes on",
  );
}

const pinned = /name = "oxigraph"\nversion = "([^"]+)"/.exec(
  readFileSync(new URL("../Cargo.lock", import.meta.url), "utf8"),
)[1];
assert.equal(binding.oxigraphVersion(), pinned, "the Oxigraph Cargo.lock pins");

const store = new binding.Store();
store.load("<urn:a> <urn:b> <urn:c> .", { format: "text/turtle" });
assert.equal(store.size, 1, "the quads after a load of one");

assert.throws(
  () => store.query("ASK {}", { base_iri: "urn:x" }),
  /base_iri/,
  "a query option the native build does not read",
);
assert.throws(
  () => store.load("", { format: "text/turtle", unchecked: true }),
  /unchecked/,
  "a load option it does not read",
);
assert.throws(
  () => binding.parse("", { format: "text/turtle", no_transaction: true }),
  /no_transaction/,
  "a parse option it does not read",
);
assert.throws(
  () => store.dump({ format: "application/n-quads", to_graph_name: null }),
  /to_graph_name/,
  "a dump option it does not read",
);
assert.equal(store.query("ASK { ?s ?p ?o }", {}), true);

console.log("Oxigraph", pinned, "loads on", process.platform, process.arch);
