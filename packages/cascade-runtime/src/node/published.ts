import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryFiles, questions } from "@cascade-runtime/runtime";
import { FolderFiles, PACKED, packed } from "@cascade-runtime/runtime/node";
import { ANSWERS, DESCRIBED, type Described } from "../answers.js";
import { LOOKUPS, recording } from "../lookups.js";
import { openPodWith, type Parts, type Pod } from "../pod.js";
import { shipped, type Tables } from "../tables.js";
import { type SampleOptions, type Samples, samplesOf } from "./samples.js";

const REPORTS = "pod/What each report says of a variant";
const PACKAGE = fileURLToPath(new URL("../../../", import.meta.url));

export { openPodWith, type Pod } from "../pod.js";
export type { Tables } from "../tables.js";
export { partsOf } from "./resolved.js";
export type { SampleOptions, Samples } from "./samples.js";

/**
 * The version of the browser build of the package in `folder`, this installed one by default, as its `package.json`
 * records it when it was packed: the version the build keeps every answer under.
 */
export async function browserBuildVersion(
  folder: string = PACKAGE,
): Promise<string> {
  const manifest = JSON.parse(
    await readFile(join(folder, "package.json"), "utf8"),
  ) as { cascadeRuntime?: { browserBuildVersion?: unknown } };
  const version = manifest.cascadeRuntime?.browserBuildVersion;
  if (typeof version !== "string")
    throw new Error(
      `${folder} is not a packed package: its package.json records no cascadeRuntime.browserBuildVersion`,
    );
  return version;
}

/**
 * The kits' samples to publish, made from what the installed package carries: its components, its starter copies of
 * the feeds' series, and its browser build's version, which every answer is kept under. Each sample's files are keyed
 * as a page beside the samples' root reads them: `<kit>/pod/…` with `<kit>/pod/files.json`, `<kit>/pod.pack.json`,
 * `<kit>/answers.json`, `<kit>/pod.json` and, given `lookups`, `<kit>/lookups.json`. A kit the package does not carry is
 * refused.
 */
export async function samplesToPublish(
  options: SampleOptions = {},
): Promise<Samples> {
  const components = join(PACKAGE, "components");
  try {
    await readFile(join(components, PACKED));
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
      runtime: await browserBuildVersion(),
    },
    options,
  );
}

/**
 * The answers a browser keeps for a published pod, `options.name`, whose files are `podFiles`, so that a copy of it reads
 * without the engine: `answers.json`, every question under the parts' lens, and `pod.json`, computed with the parts under
 * `options.runtime`, the version of the browser build that copies it; `pod.json` also says which `tables` it was computed
 * with. Given `options.lookups`, what it asks of the tables about the pod, as the page that shows it asks, is kept as
 * `lookups.json`.
 */
export async function answersToPublish(
  parts: Parts,
  podFiles: ReadonlyMap<string, Uint8Array>,
  options: {
    readonly name: string;
    readonly runtime: string;
    readonly lookups?: (pod: Pod, tables: Tables) => Promise<unknown>;
  },
): Promise<Map<string, Uint8Array>> {
  const { name, runtime, lookups } = options;
  const files = new MemoryFiles("urn:cascade:published/");
  for (const [path, bytes] of podFiles) await files.write(path, bytes);
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
    if (lookups !== undefined) {
      const recorder = recording(parts.tables);
      await lookups(opened, recorder.tables);
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
