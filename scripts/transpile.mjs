import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { build } from "esbuild";

const outputOf = (pkg, source) =>
  join(pkg, "dist", source.slice(pkg.length + 1).replace(/\.ts$/, ".js"));

const stale = [];
for (const name of readdirSync("packages").sort()) {
  const pkg = join("packages", name);
  let config;
  try {
    config = JSON.parse(readFileSync(join(pkg, "tsconfig.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  for (const folder of config.include ?? []) {
    let entries;
    try {
      entries = readdirSync(join(pkg, folder), { recursive: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".ts") || entry.endsWith(".d.ts")) continue;
      const source = join(pkg, folder, entry);
      let built = 0;
      try {
        built = statSync(outputOf(pkg, source)).mtimeMs;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (statSync(source).mtimeMs > built) stale.push({ pkg, source });
    }
  }
}

const byPackage = Map.groupBy(stale, ({ pkg }) => pkg);
await Promise.all(
  [...byPackage].map(([pkg, sources]) =>
    build({
      entryPoints: sources.map(({ source }) => source),
      outbase: pkg,
      outdir: join(pkg, "dist"),
      format: "esm",
      platform: "node",
      target: "es2023",
      sourcemap: true,
      logLevel: "warning",
    }),
  ),
);
process.stdout.write(`transpiled ${stale.length} changed sources\n`);
