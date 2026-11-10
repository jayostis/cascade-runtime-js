import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { appleHealthExport } from "@cascade-runtime/apple-health";
import {
  deriveWith,
  type VocabularyBuild,
  vocabularyBuild,
  vocabularyDerive,
} from "../src/build.js";
import { dataset, podDataset, podStated } from "../src/dataset.js";
import { KeptBuild } from "../src/incremental.js";
import { CorePod } from "../src/core-pod.js";
import type { SamesStillJoined } from "../src/derive.js";
import { viewEntryName } from "../src/names.js";
import { MemoryFiles, readText } from "../src/files.js";
import { clock } from "../src/ids.js";
import { LAYOUT_FILE, type Layout } from "../src/layout.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, type Triple } from "../src/rdf.js";
import { References } from "../src/references.js";
import { type Replayed, replay } from "../src/replay.js";
import { type Dataset, Union } from "../src/store.js";
import { localVocabulary } from "../src/node/runtime.js";
import { featurePod } from "../src/node/story-pod.js";
import { copied } from "./cleo.js";
import { notIsomorphic } from "./graphs.js";
import {
  layout as readLayout,
  ROOT,
  RUNTIME,
  storyFrom,
  vocabulary,
} from "./vocabulary.js";

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
): CorePod {
  return new CorePod({
    runtime: RUNTIME,
    pod: files,
    address,
    subject,
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
          GRAPH ?view { ?thing cascade:mergedFrom [] } FILTER (STRSTARTS(STR(?view), "${views}"))
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
        `SELECT ?view ?entry ?member WHERE { GRAPH ?view { ?view a <https://ns.cascadeprotocol.org/cascade#View> . ?entry <https://ns.cascadeprotocol.org/cascade#mergedFrom> ?member } }`,
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

    it("names each entry its view's address, `#`, and the hash `viewEntryName()` gives its members", async () => {
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
          GRAPH ?view { ?view a cascade:View . ?interpretation cascade:mergedFrom [] ; cascade:variantInterpreted ?variant }
          OPTIONAL { GRAPH <${variants}> { ?variant cascade:mergedFrom ?member } }
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

  describe("given a pod whose matcher Same used a table version that is no longer the current version, read with `podDataset()`", () => {
    /** The Same the example says counts on, by the name it gives it. */
    const same = "urn:uuid:d9369a14-2bff-818e-9628-53cd1a1577b5";
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

    before(async () => {
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
      const stores: Set<string>[] = [];
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
          return super.loadTurtle(turtle, options);
        }
      }
      const entering = opened(entered, () => new CountedStore());
      const owner = `${address}${layout.card}#me`;
      ({ refused } = await entering.enter({
        bytes: new TextEncoder().encode(`
          <urn:uuid:${crypto.randomUUID()}> a <http://www.w3.org/ns/prov#Activity> ;
            <http://www.w3.org/2000/01/rdf-schema#label> "an entry" ;
            <http://www.w3.org/ns/prov#qualifiedAssociation> [ <http://www.w3.org/ns/prov#agent> <${owner}> ;
              <http://www.w3.org/ns/prov#hadRole> <https://ns.cascadeprotocol.org/cascade#PatientRole> ] .
          <urn:cascade:output-0> a <https://ns.cascadeprotocol.org/cascade#AllergyOrIntolerance> .
          <urn:cascade:output-0-version> <http://www.w3.org/ns/prov#specializationOf> <urn:cascade:output-0> ;
            <https://ns.cascadeprotocol.org/cascade#allergen> "Penicillin" .`),
        base: "urn:entry",
        name: "an entry",
      }));
      loadedAll = stores.filter((loaded) =>
        records.every((graph) => loaded.has(graph)),
      ).length;
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

    it("writes for its first entry session the files a build of the whole pod writes", async () => {
      await writtenAsBuiltWhole(entered, (path) =>
        Promise.resolve([...(wholeFiles.get(path) ?? [])]),
      );
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
