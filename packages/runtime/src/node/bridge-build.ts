import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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

/** The tag of the release cascade-bridge-rs publishes for every commit of its main and every head of a pull request from itself. */
export const BUILD = "build-";
const HISTORY = 100;

/**
 * The newest commit of the default branch with a published build: its head, or the nearest before it while that one
 * builds.
 */
export function latestBuild(repository: string, at: string): Promise<string> {
  let found = latest.get(repository);
  if (found === undefined) {
    found = newestBuild(repository, at);
    latest.set(repository, found);
  }
  return found;
}

/** Read once per process, so every part of one run uses the same build. */
const latest = new Map<string, Promise<string>>();

async function newestBuild(repository: string, at: string): Promise<string> {
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

/** A pull request, as GitHub's API answers for one. */
export interface Pull {
  readonly body?: string | null;
  readonly state: string;
  readonly merged?: boolean;
  readonly base: { readonly ref: string; readonly repo?: Repo | null };
  readonly head: { readonly sha: string; readonly repo?: Repo | null };
}

interface Repo {
  readonly full_name?: string;
}

/** The run a pick is made for: the repository under test as `owner/name`, its pull request, and the branch it is on. */
export interface Run {
  readonly repository: string;
  readonly number?: number;
  readonly branch: string;
}

/** The commit a build is read at, and how it was picked. */
export interface Picked {
  readonly commit: string;
  readonly how: string;
}

const DEPENDS_ON = /^[^\S\n]*Depends-On:[^\S\n]*(\S+)[^\S\n]*$/gim;
const PULL_URL =
  /^(?:https?:\/\/[^/]+\/)?([^/\s]+)\/([^/\s]+)\/pull\/(\d+)\/?$/;

function pathOf(repository: string): string {
  return new URL(repository).pathname
    .split("/")
    .filter((segment) => segment !== "")
    .slice(-2)
    .join("/")
    .replace(/\.git$/, "");
}

function namedIn(
  body: string | null | undefined,
): { path: string; number: number }[] {
  return [...(body ?? "").matchAll(DEPENDS_ON)].flatMap(([, reference]) => {
    const match = PULL_URL.exec(reference ?? "");
    return match === null
      ? []
      : [{ path: `${match[1]}/${match[2]}`, number: Number(match[3]) }];
  });
}

/** The run CI is making, as GitHub Actions describes it, or undefined outside CI. */
export function runOf(env: NodeJS.ProcessEnv = process.env): Run | undefined {
  if (env.CI !== "true" || !env.GITHUB_REPOSITORY) return undefined;
  let number: number | undefined;
  try {
    const event = JSON.parse(
      readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8"),
    ) as { pull_request?: { number?: number } };
    number = event.pull_request?.number;
  } catch {
    number = undefined;
  }
  return {
    repository: env.GITHUB_REPOSITORY,
    ...(number === undefined ? {} : { number }),
    branch: env.GITHUB_REF_NAME ?? "",
  };
}

/** The pull request as GitHub's API answers now, so a description edited since the run's event is read as it stands. */
export async function readPull(path: string, number: number): Promise<Pull> {
  return (await (
    await got(`https://api.github.com/repos/${path}/pulls/${number}`, true)
  ).json()) as Pull;
}

/** The commit when it has a published build, otherwise an error saying how it was picked and why it has none. */
export async function builtAt(
  repository: string,
  at: string,
  commit: string,
  how: string,
): Promise<Picked> {
  await mkdir(at, { recursive: true });
  const tag = `refs/tags/${BUILD}${commit}`;
  if ((await git(at, "ls-remote", repository, tag)).includes(tag))
    return { commit, how };
  throw new Error(
    `${repository} has no ${BUILD}${commit} release yet for ${how}: its publish run builds one for the head of every pull request from the repository itself and for every commit of its default branch, so rerun this once that run has finished, or open a pull request from the branch`,
  );
}

/**
 * The commit of `repository` a run reads the build of, picked as the compatibility tooling picks a counterpart: an open
 * pull request reached by `Depends-On:` lines, from the run's pull request and then from each open one named, at its
 * head; otherwise the branch named like the branch the run is on, at its head, unless that is the default branch;
 * otherwise the newest build of the default branch. Outside CI, the last.
 */
export async function pickBuild(
  repository: string,
  at: string,
  run: Run | undefined,
  read: (path: string, number: number) => Promise<Pull>,
): Promise<Picked> {
  const newest = async (): Promise<Picked> => ({
    commit: await latestBuild(repository, at),
    how: "the newest build of its default branch",
  });
  if (run === undefined) return newest();
  let branch = run.branch;
  if (run.number !== undefined) {
    const under = await read(run.repository, run.number);
    branch = under.base.ref || branch;
    const own = pathOf(repository);
    const seen = new Set([`${run.repository}/pull/${run.number}`]);
    const walking = [under];
    const found: { label: string; pull: Pull }[] = [];
    for (let pull = walking.shift(); pull; pull = walking.shift())
      for (const { path, number } of namedIn(pull.body)) {
        const label = `${path}/pull/${number}`;
        if (seen.has(label)) continue;
        seen.add(label);
        const named = await read(path, number);
        const open = named.state === "open" && named.merged !== true;
        if (open) walking.push(named);
        if (path !== own) continue;
        if (open) found.push({ label, pull: named });
        else if (named.merged !== true)
          throw new Error(
            `${label} is closed without merging, so nothing names a build of ${own}: cut its Depends-On: line`,
          );
      }
    if (found.length > 1)
      throw new Error(
        `${found.map(({ label }) => label).join(" and ")} are named on Depends-On: lines, and a run reads one build of ${own}: name one pull request holding every change`,
      );
    const [named] = found;
    if (named !== undefined) {
      const from = named.pull.head.repo?.full_name;
      if (from !== named.pull.base.repo?.full_name)
        throw new Error(
          `${named.label} is from ${from ?? "a deleted fork"}, and only a pull request from ${own} itself gets a ${BUILD}<head> release: push its branch to ${own}`,
        );
      return builtAt(
        repository,
        at,
        named.pull.head.sha,
        `the head of ${named.label}, named on a Depends-On: line`,
      );
    }
  }
  if (branch === "") return newest();
  await mkdir(at, { recursive: true });
  const heads = `refs/heads/${branch}`;
  let head: string | undefined;
  let isDefault = false;
  for (const line of (
    await git(at, "ls-remote", "--symref", repository, "HEAD", heads)
  ).split("\n")) {
    const [left = "", ref] = line.trim().split("\t");
    if (ref === "HEAD" && left === `ref: ${heads}`) isDefault = true;
    if (ref === heads) head = left;
  }
  if (head === undefined || isDefault) return newest();
  return builtAt(
    repository,
    at,
    head,
    `the head of its branch ${branch}, named like the branch the run is on`,
  );
}

/**
 * {@link pickBuild} for the run this process is part of, read once per process, so every part of one run uses the same
 * build. In CI the pick is kept in `at` for the run's attempt, so a later step whose process holds no token to read
 * GitHub's API with (the conformance command the compatibility tooling starts) reads the same pick.
 */
export function pickedBuild(repository: string, at: string): Promise<Picked> {
  let found = picked.get(repository);
  if (found === undefined) {
    found = keptPick(repository, at, runOf());
    picked.set(repository, found);
  }
  return found;
}

const picked = new Map<string, Promise<Picked>>();

async function keptPick(
  repository: string,
  at: string,
  run: Run | undefined,
): Promise<Picked> {
  const attempt =
    run === undefined || !process.env.GITHUB_RUN_ID
      ? undefined
      : `${process.env.GITHUB_RUN_ID}.${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`;
  const file = join(at, "picked.json");
  if (attempt !== undefined)
    try {
      const kept = JSON.parse(await readFile(file, "utf8")) as Picked & {
        attempt?: string;
        repository?: string;
      };
      if (kept.attempt === attempt && kept.repository === repository)
        return {
          commit: kept.commit,
          how: `${kept.how}, as the first pick of this run kept it`,
        };
    } catch {
      // Not kept yet in this attempt.
    }
  const found = await pickBuild(repository, at, run, readPull);
  if (attempt !== undefined) {
    await mkdir(at, { recursive: true });
    await writeFile(file, JSON.stringify({ attempt, repository, ...found }));
  }
  return found;
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
    if (path.split("/").includes("..") || path.startsWith("/"))
      throw new Error(`the package holds ${path}, outside its folder`);
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
  if ((await recorded(folder)) === commit) {
    await rm(partial, { recursive: true, force: true });
    return folder;
  }
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
