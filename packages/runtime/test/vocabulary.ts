import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { storyOf } from "../src/conformance.js";
import { readFeature } from "../src/features.js";
import { Layout } from "../src/layout.js";
import type { Story } from "../src/story.js";
import { FolderFiles } from "../src/node/folder-files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { readConfig, resolveVocabulary } from "../src/node/runtime.js";

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
  const files = await vocabulary();
  const read = await readFeature(files, feature);
  const stated =
    example === undefined
      ? read.background
      : read.examples.find(({ name }) => name === example)?.steps;
  if (stated === undefined)
    throw new Error(`${feature} has no example ${example ?? ""}`);
  const { person, steps } = await storyOf(
    files,
    read,
    stated,
    () => new OxigraphStore(),
    await layout(),
  );
  const end =
    through === undefined
      ? steps.length
      : steps.findIndex(({ name }) => name === through) + 1;
  return {
    story: {
      address: person.address,
      subject: person.subject,
      steps: steps.slice(0, end),
    },
    folder: person.folder,
  };
}
