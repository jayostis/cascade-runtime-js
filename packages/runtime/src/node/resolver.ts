import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve as absolute } from "node:path";
import { type Followed, repositoryName, treeIri } from "../config.js";
import { counted } from "../probe.js";
import { checkout, git } from "./git.js";

export type Source = "sibling" | "folder" | "fetched" | "packed";

export interface Resolved {
  readonly component: Followed;
  readonly source: Source;
  readonly folder: string;
  /** The commit the folder is at, when it is a git checkout. */
  readonly commit?: string;
  readonly uncommitted?: number;
  /** The default branch a fetched component was the head of. */
  readonly branch?: string;
  /** The commit the folder is at, or `HEAD` for a folder that is no git checkout. */
  readonly version: string;
  /** The IRI the component is named by: its tree at {@link version}. */
  readonly iri: string;
}

export interface ResolverOptions {
  /** The folders a sibling checkout of each repository would be in, under the repository's name; the first holding one wins. */
  readonly siblingsIn: readonly string[];
  /** A folder for each repository, by its URL, as the compatibility tooling or CI hands them in. */
  readonly folders?: ReadonlyMap<string, string>;
  /** Where a repository is fetched to, a folder per repository and commit. */
  readonly cache: string;
  readonly log?: (line: string) => void;
}

/** The sibling checkout named `name` in the first of `folders` that holds one. */
export function siblingIn(
  folders: readonly string[],
  name: string,
): string | undefined {
  return folders
    .map((folder) => join(absolute(folder), name))
    .find((sibling) => existsSync(sibling));
}

function short(commit: string): string {
  return commit.slice(0, 12);
}

/** One line saying which version of the component a run uses. */
export function said(resolved: Resolved): string {
  const name = repositoryName(resolved.component);
  if (resolved.source === "fetched")
    return `${name}: ${resolved.branch} at ${short(resolved.version)}, fetched into ${resolved.folder}`;
  if (resolved.source === "packed")
    return `${name}: the package's ${short(resolved.version)}, in ${resolved.folder}`;
  const where =
    resolved.source === "sibling"
      ? "the sibling checkout"
      : "the folder handed in,";
  if (resolved.commit === undefined)
    return `${name}: ${where} ${resolved.folder}, which is no git checkout`;
  const changes =
    resolved.uncommitted === 0
      ? "with no uncommitted changes"
      : `with ${resolved.uncommitted} uncommitted files`;
  return `${name}: ${where} ${resolved.folder}, at ${short(resolved.commit)} ${changes}`;
}

async function onDisk(
  component: Followed,
  source: Source,
  folder: string,
): Promise<Resolved> {
  const found = await checkout(folder);
  const version = found?.commit ?? "HEAD";
  return {
    component,
    source,
    folder,
    ...found,
    version,
    iri: treeIri(component, version),
  };
}

interface Head {
  readonly branch: string;
  readonly commit: string;
}

/** Read once per process, so every part of one run reads the same commit of a repository. */
const heads = new Map<string, Promise<Head>>();

/** The repository's default branch and the commit at its head, as the repository had them when this run first asked. */
export function headOf(repository: string, at: string): Promise<Head> {
  let found = heads.get(repository);
  if (found === undefined) {
    found = remoteHead(repository, at);
    heads.set(repository, found);
  }
  return found;
}

async function remoteHead(repository: string, at: string): Promise<Head> {
  await mkdir(at, { recursive: true });
  let branch: string | undefined;
  let commit: string | undefined;
  for (const line of (
    await git(at, "ls-remote", "--symref", repository, "HEAD")
  ).split("\n")) {
    const [left = "", ref] = line.trim().split("\t");
    if (ref !== "HEAD") continue;
    if (left.startsWith("ref: refs/heads/"))
      branch = left.slice("ref: refs/heads/".length);
    else if (/^[0-9a-f]{40}$/.test(left)) commit = left;
  }
  if (branch === undefined || commit === undefined)
    throw new Error(`${repository} has no default branch`);
  return { branch, commit };
}

async function atCommit(folder: string, commit: string): Promise<boolean> {
  return (await checkout(folder))?.commit === commit;
}

/** The repository at the commit, fetched once into `cache/<name>/<commit>`, by any number of runs at once. */
export async function fetchedAt(
  repository: string,
  commit: string,
  cache: string,
): Promise<string> {
  const folder = absolute(cache, repositoryName({ repository }), commit);
  if (await atCommit(folder, commit)) return folder;
  await mkdir(dirname(folder), { recursive: true });
  const partial = await mkdtemp(`${folder}.partial-`);
  await git(partial, "init", "--quiet");
  await git(partial, "fetch", "--quiet", "--depth", "1", repository, commit);
  await git(
    partial,
    "-c",
    "advice.detachedHead=false",
    "checkout",
    "--quiet",
    "--detach",
    "FETCH_HEAD",
  );
  if (existsSync(folder) && !(await atCommit(folder, commit))) {
    await rm(folder, { recursive: true, force: true });
  }
  try {
    await rename(partial, folder);
  } catch (error) {
    // Another run fetching the same commit may have put it in place first.
    if (!(await atCommit(folder, commit))) throw error;
  }
  await rm(partial, { recursive: true, force: true });
  return folder;
}

