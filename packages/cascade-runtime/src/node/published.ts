import { MemoryFiles, questions } from "@cascade-runtime/runtime";
import { ANSWERS, DESCRIBED } from "../answers.js";
import { openPodWith, type Parts } from "../pod.js";

export { entryVersion } from "../answers.js";
export { partsOf } from "./resolved.js";

/**
 * The answers a browser keeps for a published pod, `name`, whose files are given, so that a copy of it reads without
 * the engine: `answers.json`, every question under the parts' lens, and `pod.json`, computed with the parts under
 * `runtime`, the version of the browser entry that copies it.
 */
export async function publishedAnswers(
  parts: Parts,
  name: string,
  pod: ReadonlyMap<string, Uint8Array>,
  runtime: string,
): Promise<Map<string, Uint8Array>> {
  const files = new MemoryFiles("urn:cascade:published/");
  for (const [path, bytes] of pod) await files.write(path, bytes);
  const kept = new MemoryFiles("urn:cascade:answers/");
  const opened = await openPodWith(
    {
      ...parts,
      folder: (_path, iri) => ({
        files: iri === undefined ? files : files.at(iri),
        name,
      }),
      answers: { runtime, at: () => kept },
    },
    name,
    { adopt: false },
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
