import assert from "node:assert/strict";
import { test } from "node:test";
import { CorePod, type CorePodOptions } from "../src/core-pod.js";
import { type Files, MemoryFiles } from "../src/files.js";
import { randomId } from "../src/ids.js";
import { LAYOUT_GRAPH, type Layout } from "../src/layout.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, literal, type Triple, written, XSD } from "../src/rdf.js";
import { References } from "../src/references.js";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import { deriveWith, vocabularyBuild, vocabularyDerive } from "../src/build.js";
import { matcherView, runMatcher } from "../src/matcher.js";
import { StepWrites } from "../src/pod.js";
import { type Perform, PERFORMERS, replay } from "../src/replay.js";
import { Refusal, type StepContext } from "../src/step.js";
import { RestorableUnion, type Row, type Store } from "../src/store.js";
import { layout, RUNTIME, storyFrom, vocabulary } from "./vocabulary.js";

const CREATED = "http://purl.org/dc/terms/created";
const ADDRESS = "https://pod.example/";

/** A pod over the files whose build writes only its manifest, stating when it was built; it fails while `failing`. */
function options(
  pod: Files,
  laidOut: Layout,
  state: { now: string; failing?: boolean },
): CorePodOptions {
  return {
    runtime: RUNTIME,
    pod,
    address: ADDRESS,
    subject: "urn:uuid:7c2d9e41-5a8b-4f36-b0e2-9d1a4c6f8e53",
    title: "",
    vocabulary: new MemoryFiles("https://vocabulary.example/"),
    layout: laidOut,
    newStore: () => new OxigraphStore(),
    time: { newId: randomId, now: () => state.now },
    importers: [],
    references: () => Promise.reject(new Error("no tables")),
    build: {
      lens: "everyday",
      derive: async (union, _lens, { at }) => {
        if (state.failing === true) throw new Error("the build fails");
        const manifest = ADDRESS + laidOut.manifest;
        const triples: Triple[] = [
          [iri(manifest), iri(CREATED), literal(at, `${XSD}dateTime`)],
        ];
        await union.add(triples, manifest);
        return new Map([[laidOut.manifest, triples]]);
      },
    },
  };
}

test("what an ask reads and the revision change with every step, a refused one too, which frees the dataset read before it; a pod over the same files has the same revision", async () => {
  const laidOut = await layout();
  const state = { now: "2026-02-01T08:00:00Z", failing: false };
  const over = options(new MemoryFiles(ADDRESS), laidOut, state);
  const created = async (pod: CorePod): Promise<string[]> =>
    (
      await (
        await pod.dataset("everyday")
      ).select(`SELECT ?at WHERE { ?manifest <${CREATED}> ?at }`)
    ).rows.flatMap((row) => row.get("at")?.value ?? []);

  const pod = new CorePod(over);
  await pod.create();
  const first = await pod.revision();
  assert.deepEqual(await created(pod), ["2026-02-01T08:00:00Z"]);
  const before = await pod.dataset("everyday");

  state.now = "2026-02-02T08:00:00Z";
  assert.ok((await pod.refuse("no reason")).refused);
  await assert.rejects(before.ask("ASK { ?s ?p ?o }"), /freed/);
  assert.notEqual(await pod.revision(), first);
  assert.deepEqual(await created(pod), ["2026-02-02T08:00:00Z"]);

  const again = new CorePod(over);
  assert.equal(await again.revision(), await pod.revision());
  assert.deepEqual(await created(again), ["2026-02-02T08:00:00Z"]);
  assert.deepEqual(await created(new CorePod({ ...over, build: undefined })), [
    "2026-02-02T08:00:00Z",
  ]);

  pod.close();
  state.failing = true;
  await assert.rejects(created(pod), /the build fails/);
  state.failing = false;
  assert.deepEqual(await created(pod), ["2026-02-02T08:00:00Z"]);
});

