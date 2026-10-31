import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import process from "node:process";
import { build } from "esbuild";

const KNOWN = new Set([
  "target",
  "lib",
  "module",
  "moduleResolution",
  "strict",
  "noUncheckedIndexedAccess",
  "exactOptionalPropertyTypes",
  "noImplicitOverride",
  "noFallthroughCasesInSwitch",
  "verbatimModuleSyntax",
  "isolatedModules",
  "declaration",
  "sourceMap",
  "composite",
  "skipLibCheck",
  "types",
  "rootDir",
  "outDir",
  "resolveJsonModule",
]);
const EMITTED = [".js", ".js.map", ".d.ts", ".d.ts.map"];

function compilerOptions(path) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  const inherited =
    config.extends === undefined
      ? {}
      : compilerOptions(join(dirname(path), config.extends));
  return { ...inherited, ...config.compilerOptions };
}

function targetOf(pkg, options) {
  const wrong = [
    ...Object.keys(options)
      .filter((key) => !KNOWN.has(key))
      .map((key) => `${key} is an option transpile.mjs does not know`),
    ...(normalize(options.rootDir ?? "") === "." ? [] : ["rootDir is not ."]),
    ...(normalize(options.outDir ?? "") === "dist"
      ? []
      : ["outDir is not dist"]),
    ...(String(options.module).toLowerCase() === "nodenext"
      ? []
      : ["module is not NodeNext"]),
    ...(options.isolatedModules === true &&
    options.verbatimModuleSyntax === true
      ? []
      : ["isolatedModules and verbatimModuleSyntax are not both on"]),
    ...(typeof options.target === "string" ? [] : ["target is unset"]),
  ];
  if (wrong.length > 0) {
    process.stderr.write(`${pkg}: ${wrong.join("; ")}. Run tsc -b instead.\n`);
    process.exit(1);
  }
  return options.target.toLowerCase();
}

function filesUnder(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true }).filter((entry) =>
    statSync(join(folder, entry)).isFile(),
  );
}

const builds = [];
let transpiled = 0;
let deleted = 0;
for (const name of readdirSync("packages").sort()) {
  const pkg = join("packages", name);
  const configPath = join(pkg, "tsconfig.json");
  if (!existsSync(configPath)) continue;
  const target = targetOf(pkg, compilerOptions(configPath));
  const include = JSON.parse(readFileSync(configPath, "utf8")).include ?? [];
  const stale = [];
  let gone = 0;
  for (const folder of include) {
    for (const entry of filesUnder(join(pkg, folder))) {
      if (!entry.endsWith(".ts") || entry.endsWith(".d.ts")) continue;
      const source = join(pkg, folder, entry);
      const output = join(pkg, "dist", folder, entry.replace(/\.ts$/, ".js"));
      const built = existsSync(output) ? statSync(output).mtimeMs : 0;
      if (statSync(source).mtimeMs > built) stale.push(source);
    }
    for (const entry of filesUnder(join(pkg, "dist", folder))) {
      const ending = EMITTED.find((suffix) => entry.endsWith(suffix));
      if (ending === undefined) continue;
      if (existsSync(join(pkg, folder, `${entry.slice(0, -ending.length)}.ts`)))
        continue;
      rmSync(join(pkg, "dist", folder, entry));
      gone += 1;
    }
  }
  const included = new Set(include.map((folder) => normalize(folder)));
  for (const folder of existsSync(join(pkg, "dist"))
    ? readdirSync(join(pkg, "dist"))
    : []) {
    if (
      included.has(folder) ||
      !statSync(join(pkg, "dist", folder)).isDirectory()
    )
      continue;
    for (const entry of filesUnder(join(pkg, "dist", folder))) {
      if (!entry.endsWith(".js.map")) continue;
      const map = join(pkg, "dist", folder, entry);
      const stem = entry.slice(0, -".js.map".length);
      const { sources } = JSON.parse(readFileSync(map, "utf8"));
      if (
        sources?.length !== 1 ||
        resolve(dirname(map), sources[0]) !== resolve(pkg, folder, `${stem}.ts`)
      )
        continue;
      for (const ending of EMITTED)
        rmSync(join(pkg, "dist", folder, `${stem}${ending}`), { force: true });
      gone += 1;
    }
  }
  if (stale.length + gone === 0) continue;
  rmSync(join(pkg, "dist", "tsconfig.tsbuildinfo"), { force: true });
  transpiled += stale.length;
  deleted += gone;
  if (stale.length > 0)
    builds.push(
      build({
        entryPoints: stale,
        outbase: pkg,
        outdir: join(pkg, "dist"),
        format: "esm",
        platform: "node",
        target,
        sourcemap: true,
        sourcesContent: false,
        logLevel: "warning",
      }),
    );
}
await Promise.all(builds);
process.stdout.write(
  `transpiled ${transpiled} changed sources; deleted ${deleted} outputs whose source is gone\n`,
);
