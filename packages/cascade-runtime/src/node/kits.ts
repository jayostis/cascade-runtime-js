import { readdir } from "node:fs/promises";
import { join, resolve as absolute } from "node:path";
import { featureStory, kitsOf, OxigraphStore } from "@cascade-runtime/runtime";
import { featurePod, FolderFiles } from "@cascade-runtime/runtime/node";
import { resolved } from "./resolved.js";

const KITS = "conformance/";

export interface KitStep {
  /** The story's name for it, as `E2`. */
  readonly step: string;
  /** creation, import, entry, judgment, reference or matcher. */
  readonly kind: string;
  readonly wrote: readonly string[];
  readonly refused?: string;
}

async function holdsAnything(folder: string): Promise<boolean> {
  try {
    return (await readdir(folder)).length > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function folders(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(({ name }) => name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function kitVocabulary(kit: string) {
  const { local } = await resolved();
  const kits = (await kitsOf(local.files)).map((path) =>
    path.slice(KITS.length),
  );
  if (!kits.includes(kit))
    throw new Error(`there is no kit ${kit}; there are ${kits.join(", ")}`);
  return local;
}

/** The folder of a kit's download, as `x-e12`, which holds what a person's phone exported. */
export async function kitDownload(
  kit: string,
  download: string,
): Promise<string> {
  const input = join(
    (await kitVocabulary(kit)).files.folder,
    `${KITS}${kit}`,
    "scripted-input",
  );
  const downloads = [];
  for (const person of await folders(input))
    for (const name of await folders(join(input, person, "downloads")))
      downloads.push({ name, folder: join(input, person, "downloads", name) });
  const found = downloads.filter(({ name }) => name === download);
  if (found.length !== 1)
    throw new Error(
      found.length === 0
        ? `the kit ${kit} has no download ${download}; it has ${[...new Set(downloads.map(({ name }) => name))].join(", ")}`
        : `the kit ${kit} has several downloads ${download}, one a person`,
    );
  return found[0]!.folder;
}

/**
 * A kit's story replayed into a missing or empty folder with the kit's saved Bridge output and own tables, through the
 * step named or to the end: the pod keeps the story's address and subject.
 */
export async function replayKit(
  kit: string,
  folder: string,
  options: { through?: string } = {},
): Promise<readonly KitStep[]> {
  const local = await kitVocabulary(kit);
  const target = absolute(folder);
  if (await holdsAnything(target))
    throw new Error(`${target} holds files already`);
  const path = `${KITS}${kit}/${kit}.feature`;
  const through =
    options.through === undefined ? {} : { through: options.through };
  const { person } = await featureStory(
    local.files,
    path,
    () => new OxigraphStore(),
    through,
  );
  const { steps } = await featurePod(
    local,
    path,
    new FolderFiles(target, person.address),
    through,
  );
  return steps.map(({ step, wrote, refused }) => ({
    step: step.name,
    kind: step.happened.kind,
    wrote,
    ...(refused === undefined ? {} : { refused }),
  }));
}
