import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  type BridgeDocument,
  type Conversion,
  isBridgeError,
  type LoadedAdapter,
} from "../src/bridge.js";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import { fileExport } from "../src/arrivals.js";
import { MemoryFiles } from "../src/files.js";
import { parseGraph } from "../src/graph.js";
import { StoryTime } from "../src/ids.js";
import { documentName } from "../src/names.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { StepWrites } from "../src/pod.js";
import { PERFORMERS } from "../src/replay.js";
import { REC, type StepContext } from "../src/step.js";
import { readConfig, siblingsOf } from "../src/node/runtime.js";
import {
  compiledBridge,
  findBridgePackage,
  inWorker,
  loadConfiguredAdapters,
} from "../src/node/wasm.js";
import type { ResolverOptions } from "../src/node/resolver.js";
import {
  blank,
  type BlankNode,
  iri,
  RDF,
  type Term,
  type Triple,
} from "../src/rdf.js";
import {
  type CompiledBridge,
  inThread,
  type Spawn,
  WasmBridge,
} from "../src/wasm-bridge.js";
import { notIsomorphic, triples } from "./graphs.js";
import { layout, ROOT, storyFrom, vocabulary } from "./vocabulary.js";

const ALEX = "conformance/alex-rivera/alex-rivera.feature";
const TYPE = `${RDF}type`;
const REVISION = `${REC}Revision`;
const GENERATED_BY = "http://www.w3.org/ns/prov#wasGeneratedBy";
const newStore = (): OxigraphStore => new OxigraphStore();

let compiled: CompiledBridge;
let options: ResolverOptions;
const bridges: WasmBridge[] = [];
const adapters: LoadedAdapter[] = [];
let inWorkerAdapter: LoadedAdapter;
let envelope: string;

async function loaded(spawn: Spawn): Promise<LoadedAdapter> {
  const bridge = new WasmBridge(spawn);
  bridges.push(bridge);
  const { adapters: configured } = await readConfig(ROOT);
  const [fhir] = await loadConfiguredAdapters(bridge, configured, options);
  if (fhir === undefined)
    throw new Error("cascade-runtime.json names no adapter");
  adapters.push(fhir.adapter);
  envelope = `${fhir.resolved.iri}ro-crate-metadata.json#envelope-resource`;
  return fhir.adapter;
}

before(async () => {
  const siblingsIn = await siblingsOf(ROOT);
  options = { siblingsIn, cache: join(ROOT, "build", "cache") };
  compiled = await compiledBridge((await findBridgePackage(options)).folder);
  inWorkerAdapter = await loaded(inWorker(compiled));
});

after(async () => {
  for (const adapter of adapters) await adapter.free();
  for (const bridge of bridges) bridge.close();
});

interface Saved {
  readonly document: BridgeDocument;
  readonly graph: Triple[];
  readonly findings: Triple[];
}

/**
 * A document of Alex's export as an import step of her story converted it: in the envelope for one resource, with the
 * facts the importer writes for it at the step's time, and the Bridge's saved output. The command line that saved it
 * named the document by its path, which the findings give relative to themselves; a runtime names it by its N5 name.
 */
async function saved(step: string, stem: string): Promise<Saved> {
  const files = await vocabulary();
  const { story, folder: alex } = await storyFrom(ALEX);
  const found = story.steps.find(({ name }) => name === step.toUpperCase());
  if (found?.happened.kind !== "import")
    throw new Error(`Alex's story has no import step ${step}`);
  const exportFolder = `${alex}/${found.happened.export}`;
  const path = `${exportFolder}/clinical-records/${stem}.json`;
  const folder = `${alex}/${found.happened.converted}/${stem}/`;
  const [documents, graph, findings] = await Promise.all([
    appleHealthExport.documents(files, exportFolder),
    files.read(`${folder}graph.ttl`),
    files.read(`${folder}findings.ttl`),
  ]);
  const document = documents?.find((each) => each.path === path);
  if (document === undefined || graph === undefined)
    throw new Error(`Alex's kit saves no conversion of ${stem} at ${step}`);
  const name = await documentName(document.bytes);
  const named = (triple: Triple): Triple => {
    const [subject, predicate, object] = triple;
    return object.termType === "NamedNode" &&
      object.value === `${files.iri}${path}`
      ? [subject, predicate, iri(name)]
      : triple;
  };
  return {
    document: {
      iri: name,
      bytes: document.bytes,
      envelope,
      facts: { iri: `${name}#facts`, bytes: document.facts(found.when) },
    },
    graph: triples(graph),
    findings:
      findings === undefined
        ? []
        : triples(findings, `${files.iri}${folder}findings.ttl`).map(named),
  };
}

function same(expected: Saved, found: Conversion): void {
  assert.equal(notIsomorphic(expected.graph, triples(found.graph)), undefined);
  assert.equal(
    notIsomorphic(expected.findings, triples(found.findings)),
    undefined,
  );
}

