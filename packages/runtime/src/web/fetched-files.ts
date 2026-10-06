import { FILES_JSON, type Files, relative, under } from "../files.js";

/** A folder served over HTTP, read by `fetch`: listed by its `files.json`, never written. */
export class FetchedFiles implements Files {
  readonly #url: string;
  #listed: Promise<string[]> | undefined;

  /** The folder at `url`, ending in a slash, whose files are named under `iri`. */
  constructor(url: string, iri: string = url) {
    this.#url = url;
    this.iri = iri;
  }

  readonly iri: string;

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const response = await this.#fetched(relative(this, pathOrIri));
    if (response.status === 404) return undefined;
    return new Uint8Array(await response.arrayBuffer());
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

  #listing(): Promise<string[]> {
    if (this.#listed === undefined) {
      const listing = (async () => {
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
        return (listed as string[])
          .filter((path) => path !== FILES_JSON)
          .sort();
      })();
      this.#listed = listing;
      listing.catch(() => {
        if (this.#listed === listing) this.#listed = undefined;
      });
    }
    return this.#listed;
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
