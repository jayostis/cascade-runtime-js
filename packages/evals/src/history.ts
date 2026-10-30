// `record-history`: a finished run copied into history/, the committed record: its results.json and the models' final
// answers and the judges' verdicts. Transcripts, prompts and the generated site stay in the run's own folder.
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HISTORY } from "./paths.js";
import { type Results, runFolder } from "./results.js";
import { valid } from "./schemas.js";

/** What a run was not tested at a commit of: the harness's uncommitted files, a dirty runtime package or component. */
export function uncommittedIn(results: Results): string[] {
  const { harness, podPackages, components } = results.versions;
  return [
    ...(harness.uncommitted > 0
      ? [
          `cascade-runtime-js at ${harness.commit.slice(0, 12)} with ${harness.uncommitted} uncommitted files`,
        ]
      : []),
    ...Object.entries(podPackages)
      .filter(([, tree]) => tree.endsWith("+dirty"))
      .map(([path]) => `${path} with uncommitted changes`),
    ...components
      .filter((it) => (it.uncommitted ?? 0) > 0)
      .map((it) => `${it.name} with ${it.uncommitted} uncommitted files`),
  ];
}

/** Copies a finished run into history/; a run planned from an uncommitted tree is refused, since no commit can reproduce it. */
export async function recordHistory(given: string) {
  const folder = runFolder(given);
  const results = valid<Results>(
    "results",
    JSON.parse(await readFile(join(folder, "results.json"), "utf8")),
    join(folder, "results.json"),
  );
  const dirty = uncommittedIn(results);
  if (dirty.length > 0)
    throw new Error(
      `${results.run.id} was planned from uncommitted work, so no commit reproduces it and it is not recorded: ${dirty.join("; ")}. Commit, plan the run again (unchanged jobs are reused) and record that.`,
    );
  const target = join(
    HISTORY,
    `${results.run.finished.slice(0, 10)}-${results.versions.harness.commit.slice(0, 7)}-${results.run.tier}`,
  );
  if (existsSync(target)) throw new Error(`${target} is already recorded`);
  await mkdir(target, { recursive: true });
  await writeFile(
    join(target, "results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  for (const kept of ["answers", "judges"]) {
    if (!existsSync(join(folder, kept))) continue;
    await cp(join(folder, kept), join(target, kept), {
      recursive: true,
      filter: (path) => !path.endsWith(".md") && !path.endsWith(".txt"),
    });
  }
  return { recorded: target };
}
