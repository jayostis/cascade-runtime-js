import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { featureStory } from "../src/conformance.js";
import { featuresOf, readFeature } from "../src/features.js";
import { MemoryFiles, relative } from "../src/files.js";
import { Graph } from "../src/graph.js";
import { importersNamed } from "../src/importers.js";
import { MATCHER, readEveryRecord, recordsInOneBlock } from "../src/matcher.js";
import { documentName } from "../src/names.js";
import { FolderFiles } from "../src/node/folder-files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { localVocabulary, readConfig } from "../src/node/runtime.js";
import { featurePod } from "../src/node/story-pod.js";
import { probing } from "../src/probe.js";
import { iri } from "../src/rdf.js";
import { References } from "../src/references.js";
import { Replay, type ReplayOptions, titleOf } from "../src/replay.js";
import type { Step } from "../src/story.js";
import { layout, ROOT, RUNTIME, vocabulary } from "./vocabulary.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const OA = "http://www.w3.org/ns/oa#";
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const ADDRESS = "https://pod.example/";
const GOLDEN = join(ROOT, "packages/runtime/test/joins.golden.txt");
const newStore = () => new OxigraphStore();
const byCodePoint = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

let everyRun: Promise<Runs> | undefined;
/** The runs of the stories, found once for the file's tests. */
const allRuns = (): Promise<Runs> => (everyRun ??= storyRuns());

/**
 * The runs that take records, each performed both ways; and each run over the whole pod, an open's (O1) or a
 * recheck's (M7), after one that took records, as the story performed it: such a run alone files M18's finding of the
 * matcher judgments a rule list version no longer reaches, and its count hangs on what the runs before it asserted.
 */
interface Runs {
  readonly compared: readonly Compared[];
  readonly whole: readonly { readonly label: string; readonly wrote: Wrote }[];
}

/** What one run wrote, by path, but the run's act file, which its random name (N7) makes differ; and any refusal. */
interface Wrote {
  readonly files: [string, string][];
  readonly acts: number;
  readonly refused?: string;
}

/** The records a scoped run reads, and binds its comparisons to, in one VALUES block. */
const BLOCK = 2;

/** The VALUES blocks the scoped runs read and bound records in, the records they held, and the lists split, all told. */
const blocks = { blocks: 0, records: 0, split: 0 };

/**
 * What the step wrote, by path, reading only what a run needs, BLOCK records to a VALUES block, or every record, as
 * many to a block as the runtime takes.
 */
async function performed(
  replay: Replay,
  step: Step,
  every: boolean,
): Promise<Wrote> {
  const fork = await replay.fork();
  readEveryRecord(every);
  if (!every) recordsInOneBlock(BLOCK);
  try {
    const { seen } = await probing(() => fork.perform(step));
    if (!every) {
      blocks.blocks += seen.counts.get("matcher.valuesBlocks") ?? 0;
      blocks.records += seen.counts.get("matcher.valuesBlockRecords") ?? 0;
      blocks.split += seen.counts.get("matcher.valuesListsSplit") ?? 0;
    }
  } finally {
    readEveryRecord(false);
    recordsInOneBlock();
  }
  return lastWrote(fork, step);
}

/** What the replay's last step, the step given, wrote, by path. */
async function lastWrote(replay: Replay, step: Step): Promise<Wrote> {
  const laidOut = await layout();
  const replayed = replay.replayed();
  const last = replayed.steps.at(-1);
  assert.equal(last?.step, step, replayed.stopped?.why);
  const wrote = [...(last?.wrote ?? [])].sort();
  const files: [string, string][] = [];
  for (const path of wrote.filter((path) => !laidOut.inActFolder(path)))
    files.push([path, new TextDecoder().decode(await replayed.pod.read(path))]);
  return {
    files,
    acts: wrote.filter((path) => laidOut.inActFolder(path)).length,
    ...(last?.refused === undefined ? {} : { refused: last.refused }),
  };
}

/** A run of a story, as the matcher read the records it took and as it read every record. */
interface Compared {
  readonly name: string;
  /** The run in its story: the story's folder and the names of the steps through this one, which no other run shares. */
  readonly label: string;
  readonly scoped: Wrote;
  readonly every: unknown;
}

/** A step that runs the matcher over the whole pod: an open (O1) or a recheck (M7). */
function overWholePod({ happened }: Step): boolean {
  return (
    happened.kind === "open" ||
    (happened.kind === "matcher" && happened.takes === undefined)
  );
}

