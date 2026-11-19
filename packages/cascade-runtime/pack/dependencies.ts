import { builtinModules } from "node:module";
import { existsSync } from "node:fs";
import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

/** The dependencies the package declares, from its bundled workspaces' and its own; a name pinned two ways throws. */
export function mergedDependencies(
  declarers: readonly {
    readonly name: string;
    readonly dependencies?: Readonly<Record<string, string>>;
  }[],
): Record<string, string> {
  const merged: Record<string, string> = {};
  const by: Record<string, string> = {};
  for (const { name: declarer, dependencies } of declarers)
    for (const [name, version] of Object.entries(dependencies ?? {})) {
      const pinned = merged[name];
      if (pinned !== undefined && pinned !== version)
        throw new Error(
          `${declarer} pins ${name} at ${version}, but ${by[name]} pins it at ${pinned}`,
        );
      merged[name] = version;
      by[name] = declarer;
    }
  return merged;
}

/** The package a bare specifier names: `a/b` is `a`, `@s/p/b` is `@s/p`. */
function packageOf(specifier: string): string {
  const [first, second] = specifier.split("/");
  return first!.startsWith("@") ? `${first}/${second}` : first!;
}

/** A bare specifier of a static import or export-from at a line's start, or of a dynamic `import("...")` or a `require("...")`. */
const IMPORTED =
  /^(?:import|export)\b[^;"']*?\bfrom\s*["']([^"'./][^"']*)["']|^import\s*["']([^"'./][^"']*)["']|\b(?:import|require)\(\s*["']([^"'./][^"']*)["']\s*\)/gm;

/** The packages the compiled `.js` files under `folder` import by a bare specifier, which Node does not provide. */
export async function importedPackages(folder: string): Promise<string[]> {
  const found = new Set<string>();
  for (const entry of await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const text = await readFile(join(entry.parentPath, entry.name), "utf8");
    for (const match of text.matchAll(IMPORTED)) {
      const name = packageOf(match[1] ?? match[2] ?? match[3]!);
      if (!name.startsWith("node:") && !builtinModules.includes(name))
        found.add(name);
    }
  }
  return [...found].sort();
}

/**
 * What the compiled code of the package staged at `stage` imports that it neither declares nor carries: its own, under
 * `dist/src/`, and that of each workspace it bundles, under `node_modules/<workspace>/dist/src/`.
 */
export async function undeclaredImports(
  stage: string,
  workspaces: readonly string[],
  declared: Readonly<Record<string, string>>,
): Promise<string[]> {
  const found = new Set<string>();
  for (const folder of [
    join(stage, "dist", "src"),
    ...workspaces.map((name) =>
      join(stage, "node_modules", ...name.split("/"), "dist", "src"),
    ),
  ])
    for (const name of await importedPackages(folder)) found.add(name);
  return [...found].filter((name) => !(name in declared)).sort();
}

/** A package carried in the packed one. */
export interface Carried {
  readonly name: string;
  /** The top-level files and folders of it the copy keeps, beside its manifest, when not all of them. */
  readonly files?: readonly string[];
  /** Its dependencies that only build it from source, left out of the copy and of its manifest. */
  readonly buildOnly?: readonly string[];
}

/** The folder of the package `name` as `from` would resolve it: the nearest `node_modules` above it that holds it. */
function installed(name: string, from: string): string {
  for (let at = from; ; at = dirname(at)) {
    const candidate = join(at, "node_modules", ...name.split("/"));
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(at) === at)
      throw new Error(`${name} is not installed above ${from}`);
  }
}

/**
 * Copies each installed package of `packages` and everything it depends on, each resolved from the package that needs it,
 * flat into `modules`. Returns the version each is at; two versions of one name throw.
 */
export async function vendored(
  packages: readonly Carried[],
  from: string,
  modules: string,
): Promise<Record<string, string>> {
  const versions: Record<string, string> = {};
  const queue = packages.map((carried) => ({ carried, from }));
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const { name, files, buildOnly = [] } = next.carried;
    const folder = installed(name, next.from);
    const manifest = JSON.parse(
      await readFile(join(folder, "package.json"), "utf8"),
    ) as { version: string; dependencies?: Record<string, string> };
    const have = versions[name];
    if (have === manifest.version) continue;
    if (have !== undefined)
      throw new Error(
        `${name} would be carried at ${have} and at ${manifest.version}`,
      );
    versions[name] = manifest.version;
    const to = join(modules, ...name.split("/"));
    const kept = files && ["", "package.json", ...files];
    await cp(folder, to, {
      recursive: true,
      filter: (path) =>
        !/(?:^|[\\/])node_modules$/.test(path) &&
        (kept === undefined ||
          kept.includes(relative(folder, path).split(/[\\/]/)[0]!)),
    });
    const dependencies = Object.fromEntries(
      Object.entries(manifest.dependencies ?? {}).filter(
        ([dependency]) => !buildOnly.includes(dependency),
      ),
    );
    if (buildOnly.length > 0)
      await writeFile(
        join(to, "package.json"),
        `${JSON.stringify({ ...manifest, dependencies }, null, 2)}\n`,
      );
    for (const dependency of Object.keys(dependencies))
      queue.push({ carried: { name: dependency }, from: folder });
  }
  return versions;
}
