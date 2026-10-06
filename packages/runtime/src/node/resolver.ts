import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join, resolve as absolute } from "node:path";
import {
  type Component,
  type Pin,
  repositoryName,
  treeIri,
} from "../config.js";
import { checkout, git } from "./git.js";

export type Source = "sibling" | "folder" | "fetched";

export interface Resolved {
  readonly component: Component;
  readonly source: Source;
  readonly folder: string;
  /** The commit the folder is at, when it is a git checkout. */
  readonly commit?: string;
  readonly uncommitted?: number;
  /** The commit the folder is at, or else what the component names it by: its pin's commit or its branch. */
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

function pinned(component: Component): component is Pin {
  return "commit" in component;
}

/** One line saying which version of the component a run uses. */
export function said(resolved: Resolved): string {
  const { component } = resolved;
  const name = repositoryName(component);
  if (resolved.source === "fetched") {
    const which = pinned(component)
      ? `the pin, ${short(component.commit)}`
      : `${component.branch} at ${short(resolved.version)}`;
    return `${name}: ${which}, fetched into ${resolved.folder}`;
  }
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
  const against = !pinned(component)
    ? ""
    : resolved.commit === component.commit
      ? " (the pin)"
      : ` (pinned at ${short(component.commit)})`;
  return `${name}: ${where} ${resolved.folder}, at ${short(resolved.commit)}${against} ${changes}`;
}

async function onDisk(
  component: Component,
  source: Source,
  folder: string,
): Promise<Resolved> {
  const found = await checkout(folder);
  const version =
    found?.commit ?? (pinned(component) ? component.commit : component.branch);
  return {
    component,
    source,
    folder,
    ...found,
    version,
    iri: treeIri(component, version),
  };
}

/** The commit at the head of the branch, as the repository has it now. */
export async function headOf(
  repository: string,
  branch: string,
  at: string,
): Promise<string> {
  await mkdir(at, { recursive: true });
  const head = (
    await git(at, "ls-remote", repository, `refs/heads/${branch}`)
  ).split("\t")[0];
  if (head === undefined || !/^[0-9a-f]{40}$/.test(head))
    throw new Error(`${repository} has no branch ${branch}`);
  return head;
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

async function fetched(component: Component, cache: string): Promise<Resolved> {
  const commit = pinned(component)
    ? component.commit
    : await headOf(component.repository, component.branch, cache);
  return {
    component,
    source: "fetched",
    folder: await fetchedAt(component.repository, commit, cache),
    commit,
    uncommitted: 0,
    version: commit,
    iri: treeIri(component, commit),
  };
}

/**
 * The folder a component is read from, first match wins: a sibling checkout as it is on disk; a folder handed in;
 * otherwise the repository fetched at its pin's commit, or at its branch's head as it is now. The run says which.
 */
export async function resolve(
  component: Component,
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