/**
 * Every run that takes records in the stories of the feature files, each performed twice on a fork of the replay as it
 * stood: reading what its joins reach, and reading every record; and each run over the whole pod after one of them.
 */
async function storyRuns(): Promise<Runs> {
  const files = await vocabulary();
  const laidOut = await layout();
  const config = await readConfig(ROOT);
  /**
   * Each story's steps through its last run that takes records, or its last run over the whole pod after one, as a
   * tree: stories that begin alike share a replay.
   */
  interface Node {
    readonly step?: Step;
    readonly children: Map<string, Node>;
  }
  const roots = new Map<
    string,
    {
      readonly folder: string;
      readonly options: ReplayOptions;
      readonly root: Node;
    }
  >();
  for (const path of await featuresOf(files)) {
    const feature = await readFeature(files, path);
    for (const example of feature.examples) {
      const { person, steps } = await featureStory(files, path, newStore, {
        example: example.name,
      });
      const first = steps.findIndex(takesRecords);
      if (first < 0) continue;
      const through = steps.findLastIndex(
        (step, at) => takesRecords(step) || (at > first && overWholePod(step)),
      );
      const title = await titleOf(files, feature.folder);
      const start = JSON.stringify([person, title]);
      let tree = roots.get(start);
      if (tree === undefined) {
        tree = {
          folder: person.folder,
          options: {
            story: { address: person.address, subject: person.subject, steps },
            source: files,
            vocabulary: files,
            folder: person.folder,
            title,
            pod: new MemoryFiles(person.address),
            layout: laidOut,
            newStore,
            runtime: RUNTIME,
            importers: importersNamed(config.importers),
          },
          root: { children: new Map() },
        };
        roots.set(start, tree);
      }
      let node = tree.root;
      for (const step of steps.slice(0, through + 1)) {
        const key = JSON.stringify(step);
        let child = node.children.get(key);
        if (child === undefined) {
          child = { step, children: new Map() };
          node.children.set(key, child);
        }
        node = child;
      }
    }
  }
  const compared: Compared[] = [];
  const whole: { label: string; wrote: Wrote }[] = [];
  const labels = new Set<string>();
  const labelOf = (through: string): string => {
    let label = through;
    for (let again = 2; labels.has(label); again += 1)
      label = `${through} #${again}`;
    labels.add(label);
    return label;
  };
  const walk = async (
    replay: Replay,
    node: Node,
    through: string,
    took: boolean,
  ): Promise<void> => {
    const { step } = node;
    if (step !== undefined) {
      through = `${through} > ${step.name}`;
      if (takesRecords(step))
        compared.push({
          name: step.name,
          label: labelOf(through),
          scoped: await performed(replay, step, false),
          every: await performed(replay, step, true),
        });
      await replay.perform(step);
      if (took && overWholePod(step))
        whole.push({
          label: labelOf(through),
          wrote: await lastWrote(replay, step),
        });
      took ||= takesRecords(step);
    }
    const children = [...node.children.values()];
    for (const [index, child] of children.entries())
      await walk(
        index === children.length - 1 ? replay : await replay.fork(),
        child,
        through,
        took,
      );
  };
  for (const { folder, options, root } of roots.values())
    await walk(new Replay(options), root, folder, false);
  compared.push(...(await noteMasterIdentifierRuns(files, laidOut, config)));
  return { compared, whole };
}

/** A step that runs the matcher on the records a step brought (M1). */
function takesRecords({ happened }: Step): boolean {
  return happened.kind === "matcher" && happened.takes !== undefined;
}

/**
 * The runs no story of the vocabulary has, for R21: two notes of different types sharing a master identifier typed by
 * its system, which R21 joins (and neither note-text rule can, since no two of the four notes share a type); then two of
 * different types sharing a plain-string identifier, which joins nothing. The notes' graphs under
 * `joins-extra/note-master-identifier/bridge/` are edited by hand, no converter's output, and these runs read that folder
 * as their own source.
 */
