import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import {
  BRIDGE_GLUE,
  BRIDGE_WASM,
  FILES_JSON,
  type Followed,
  kitsOf,
  repositoryName,
  WasmBridge,
} from "@cascade-runtime/runtime";
import {
  BRIDGE_REPOSITORY,
  checkout,
  compiledBridge,
  CONFIG_FILE,
  findRoot,
  FolderFiles,
  inWorker,
  PACKED,
  type Packed,
  readConfig,
  releasedBridgePackage,
  resolve,
  type Resolved,
} from "@cascade-runtime/runtime/node";
import { packageVersion, tarballAddress } from "./address.js";

const WORKSPACE = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = findRoot(WORKSPACE);
const BUILD = join(ROOT, "build");
const STAGE = join(BUILD, "package");
const CACHE = join(BUILD, "cache");
const COMPONENTS = join(STAGE, "components");
const NODE_MODULES = join(STAGE, "node_modules");
const METADATA = "ro-crate-metadata.json";
const BROWSER = join(WORKSPACE, "dist", "browser");
const WASM = "web_bg.wasm";
/** The Bridge's glue and module, which a page loads by URL beside the browser entry. */
const BRIDGE_FILES = [BRIDGE_GLUE, BRIDGE_WASM];
/** The workspaces bundled into the package, which are on no registry. */
const BUNDLED = ["runtime", "apple-health", "ccda-download", "fhir-pull"];
/** What a pod reads of the vocabulary, beside every kit under `conformance/`. */
const VOCABULARY = [
  "LICENSE",
  METADATA,
  "ontologies",
  "queries",
  "runtime/pod-layout.ttl",
  "runtime/rules.md",
];
/** What an adapter reads of another vocabulary repository it names. */
const OTHER_VOCABULARY = ["LICENSE", METADATA, "ontologies"];
const KEPT_BY_BUNDLED = ["name", "version", "type", "exports", "license"];
const KEPT_BY_PACKAGE = [
  "name",
  "description",
  "license",
  "repository",
  "engines",
  "type",
  "exports",
  "bin",
  "files",
];

type Manifest = Record<string, unknown> & {
  readonly name: string;
  readonly version: string;
  readonly dependencies?: Record<string, string>;
  readonly files?: string[];
};

const log = (line: string): void => console.log(line);

async function manifestOf(folder: string): Promise<Manifest> {
  return JSON.parse(
    await readFile(join(folder, "package.json"), "utf8"),
  ) as Manifest;
}

