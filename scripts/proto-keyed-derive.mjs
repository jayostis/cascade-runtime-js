// Prototype (proto/incremental-views, runtime#819): one step's derivations and views over a bench pod's working store,
// two ways, timed, each checked against the derived state and views the store already holds (built whole):
//   scope: today's KeptBuild.#rebuilt: a second store holding every file but the untouched records' (the scope), the
//          vocabulary's queries run whole over it, each answer checked against what the scope holds and added.
//   keyed: in place, in the one working store: the touched keys' derived triples removed, then each query of a keyed
//          class run with VALUES of its keys (src/keyed.ts), the rest whole, each answer checked and added.
// Usage (from the worktree root, after `npx tsc -b packages/runtime`):
//   node --max-old-space-size=8192 scripts/proto-keyed-derive.mjs <snapshot.nq> <touched records> [scope|keyed|both] [--json out]
// The snapshot is a pod's working store as N-Quads after a read (speed-program/notes/storage/work/<N>.nq).
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import oxigraph from "oxigraph";

const at = (path) =>
  pathToFileURL(`${process.cwd()}/packages/runtime/dist/src/${path}`).href;
const { keyed } = await import(at("keyed.js"));
const { nTriples } = await import(at("oxigraph-store.js"));
const { written } = await import(at("rdf.js"));
const { derivationsOf } = await import(at("derive.js"));
const { entryHash, byCodePoint } = await import(at("names.js"));
const { FolderFiles } = await import(at("node/folder-files.js"));

const [snapshot, touchedArg, modeArg = "both"] = process.argv.slice(2);
const jsonAt = process.argv.indexOf("--json");
const TOUCHED = Number(touchedArg);
const VOCABULARY = "C:/dev/the-cascade-protocol/cascade-vocabulary";
const LENS = "everyday";
const DERIVED = `urn:cascade:derived:${LENS}`;
const C = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const AT_ONCE = 4096;
const INTO_OPTIONAL = {
  intoOptional: process.argv.includes("--into-optional"),
};
const ENTRY = "urn:cascade:entry:";

/** Which variable each derivation is keyed by: R the touched records, E their entries; unlisted ones run whole (class c). */
const KEYS = {
  "records.rq": ["record", "R"],
  "current-revision-candidates.rq": ["record", "R"],
  "current-revisions.rq": ["record", "R"],
  "subjects.rq": ["record", "R"],
  "excluded-at-source.rq": ["record", "R"],
  "excluded-by-judgment.rq": ["record", "R"],
  "excluded-for-their-patient.rq": ["record", "R"],
  "excluded-with-their-activity.rq": ["record", "R"],
  "medication-lifecycles.rq": ["record", "R"],
  "medication-exposure-periods.rq": ["record", "R"],
  "medication-dispense-lifecycles.rq": ["record", "R"],
  "narrative-texts-as-trimmed-lines.rq": ["record", "R"],
  "candidates-ordered-by-ancestry.rq": ["record", "R"],
  "lead-member-candidates.rq": ["entry", "E"],
  "lead-members.rq": ["entry", "E"],
  "status-sources.rq": ["entry", "E"],
  "date-sources.rq": ["entry", "E"],
  "top-criticalities.rq": ["entry", "E"],
};

const ms = (t) => Math.round(performance.now() - t);
const log = (...a) => console.log(...a);