async function noteMasterIdentifierRuns(
  vocabularyFiles: Awaited<ReturnType<typeof vocabulary>>,
  laidOut: Awaited<ReturnType<typeof layout>>,
  config: Awaited<ReturnType<typeof readConfig>>,
): Promise<Compared[]> {
  const download = (name: string, when: string): Step => ({
    name,
    when,
    happened: {
      kind: "import",
      export: `downloads/${name}`,
      converted: `bridge/${name}`,
    },
  });
  const steps: Step[] = [
    {
      name: "pod",
      when: "2026-11-01T09:00:00Z",
      happened: { kind: "creation" },
    },
    {
      name: "app-notes",
      when: "2026-11-01T09:01:00Z",
      happened: { kind: "open", tables: "tables/app-notes/" },
    },
    {
      name: "about-the-notes",
      when: "2026-11-01T09:05:00Z",
      happened: { kind: "judgment", file: "judgments/about-the-notes.ttl" },
    },
    download("clinic-plan-may.xml", "2026-11-02T09:00:00Z"),
    download("clinic-plan-june.xml", "2026-11-02T09:10:00Z"),
    {
      name: "typed identifier",
      when: "2026-11-02T09:15:00Z",
      happened: { kind: "matcher", takes: "clinic-plan-june.xml" },
    },
    download("clinic-plan-august.xml", "2026-11-02T09:20:00Z"),
    download("clinic-hospital-course.xml", "2026-11-02T09:30:00Z"),
    {
      name: "plain identifier",
      when: "2026-11-02T09:35:00Z",
      happened: { kind: "matcher", takes: "clinic-hospital-course.xml" },
    },
  ];
  const replay = new Replay({
    story: {
      address: ADDRESS,
      subject: "urn:uuid:1392db7d-f82b-4f91-bde1-cbb601a0f79c",
      steps,
    },
    source: new FolderFiles(
      join(ROOT, "packages/runtime/test/joins-extra/note-master-identifier"),
      "https://joins.example/note-master-identifier/",
    ),
    vocabulary: vocabularyFiles,
    folder: "",
    title: "",
    pod: new MemoryFiles(ADDRESS),
    layout: laidOut,
    newStore,
    runtime: RUNTIME,
    importers: importersNamed(config.importers),
  });
  const compared: Compared[] = [];
  for (const step of steps) {
    if (step.happened.kind === "matcher")
      compared.push({
        name: step.name,
        label: `joins-extra/note-master-identifier > ${step.name}`,
        scoped: await performed(replay, step, false),
        every: await performed(replay, step, true),
      });
    await replay.perform(step);
  }
  return compared;
}

/**
 * A matcher run after a step compares only the records that step brought, and reads from the pod only the records
 * their joins reach. It must write what a run reading every record writes, which no example can show, so the runtime
 * tests it here.
 * @rule runtime/matcher.feature M1
 * @rule runtime/matcher.feature M4a
 */
describe("Running the matcher on a step's records alone · CorePod.match(), readEveryRecord(), recordsInOneBlock()", () => {
  describe("given each matcher run that takes records in the stories of the vocabulary's feature files", () => {
    let runs: readonly Compared[];

    before(async () => {
      runs = (await allRuns()).compared;
      assert.ok(runs.length > 0, "no story has a run that takes records");
    });

    it("writes what the same run writes when it reads every record", () => {
      for (const { name, scoped, every } of runs)
        assert.deepEqual(scoped, every, name);
    });

    it("reads and binds its records in VALUES blocks of at most the number it is given, and writes the same", () => {
      assert.ok(
        blocks.split > 0,
        "no run read or bound more records than a block holds",
      );
      assert.ok(
        blocks.records <= BLOCK * blocks.blocks,
        `${blocks.records} records in ${blocks.blocks} blocks`,
      );
    });
  });

  describe("given a first import and a comparison that returns a reference series as its `?record`", () => {
    it("is evaluated unbound when the records its rule applies to fill more than a block, and keeps no row whose `?record` the run did not begin", async () => {
      recordsInOneBlock(1);
      try {
        const { seen, refused } = await seriesAsRecordRun();
        assert.equal(refused, undefined);
        assert.equal(seen.counts.get("matcher.queriesRun"), 1);
        assert.equal(seen.counts.get("matcher.boundRecords"), undefined);
        assert.equal(
          seen.counts.get(`matcher.rule:${CASCADE}SameCode.rows`),
          0,
        );
      } finally {
        recordsInOneBlock();
      }
    });

    it("is bound to the records the run began that its rule applies to, when they fit one block", async () => {
      const { seen, refused } = await seriesAsRecordRun();
      assert.equal(refused, undefined);
      const bound = seen.counts.get("matcher.boundRecords") ?? 0;
      const taken = seen.counts.get("matcher.takenRecords") ?? 0;
      assert.ok(
        bound > 0 && bound < taken,
        `${bound} of ${taken} records bound`,
      );
      assert.equal(seen.counts.get(`matcher.rule:${CASCADE}SameCode.rows`), 0);
    });
  });
});

