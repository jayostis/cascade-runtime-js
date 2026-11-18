import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import { Revisions } from "../src/arrivals.js";
import {
  deriveWith,
  type VocabularyBuild,
  vocabularyBuild,
  vocabularyDerive,
} from "../src/build.js";
import { CorePod, type CorePodOptions } from "../src/core-pod.js";
import { dataset, podFiles } from "../src/dataset.js";
import { type Files, MemoryFiles } from "../src/files.js";
import { randomId } from "../src/ids.js";
import { LAYOUT_FILE, LAYOUT_GRAPH, Layout } from "../src/layout.js";
import { matcherView, runMatcher } from "../src/matcher.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { probing } from "../src/probe.js";
import {
  iri,
  KeptFiles,
  KeptLines,
  literal,
  ntriples,
  type Triple,
  written,
} from "../src/rdf.js";
import { References } from "../src/references.js";
import { StepWrites } from "../src/pod.js";
import { type Perform, PERFORMERS, type Replayed } from "../src/replay.js";
import { Refusal, type StepContext } from "../src/step.js";
import {
  RestorableUnion,
  type Row,
  type Rows,
  type Store,
  Union,
} from "../src/store.js";
import { layout, replayed, RUNTIME, vocabulary } from "./vocabulary.js";

const SYNC_RUN =
  "after both writers imported one export, the sync's run takes only the entry the other writer made";
/** The rows of `query` over each RDF file of the pod but those the build writes, with nothing derived. */
async function podRows(
  context: Pick<StepContext, "layout" | "pod" | "address" | "newStore">,
  query: string,
): Promise<Rows> {
  const union = new Union(context.newStore());
  try {
    await podFiles(context.pod, context.layout, context.address, union);
    return await union.select(query);
  } finally {
    union.store.free?.();
  }
}

const GRAPHS = "SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }";

/** Every quad of the matcher's view, each blank node one placeholder, sorted. */
async function matcherViewQuads(pod: CorePod): Promise<string[]> {
  const { rows } = await pod.select(
    "SELECT ?g ?s ?p ?o WHERE { GRAPH ?g { ?s ?p ?o } }",
  );
  return rows
    .map((row) =>
      ["g", "s", "p", "o"]
        .map((name) => {
          const term = row.get(name);
          return term?.termType === "BlankNode"
            ? "_:b"
            : written(term ?? iri("urn:unbound"));
        })
        .join(" "),
    )
    .sort();
}

/** Every quad the store holds, each blank node by its label or, `placeholders`, as one placeholder, sorted. */
async function storeQuads(
  store: Store,
  placeholders = false,
): Promise<string[]> {
  const { rows } = await store.select(
    "SELECT ?g ?s ?p ?o WHERE { GRAPH ?g { ?s ?p ?o } }",
    new Set(),
  );
  return rows
    .map((row) =>
      ["g", "s", "p", "o"]
        .map((name) => {
          const term = row.get(name) ?? iri("urn:unbound");
          return placeholders && term.termType === "BlankNode"
            ? "_:b"
            : written(term);
        })
        .join(" "),
    )
    .sort();
}

const graphsOf = (rows: readonly Row[]): Set<string> =>
  new Set(rows.flatMap((row) => row.get("g")?.value ?? []));

/**
 * The sync story replayed with the build kept across steps, its run that takes records performed as `run` performs it.
 * The runs that patch a prototype restore it before the step ends, so one replay at a time may patch.
 */
async function replaySyncRun(
  run: Perform,
  options: { readonly renewAfterMoved?: number } = {},
): Promise<Replayed> {
  const files = await vocabulary();
  const build = await vocabularyBuild(files, await layout());
  const done = await replayed("runtime/sync.feature", SYNC_RUN, {
    importers: [appleHealthExport],
    build: {
      lens: "everyday",
      derive: deriveWith(build),
      incremental: build,
      ...(options.renewAfterMoved === undefined
        ? {}
        : { renewAfterMoved: options.renewAfterMoved }),
    },
    performers: {
      ...PERFORMERS,
      matcher: (pod, step, side) =>
        step.happened.kind === "matcher" && step.happened.takes !== undefined
          ? run(pod, step, side)
          : (PERFORMERS.matcher as Perform)(pod, step, side),
    },
  });
  assert.equal(done.stopped, undefined);
  return done;
}

/** What a pod keeping its build did around one run of the matcher that takes records. */
interface TakingRun {
  readonly step: string;
  /** The kept dataset's quads before the run, and at the run's first write to a file. */
  readonly before: string[];
  readonly atFirstWrite: string[] | undefined;
  readonly dropped: number;
  readonly wrote: number;
  /** The next `dataset()`'s quads before a `select()`, and again after it, and the graphs each of the two read. */
  readonly beforeSelect: string[];
  readonly afterSelect: string[];
  readonly lent: ReadonlySet<string>;
  readonly all: ReadonlySet<string>;
  /** The graphs a `select()` leaves out: the layout and the manifest the build writes. */
  readonly built: readonly string[];
  /** Every graph of a file the build writes, and the layout's. */
  readonly rebuilt: ReadonlySet<string>;
}

