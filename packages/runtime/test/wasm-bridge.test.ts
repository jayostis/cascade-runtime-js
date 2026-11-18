import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  type AdaptersOf,
  type BridgeDocument,
  type Conversion,
  EVERY_FINDING,
  isBridgeError,
  type LoadedAdapter,
} from "../src/bridge.js";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import { CorePod } from "../src/core-pod.js";
import { MemoryFiles } from "../src/files.js";
import { parseGraph } from "../src/graph.js";
import { StoryTime } from "../src/ids.js";
import { ofMediaType } from "../src/load-adapter.js";
import { importersNamed } from "../src/importers.js";
import { type KitFindings, kitFindings } from "../src/kit-findings.js";
import { documentName } from "../src/names.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { probing } from "../src/probe.js";
import { PERFORMERS } from "../src/replay.js";
import { CASCADE } from "../src/step.js";
import { checkouts, type Components } from "../src/node/components.js";
import { FolderFiles } from "../src/node/folder-files.js";
import {
  findBridgePackage,
  releasedBridgePackage,
  stamping,
  unchanged,
} from "../src/node/wasm.js";
import { resolve as resolveComponent } from "../src/node/resolver.js";
import type { Followed } from "../src/config.js";
import {
  compiledBridge,
  endSharedAdapters,
  inWorker,
  loadConfiguredAdapters,
  liveSharedEntries,
  loadSharedAdapters,
  Pool,
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
import { notIsomorphic, triples } from "../src/graphs.js";
import { layout, RUNTIME, ROOT, storyFrom, vocabulary } from "./vocabulary.js";

const ALEX = "conformance/alex-rivera/alex-rivera.feature";
const TYPE = `${RDF}type`;
const REVISION = `${CASCADE}Revision`;
const GENERATED_BY = "http://www.w3.org/ns/prov#wasGeneratedBy";
const newStore = (): OxigraphStore => new OxigraphStore();

let compiled: CompiledBridge;
let components: Components;
const bridges: WasmBridge[] = [];
const adapters: LoadedAdapter[] = [];
let inWorkerAdapter: LoadedAdapter;
let adaptersOf: AdaptersOf;
let everyAdapter: LoadedAdapter[];
let envelope: string;

async function configuredAll(spawn: Spawn) {
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
  adapters.push(...configured.map(({ adapter }) => adapter));
  return configured;
}

async function loadedAll(spawn: Spawn): Promise<LoadedAdapter[]> {
  return (await configuredAll(spawn)).map(({ adapter }) => adapter);
}

async function loaded(spawn: Spawn): Promise<LoadedAdapter> {
  const [fhir] = await loadedAll(spawn);
  if (fhir === undefined) throw new Error("no adapter was loaded");
  return fhir;
}

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
    notIsomorphic(
      expected.findings,
      triples(found.findings ?? new Uint8Array()),
    ),
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
    term.termType === "NamedNode" &&
    runDependent.has(term.value.split("#")[0] ?? "")
      ? blank(term.value)
      : term;
  return triples.map(
    ([s, p, o]) => [blanked(s), p, blanked(o)] as unknown as Triple,
  );
}

/**
 * The Bridge is one WebAssembly module, built by cascade-bridge-rs, that runs every adapter. The runtime runs it in a
 * worker, so a document that crashes it costs one conversion and not the page.
 */
