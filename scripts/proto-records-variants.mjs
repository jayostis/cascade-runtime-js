// Why records.rq keyed in place is slow: variants timed on a snapshot, 1k drawn records.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("C:/dev/the-cascade-protocol/.worktrees/incr/cascade-runtime-js/package.json");
const oxigraph = require("oxigraph");
const { keyed } = await import("file:///C:/dev/the-cascade-protocol/.worktrees/incr/cascade-runtime-js/packages/runtime/dist/src/keyed.js");
const s = new oxigraph.Store();
s.load(readFileSync(process.argv[2], "utf8"), { format: "application/n-quads" });
const D = "urn:cascade:derived:everyday", C = "https://ns.cascadeprotocol.org/cascade#";
const all = JSON.parse(s.query(`SELECT ?r WHERE { GRAPH <${D}> { ?r <${C}recordKind> ?k } }`, { results_format: "application/sparql-results+json" })).results.bindings.map((b) => b.r.value).sort();
const keys = all.filter((_, i) => i % Math.ceil(all.length / 1000) === 0);
const q = readFileSync("C:/dev/the-cascade-protocol/cascade-vocabulary/queries/derivations/records.rq", "utf8");
const values = `VALUES ?record { ${keys.map((k) => `<${k}>`).join(" ")} }`;
const variants = {
  whole: q,
  keyed: keyed(q, "record", keys),
  keyedIntoOptional: keyed(q, "record", keys, { intoOptional: true }),
  afterTypePattern: q.replace("?record a ?type .", `?record a ?type . ${values}`),
  noTypeTable: q.replace(/VALUES \(\?type[\s\S]*?\n  \}\n/, "").replace("?record a ?type .", `${values} ?record a cascade:LaboratoryTestResult . BIND (cascade:testName AS ?nameProperty) BIND (cascade:resultClinicallyRelevantTime AS ?dateProperty) BIND("Lab result" AS ?kind) BIND(false AS ?statusOnlyFromDocuments)`),
  firstOptionalOnly: keyed(q.replace(/  OPTIONAL \{ \?version prov:specializationOf \?record ; \?hasName[\s\S]*?BIND/, "  BIND"), "record", keys),
};
for (const [name, text] of Object.entries(variants)) {
  const t = performance.now();
  const out = s.query(text, { use_default_graph_as_union: true, results_format: "application/n-triples" });
  console.log(name.padEnd(20), Math.round(performance.now() - t), "ms", out.split("\n").length - 1, "triples");
}