let takingRuns: Promise<TakingRun[]> | undefined;

/**
 * The sync story's runs that take records, each performed with the kept dataset watched: what it held before, when the
 * step first wrote, and then what a `select()` lends and the next `dataset()` holds. Made once, for the leaves of
 * two situations; never written after.
 */
function runsTakingRecords(): Promise<TakingRun[]> {
  takingRuns ??= (async () => {
    const laidOut = await layout();
    const runs: TakingRun[] = [];
    await replaySyncRun(async (pod, step, side) => {
      const kept = await pod.dataset("everyday");
      const before = await storeQuads(kept.store);
      const drop = kept.store.drop.bind(kept.store);
      let dropped = 0;
      kept.store.drop = (graph) => {
        dropped += 1;
        return drop(graph);
      };
      let atFirstWrite: string[] | undefined;
      const { write, writeNew } = MemoryFiles.prototype;
      const watched = async (): Promise<void> => {
        atFirstWrite ??= await storeQuads(kept.store);
      };
      MemoryFiles.prototype.write = async function (path, bytes) {
        await watched();
        return write.call(this, path, bytes);
      };
      MemoryFiles.prototype.writeNew = async function (path, bytes) {
        await watched();
        return writeNew.call(this, path, bytes);
      };
      let performed;
      try {
        performed = await (PERFORMERS.matcher as Perform)(pod, step, side);
      } finally {
        Object.assign(MemoryFiles.prototype, { write, writeNew });
        kept.store.drop = drop;
      }
      const beforeSelect = await storeQuads(
        (await pod.dataset("everyday")).store,
      );
      const lent = graphsOf((await pod.select(GRAPHS)).rows);
      const next = await pod.dataset("everyday");
      const all = graphsOf((await next.select(GRAPHS)).rows);
      runs.push({
        step: step.name,
        before,
        atFirstWrite,
        dropped,
        wrote: performed.wrote.length,
        beforeSelect,
        afterSelect: await storeQuads(next.store),
        lent,
        all,
        built: [LAYOUT_GRAPH, pod.files.iri + laidOut.manifest],
        rebuilt: new Set([
          LAYOUT_GRAPH,
          ...laidOut.rebuilt.map((path) => pod.files.iri + path),
        ]),
      });
      return performed;
    });
    return runs;
  })();
  return takingRuns;
}

/**
 * With `build.incremental`, a pod keeps its dataset and what it derived from one step to the next, rebuilds only the
 * records a step reached, and lends the dataset to the matcher for the length of a run. What it then reads, derives and
 * writes is what a pod built whole after every step would. `select(query)` takes a SPARQL SELECT and returns the rows it
 * gives over the pod's dataset.
 * @rule runtime/currency.feature C8
 */
