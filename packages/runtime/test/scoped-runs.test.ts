import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { featureStory } from "../src/conformance.js";
import { featuresOf, readFeature } from "../src/features.js";
import { MemoryFiles } from "../src/files.js";
import { Graph } from "../src/graph.js";
import { importersNamed } from "../src/importers.js";
import { MATCHER, readEveryRecord } from "../src/matcher.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { localVocabulary, readConfig } from "../src/node/runtime.js";
import { featurePod } from "../src/node/story-pod.js";
import { iri } from "../src/rdf.js";
import { Replay, type ReplayOptions, titleOf } from "../src/replay.js";
import type { Step } from "../src/story.js";
import { layout, ROOT, RUNTIME, vocabulary } from "./vocabulary.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const ADDRESS = "https://pod.example/";
const GOLDEN = join(ROOT, "packages/runtime/test/joins.golden.txt");
const newStore = () => new OxigraphStore();
const byCodePoint = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

let everyRun: Promise<Compared[]> | undefined;
/** The runs of the stories, found once for the file's tests. */
const allRuns = (): Promise<Compared[]> => (everyRun ??= storyRuns());

/** What one run wrote, by path, but the run's act file, which its random name (N7) makes differ; and any refusal. */
interface Wrote {
  readonly files: [string, string][];
  readonly acts: number;
  readonly refused?: string;
}

/** What the step wrote, by path, reading only what a run needs or every record. */
async function performed(
  replay: Replay,
  step: Step,
  every: boolean,
): Promise<Wrote> {
  const laidOut = await layout();
  const fork = await replay.fork();
  readEveryRecord(every);
  try {
    await fork.perform(step);
  } finally {
    readEveryRecord(false);
  }
  const replayed = fork.replayed();
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

/**
 * Every run that takes records in the stories of the feature files, each performed twice on a fork of the replay as it
 * stood: reading what its joins reach, and reading every record.
 */
async function storyRuns(): Promise<Compared[]> {
  const files = await vocabulary();
  const laidOut = await layout();
  const config = await readConfig(ROOT);
  /** Each story's steps through its last run that takes records, as a tree: stories that begin alike share a replay. */
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
      const through = steps.findLastIndex(
        ({ happened }) =>
          happened.kind === "matcher" && happened.takes !== undefined,
      );
      if (through < 0) continue;
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
  const labels = new Set<string>();
  const walk = async (
    replay: Replay,
    node: Node,
    through: string,
  ): Promise<void> => {
    const { step } = node;
    if (step !== undefined) {
      through = `${through} > ${step.name}`;
      if (
        step.happened.kind === "matcher" &&
        step.happened.takes !== undefined
      ) {
        let label = through;
        for (let again = 2; labels.has(label); again += 1)
          label = `${through} #${again}`;
        labels.add(label);
        compared.push({
          name: step.name,
          label,
          scoped: await performed(replay, step, false),
          every: await performed(replay, step, true),
        });
      }
      await replay.perform(step);
    }
    const children = [...node.children.values()];
    for (const [index, child] of children.entries())
      await walk(
        index === children.length - 1 ? replay : await replay.fork(),
        child,
        through,
      );
  };
  for (const { folder, options, root } of roots.values())
    await walk(new Replay(options), root, folder);
  return compared;
}

/**
 * A matcher run after a step compares only the records that step brought, and reads from the pod only the records
 * their joins reach. It must write what a run reading every record writes, which no example can show, so the runtime
 * tests it here.
 * @rule runtime/matcher.feature M1
 * @rule runtime/matcher.feature M4a
 */
describe("Running the matcher on a step's records alone · CorePod.match(), readEveryRecord()", () => {
  describe("given each matcher run that takes records in the stories of the vocabulary's feature files", () => {
    let runs: Compared[];

    before(async () => {
      runs = await allRuns();
      assert.ok(runs.length > 0, "no story has a run that takes records");
    });

    it("writes what the same run writes when it reads every record", () => {
      for (const { name, scoped, every } of runs)
        assert.deepEqual(scoped, every, name);
    });
  });
});

/** The Sames the matcher filed in `files`, each as its rule's name and its members. */
async function samesIn(
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
  }
  return found.sort(byCodePoint);
}

/** Today's joins: for each run in each story and each kit's whole story, the Sames it files, one line each. */
async function joinsNow(): Promise<string[]> {
  const lines: string[] = [];
  for (const { label, scoped } of await allRuns())
    for (const same of await samesIn(
      scoped.files.map(([path, text]) => [path, text]),
    ))
      lines.push(`${label} | ${same}`);
  const local = await localVocabulary(ROOT);
  const judgments = local.layout.place(`${CASCADE}Judgment`).folder ?? "";
  for (const kit of (await featuresOf(local.files)).filter((path) =>
    path.startsWith("conformance/"),
  )) {
    const { pod } = await featurePod(local, kit, new MemoryFiles(ADDRESS));
    const files: [string, Uint8Array][] = [];
    for (const path of await pod.list(judgments))
      files.push([path, (await pod.read(path)) ?? new Uint8Array()]);
    for (const same of await samesIn(files)) lines.push(`${kit} | ${same}`);
  }
  return lines.sort(byCodePoint);
}

/**
 * Narrowing the pairs a rule compares must leave its joins as they are. `joins.golden.txt` holds today's: for each run
 * that takes records in each story of the feature files, and for each kit's whole story, the Sames filed, as the rule's
 * name and the members it joined. To write it again after a change to the vocabulary's names or rules, run this file
 * with `UPDATE_JOINS_GOLDEN=1`.
 * @rule runtime/matcher.feature M1
 * @rule runtime/matcher.feature M4a
 */
describe("Holding the matcher's joins to those of today · CorePod.match()", () => {
  describe("given each run that takes records in the stories of the feature files, and each kit's whole story", () => {
    it("files the Sames of `joins.golden.txt`, each by its rule and its members", async () => {
      const now = await joinsNow();
      assert.ok(now.length > 0, "no run filed a Same");
      if (process.env["UPDATE_JOINS_GOLDEN"] === "1") {
        await writeFile(GOLDEN, `${now.join("\n")}\n`);
        return;
      }
      const golden = (await readFile(GOLDEN, "utf8"))
        .split("\n")
        .filter((line) => line !== "");
      assert.deepEqual(
        {
          missing: golden.filter((line) => !now.includes(line)),
          extra: now.filter((line) => !golden.includes(line)),
        },
        { missing: [], extra: [] },
      );
    });
  });
});