class Working {
  constructor() {
    this.store = new oxigraph.Store();
  }
  load(nq) {
    this.store.load(nq, { format: "application/n-quads" });
  }
  /** The dataset a query reads: every graph, or (`listed`) the graphs named, as a Union of some of a store's graphs is read. */
  get dataset() {
    return this.listed === undefined
      ? { use_default_graph_as_union: true }
      : { default_graph: this.listed };
  }
  select(query) {
    return JSON.parse(
      this.store.query(query, {
        ...this.dataset,
        results_format: "application/sparql-results+json",
      }),
    ).results.bindings;
  }
  construct(query) {
    return nTriples(
      this.store.query(query, {
        ...this.dataset,
        results_format: "application/n-triples",
      }),
    );
  }
  held(triples) {
    return triples.map(([s, p, o]) => {
      const term = (t) =>
        t.termType === "NamedNode"
          ? oxigraph.namedNode(t.value)
          : t.termType === "BlankNode"
            ? oxigraph.blankNode(t.value)
            : oxigraph.literal(
                t.value,
                t.language || oxigraph.namedNode(t.datatype.value),
              );
      return (
        this.store.match(term(s), oxigraph.namedNode(p.value), term(o), null)
          .length > 0
      );
    });
  }
  add(triples, graph) {
    if (triples.length === 0) return;
    this.store.load(
      triples.map((t) => `${t.map(written).join(" ")} .\n`).join(""),
      {
        format: "application/n-triples",
        to_graph_name: oxigraph.namedNode(graph),
      },
    );
  }
  removeSubjects(graph, subjects) {
    const all = [...subjects];
    for (let i = 0; i < all.length; i += 1024)
      this.store.update(
        `DELETE { GRAPH <${graph}> { ?s ?p ?o } } WHERE { GRAPH <${graph}> { VALUES ?s { ${all
          .slice(i, i + 1024)
          .map((s) => `<${s}>`)
          .join(" ")} } ?s ?p ?o } }`,
      );
  }
  graph(graph) {
    return this.construct(
      `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${graph}> { ?s ?p ?o } }`,
    );
  }
}