test("a step writes its files in one batch and the build its files in a second; a refused step writes only the build's", async () => {
  const laidOut = await layout();
  const batches: string[][] = [];
  const files = new MemoryFiles(ADDRESS);
  const batched: Files = {
    iri: ADDRESS,
    read: (path) => files.read(path),
    list: (folder) => files.list(folder),
    write: (path) => Promise.reject(new Error(`${path} written alone`)),
    writeAll: async (written) => {
      const paths: string[] = [];
      for (const [path, bytes] of written) {
        await files.write(path, bytes);
        paths.push(path);
      }
      batches.push(paths);
    },
  };
  const state = { now: "2026-02-01T08:00:00Z" };
  const pod = new CorePod(options(batched, laidOut, state));

  const { wrote } = await pod.create();
  assert.deepEqual(batches, [wrote, [laidOut.manifest]]);
  assert.ok(wrote.includes(laidOut.card));

  batches.length = 0;
  state.now = "2026-02-02T08:00:00Z";
  assert.ok((await pod.refuse("no reason")).refused);
  assert.deepEqual(batches, [[laidOut.manifest]]);
});

test("a step whose files are written one by one and fail part way reads the pod as the files left it", async () => {
  const laidOut = await layout();
  const files = new MemoryFiles(ADDRESS);
  let writes = 0;
  const failing: Files = {
    iri: ADDRESS,
    read: (path) => files.read(path),
    list: (folder) => files.list(folder),
    write: (path, bytes) =>
      ++writes === 2
        ? Promise.reject(new Error("the second write fails"))
        : files.write(path, bytes),
  };
  const state = { now: "2026-02-01T08:00:00Z" };
  const pod = new CorePod(options(failing, laidOut, state));

  await assert.rejects(pod.create(), /the second write fails/);
  assert.equal(
    await pod.revision(),
    await new CorePod(options(files, laidOut, state)).revision(),
  );
});

test("a read names the pod's current version of a series its tables do not hold, which a matcher Same that used another version is read without (M7)", async () => {
  const pod = new MemoryFiles(ADDRESS);
  await pod.write(
    "judgments/claim.ttl",
    new TextEncoder()
      .encode(`@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix pav: <http://purl.org/pav/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
<urn:x:map> a cascade:ReferenceSeries ; cascade:tableKind cascade:SubstanceIngredients .
<urn:x:map-1> prov:specializationOf <urn:x:map> ; pav:version "1" .
<urn:x:map-2> prov:specializationOf <urn:x:map> ; pav:version "2" ; prov:wasRevisionOf <urn:x:map-1> .
<urn:x:claim> a cascade:Judgment ; cascade:verdict cascade:Same ; prov:wasAttributedTo cascade:CascadeMatcher ;
    cascade:matcherRule cascade:SameMappedCodeRule ; prov:used <urn:x:map-1> ; prov:hadMember <urn:x:a> , <urn:x:b> .
<urn:x:assertion> a cascade:ClaimAssertion ; cascade:assertedClaim <urn:x:claim> .
`),
  );
  const held = {
    seriesOf: (version: string) =>
      version === "urn:x:map-1" ? "urn:x:map" : undefined,
  } as unknown as References;
  const core = new CorePod({
    ...options(pod, await layout(), { now: "2026-02-01T08:00:00Z" }),
    vocabulary: await vocabulary(),
    references: () => Promise.resolve(held),
  });
  assert.deepEqual(await core.unheldTableVersions(), ["urn:x:map-2"]);
});