function kept(manifest: Manifest, fields: readonly string[]): object {
  return Object.fromEntries(
    fields.filter((field) => field in manifest).map((f) => [f, manifest[f]]),
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** The head of the component's default branch, read once for the whole pack and fetched: never a sibling or a folder handed in. */
function headOf(component: Followed): Promise<Resolved> {
  return resolve(component, { siblingsIn: [], cache: CACHE, log });
}

function treeOf(resolved: Resolved): string {
  return join(COMPONENTS, repositoryName(resolved.component), resolved.version);
}

async function copyPaths(
  from: string,
  to: string,
  paths: readonly string[],
): Promise<void> {
  for (const path of paths) {
    const source = join(from, ...path.split("/"));
    if (!existsSync(source)) throw new Error(`${from} holds no ${path}`);
    await cp(source, join(to, ...path.split("/")), { recursive: true });
  }
}

/** Compiled code and its types, no source map. */
function compiled(path: string): boolean {
  return (
    statSync(path).isDirectory() ||
    path.endsWith(".js") ||
    path.endsWith(".d.ts")
  );
}

/** The vocabulary repositories the adapters name by `bridge:cascadeVocabularyRepository`, as the Bridge describes them. */
async function vocabulariesNamed(
  bridgeFolder: string,
  adapters: readonly Resolved[],
): Promise<string[]> {
  const bridge = new WasmBridge(inWorker(await compiledBridge(bridgeFolder)));
  try {
    const named = new Set<string>();
    for (const adapter of adapters) {
      const metadata = await new FolderFiles(adapter.folder).read(METADATA);
      if (metadata === undefined)
        throw new Error(`${adapter.folder} holds no ${METADATA}`);
      const { vocabulary } = await bridge.describe(adapter.iri, metadata);
      if (vocabulary?.repository !== undefined)
        named.add(vocabulary.repository);
    }
    return [...named];
  } finally {
    bridge.close();
  }
}

async function packComponents(): Promise<{
  readonly resolved: readonly Resolved[];
  readonly bridge: Packed["bridge"];
  readonly bridgeFolder: string;
}> {
  const config = await readConfig(ROOT);
  const vocabulary = await headOf(config.vocabulary);
  const adapters: Resolved[] = [];
  for (const adapter of config.adapters) adapters.push(await headOf(adapter));
  const bridge = await releasedBridgePackage(CACHE);
  if (bridge.release === undefined)
    throw new Error(`${bridge.folder} names no release`);
  log(
    `cascade-bridge-rs: the release ${bridge.release}, the newest build of its default branch`,
  );
  const others: Resolved[] = [];
  for (const repository of await vocabulariesNamed(bridge.folder, adapters))
    if (repository !== config.vocabulary.repository)
      others.push(await headOf({ repository }));

  const kits = await kitsOf(new FolderFiles(vocabulary.folder));
  await copyPaths(vocabulary.folder, treeOf(vocabulary), [
    ...VOCABULARY,
    ...kits,
  ]);
  for (const other of others)
    await copyPaths(other.folder, treeOf(other), OTHER_VOCABULARY);
  for (const adapter of adapters)
    await cp(adapter.folder, treeOf(adapter), {
      recursive: true,
      filter: (path) => relative(adapter.folder, path).split(sep)[0] !== ".git",
    });
  await copyFile(join(ROOT, CONFIG_FILE), join(COMPONENTS, CONFIG_FILE));
  const resolved = [vocabulary, ...adapters, ...others];
  const record: Packed = {
    components: resolved.map(({ component, version }) => ({
      repository: component.repository,
      commit: version,
    })),
    bridge: { release: bridge.release, commit: bridge.commit },
  };
  await writeJson(join(COMPONENTS, PACKED), record);
  for (const component of resolved) await writeFilesJson(treeOf(component));
  return { resolved, bridge: record.bridge, bridgeFolder: bridge.folder };
}

/** Lists every file under the folder, as a browser reads it over HTTP. */
async function writeFilesJson(folder: string): Promise<void> {
  const paths = (
    await readdir(folder, { recursive: true, withFileTypes: true })
  )
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(folder, join(entry.parentPath, entry.name)).split(sep).join("/"),
    )
    .filter((path) => path !== FILES_JSON)
    .sort();
  await writeJson(join(folder, FILES_JSON), paths);
}

/** The browser entry and the Bridge's worker as modules, with Oxigraph's web build and the Bridge's beside them. */
async function bundleBrowser(bridgeFolder: string): Promise<void> {
  await rm(BROWSER, { recursive: true, force: true });
  await build({
    entryPoints: {
      index: join(WORKSPACE, "dist", "src", "browser", "index.js"),
      "wasm-worker": join(
        ROOT,
        "packages",
        "runtime",
        "dist",
        "src",
        "web",
        "wasm-worker.js",
      ),
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2023",
    outdir: BROWSER,
    logLevel: "warning",
  });
  await copyFile(
    fileURLToPath(new URL(WASM, import.meta.resolve("oxigraph/web.js"))),
    join(BROWSER, WASM),
  );
  for (const file of BRIDGE_FILES)
    await copyFile(join(bridgeFolder, file), join(BROWSER, file));
}

/** The workspaces and the Bridge as real folders under the package's `node_modules/`, and the dependencies they bring. */
async function packCode(bridgeFolder: string): Promise<{
  readonly bundled: Record<string, string>;
  readonly dependencies: Record<string, string>;
}> {
  const bundled: Record<string, string> = {};
  const required: Record<string, string> = {};
  for (const folder of BUNDLED) {
    const workspace = join(ROOT, "packages", folder);
    const manifest = await manifestOf(workspace);
    const to = join(NODE_MODULES, ...manifest.name.split("/"));
    await cp(join(workspace, "dist", "src"), join(to, "dist", "src"), {
      recursive: true,
      filter: compiled,
    });
    await writeJson(join(to, "package.json"), kept(manifest, KEPT_BY_BUNDLED));
    bundled[manifest.name] = manifest.version;
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      const pinned = required[name];
      if (pinned !== undefined && pinned !== version)
        throw new Error(
          `${manifest.name} pins ${name} at ${version}, but another bundled workspace pins it at ${pinned}`,
        );
      required[name] = version;
    }
  }
  const bridge = await manifestOf(bridgeFolder);
  await cp(bridgeFolder, join(NODE_MODULES, bridge.name), { recursive: true });
  bundled[bridge.name] = bridge.version;
  const dependencies = Object.fromEntries(
    Object.entries({ ...required, ...bundled }).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
  );
  return { bundled, dependencies };
}

/** A Markdown file the package ships, with the install line where it asks for it. */
function shipped(text: string, address: string): string {
  return text
    .split(/\r?\n/)
    .flatMap((line) =>
      line === "<!-- INSTALL -->"
        ? ["```sh", `npm install ${address}`, "```"]
        : [line],
    )
    .join("\n");
}

async function packOwnFiles(
  manifest: Manifest,
  address: string,
): Promise<void> {
  await copyFile(join(ROOT, "LICENSE"), join(STAGE, "LICENSE"));
  for (const path of manifest.files ?? []) {
    const from = join(WORKSPACE, ...path.split("/"));
    const to = join(STAGE, ...path.split("/"));
    await cp(from, to, {
      recursive: true,
      filter: (file) => !file.endsWith(".map"),
    });
    const markdown = statSync(to).isDirectory()
      ? (await readdir(to, { recursive: true }))
          .filter((file) => file.endsWith(".md"))
          .map((file) => join(to, file))
      : to.endsWith(".md")
        ? [to]
        : [];
    for (const file of markdown)
      await writeFile(file, shipped(await readFile(file, "utf8"), address));
  }
}

async function npmPack(): Promise<{ filename: string; integrity: string }> {
  const args = ["pack", "--json", "--pack-destination", BUILD];
  const npm = process.env.npm_execpath;
  if (npm === undefined)
    throw new Error(
      "npm_execpath is unset: run the pack as `npm run build:package`",
    );
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [npm, ...args],
    { cwd: STAGE, maxBuffer: 64 * 1024 * 1024 },
  );
  const [packed] = JSON.parse(stdout) as {
    filename: string;
    integrity: string;
  }[];
  if (packed === undefined) throw new Error("npm pack packed nothing");
  return packed;
}

