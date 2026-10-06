import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve as absolute } from "node:path";
import {
  type Followed,
  parseConfig,
  repositoryName,
  type RuntimeConfig,
  treeIri,
} from "../config.js";
import { vocabularyBuild } from "../build.js";
import { Layout } from "../layout.js";
import { OxigraphStore } from "../oxigraph-store.js";
import { FolderFiles } from "./folder-files.js";
import { type Resolved, type ResolverOptions, resolve } from "./resolver.js";
import {
  CONFIG_FILE,
  findRoot,
  type LocalVocabulary,
  readConfig,
  siblingsOf,
} from "./runtime.js";
import {
  type BridgePackageFound,
  bundledBridge,
  findBridgePackage,
} from "./wasm.js";

/** Where each repository's tree and the Bridge's build are: checkouts and fetches, or what a package carries. */
export interface Components {
  /** cascade-runtime.json, as checked in or as packed. */
  readonly config: RuntimeConfig;
  /** A component's folder and its N8 IRI. */
  resolve(component: Followed): Promise<Resolved>;
  /** The Bridge's built package. */
  bridge(): Promise<BridgePackageFound>;
}

/** The record a package's build writes beside the packed cascade-runtime.json: which commit of each repository it carries. */
export const PACKED = "packed.json";

export interface Packed {
  readonly components: readonly {
    readonly repository: string;
    readonly commit: string;
  }[];
  readonly bridge: { readonly release: string; readonly commit: string };
}

/** The components the runtime at `root` uses, found as every development run finds them. */
export async function checkouts(
  root: string,
  log?: (line: string) => void,
): Promise<Components> {
  const config = await readConfig(root);
  const options: ResolverOptions = {
    siblingsIn: await siblingsOf(root),
    cache: join(root, "build", "cache"),
    log,
  };
  return {
    config,
    resolve: (component) => resolve(component, options),
    bridge: () => findBridgePackage(options),
  };
}

/**
 * The components a package carries in its `components/` folder, `folder`, at the commits its build recorded, and the
 * Bridge bundled beside them. It reads nothing outside the package: no git, no fetch, no sibling.
 */
export async function packed(folder: string): Promise<Components> {
  const at = absolute(folder);
  const config = parseConfig(await readFile(join(at, CONFIG_FILE), "utf8"));
  const record = JSON.parse(await readFile(join(at, PACKED), "utf8")) as Packed;
  const commits = new Map(
    record.components.map(({ repository, commit }) => [repository, commit]),
  );
  return {
    config,
    resolve: async (component) => {
      const name = repositoryName(component);
      const commit = commits.get(component.repository);
      if (commit === undefined || !existsSync(join(at, name, commit)))
        throw new Error(
          `the package carries no ${name} (${component.repository}) in ${at}`,
        );
      return {
        component,
        source: "packed",
        folder: join(at, name, commit),
        commit,
        uncommitted: 0,
        version: commit,
        iri: treeIri(component, commit),
      };
    },
    bridge: async () => {
      const bundled = await bundledBridge(
        join(dirname(at), "node_modules"),
        record.bridge.release,
      );
      if (bundled.commit !== record.bridge.commit)
        throw new Error(
          `the package's ${PACKED} records ${record.bridge.release} at ${record.bridge.commit}, but the bundled Bridge in ${bundled.folder} was built from ${bundled.commit}`,
        );
      return bundled;
    },
  };
}

/** What a package carries when it was built with its components, otherwise the checkouts its repository resolves. */
export function componentsOf(packageFolder: string): Promise<Components> {
  const carried = join(packageFolder, "components");
  return existsSync(join(carried, CONFIG_FILE))
    ? packed(carried)
    : checkouts(findRoot(packageFolder));
}

/** The vocabulary the components name, read as a folder, with its layout and its build. */
export async function vocabularyOf(
  components: Components,
): Promise<LocalVocabulary> {
  const resolved = await components.resolve(components.config.vocabulary);
  const files = new FolderFiles(resolved.folder, resolved.iri);
  const layout = await Layout.read(files, () => new OxigraphStore());
  return {
    config: components.config,
    files,
    layout,
    build: await vocabularyBuild(files, layout),
    resolved,
  };
}
