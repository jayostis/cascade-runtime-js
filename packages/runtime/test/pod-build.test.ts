import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import {
  deriveWith,
  type VocabularyBuild,
  vocabularyBuild,
  vocabularyDerive,
} from "../src/build.js";
import {
  dataset,
  podDataset,
  podStated,
  podFilesParsed,
} from "../src/dataset.js";
import { KeptBuild } from "../src/incremental.js";
import { BuildFailure, CorePod } from "../src/core-pod.js";
import type { SamesStillJoined } from "../src/derive.js";
import { viewEntryName } from "../src/names.js";
import { MemoryFiles, readText } from "../src/files.js";
import { clock } from "../src/ids.js";
import { probing } from "../src/probe.js";
import { LAYOUT_FILE, type Layout } from "../src/layout.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, type Triple } from "../src/rdf.js";
import { References } from "../src/references.js";
import { type Replayed, replay } from "../src/replay.js";
import type { StepFile } from "../src/step.js";
import {
  type Dataset,
  type LoadFilesOptions,
  type Rows,
  Union,
} from "../src/store.js";
import { localVocabulary } from "../src/node/runtime.js";
import { featurePod } from "../src/node/story-pod.js";
import { copied } from "./cleo.js";
import { notIsomorphic } from "../src/graphs.js";
import {
  layout as readLayout,
  ROOT,
  RUNTIME,
  storyFrom,
  vocabulary,
} from "./vocabulary.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const FEATURE = "runtime/matcher.feature";
const EXAMPLE =
  "the matcher joins the pair a person called different, and not the pair a person called the same";
const THROUGH = "persons-same";
const LENS = "everyday";
const PREFIXES = `PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
  PREFIX solid: <http://www.w3.org/ns/solid/terms#>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX pav: <http://purl.org/pav/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>`;

let store: Dataset;
/** The vocabulary's pod layout as it reads, its paths resolved against the pod's address, read without `Layout`. */
let laidOut: Union;
let address: string;
let layout: Layout;
/** The pod the story was replayed into, with a build after every step. */
let pod: CountedFiles;
/** What `pod` counted by the time the replay returned, before anything read it again. */
let counted: {
  readonly found: ReadonlyMap<string, number>;
  readonly writes: ReadonlyMap<string, number>;
  readonly log: readonly string[];
};
let replayed: Replayed;
/** The build kept across steps, which a pod opened over `pod`'s files builds with. */
let incremental: VocabularyBuild;
/** The folder the story's steps name their files under. */
let storyFolder: string;
let subject: string;
let vocabularyFiles: Awaited<ReturnType<typeof vocabulary>>;

/** Files in memory, counting each read that finds a file, and each write, by path, in the order written. */
class CountedFiles extends MemoryFiles {
  readonly found = new Map<string, number>();
  readonly writes = new Map<string, number>();
  readonly log: string[] = [];

  override async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const bytes = await super.read(pathOrIri);
    if (bytes !== undefined)
      this.found.set(pathOrIri, (this.found.get(pathOrIri) ?? 0) + 1);
    return bytes;
  }

  override write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    this.writes.set(pathOrIri, (this.writes.get(pathOrIri) ?? 0) + 1);
    this.log.push(pathOrIri);
    return super.write(pathOrIri, bytes);
  }
}

before(async () => {
  vocabularyFiles = await vocabulary();
  layout = await readLayout();
  const derive = await vocabularyDerive(vocabularyFiles, layout);
  incremental = await vocabularyBuild(vocabularyFiles, layout);
  const { story, folder } = await storyFrom(FEATURE, EXAMPLE, THROUGH);
  address = story.address;
  subject = story.subject;
  storyFolder = folder;
  laidOut = new Union(new OxigraphStore());
  await laidOut.loadTurtle(
    await readText(vocabularyFiles, LAYOUT_FILE),
    address,
  );
  replayed = await replay({
    runtime: RUNTIME,
    story,
    source: vocabularyFiles,
    vocabulary: vocabularyFiles,
    folder,
    title: "matching",
    pod: (pod = new CountedFiles(story.address)),
    newStore: () => new OxigraphStore(),
    layout,
    importers: [appleHealthExport],
    build: { lens: LENS, derive },
  });
  counted = {
    found: new Map(pod.found),
    writes: new Map(pod.writes),
    log: [...pod.log],
  };
  store = await dataset(replayed, THROUGH, LENS, new OxigraphStore(), derive);
});

/** A pod over `files`, as an app opens a folder that holds a pod, building with the build kept across steps. */
function opened(
  files: MemoryFiles,
  newStore: () => OxigraphStore = () => new OxigraphStore(),
  over: { address: string; subject: string } = { address, subject },
  besidePod?: MemoryFiles,
): CorePod {
  return new CorePod({
    ...(besidePod === undefined ? {} : { besidePod }),
    runtime: RUNTIME,
    pod: files,
    address: over.address,
    subject: over.subject,
    title: "matching",
    vocabulary: vocabularyFiles,
    layout,
    newStore,
    time: clock,
    importers: [],
    references: () => Promise.reject(new Error("no step here matches")),
    build: { lens: LENS, derive: deriveWith(incremental), incremental },
  });
}