describe("Keeping one build of a pod across steps · CorePodOptions.build, CorePod.select()", () => {
  describe("given a pod replayed with its build kept", () => {
    /** How the matcher's view lent from the kept dataset compared, after each step, with the one a pod keeping nothing reads. */
    interface Compared {
      readonly kinds: string[];
      readonly stopped: unknown;
      readonly steps: { name: string; copied: string[]; read: string[] }[];
    }
    let synced: Compared;
    let adopted: Compared;

    const compare = async (
      feature: string,
      example: string,
    ): Promise<Compared> => {
      const files = await vocabulary();
      const derive = await vocabularyDerive(files, await layout());
      const compared: Compared = { kinds: [], stopped: undefined, steps: [] };
      const done = await replayed(feature, example, {
        importers: [appleHealthExport],
        build: { lens: "everyday", derive },
        performers: Object.fromEntries(
          Object.entries(PERFORMERS).map(([kind, perform]) => [
            kind,
            async (pod: CorePod, step, context) => {
              const performed = await perform(pod, step, context);
              const copied = await matcherViewQuads(pod);
              const read = await matcherViewQuads(await pod.fork(context.time));
              compared.steps.push({ name: step.name, copied, read });
              compared.kinds.push(step.happened.kind);
              return performed;
            },
          ]),
        ) as typeof PERFORMERS,
      });
      return { ...compared, stopped: done.stopped };
    };

    before(async () => {
      [synced, adopted] = await Promise.all([
        compare(
          "runtime/sync.feature",
          "after both writers imported one export, the sync's run takes only the entry the other writer made",
        ),
        compare(
          "runtime/opening.feature",
          "adopting a rule list version that adds R3 judges the pairs R3 joins among records already matched, and asserts no matcher judgment of a rule it left unchanged",
        ),
      ]);
    });

    it("returns from `select()`, after every step of a story with a sync, the quads a pod that keeps nothing reads", () => {
      assert.equal(synced.stopped, undefined);
      assert.ok(synced.kinds.includes("matcher"));
      assert.ok(synced.kinds.includes("sync"));
      for (const step of synced.steps) {
        assert.ok(step.copied.length > 0, step.name);
        assert.deepEqual(step.copied, step.read, step.name);
      }
    });

    it("returns from `select()`, after every step of a story that adopts tables, the quads a pod that keeps nothing reads", () => {
      assert.equal(adopted.stopped, undefined);
      assert.ok(adopted.kinds.includes("matcher"));
      assert.ok(adopted.kinds.includes("open"));
      for (const step of adopted.steps) {
        assert.ok(step.copied.length > 0, step.name);
        assert.deepEqual(step.copied, step.read, step.name);
      }
    });
  });

  /**
   * The hash a manifest names (`cascade:buildInputsHash`) changes with each thing a build reads, and with nothing else:
   * one row a thing, each a pod opened over its files with one input changed, its hash compared with the pod's own.
   */
  describe("given a pod whose build is kept beside it · CorePod.buildInputsHash()", () => {
    const ADDRESS = "https://pod.example/";
    const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
    const PROV = "http://www.w3.org/ns/prov#";
    const SERIES = "urn:example:series";
    const FILED = "urn:uuid:5b0c6c1e-3f1d-4c8e-9a51-0d6f2b7a9c11";
    const UNFILED = "urn:uuid:5b0c6c1e-3f1d-4c8e-9a51-0d6f2b7a9c12";
    const UNHELD = "urn:uuid:5b0c6c1e-3f1d-4c8e-9a51-0d6f2b7a9c13";
    let hashOf: (
      change: Partial<CorePodOptions>,
    ) => Promise<string | undefined>;
    let files: Record<string, string>;
    let laidOut: Layout;
    let tables: (versions: readonly string[]) => Promise<References>;
    let base: CorePodOptions;

    before(async () => {
      const vocabularyFiles = await vocabulary();
      laidOut = await layout();
      const incremental = await vocabularyBuild(vocabularyFiles, laidOut);
      const newStore = () => new OxigraphStore();
      tables = (versions) => {
        const index = new MemoryFiles("urn:example:tables/");
        return index
          .write(
            "references.ttl",
            new TextEncoder().encode(
              `<${SERIES}> a <${CASCADE}ReferenceSeries> .\n` +
                versions
                  .map(
                    (version) =>
                      `<${version}> <${PROV}specializationOf> <${SERIES}> .\n`,
                  )
                  .join(""),
            ),
          )
          .then(() => References.of(index, "", newStore));
      };
      const series = laidOut.place(`${CASCADE}ReferenceSeries`);
      files = {
        [laidOut.card]: "<#me> a <http://xmlns.com/foaf/0.1/Person> .\n",
        [laidOut.preferences]: "<#settings> a <urn:example:Settings> .\n",
        [laidOut.version(series, FILED)]:
          `<${FILED}> a <urn:example:Version> .\n`,
        [laidOut.version(series, UNHELD)]:
          `<${UNHELD}> a <urn:example:Version> .\n`,
        ".DS_Store": "junk",
        "profile/.acl": "<#owner> a <urn:example:Owner> .\n",
      };
      base = {
        runtime: RUNTIME,
        pod: new MemoryFiles(ADDRESS),
        address: ADDRESS,
        subject: "urn:uuid:7c2d9e41-5a8b-4f36-b0e2-9d1a4c6f8e53",
        title: "",
        vocabulary: vocabularyFiles,
        layout: laidOut,
        newStore,
        time: { newId: randomId, now: () => "2026-02-01T08:00:00Z" },
        importers: [],
        references: () => tables([FILED]),
        besidePod: new MemoryFiles("urn:example:beside/"),
        build: {
          lens: "everyday",
          derive: () => Promise.reject(new Error("not built")),
          incremental,
        },
      };
      hashOf = async (change) =>
        new CorePod({
          ...base,
          pod: await podWith({}),
          ...change,
        }).buildInputsHash();
    });

    /** The pod's files with those given put in. */
    async function podWith(
      changed: Record<string, string>,
    ): Promise<MemoryFiles> {
      const pod = new MemoryFiles(ADDRESS);
      for (const [path, text] of Object.entries({ ...files, ...changed }))
        await pod.write(path, new TextEncoder().encode(text));
      return pod;
    }

    it("changes with each thing a build reads, and with nothing else", async () => {
      const own = await hashOf({});
      assert.ok(own !== undefined);
      const incremental = await vocabularyBuild(await vocabulary(), laidOut);
      const { derivations } = incremental;
      const changedLayout = new MemoryFiles("urn:example:vocabulary/");
      await changedLayout.write(
        LAYOUT_FILE,
        new TextEncoder().encode(`${laidOut.turtle}\n# changed\n`),
      );
      const otherLayout = await Layout.read(
        changedLayout,
        () => new OxigraphStore(),
      );
      const build = (over: Partial<VocabularyBuild>) => ({
        lens: "everyday",
        derive: () => Promise.reject(new Error("not built")),
        incremental: { ...incremental, ...over },
      });
      const vocabularyFiles = await vocabulary();
      const comparison = "queries/matcher/same-added.rq";
      const withComparison: Files = {
        iri: vocabularyFiles.iri,
        read: (path) =>
          path === comparison
            ? Promise.resolve(new TextEncoder().encode("# a comparison\n"))
            : vocabularyFiles.read(path),
        write: (path, bytes) => vocabularyFiles.write(path, bytes),
        list: async (folder) => {
          const listed = await vocabularyFiles.list(folder);
          return comparison.startsWith(folder)
            ? [...listed, comparison]
            : listed;
        },
      };
      const rows: [string, Partial<CorePodOptions>, boolean][] = [
        ["nothing changed", {}, false],
        ["the runtime", { runtime: `${RUNTIME}#other` }, true],
        ["the runtime's built code", { builtCode: "other" }, true],
        [
          "a comparison of the matcher's in the vocabulary",
          { vocabulary: withComparison },
          true,
        ],
        ["the lens", { build: { ...build({}), lens: "export" } }, true],
        ["the pod's address", { address: "https://other.example/" }, true],
        [
          "a version the pod files arriving in the app's tables",
          { references: () => tables([FILED, UNHELD]) },
          true,
        ],
        [
          "a new current version of a series the pod files a version of, in the app's tables",
          {
            references: async () => {
              const index = new MemoryFiles("urn:example:newer-tables/");
              await index.write(
                "references.ttl",
                new TextEncoder().encode(
                  `<${SERIES}> a <${CASCADE}ReferenceSeries> ; <${CASCADE}defaultTableVersion> <${UNFILED}> .
<${FILED}> <${PROV}specializationOf> <${SERIES}> .
<${UNFILED}> <${PROV}specializationOf> <${SERIES}> .
`,
                ),
              );
              return References.of(index, "", () => new OxigraphStore());
            },
          },
          false,
        ],
        [
          "a series' kind changing in the app's tables, with no new version",
          {
            references: async () => {
              const index = new MemoryFiles("urn:example:rekinded-tables/");
              await index.write(
                "references.ttl",
                new TextEncoder().encode(
                  `<${SERIES}> a <${CASCADE}ReferenceSeries> ; <${CASCADE}tableKind> <${CASCADE}SubstanceIngredients> .
<${FILED}> <${PROV}specializationOf> <${SERIES}> .
`,
                ),
              );
              return References.of(index, "", () => new OxigraphStore());
            },
          },
          true,
        ],
        [
          "a version the pod does not file arriving in the app's tables",
          { references: () => tables([FILED, UNFILED]) },
          false,
        ],
        [
          "a table the pod files nothing of arriving in the app's tables",
          {
            references: async () => {
              const index = new MemoryFiles("urn:example:other-tables/");
              await index.write(
                "references.ttl",
                new TextEncoder().encode(
                  `<${SERIES}> a <${CASCADE}ReferenceSeries> .\n<${FILED}> <${PROV}specializationOf> <${SERIES}> .\n<urn:example:other-1> <${PROV}specializationOf> <urn:example:other> .\n`,
                ),
              );
              return References.of(index, "", () => new OxigraphStore());
            },
          },
          false,
        ],
        [
          "a derivation's text",
          {
            build: build({
              derivations: Object.assign(Object.create(derivations), {
                for: (lens: string) => [
                  ...derivations.for(lens),
                  {
                    path: "queries/derivations/changed.rq",
                    query: "# changed",
                  },
                ],
              }) as typeof derivations,
            }),
          },
          true,
        ],
        [
          "the build's queries",
          { build: build({ queries: [...incremental.queries, "# changed"] }) },
          true,
        ],
        ["the layout", { layout: otherLayout }, true],
        [
          "the settings",
          {
            pod: await podWith({
              [laidOut.preferences]: "<#settings> a <urn:example:Other> .\n",
            }),
          },
          true,
        ],
        [
          "the profile card",
          {
            pod: await podWith({
              [laidOut.card]: "<#me> a <urn:example:Other> .\n",
            }),
          },
          true,
        ],
        [
          "a file of the snapshot set arriving with no step",
          {
            pod: await podWith({
              [laidOut.version(
                laidOut.place(`${CASCADE}ReferenceSeries`),
                UNFILED,
              )]: `<${UNFILED}> a <urn:example:Version> .\n`,
            }),
          },
          true,
        ],
        [
          "the bytes of a file that is not RDF the layout reads, a .DS_Store",
          { pod: await podWith({ ".DS_Store": "other junk" }) },
          false,
        ],
        [
          "the bytes of a macOS resource fork's `._x.ttl`",
          {
            pod: await podWith({
              "records/._x.ttl": "<#x> a <urn:example:Other> .\n",
            }),
          },
          false,
        ],
        [
          "the bytes of a `Thumbs.db`",
          { pod: await podWith({ "records/Thumbs.db": "junk" }) },
          false,
        ],
        [
          "the bytes of a Solid .acl, which is not a .ttl",
          {
            pod: await podWith({
              "profile/.acl": "<#owner> a <urn:example:Other> .\n",
            }),
          },
          false,
        ],
        [
          "a file in the stored documents' folder that names no document",
          {
            pod: await podWith({
              [`${laidOut.storedBytes.folder ?? ""}.DS_Store`]: "junk",
            }),
          },
          false,
        ],
      ];
      const found: string[] = [];
      for (const [what, change, changes] of rows)
        if (((await hashOf(change)) !== own) !== changes)
          found.push(`${what}: ${changes ? "same hash" : "another hash"}`);
      assert.deepEqual(found, []);
    });

    it("keeps nothing beside the pod in a fork of it, which stands over a copy of its files", async () => {
      const pod = new CorePod({ ...base, pod: await podWith({}) });
      assert.ok((await pod.buildInputsHash()) !== undefined);
      const fork = await pod.fork(base.time);
      assert.equal(await fork.buildInputsHash(), undefined);
    });
  });

  describe("when a match runs", () => {
    let runs: TakingRun[];

    before(async () => {
      runs = await runsTakingRecords();
    });

    it("puts back every quad of the kept dataset but the files the build writes and the layout, each blank node the node it was, before the step writes a file; those stay out until a read, the next `dataset()`", () => {
      assert.ok(runs.length > 0);
      for (const run of runs) {
        assert.ok(run.wrote > 0 && run.dropped > 0, run.step);
        assert.deepEqual(
          run.atFirstWrite,
          run.before.filter(
            (quad) => !run.rebuilt.has(quad.slice(1, quad.indexOf(">"))),
          ),
          run.step,
        );
      }
    });
  });

  describe("when a match runs and nothing reads the pod after it", () => {
    interface Kept {
      readonly step: string;
      readonly rebuilt: ReadonlySet<string>;
      readonly before: ReadonlySet<string>;
      readonly atKeep: ReadonlySet<string>;
    }
    let kept: Kept[];

    before(async () => {
      const laidOut = await layout();
      kept = [];
      await replaySyncRun(
        async (pod, step, side) => {
          const { store } = await pod.dataset("everyday");
          const graphs = async () =>
            graphsOf((await store.select(GRAPHS, new Set())).rows);
          const before = await graphs();
          const performed = await (PERFORMERS.matcher as Perform)(
            pod,
            step,
            side,
          );
          await pod.keepBuild();
          kept.push({
            step: step.name,
            rebuilt: new Set([
              LAYOUT_GRAPH,
              ...laidOut.rebuilt.map((path) => pod.files.iri + path),
            ]),
            before,
            atKeep: await graphs(),
          });
          return performed;
        },
        { renewAfterMoved: Number.MAX_SAFE_INTEGER },
      );
    });

    it("holds the files the build writes and the layout in the kept build's union when `keepBuild()` keeps it", () => {
      assert.ok(kept.length > 0);
      for (const one of kept) {
        const built = [...one.before].filter((graph) => one.rebuilt.has(graph));
        assert.ok(built.length > 0, one.step);
        for (const graph of built)
          assert.ok(one.atKeep.has(graph), `${one.step}: ${graph}`);
      }
    });
  });

  describe("when lending the matcher its view fails part way through taking the files the build writes out", () => {
    interface Lent {
      readonly step: string;
      readonly whole: string[];
      readonly next: string[];
    }
    let lent: Lent[];

    before(async () => {
      lent = [];
      await replaySyncRun(
        async (pod, step, side) => {
          const performed = await (PERFORMERS.matcher as Perform)(
            pod,
            step,
            side,
          );
          const { store } = await pod.dataset("everyday");
          const whole = await storeQuads(store);
          const drop = store.drop.bind(store);
          let drops = 0;
          store.drop = (graph) => {
            drops += 1;
            if (drops === 2) throw new Error("the drop fails");
            return drop(graph);
          };
          try {
            await assert.rejects(pod.select(GRAPHS), /the drop fails/);
          } finally {
            store.drop = drop;
          }
          lent.push({
            step: step.name,
            whole,
            next: await storeQuads((await pod.dataset("everyday")).store),
          });
          return performed;
        },
        { renewAfterMoved: Number.MAX_SAFE_INTEGER },
      );
    });

    it("returns from the next `dataset()` every quad the pod held before", () => {
      assert.ok(lent.length > 0);
      for (const one of lent) assert.deepEqual(one.next, one.whole, one.step);
    });
  });

  describe("when a match is refused, or fails, after it changed the matcher's view", () => {
    interface Failed {
      readonly failure: Error;
      readonly rejectedWith: unknown;
      readonly changed: boolean;
      readonly released: boolean;
      readonly before: string[];
      readonly after: string[];
    }
    let failed: Failed[];

    before(async () => {
      const files = await vocabulary();
      const laidOut = await layout();
      failed = [];
      await replaySyncRun(async (pod, step, side) => {
        const takes =
          step.happened.kind === "matcher" ? step.happened.takes : "";
        const activity = side.activities.get(takes ?? "");
        assert.ok(activity !== undefined, step.name);
        const lentFrom = await matcherView({
          layout: laidOut,
          pod: pod.files,
          address: pod.files.iri,
          vocabulary: files,
          newStore: side.newStore,
        });
        let lent: RestorableUnion | undefined;
        const context: StepContext = {
          address: pod.files.iri,
          subject: "",
          pod: pod.files,
          time: side.time,
          writes: new StepWrites(),
          newStore: side.newStore,
          layout: laidOut,
          vocabulary: files,
          matcherView: async () =>
            (lent ??= new RestorableUnion(lentFrom.store, lentFrom.graphs)),
          releaseMatcherView: async () => {
            await lent?.restore();
            lent = undefined;
          },
          keptDataset: async () => undefined,
          selectStated: (query) =>
            podRows(
              {
                layout: laidOut,
                pod: pod.files,
                address: pod.files.iri,
                newStore: side.newStore,
              },
              query,
            ),
        };
        const references = await References.of(
          side.source,
          `${side.folder}/references/`,
          side.newStore,
        );
        const before = await storeQuads(lentFrom.store);
        for (const failure of [new Refusal("refused"), new Error("failed")]) {
          let rowsAdded = false;
          let changed = false;
          const failing = new Proxy(references, {
            get(target, key) {
              if (key === "rows")
                return (...args: Parameters<References["rows"]>) => {
                  rowsAdded ||= args[1] !== undefined;
                  return target.rows(...args);
                };
              if (key === "description" && rowsAdded)
                return (thing: string) => {
                  changed = lent?.graphs.has(thing) ?? false;
                  throw failure;
                };
              const value: unknown = Reflect.get(target, key, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
          let rejectedWith: unknown;
          try {
            await runMatcher(context, failing, activity);
          } catch (error) {
            rejectedWith = error;
          }
          failed.push({
            failure,
            rejectedWith,
            changed,
            released: lent === undefined,
            before,
            after: await storeQuads(lentFrom.store),
          });
        }
        lentFrom.store.free?.();
        return (PERFORMERS.matcher as Perform)(pod, step, side);
      });
    });

    it("rejects with the refusal or the failure itself", () => {
      assert.equal(failed.length, 2);
      for (const one of failed)
        assert.equal(one.rejectedWith, one.failure, one.failure.message);
    });

    it("puts back every quad of the dataset the view was lent from", () => {
      assert.equal(failed.length, 2);
      for (const one of failed) {
        assert.ok(one.changed && one.released, one.failure.message);
        assert.deepEqual(one.after, one.before, one.failure.message);
      }
    });
  });

  describe("Layout.loads()", () => {
    it("refuses a `._` file, even one named .ttl, a `Thumbs.db`, a `.DS_Store`, a Solid `.acl` and `.meta` and an `.icloud` placeholder, and takes a .ttl file and a file the layout gives by itself", async () => {
      const laidOut = await layout();
      const refused = [
        "._x.ttl",
        "records/._x.ttl",
        "Thumbs.db",
        "records/Thumbs.db",
        ".DS_Store",
        "records/allergies/.acl",
        "records/allergies/x.ttl.meta",
        "records/.x.ttl.icloud",
        `${laidOut.storedBytes.folder ?? ""}x.ttl`,
      ];
      assert.deepEqual(
        refused.filter((path) => laidOut.loads(path)),
        [],
      );
      assert.equal(laidOut.loads("records/x.ttl"), true);
      assert.equal(laidOut.loads(laidOut.preferences), true);
    });
  });

  describe("CorePod.select()", () => {
    let runs: TakingRun[];

    before(async () => {
      runs = await runsTakingRecords();
    });

    it("leaves the layout and the files the build writes out of the graphs it reads", () => {
      assert.ok(runs.length > 0);
      for (const run of runs)
        for (const graph of run.built)
          assert.ok(run.all.has(graph) && !run.lent.has(graph), graph);
    });

    it("leaves the next `dataset()` every quad it held before", () => {
      assert.ok(runs.length > 0);
      for (const run of runs)
        assert.deepEqual(run.afterSelect, run.beforeSelect, run.step);
    });
  });

  describe("when the kept store fails to renew", () => {
    interface Renewal {
      readonly failure: unknown;
      readonly kept: string[];
      readonly whole: string[];
      readonly manifest: string;
    }
    let renewals: Renewal[];

    before(async () => {
      const laidOut = await layout();
      const query = "SELECT ?s WHERE { ?s ?p ?o } LIMIT 1";
      renewals = [];
      await replaySyncRun(
        async (pod, step, side) => {
          const performed = await (PERFORMERS.matcher as Perform)(
            pod,
            step,
            side,
          );
          const kept = await storeQuads(
            (await pod.dataset("everyday")).store,
            true,
          );
          const { renewed } = OxigraphStore.prototype;
          OxigraphStore.prototype.renewed = function (): Promise<Store> {
            this.free();
            return Promise.reject(new Error("the renewal fails"));
          };
          let failure: unknown;
          try {
            await pod.select(query);
          } catch (error) {
            OxigraphStore.prototype.renewed = renewed;
            throw error;
          }
          try {
            await pod.dataset("everyday");
          } catch (error) {
            failure = error;
          } finally {
            OxigraphStore.prototype.renewed = renewed;
          }
          const whole = await pod.dataset("everyday");
          renewals.push({
            failure,
            kept,
            whole: await storeQuads(whole.store, true),
            manifest: `<${pod.files.iri}${laidOut.manifest}>`,
          });
          return performed;
        },
        { renewAfterMoved: 1 },
      );
    });

    it("rejects the next `dataset()` with the failure", () => {
      assert.ok(renewals.length > 0);
      for (const one of renewals) {
        assert.ok(one.failure instanceof Error);
        assert.match(one.failure.message, /the renewal fails/);
      }
    });

    it("returns from the next `dataset()` the quads a pod read whole holds", () => {
      // A pod read whole between steps does not know the snapshot the kept build used, which the manifest names.
      assert.ok(renewals.length > 0);
      for (const one of renewals) {
        const unbuilt = (quads: string[]) =>
          quads.filter((quad) => !quad.startsWith(one.manifest));
        assert.deepEqual(unbuilt(one.whole), unbuilt(one.kept));
      }
    });
  });

  describe("Revisions.of()", () => {
    let held: { fromKept: Revisions; fromFiles: Revisions; records: string[] };

    before(async () => {
      const files = await vocabulary();
      const done = await replayed(
        "runtime/arrivals.feature",
        "the peanut allergy changes and changes back, and its third revision sets its first version again",
        { importers: [appleHealthExport] },
      );
      const { pod, layout: laidOut, story, steps } = done;
      const newStore = (): OxigraphStore => new OxigraphStore();
      const kept = await dataset(
        done,
        steps.at(-1)?.step.name ?? "",
        "everyday",
        newStore(),
        await vocabularyDerive(files, laidOut),
      );
      const context = {
        pod,
        newStore,
        layout: laidOut,
        vocabulary: files,
        address: story.address,
      };
      const [fromFiles, fromKept] = await Promise.all([
        Revisions.of({ ...context, keptDataset: async () => undefined }),
        Revisions.of({ ...context, keptDataset: async () => kept }),
      ]);
      const records = (
        await kept.select(
          "SELECT DISTINCT ?record WHERE { ?revision <https://ns.cascadeprotocol.org/cascade#revisionOf> ?record }",
        )
      ).rows.flatMap((row) => row.get("record")?.value ?? []);
      held = { fromKept, fromFiles, records };
    });

    it("returns the same latest revisions and files from the kept dataset as from the records' files", () => {
      assert.ok(
        held.records.some(
          (record) => held.fromFiles.held(record).files.length > 3,
        ),
      );
      for (const record of held.records)
        assert.deepEqual(
          held.fromKept.held(record),
          held.fromFiles.held(record),
          record,
        );
    });
  });

  /**
   * A built file is written from the lines kept for it: each triple's line by the triple (a rebuild hands back, as the
   * same object, each triple that did not change), and the lines last written, sorted. A rebuild writes a line only for
   * a triple it was not given before, and sorts only the lines it adds, and the file is the bytes a write from nothing
   * gives.
   */
  describe("given a built file written again from its kept lines · ntriples()", () => {
    const record = (n: number): Triple[] =>
      ["a", "b", "c", "d"].map(
        (name) =>
          [
            iri(`urn:example:record/${n}`),
            iri(`urn:example:${name}`),
            literal(`${name}${n}`),
          ] as Triple,
      );
    const lines = async (
      run: () => Uint8Array,
    ): Promise<{ bytes: Uint8Array; counts: Record<string, number> }> => {
      const { result, seen } = await probing(() => Promise.resolve(run()));
      return {
        bytes: result,
        counts: {
          total: seen.counts.get("built.lines.total") ?? 0,
          written: seen.counts.get("built.lines.written") ?? 0,
          sorted: seen.counts.get("built.lines.sorted") ?? 0,
        },
      };
    };

    it("writes and sorts only the lines of the triples a rebuild changed, and gives the bytes a write from nothing gives", async () => {
      const kept = new KeptLines();
      const first = [...record(1), ...record(2), ...record(3)];
      const whole = await lines(() => ntriples(first, kept));
      assert.deepEqual(whole.counts, { total: 12, written: 12, sorted: 12 });

      const changed: Triple = [
        iri("urn:example:record/2"),
        iri("urn:example:c"),
        literal("c2 revised"),
      ];
      const second = first.map((triple) =>
        triple[0].value === "urn:example:record/2" &&
        triple[1].value === "urn:example:c"
          ? changed
          : triple,
      );
      const one = await lines(() => ntriples(second, kept));
      assert.deepEqual(one.counts, { total: 12, written: 1, sorted: 1 });
      assert.deepEqual(one.bytes, ntriples(second));

      const fewer = second.filter(
        (triple) => triple[0].value !== "urn:example:record/1",
      );
      const gone = await lines(() => ntriples(fewer, kept));
      assert.deepEqual(gone.counts, { total: 8, written: 0, sorted: 0 });
      assert.deepEqual(gone.bytes, ntriples(fewer));

      const back = [...fewer, ...record(1).slice(0, 2)];
      const returned = await lines(() => ntriples(back, kept));
      assert.deepEqual(returned.counts, { total: 10, written: 2, sorted: 2 });
      assert.deepEqual(returned.bytes, ntriples(back));
    });

    it("writes a blank node's line again as the bytes a write from nothing gives, whether the node is kept or replaced", async () => {
      const kept = new KeptLines();
      const node = {
        termType: "BlankNode",
        value: "b1",
      } as unknown as Triple[0];
      const other = {
        termType: "BlankNode",
        value: "b2",
      } as unknown as Triple[0];
      const about: Triple = [node, iri("urn:example:a"), literal("a")];
      const rest = record(1);
      const first = [...rest, about];
      await lines(() => ntriples(first, kept));

      const same = await lines(() => ntriples(first, kept));
      assert.deepEqual(same.counts, { total: 5, written: 0, sorted: 0 });
      assert.deepEqual(same.bytes, ntriples(first));

      const renamed: Triple = [other, iri("urn:example:a"), literal("a")];
      const second = [...rest, renamed];
      const swapped = await lines(() => ntriples(second, kept));
      assert.deepEqual(swapped.counts, { total: 5, written: 1, sorted: 1 });
      assert.deepEqual(swapped.bytes, ntriples(second));
    });

    it("forgets the lines of a file a rebuild no longer builds", () => {
      const files = new KeptFiles();
      files.of("a.nt");
      files.of("b.nt");
      files.of("c.nt");
      files.keepOnly(new Set(["a.nt", "c.nt", "d.nt"]));
      assert.equal(files.size, 2);
      assert.equal(files.of("b.nt").sorted, undefined);
    });
  });

  /**
   * The sync story replayed with `build.verify`, which throws where a file written from the kept lines is not the bytes
   * of one written from nothing; and with each step counted by the lines its built files hold, write and sort.
   */
  describe("given a pod replayed with its build kept, each step counted by built lines", () => {
    let steps: {
      name: string;
      total: number;
      written: number;
      sorted: number;
    }[];
    let stopped: unknown;

    before(async () => {
      const files = await vocabulary();
      const build = await vocabularyBuild(files, await layout());
      steps = [];
      const done = await replayed("runtime/sync.feature", SYNC_RUN, {
        importers: [appleHealthExport],
        build: {
          lens: "everyday",
          derive: deriveWith(build),
          incremental: build,
          verify: true,
        },
        performers: Object.fromEntries(
          Object.entries(PERFORMERS).map(([kind, perform]) => [
            kind,
            async (pod: CorePod, step, context) => {
              const { result, seen } = await probing(() =>
                perform(pod, step, context),
              );
              steps.push({
                name: step.name,
                total: seen.counts.get("built.lines.total") ?? 0,
                written: seen.counts.get("built.lines.written") ?? 0,
                sorted: seen.counts.get("built.lines.sorted") ?? 0,
              });
              return result;
            },
          ]),
        ) as typeof PERFORMERS,
      });
      stopped = done.stopped;
    });

    it("writes and sorts, in a step that rebuilds in part, fewer lines than its built files hold", () => {
      assert.equal(stopped, undefined);
      const inPart = steps.filter(
        (step) => step.total > 0 && step.written < step.total,
      );
      assert.ok(inPart.length > 0, JSON.stringify(steps));
      for (const step of steps)
        assert.ok(step.sorted <= step.written, JSON.stringify(step));
    });
  });
});
