import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FILES_JSON,
  type Files,
  packFolder,
  titleOf,
} from "@cascade-runtime/runtime";
import { type Components, FolderFiles } from "@cascade-runtime/runtime/node";
import type { Pod } from "../pod.js";
import type { Tables } from "../tables.js";
import { kitsIn, replayKitFrom, withKit } from "./kits.js";
import { publishedAnswers } from "./published.js";
import { partsOf } from "./resolved.js";

/** The folder a sample's pod is copied from, beside its pack, its answers and its lookups. */
const POD = "pod";

/** What the published samples are made from: the components, the starter copies of the feeds' series, and the version of the browser entry that copies them. */
export interface SampleSource {
  readonly components: Components;
  readonly starter?: Files;
  readonly runtime: string;
}

export interface SampleOptions {
  /** The kits to publish, by name; by default every kit. */
  readonly kits?: readonly string[];
  /** What the page that shows a pod asks the tables of it, kept as `lookups.json`. */
  readonly look?: (pod: Pod, tables: Tables) => Promise<unknown>;
}

export interface Samples {
  /** Every kit the vocabulary carries, by its name, with its title. */
  readonly kits: ReadonlyMap<string, string>;
  /** The version of the browser entry, which every answer kept is kept under. */
  readonly runtime: string;
  /** Each sample's files, by their paths under the samples' root. */
  readonly files: ReadonlyMap<string, Uint8Array>;
}

/** The steps a story says are refused: those of its examples that read the pod after a step and then say "that step is refused". */
async function refusalsExpected(
  files: Files,
  feature: string,
): Promise<ReadonlySet<string>> {
  const bytes = await files.read(feature);
  if (bytes === undefined) throw new Error(`${feature} does not exist`);
  const expected = new Set<string>();
  for (const example of new TextDecoder()
    .decode(bytes)
    .split(/^\s*Example:/m)) {
    const step = /When the pod is read as it stood after "([^"]+)"/.exec(
      example,
    );
    if (step !== null && /^\s*Then that step is refused\s*$/m.test(example))
      expected.add(step[1]!);
  }
  return expected;
}

/**
 * Each kit's published sample, as a browser copies it. The kit's story is replayed on the starter copies, and a step
 * its story says is refused writes nothing; a step refused that the story does not say so of is a plain error, since
 * the install is then broken, not the sample short; its pod's files are under `<kit>/pod/` with their list, `files.json`, and their pack
 * beside the folder, `<kit>/pod.pack.json`; what a copy reads without the engine is `<kit>/answers.json`,
 * `<kit>/pod.json` and, given `look`, `<kit>/lookups.json`. A kit the vocabulary does not carry is refused.
 */
export async function samplesOf(
  source: SampleSource,
  options: SampleOptions = {},
): Promise<Samples> {
  const parts = await partsOf(
    source.components,
    source.starter === undefined ? {} : { starter: source.starter },
  );
  const { local } = parts;
  const kits = new Map<string, string>();
  const folders = new Map<string, string>();
  for (const { name, folder } of await kitsIn(local)) {
    kits.set(name, await titleOf(local.files, folder));
    folders.set(name, folder);
  }
  const chosen = options.kits ?? [...kits.keys()];
  for (const kit of chosen) await withKit(local, kit);
  const files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  const replays = await mkdtemp(join(tmpdir(), "cascade-samples-"));
  try {
    for (const kit of chosen) {
      const folder = join(replays, kit);
      const steps = await replayKitFrom(local, kit, folder, {
        tables: parts.tables,
      });
      const expected = await refusalsExpected(
        local.files,
        `${folders.get(kit)}/${kit}.feature`,
      );
      for (const { step, refused } of steps)
        if (refused !== undefined && !expected.has(step))
          throw new Error(
            `the kit ${kit} is broken: its step ${step} was refused, which its story does not expect: ${refused}`,
          );
      const replayed = new FolderFiles(folder);
      const paths = await replayed.list("");
      const pod = new Map<string, Uint8Array>();
      for (const path of paths) {
        const bytes = await replayed.read(path);
        if (bytes === undefined) throw new Error(`${folder} lost ${path}`);
        pod.set(path, bytes);
        files.set(`${kit}/${POD}/${path}`, bytes);
      }
      files.set(
        `${kit}/${POD}/${FILES_JSON}`,
        encoder.encode(`${JSON.stringify(paths, null, 2)}\n`),
      );
      files.set(
        `${kit}/${POD}.pack.json`,
        encoder.encode(JSON.stringify(packFolder(paths, pod))),
      );
      for (const [path, bytes] of await publishedAnswers(
        parts,
        kit,
        pod,
        source.runtime,
        options.look,
      ))
        files.set(`${kit}/${path}`, bytes);
    }
  } finally {
    await rm(replays, { recursive: true, force: true });
  }
  return { kits, runtime: source.runtime, files };
}
