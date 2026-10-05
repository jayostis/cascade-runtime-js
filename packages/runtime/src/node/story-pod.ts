import { storyOf } from "../conformance.js";
import { readFeature } from "../features.js";
import type { Files } from "../files.js";
import { OxigraphStore } from "../oxigraph-store.js";
import { type Replayed, replay, titleOf } from "../replay.js";
import { vocabularyDerive } from "../build.js";
import { importersNamed } from "./importers.js";
import type { LocalVocabulary } from "./runtime.js";

/**
 * The steps of a feature file of the vocabulary replayed into the pod through the step named, all of them when none
 * is: its background's, a kit's story, or those of the example named. The files the build writes are rebuilt under
 * the runtime's lens after every step.
 */
export async function featurePod(
  vocabulary: LocalVocabulary,
  path: string,
  pod: Files,
  options: { readonly example?: string; readonly through?: string } = {},
): Promise<Replayed> {
  const newStore = () => new OxigraphStore();
  const feature = await readFeature(vocabulary.files, path);
  const example =
    options.example === undefined
      ? undefined
      : feature.examples.find(({ name }) => name === options.example);
  if (options.example !== undefined && example === undefined)
    throw new Error(`${path} has no example "${options.example}"`);
  const { person, steps } = await storyOf(
    vocabulary.files,
    feature,
    example?.steps ?? feature.background,
    newStore,
    vocabulary.layout,
  );
  const end =
    options.through === undefined
      ? steps.length
      : steps.findIndex(({ name }) => name === options.through) + 1;
  if (end === 0)
    throw new Error(`${path} has no step ${options.through ?? ""}`);
  const replayed = await replay({
    story: {
      address: person.address,
      subject: person.subject,
      steps: steps.slice(0, end),
    },
    source: vocabulary.files,
    vocabulary: vocabulary.files,
    folder: person.folder,
    title: await titleOf(vocabulary.files, feature.folder),
    pod,
    layout: vocabulary.layout,
    newStore,
    importers: importersNamed(vocabulary.config.importers),
    build: {
      lens: vocabulary.config.lens,
      derive: await vocabularyDerive(vocabulary.files, vocabulary.layout),
    },
  });
  if (replayed.stopped !== undefined)
    throw new Error(
      `the replay of ${path} stopped at step ${replayed.stopped.step.name}: ${replayed.stopped.why}`,
    );
  return replayed;
}
