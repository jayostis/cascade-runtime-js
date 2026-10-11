import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const packages = readdirSync("packages", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const compiled = [];
for (const name of packages) {
  let entries;
  try {
    entries = readdirSync(join("packages", name, "test"), { recursive: true });
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".test.ts")) continue;
    compiled.push(
      join("packages", name, "dist", "test", entry.slice(0, -3) + ".js"),
    );
  }
}

const run = spawnSync(
  process.execPath,
  ["--test", ...process.argv.slice(2), ...compiled],
  { stdio: "inherit" },
);
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
