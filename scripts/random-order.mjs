import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Runs the tests a package lists as `randomOrder` in its `test/spec.json` in a random order, `--test-randomize`, so a
 * test that needs another to run first fails here. `node scripts/random-order.mjs <package folder> [--seed N]`; the files
 * are named as under `test/`, `pod.test.ts`. A package that lists none runs nothing.
 */
const [folder = "cascade-runtime", ...extra] = process.argv.slice(2);
const listed = JSON.parse(
  readFileSync(join("packages", folder, "test", "spec.json"), "utf8"),
).randomOrder;
const files = Array.isArray(listed) ? listed : [];
if (files.length === 0) {
  process.stdout.write(`${folder}: no test file is listed in randomOrder\n`);
  process.exit(0);
}
const run = spawnSync(
  process.execPath,
  [
    "--import",
    pathToFileURL(
      join("packages", "cascade-runtime", "dist", "test", "offline.js"),
    ).href,
    "--test",
    "--test-randomize",
    ...extra,
    ...files.map((file) =>
      join("packages", folder, "dist", "test", file.replace(/\.ts$/, ".js")),
    ),
  ],
  { stdio: "inherit" },
);
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
