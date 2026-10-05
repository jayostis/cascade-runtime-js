import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function git(folder: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", folder, ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/**
 * The commit the folder's own checkout is at and how many files differ from it, or undefined if the folder is not the
 * top of a checkout.
 */
export async function checkout(
  folder: string,
): Promise<{ commit: string; uncommitted: number } | undefined> {
  try {
    const top = (await git(folder, "rev-parse", "--show-toplevel")).trim();
    if ((await realpath(top)) !== (await realpath(folder))) return undefined;
    const commit = (await git(folder, "rev-parse", "HEAD")).trim();
    const status = await git(
      folder,
      "status",
      "--porcelain",
      "--untracked-files=all",
    );
    return {
      commit,
      uncommitted: status.split("\n").filter((line) => line.trim() !== "")
        .length,
    };
  } catch {
    return undefined;
  }
}
