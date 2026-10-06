import { type Files, relative } from "../files.js";

const STORE = "files";

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/**
 * The files of one IndexedDB database, in its one object store, `files`, by path. A database that does not exist is
 * created empty.
 */
export class IndexedDbFiles implements Files {
  readonly #database: IDBDatabase;

  private constructor(database: IDBDatabase, iri: string) {
    this.#database = database;
    this.iri = iri;
  }

  readonly iri: string;

  static async open(name: string, iri: string): Promise<IndexedDbFiles> {
    const opening = indexedDB.open(name, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(STORE);
    return new IndexedDbFiles(await settled(opening), iri);
  }

  /** Deletes the database, once every connection to it is closed. */
  static async delete(name: string): Promise<void> {
    const deleting = indexedDB.deleteDatabase(name);
    await new Promise<void>((resolve, reject) => {
      deleting.onsuccess = () => resolve();
      deleting.onerror = () => reject(deleting.error);
      deleting.onblocked = () =>
        reject(new Error(`the database ${name} is still open`));
    });
  }

  /** The same database's files, named by another IRI. */
  at(iri: string): IndexedDbFiles {
    return new IndexedDbFiles(this.#database, iri);
  }

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const path = relative(this, pathOrIri);
    const stored = await settled(
      this.#database.transaction(STORE).objectStore(STORE).get(path),
    );
    return stored instanceof Uint8Array ? stored : undefined;
  }

  write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    return this.writeAll([[pathOrIri, bytes]]);
  }

  /** Writes every file, or, when one fails, none. */
  async writeAll(
    files: Iterable<readonly [string, Uint8Array]>,
  ): Promise<void> {
    const transaction = this.#database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const [pathOrIri, bytes] of files)
      store.put(bytes.slice(), relative(this, pathOrIri));
    await done(transaction);
  }

  async list(folder: string): Promise<string[]> {
    const prefix = relative(this, folder).replace(/\/$/, "");
    const range =
      prefix === ""
        ? undefined
        : IDBKeyRange.bound(`${prefix}/`, `${prefix}0`, false, true);
    const keys = await settled(
      this.#database.transaction(STORE).objectStore(STORE).getAllKeys(range),
    );
    return keys.map(String);
  }

  close(): void {
    this.#database.close();
  }
}
