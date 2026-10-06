import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve as absolute } from "node:path";
import { parseConfig, type RuntimeConfig } from "../config.js";
import { vocabularyBuild, type VocabularyBuild } from "../build.js";
import { Layout } from "../layout.js";
import { OxigraphStore } from "../oxigraph-store.js";
import { FolderFiles } from "./folder-files.js";
import { git } from "./git.js";
import { type Resolved, resolve } from "./resolver.js";

export const CONFIG_FILE = "cascade-runtime.json";

/** The folder holding cascade-runtime.json, at or above `from`. */
export function findRoot(from: string): string {
  for (let folder = absolute(from); ; folder = dirname(folder)) {
    if (existsSync(join(folder, CONFIG_FILE))) return folder;
    if (dirname(folder) === folder)
      throw new Error(`no ${CONFIG_FILE} at or above ${from}`);
  }
}

export async function readConfig(root: string): Promise<RuntimeConfig> {
  return parseConfig(await readFile(join(root, CONFIG_FILE), "utf8"));
}

/**
 * The folders the runtime at `root` finds sibling checkouts in: the one holding its checkout, and, for a linked
 * worktree, after it the one holding the checkout it was made from.
 */
export async function siblingsOf(root: string): Promise<string[]> {
  try {
    const [top, common] = (
      await git(
        root,
        "rev-parse",
        "--path-format=absolute",
        "--show-toplevel",
        "--git-common-dir",
      )
    )
      .trim()
      .split("\n")
      .map((line) => absolute(line.trim()));
    if (
      top !== undefined &&
      common !== undefined &&
      (await realpath(top)) === (await realpath(root)) &&
      basename(common) === ".git"
    )
      return [...new Set([dirname(root), dirname(dirname(common))])];
  } catch {
    // Not a git checkout: its siblings are beside it.
  }
  return [dirname(root)];
}

/** The vocabulary the runtime at `root` uses: beside it, from the folders handed in, or at the head of its branch. */
export async function resolveVocabulary(
  root: string,
  config: RuntimeConfig,
  folders?: ReadonlyMap<string, string>,
  log?: (line: string) => void,
): Promise<Resolved> {
  return resolve(config.vocabulary, {
    siblingsIn: await siblingsOf(root),
    folders,
    cache: join(root, "build", "cache"),
    log,
  });
}

/** The vocabulary the runtime at `root` uses, read as a folder, with its layout and its build. */
export interface LocalVocabulary {
  readonly config: RuntimeConfig;
  readonly files: FolderFiles;
  readonly layout: Layout;
  readonly build: VocabularyBuild;
  /** Which checkout, or which commit of its branch, the vocabulary was read from. */
  readonly resolved: Resolved;
}

export async function localVocabulary(
  root: string,
  log?: (line: string) => void,
): Promise<LocalVocabulary> {
  const config = await readConfig(root);
  const resolved = await resolveVocabulary(root, config, undefined, log);
  const files = new FolderFiles(resolved.folder, resolved.iri);
  const layout = await Layout.read(files, () => new OxigraphStore());
  return {
    config,
    files,
    layout,
    build: await vocabularyBuild(files, layout),
    resolved,
  };
}
