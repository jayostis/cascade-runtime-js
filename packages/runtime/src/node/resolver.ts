import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join, resolve as absolute } from "node:path";
import { type Pin, repositoryName, treeIri } from "../config.js";
import { checkout, git } from "./git.js";

export type Source = "sibling" | "folder" | "pin";

export interface Resolved {
  readonly pin: Pin;
  readonly source: Source;
  readonly folder: string;
  /** The commit the folder is at, when it is a git checkout. */
  readonly commit?: string;
  readonly uncommitted?: number;
  /** The IRI the component is named by: its tree at the commit it is at, or at the pin when that is unknown. */
  readonly iri: string;
}

export interface ResolverOptions {
  /** The folder a sibling checkout of each repository would be in, under the repository's name. */
  readonly siblingsIn: string;
  /** A folder for each repository, by its URL, as the compatibility tooling or CI hands them in. */
  readonly folders?: ReadonlyMap<string, string>;
  /** Where a pin is fetched to, a folder per repository and commit. */
  readonly cache: string;
  readonly log?: (line: string) => void;
}

function short(commit: string): string {
  return commit.slice(0, 12);
}

/** One line saying which version of the component a run uses. */
export function said(resolved: Resolved): string {
  const name = repositoryName(resolved.pin);
  if (resolved.source === "pin") {
    return `${name}: the pin, ${short(resolved.pin.commit)}, fetched into ${resolved.folder}`;
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
  const pinned =
    resolved.commit === resolved.pin.commit
      ? "the pin"
      : `pinned at ${short(resolved.pin.commit)}`;
  return `${name}: ${where} ${resolved.folder}, at ${short(resolved.commit)} (${pinned}) ${changes}`;
}

async function onDisk(
  pin: Pin,
  source: Source,
  folder: string,
): Promise<Resolved> {
  const found = await checkout(folder);
  return {
    pin,
    source,
    folder,
    ...found,
    iri: treeIri(pin, found?.commit ?? pin.commit),
  };
}

async function atPin(folder: string, pin: Pin): Promise<boolean> {
  return (await checkout(folder))?.commit === pin.commit;
}

async function fetched(pin: Pin, cache: string): Promise<Resolved> {
  const folder = absolute(cache, repositoryName(pin), pin.commit);
  if (!(await atPin(folder, pin))) {
    await mkdir(dirname(folder), { recursive: true });
    const partial = await mkdtemp(`${folder}.partial-`);
    await git(partial, "init", "--quiet");
    await git(
      partial,
      "fetch",
      "--quiet",
      "--depth",
      "1",
      pin.repository,
      pin.commit,
    );
    await git(
      partial,
      "-c",
      "advice.detachedHead=false",
      "checkout",
      "--quiet",
      "--detach",
      "FETCH_HEAD",
    );
    if (existsSync(folder) && !(await atPin(folder, pin))) {
      await rm(folder, { recursive: true, force: true });
    }
    try {
      await rename(partial, folder);
    } catch (error) {
      // Another run fetching the same pin may have put it in place first.
      if (!(await atPin(folder, pin))) throw error;
    }
    await rm(partial, { recursive: true, force: true });
  }
  return {
    pin,
    source: "pin",
    folder,
    commit: pin.commit,
    uncommitted: 0,
    iri: treeIri(pin, pin.commit),
  };
}

/**
 * The folder a component is read from, first match wins: a sibling checkout as it is on disk; a folder handed in;
 * otherwise the pin, fetched at its commit. The run says which.
 */
export async function resolve(
  pin: Pin,
  options: ResolverOptions,
): Promise<Resolved> {
  const sibling = join(absolute(options.siblingsIn), repositoryName(pin));
  const handedIn = options.folders?.get(pin.repository);
  const resolved = existsSync(sibling)
    ? await onDisk(pin, "sibling", sibling)
    : handedIn !== undefined
      ? await onDisk(pin, "folder", absolute(handedIn))
      : await fetched(pin, options.cache);
  options.log?.(said(resolved));
  return resolved;
}
