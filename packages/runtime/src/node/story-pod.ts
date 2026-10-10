import { featureStory } from "../conformance.js";
import type { Files } from "../files.js";
import { OxigraphStore } from "../oxigraph-store.js";
import { type Replayed, replay, titleOf } from "../replay.js";
import { vocabularyDerive } from "../build.js";
import { importersNamed } from "../importers.js";
import type { References } from "../references.js";
import type { LocalVocabulary } from "./runtime.js";

/**
 * The steps of a feature file of the vocabulary replayed into the pod through the step named, all of them when none
 * is: its background's, a kit's story, or those of the example named. The files the build writes are rebuilt under
 * the runtime's lens after every step. Given `tables`, the pod is given those instead of the story's own, and the
 * story's `reference` and `open` steps, which name the story's own versions, are left out.
 */
export async function featurePod(
  vocabulary: LocalVocabulary,
  path: string,
  pod: Files,
  options: {
    readonly example?: string;
    readonly through?: string;
    readonly tables?: () => Promise<References>;
  } = {},
): Promise<Replayed> {
  const newStore = () => new OxigraphStore();
  const { tables, ...which } = options;
  const { feature, person, steps } = await featureStory(
    vocabulary.files,
    path,
    newStore,
    which,
  );
  const replayed = await replay({
    story: {
      address: person.address,
      subject: person.subject,
      steps:
        tables === undefined
          ? steps
          : steps.filter(
              ({ happened }) =>
                happened.kind !== "reference" && happened.kind !== "open",
            ),
    },
    source: vocabulary.files,
    vocabulary: vocabulary.files,
    folder: person.folder,
    title: await titleOf(vocabulary.files, feature.folder),
    pod,
    layout: vocabulary.layout,
    newStore,
    importers: importersNamed(vocabulary.config.importers),
    ...(tables === undefined ? {} : { references: tables }),
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
