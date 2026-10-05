import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative as relativePath, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { type Files, relative } from "../files.js";

/** Files in a local folder, named by the folder's file IRI unless given another. */
export class FolderFiles implements Files {
  readonly iri: string;

  constructor(
    readonly folder: string,
    iri?: string,
  ) {
    this.iri = iri ?? `${pathToFileURL(folder).href.replace(/\/?$/, "/")}`;
  }

  #local(pathOrIri: string): string {
    return join(this.folder, ...relative(this, pathOrIri).split("/"));
  }

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(this.#local(pathOrIri)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    const local = this.#local(pathOrIri);
    await mkdir(dirname(local), { recursive: true });
    await writeFile(local, bytes);
  }

  async list(folder: string): Promise<string[]> {
    const root = this.#local(folder);
    let entries;
    try {
      entries = await readdir(root, { recursive: true, withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        relativePath(this.folder, join(entry.parentPath, entry.name))
          .split(sep)
          .join("/"),
      )
      .sort();
  }
}
