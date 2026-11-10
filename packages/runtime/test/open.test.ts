import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { CorePod } from "../src/core-pod.js";
import { MemoryFiles } from "../src/files.js";
import { parseGraph } from "../src/graph.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { References } from "../src/references.js";
import { replay } from "../src/replay.js";
import { randomId } from "../src/ids.js";
import { ntriples } from "../src/rdf.js";
import { CASCADE } from "../src/step.js";
import {
  layout,
  replayed,
  RUNTIME,
  storyFrom,
  vocabulary,
} from "./vocabulary.js";

const FEATURE = "runtime/opening.feature";
const JUDGMENT = "https://ns.cascadeprotocol.org/cascade#Judgment";
const ASSERTION =
  "https://ns.cascadeprotocol.org/cascade#MatcherJudgmentAssertion";
const newStore = (): OxigraphStore => new OxigraphStore();

const VARIANTS = "urn:uuid:3f0c1b52-6a4e-4d8e-9b1f-2c7a5e9d4b10";
const [V1, V2, V3] = [
  "urn:uuid:3f0c1b52-6a4e-4d8e-9b1f-2c7a5e9d4b11",
  "urn:uuid:3f0c1b52-6a4e-4d8e-9b1f-2c7a5e9d4b12",
  "urn:uuid:3f0c1b52-6a4e-4d8e-9b1f-2c7a5e9d4b13",
];
const RULES_10 = "urn:uuid:ddb435a8-0aa6-4b17-a830-469bc38186cd";
const HGVS = "https://ns.cascadeprotocol.org/codes/hgvs/";
const SAME_VARIATION = `${CASCADE}SameVariationThroughTable`;

/**
 * The vocabulary's rule list, at version 10 by default, and a variant classifications series whose versions each hold
 * the ClinVar rows given, by ID, each with its HGVS expression, revising the version before it, the last the default.
 */
async function variantTables(
  versions: readonly (readonly [
    string,
    readonly (readonly [number, string])[],
  ])[],
): Promise<References> {
  const files = await vocabulary();
  const tables = new MemoryFiles("https://tables.example/");
  const index = [
    new TextDecoder().decode(
      await files.read("runtime/rule-list/references.ttl"),
    ),
    `<${VARIANTS}> a cascade:ReferenceSeries ; rdfs:label "ClinVar" ; cascade:tableKind cascade:VariantClassifications ; cascade:defaultTableVersion <${versions.at(-1)?.[0] ?? ""}> .`,
    ...versions.map(
      ([version], at) =>
        `<${version}> a prov:Entity ; prov:specializationOf <${VARIANTS}> ; pav:version "${at + 1}"${at === 0 ? "" : ` ; prov:wasRevisionOf <${versions[at - 1]?.[0] ?? ""}>`} .`,
    ),
  ].join("\n");
  await tables.write("references.ttl", new TextEncoder().encode(index));
  for (const [version, rows] of versions)
    await tables.write(
      `${version.slice("urn:uuid:".length)}.ttl`,
      new TextEncoder().encode(
        rows
          .map(
            ([id, expression]) =>
              `<https://identifiers.org/clinvar:${id}> <${CASCADE}hgvsExpression> <${HGVS}${encodeURIComponent(expression)}> ; <${CASCADE}clinvarClassification> <${CASCADE}Pathogenic> .`,
          )
          .join("\n"),
      ),
    );
  return References.of(tables, "", newStore, files);
}

/** The pod's files describing each series or version of the tables as a pod states it (M8), by path. */
async function described(
  tables: References,
  things: readonly string[],
): Promise<Map<string, Uint8Array>> {
  const placed = (await layout()).place(`${CASCADE}ReferenceSeries`);
  const files = new Map<string, Uint8Array>();
  for (const thing of things)
    files.set(
      tables.isVersion(thing)
        ? (await layout()).version(placed, thing)
        : placed.path(thing),
      ntriples(await tables.podDescription(thing)),
    );
  return files;
}

