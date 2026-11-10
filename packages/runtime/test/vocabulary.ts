import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { featureStory } from "../src/conformance.js";
import { Layout } from "../src/layout.js";
import type { Story } from "../src/story.js";
import { type Files, MemoryFiles } from "../src/files.js";
import { FolderFiles } from "../src/node/folder-files.js";
import { type Replayed, replay, type ReplayOptions } from "../src/replay.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { readConfig, resolveVocabulary } from "../src/node/runtime.js";
import { runtimeIri } from "../src/config.js";

export const ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

let resolved: Promise<FolderFiles> | undefined;

/** The vocabulary this checkout runs against, resolved once per run as the commands resolve it. */
export function vocabulary(): Promise<FolderFiles> {
  resolved ??= readConfig(ROOT)
    .then((config) => resolveVocabulary(ROOT, config))
    .then((found) => new FolderFiles(found.folder, found.iri));
  return resolved;
}

let read: Promise<Layout> | undefined;

/** The vocabulary's pod layout, read once per run. */
export function layout(): Promise<Layout> {
  read ??= vocabulary().then((files) =>
    Layout.read(files, () => new OxigraphStore()),
  );
  return read;
}

/**
 * The story an example of a feature file tells, or the feature's background when no example is named: whose pod,
 * the folder its steps name their files under, and the steps through the one named, or all of them.
 */
export async function storyFrom(
  feature: string,
  example?: string,
  through?: string,
): Promise<{ readonly story: Story; readonly folder: string }> {
  const { person, steps } = await featureStory(
    await vocabulary(),
    feature,
    () => new OxigraphStore(),
    { example, through },
  );
  return {
    story: { address: person.address, subject: person.subject, steps },
    folder: person.folder,
  };
}

/** The runtime the tests' acts name (N7): this repository at a commit no checkout is at. */
export const RUNTIME = runtimeIri("0".repeat(40));

/**
 * The example of a feature replayed on a new pod, its story's files those `source` gives for the example's folder and
 * otherwise the vocabulary's. `importers`, `build` and `performers` are the replay's.
 */
export async function replayed(
  feature: string,
  example: string,
  options: {
    readonly source?: (files: Files, folder: string) => Promise<Files>;
    readonly importers?: ReplayOptions["importers"];
    readonly build?: ReplayOptions["build"];
    readonly performers?: ReplayOptions["performers"];
  } = {},
): Promise<Replayed & { readonly folder: string }> {
  const files = await vocabulary();
  const { story, folder } = await storyFrom(feature, example);
  const done = await replay({
    runtime: RUNTIME,
    story,
    source:
      options.source === undefined
        ? files
        : await options.source(files, folder),
    vocabulary: files,
    folder,
    title: "",
    pod: new MemoryFiles(story.address),
    newStore: () => new OxigraphStore(),
    layout: await layout(),
    ...(options.importers === undefined
      ? {}
      : { importers: options.importers }),
    ...(options.build === undefined ? {} : { build: options.build }),
    ...(options.performers === undefined
      ? {}
      : { performers: options.performers }),
  });
  return { ...done, folder };
}