const SERIES_AS_RECORD = `PREFIX cascade: <${CASCADE}>
PREFIX prov: <${PROV}>
SELECT DISTINCT ?record ?other ?origin WHERE {
  ?origin prov:specializationOf ?record .
  ?record a cascade:ReferenceSeries .
  ?other a cascade:Subject .
}`;

/**
 * Dev's first entry, in the stories of the matcher's feature, matched by a rule list of one rule whose comparison
 * returns a reference series as `?record`, with a version of its table as `?origin`: a thing the run's count of
 * records leaves out and `over()` adds to the matcher's view, so no row of it is a record the run began. The rule
 * list and its table are written here and the comparison is served beside the vocabulary's own; the run is probed.
 */
async function seriesAsRecordRun(): Promise<{
  seen: Awaited<ReturnType<typeof probing>>["seen"];
  refused: string | undefined;
}> {
  const text = (content: string): Uint8Array =>
    new TextEncoder().encode(content);
  const [files, laidOut, config] = await Promise.all([
    vocabulary(),
    layout(),
    readConfig(ROOT),
  ]);
  const query = text(SERIES_AS_RECORD);
  const rules = "urn:uuid:7d3f0c52-1b8e-4a46-9c0d-2e5a8b6f4d11";
  const rulesVersion = "urn:uuid:3a9e5b17-6c24-4d80-8f13-b0c7d2e9a456";
  const ingredients = "urn:uuid:5c1e8a47-9d02-4f63-b7a8-1e4d6c0f2b93";
  const ingredientsVersion = "urn:uuid:0e6b4d28-3f91-4a7c-8c5d-9b2a7e1f6d40";
  const tables = new MemoryFiles("https://tables.example/");
  await tables.write(
    "references.ttl",
    text(`@prefix cascade: <${CASCADE}> .
@prefix pav: <http://purl.org/pav/> .
@prefix prov: <${PROV}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<${rules}> a cascade:ReferenceSeries ; rdfs:label "Matcher rules" ; cascade:defaultTableVersion <${rulesVersion}> .
<${rulesVersion}> a prov:Entity ; prov:specializationOf <${rules}> ; pav:version "1" .
<${ingredients}> a cascade:ReferenceSeries ; rdfs:label "Ingredients" ; cascade:tableKind cascade:SubstanceIngredients ; cascade:defaultTableVersion <${ingredientsVersion}> .
<${ingredientsVersion}> a prov:Entity ; prov:specializationOf <${ingredients}> ; pav:version "1" .
`),
  );
  await tables.write(
    `${rulesVersion.slice("urn:uuid:".length)}.ttl`,
    text(`@prefix cascade: <${CASCADE}> .
[] a cascade:RuleListRow ;
  cascade:matcherRule cascade:SameCodeRule ;
  cascade:justifiedAs cascade:SameCode ;
  cascade:appliesToClass cascade:AllergyOrIntolerance ;
  cascade:tableKind cascade:SubstanceIngredients ;
  cascade:queryPath "matcher/series-as-record.rq" ;
  cascade:queryHash <${await documentName(query)}> .
`),
  );
  await tables.write(
    `${ingredientsVersion.slice("urn:uuid:".length)}.ttl`,
    text(
      "<urn:example:ingredient> <http://www.w3.org/2000/01/rdf-schema#label> 'x' .",
    ),
  );
  const { person, steps } = await featureStory(
    files,
    "runtime/matcher.feature",
    newStore,
    {
      example:
        "two allergies with one code are the same by code, and one with another code joins neither",
    },
  );
  const [entry, run] = steps.slice(1, 3) as [Step, Step];
  assert.equal(entry.happened.kind, "entry");
  assert.deepEqual(run.happened, { kind: "matcher", takes: entry.name });
  const replay = new Replay({
    story: { address: person.address, subject: person.subject, steps },
    source: files,
    vocabulary: {
      iri: files.iri,
      read: async (path) =>
        relative(files, path) === "queries/matcher/series-as-record.rq"
          ? query
          : files.read(path),
      write: (path, bytes) => files.write(path, bytes),
      list: (folder) => files.list(folder),
    },
    folder: person.folder,
    title: "",
    pod: new MemoryFiles(person.address),
    layout: laidOut,
    newStore,
    runtime: RUNTIME,
    importers: importersNamed(config.importers),
    references: () => References.of(tables, "", newStore),
  });
  await replay.perform(steps[0] as Step);
  await replay.perform(entry);
  const { seen } = await probing(() => replay.perform(run));
  const replayed = replay.replayed();
  return {
    seen,
    refused:
      replayed.stopped?.why ??
      replayed.steps.find((one) => one.refused !== undefined)?.refused,
  };
}