/** A new pod for Ivo, opened with the tables, holding the files given before it enters two variants of one expression. */
async function variantPod(
  tables: References,
  held: ReadonlyMap<string, Uint8Array>,
) {
  const story = {
    address: "https://pod.example/",
    subject: "urn:uuid:c1643cc9-f0c4-447e-8b47-ecc71130d83b",
  };
  let tick = Date.parse("2026-07-01T09:00:00Z");
  const options = {
    runtime: RUNTIME,
    pod: new MemoryFiles(story.address),
    address: story.address,
    subject: story.subject,
    title: "",
    vocabulary: await vocabulary(),
    layout: await layout(),
    newStore,
    time: {
      newId: randomId,
      now: () => new Date((tick += 60_000)).toISOString(),
    },
    importers: [],
    references: () => Promise.resolve(tables),
  };
  const created = new CorePod(options);
  await created.create();
  await created.open(tables);
  for (const [path, bytes] of held) await options.pod.write(path, bytes);
  const pod = new CorePod(options);
  const variant = (n: number) =>
    `<urn:cascade:output-${n}> a cascade:GeneticVariantFinding .
<urn:cascade:output-${n}-version> prov:specializationOf <urn:cascade:output-${n}> ;
  cascade:hgvsCodingDnaExpression "NM_000249.3:c.2042C>T" ; cascade:patient <${story.subject}> .`;
  const { activity } = await pod.enter({
    bytes: new TextEncoder().encode(`@prefix cascade: <${CASCADE}> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<urn:uuid:9d3e7a14-52b8-4c61-a0f2-6e8b1d4c7a95> a prov:Activity ; rdfs:label "entered in the Cascade app" ;
  prov:qualifiedAssociation [ prov:agent <${story.address}profile/card.ttl#me> ; prov:hadRole cascade:PatientRole ] .
${variant(0)}
${variant(1)}`),
    base: "https://tables.example/variants.ttl",
    name: "variants",
  });
  return { pod, matched: await pod.match(activity) };
}

/** The justifications of the matcher judgments among the files written. */
async function justifications(
  pod: CorePod,
  wrote: readonly string[],
): Promise<string[]> {
  const found: string[] = [];
  for (const path of wrote) {
    const { triples } = await parseGraph(
      (await pod.files.read(path)) ?? new Uint8Array(),
      pod.files.iri + path,
      newStore,
    );
    if (triples.some(([, , object]) => object.value === JUDGMENT))
      found.push(
        ...triples.flatMap(([, predicate, object]) =>
          predicate.value === `${CASCADE}justification` ? [object.value] : [],
        ),
      );
  }
  return found;
}

/** The files under `prefix` that `wrote` names, as `[path, text]`. */
async function writtenUnder(
  done: Awaited<ReturnType<typeof replayed>>,
  prefix: string,
): Promise<[string, string][]> {
  const found: [string, string][] = [];
  for (const path of done.steps.at(-1)?.wrote ?? [])
    if (path.startsWith(prefix))
      found.push([path, new TextDecoder().decode(await done.pod.read(path))]);
  return found;
}

/**
 * An app opens a pod with the reference tables it carries, which may be newer, older or other than those the pod was last
 * matched with. `open` adopts what the tables hold of the pod's series, and returns in `unheld` the versions they do not
 * hold, so an app can say a newer app has been here.
 * @rule runtime/opening.feature O1
 * @rule runtime/opening.feature O2
 * @rule runtime/matcher.feature M9
 * @rule runtime/matcher.feature M13
 * @rule runtime/matcher.feature M18
 * @rule runtime/naming.feature N15
 */