function releaseNotes(
  address: string,
  commit: string,
  integrity: string,
  resolved: readonly Resolved[],
  bridge: Packed["bridge"],
): string {
  return [
    "```sh",
    `npm install ${address}`,
    "```",
    "",
    `Built from commit ${commit}. Integrity \`${integrity}\`.`,
    "",
    "It carries:",
    "",
    "| Component | Tree | Commit |",
    "| --- | --- | --- |",
    ...resolved.map(
      ({ component, iri, version }) =>
        `| ${repositoryName(component)} | <${iri}> | \`${version}\` |`,
    ),
    `| cascade-bridge-rs | [${bridge.release}](${BRIDGE_REPOSITORY}/releases/tag/${bridge.release}) | \`${bridge.commit}\` |`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const head = await checkout(ROOT);
  if (head === undefined) throw new Error(`${ROOT} is no git checkout`);
  const { commit } = head;
  const address = tarballAddress(commit);
  const manifest = await manifestOf(WORKSPACE);

  await rm(STAGE, { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });
  const { resolved, bridge, bridgeFolder } = await packComponents();
  const { bundled, dependencies } = await packCode(bridgeFolder);
  await bundleBrowser(bridgeFolder);
  await packOwnFiles(manifest, address);
  await writeJson(join(STAGE, "package.json"), {
    ...kept(manifest, KEPT_BY_PACKAGE),
    version: packageVersion(commit),
    private: true,
    files: [...(manifest.files ?? []), "components"],
    dependencies,
    bundleDependencies: Object.keys(bundled).sort(),
    cascadeRuntime: { commit, dirty: head.uncommitted > 0, tarball: address },
  });

  for (const file of await readdir(BUILD))
    if (file.startsWith(`${manifest.name}-`) && file.endsWith(".tgz"))
      await rm(join(BUILD, file));
  const { filename, integrity } = await npmPack();
  await writeFile(
    join(BUILD, "release-notes.md"),
    releaseNotes(address, commit, integrity, resolved, bridge),
  );
  log(
    `packed ${join(BUILD, filename)}${head.uncommitted > 0 ? `, from ${commit} with ${head.uncommitted} uncommitted files` : `, from ${commit}`}`,
  );
}

await main();
