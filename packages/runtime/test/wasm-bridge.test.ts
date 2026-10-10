import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  type BridgeDocument,
  type Conversion,
  isBridgeError,
  type LoadedAdapter,
} from "../src/bridge.js";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import { CorePod } from "../src/core-pod.js";
import { MemoryFiles } from "../src/files.js";
import { parseGraph } from "../src/graph.js";
import { StoryTime } from "../src/ids.js";
import { type Importer } from "../src/importer.js";
import { importersNamed } from "../src/importers.js";
import { kitsOf } from "../src/kit.js";
import { documentName } from "../src/names.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { PERFORMERS } from "../src/replay.js";
import { REC } from "../src/step.js";
import { checkouts, type Components } from "../src/node/components.js";
import {
  compiledBridge,
  inWorker,
  loadConfiguredAdapters,
} from "../src/node/wasm.js";
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
let components: Components;
const bridges: WasmBridge[] = [];
const adapters: LoadedAdapter[] = [];
let inWorkerAdapter: LoadedAdapter;
let everyAdapter: LoadedAdapter[];
let envelope: string;

async function loadedAll(spawn: Spawn): Promise<LoadedAdapter[]> {
  const bridge = new WasmBridge(spawn);
  bridges.push(bridge);
  const configured = await loadConfiguredAdapters(
    bridge,
    components.config.adapters,
    components,
  );
  const [fhir] = configured;
  if (fhir === undefined)
    throw new Error("cascade-runtime.json names no adapter");
  envelope = `${fhir.resolved.iri}ro-crate-metadata.json#envelope-resource`;
  const each = configured.map(({ adapter }) => adapter);
  adapters.push(...each);
  return each;
}

async function loaded(spawn: Spawn): Promise<LoadedAdapter> {
  const [fhir] = await loadedAll(spawn);
  if (fhir === undefined) throw new Error("no adapter was loaded");
  return fhir;
}

before(async () => {
  components = await checkouts(ROOT);
  compiled = await compiledBridge((await components.bridge()).folder);
  everyAdapter = await loadedAll(inWorker(compiled));
  [inWorkerAdapter] = everyAdapter as [LoadedAdapter];
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

/**
 * What differs, by kit, step and stem, between the Bridge output a kit saved for each document its importers find in
 * an import step's download and what the configured adapters make of it: the first to accept it converts it, and
 * where the kit saved that no adapter accepts it, none does.
 */
async function differences(): Promise<{
  readonly differ: string[];
  readonly converted: number;
  readonly unaccepted: number;
}> {
  const files = await vocabulary();
  const importers = importersNamed(components.config.importers);
  const stemOf = (path: string): string => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
  };
  const differ: string[] = [];
  let converted = 0;
  let unaccepted = 0;
  for (const kit of await kitsOf(files)) {
    const { story, folder } = await storyFrom(
      `${kit}/${kit.slice(kit.lastIndexOf("/") + 1)}.feature`,
    );
    for (const step of story.steps) {
      const { happened } = step;
      if (happened.kind !== "import") continue;
      const downloaded = `${folder}/${happened.export}`;
      let documents: Awaited<ReturnType<Importer["documents"]>>;
      try {
        for (const importer of importers)
          if ((documents = await importer.documents(files, downloaded))) break;
      } catch {
        continue;
      }
      for (const document of documents ?? []) {
        const stem = stemOf(document.path);
        const at = `${folder}/${happened.converted}/${stem}/`;
        const named = `${kit} ${step.name} ${stem}`;
        const [graph, findings, refused] = await Promise.all([
          files.read(`${at}graph.ttl`),
          files.read(`${at}findings.ttl`),
          files.read(`${at}unaccepted.txt`),
        ]);
        const iriOf = await documentName(document.bytes);
        const offered: BridgeDocument = {
          iri: iriOf,
          bytes: document.bytes,
          envelope: document.envelope,
          facts: {
            iri: `${iriOf}#facts`,
            bytes: document.facts(step.when),
          },
        };
        let accepting: LoadedAdapter | undefined;
        for (const adapter of everyAdapter)
          if (await adapter.accepts(offered).catch(() => false)) {
            accepting = adapter;
            break;
          }
        if (refused !== undefined) {
          unaccepted++;
          if (accepting !== undefined)
            differ.push(
              `${named}: saved as unaccepted, but an adapter accepts it`,
            );
          continue;
        }
        if (graph === undefined) continue;
        converted++;
        if (accepting === undefined) {
          differ.push(`${named}: no adapter accepts it`);
          continue;
        }
        const made = await accepting.convert(offered);
        const path = `${files.iri}${document.path}`;
        const expectedFindings =
          findings === undefined
            ? []
            : triples(findings, `${files.iri}${at}findings.ttl`).map(
                ([s, p, o]): Triple =>
                  o.termType === "NamedNode" && o.value === path
                    ? [s, p, iri(iriOf)]
                    : [s, p, o],
              );
        const why =
          notIsomorphic(triples(graph), triples(made.graph)) ??
          notIsomorphic(expectedFindings, triples(made.findings));
        if (why !== undefined) differ.push(`${named}: ${why}`);
      }
    }
  }
  return { differ, converted, unaccepted };
}

test("every kit's saved conversions are the Bridge's own: each document converts, in a worker, to a graph isomorphic to the saved one with the same findings, and a document saved as unaccepted is accepted by no adapter", async () => {
  const { differ, converted, unaccepted } = await differences();
  assert.deepEqual(differ, []);
  assert.ok(converted > 0, "no conversion was checked");
  assert.ok(unaccepted > 0, "no unaccepted document was checked");
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
  const importSaved = PERFORMERS.import;
  assert.ok(importSaved);
  const pods: Triple[][] = [];
  for (const perform of [
    (pod: CorePod, time: StoryTime) =>
      importSaved(pod, step, {
        source: files,
        folder,
        activities: new Map(),
        time,
        newStore,
      }),
    (pod: CorePod, time: StoryTime) => {
      time.begin(step.when);
      return pod.import(files, exported, async () => () => [inWorkerAdapter]);
    },
  ]) {
    const pod = new MemoryFiles(story.address);
    const time = new StoryTime();
    await perform(
      new CorePod({
        pod,
        address: story.address,
        subject: story.subject,
        title: "",
        vocabulary: files,
        layout: await layout(),
        newStore,
        time,
        importers: [appleHealthExport],
        references: () => Promise.reject(new Error("an import reads no table")),
      }),
      time,
    );
    pods.push(await filed(pod));
  }
  const [saved, live] = pods;
  assert.ok((saved?.length ?? 0) > 0);
  assert.equal(notIsomorphic(saved ?? [], live ?? []), undefined);
});
