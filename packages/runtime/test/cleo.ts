import { type Files, MemoryFiles } from "../src/files.js";
import type { Replayed } from "../src/replay.js";
import { featurePod } from "../src/node/story-pod.js";
import { localVocabulary } from "../src/node/runtime.js";
import { ROOT } from "./vocabulary.js";

const ADDRESS = "https://pod.example/";

let replay: Promise<{
  readonly local: Awaited<ReturnType<typeof localVocabulary>>;
  readonly replayed: Replayed;
}>;

/**
 * Cleo's import, entry session and matcher run, three acts in a row (naming.feature, N14), replayed once for the
 * file that asks. The replayed pod is shared: read it, and write only to a `copied()` one.
 */
export function cleosReplay(): typeof replay {
  replay ??= localVocabulary(ROOT).then(async (local) => ({
    local,
    replayed: await featurePod(
      local,
      "runtime/naming.feature",
      new MemoryFiles(ADDRESS),
      {
        example:
          "a writer's first snapshot has no first parent, and each later act's names the one before it",
      },
    ),
  }));
  return replay;
}

/** A copy of the pod, with each file of `changes` written in it, or left out where the change is `undefined`. */
export async function copied(
  pod: Files,
  changes: Record<string, Uint8Array | undefined> = {},
): Promise<MemoryFiles> {
  const copy = new MemoryFiles(pod.iri);
  const paths = new Set([...(await pod.list("")), ...Object.keys(changes)]);
  for (const path of paths) {
    const bytes = path in changes ? changes[path] : await pod.read(path);
    if (bytes !== undefined) await copy.write(path, bytes);
  }
  return copy;
}
