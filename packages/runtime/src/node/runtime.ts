import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve as absolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  packedCommit,
  parseConfig,
  RUNTIME_REPOSITORY,
  runtimeIri,
  type RuntimeConfig,
} from "../config.js";
import type { VocabularyBuild } from "../build.js";
import type { Layout } from "../layout.js";
import { checkouts, vocabularyOf } from "./components.js";
import type { FolderFiles } from "./folder-files.js";
import { checkout, git } from "./git.js";
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
  return vocabularyOf(await checkouts(root, log));
}

/** The name of this repository's own package.json, at the root of its checkout. */
const REPOSITORY_PACKAGE = "cascade-runtime-js";

let performing: Promise<string> | undefined;

/**
 * This runtime as every act it performs names it (N7), read once: the commit a packed package's manifest records,
 * marked `#uncommitted` when it was packed from a checkout with changes; else,
 * in a checkout of this repository, its commit, marked `#uncommitted` when files differ from it, since the tree at the
 * commit is not what runs; else, where no commit can be read, as a Docker worktree whose `.git` names a path on its
 * host, the repository marked `#unidentified`.
 */
export function thisRuntime(): Promise<string> {
  performing ??= (async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (let folder = here; ; folder = dirname(folder)) {
      const manifest = join(folder, "package.json");
      if (existsSync(manifest)) {
        const { name, version, cascadeRuntime } = JSON.parse(
          await readFile(manifest, "utf8"),
        ) as {
          name?: unknown;
          version?: unknown;
          cascadeRuntime?: { commit?: unknown; dirty?: unknown };
        };
        const commit =
          typeof cascadeRuntime?.commit === "string"
            ? cascadeRuntime.commit
            : typeof version === "string"
              ? packedCommit(version)
              : undefined;
        if (commit !== undefined)
          return cascadeRuntime?.dirty === true
            ? `${runtimeIri(commit)}#uncommitted`
            : runtimeIri(commit);
        if (name === REPOSITORY_PACKAGE) {
          const found = await checkout(folder);
          if (found === undefined) break;
          return found.uncommitted === 0
            ? runtimeIri(found.commit)
            : `${runtimeIri(found.commit)}#uncommitted`;
        }
      }
      if (dirname(folder) === folder) break;
    }
    return `${RUNTIME_REPOSITORY}#unidentified`;
  })();
  return performing;
}
