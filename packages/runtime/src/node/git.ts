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

/** The committer of the merges the compatibility tooling makes to test a pull request together with its partners. */
const TOOLING = "compatibility@invalid";

/**
 * The commit the folder's own checkout is at and how many files differ from it, or undefined if the folder is not the
 * top of a checkout. Where the tooling merged a Depends-On pull request into the checkout, HEAD is a merge commit no
 * server holds, so the commit is the pull request's head, the last thing merged, which a link can name.
 */
export async function checkout(
  folder: string,
): Promise<{ commit: string; uncommitted: number } | undefined> {
  try {
    const top = (await git(folder, "rev-parse", "--show-toplevel")).trim();
    if ((await realpath(top)) !== (await realpath(folder))) return undefined;
    let commit = (await git(folder, "rev-parse", "HEAD")).trim();
    for (;;) {
      const [parents, committer] = (
        await git(folder, "log", "-1", "--format=%P%n%ce", commit)
      ).split("\n");
      const heads = (parents ?? "")
        .split(" ")
        .filter((parent) => parent !== "");
      if (committer !== TOOLING || heads.length !== 2 || heads[1] === undefined)
        break;
      commit = heads[1];
    }
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