async function standIn(
  document: BridgeDocument,
  text: string,
): Promise<BridgeDocument> {
  const bytes = new TextEncoder().encode(text);
  return { ...document, iri: await documentName(bytes), bytes };
}

test("Alex's documents convert, in a worker, to graphs isomorphic to the saved ones, with the same findings", async () => {
  for (const [step, stem] of [
    ["e2", "AllergyIntolerance-alg-pcn-1"],
    ["e6", "Immunization-imm-tdap-2026"],
  ] as const) {
    const expected = await saved(step, stem);
    same(expected, await inWorkerAdapter.convert(expected.document));
  }
});

test("a document the adapter cannot read fails with kind document, and the loaded adapter converts the next", async () => {
  const expected = await saved("e2", "AllergyIntolerance-alg-pcn-1");
  await assert.rejects(
    inWorkerAdapter.convert(await standIn(expected.document, "{ not json")),
    (error) => isBridgeError(error) && error.kind === "document",
  );
  same(expected, await inWorkerAdapter.convert(expected.document));
});

test("a fault in the Bridge ends its worker, and the next document converts in a new one", async () => {
  const trapping = new URL("./trapping-bridge.js", import.meta.url);
  trapping.searchParams.set("real", compiled.glue);
  const adapter = await loaded(
    inWorker({ glue: trapping.href, module: compiled.module }),
  );
  const expected = await saved("e2", "AllergyIntolerance-alg-pcn-1");
  await assert.rejects(
    adapter.convert(await standIn(expected.document, "trap")),
    (error) => isBridgeError(error) && error.kind === "bridge",
  );
  same(expected, await adapter.convert(expected.document));
});

test("a conversion in the main thread is the conversion in a worker", async () => {
  const expected = await saved("e6", "Immunization-imm-tdap-2026");
  const [inAWorker, inTheMainThread] = await Promise.all([
    inWorkerAdapter.convert(expected.document),
    loaded(inThread(compiled)).then((adapter) =>
      adapter.convert(expected.document),
    ),
  ]);
  for (const part of ["graph", "findings"] as const) {
    assert.equal(
      notIsomorphic(triples(inAWorker[part]), triples(inTheMainThread[part])),
      undefined,
    );
  }
});

/** A pod's files as one graph, but the imports' own, with each revision and the import that made it as blank nodes. */
async function filed(pod: MemoryFiles): Promise<Triple[]> {
  const triples: Triple[] = [];
  for (const path of await pod.list("")) {
    const { folder: imports } = (await layout()).place(
      "http://www.w3.org/ns/prov#Activity",
      ["http://www.w3.org/ns/prov#used"],
    );
    if (!(await layout()).isRdf(path) || path.startsWith(imports ?? ""))
      continue;
    const bytes = await pod.read(path);
    if (bytes !== undefined)
      triples.push(
        ...(await parseGraph(bytes, pod.iri + path, newStore)).triples,
      );
  }
  const runDependent = new Set(
    triples.flatMap(([s, p, o]) =>
      p.value === GENERATED_BY
        ? [s.value, o.value]
        : p.value === TYPE && o.value === REVISION
          ? [s.value]
          : [],
    ),
  );
  const blanked = <T extends Term>(term: T): T | BlankNode =>
    term.termType === "NamedNode" && runDependent.has(term.value)
      ? blank(term.value)
      : term;
  return triples.map(
    ([s, p, o]) => [blanked(s), p, blanked(o)] as unknown as Triple,
  );
}

test("an export imported through the WebAssembly Bridge files what it files through the saved output", async () => {
  const files = await vocabulary();
  const { story, folder } = await storyFrom(
    "runtime/arrivals.feature",
    "the latex allergy arrives again under a source version it already has, with other content",
  );
  const step = story.steps.find(({ name }) => name === "known-source-version");
  if (step?.happened.kind !== "import") throw new Error("no such import");
  const exported = `${folder}/${step.happened.export}`;
  const pods: Triple[][] = [];
  for (const perform of [
    (context: StepContext) =>
      PERFORMERS.import?.(context, step, {
        source: files,
        folder,
        importers: [appleHealthExport],
        activities: new Map(),
      }),
    async (context: StepContext) =>
      fileExport(
        context,
        (await appleHealthExport.documents(files, exported)) ?? [],
        [inWorkerAdapter],
      ),
  ]) {
    const pod = new MemoryFiles(story.address);
    const time = new StoryTime();
    time.begin(step.when);
    const writes = new StepWrites();
    await perform({
      address: story.address,
      subject: story.subject,
      vocabulary: files,
      pod,
      time,
      writes,
      newStore,
      layout: await layout(),
    });
    await writes.commit(pod);
    pods.push(await filed(pod));
  }
  const [saved, live] = pods;
  assert.ok((saved?.length ?? 0) > 0);
  assert.equal(notIsomorphic(saved ?? [], live ?? []), undefined);
});
