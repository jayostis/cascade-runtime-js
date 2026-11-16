import { readFileSync } from "node:fs";
import process from "node:process";
import { breakingOf } from "../packages/cascade-runtime/pack/breaking.ts";

/**
 * Whether a pull request's body has a `## Breaking` section that lists `old -> new` lines or says None: `node
 * scripts/breaking-check.mjs`, reading the body from the pull request event at `GITHUB_EVENT_PATH`. Exits 1 and says what
 * is wrong; 0 when the body is in order. Node runs the TypeScript beside it by stripping its types (Node 22.18 or later).
 */
const path = process.env.GITHUB_EVENT_PATH;
if (path === undefined) {
  process.stderr.write("GITHUB_EVENT_PATH is not set\n");
  process.exit(2);
}
const { problem } = breakingOf(
  JSON.parse(readFileSync(path, "utf8")).pull_request?.body,
);
if (problem !== undefined) {
  process.stderr.write(`${problem}\n`);
  if (process.env.GITHUB_ACTIONS === "true")
    process.stdout.write(`::error::${problem}\n`);
}
process.exitCode = problem === undefined ? 0 : 1;
