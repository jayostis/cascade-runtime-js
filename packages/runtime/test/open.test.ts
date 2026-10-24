import assert from "node:assert/strict";
import { test } from "node:test";
import { CorePod } from "../src/core-pod.js";
import { type Files, MemoryFiles } from "../src/files.js";
import { parseGraph } from "../src/graph.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { References } from "../src/references.js";
import { replay } from "../src/replay.js";
import { randomId } from "../src/ids.js";
import { ntriples } from "../src/rdf.js";
import { CASCADE } from "../src/step.js";
import { layout, RUNTIME, storyFrom, vocabulary } from "./vocabulary.js";

const FEATURE = "runtime/opening.feature";
const JUDGMENT = "https://ns.cascadeprotocol.org/cascade#Judgment";
const ASSERTION = "https://ns.cascadeprotocol.org/cascade#ClaimAssertion";
const MATCHER_RUN = "https://ns.cascadeprotocol.org/cascade#MatcherRun";
const newStore = (): OxigraphStore => new OxigraphStore();

/** The example replayed, its story's files those `source` gives for its folder, and otherwise the vocabulary's. */
async function replayed(
  example: string,
  source?: (files: Files, folder: string) => Promise<Files>,
  feature = FEATURE,
) {
  const files = await vocabulary();
  const { story, folder } = await storyFrom(feature, example);
  const pod = new MemoryFiles(story.address);
  const { steps } = await replay({
    runtime: RUNTIME,
    story,
    source: source === undefined ? files : await source(files, folder),
    vocabulary: files,
    folder,
    title: "",
    pod,
    newStore,
    layout: await layout(),
  });
  return { pod, folder, opened: steps.at(-1) };
}

test("an open writes its judgments first, then the descriptions of the versions it adopts, oldest first, and its run's file last (W1)", async () => {
  const { pod, opened } = await replayed(
    "adopting files again each Same the adopted rows still join, and a Same of each pair only they join",
  );
  const kinds: string[] = [];
  for (const path of opened?.wrote ?? []) {
    const { triples } = await parseGraph(
      (await pod.read(path)) ?? new Uint8Array(),
      pod.iri + path,
      newStore,
    );
    const version = triples.find(
      ([, predicate]) => predicate.value === "http://purl.org/pav/version",
    );
    kinds.push(
      triples.some(([, , object]) => object.value === MATCHER_RUN)
        ? "run"
        : triples.some(([, , object]) => object.value === JUDGMENT)
          ? "judgment"
          : triples.some(([, , object]) => object.value === ASSERTION)
            ? "assertion"
            : `version ${version?.[2].value ?? "?"}`,
    );
  }
  assert.deepEqual(kinds, [
    "judgment",
    "assertion",
    "judgment",
    "assertion",
    "version 2",
    "version 3",
    "run",
  ]);
});

test("an open of a pod on series the tables lack writes nothing of them and names their versions as unheld (O2)", async () => {
  const { folder, opened } = await replayed(
    "a pod made on the vector tables, opened with an app's, is judged by the app's tables and writes nothing of the vector tables",
  );
  const vector = await References.of(
    await vocabulary(),
    `${folder}/references/`,
    newStore,
  );
  const used = [
    await vector.ruleList(),
    ...vector.seriesOfKind(`${CASCADE}VaccineGroups`),
  ].map((series) => vector.fallback(series));
  assert.deepEqual(opened?.unheld, used.sort());
  assert.equal(opened?.refused, undefined);
});

test("an open whose tables list another version of the pod's rule list matches nothing and names the pod's as unheld (O2)", async () => {
  const rules = "f32ebeea-4ed7-4da7-b08c-031dc619538e";
  const other = "0b6f2c1e-9d4a-4e7b-8c3f-5a1d2e6b7f90";
  const { opened } = await replayed(
    "adopting describes each version after the pod's up to the adopted one",
    async (files, folder) => {
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
  );
  assert.equal(opened?.refused, undefined);
  assert.deepEqual(opened?.unheld, [`urn:uuid:${rules}`]);
});

test("an open on a clock that moves between judgments writes nothing for a claim its recheck and its new joins both reach, asserted with the query the adopted rule list runs (O1, M9)", async () => {
  const files = await vocabulary();
  const { story, folder } = await storyFrom(
    FEATURE,
    "a rule list the pod names that M11 now refuses joins nothing, so the adopted rule list judges every pair, and finds each claim asserted with the query it runs",
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
  assert.equal(opened.refused, undefined);
  const judgments = [];
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
  assert.deepEqual(judgments, []);
});

test("a refused open leaves the pod matching with the tables it had", async () => {
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
  assert.ok((await pod.open(await References.of(empty, "", newStore))).refused);
  assert.equal((await pod.match()).refused, undefined);
});

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

test("an open judges a pair its adopted version joins on one row as new though the version it replaces holds that expression on two, and reads neither version's rows with the other's (O1)", async () => {
  const before: [number, string][] = [
    [90011, "NM_000249.3:c.2042C>T"],
    [90099, "NM_000249.3:c.2042C>T"],
  ];
  const tables = await variantTables([[V1, before]]);
  const { pod, matched } = await variantPod(
    tables,
    await described(tables, [VARIANTS, V1, await tables.ruleList(), RULES_10]),
  );
  assert.deepEqual(await justifications(pod, matched.wrote), []);
  const opened = await pod.open(
    await variantTables([
      [V1, before],
      [
        V2,
        [
          [90011, "NM_000249.3:c.2042C>T"],
          [90099, "NM_000249.3:c.9999A>G"],
        ],
      ],
    ]),
  );
  assert.deepEqual(await justifications(pod, opened.wrote), [SAME_VARIATION]);
});

test("a pod holding the description of a version newer than the tables' current one is matched by the current one's rows (M13)", async () => {
  const newer = await variantTables([
    [V2, [[90011, "NM_000249.3:c.2042C>T"]]],
    [V3, []],
  ]);
  const { pod, matched } = await variantPod(
    await variantTables([[V2, [[90011, "NM_000249.3:c.2042C>T"]]]]),
    await described(newer, [V3]),
  );
  assert.deepEqual(await justifications(pod, matched.wrote), [SAME_VARIATION]);
});

test("what the pod answers after a match and an open still holds the pod's reference descriptions, which the matcher leaves out of its comparisons", async () => {
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
  assert.deepEqual(await versions(), [V1]);
  await pod.open(
    await variantTables([
      [V1, [[90011, "NM_000249.3:c.2042C>T"]]],
      [V2, [[90011, "NM_000249.3:c.2042C>T"]]],
    ]),
  );
  assert.deepEqual((await versions()).sort(), [V1, V2]);
});

test("two writers on one release write its retractions under one name with one content, before the open's run (N15)", async () => {
  const runs = await Promise.all(
    [0, 1].map(() =>
      replayed(
        "adopting a release that declares R4 wrong retracts R4's two claims before the open's matcher runs, and neither counts nor lapses",
        undefined,
        "runtime/naming.feature",
      ),
    ),
  );
  const [first, second] = await Promise.all(
    runs.map(async ({ pod, opened }) => {
      const retractions: [string, string][] = [];
      for (const path of opened?.wrote ?? [])
        if (path.startsWith("judgments/retractions/"))
          retractions.push([
            path,
            new TextDecoder().decode(await pod.read(path)),
          ]);
      return retractions;
    }),
  );
  assert.equal(first?.length, 2);
  assert.deepEqual(first, second);
});
