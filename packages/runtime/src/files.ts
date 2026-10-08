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
  /**
   * Writes every file, or, when one fails, none: where the host has transactions, one of them. Files without it are
   * written one by one, and a failure leaves those before it written.
   */
  writeAll?(files: Iterable<readonly [string, Uint8Array]>): Promise<void>;
  /** The path of every file under the folder, the whole root when it is "", sorted. */
  list(folder: string): Promise<string[]>;
}

/** Writes the files in one `writeAll` where the files have one, else one by one, in the order given. */
export async function writeAll(
  files: Files,
  written: readonly (readonly [string, Uint8Array])[],
): Promise<void> {
  if (written.length === 0) return;
  if (files.writeAll !== undefined) return files.writeAll(written);
  for (const [path, bytes] of written) await files.write(path, bytes);
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

/**
 * An export or a download as the files an app holds, each by its path: a folder or a file a person picked, or bytes
 * the app fetched. Its one top-level name is the export, as a path names one folder or file.
 */
export type Exported = ReadonlyMap<string, Blob | Uint8Array>;

const EXPORTED = "urn:cascade:exported/";

/** Each top-level name the export holds, sorted, once each; one is the export's name. A key that is no path throws. */
export function exportedNames(exported: Exported): string[] {
  const names = new Set<string>();
  for (const path of exported.keys()) {
    const [top = ""] = path.split("/");
    let isPath = top !== "";
    try {
      relative({ iri: EXPORTED }, path);
    } catch {
      isPath = false;
    }
    if (!isPath) throw new Error(`the export holds ${path}, which is no path`);
    names.add(top);
  }
  return [...names].sort();
}

/** The files of an export an app holds, never written; a `Blob` is read only when its file is. */
export class ExportedFiles implements Files {
  readonly iri = EXPORTED;
  readonly #files: Exported;
  readonly #name: string;

  /** The export, its keys paths as `exportedNames` takes them, named `name` in what it says. */
  constructor(exported: Exported, name: string) {
    this.#name = name;
    this.#files = exported;
  }

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const file = this.#files.get(relative(this, pathOrIri));
    if (file === undefined) return undefined;
    return ArrayBuffer.isView(file)
      ? new Uint8Array(file)
      : new Uint8Array(await file.arrayBuffer());
  }

  async write(pathOrIri: string): Promise<void> {
    throw new Error(
      `${this.#name} is held by the app and never written: ${pathOrIri}`,
    );
  }

  async list(folder: string): Promise<string[]> {
    const prefix = relative(this, folder);
    return [...this.#files.keys()].filter((path) => under(prefix, path)).sort();
  }
}

/** What a folder served over HTTP lists of itself: every path under it but this file, sorted, as a JSON array. */
export const FILES_JSON = "files.json";
