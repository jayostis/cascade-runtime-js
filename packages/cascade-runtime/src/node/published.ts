import { MemoryFiles, podStated, questions } from "@cascade-runtime/runtime";
import type { Components } from "@cascade-runtime/runtime/node";
import { ANSWERS, DESCRIBED } from "../answers.js";
import { openPodWith } from "../pod.js";
import { partsOf } from "./resolved.js";

export { entryVersion } from "../answers.js";

async function inMemory(
  iri: string,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<MemoryFiles> {
  const memory = new MemoryFiles(iri);
  for (const [path, bytes] of files) await memory.write(path, bytes);
  return memory;
}

/**
 * The answers a browser keeps for a published pod, `name`, whose files are given, so that a copy of it reads without
 * the engine: `answers.json`, every question under the components' lens, and `pod.json`, computed over the components
 * under `runtime`, the version of the browser entry that copies it.
 */
export async function publishedAnswers(
  components: Components,
  name: string,
  pod: ReadonlyMap<string, Uint8Array>,
  runtime: string,
): Promise<Map<string, Uint8Array>> {
  const parts = await partsOf(components);
  const { address } = await podStated(
    await inMemory("urn:cascade:published/", pod),
    parts.layout,
    parts.newStore(),
  );
  const files = await inMemory(address, pod);
  const kept = new MemoryFiles("urn:cascade:answers/");
  const opened = await openPodWith(
    {
      ...parts,
      folder: () => ({ files, name }),
      answers: { runtime, at: () => kept },
    },
    name,
  );
  try {
    for (const question of (await questions(parts.vocabulary)).keys())
      await opened.ask(question);
  } finally {
    await opened.close();
  }
  const answers = new Map<string, Uint8Array>();
  for (const path of [ANSWERS, DESCRIBED]) {
    const bytes = await kept.read(path);
    if (bytes === undefined) throw new Error(`${name} kept no ${path}`);
    answers.set(path, bytes);
  }
  return answers;
}
