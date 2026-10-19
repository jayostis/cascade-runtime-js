import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

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
    ...process.argv.slice(2),
    ...compiled,
  ],
  { stdio: "inherit" },
);
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
