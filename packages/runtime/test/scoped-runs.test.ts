import assert from "node:assert/strict";
import { test } from "node:test";
import { featureStory } from "../src/conformance.js";
import { featuresOf, readFeature } from "../src/features.js";
import { MemoryFiles } from "../src/files.js";
import { importersNamed } from "../src/importers.js";
import { readEveryRecord } from "../src/matcher.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { Replay, type ReplayOptions, titleOf } from "../src/replay.js";
import { readConfig } from "../src/node/runtime.js";
import type { Step } from "../src/story.js";
import { layout, ROOT, RUNTIME, vocabulary } from "./vocabulary.js";

const newStore = () => new OxigraphStore();

/** What the step wrote, by path, but the run's act file, which its random name (N7) makes differ; and any refusal. */
async function performed(
  replay: Replay,
  step: Step,
  every: boolean,
): Promise<{
  readonly files: [string, string][];
  readonly acts: number;
  readonly refused?: string;
}> {
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

test("a run that takes records writes what it writes reading every record: each such run of the feature files' stories", async () => {
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
    { readonly options: ReplayOptions; readonly root: Node }
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
  let compared = 0;
  const walk = async (replay: Replay, node: Node): Promise<void> => {
    const { step } = node;
    if (step !== undefined) {
      if (
        step.happened.kind === "matcher" &&
        step.happened.takes !== undefined
      ) {
        assert.deepEqual(
          await performed(replay, step, false),
          await performed(replay, step, true),
          step.name,
        );
        compared++;
      }
      await replay.perform(step);
    }
    const children = [...node.children.values()];
    for (const [index, child] of children.entries())
      await walk(
        index === children.length - 1 ? replay : await replay.fork(),
        child,
      );
  };
  for (const { options, root } of roots.values())
    await walk(new Replay(options), root);
  assert.ok(compared > 0);
});
