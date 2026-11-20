import type { Files } from "./files.js";
import type { Layout } from "./layout.js";

/** Not yet: the host's files as they are, as a runtime without the reader sees a pod. */
export class ArchivedFiles implements Files {
  readonly #files: Files;

  constructor(
    files: Files,
    readonly folder: string,
  ) {
    this.#files = files;
  }

  get iri(): string {
    return this.#files.iri;
  }

  read(path: string) {
    return this.#files.read(path);
  }

  async readRange(path: string, start: number, length: number) {
    return this.#files.readRange?.(path, start, length);
  }

  write(path: string, bytes: Uint8Array) {
    return this.#files.write(path, bytes);
  }

  async writeAll(files: Iterable<readonly [string, Uint8Array]>) {
    for (const [path, bytes] of files) await this.#files.write(path, bytes);
  }

  async remove(paths: readonly string[]) {
    await this.#files.remove?.(paths);
  }

  list(folder: string) {
    return this.#files.list(folder);
  }
}

export function archivedFiles(files: Files, layout: Layout): Files {
  return layout.archivesFolder === undefined
    ? files
    : new ArchivedFiles(files, layout.archivesFolder);
}
