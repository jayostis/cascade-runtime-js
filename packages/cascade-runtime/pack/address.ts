import { readFileSync } from "node:fs";

interface Manifest {
  readonly name: string;
  readonly repository: { readonly url: string };
}

const manifest = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as Manifest;

/** The version a build of this repository's commit is packed at: no real version number, as the Bridge's builds have none. */
export function packageVersion(commit: string): string {
  return `0.0.0-commit-${commit}`;
}

/** The file `npm pack` writes for a build of the commit. */
export function tarballName(commit: string): string {
  return `${manifest.name}-${packageVersion(commit)}.tgz`;
}

/** Where the pre-release of the commit's build serves its tarball, whether or not that release exists yet. */
export function tarballAddress(commit: string): string {
  const repository = manifest.repository.url
    .replace(/^git\+/, "")
    .replace(/\.git$/, "");
  return `${repository}/releases/download/build-${commit}/${tarballName(commit)}`;
}
