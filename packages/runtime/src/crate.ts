/**
 * A crate's JSON, each `@id` decoded. RO-Crate 1.2 writes a file's `@id` as a URI path, so a space of a file's name is
 * `%20`; what a runtime looks a file up by is the name, so the `@id` of an entity and of every reference to one is
 * decoded as it is read. An `@id` that is not percent-encoded, as one of an older crate, reads as it is written.
 */
export function parseCrate<T>(text: string): T {
  return JSON.parse(text, (key, value: unknown) => {
    if (key !== "@id" || typeof value !== "string") return value;
    try {
      return decodeURIComponent(value);
    } catch {
      throw new Error(`the crate's @id ${value} is not a percent-encoded path`);
    }
  }) as T;
}
