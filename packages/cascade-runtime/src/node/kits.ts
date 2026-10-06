import { readdir } from "node:fs/promises";
import { resolve as absolute } from "node:path";
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

/**
 * A kit's story replayed into a missing or empty folder with the kit's saved Bridge output and own tables, through the
 * step named or to the end: the pod keeps the story's address and subject.
 */
export async function replayKit(
  kit: string,
  folder: string,
  options: { through?: string } = {},
): Promise<readonly KitStep[]> {
  const { local } = await resolved();
  const kits = (await kitsOf(local.files)).map((path) =>
    path.slice(KITS.length),
  );
  if (!kits.includes(kit))
    throw new Error(`there is no kit ${kit}; there are ${kits.join(", ")}`);
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
