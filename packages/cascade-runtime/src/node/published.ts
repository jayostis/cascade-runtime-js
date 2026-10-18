import { MemoryFiles, questions } from "@cascade-runtime/runtime";
import { ANSWERS, DESCRIBED, type Described } from "../answers.js";
import { LOOKUPS, recording } from "../lookups.js";
import { openPodWith, type Parts, type Pod } from "../pod.js";
import { shipped, type Tables } from "../tables.js";

const REPORTS = "pod/What each report says of a variant";

export { entryVersion } from "../answers.js";
export { openPodWith, type Pod } from "../pod.js";
export type { Tables } from "../tables.js";
export { partsOf } from "./resolved.js";

/**
 * The answers a browser keeps for a published pod, `name`, whose files are given, so that a copy of it reads without
 * the engine: `answers.json`, every question under the parts' lens, and `pod.json`, computed with the parts under
 * `runtime`, the version of the browser entry that copies it; `pod.json` also says which `tables` it was computed with.
 * Given `look`, what it asks of the tables about the pod, as the page that shows it asks, is kept as `lookups.json`.
 */
export async function publishedAnswers(
  parts: Parts,
  name: string,
  pod: ReadonlyMap<string, Uint8Array>,
  runtime: string,
  look?: (pod: Pod, tables: Tables) => Promise<unknown>,
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
  const answers = new Map<string, Uint8Array>();
  try {
    for (const question of (await questions(parts.vocabulary)).keys()) {
      const rows = await opened.ask(question);
      if (question === REPORTS && rows.length > 0) await opened.agreement();
    }
    if (look !== undefined) {
      const recorder = recording(parts.tables);
      await look(opened, recorder.tables);
      answers.set(
        LOOKUPS,
        new TextEncoder().encode(
          JSON.stringify(await recorder.lookups(runtime)),
        ),
      );
    }
  } finally {
    await opened.close();
  }
  for (const path of [ANSWERS, DESCRIBED]) {
    const bytes = await kept.read(path);
    if (bytes === undefined) throw new Error(`${name} kept no ${path}`);
    answers.set(path, bytes);
  }
  const described = JSON.parse(
    new TextDecoder().decode(answers.get(DESCRIBED)),
  ) as Described;
  const tables = shipped(await parts.tables.references());
  answers.set(
    DESCRIBED,
    new TextEncoder().encode(JSON.stringify({ ...described, tables })),
  );
  return answers;
}
