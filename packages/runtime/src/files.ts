/**
 * Reads and writes bytes under one root, by a path relative to it or by an IRI under the root's IRI. A path uses
 * forward slashes and never starts with one.
 */
export interface Files {
  /** The root's IRI, ending in a slash: each file's IRI is this followed by its path. */
  readonly iri: string;
  /** The file's bytes, or undefined when there is no such file. */
  read(pathOrIri: string): Promise<Uint8Array | undefined>;
  write(pathOrIri: string, bytes: Uint8Array): Promise<void>;
  /** The path of every file under the folder, the whole root when it is "", sorted. */
  list(folder: string): Promise<string[]>;
}

/** The path an IRI under the root's IRI names, or the path itself; anything else is refused. */
export function relative(files: Pick<Files, "iri">, pathOrIri: string): string {
  const path = pathOrIri.startsWith(files.iri)
    ? pathOrIri.slice(files.iri.length)
    : pathOrIri;
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(path) ||
    path.startsWith("/") ||
    path.split("/").some((part) => part === "..")
  ) {
    throw new Error(`${pathOrIri} is not a path under ${files.iri}`);
  }
  return path;
}

/** The folder the file at the path is in, "" at the root, without a trailing slash. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

export async function readText(
  files: Files,
  pathOrIri: string,
): Promise<string> {
  const bytes = await files.read(pathOrIri);
  if (bytes === undefined)
    throw new Error(`${files.iri}${relative(files, pathOrIri)} does not exist`);
  return new TextDecoder().decode(bytes);
}

export function under(folder: string, path: string): boolean {
  return (
    folder === "" ||
    path.startsWith(folder.endsWith("/") ? folder : `${folder}/`)
  );
}

export class MemoryFiles implements Files {
  readonly #files = new Map<string, Uint8Array>();

  constructor(readonly iri: string) {}

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    return this.#files.get(relative(this, pathOrIri))?.slice();
  }

  async write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    this.#files.set(relative(this, pathOrIri), bytes.slice());
  }

  async list(folder: string): Promise<string[]> {
    const prefix = relative(this, folder);
    return [...this.#files.keys()].filter((path) => under(prefix, path)).sort();
  }
}

/** What a folder served over HTTP lists of itself: every path under it but this file, sorted, as a JSON array. */
export const FILES_JSON = "files.json";