/**
 * Stores that note each graph loaded into them, by `loadTurtle` or `loadFiles`, and how many times each graph's Turtle
 * was checked as it was loaded, over every store made.
 */
function countingStores() {
  let stores: Set<string>[] = [];
  const checked = new Map<string, number>();
  const check = (graph: string) =>
    checked.set(graph, (checked.get(graph) ?? 0) + 1);
  class CountedStore extends OxigraphStore {
    readonly #loaded = new Set<string>();

    constructor() {
      super();
      stores.push(this.#loaded);
    }

    override loadTurtle(
      turtle: Uint8Array | string,
      options: { readonly graph: string },
    ): Promise<void> {
      this.#loaded.add(options.graph);
      check(options.graph);
      return super.loadTurtle(turtle, options);
    }

    override loadFiles(
      files: readonly { readonly graph: string; readonly turtle: Uint8Array }[],
      options?: LoadFilesOptions,
    ): Promise<void> {
      for (const { graph } of files) {
        this.#loaded.add(graph);
        if (options?.parsedBefore !== true) check(graph);
      }
      return super.loadFiles(files, options);
    }
  }
  return {
    newStore: () => new CountedStore(),
    /** How many times the graph's Turtle was checked as it was loaded, in any store made. */
    checked: (graph: string) => checked.get(graph) ?? 0,
    /** How many stores made since the last `forget` loaded every one of the graphs. */
    loadedAll: (graphs: readonly string[]) =>
      stores.filter((loaded) => graphs.every((graph) => loaded.has(graph)))
        .length,
    forget: () => {
      stores = [];
    },
  };
}

/** The files of `pod` in a new `CountedFiles`, which has read nothing yet. */
async function countedCopy(): Promise<CountedFiles> {
  const copy = new CountedFiles(pod.iri);
  for (const path of await pod.list("")) {
    const bytes = await pod.read(path);
    if (bytes !== undefined) await copy.write(path, bytes);
  }
  return copy;
}

async function values(on: Dataset, where: string): Promise<string[]> {
  const { rows, variables } = await on.select(
    `${PREFIXES} SELECT * WHERE { ${where} }`,
  );
  return rows
    .map((row) => variables.map((name) => row.get(name)?.value).join(" "))
    .sort();
}

async function placed(where: string): Promise<string> {
  const [found, ...others] = await values(
    laidOut,
    `GRAPH <${address}> { ${where} }`,
  );
  assert.ok(found !== undefined && others.length === 0, where);
  return found;
}

/**
 * Asserts each file the build writes is in `files` as `whole`, a build of the whole pod, gives it, or absent as there;
 * at least one of them has triples, so that the comparison is of something.
 */
async function writtenAsBuiltWhole(
  files: MemoryFiles,
  whole: (path: string) => Promise<readonly Triple[]>,
): Promise<void> {
  const parser = new OxigraphStore();
  let withTriples = 0;
  for (const path of layout.rebuilt) {
    const bytes = await files.read(path);
    const full = await whole(path);
    if (full.length === 0) {
      assert.equal(bytes, undefined, path);
      continue;
    }
    withTriples += 1;
    assert.ok(bytes, path);
    assert.equal(
      notIsomorphic(full, await parser.parse(bytes, address + path)),
      undefined,
      path,
    );
  }
  assert.ok(withTriples > 0, "no file the build writes has a triple");
}

/**
 * After a step, the build works out the pod's derived state and writes the files that follow from it: a view for each
 * kind of record the pod holds, the labels, which give each thing a name a person can read, the type index, which lists
 * where each view is, and the manifest. `CorePodOptions.build` runs it after every step, and `podDataset()` runs it over
 * a pod read from a folder of its files.
 *
 * The vocabulary's fixtures show what each query answers. These leaves show what only the runtime decides: when it
 * writes, what it reads back, in what order it works (the labels read the views), and how it writes an entry's name in a
 * view's file. A15's type index and N13 have no example; `tests/fixtures/labels-entries-as-their-views-name-them` holds
 * the query's side of the labels leaf.
 * @rule runtime/arrivals.feature A15
 * @rule runtime/naming.feature N13
 * @rule runtime/matcher.feature M7
 */
describe("Building a pod's views, labels and type index · CorePodOptions.build, vocabularyDerive(), podDataset()", () => {
  describe("given a story replayed with a build after every step", () => {
    it("reads no file of the pod while it builds", () => {
      assert.deepEqual([...counted.found.keys()], []);
    });

    it("writes the manifest at every step", () => {
      assert.equal(counted.writes.get(layout.manifest), replayed.steps.length);
    });

    it("writes the type index only at a step that adds a view", () => {
      const begun = replayed.steps.map(({ wrote }) =>
        wrote.length === 0 ? -1 : counted.log.indexOf(wrote[0] ?? ""),
      );
      const stepOf = (at: number): number =>
        begun.findLastIndex((began) => began >= 0 && began < at);
      const stepsWriting = (path: string): number[] =>
        counted.log.flatMap((written, at) =>
          written === path ? [stepOf(at)] : [],
        );
      const appeared = layout.views.flatMap(({ file }) =>
        file === undefined ? [] : stepsWriting(file).slice(0, 1),
      );
      assert.ok(appeared.length > 0);
      assert.deepEqual(
        stepsWriting(layout.typeIndex),
        [...new Set(appeared)].sort((a, b) => a - b),
      );
    });

    it("leaves in the pod each file it writes as a build of the whole pod gives it", async () => {
      await writtenAsBuiltWhole(pod, (path) =>
        store.construct(
          `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${address}${path}> { ?s ?p ?o } }`,
        ),
      );
    });
  });

  describe("given the type index a build wrote", () => {
    let index: string;
    let written: string[];
    before(async () => {
      index = await placed(
        `[] solid:forClass solid:TypeIndex ; solid:instance ?file`,
      );
      written = await values(store, `GRAPH ?view { ?view a cascade:View }`);
    });

    it("states that it is a `solid:TypeIndex` and a `solid:UnlistedDocument`", async () => {
      assert.deepEqual(
        await values(store, `GRAPH <${index}> { <${index}> a ?type }`),
        [
          "http://www.w3.org/ns/solid/terms#TypeIndex",
          "http://www.w3.org/ns/solid/terms#UnlistedDocument",
        ],
      );
    });

    it("registers each view written, and the views' folder, by class, file or folder, and title", async () => {
      const registration = `?class ; ?listing ?target ; dct:title ?title FILTER (?listing IN (solid:instance, solid:instanceContainer))`;
      assert.deepEqual(
        await values(
          store,
          `SELECT ?class ?listing ?target ?title WHERE { GRAPH <${index}> {
            [] a solid:TypeRegistration ; solid:forClass ${registration} } }`,
        ),
        await values(
          laidOut,
          `SELECT ?class ?listing ?target ?title WHERE { GRAPH <${address}> {
            ?placement a cascade:Placement ; solid:forClass ${registration}
            { ?placement cascade:writtenByQueryPath [] ; solid:instance ?target FILTER (?target IN (${written.map((view) => `<${view}>`).join(", ")})) }
            UNION { ?placement solid:forClass cascade:View ; solid:instanceContainer [] } } }`,
        ),
      );
    });

    it("registers no view of a kind the pod holds no record of", async () => {
      const targets = await values(
        store,
        `SELECT ?target WHERE { GRAPH <${index}> { [] a solid:TypeRegistration ; solid:instance ?target } }`,
      );
      assert.ok(targets.length > 0);
      for (const { file } of layout.views) {
        if (file === undefined) continue;
        assert.equal(
          targets.includes(address + file),
          counted.log.includes(file),
          file,
        );
      }
    });
  });

  describe("given the labels file a build wrote", () => {
    it("labels each entry of a view by the IRI its view gives it", async () => {
      const labels = await placed(
        `[] cascade:writtenByQueryPath "labels.rq" ; solid:instance ?file`,
      );
      const views = await placed(
        `[] solid:forClass cascade:View ; solid:instanceContainer ?folder`,
      );
      const { rows } = await store.select(`${PREFIXES}
        SELECT ?thing ?label WHERE {
          GRAPH ?view { ?thing cascade:entryMember [] } FILTER (STRSTARTS(STR(?view), "${views}"))
          OPTIONAL { GRAPH <${labels}> { ?thing rdfs:label ?label } }
        }`);
      assert.ok(rows.length > 0, "no view has an entry");
      assert.deepEqual(
        rows
          .filter((row) => !row.has("label"))
          .map((row) => row.get("thing")?.value),
        [],
      );
    });
  });

  describe("given the views a build wrote", () => {
    /** Each entry of a view, with the view that holds it and the members it is made from. */
    const members = new Map<string, { view: string; members: string[] }>();
    /** The bytes of each view that has an entry, as the pod stores them. */
    const texts = new Map<string, string>();
    before(async () => {
      const { rows } = await store.select(
        `SELECT ?view ?entry ?member WHERE { GRAPH ?view { ?view a <https://ns.cascadeprotocol.org/cascade#View> . ?entry <https://ns.cascadeprotocol.org/cascade#entryMember> ?member } }`,
      );
      for (const row of rows) {
        const entry = row.get("entry")?.value ?? "";
        const found = members.get(entry) ?? {
          view: row.get("view")?.value ?? "",
          members: [],
        };
        found.members.push(row.get("member")?.value ?? "");
        members.set(entry, found);
      }
      for (const { view } of members.values())
        texts.set(
          view,
          new TextDecoder().decode(await pod.read(view.slice(address.length))),
        );
    });

    it("names each entry its view's address, `#`, and the hash `viewEntryName()` gives of its least member's IRI", async () => {
      assert.ok(members.size > 0, "no view has an entry");
      for (const [entry, { view, members: of }] of members)
        assert.equal(entry, await viewEntryName(view, of));
    });

    it("writes each entry in its view's file as `<#hash>`", () => {
      assert.ok(members.size > 0, "no view has an entry");
      for (const [entry, { view }] of members) {
        const text = texts.get(view) ?? "";
        assert.ok(
          text.includes(`<#${entry.slice(view.length + 1)}> `),
          `${view}: no <#hash> for ${entry}`,
        );
      }
    });

    it("writes no IRI under the pod's address in a view's file", () => {
      assert.ok(texts.size > 0);
      for (const [view, text] of texts)
        assert.ok(!text.includes(address), `${view}: ${text}`);
    });

    it("writes no `urn:cascade:entry:` placeholder in a view's file", () => {
      assert.ok(texts.size > 0);
      for (const [view, text] of texts)
        assert.ok(!text.includes("urn:cascade:entry:"), `${view}: ${text}`);
    });
  });

  describe("given the martin-okafor kit's pod, whose view of a variant's interpretations names, for each interpretation, the entry of the view of the person's variants that its variant is in", () => {
    let martin: Dataset;
    let variants: string;
    before(async () => {
      const kit = await localVocabulary(ROOT);
      const built = await featurePod(
        kit,
        "conformance/martin-okafor/martin-okafor.feature",
        new MemoryFiles("https://pod.example/"),
      );
      const last = built.steps.at(-1);
      assert.ok(last);
      const read = await podDataset(
        built.pod,
        kit.layout,
        kit.build,
        kit.config.lens,
        new OxigraphStore(),
        { title: built.title, at: last.step.when },
      );
      martin = read.store;
      variants = `${read.address}clinical/variants.ttl`;
    });

    it("names an entry another view points to in the view that gives it members", async () => {
      const { rows } = await martin.select(
        `${PREFIXES}
        SELECT ?interpretation ?variant ?member WHERE {
          GRAPH ?view { ?view a cascade:View . ?interpretation cascade:entryMember [] ; cascade:subjectVariant ?variant }
          OPTIONAL { GRAPH <${variants}> { ?variant cascade:entryMember ?member } }
        }`,
      );
      assert.ok(rows.length > 0);
      for (const row of rows) {
        const variant = row.get("variant")?.value ?? "";
        assert.ok(
          variant.startsWith(`${variants}#`) &&
            /^[0-9a-f]{64}$/.test(variant.slice(variants.length + 1)),
          variant,
        );
        assert.ok(
          row.get("member"),
          `${variant} has no member in the variants view`,
        );
      }
    });
  });

  /**
   * A view is an entity, so it names the table versions it came from with `prov:wasDerivedFrom`; `prov:used` is said
   * only of an activity.
   */
  describe("given a pod whose matcher Same used a table version that is no longer the current version, read with `podDataset()`", () => {
    /** The Same the example says counts on, by the name it gives it. */
    const same = "urn:uuid:5c813aec-207a-8263-a682-d934f4522827";
    const countedInOneEntry = `${PREFIXES}
      ASK {
        <${same}> prov:hadMember ?one , ?other .
        ?one cascade:inEntry ?entry . ?other cascade:inEntry ?entry .
        FILTER (?one != ?other)
      }`;
    let separate: Dataset;
    let together: Dataset;
    let returned: Triple[] = [];
    before(async () => {
      const kit = await localVocabulary(ROOT);
      const built = await featurePod(
        kit,
        FEATURE,
        new MemoryFiles("https://pod.example/"),
        {
          example:
            "a Same whose members the revised table still joins is not filed again, and counts on",
        },
      );
      const last = built.steps.at(-1);
      assert.ok(last);
      const read = async (samesStillJoined?: SamesStillJoined) =>
        (
          await podDataset(
            built.pod,
            kit.layout,
            kit.build,
            kit.config.lens,
            new OxigraphStore(),
            { title: built.title, at: last.step.when },
            samesStillJoined,
          )
        ).store;
      const joinedByCurrentVersion: SamesStillJoined = async (held) => {
        const { rows } = await held.select(`${PREFIXES}
          SELECT DISTINCT ?matcherJudgment ?now WHERE {
            ?matcherJudgment prov:wasAttributedTo cascade:CascadeMatcher ; cascade:verdict cascade:Same ; prov:wasDerivedFrom ?input .
            ?input prov:specializationOf ?series .
            ?series pav:hasCurrentVersion ?now .
            FILTER (?now != ?input)
          }`);
        returned = rows
          .filter((row) => row.get("matcherJudgment")?.value === same)
          .map((row) => [
            iri(row.get("matcherJudgment")?.value ?? ""),
            iri(
              "https://ns.cascadeprotocol.org/cascade#membersJoinedByCurrentTableVersion",
            ),
            iri(row.get("now")?.value ?? ""),
          ]);
        return returned;
      };
      separate = await read();
      together = await read(joinedByCurrentVersion);
    });

    it("leaves the Same's members in separate entries when no `samesStillJoined` is passed", async () => {
      assert.equal(await separate.ask(countedInOneEntry), false);
    });

    it("puts the Same's members in one entry when `samesStillJoined` returns the Same with its members' current version", async () => {
      assert.equal(returned.length, 1);
      assert.equal(await together.ask(countedInOneEntry), true);
    });

    it("names the table versions a view was built with by `prov:wasDerivedFrom`", async () => {
      assert.equal(
        await together.ask(
          `${PREFIXES} ASK { GRAPH ?view { ?view a cascade:View ; prov:wasDerivedFrom ?version } ?version prov:specializationOf ?series }`,
        ),
        true,
        "a view names the reference versions it was built with by prov:wasDerivedFrom",
      );
    });

    it("states `prov:used` on no view built with a table version", async () => {
      assert.equal(
        await together.ask(
          `${PREFIXES} ASK { GRAPH ?view { ?view a cascade:View ; prov:used ?version } }`,
        ),
        false,
        "prov:used is on an activity",
      );
    });
  });
});

describe("Keeping one build of a pod across steps · CorePodOptions.build, CorePod.select()", () => {
  describe("given a pod opened with `build.incremental` over files that already hold records", () => {
    /** What the first copy read from its files over its first two steps. */
    let found: ReadonlyMap<string, number>;
    /** The copy the entry was made in, and what a build of its whole pod writes. */
    let entered: CountedFiles;
    let wholeFiles: ReadonlyMap<string, readonly Triple[]>;
    let refused: unknown;
    let records: string[];
    let loadedAll: number;
    /** The stores that loaded every record for two stated reads and a judgment, and for a stated read after it; the judgments each read found. */
    let statedReads: {
      filed: number;
      after: number;
      judgments: readonly number[];
    };

    before(async () => {
      const counting = countingStores();
      const first = await countedCopy();
      const stepped = opened(first);
      await stepped.refuse("a first step");
      await stepped.refuse("a second step");
      found = new Map(first.found);

      entered = await countedCopy();
      records = (
        await entered.list(
          layout.records(
            "https://ns.cascadeprotocol.org/cascade#AllergyOrIntolerance",
          )?.folder ?? "",
        )
      )
        .filter((path) => layout.isRdf(path))
        .map((path) => address + path);
      const entering = opened(entered, counting.newStore);
      const owner = `${address}${layout.card}#me`;
      ({ refused } = await entering.enter({
        bytes: new TextEncoder().encode(`
          <urn:uuid:${crypto.randomUUID()}> a <http://www.w3.org/ns/prov#Activity> ;
            <http://www.w3.org/2000/01/rdf-schema#label> "an entry" ;
            <http://www.w3.org/ns/prov#qualifiedAssociation> [ <http://www.w3.org/ns/prov#agent> <${owner}> ;
              <http://www.w3.org/ns/prov#hadRole> <https://ns.cascadeprotocol.org/cascade#PatientRole> ] .
          <urn:cascade:output-0> a <https://ns.cascadeprotocol.org/cascade#AllergyOrIntolerance> .
          <urn:cascade:output-0-version> <http://www.w3.org/ns/prov#specializationOf> <urn:cascade:output-0> ;
            <https://ns.cascadeprotocol.org/cascade#allergenName> "Penicillin" .`),
        base: "urn:entry",
        name: "an entry",
      }));
      loadedAll = counting.loadedAll(records);
      const stated = await podStated(entered, layout, new OxigraphStore());
      const { kept, files } = await KeptBuild.whole(
        {
          pod: entered,
          layout,
          address,
          newStore: () => new OxigraphStore(),
          build: incremental,
          lens: LENS,
          samesStillJoined: () => Promise.resolve([]),
        },
        {
          address,
          at: stated.at ?? "",
          title: "matching",
          snapshot: entering.head?.snapshot ?? "",
        },
      );
      kept.free();
      wholeFiles = files;

      const judging = countingStores();
      const judged = opened(await countedCopy(), judging.newStore);
      await judged.dataset(LENS);
      judging.forget();
      const judgedProfile = `${PREFIXES} SELECT ?judgment WHERE { ?judgment a cascade:Judgment ; prov:hadMember <${profiles[0]}> }`;
      const before = await judged.selectStated(judgedProfile);
      await judged.selectStated(
        `${PREFIXES} SELECT ?record WHERE { ?record a cascade:AllergyOrIntolerance }`,
      );
      const { refused: judgmentRefused } = await judged.judge(
        aboutJudgment(profiles[0] as string),
      );
      assert.equal(judgmentRefused, undefined);
      const filed = judging.loadedAll(records);
      judging.forget();
      const after = await judged.selectStated(judgedProfile);
      statedReads = {
        filed,
        after: judging.loadedAll(records),
        judgments: [before.rows.length, after.rows.length],
      };
      judged.close();
    });

    it("reads each file the pod held at most once over its first two steps", () => {
      assert.ok(found.size > 0);
      assert.deepEqual(
        [...found].filter(([, reads]) => reads > 1),
        [],
      );
    });

    it("loads the records the pod held into one store for its first entry session", () => {
      assert.equal(refused, undefined);
      assert.ok(records.length > 0);
      assert.equal(loadedAll, 1);
    });

    it("reads the pod's own files into one store for its stated reads and a judgment's filing, and into another for the build the judgment calls for", () => {
      assert.equal(statedReads.filed, 2);
    });

    it("reads the pod's own files again for a stated read after a step, and finds what the step wrote", () => {
      assert.equal(statedReads.after, 1);
      assert.deepEqual(statedReads.judgments, [0, 1]);
    });

    it("writes for its first entry session the files a build of the whole pod writes", async () => {
      await writtenAsBuiltWhole(entered, (path) =>
        Promise.resolve([...(wholeFiles.get(path) ?? [])]),
      );
    });
  });

  describe("given a step that enters a record into a pod whose build is kept across steps", () => {
    /** For each record file the step wrote, the times its Turtle was checked as it was loaded into a store. */
    let used: readonly { path: string; checked: number }[];

    before(async () => {
      const files = await countedCopy();
      const counting = countingStores();
      const stepping = opened(files, counting.newStore);
      await stepping.refuse("a first step");
      const owner = `${address}${layout.card}#me`;
      const { wrote, refused } = await stepping.enter({
        bytes: new TextEncoder().encode(`
          <urn:uuid:${crypto.randomUUID()}> a <http://www.w3.org/ns/prov#Activity> ;
            <http://www.w3.org/2000/01/rdf-schema#label> "an entry" ;
            <http://www.w3.org/ns/prov#qualifiedAssociation> [ <http://www.w3.org/ns/prov#agent> <${owner}> ;
              <http://www.w3.org/ns/prov#hadRole> <https://ns.cascadeprotocol.org/cascade#PatientRole> ] .
          <urn:cascade:output-0> a <https://ns.cascadeprotocol.org/cascade#AllergyOrIntolerance> .
          <urn:cascade:output-0-version> <http://www.w3.org/ns/prov#specializationOf> <urn:cascade:output-0> ;
            <https://ns.cascadeprotocol.org/cascade#allergenName> "Latex" .`),
        base: "urn:entry",
        name: "an entry",
      });
      assert.equal(refused, undefined);
      const records = layout.records(
        "https://ns.cascadeprotocol.org/cascade#AllergyOrIntolerance",
      )?.folder;
      used = wrote
        .filter(
          (path) =>
            records !== undefined &&
            path.startsWith(records) &&
            layout.isRdf(path),
        )
        .map((path) => ({ path, checked: counting.checked(address + path) }));
      stepping.close();
    });

    it("checks the Turtle of each record file it wrote once, loading it into the build it keeps and the scope of its rebuild", () => {
      assert.ok(used.length > 0, "the step wrote a record's file");
      assert.deepEqual(
        used.filter(({ checked }) => checked !== 1),
        [],
      );
    });
  });

  describe("given files loaded into a scope, some of them held by the kept store", () => {
    it("checks the Turtle of a file the kept store does not hold, and reads again unchecked one it holds", async () => {
      const files = await countedCopy();
      const counting = countingStores();
      const paths = (
        await files.list(
          layout.records(
            "https://ns.cascadeprotocol.org/cascade#AllergyOrIntolerance",
          )?.folder ?? "",
        )
      ).filter((path) => layout.isRdf(path));
      const [held, other] = paths;
      assert.ok(held !== undefined && other !== undefined);
      await podFilesParsed(
        files,
        layout,
        address,
        new Union(counting.newStore()),
        [held, other],
        new Set([held]),
      );
      assert.deepEqual(
        [counting.checked(address + held), counting.checked(address + other)],
        [0, 1],
      );
    });
  });

  /** An About judgment of `profile`, as the owner files it, named at random. */
  function aboutJudgment(profile: string): StepFile {
    return aboutJudgmentIn({ address, subject }, profile);
  }

  /** An About judgment of `profile` as the owner of the pod at `in.address`, whose person is `in.subject`, files it. */
  function aboutJudgmentIn(
    { address, subject }: { address: string; subject: string },
    profile: string,
  ): StepFile {
    const owner = `${address}${layout.card}#me`;
    return {
      bytes: new TextEncoder().encode(`
          <urn:uuid:${crypto.randomUUID()}> a <https://ns.cascadeprotocol.org/cascade#Judgment> ;
            <https://ns.cascadeprotocol.org/cascade#verdict> <https://ns.cascadeprotocol.org/cascade#About> ;
            <https://ns.cascadeprotocol.org/cascade#subject> <${subject}> ;
            <https://ns.cascadeprotocol.org/cascade#basis> <https://ns.cascadeprotocol.org/cascade#OwnerStatement> ;
            <http://www.w3.org/ns/prov#hadMember> <${profile}> ;
            <http://www.w3.org/ns/prov#wasAttributedTo> <${owner}> ;
            <http://www.w3.org/ns/prov#wasGeneratedBy> [ <http://www.w3.org/ns/prov#qualifiedAssociation> [
              <http://www.w3.org/ns/prov#agent> <${owner}> ;
              <http://www.w3.org/ns/prov#hadRole> <https://ns.cascadeprotocol.org/cascade#PatientRole> ] ] .
          <${owner}> a <http://www.w3.org/ns/prov#Person> .`),
      base: "urn:judgment",
      name: "the judgment",
    };
  }
  const profiles = [
    "urn:uuid:11111111-1111-4111-8111-111111111111",
    "urn:uuid:22222222-2222-4222-8222-222222222222",
  ];

  describe("given a pod opened over files that hold a counting About, read with `CorePod.selectKept()`", () => {
    const tied = () => `${PREFIXES}
      SELECT DISTINCT ?profile WHERE {
        ?judgment cascade:countsUnderLens true ; cascade:verdict cascade:About ;
          prov:hadMember ?profile ; cascade:subject <${subject}> . }`;
    const profilesOf = (found: Rows) =>
      found.rows.map((row) => row.get("profile")?.value).sort();

    async function aboutFiled(): Promise<CorePod> {
      const files = await countedCopy();
      const filed = opened(files);
      await filed.judge(aboutJudgment(profiles[0] as string));
      await filed.judge(aboutJudgment(profiles[1] as string));
      filed.close();
      return opened(files);
    }

    it("builds the pod whole for the first read and builds nothing for the second", async () => {
      const reopened = await aboutFiled();
      const first = await probing(() => reopened.selectKept(tied()));
      assert.equal(first.seen.spans.get("kept.whole")?.calls, 1);
      const second = await probing(() => reopened.selectKept(tied()));
      assert.equal(second.seen.spans.get("kept.whole"), undefined);
      assert.equal(second.seen.spans.get("matcher.view"), undefined);
      for (const profile of profiles)
        assert.ok(profilesOf(second.result).includes(profile), profile);
      reopened.close();
    });

    it("reads a pod whose manifest names no build's hash, opened to keep its build beside it, though the tables cannot load", async () => {
      const files = await countedCopy();
      const filed = opened(files);
      await filed.judge(aboutJudgment(profiles[0] as string));
      filed.close();
      const reopened = opened(
        files,
        undefined,
        undefined,
        new MemoryFiles("urn:example:beside/"),
      );
      const kept = await reopened.selectKept(tied());
      reopened.close();
      assert.ok(profilesOf(kept).includes(profiles[0] as string));
    });

    it("finds the profiles the matcher's view finds, the read the import's claim was made over before it read the kept build", async () => {
      const reopened = await aboutFiled();
      const kept = await reopened.selectKept(tied());
      const view = await reopened.select(tied());
      for (const profile of profiles)
        assert.ok(profilesOf(kept).includes(profile), profile);
      assert.deepEqual(profilesOf(kept), profilesOf(view));
      reopened.close();
    });
  });

  describe("given two judgments filed inside `CorePod.deferring()`, whose steps leave their rebuild", () => {
    /** The times the build wrote the pod's manifest, which it writes once in each rebuild. */
    const rebuilds = (files: CountedFiles) =>
      files.writes.get(layout.manifest) ?? 0;

    it("rebuilds once for both, as a build of the whole pod writes", async () => {
      const files = await countedCopy();
      const stepped = opened(files);
      await stepped.refuse("a first step");
      const before = rebuilds(files);
      await stepped.deferring(async () => {
        for (const profile of profiles)
          assert.equal(
            (await stepped.judge(aboutJudgment(profile))).refused,
            undefined,
          );
      });
      assert.equal(rebuilds(files) - before, 1);
      const { kept, files: whole } = await KeptBuild.whole(
        {
          pod: files,
          layout,
          address,
          newStore: () => new OxigraphStore(),
          build: incremental,
          lens: LENS,
          samesStillJoined: () => Promise.resolve([]),
        },
        {
          address,
          at: (await podStated(files, layout, new OxigraphStore())).at ?? "",
          title: "matching",
          ...(stepped.head === undefined
            ? {}
            : { snapshot: stepped.head.snapshot }),
        },
      );
      kept.free();
      await writtenAsBuiltWhole(files, (path) =>
        Promise.resolve([...(whole.get(path) ?? [])]),
      );
    });

    it("rebuilds before the first read inside `deferring()`, which finds the judgment counting", async () => {
      const files = await countedCopy();
      const stepped = opened(files);
      await stepped.refuse("a first step");
      const before = rebuilds(files);
      let counting: Awaited<ReturnType<CorePod["select"]>> | undefined;
      await stepped.deferring(async () => {
        await stepped.judge(aboutJudgment(profiles[0] as string));
        assert.equal(rebuilds(files) - before, 0, "left to the read");
        counting = await stepped.select(
          `${PREFIXES} SELECT ?judgment WHERE { ?judgment cascade:countsUnderLens true ; prov:hadMember <${profiles[0]}> }`,
        );
        assert.equal(rebuilds(files) - before, 1, "by the read");
        await stepped.judge(aboutJudgment(profiles[1] as string));
      });
      assert.equal(counting?.rows.length, 1);
      assert.equal(rebuilds(files) - before, 2);
    });

    it("rebuilds before it throws what the run threw, leaving the judgment counting for the next read", async () => {
      const files = await countedCopy();
      const stepped = opened(files);
      await stepped.refuse("a first step");
      const before = rebuilds(files);
      await assert.rejects(
        stepped.deferring(async () => {
          await stepped.judge(aboutJudgment(profiles[0] as string));
          throw new Error("the run stopped");
        }),
        /the run stopped/,
      );
      assert.equal(rebuilds(files) - before, 1);
      const rows = await stepped.select(
        `${PREFIXES} SELECT ?judgment WHERE { ?judgment cascade:countsUnderLens true ; prov:hadMember <${profiles[0]}> }`,
      );
      assert.equal(rows.rows.length, 1);
    });

    /** What `deferring` throws when the run throws `fromRun` and the rebuild after it fails. */
    async function thrownWhenBothFail(fromRun: unknown): Promise<unknown> {
      const files = await countedCopy();
      let failing = false;
      const write = files.write.bind(files);
      files.write = (path, bytes) =>
        failing && path === layout.manifest
          ? Promise.reject(new Error("the manifest cannot be written"))
          : write(path, bytes);
      const stepped = opened(files);
      await stepped.refuse("a first step");
      return stepped
        .deferring(async () => {
          await stepped.judge(aboutJudgment(profiles[0] as string));
          failing = true;
          throw fromRun;
        })
        .catch((error: unknown) => error);
    }

    it("throws an AggregateError of what the run threw and the failure of the rebuild after it, when both fail", async () => {
      const original = new Error("the run stopped");
      const thrown = await thrownWhenBothFail(original);
      assert.ok(thrown instanceof AggregateError);
      assert.match(
        thrown.message,
        /the rebuild failed after the run failed: the run stopped/,
      );
      assert.equal(thrown.errors[0], original);
      assert.equal(
        original.cause,
        undefined,
        "the caller's error is not touched",
      );
      const [, rebuild] = thrown.errors as [unknown, unknown];
      assert.ok(rebuild instanceof BuildFailure);
      assert.match(rebuild.message, /the manifest cannot be written/);
    });

    it("keeps a frozen error the run threw, when the rebuild after it fails too", async () => {
      const original = Object.freeze(new Error("the run stopped"));
      const thrown = await thrownWhenBothFail(original);
      assert.ok(thrown instanceof AggregateError);
      assert.equal(thrown.errors[0], original);
    });

    it("keeps what the run threw when it is no Error, when the rebuild after it fails too", async () => {
      const thrown = await thrownWhenBothFail("a string");
      assert.ok(thrown instanceof AggregateError);
      assert.equal(thrown.errors[0], "a string");
    });

    it("refuses to close, leaving the rebuild to the end of the run", async () => {
      const files = await countedCopy();
      const stepped = opened(files);
      await stepped.refuse("a first step");
      const before = rebuilds(files);
      await stepped.deferring(async () => {
        await stepped.judge(aboutJudgment(profiles[0] as string));
        assert.throws(() => stepped.close(), /close\(\) inside deferring/);
      });
      assert.equal(rebuilds(files) - before, 1);
    });

    it("refuses a judgment that names a finding the pod holds, and leaves the rebuild to the end of the run", async () => {
      const files = await countedCopy();
      const finding = `urn:uuid:${crypto.randomUUID()}`;
      await files.write(
        layout.place(`${CASCADE}FindingForReview`).path(finding),
        new TextEncoder().encode(
          `<${finding}> a <${CASCADE}FindingForReview> ; <http://www.w3.org/ns/oa#hasBody> <${CASCADE}MatcherJudgmentsNoLongerReached> .`,
        ),
      );
      const stepped = opened(files);
      await stepped.refuse("a first step");
      const before = rebuilds(files);
      let refused: string | undefined;
      await stepped.deferring(async () => {
        await stepped.judge(aboutJudgment(profiles[0] as string));
        refused = (await stepped.judge(aboutJudgment(finding))).refused;
        assert.equal(rebuilds(files) - before, 0, "forced by the check");
      });
      assert.ok(refused?.includes(`${finding} is a finding for review`));
      assert.equal(rebuilds(files) - before, 1);
    });
  });

  describe("given a pod whose matcher filed a finding for review, outside any step", () => {
    it("refuses a judgment that names the finding", async () => {
      const kit = await localVocabulary(ROOT);
      const built = await featurePod(
        kit,
        FEATURE,
        new MemoryFiles("https://pod.example/"),
        {
          example:
            "a potassium of another value at the same instant and unit is a finding of different result values, and one in another unit a finding of different result units, never a Same",
        },
      );
      const where = {
        address: built.story.address,
        subject: built.story.subject,
      };
      const reopened = opened(
        built.pod as MemoryFiles,
        () => new OxigraphStore(),
        where,
      );
      const { rows } = await reopened.select(
        `${PREFIXES} SELECT ?finding WHERE { ?finding a cascade:FindingForReview } LIMIT 1`,
      );
      const finding = rows[0]?.get("finding")?.value;
      assert.ok(finding, "the matcher filed no finding");
      const judged = await reopened.judge(aboutJudgmentIn(where, finding));
      assert.ok(
        judged.refused?.includes(`${finding} is a finding for review`),
        String(judged.refused),
      );
      reopened.close();
    });
  });
});

/**
 * Nothing stops two files of a pod from stating the same thing: a pod may hold files another app wrote. A matcher run
 * is not refused for it.
 */
describe("Matching a pod whose files repeat a statement · CorePod.match()", () => {
  describe("given a pod in which a second file states again one record's first revision", () => {
    let restated: CorePod;
    before(async () => {
      const [[first, record] = []] = (
        await values(
          store,
          `SELECT ?first ?record WHERE { ?first cascade:revisionOf ?record FILTER NOT EXISTS { ?first prov:wasRevisionOf [] } }`,
        )
      ).map((row) => row.split(" "));
      assert.ok(first && record, "no record has a first revision");
      const copy = await copied(pod, {
        "restated.ttl": new TextEncoder().encode(
          `<${first}> <https://ns.cascadeprotocol.org/cascade#revisionOf> <${record}> .`,
        ),
      });
      restated = new CorePod({
        runtime: RUNTIME,
        pod: copy,
        address,
        subject,
        title: "matching",
        vocabulary: vocabularyFiles,
        layout,
        newStore: () => new OxigraphStore(),
        time: clock,
        importers: [],
        references: () =>
          References.of(
            vocabularyFiles,
            `${storyFolder}/references/`,
            () => new OxigraphStore(),
            vocabularyFiles,
          ),
        build: {
          lens: LENS,
          derive: await vocabularyDerive(vocabularyFiles, layout),
        },
      });
    });

    it("does not refuse `match()`", async () => {
      assert.equal((await restated.match()).refused, undefined);
    });
  });
});