async function fetched(component: Followed, cache: string): Promise<Resolved> {
  const { branch, commit } = await headOf(component.repository, cache);
  return {
    component,
    source: "fetched",
    folder: await fetchedAt(component.repository, commit, cache),
    branch,
    commit,
    uncommitted: 0,
    version: commit,
    iri: treeIri(component, commit),
  };
}

/** What a process's options say, apart from the log a run is given; the folders by repository, in order. */
export function optionsKey(options: ResolverOptions): string {
  return JSON.stringify([
    options.siblingsIn,
    options.folders === undefined ? [] : [...options.folders].sort(),
    options.cache,
  ]);
}

async function stamped(path: string): Promise<string> {
  const found = await stat(path).catch(() => undefined);
  return found === undefined ? "-" : `${found.size}:${found.mtimeMs}`;
}

/** The folder git keeps a checkout's state in: `.git`, or the folder a worktree's `.git` file points to. */
async function gitFolder(checkout: string): Promise<string> {
  const dot = join(checkout, ".git");
  const text = await readFile(dot, "utf8").catch(() => undefined);
  const pointed =
    text === undefined ? undefined : /^gitdir:\s*(.+)$/m.exec(text);
  return pointed?.[1] === undefined
    ? dot
    : absolute(checkout, pointed[1].trim());
}

/**
 * What changes when a local checkout's commit or index does, a few stats: the time of change of `.git/HEAD`, of the ref it
 * points at (and `packed-refs`, where a ref is packed) and of `.git/index`. A resolution of a checkout is kept for as long
 * as this is the same, so a commit, a checkout of another branch or a `git add` is seen; an edit of a file git has not been
 * told of is not, as it moves none of them.
 */
export async function checkoutStamp(checkout: string): Promise<string> {
  const dir = await gitFolder(checkout);
  const head = await readFile(join(dir, "HEAD"), "utf8").catch(() => "");
  const ref = /^ref:\s*(\S+)/.exec(head)?.[1];
  const common = await readFile(join(dir, "commondir"), "utf8")
    .then((text) => absolute(dir, text.trim()))
    .catch(() => dir);
  return (
    await Promise.all([
      stamped(join(dir, "HEAD")),
      ref === undefined ? "-" : stamped(join(common, ref)),
      stamped(join(common, "packed-refs")),
      stamped(join(dir, "index")),
    ])
  ).join(" ");
}

/** The checkout a component is read from on disk, if it is: the sibling first, then the folder handed in. */
export function localCheckout(
  component: Followed,
  options: ResolverOptions,
): string | undefined {
  const handedIn = options.folders?.get(component.repository);
  return (
    siblingIn(options.siblingsIn, repositoryName(component)) ??
    (handedIn === undefined ? undefined : absolute(handedIn))
  );
}

const resolutions = new Map<string, Promise<Resolved>>();
const resolutionKeys = new Map<string, string>();

/**
 * The folder a component is read from, first match wins: a sibling checkout as it is on disk; a folder handed in;
 * otherwise the head of its default branch as it is now, fetched. The run says which. Resolved once per process for each
 * component and options, so every part of one run reads the same commit and git runs once; a checkout on disk is
 * resolved again when its {@link checkoutStamp} changes, so a long-lived process records the commit it is at.
 */
export async function resolve(
  component: Followed,
  options: ResolverOptions,
): Promise<Resolved> {
  const local = localCheckout(component, options);
  const identity = JSON.stringify([component, optionsKey(options)]);
  const key = JSON.stringify([
    identity,
    local === undefined ? "" : await checkoutStamp(local),
  ]);
  let found = resolutions.get(key);
  if (found === undefined) {
    // One resolution of a component under these options is kept: the one it was before is let go.
    const before = resolutionKeys.get(identity);
    if (before !== undefined) resolutions.delete(before);
    resolutionKeys.set(identity, key);
    found = resolveNow(component, options);
    resolutions.set(key, found);
    found.catch(() => {
      if (resolutions.get(key) === found) resolutions.delete(key);
    });
  }
  const resolved = await found;
  options.log?.(said(resolved));
  return resolved;
}

async function resolveNow(
  component: Followed,
  options: ResolverOptions,
): Promise<Resolved> {
  counted("components.resolved");
  const sibling = siblingIn(options.siblingsIn, repositoryName(component));
  const handedIn = options.folders?.get(component.repository);
  const resolved =
    sibling !== undefined
      ? await onDisk(component, "sibling", sibling)
      : handedIn !== undefined
        ? await onDisk(component, "folder", absolute(handedIn))
        : await fetched(component, options.cache);
  return resolved;
}
