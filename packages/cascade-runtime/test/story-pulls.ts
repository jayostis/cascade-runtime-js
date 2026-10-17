import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { loadHospital, loadStories } from "@the-cascade-protocol/sandbox/node";
import { pullFiles } from "cascade-runtime";
import { pulled, rowOf } from "./hospitals.js";

/**
 * Each pull of a story, made through the real sign-in and pull from its hospital as the record stood at the pull's
 * date, as the files `pullFiles` saves it as: by path under a downloads folder, `<pull>/bundle.json` and
 * `<pull>/pull.json`.
 */
export async function storyPulls(
  patient: string,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const story = (await loadStories()).find((one) => one.patient === patient);
  if (!story) throw new Error(`there is no story of the patient ${patient}`);
  if (!story.pulls?.length)
    throw new Error(`the story of ${patient} names no pull`);
  const at = await loadHospital(story.hospital);
  const row = rowOf(at);
  const files = new Map<string, Uint8Array>();
  for (const { name, asOf } of story.pulls) {
    const now = () => new Date(asOf);
    const { pull } = await pulled({ ...at, asOf }, patient, { row, now });
    for (const [path, bytes] of pullFiles({ ...pull, asOf }, name))
      files.set(path, bytes);
  }
  return files;
}

async function main(args: readonly string[]): Promise<void> {
  const [patient, folder] = args;
  if (patient === undefined || folder === undefined || args.length !== 2) {
    process.stderr.write(
      "usage: npm run story:pulls -- <story patient> <downloads folder>\n",
    );
    process.exit(2);
  }
  for (const [path, bytes] of await storyPulls(patient)) {
    const target = join(resolve(folder), path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    process.stdout.write(`${target}\n`);
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main(process.argv.slice(2));
