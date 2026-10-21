import { existsSync, readFileSync } from "node:fs";
import { cp, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HtmlTagDescriptor, Plugin } from "vite";

/** Where the runtime's files go under the base, as `configureRuntime({ base })` names them. */
export const RUNTIME_FOLDER = "cascade-runtime/";

export interface CascadeRuntimeOptions {
  /** Whether this is the build that runs the runtime in the page; the plugin does nothing for another. Default true. */
  browser?: boolean;
  /** Where the runtime's files go under the base. Default `RUNTIME_FOLDER`. */
  folder?: string;
  /** The folder of the `cascade-runtime` package to serve. Default the one this plugin is in. */
  from?: string;
}

/** The folder of the package this file is in, the one named `cascade-runtime`. */
function installed(): string {
  let folder = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const file = join(folder, "package.json");
    if (
      existsSync(file) &&
      (JSON.parse(readFileSync(file, "utf8")) as { name?: string }).name ===
        "cascade-runtime"
    )
      return folder;
    const parent = dirname(folder);
    if (parent === folder)
      throw new Error(
        "No package.json named cascade-runtime is above cascade-runtime/vite; run npm install.",
      );
    folder = parent;
  }
}

const json = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T;

/** What a page reads of the package besides its browser build, by its path under the package: the components. */
async function components(folder: string): Promise<string[]> {
  const packed = await json<{
    components: { repository: string; commit: string }[];
  }>(join(folder, "components/packed.json"));
  const trees = [
    "components/tables",
    ...packed.components.map(
      ({ repository, commit }) =>
        `components/${repository.split("/").at(-1)}/${commit}`,
    ),
  ];
  const paths = ["components/cascade-runtime.json", "components/packed.json"];
  for (const tree of trees) {
    const listed = await json<string[]>(join(folder, tree, "files.json"));
    paths.push(
      `${tree}.json`,
      `${tree}/files.json`,
      ...listed.map((path) => `${tree}/${path}`),
    );
  }
  return paths;
}

/**
 * A Vite plugin that serves the runtime's browser build beside an app's bundle. The app's bundle keeps
 * `cascade-runtime` external; the build copies the package's browser build and the components it reads under the
 * base, and an import map in the page loads the entry from there, so the runtime keeps its own `import.meta.url`.
 */
export function cascadeRuntime({
  browser = true,
  folder = RUNTIME_FOLDER,
  from,
}: CascadeRuntimeOptions = {}): Plugin {
  const source = from ?? installed();
  let base = "/";
  let out = "";
  return {
    name: "cascade-runtime",
    config: () =>
      browser
        ? { build: { rolldownOptions: { external: ["cascade-runtime"] } } }
        : {},
    configResolved(config) {
      base = config.base;
      out = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml() {
      if (!browser) return [];
      const entry = `${base}${folder}index.js`;
      const tags: HtmlTagDescriptor[] = [
        {
          tag: "script",
          attrs: { type: "importmap" },
          children: JSON.stringify({ imports: { "cascade-runtime": entry } }),
          injectTo: "head-prepend",
        },
        {
          tag: "link",
          attrs: { rel: "modulepreload", href: entry },
          injectTo: "head",
        },
      ];
      return tags;
    },
    async writeBundle() {
      if (!browser) return;
      await cp(join(source, "dist", "browser"), join(out, folder), {
        recursive: true,
      });
      for (const path of await components(source))
        await cp(join(source, path), join(out, folder, path));
    },
  };
}
