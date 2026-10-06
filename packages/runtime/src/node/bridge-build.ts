import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve as absolute } from "node:path";
import { gunzipSync } from "node:zlib";
import { git } from "./git.js";

/** The tag of the release cascade-bridge-rs publishes on every push to its main, for the commit pushed. */
export const BUILD = "build-";
const HISTORY = 100;

/**
 * The newest commit of the default branch with a published build: its head, or the nearest before it while that one
 * builds.
 */
export async function latestBuild(
  repository: string,
  at: string,
): Promise<string> {
  await mkdir(at, { recursive: true });
  const head = "HEAD";
  const tags = `refs/tags/${BUILD}`;
  let tip: string | undefined;
  const built = new Set<string>();
  for (const line of (
    await git(at, "ls-remote", repository, head, `${tags}*`)
  ).split("\n")) {
    const [commit, ref = ""] = line.trim().split("\t");
    if (ref === head) tip = commit;
    else if (ref.startsWith(tags) && !ref.endsWith("^{}"))
      built.add(ref.slice(tags.length));
  }
  if (tip === undefined) throw new Error(`${repository} has no default branch`);
  if (built.has(tip)) return tip;
  const history = await mkdtemp(join(at, "history-"));
  try {
    await git(history, "init", "--quiet");
    await git(
      history,
      "fetch",
      "--quiet",
      `--depth=${HISTORY}`,
      "--filter=tree:0",
      repository,
      head,
    );
    const found = (
      await git(history, "rev-list", "--first-parent", "FETCH_HEAD")
    )
      .split("\n")
      .find((commit) => built.has(commit.trim()));
    if (found === undefined)
      throw new Error(
        `none of the last ${HISTORY} commits of ${repository}'s default branch has a ${BUILD}<commit> release`,
      );
    return found.trim();
  } finally {
    await rm(history, { recursive: true, force: true });
  }
}

interface Asset {
  readonly name: string;
  readonly browser_download_url: string;
  readonly digest?: string | null;
}

async function got(url: string, json: boolean): Promise<Response> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const response = await fetch(url, {
    headers: {
      "user-agent": "cascade-runtime-js",
      ...(json ? { accept: "application/vnd.github+json" } : {}),
      ...(json && token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok)
    throw new Error(
      `${url} answered ${response.status} ${response.statusText}`,
    );
  return response;
}

/** The files of an npm package tarball, by their paths inside its `package/` folder. */
export function untar(gzipped: Uint8Array): Map<string, Uint8Array> {
  const bytes = gunzipSync(gzipped);
  const text = (from: number, length: number): string =>
    bytes
      .subarray(from, from + length)
      .toString("utf8")
      .replace(/\0.*$/s, "");
  const files = new Map<string, Uint8Array>();
  for (let at = 0; at + 512 <= bytes.length;) {
    const name = text(at, 100);
    if (name === "") break;
    const prefix = text(at + 345, 155);
    const size = parseInt(text(at + 124, 12).trim() || "0", 8);
    const type = text(at + 156, 1);
    const path = (prefix === "" ? name : `${prefix}/${name}`).replace(
      /^package\//,
      "",
    );
    if (type === "" || type === "0")
      files.set(path, bytes.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function recorded(folder: string): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(
      await readFile(join(folder, "package.json"), "utf8"),
    ) as { cascadeBridge?: { commit?: string } };
    return manifest.cascadeBridge?.commit;
  } catch {
    return undefined;
  }
}

/** The package the release `build-<commit>` publishes, downloaded once into `cache/build-<commit>`. */
export async function releasedBuild(
  repository: string,
  commit: string,
  cache: string,
): Promise<string> {
  const tag = `${BUILD}${commit}`;
  const folder = absolute(cache, tag);
  if ((await recorded(folder)) === commit) return folder;
  const { assets } = (await (
    await got(
      `https://api.github.com/repos${new URL(repository).pathname}/releases/tags/${tag}`,
      true,
    )
  ).json()) as { assets: Asset[] };
  const tarball = assets.find((asset) => asset.name.endsWith(".tgz"));
  if (tarball === undefined)
    throw new Error(`the release ${tag} of ${repository} holds no package`);
  const bytes = new Uint8Array(
    await (await got(tarball.browser_download_url, false)).arrayBuffer(),
  );
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (tarball.digest && tarball.digest !== digest)
    throw new Error(
      `${tarball.browser_download_url} is ${digest}, where the release says ${tarball.digest}`,
    );
  await mkdir(dirname(folder), { recursive: true });
  const partial = await mkdtemp(`${folder}.partial-`);
  for (const [path, file] of untar(bytes)) {
    await mkdir(dirname(join(partial, path)), { recursive: true });
    await writeFile(join(partial, path), file);
  }
  if ((await recorded(partial)) !== commit)
    throw new Error(`the package of ${tag} records no build of ${commit}`);
  if (existsSync(folder)) await rm(folder, { recursive: true, force: true });
  try {
    await rename(partial, folder);
  } catch (error) {
    // Another run downloading the same build may have put it in place first.
    if ((await recorded(folder)) !== commit) throw error;
  }
  await rm(partial, { recursive: true, force: true });
  return folder;
}