test("a person's retraction that also states prov:used is filed with the retractions, not the imports (cascade:Placement)", async () => {
  const laidOut = await layout();
  const pod = new CorePod(
    options(new MemoryFiles(ADDRESS), laidOut, { now: "2026-02-01T08:00:00Z" }),
  );
  const name = "urn:uuid:3b9e2d47-8c15-4f6a-a0d2-7e5c1b9f4a63";
  const { wrote } = await pod.judge({
    name: "retraction.ttl",
    base: ADDRESS,
    bytes: new TextEncoder()
      .encode(`@prefix prov: <http://www.w3.org/ns/prov#> .
<${name}> a prov:Activity ;
  prov:invalidated <urn:uuid:0f6c2a9e-4d71-4b38-9e05-c8a3f2d61b7e> ;
  prov:used <urn:uuid:c41d7e90-2b6a-4f3c-8d15-a9e0b7f26c48> ;
  prov:wasAssociatedWith <https://pod.example/profile/card.ttl#me> .
`),
  });
  assert.deepEqual(wrote, [
    laidOut
      .place("http://www.w3.org/ns/prov#Activity", [
        "http://www.w3.org/ns/prov#invalidated",
      ])
      .path(name),
  ]);
  assert.ok(wrote[0]?.startsWith("judgments/retractions/"));
});

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

test("after every step, a match, a sync and a table adoption among them, the matcher's view lent from the kept dataset is the one a pod keeping nothing reads and derives", async () => {
  const files = await vocabulary();
  const laidOut = await layout();
  const derive = await vocabularyDerive(files, laidOut);
  for (const [feature, example] of [
    [
      "runtime/sync.feature",
      "after both writers imported one export, the sync's run takes only the entry the other writer made",
    ],
    [
      "runtime/opening.feature",
      "after the rule list's version 2 is adopted, R3 joins a brand allergy and its ingredient's, and not a two-ingredient product and one of its ingredients",
    ],
  ] as const) {
    const { story, folder } = await storyFrom(feature, example);
    const compared: string[] = [];
    const replayed = await replay({
      runtime: RUNTIME,
      story,
      source: files,
      vocabulary: files,
      folder,
      title: "",
      pod: new MemoryFiles(story.address),
      newStore: () => new OxigraphStore(),
      layout: laidOut,
      importers: [appleHealthExport],
      build: { lens: "everyday", derive },
      performers: Object.fromEntries(
        Object.entries(PERFORMERS).map(([kind, perform]) => [
          kind,
          async (pod: CorePod, step, context) => {
            const performed = await perform(pod, step, context);
            const copied = await matcherViewQuads(pod);
            const read = await matcherViewQuads(await pod.fork(context.time));
            assert.ok(copied.length > 0, step.name);
            assert.deepEqual(copied, read, `${example}: ${step.name}`);
            compared.push(step.happened.kind);
            return performed;
          },
        ]),
      ) as typeof PERFORMERS,
    });
    assert.equal(replayed.stopped, undefined, example);
    assert.ok(compared.includes("matcher"), example);
    assert.ok(
      compared.includes(feature.includes("sync") ? "sync" : "open"),
      example,
    );
  }
});

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

const SYNC_RUN =
  "after both writers imported one export, the sync's run takes only the entry the other writer made";