describe("Converting a document with the WebAssembly Bridge · WasmBridge, inWorker(), inThread()", () => {
  before(async () => {
    components = await checkouts(ROOT);
    compiled = await compiledBridge((await components.bridge()).folder);
    const configured = await configuredAll(inWorker(compiled));
    adaptersOf = ofMediaType(configured);
    everyAdapter = configured.map(({ adapter }) => adapter);
    [inWorkerAdapter] = everyAdapter as [LoadedAdapter];
  });

  after(async () => {
    for (const adapter of adapters) await adapter.free();
    for (const bridge of bridges) bridge.close();
  });

  describe("given every import of every kit", () => {
    let found: KitFindings;

    before(async () => {
      found = await kitFindings({
        vocabulary: await vocabulary(),
        importers: importersNamed(components.config.importers),
        adaptersOf,
      });
    });

    it("converts each document to a graph and conversion findings isomorphic to those the kit saves", () => {
      assert.deepEqual(found.differ, []);
      assert.equal(found.converted, 48);
    });

    it("has no adapter accept the document the kit saves as unaccepted", () => {
      assert.equal(found.unaccepted, 1);
      assert.equal(found.acceptedUnaccepted, 0);
    });

    it("skips only an import whose export its importer cannot read and for which the kit saves nothing", () => {
      assert.deepEqual(found.skipped, ["conformance/priya-natarajan E11"]);
    });
  });

  describe("given an adapter loaded in a worker", () => {
    let expected: Saved;

    before(async () => {
      expected = await saved("e2", "AllergyIntolerance-alg-pcn-1");
    });

    it("rejects a document the adapter cannot read with a BridgeError of kind `document`", async () => {
      await assert.rejects(
        inWorkerAdapter.convert(await standIn(expected.document, "{ not json")),
        (error) => isBridgeError(error) && error.kind === "document",
      );
    });

    it("converts the next document with the same loaded adapter", async () => {
      await inWorkerAdapter
        .convert(await standIn(expected.document, "{ not json"))
        .catch(() => undefined);
      same(
        expected,
        await inWorkerAdapter.convert(expected.document, EVERY_FINDING),
      );
    });
  });

  describe("given the same adapters loaded again for another pod", () => {
    const nothing: BridgeDocument = {
      iri: "urn:cascade:test/nothing",
      bytes: new Uint8Array(),
    };
    let bridgeFolder: string;
    let spawn: Spawn;
    let expected: Saved;
    const made: string[] = [];
    let later = Date.now() + 3_600_000;

    before(async () => {
      bridgeFolder = (await components.bridge()).folder;
      spawn = inWorker(compiled);
      expected = await saved("e2", "AllergyIntolerance-alg-pcn-1");
    });

    after(async () => {
      for (const folder of made) {
        await endSharedAdapters(folder);
        await rm(folder, { recursive: true, force: true });
      }
    });

    /** What loads of the adapters over each of `froms` at once, and a first call on each of them, started. */
    async function startedAll(
      froms: readonly Components[],
      on: Spawn = spawn,
      call = true,
    ) {
      const { seen } = await probing(async () => {
        await Promise.all(
          froms.map(async (from) => {
            const bridge = new WasmBridge(on);
            const configured = await loadSharedAdapters(
              bridgeFolder,
              bridge,
              from.config.adapters,
              from,
            );
            for (const { adapter } of configured) {
              if (call) await adapter.accepts(nothing).catch(() => undefined);
              await adapter.free();
            }
            bridge.close();
          }),
        );
      });
      return {
        workers: seen.counts.get("bridge.workers") ?? 0,
        resolved: seen.counts.get("components.resolved") ?? 0,
      };
    }

    const started = (from: Components, on?: Spawn) => startedAll([from], on);

    /** A folder of its own with the first adapter's files, and the components that read the adapter from it. */
    async function adapterCopy(): Promise<{
      folder: string;
      copied: Components;
      first: Followed;
    }> {
      const folder = await mkdtemp(join(tmpdir(), "adapter-copy-"));
      made.push(folder);
      const [first] = components.config.adapters;
      const original = await components.resolve(first as Followed);
      // A load reads the files the description lists; the .git, the fixtures and the bench are megabytes no test here needs.
      await cp(original.folder, folder, {
        recursive: true,
        filter: (from) =>
          !from
            .slice(original.folder.length)
            .split(sep)
            .some((part) => [".git", "fixtures", "bench"].includes(part)),
      });
      const copied: Components = {
        config: { ...components.config, adapters: [first as Followed] },
        resolve: async (followed) =>
          followed === first
            ? { ...original, folder }
            : components.resolve(followed),
        bridge: () => components.bridge(),
      };
      return { folder, copied, first: first as Followed };
    }

    /** The same components, reading the vocabulary from a folder holding the files the adapter names, as they are. */
    async function vocabularyCopy(
      from: Components,
      first: Followed,
    ): Promise<{ folder: string; copied: Components; files: string[] }> {
      const [one] = await loadSharedAdapters(
        bridgeFolder,
        new WasmBridge(spawn),
        [first],
        from,
      );
      const named = one?.description.vocabulary;
      if (named?.repository === undefined)
        throw new Error("the adapter names no vocabulary");
      const at = await from.resolve({ repository: named.repository });
      const folder = await mkdtemp(join(tmpdir(), "vocabulary-copy-"));
      made.push(folder);
      for (const file of named.files) {
        await mkdir(dirname(join(folder, file)), { recursive: true });
        await cp(join(at.folder, file), join(folder, file));
      }
      return {
        folder,
        files: [...named.files],
        copied: {
          ...from,
          resolve: async (followed) =>
            followed.repository === named.repository
              ? { ...at, folder }
              : from.resolve(followed),
        },
      };
    }

    const touch = async (path: string): Promise<void> => {
      later += 60_000;
      await utimes(path, new Date(later), new Date(later));
    };

    it("starts no worker and resolves no component the second time", async () => {
      await started(components);
      assert.deepEqual(await started(components), { workers: 0, resolved: 0 });
    });

    it("resolves the components once for every Components over the same folders", async () => {
      await started(components);
      assert.deepEqual(await started(await checkouts(ROOT)), {
        workers: 0,
        resolved: 0,
      });
    });

    it("reads, to load an adapter, only the files its description lists and the vocabulary files it names", async () => {
      const { folder, copied } = await adapterCopy();
      await mkdir(join(folder, "unlisted"), { recursive: true });
      await writeFile(join(folder, "unlisted", "never-read.bin"), "x");
      const { seen, result } = await probing(async () => {
        const bridge = new WasmBridge(spawn);
        const [one] = await loadSharedAdapters(
          bridgeFolder,
          bridge,
          copied.config.adapters,
          copied,
        );
        await one?.adapter.accepts(nothing).catch(() => undefined);
        bridge.close();
        return one?.description;
      });
      assert.ok(result);
      assert.equal(
        seen.counts.get("adapter.files.read"),
        result.loadFiles.length + (result.vocabulary?.files.length ?? 0),
      );
      assert.ok(
        result.loadFiles.length <
          (await new FolderFiles(folder).list("")).length,
        "the folder holds files the description does not list",
      );
    });

    it("stamps each file before it is read, one read after the load among them, and notices an edit after the read", async () => {
      const folder = await mkdtemp(join(tmpdir(), "stamped-"));
      made.push(folder);
      await writeFile(join(folder, "metadata.json"), "one");
      await writeFile(join(folder, "later.xsd"), "one");
      const stamps = new Map();
      const files = stamping(folder, "https://example.test/", stamps);
      await files.read("metadata.json");
      assert.equal(await unchanged(stamps), true);
      await writeFile(join(folder, "later.xsd"), "edited before its read");
      await files.read("later.xsd");
      assert.equal(
        await unchanged(stamps),
        true,
        "a file read late is stamped as it was before that read",
      );
      await writeFile(
        join(folder, "later.xsd"),
        "edited after its read, longer",
      );
      assert.equal(await unchanged(stamps), false, "the late file is signed");
      await writeFile(join(folder, "later.xsd"), "edited before its read");
      await writeFile(
        join(folder, "metadata.json"),
        "edited after the read, longer",
      );
      assert.equal(
        await unchanged(stamps),
        false,
        "the metadata read first is signed too",
      );
    });

    it("loads an adapter again for each change of what it was given, and for nothing else", async (t) => {
      const { folder, copied, first } = await adapterCopy();
      const vocabulary = await vocabularyCopy(copied, first);
      const inside = join(folder, "ro-crate-metadata.json");
      const changed = async (): Promise<boolean> =>
        (await started(vocabulary.copied)).workers > 0;
      assert.equal(await changed(), true, "the first load");
      assert.equal(await changed(), false, "the second");

      await touch(inside);
      assert.equal(await changed(), true, "a file of its folder changed");
      await writeFile(join(folder, "added.txt"), "more");
      assert.equal(
        await changed(),
        false,
        "a file no description lists was added",
      );
      await rm(join(folder, "added.txt"));
      assert.equal(await changed(), false, "and taken away");
      const listed = (await new FolderFiles(folder).list("in/")).find((path) =>
        path.endsWith(".rq"),
      );
      assert.ok(listed, "a query under in/, which the description lists");
      await touch(join(folder, listed));
      assert.equal(
        await changed(),
        true,
        "a file its description lists changed",
      );
      await touch(join(vocabulary.folder, vocabulary.files[0] as string));
      assert.equal(await changed(), true, "a vocabulary file changed");

      const other = await vocabularyCopy(copied, first);
      assert.equal(
        (await started(other.copied)).workers > 0,
        true,
        "another folder of the vocabulary, the same files",
      );
      assert.equal(await changed(), false, "and back: each folder has its own");

      const outside = await mkdtemp(join(tmpdir(), "behind-a-link-"));
      made.push(outside);
      await writeFile(join(outside, "inside.txt"), "one");
      try {
        await symlink(outside, join(folder, "linked"), "junction");
      } catch {
        t.diagnostic("this system lets no link be made: the link is not tried");
        return;
      }
      await changed();
      await writeFile(join(outside, "inside.txt"), "another, longer");
      assert.equal(
        await changed(),
        false,
        "a folder behind a link, which the adapter is not given",
      );
    });

    it("keeps live the two most recently used vocabulary folders of one adapter folder, and lets the others go", async () => {
      const { folder, copied, first } = await adapterCopy();
      const base = `${bridgeFolder} ${folder}`;
      const vocabularies = [];
      for (let each = 0; each < 4; each += 1) {
        vocabularies.push(await vocabularyCopy(copied, first));
        await started(vocabularies[each]?.copied as Components);
      }
      assert.equal(liveSharedEntries(base), 2, "four folders, two live");
      const [oldest, , older, newest] = vocabularies as Array<{
        copied: Components;
      }>;
      assert.deepEqual(await started(newest?.copied as Components), {
        workers: 0,
        resolved: 0,
      });
      assert.equal(
        (await started(oldest?.copied as Components)).workers > 0,
        true,
        "the oldest was let go and loads again",
      );
      assert.equal(liveSharedEntries(base), 2, "and the cap holds");
      assert.ok(older);
    });

    it("says which version of each it uses on every call, ends the adapter a change replaces, and starts one load for two calls at once", async () => {
      const { folder, copied } = await adapterCopy();
      const said: string[][] = [[], []];
      for (const lines of said)
        await started({
          ...copied,
          resolve: async (followed) => {
            const resolved = await copied.resolve(followed);
            lines.push(`${resolved.iri} ${resolved.folder}`);
            return resolved;
          },
        });
      assert.ok((said[0] as string[]).length >= 2);
      assert.deepEqual(said[1], said[0]);

      let live = 0;
      const counting: Spawn = async () => {
        const channel = await spawn();
        live += 1;
        let ended = false;
        return {
          call: (request, transfer) => channel.call(request, transfer),
          end: () => {
            if (!ended) live -= 1;
            ended = true;
            channel.end();
          },
        };
      };
      await touch(join(folder, "ro-crate-metadata.json"));
      await started(copied, counting);
      const one = live;
      await touch(join(folder, "ro-crate-metadata.json"));
      await started(copied, counting);
      for (let wait = 0; live !== one && wait < 100; wait += 1)
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(live, one, "the adapter replaced is ended");

      await touch(join(folder, "ro-crate-metadata.json"));
      const once = (await startedAll([copied], spawn, false)).workers;
      await touch(join(folder, "ro-crate-metadata.json"));
      assert.equal(
        (await startedAll([copied, copied], spawn, false)).workers,
        once,
      );
    });

    it("runs two documents of one adapter at once, each in an instance of its own", async () => {
      const { copied } = await adapterCopy();
      let working = 0;
      let most = 0;
      const watching: Spawn = async () => {
        const channel = await spawn();
        return {
          call: async (request, transfer) => {
            working += 1;
            most = Math.max(most, working);
            try {
              return await channel.call(request, transfer);
            } finally {
              working -= 1;
            }
          },
          end: () => channel.end(),
        };
      };
      const bridge = new WasmBridge(watching);
      const [shared] = await loadSharedAdapters(
        bridgeFolder,
        bridge,
        copied.config.adapters,
        copied,
      );
      const adapter = (shared as { adapter: LoadedAdapter }).adapter;
      most = 0;
      const both = await Promise.all([
        adapter.convert(expected.document, EVERY_FINDING),
        adapter.convert(expected.document, EVERY_FINDING),
      ]);
      for (const conversion of both) same(expected, conversion);
      assert.equal(most, 2, "two instances at work at the same time");
    });

    it("does not fail a call on one instance for a fault on the other", async () => {
      const { copied } = await adapterCopy();
      const glue = new URL("./trapping-bridge.js", import.meta.url);
      glue.searchParams.set("real", compiled.glue);
      const trapping = inWorker({ glue: glue.href, module: compiled.module });
      const bridge = new WasmBridge(trapping);
      const [shared] = await loadSharedAdapters(
        bridgeFolder,
        bridge,
        copied.config.adapters,
        copied,
      );
      const adapter = (shared as { adapter: LoadedAdapter }).adapter;
      await Promise.all([
        adapter.convert(expected.document, EVERY_FINDING),
        adapter.convert(expected.document, EVERY_FINDING),
      ]);
      const fine = adapter.convert(expected.document, EVERY_FINDING);
      const trapped = adapter.convert(await standIn(expected.document, "trap"));
      await assert.rejects(
        trapped,
        (error) => isBridgeError(error) && error.kind === "bridge",
      );
      same(expected, await fine);
    });
  });

  describe("given a pool of instances of one adapter", () => {
    interface Fake {
      readonly adapter: LoadedAdapter;
      readonly freed: () => number;
      readonly release: () => void;
    }

    /** An instance whose calls end when `release` is called, and that counts the `free`s it is given. */
    function fake(): Fake {
      let freed = 0;
      const waiting: (() => void)[] = [];
      return {
        freed: () => freed,
        release: () => waiting.splice(0).forEach((end) => end()),
        adapter: {
          accepts: () =>
            new Promise<boolean>((end) => waiting.push(() => end(true))),
          convert: () => Promise.reject(new Error("not used")),
          free: () => {
            freed += 1;
            return Promise.resolve();
          },
        },
      };
    }

    const document = { iri: "urn:cascade:test/pool", bytes: new Uint8Array() };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

    it("lets go of an instance once, when its call ends after the pool is retired", async () => {
      const first = fake();
      const pool = new Pool(first.adapter, () =>
        Promise.reject(new Error("no")),
      );
      const call = pool.adapter.accepts(document);
      await settle();
      pool.retire();
      await settle();
      assert.equal(first.freed(), 0, "not while a call is on it");
      first.release();
      assert.equal(await call, true);
      await settle();
      assert.equal(first.freed(), 1);
    });

    it("serves a call from the first instance, which is freed once, when the second fails to load", async () => {
      const first = fake();
      const pool = new Pool(first.adapter, () =>
        Promise.reject(new Error("no")),
      );
      const one = pool.adapter.accepts(document);
      const two = pool.adapter.accepts(document);
      await settle();
      first.release();
      assert.deepEqual(await Promise.all([one, two]), [true, true]);
      pool.retire();
      await settle();
      assert.equal(first.freed(), 1);
    });

    it("starts one instance for the pods holding a retired pool, and keeps it for the calls that follow", async () => {
      const first = fake();
      const later = fake();
      let started = 0;
      const pool = new Pool(first.adapter, () => {
        started += 1;
        return Promise.resolve(later.adapter);
      });
      pool.retire();
      await settle();
      assert.equal(first.freed(), 1);
      const calls = [
        pool.adapter.accepts(document),
        pool.adapter.accepts(document),
      ];
      await settle();
      later.release();
      await Promise.all(calls);
      const again = pool.adapter.accepts(document);
      await settle();
      later.release();
      await again;
      assert.equal(started, 1);
      assert.equal(later.freed(), 0, "kept for the pods still holding it");
    });
  });

  describe("given a build of the Bridge written again into its folder", () => {
    it("compiles the module again", async () => {
      const folder = await mkdtemp(join(tmpdir(), "bridge-build-"));
      try {
        const built = (await components.bridge()).folder;
        for (const file of ["cascade_bridge_bg.wasm", "cascade_bridge.js"])
          await cp(join(built, file), join(folder, file));
        const one = await compiledBridge(folder);
        assert.equal(await compiledBridge(folder), one);
        const later = new Date(Date.now() + 120_000);
        await utimes(join(folder, "cascade_bridge_bg.wasm"), later, later);
        assert.notEqual(await compiledBridge(folder), one);
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });
  });

  describe("given a resolution that fails", () => {
    const cache = join(tmpdir(), "no-such-cache");
    const missing = "file:///no/such/repository.git";

    it("keeps no rejection of a component's resolution", async () => {
      const options = { siblingsIn: [], cache };
      const { seen } = await probing(async () => {
        for (let attempt = 0; attempt < 2; attempt += 1)
          await resolveComponent({ repository: missing }, options).catch(
            () => undefined,
          );
      });
      assert.equal(seen.counts.get("components.resolved"), 2);
    });

    it("keeps no rejection of a search for the Bridge's package", async () => {
      const options = { siblingsIn: [], cache };
      const { seen } = await probing(async () => {
        for (let attempt = 0; attempt < 2; attempt += 1)
          await findBridgePackage(options, missing).catch(() => undefined);
      });
      assert.equal(seen.counts.get("bridge.package.found"), 2);
    });

    it("keeps no rejection of the release it downloads", async () => {
      const one = releasedBridgePackage(cache, missing);
      await assert.rejects(one);
      const two = releasedBridgePackage(cache, missing);
      await assert.rejects(two);
      assert.notEqual(one, two);
    });
  });

  describe("given a Bridge that faults on one document", () => {
    let expected: Saved;
    let adapter: LoadedAdapter;
    let spawns = 0;

    /** The real Bridge, in workers, that traps on the document "trap" and counts the workers it starts. */
    before(async () => {
      expected = await saved("e2", "AllergyIntolerance-alg-pcn-1");
      const glue = new URL("./trapping-bridge.js", import.meta.url);
      glue.searchParams.set("real", compiled.glue);
      const spawn = inWorker({ glue: glue.href, module: compiled.module });
      adapter = await loaded(() => {
        spawns++;
        return spawn();
      });
    });

    it("rejects that document with a BridgeError of kind `bridge`", async () => {
      await assert.rejects(
        adapter.convert(await standIn(expected.document, "trap")),
        (error) => isBridgeError(error) && error.kind === "bridge",
      );
    });

    it("converts the next document in a new worker", async () => {
      await adapter.convert(expected.document, EVERY_FINDING);
      const started = spawns;
      await adapter
        .convert(await standIn(expected.document, "trap"))
        .catch(() => undefined);
      same(expected, await adapter.convert(expected.document, EVERY_FINDING));
      assert.equal(spawns - started, 1, "the workers started after the fault");
    });
  });

  describe("inThread(compiled)", () => {
    it("converts a document, in the main thread, to the graph and conversion findings a worker gives", async () => {
      const expected = await saved("e6", "Immunization-imm-tdap-2026");
      const [inAWorker, inTheMainThread] = await Promise.all([
        inWorkerAdapter.convert(expected.document, EVERY_FINDING),
        loaded(inThread(compiled)).then((adapter) =>
          adapter.convert(expected.document, EVERY_FINDING),
        ),
      ]);
      for (const part of ["graph", "findings"] as const)
        assert.equal(
          notIsomorphic(
            triples(inAWorker[part] ?? new Uint8Array()),
            triples(inTheMainThread[part] ?? new Uint8Array()),
          ),
          undefined,
          part,
        );
    });
  });

  /**
   * The arrivals example of `runtime/arrivals.feature` A3, in which the latex allergy arrives under a source version it
   * already has, with other content, and is a revision.
   * @rule runtime/arrivals.feature A3
   */
  describe("given an export imported once through the saved output and once through the WebAssembly Bridge", () => {
    it("files, the import's own files apart, the same statements both ways", async () => {
      const files = await vocabulary();
      const { story, folder } = await storyFrom(
        "runtime/arrivals.feature",
        "the latex allergy arrives under a source version it already has, with other content, and is a revision",
      );
      const step = story.steps.find(
        ({ name }) => name === "known-source-version",
      );
      if (step?.happened.kind !== "import") throw new Error("no such import");
      const exported = `${folder}/${step.happened.export}`;
      const importSaved = PERFORMERS.import;
      assert.ok(importSaved);
      const pods: Triple[][] = [];
      const podLayout = await layout();
      for (const perform of [
        (pod: CorePod, time: StoryTime) =>
          importSaved(pod, step, {
            source: files,
            folder,
            vocabulary: files,
            activities: new Map(),
            time,
            newStore,
            layout: podLayout,
            writer: () => pod,
          }),
        (pod: CorePod, time: StoryTime) => {
          time.begin(step.when);
          return pod.import(files, exported, async () => () => [
            inWorkerAdapter,
          ]);
        },
      ]) {
        const pod = new MemoryFiles(story.address);
        const time = new StoryTime();
        await perform(
          new CorePod({
            runtime: RUNTIME,
            pod,
            address: story.address,
            subject: story.subject,
            title: "",
            vocabulary: files,
            layout: await layout(),
            newStore,
            time,
            importers: [appleHealthExport],
            references: () =>
              Promise.reject(new Error("an import reads no table")),
          }),
          time,
        );
        pods.push(await filed(pod));
      }
      const [savedPod, live] = pods;
      assert.ok((savedPod?.length ?? 0) > 0);
      assert.equal(notIsomorphic(savedPod ?? [], live ?? []), undefined);
    });
  });
});
