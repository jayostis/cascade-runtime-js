import { FILES_JSON, type Files, relative, under } from "../files.js";
import { type FolderPack, unpackFolder } from "../folder-pack.js";

interface Unpacked {
  readonly paths: readonly string[];
  readonly files: ReadonlyMap<string, Uint8Array>;
}

/** A promise kept until it fails, so a failed fetch is tried again. */
function kept<T>(
  get: () => Promise<T> | undefined,
  set: (promise: Promise<T> | undefined) => void,
  make: () => Promise<T>,
): Promise<T> {
  const known = get();
  if (known !== undefined) return known;
  const made = make();
  set(made);
  made.catch(() => {
    if (get() === made) set(undefined);
  });
  return made;
}

/**
 * A folder served over HTTP, read by `fetch`, each file once: listed by its `files.json`, or by its `FolderPack` where
 * one is served; never written.
 */
export class FetchedFiles implements Files {
  readonly #url: string;
  readonly #pack: string | undefined;
  #unpacked: Promise<Unpacked | undefined> | undefined;
  #listed: Promise<string[]> | undefined;
  readonly #fetchedOnce = new Map<string, Promise<Uint8Array | undefined>>();

  /**
   * The folder at `url`, ending in a slash, whose files are named under `iri`; `options.pack` is the URL of its
   * `FolderPack`, read in its place when it is served.
   */
  constructor(url: string, iri: string = url, options: { pack?: string } = {}) {
    this.#url = url;
    this.iri = iri;
    this.#pack = options.pack;
  }

  readonly iri: string;

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const path = relative(this, pathOrIri);
    const bytes =
      (await this.#unpacking())?.files.get(path) ??
      (await kept(
        () => this.#fetchedOnce.get(path),
        (promise) =>
          promise === undefined
            ? this.#fetchedOnce.delete(path)
            : this.#fetchedOnce.set(path, promise),
        async () => {
          const response = await this.#fetched(path);
          return response.status === 404
            ? undefined
            : new Uint8Array(await response.arrayBuffer());
        },
      ));
    return bytes?.slice();
  }

  async write(pathOrIri: string): Promise<void> {
    throw new Error(
      `${this.#url} is read over HTTP and is never written: ${pathOrIri}`,
    );
  }

  async list(folder: string): Promise<string[]> {
    const prefix = relative(this, folder);
    return (await this.#listing()).filter((path) => under(prefix, path));
  }

  #unpacking(): Promise<Unpacked | undefined> {
    const pack = this.#pack;
    if (pack === undefined) return Promise.resolve(undefined);
    return kept(
      () => this.#unpacked,
      (promise) => (this.#unpacked = promise),
      async () => {
        const response = await fetch(pack);
        if (response.status === 404) return undefined;
        if (!response.ok)
          throw new Error(
            `${pack} answered ${response.status} ${response.statusText}`,
          );
        const read = (await response.json()) as FolderPack;
        if (!Array.isArray(read.paths))
          throw new Error(`${pack} is no pack of a folder`);
        return { paths: read.paths, files: unpackFolder(read) };
      },
    );
  }

  #listing(): Promise<string[]> {
    return kept(
      () => this.#listed,
      (promise) => (this.#listed = promise),
      async () => {
        const listed =
          (await this.#unpacking())?.paths ?? (await this.#listedByFilesJson());
        return listed.filter((path) => path !== FILES_JSON).sort();
      },
    );
  }

  async #listedByFilesJson(): Promise<string[]> {
    const response = await this.#fetched(FILES_JSON);
    if (response.status === 404)
      throw new Error(`${this.#url} has no ${FILES_JSON}`);
    const listed = (await response.json()) as unknown;
    if (
      !Array.isArray(listed) ||
      listed.some((path) => typeof path !== "string")
    )
      throw new Error(
        `${this.#url}${FILES_JSON} is no list of paths: ${JSON.stringify(listed).slice(0, 80)}`,
      );
    return listed as string[];
  }

  async #fetched(path: string): Promise<Response> {
    const url = new URL(
      path.split("/").map(encodeURIComponent).join("/"),
      this.#url,
    );
    const response = await fetch(url);
    if (!response.ok && response.status !== 404)
      throw new Error(
        `${url.href} answered ${response.status} ${response.statusText}`,
      );
    return response;
  }
}
