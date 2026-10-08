import { FILES_JSON, type Files, relative, under } from "../files.js";
import { type FolderPack, isFolderPack, unpackFile } from "../folder-pack.js";

/**
 * A folder served over HTTP, read by `fetch`, each file once: listed by its `files.json`, or by its `FolderPack` where
 * one is served; never written. The first read fetches its file alone, so describing an adapter costs one small request;
 * the pack is fetched from the second read or the first list on.
 */
export class FetchedFiles implements Files {
  readonly #url: string;
  readonly #pack: string | undefined;
  #readBefore = false;
  #packed: Promise<FolderPack | undefined> | undefined;
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
    const first = !this.#readBefore && this.#packed === undefined;
    this.#readBefore = true;
    const pack = first ? undefined : await this.#packing();
    return (
      (pack && unpackFile(pack, path)) ??
      (await this.#fetchedFile(path))?.slice()
    );
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

  #fetchedFile(path: string): Promise<Uint8Array | undefined> {
    let fetched = this.#fetchedOnce.get(path);
    if (fetched === undefined) {
      fetched = this.#fetched(path)
        .then(async (response) =>
          response.status === 404
            ? undefined
            : new Uint8Array(await response.arrayBuffer()),
        )
        .catch((error: unknown) => {
          this.#fetchedOnce.delete(path);
          throw error;
        });
      this.#fetchedOnce.set(path, fetched);
    }
    return fetched;
  }

  #packing(): Promise<FolderPack | undefined> {
    const pack = this.#pack;
    if (pack === undefined) return Promise.resolve(undefined);
    this.#packed ??= (async () => {
      const response = await fetch(pack);
      if (response.status === 404) return undefined;
      if (!response.ok)
        throw new Error(
          `${pack} answered ${response.status} ${response.statusText}`,
        );
      const read = (await response.json()) as unknown;
      if (!isFolderPack(read))
        throw new Error(`${pack} is no pack of a folder`);
      return read;
    })().catch((error: unknown) => {
      this.#packed = undefined;
      throw error;
    });
    return this.#packed;
  }

  #listing(): Promise<string[]> {
    this.#listed ??= (async () => {
      const listed =
        (await this.#packing())?.paths ?? (await this.#listedByFilesJson());
      return listed.filter((path) => path !== FILES_JSON).sort();
    })().catch((error: unknown) => {
      this.#listed = undefined;
      throw error;
    });
    return this.#listed;
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
