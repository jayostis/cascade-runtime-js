const isPath = (id: string): boolean =>
  !id.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(id);

/**
 * A crate's JSON, each path `@id` decoded. RO-Crate 1.2 writes a file's `@id` as a URI path, so a space of a file's name
 * is `%20`; what a runtime looks a file up by is the name, so the `@id` of a file and of every reference to one is
 * decoded as it is read. Only a path `@id` is decoded: one with no URI scheme that does not start with `#`. An absolute
 * URL and a `#fragment` read as written, and so does a path that is not percent-encoded, as one of an older crate.
 */
export function parseCrate<T>(text: string): T {
  return JSON.parse(text, (key, value: unknown) => {
    if (key !== "@id" || typeof value !== "string" || !isPath(value))
      return value;
    try {
      return decodeURIComponent(value);
    } catch {
      throw new Error(`the crate's @id ${value} is not a percent-encoded path`);
    }
  }) as T;
}
