import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative as relativePath, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { type Files, relative } from "../files.js";

/** Whether a read failed because no file, or no folder, is at the path: a folder read as a file, a file as a folder. */
function absent(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}

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
      if (absent(error)) return undefined;
      throw error;
    }
  }

  async write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    const local = this.#local(pathOrIri);
    await mkdir(dirname(local), { recursive: true });
    await writeFile(local, bytes);
  }

  async list(folder: string): Promise<string[]> {
    let files;
    try {
      files = await filesUnder(this.#local(folder));
    } catch (error) {
      if (absent(error)) return [];
      throw error;
    }
    return files
      .map((file) => relativePath(this.folder, file).split(sep).join("/"))
      .sort();
  }
}

/** Every file under the folder, its subfolders read in parallel: on Windows a third of a recursive `readdir`'s time. */
async function filesUnder(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const found = await Promise.all(
    entries.map((entry) => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) return filesUnder(path);
      return entry.isFile() ? [path] : [];
    }),
  );
  return found.flat();
}
