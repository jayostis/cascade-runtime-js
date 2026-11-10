import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import { Revisions } from "../src/arrivals.js";
import { deriveWith, vocabularyBuild, vocabularyDerive } from "../src/build.js";
import type { CorePod } from "../src/core-pod.js";
import { dataset } from "../src/dataset.js";
import { MemoryFiles } from "../src/files.js";
import { LAYOUT_GRAPH } from "../src/layout.js";
import { matcherView, runMatcher } from "../src/matcher.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, written } from "../src/rdf.js";
import { References } from "../src/references.js";
import { StepWrites } from "../src/pod.js";
import { type Perform, PERFORMERS, type Replayed } from "../src/replay.js";
import { Refusal, type StepContext } from "../src/step.js";
import { RestorableUnion, type Row, type Store } from "../src/store.js";
import { layout, replayed, vocabulary } from "./vocabulary.js";

const SYNC_RUN =
  "after both writers imported one export, the sync's run takes only the entry the other writer made";
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
 * writes is what a pod built whole after every step would.
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
          "after the rule list's version 2 is adopted, R3 joins a brand allergy and its ingredient's, and not a two-ingredient product and one of its ingredients",
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

  describe("when a match runs", () => {
    let runs: TakingRun[];

    before(async () => {
      runs = await runsTakingRecords();
    });

    it("puts back every quad of the kept dataset, each blank node the node it was, before the step writes a file", () => {
      assert.ok(runs.length > 0);
      for (const run of runs) {
        assert.ok(run.wrote > 0 && run.dropped > 0, run.step);
        assert.deepEqual(run.atFirstWrite, run.before, run.step);
      }
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

    it("builds the pod whole for the `dataset()` after that", () => {
      // A pod read whole between steps does not know the snapshot the kept build used, which the manifest names.
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

    it("returns from the kept dataset the latest revisions and the files of each record that it returns from the records' files", () => {
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
});