describe("Opening a pod with tables it was not made on · CorePod.open(), Performed.unheld, CorePod.unheldTableVersions()", () => {
  describe("given tables that lack a series the pod was matched with", () => {
    let unheld: readonly string[] | undefined;
    let refused: string | undefined;
    let opened: string | undefined;
    let used: string[];

    before(async () => {
      const { folder, steps } = await replayed(
        FEATURE,
        "a pod made on the vector tables, opened with an app's, is judged by the app's tables and writes nothing of the vector tables",
      );
      const last = steps.at(-1);
      opened = last?.step.happened.kind;
      unheld = last?.unheld;
      refused = last?.refused;
      const vector = await References.of(
        await vocabulary(),
        `${folder}/references/`,
        newStore,
      );
      used = [
        await vector.ruleList(),
        ...vector.seriesOfKind(`${CASCADE}VaccineGroups`),
      ]
        .map((series) => vector.fallback(series))
        .sort();
    });

    it("returns the pod's versions of those series in `unheld`", () => {
      assert.deepEqual(unheld, used);
    });

    it("refuses nothing", () => {
      assert.equal(opened, "open");
      assert.equal(refused, undefined);
    });
  });

  describe("given tables that list another version of the pod's rule list, on no line with it", () => {
    const rules = "f32ebeea-4ed7-4da7-b08c-031dc619538e";
    const other = "0b6f2c1e-9d4a-4e7b-8c3f-5a1d2e6b7f90";
    let unheld: readonly string[] | undefined;
    let refused: string | undefined;
    let opened: string | undefined;

    before(async () => {
      const { steps } = await replayed(
        FEATURE,
        "adopting describes each version after the pod's up to the adopted one",
        {
          source: async (files, folder) => {
            const source = new MemoryFiles(files.iri);
            for (const path of await files.list(`${folder}/`)) {
              const bytes = (await files.read(path)) ?? new Uint8Array();
              await source.write(
                path,
                path === `${folder}/tables/app-later/references.ttl`
                  ? new TextEncoder().encode(
                      new TextDecoder().decode(bytes).replaceAll(rules, other),
                    )
                  : bytes,
              );
            }
            await source.write(
              `${folder}/tables/app-later/${other}.ttl`,
              (await files.read(`runtime/rule-list/${rules}.ttl`)) ??
                new Uint8Array(),
            );
            return source;
          },
        },
      );
      unheld = steps.at(-1)?.unheld;
      refused = steps.at(-1)?.refused;
      opened = steps.at(-1)?.step.happened.kind;
    });

    it("returns the pod's version in `unheld`", () => {
      assert.deepEqual(unheld, [`urn:uuid:${rules}`]);
    });

    it("refuses nothing", () => {
      assert.equal(opened, "open");
      assert.equal(refused, undefined);
    });
  });

  describe("CorePod.unheldTableVersions()", () => {
    it("returns the version a pod names of a series when the tables hold only the version it revises", async () => {
      const pod = new MemoryFiles("https://pod.example/");
      await pod.write(
        "judgments/matcher-judgment.ttl",
        new TextEncoder()
          .encode(`@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix pav: <http://purl.org/pav/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
<urn:x:map> a cascade:ReferenceSeries ; cascade:tableKind cascade:SubstanceIngredients .
<urn:x:map-1> prov:specializationOf <urn:x:map> ; pav:version "1" .
<urn:x:map-2> prov:specializationOf <urn:x:map> ; pav:version "2" ; prov:wasRevisionOf <urn:x:map-1> .
<urn:x:matcher-judgment> a cascade:Judgment ; cascade:verdict cascade:Same ; prov:wasAttributedTo cascade:CascadeMatcher ;
    cascade:matcherRule cascade:SameMappedCodeRule ; prov:wasDerivedFrom <urn:x:map-1> ; prov:hadMember <urn:x:a> , <urn:x:b> .
<urn:x:assertion> a cascade:MatcherJudgmentAssertion ; cascade:assertedJudgment <urn:x:matcher-judgment> .
`),
      );
      const held = {
        seriesOf: (version: string) =>
          version === "urn:x:map-1" ? "urn:x:map" : undefined,
      } as unknown as References;
      const core = new CorePod({
        runtime: RUNTIME,
        pod,
        address: "https://pod.example/",
        subject: "urn:uuid:7c2d9e41-5a8b-4f36-b0e2-9d1a4c6f8e53",
        title: "",
        vocabulary: await vocabulary(),
        layout: await layout(),
        newStore,
        time: { newId: randomId, now: () => "2026-02-01T08:00:00Z" },
        importers: [],
        references: () => Promise.resolve(held),
      });
      assert.deepEqual(await core.unheldTableVersions(), ["urn:x:map-2"]);
    });
  });

  describe("given tables with no rule list", () => {
    let refused: string | undefined;
    let matched: string | undefined;

    before(async () => {
      const files = await vocabulary();
      const { story, folder } = await storyFrom(
        FEATURE,
        "opening again with the same tables writes nothing",
      );
      const app = await References.of(
        files,
        `${folder}/tables/app/`,
        newStore,
        files,
      );
      const empty = new MemoryFiles("https://tables.example/");
      await empty.write("references.ttl", new Uint8Array());
      const pod = new CorePod({
        runtime: RUNTIME,
        pod: new MemoryFiles(story.address),
        address: story.address,
        subject: story.subject,
        title: "",
        vocabulary: files,
        layout: await layout(),
        newStore,
        time: { newId: randomId, now: () => "2026-07-01T09:00:00Z" },
        importers: [],
        references: () => Promise.resolve(app),
      });
      await pod.create();
      refused = (await pod.open(await References.of(empty, "", newStore)))
        .refused;
      matched = (await pod.match()).refused;
    });

    it("returns `refused`", () => {
      assert.ok(refused);
    });

    it("leaves the pod matching with the tables it had", () => {
      assert.equal(matched, undefined);
    });
  });

  describe("when the clock moves between an open's judgments", () => {
    let refused: string | undefined;
    let wrote: number;
    let judgments: string[];

    before(async () => {
      const files = await vocabulary();
      const { story, folder } = await storyFrom(
        FEATURE,
        "a rule list the pod names that M11 now refuses joins nothing, so the adopted rule list judges every pair, and finds each matcher judgment asserted with the query it runs",
      );
      const pod = new MemoryFiles(story.address);
      await replay({
        runtime: RUNTIME,
        story: { ...story, steps: story.steps.slice(0, -1) },
        source: files,
        vocabulary: files,
        folder,
        title: "",
        pod,
        newStore,
        layout: await layout(),
      });
      const tables = (name: string) =>
        References.of(files, `${folder}/tables/${name}/`, newStore, files);
      let tick = Date.parse("2026-07-03T09:00:00Z");
      const reopened = new CorePod({
        runtime: RUNTIME,
        pod,
        address: story.address,
        subject: story.subject,
        title: "",
        vocabulary: files,
        layout: await layout(),
        newStore,
        time: { newId: randomId, now: () => new Date(tick++).toISOString() },
        importers: [],
        references: () => tables("app"),
      });
      const opened = await reopened.open(await tables("app-new-rules"));
      refused = opened.refused;
      wrote = opened.wrote.length;
      judgments = [];
      for (const path of opened.wrote) {
        const { triples } = await parseGraph(
          (await pod.read(path)) ?? new Uint8Array(),
          pod.iri + path,
          newStore,
        );
        if (
          triples.some(
            ([, , object]) =>
              object.value === JUDGMENT || object.value === ASSERTION,
          )
        )
          judgments.push(path);
      }
    });

    it("writes no judgment and no assertion for a matcher judgment the pod already holds", () => {
      assert.equal(refused, undefined);
      assert.ok(wrote > 0);
      assert.deepEqual(judgments, []);
    });
  });

  describe("given an adopted version that joins a pair the version before it did not", () => {
    let atMatch: string[];
    let matchRefused: string | undefined;
    let atOpen: string[];

    before(async () => {
      const v1Rows: [number, string][] = [
        [90011, "NM_000249.3:c.2042C>T"],
        [90099, "NM_000249.3:c.2042C>T"],
      ];
      const tables = await variantTables([[V1, v1Rows]]);
      const { pod, matched } = await variantPod(
        tables,
        await described(tables, [
          VARIANTS,
          V1,
          await tables.ruleList(),
          RULES_10,
        ]),
      );
      atMatch = await justifications(pod, matched.wrote);
      matchRefused = matched.refused;
      const opened = await pod.open(
        await variantTables([
          [V1, v1Rows],
          [
            V2,
            [
              [90011, "NM_000249.3:c.2042C>T"],
              [90099, "NM_000249.3:c.9999A>G"],
            ],
          ],
        ]),
      );
      atOpen = await justifications(pod, opened.wrote);
    });

    it("files no Same of the pair before the open", () => {
      assert.equal(matchRefused, undefined);
      assert.deepEqual(atMatch, []);
    });

    it("files the pair's Same at the open, by the adopted version's rows alone", () => {
      assert.deepEqual(atOpen, [SAME_VARIATION]);
    });
  });

  describe("given a pod that holds the description of a version newer than the tables' current one", () => {
    it("matches by the rows of the tables' current version", async () => {
      const newer = await variantTables([
        [V2, [[90011, "NM_000249.3:c.2042C>T"]]],
        [V3, []],
      ]);
      const { pod, matched } = await variantPod(
        await variantTables([[V2, [[90011, "NM_000249.3:c.2042C>T"]]]]),
        await described(newer, [V3]),
      );
      assert.deepEqual(await justifications(pod, matched.wrote), [
        SAME_VARIATION,
      ]);
    });
  });

  describe("CorePod.select()", () => {
    let afterMatch: (string | undefined)[];
    let afterOpen: (string | undefined)[];

    before(async () => {
      const tables = await variantTables([
        [V1, [[90011, "NM_000249.3:c.2042C>T"]]],
      ]);
      const { pod } = await variantPod(tables, await described(tables, [V1]));
      const versions = async () =>
        (
          await pod.select(
            `SELECT ?version WHERE { ?version <http://www.w3.org/ns/prov#specializationOf> <${VARIANTS}> }`,
          )
        ).rows.map((row) => row.get("version")?.value);
      afterMatch = await versions();
      await pod.open(
        await variantTables([
          [V1, [[90011, "NM_000249.3:c.2042C>T"]]],
          [V2, [[90011, "NM_000249.3:c.2042C>T"]]],
        ]),
      );
      afterOpen = (await versions()).sort();
    });

    it("returns the pod's description of a table version after a match", () => {
      assert.deepEqual(afterMatch, [V1]);
    });

    it("returns the adopted version's description too, after an open", () => {
      assert.deepEqual(afterOpen, [V1, V2]);
    });
  });

  describe("given two pods taken through the same steps", () => {
    let retractions: [[string, string][], [string, string][]];
    let findings: [[string, string][], [string, string][]];

    before(async () => {
      const twice = (feature: string, example: string) =>
        Promise.all([0, 1].map(() => replayed(feature, example)));
      const [released, matched] = await Promise.all([
        twice(
          "runtime/naming.feature",
          "adopting a release that declares R4 wrong retracts the assertions of R4's two matcher judgments before the open's matcher runs, and neither matcher judgment counts nor lapses",
        ),
        twice(
          "runtime/matcher.feature",
          "opening a pod matched under version 6 with version 7 files one finding naming the matcher judgments of the rule version 7 changed that it did not file again",
        ),
      ]);
      const under = async (runs: typeof released, prefix: string) =>
        Promise.all(runs.map((done) => writtenUnder(done, prefix)));
      const [firstRetractions = [], secondRetractions = []] = await under(
        released,
        "judgments/retractions/",
      );
      const [firstFindings = [], secondFindings = []] = await under(
        matched,
        "findings/",
      );
      retractions = [firstRetractions, secondRetractions];
      findings = [firstFindings, secondFindings];
    });

    it("writes a release's two retractions under the same paths, with the same bytes, in both", () => {
      assert.equal(retractions[0].length, 2);
      assert.deepEqual(retractions[0], retractions[1]);
    });

    it("writes the finding of matcher judgments no longer reached under the same path, with the same bytes, in both", () => {
      assert.equal(findings[0].length, 1);
      assert.deepEqual(findings[0], findings[1]);
    });
  });
});
