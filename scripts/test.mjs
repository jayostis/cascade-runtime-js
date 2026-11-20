import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { compiledTests } from "./test-files.mjs";

/**
 * Runs the compiled tests of every package, `node scripts/test.mjs [--listed | --unlisted] [node:test options]`. The
 * options go to `node --test`. `--listed` runs only the files each package's `test/spec.json` lists as `randomOrder`, the
 * ones proven not to need another test to run first, and `--unlisted` the files it does not: together they are the whole
 * suite once, so CI runs the first with `--test-randomize` and the second as written.
 */
const GROUPS = ["--listed", "--unlisted"];
const given = process.argv.slice(2);
const chosen = given.filter((argument) => GROUPS.includes(argument));
if (chosen.length > 1) {
  process.stderr.write(`Name one of ${GROUPS.join(" and ")}, not both.\n`);
  process.exit(2);
}
const compiled = compiledTests(chosen[0]?.slice(2));
const forwarded = given.filter((argument) => !GROUPS.includes(argument));

const missing = compiled.filter((path) => !existsSync(path));
if (missing.length > 0) {
  process.stderr.write(
    `No compiled test for ${missing.length} listed source(s):\n${missing.join("\n")}\n`,
  );
  process.exit(1);
}

const run = spawnSync(
  process.execPath,
  [
    "--import",
    pathToFileURL(
      join("packages", "cascade-runtime", "dist", "test", "offline.js"),
    ).href,
    "--test",
    ...forwarded,
    ...compiled,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CASCADE_TEST_OFFLINE: process.env.CASCADE_TEST_OFFLINE ?? "1",
      // The build the suite runs on: the WebAssembly build, which runs everywhere, unless one is named.
      CASCADE_OXIGRAPH: process.env.CASCADE_OXIGRAPH ?? "wasm",
    },
  },
);
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