/** One derivation step as derive.ts runs it: construct, drop what the store holds or repeats, add to the derived graph. */
function step(store, query) {
  const constructed = store.construct(query);
  const held = store.held(constructed);
  const seen = new Set();
  const fresh = constructed.filter((t, i) => {
    if (held[i]) return false;
    const k = t.map(written).join(" ");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  store.add(fresh, DERIVED);
  return fresh.length;
}

function batches(all) {
  const out = [];
  for (let i = 0; i < all.length; i += AT_ONCE)
    out.push(all.slice(i, i + AT_ONCE));
  return out.length === 0 ? [[]] : out;
}

/** entries.rq as entries.ts gives it, over the pairs and kinds of the records listed, or of every record. */
async function entriesOf(store, records) {
  const rowsOf = (pattern, v) =>
    records === undefined
      ? store.select(`SELECT * WHERE { ${pattern} }`)
      : batches(records).flatMap((b) =>
          store.select(
            `SELECT * WHERE { VALUES ?${v} { ${b.map((r) => `<${r}>`).join(" ")} } ${pattern} }`,
          ),
        );
  const pairs = rowsOf(`?one <${C}currentlySame> ?other`, "one");
  const kinds = rowsOf(
    `?record <${C}recordKind> ?kind FILTER NOT EXISTS { ?record <${C}leftOutFor> [] }`,
    "record",
  );
  const parent = new Map();
  const root = (t) => {
    let a = t;
    while (parent.has(a)) a = parent.get(a);
    return a;
  };
  for (const { one, other } of pairs) {
    const [a, b] = [root(one.value), root(other.value)];
    if (a !== b) parent.set(a, b);
  }
  const least = new Map();
  const ofKind = [];
  for (const { record, kind } of kinds) {
    if (record.type !== "uri") continue;
    const group = `${root(record.value)} ${kind.value}`;
    ofKind.push([record.value, group]);
    const was = least.get(group);
    if (was === undefined || byCodePoint(record.value, was) < 0)
      least.set(group, record.value);
  }
  const entryOf = new Map();
  for (const [record, group] of ofKind) {
    const m = least.get(group);
    const was = entryOf.get(record);
    if (was === undefined || byCodePoint(m, was) < 0) entryOf.set(record, m);
  }
  const hashes = new Map();
  const triples = [];
  for (const [record, m] of entryOf) {
    if (!hashes.has(m)) hashes.set(m, await entryHash(m));
    triples.push([
      { termType: "NamedNode", value: record },
      { termType: "NamedNode", value: `${C}inEntry` },
      { termType: "NamedNode", value: ENTRY + hashes.get(m) },
    ]);
  }
  return triples;
}

function entriesStep(store, triples) {
  const held = store.held(triples);
  const fresh = triples.filter((_, i) => !held[i]);
  store.add(fresh, DERIVED);
  return fresh.length;
}

const lines = (triples) =>
  new Set(triples.map((t) => t.map(written).join(" ")));
function compare(what, got, want) {
  const extra = [...got].filter((l) => !want.has(l));
  const missing = [...want].filter((l) => !got.has(l));
  log(
    `  ${what}: ${got.size} triples; ${extra.length} extra, ${missing.length} missing${extra.length + missing.length === 0 ? " (identical)" : ""}`,
  );
  for (const l of [
    ...extra.slice(0, 3).map((l) => `+ ${l}`),
    ...missing.slice(0, 3).map((l) => `- ${l}`),
  ])
    log(`    ${l.slice(0, 220)}`);
  return extra.length + missing.length;
}

// ---- load the working store
let t = performance.now();
const nq = readFileSync(snapshot, "utf8");
const working = new Working();
working.load(nq);
log(`loaded ${snapshot} in ${ms(t)} ms`);
const steps = (
  await derivationsOf(new FolderFiles(VOCABULARY, "urn:vocabulary:"))
).for(LENS);
const reference = working.graph(DERIVED);
log(`derived state: ${reference.length} triples; ${steps.length} derivations`);

// ---- the touched set: TOUCHED records drawn with a fixed seed, closed over their entries
const allRecords = working
  .select(`SELECT ?r WHERE { GRAPH <${DERIVED}> { ?r <${C}recordKind> ?k } }`)
  .map((b) => b.r.value)
  .sort();
let seed = 7;
const rand = () =>
  (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const drawn = new Set();
while (drawn.size < Math.min(TOUCHED, allRecords.length))
  drawn.add(allRecords[Math.floor(rand() * allRecords.length)]);
const inEntry = new Map();
const members = new Map();
for (const b of working.select(
  `SELECT ?r ?e WHERE { GRAPH <${DERIVED}> { ?r <${C}inEntry> ?e } }`,
)) {
  inEntry.set(b.r.value, b.e.value);
  if (!members.has(b.e.value)) members.set(b.e.value, []);
  members.get(b.e.value).push(b.r.value);
}
const R = new Set(drawn);
for (const r of drawn)
  for (const m of members.get(inEntry.get(r)) ?? []) R.add(m);
const E = new Set(
  [...R].flatMap((r) => (inEntry.has(r) ? [inEntry.get(r)] : [])),
);
const records = [...R];
const owned = new Set(
  batches(records).flatMap((b) =>
    working
      .select(
        `SELECT ?o WHERE { VALUES ?r { ${b.map((r) => `<${r}>`).join(" ")} } { ?o <${PROV}specializationOf> ?r } UNION { ?o <${C}revisionOf> ?r } }`,
      )
      .map((x) => x.o.value),
  ),
);
const leftOut = new Set(
  batches(records).flatMap((b) =>
    working
      .select(
        `SELECT ?l WHERE { VALUES ?r { ${b.map((r) => `<${r}>`).join(" ")} } GRAPH <${DERIVED}> { ?r <${C}leftOutFor> ?l } }`,
      )
      .map((x) => x.l.value),
  ),
);
log(
  `touched: ${drawn.size} drawn of ${allRecords.length} records; closed over entries ${R.size} records, ${E.size} entries, ${owned.size} versions and revisions, ${leftOut.size} left-outs`,
);
const subjects = new Set([...R, ...owned, ...E, ...leftOut]);
const want = lines(reference.filter(([s]) => subjects.has(s.value)));
const result = {
  snapshot,
  touched: drawn.size,
  records: R.size,
  entries: E.size,
  modes: {},
};

// The view and labels queries, keyed by entry and by thing.
const viewQuery = readFileSync(
  `${VOCABULARY}/queries/views/lab-results.rq`,
  "utf8",
);
const labelsQuery = readFileSync(`${VOCABULARY}/queries/labels.rq`, "utf8");
const labEntries = [...E];
const entryOfSubject = (value) =>
  value.startsWith(ENTRY) ? value.slice(0, ENTRY.length + 64) : undefined;
const ofTouchedEntries = (triples) =>
  lines(triples.filter(([s]) => E.has(entryOfSubject(s.value))));

async function derive(store, mode) {
  const times = {};
  let total = 0;
  for (const { path, query } of steps) {
    const name = path.replace(/^.*\//, "");
    const started = performance.now();
    let rows = 0;
    if (name === "entries.rq")
      rows = entriesStep(
        store,
        await entriesOf(store, mode === "keyed" ? records : undefined),
      );
    else if (mode === "keyed" && KEYS[name] !== undefined) {
      const [variable, set] = KEYS[name];
      for (const batch of batches(set === "R" ? records : [...E]))
        rows += step(store, keyed(query, variable, batch, INTO_OPTIONAL));
    } else rows += step(store, query);
    times[name] = { ms: ms(started), rows };
    total += times[name].ms;
  }
  return { times, total };
}

if (modeArg === "scope" || modeArg === "both") {
  log(
    "\n== scope (today): a second store of every file but the untouched records', queries whole",
  );
  t = performance.now();
  // The graphs of the untouched records' files: the graph of each record's, its versions' and its revisions' triples.
  const untouched = new Set();
  const recordGraphs = working.select(
    `SELECT DISTINCT ?g ?r WHERE { GRAPH <${DERIVED}> { ?r <${C}recordKind> ?k } { GRAPH ?g { ?r a ?t } } UNION { GRAPH ?g { ?o <${PROV}specializationOf> ?r } } UNION { GRAPH ?g { ?o <${C}revisionOf> ?r } } FILTER (?g != <${DERIVED}>) }`,
  );
  for (const { g, r } of recordGraphs)
    if (!R.has(r.value)) untouched.add(g.value);
  for (const { g, r } of recordGraphs)
    if (R.has(r.value)) untouched.delete(g.value);
  const built = new Set(
    working
      .select(`SELECT DISTINCT ?g WHERE { GRAPH ?g { ?v a <${C}View> } }`)
      .map((b) => b.g.value)
      .concat(
        working
          .select(
            `SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?l } }`,
          )
          .map((b) => b.g.value)
          .filter((g) => g.endsWith("labels.ttl")),
      ),
  );
  const keep = nq.split("\n").filter((line) => {
    const g = /<([^<>]*)> \.$/.exec(line)?.[1];
    return (
      g !== undefined &&
      g !== DERIVED &&
      !untouched.has(g) &&
      !built.has(g) &&
      !g.endsWith("type-index.ttl") &&
      !g.includes("manifest")
    );
  });
  const scope = new Working();
  scope.load(keep.join("\n"));
  const filled = ms(t);
  log(
    `  scope filled with ${keep.length} quads (of ${nq.split("\n").length}) in ${filled} ms (a quad copy: today parses the files' Turtle, kept.rebuilt.podFiles)`,
  );
  const { times, total } = await derive(scope, "scope");
  for (const [n, { ms: m, rows }] of Object.entries(times))
    log(`  ${String(m).padStart(7)} ms ${String(rows).padStart(7)} rows  ${n}`);
  log(`  derivations: ${total} ms`);
  const got = lines(
    scope.graph(DERIVED).filter(([s]) => subjects.has(s.value)),
  );
  const diff = compare("derived state of the touched keys", got, want);
  t = performance.now();
  const view = scope.construct(viewQuery);
  const viewMs = ms(t);
  t = performance.now();
  const labels = scope.construct(labelsQuery);
  const labelsMs = ms(t);
  log(
    `  lab-results view whole over the scope: ${viewMs} ms, ${view.length} triples; labels: ${labelsMs} ms, ${labels.length} triples`,
  );
  result.modes.scope = {
    fill: filled,
    derive: total,
    times,
    diff,
    view: viewMs,
    viewTriples: view.length,
    labels: labelsMs,
    labelsTriples: labels.length,
  };
  result.scopeView = ofTouchedEntries(view);
  result.scopeLabels = lines(
    labels.filter(([s]) => R.has(s.value) || owned.has(s.value)),
  );
}

if (modeArg === "keyed" || modeArg === "both") {
  log(
    "\n== keyed: in place, in the working store, the touched keys' derived triples removed, then VALUES-keyed queries",
  );
  t = performance.now();
  working.removeSubjects(DERIVED, subjects);
  const removed = ms(t);
  log(
    `  removed the touched keys' derived triples (${subjects.size} subjects) in ${removed} ms`,
  );
  if (process.argv.includes("--list")) {
    const builtGraphs = new Set(
      working
        .select(`SELECT DISTINCT ?g WHERE { GRAPH ?g { ?v a <${C}View> } }`)
        .map((b) => b.g.value),
    );
    for (const b of working.select(
      `SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }`,
    ))
      if (b.g.value.endsWith("labels.ttl")) builtGraphs.add(b.g.value);
    working.listed = working
      .select(`SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }`)
      .map((b) => b.g.value)
      .filter((g) => !builtGraphs.has(g))
      .map((g) => oxigraph.namedNode(g));
    log(
      `  derivations read ${working.listed.length} graphs listed: every graph but the ${builtGraphs.size} built files'`,
    );
  }
  const { times, total } = await derive(working, "keyed");
  working.listed = undefined;
  for (const [n, { ms: m, rows }] of Object.entries(times))
    log(
      `  ${String(m).padStart(7)} ms ${String(rows).padStart(7)} rows  ${n}${KEYS[n] ? ` (keyed by ?${KEYS[n][0]})` : n === "entries.rq" ? " (keyed by record)" : " (whole)"}`,
    );
  log(`  derivations: ${total} ms`);
  const after = working.graph(DERIVED);
  const diff = compare(
    "derived state of the touched keys",
    lines(after.filter(([s]) => subjects.has(s.value))),
    want,
  );
  const diffAll = compare(
    "whole derived state against the one built whole",
    lines(after),
    lines(reference),
  );
  t = performance.now();
  let view = [];
  for (const b of batches(labEntries))
    view = view.concat(
      working.construct(keyed(viewQuery, "entry", b, INTO_OPTIONAL)),
    );
  const viewMs = ms(t);
  log(
    `  lab-results view keyed by ?entry (${labEntries.length} entries): ${viewMs} ms, ${view.length} triples`,
  );
  if (result.scopeView !== undefined) {
    compare(
      "lab-results view of the touched entries, keyed against scope",
      ofTouchedEntries(view),
      result.scopeView,
    );
  }
  const labelsGraph = working.select(
    `SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?l } FILTER (STRENDS(STR(?g), "labels.ttl")) }`,
  )[0]?.g.value;
  const things = [...R, ...owned];
  t = performance.now();
  working.removeSubjects(labelsGraph, things);
  let labels = [];
  for (const b of batches(things))
    labels = labels.concat(
      working.construct(keyed(labelsQuery, "thing", b, INTO_OPTIONAL)),
    );
  const labelsMs = ms(t);
  log(
    `  labels keyed by ?thing (${things.length} records, versions and revisions): ${labelsMs} ms, ${labels.length} triples`,
  );
  if (result.scopeLabels !== undefined)
    compare(
      "labels of the touched records, keyed against scope",
      lines(labels),
      result.scopeLabels,
    );
  result.modes.keyedLabels = { ms: labelsMs, triples: labels.length };
  result.modes.keyed = {
    remove: removed,
    derive: total,
    times,
    diff,
    diffAll,
    view: viewMs,
    viewTriples: view.length,
  };
}

delete result.scopeView;
delete result.scopeLabels;
if (jsonAt !== -1)
  writeFileSync(
    process.argv[jsonAt + 1],
    `${JSON.stringify(result, null, 2)}\n`,
  );
