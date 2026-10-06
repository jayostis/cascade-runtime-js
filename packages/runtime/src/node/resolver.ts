import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join, resolve as absolute } from "node:path";
import { type Followed, repositoryName, treeIri } from "../config.js";
import { checkout, git } from "./git.js";

export type Source = "sibling" | "folder" | "fetched";

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

/**
 * The folder a component is read from, first match wins: a sibling checkout as it is on disk; a folder handed in;
 * otherwise the head of its default branch as it is now, fetched. The run says which.
 */
export async function resolve(
  component: Followed,
  options: ResolverOptions,
): Promise<Resolved> {
  const sibling = siblingIn(options.siblingsIn, repositoryName(component));
  const handedIn = options.folders?.get(component.repository);
  const resolved =
    sibling !== undefined
      ? await onDisk(component, "sibling", sibling)
      : handedIn !== undefined
        ? await onDisk(component, "folder", absolute(handedIn))
        : await fetched(component, options.cache);
  options.log?.(said(resolved));
  return resolved;
}