/**
 * What the matcher filed in `files`, one line each: a Same as its rule's name and its members, and a finding for
 * review as `finding`, the name of its body and its targets.
 */
async function filedIn(
  files: readonly (readonly [path: string, content: string | Uint8Array])[],
): Promise<string[]> {
  const found: string[] = [];
  for (const [, content] of files) {
    const graph = new Graph(await newStore().parse(content, ADDRESS));
    for (const judgment of graph.subjects(
      `${PROV}wasAttributedTo`,
      iri(MATCHER),
    )) {
      const [rule] = graph.objects(judgment, `${CASCADE}justification`);
      found.push(
        `${rule?.value.slice(CASCADE.length)} ${graph
          .objects(judgment, `${PROV}hadMember`)
          .map(({ value }) => value)
          .sort(byCodePoint)
          .join(" ")}`,
      );
    }
    for (const finding of graph.subjects(
      TYPE,
      iri(`${CASCADE}FindingForReview`),
    )) {
      const [body] = graph.objects(finding, `${OA}hasBody`);
      found.push(
        `finding ${body?.value.slice(CASCADE.length)} ${graph
          .objects(finding, `${OA}hasTarget`)
          .map(({ value }) => value)
          .sort(byCodePoint)
          .join(" ")}`,
      );
    }
  }
  return found.sort(byCodePoint);
}

/** Today's joins: for each run in each story and each kit's whole story, what the matcher files, one line each. */
async function joinsNow(): Promise<string[]> {
  const lines: string[] = [];
  const { compared, whole } = await allRuns();
  for (const { label, wrote } of [
    ...compared.map(({ label, scoped }) => ({ label, wrote: scoped })),
    ...whole,
  ])
    for (const filed of await filedIn(wrote.files))
      lines.push(`${label} | ${filed}`);
  const local = await localVocabulary(ROOT);
  const folders = [`${CASCADE}Judgment`, `${CASCADE}FindingForReview`].map(
    (type) => local.layout.place(type).folder ?? "",
  );
  for (const kit of (await featuresOf(local.files)).filter((path) =>
    path.startsWith("conformance/"),
  )) {
    const { pod } = await featurePod(local, kit, new MemoryFiles(ADDRESS));
    const files: [string, Uint8Array][] = [];
    for (const folder of folders)
      for (const path of await pod.list(folder))
        files.push([path, (await pod.read(path)) ?? new Uint8Array()]);
    for (const filed of await filedIn(files)) lines.push(`${kit} | ${filed}`);
  }
  return lines.sort(byCodePoint);
}

/**
 * Narrowing the pairs a rule compares must leave its joins as they are. `joins.golden.txt` holds today's: for each run
 * that takes records in each story of the feature files, each run over the whole pod after one, and for each kit's
 * whole story, the Sames filed, as the rule's
 * name and the members it joined, and the findings for review, as their body and their targets; and the runs of
 * `joins-extra/`, which cover what no story does. To write it again after a change to the vocabulary's names or rules,
 * run this file with `UPDATE_JOINS_GOLDEN=1`: it writes the file and fails, so a run that writes is never green.
 * @rule runtime/matcher.feature M1
 * @rule runtime/matcher.feature M4a
 */
describe("Holding the matcher's joins to those of today · CorePod.match()", () => {
  describe("given each run that takes records in the stories of the feature files, and each kit's whole story", () => {
    it("files the Sames and the findings of `joins.golden.txt`, each as it is, no line missing, extra or twice", async () => {
      const now = await joinsNow();
      assert.ok(now.length > 0, "no run filed a Same");
      if (process.env["UPDATE_JOINS_GOLDEN"] === "1") {
        await writeFile(GOLDEN, `${now.join("\n")}\n`);
        assert.fail(
          "wrote joins.golden.txt: read its diff, then run again without UPDATE_JOINS_GOLDEN",
        );
      }
      const golden = (await readFile(GOLDEN, "utf8"))
        .split("\n")
        .filter((line) => line !== "")
        .sort(byCodePoint);
      assert.deepEqual(now, golden);
    });
  });
});
