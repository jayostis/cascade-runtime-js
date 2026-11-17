import "./offline.js";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openPod } from "cascade-runtime";
import { importClaimingEveryProfile } from "./claiming.js";
import { syntheticPull } from "./import-bench.js";

/**
 * What a pull whose bytes change and whose state does not writes to a pod (A10, ruling 5.5 of
 * jayostis/cascade-vocabulary#415): a synthetic pull of the D0 bench's shape is imported, imported again with its
 * Bundle restamped in its `meta`, and imported once more; the files and bytes each import added to the pod's folder are
 * printed. The restamped import writes 3 files, the Bundle's bytes among them, and the same bytes again write none.
 *
 * Run it as `npm run bench:restamp -- 20 200 1000`.
 */

interface Counted {
  readonly files: number;
  readonly bytes: number;
}

async function counted(folder: string): Promise<Counted> {
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    files += 1;
    bytes += (await stat(join(entry.parentPath, entry.name))).size;
  }
  return { files, bytes };
}

function restamped(
  pull: ReadonlyMap<string, Uint8Array>,
): ReadonlyMap<string, Uint8Array> {
  const bundle = JSON.parse(
    new TextDecoder().decode(pull.get("pull/bundle.json")),
  ) as object;
  return new Map(pull).set(
    "pull/bundle.json",
    new TextEncoder().encode(
      JSON.stringify({
        ...bundle,
        meta: { lastUpdated: "2026-11-02T09:00:00Z" },
      }),
    ),
  );
}

export interface Restamped {
  readonly resources: number;
  readonly first: Counted;
  readonly restamped: Counted;
  readonly again: Counted;
}

/** What each of the three imports added to the pod's folder, for a pull of `resources`. */
export async function restampBench(resources: number): Promise<Restamped> {
  const folder = await mkdtemp(join(tmpdir(), "restamp-bench-"));
  const pod = await openPod(folder);
  try {
    const pull = syntheticPull(resources, { repeats: false });
    const steps: Counted[] = [];
    let held: Counted = { files: 0, bytes: 0 };
    for (const next of [pull, restamped(pull), restamped(pull)]) {
      await importClaimingEveryProfile(pod, next);
      const now = await counted(folder);
      steps.push({
        files: now.files - held.files,
        bytes: now.bytes - held.bytes,
      });
      held = now;
    }
    const [first, again, same] = steps;
    if (first === undefined || again === undefined || same === undefined)
      throw new Error("three imports were run");
    return { resources, first, restamped: again, again: same };
  } finally {
    await pod.close();
    await rm(folder, { recursive: true, force: true });
  }
}

async function main(args: string[]): Promise<void> {
  const sizes = args.filter((arg) => /^\d+$/.test(arg)).map(Number);
  if (sizes.length === 0) {
    process.stderr.write("usage: restamp-bench.js <resources>...\n");
    process.exitCode = 2;
    return;
  }
  process.stdout.write(
    "resources | first import | restamped import | the same bytes again\n",
  );
  for (const size of sizes) {
    const run = await restampBench(size);
    const cell = ({ files, bytes }: Counted): string =>
      `${files} files, ${bytes} bytes`;
    process.stdout.write(
      `${size} | ${cell(run.first)} | ${cell(run.restamped)} | ${cell(run.again)}\n`,
    );
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main(process.argv.slice(2));
