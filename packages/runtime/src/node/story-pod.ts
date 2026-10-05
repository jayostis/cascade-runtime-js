import { folderOf, type Files, readText } from "../files.js";
import { OxigraphStore } from "../oxigraph-store.js";
import { type Replayed, replay } from "../replay.js";
import { parseStory } from "../story.js";
import { vocabularyDerive } from "../build.js";
import { importersNamed } from "./importers.js";
import type { LocalVocabulary } from "./runtime.js";

/**
 * A story of the vocabulary replayed into the pod through the step, the whole story when none is named, with the
 * files the build writes rebuilt under the runtime's lens after every step.
 */
export async function storyPod(
  vocabulary: LocalVocabulary,
  storyPath: string,
  pod: Files,
  through?: string,
): Promise<Replayed> {
  const story = parseStory(await readText(vocabulary.files, storyPath));
  const end =
    through === undefined
      ? story.steps.length
      : story.steps.findIndex(({ name }) => name === through) + 1;
  if (end === 0) throw new Error(`${storyPath} has no step ${through}`);
  const replayed = await replay({
    story: { ...story, steps: story.steps.slice(0, end) },
    source: vocabulary.files,
    vocabulary: vocabulary.files,
    folder: folderOf(storyPath),
    pod,
    layout: vocabulary.layout,
    newStore: () => new OxigraphStore(),
    importers: importersNamed(vocabulary.config.importers),
    build: {
      lens: vocabulary.config.lens,
      derive: await vocabularyDerive(vocabulary.files, vocabulary.layout),
    },
  });
  if (replayed.stopped !== undefined)
    throw new Error(
      `the replay of ${storyPath} stopped at step ${replayed.stopped.step.name}: ${replayed.stopped.why}`,
    );
  return replayed;
}
