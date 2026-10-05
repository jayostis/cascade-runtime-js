import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve as absolute } from "node:path";
import { parseConfig, type RuntimeConfig } from "../config.js";
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

/** The vocabulary the runtime at `root` uses, resolved beside it, from the folders handed in, or from its pin. */
export async function resolveVocabulary(
  root: string,
  config: RuntimeConfig,
  folders?: ReadonlyMap<string, string>,
  log?: (line: string) => void,
): Promise<Resolved> {
  return resolve(config.vocabulary, {
    siblingsIn: dirname(root),
    folders,
    cache: join(root, "build", "cache"),
    log,
  });
}
