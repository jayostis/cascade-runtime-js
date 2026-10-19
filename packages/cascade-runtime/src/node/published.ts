import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryFiles, questions } from "@cascade-runtime/runtime";
import {
  FolderFiles,
  PACKED,
  type Packed,
  packed,
} from "@cascade-runtime/runtime/node";
import {
  ANSWERS,
  DESCRIBED,
  type Described,
  entryVersion,
} from "../answers.js";
import { LOOKUPS, recording } from "../lookups.js";
import { openPodWith, type Parts, type Pod } from "../pod.js";
import { shipped, type Tables } from "../tables.js";
import { type SampleOptions, type Samples, samplesOf } from "./samples.js";

const REPORTS = "pod/What each report says of a variant";
const PACKAGE = fileURLToPath(new URL("../../../", import.meta.url));

export { entryVersion } from "../answers.js";
export { openPodWith, type Pod } from "../pod.js";
export type { Tables } from "../tables.js";
export { partsOf } from "./resolved.js";
export type { SampleOptions, Samples } from "./samples.js";

/**
 * The kits' published samples, made from what the installed package carries: its components, its starter copies of
 * the feeds' series, and its browser entry, whose version every answer is kept under. Each sample's files are keyed as
 * a page beside the samples' root reads them: `<kit>/pod/…` with `<kit>/pod/files.json`, `<kit>/pod.pack.json`,
 * `<kit>/answers.json`, `<kit>/pod.json` and, given `look`, `<kit>/lookups.json`. A kit the package does not carry is
 * refused.
 */
export async function publishedSamples(
  options: SampleOptions = {},
): Promise<Samples> {
  const components = join(PACKAGE, "components");
  let record: Packed;
  try {
    record = JSON.parse(
      await readFile(join(components, PACKED), "utf8"),
    ) as Packed;
  } catch (error) {
    throw new Error(
      `${PACKAGE} is not a packed package: it carries no components/${PACKED}`,
      { cause: error },
    );
  }
  return samplesOf(
    {
      components: await packed(components),
      starter: new FolderFiles(join(components, "tables")),
      runtime: await entryVersion(
        await readFile(join(PACKAGE, "dist", "browser", "index.js")),
        record.components,
      ),
    },
    options,
  );
}

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