/** The sync story replayed with the build kept across steps, its run that takes records performed as `run` performs it. */
async function replaySyncRun(
  run: Perform,
  options: { readonly renewAfterMoved?: number } = {},
): Promise<void> {
  const files = await vocabulary();
  const laidOut = await layout();
  const { story, folder } = await storyFrom("runtime/sync.feature", SYNC_RUN);
  const build = await vocabularyBuild(files, laidOut);
  const replayed = await replay({
    runtime: RUNTIME,
    story,
    source: files,
    vocabulary: files,
    folder,
    title: "",
    pod: new MemoryFiles(story.address),
    newStore: () => new OxigraphStore(),
    layout: laidOut,
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
  assert.equal(replayed.stopped, undefined);
}

test("a match changes the dataset of the build kept across steps as the matcher's view and puts back every quad, each blank node the node it was, before the step writes", async () => {
  let compared = 0;
  await replaySyncRun(async (pod, step, side) => {
    const kept = await pod.dataset("everyday");
    const before = await storeQuads(kept.store);
    const drop = kept.store.drop.bind(kept.store);
    let dropped = 0;
    kept.store.drop = (graph) => {
      dropped += 1;
      return drop(graph);
    };
    let after: string[] | undefined;
    const { write, writeNew } = MemoryFiles.prototype;
    const watched = async (): Promise<void> => {
      after ??= await storeQuads(kept.store);
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
    assert.ok(performed.wrote.length > 0 && dropped > 0, step.name);
    assert.deepEqual(after, before, step.name);
    compared += 1;
    return performed;
  });
  assert.ok(compared > 0);
});

test("a match refused or failing after it changed the matcher's view puts back the dataset the view was lent from, every quad, each blank node the node it was", async () => {
  const files = await vocabulary();
  const laidOut = await layout();
  let tried = 0;
  await replaySyncRun(async (pod, step, side) => {
    const takes = step.happened.kind === "matcher" ? step.happened.takes : "";
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
      await assert.rejects(
        runMatcher(context, failing, activity),
        (error) => error === failure,
      );
      assert.ok(changed && lent === undefined, failure.message);
      assert.deepEqual(
        await storeQuads(lentFrom.store),
        before,
        failure.message,
      );
      tried += 1;
    }
    lentFrom.store.free?.();
    return (PERFORMERS.matcher as Perform)(pod, step, side);
  });
  assert.equal(tried, 2);
});

test("on the build kept across steps, a select lends the dataset to the matcher's view and the next ask's dataset is every quad again, the layout and the files the build writes among them", async () => {
  const laidOut = await layout();
  const query = "SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }";
  const graphs = (rows: readonly Row[]): Set<string> =>
    new Set(rows.flatMap((row) => row.get("g")?.value ?? []));
  let checked = 0;
  await replaySyncRun(async (pod, step, side) => {
    const performed = await (PERFORMERS.matcher as Perform)(pod, step, side);
    const before = await storeQuads((await pod.dataset("everyday")).store);
    const lent = graphs((await pod.select(query)).rows);
    const kept = await pod.dataset("everyday");
    const all = graphs((await kept.select(query)).rows);
    assert.deepEqual(await storeQuads(kept.store), before);
    for (const graph of [LAYOUT_GRAPH, pod.files.iri + laidOut.manifest])
      assert.ok(all.has(graph) && !lent.has(graph), graph);
    checked += 1;
    return performed;
  });
  assert.ok(checked > 0);
});

test("a kept build whose store fails to renew, after freeing itself, is dropped, and the next ask's dataset is the pod built whole", async () => {
  const laidOut = await layout();
  const query = "SELECT ?s WHERE { ?s ?p ?o } LIMIT 1";
  let checked = 0;
  await replaySyncRun(
    async (pod, step, side) => {
      const performed = await (PERFORMERS.matcher as Perform)(pod, step, side);
      const before = await storeQuads(
        (await pod.dataset("everyday")).store,
        true,
      );
      const { renewed } = OxigraphStore.prototype;
      OxigraphStore.prototype.renewed = function (): Promise<Store> {
        this.free();
        return Promise.reject(new Error("the renewal fails"));
      };
      try {
        await pod.select(query);
        await assert.rejects(pod.dataset("everyday"), /the renewal fails/);
      } finally {
        OxigraphStore.prototype.renewed = renewed;
      }
      const whole = await pod.dataset("everyday");
      // A pod read whole between steps does not know the snapshot the kept build used, which the manifest names.
      const unbuilt = (quads: string[]) =>
        quads.filter(
          (quad) => !quad.startsWith(`<${pod.files.iri}${laidOut.manifest}>`),
        );
      assert.deepEqual(
        unbuilt(await storeQuads(whole.store, true)),
        unbuilt(before),
      );
      checked += 1;
      return performed;
    },
    { renewAfterMoved: 1 },
  );
  assert.ok(checked > 0);
});
