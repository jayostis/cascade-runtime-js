import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  asArray,
  ccdaRecords,
  fhirFields,
  fresh,
  jsonRecords,
  lineAt,
  type Source,
} from "../citations.js";

/** The downloads in `folder`, cited by file and line or by FHIR resource; a path out of the folder names nothing. */
export function downloadsSource(folder: string): Source {
  const root = resolve(folder);
  const read = new Map<string, Promise<string | undefined>>();
  const fileText = (file: string) => {
    const path = resolve(root, file);
    const inside = relative(root, path);
    if (inside.startsWith("..") || isAbsolute(inside))
      return Promise.resolve(undefined);
    let found = read.get(path);
    if (found === undefined) {
      found = readFile(path, "utf8").catch(() => undefined);
      read.set(path, found);
    }
    return found;
  };
  return {
    async at(cite) {
      if (!("file" in cite)) return undefined;
      const text = await fileText(cite.file);
      if (text === undefined) return undefined;
      const source = [cite.file];
      const json = /^\s*[{[]/.test(text);
      if ("resource" in cite) {
        if (!json) return undefined;
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return undefined;
        }
        const named = (it: unknown) => {
          const { resourceType, id } = (it ?? {}) as Record<string, unknown>;
          return `${String(resourceType)}/${String(id)}` === cite.resource;
        };
        const resource = named(parsed)
          ? parsed
          : asArray((parsed as { entry?: unknown }).entry)
              .map((it) => (it as { resource?: unknown }).resource)
              .find(named);
        return resource === undefined
          ? undefined
          : {
              fields: fhirFields(resource as Record<string, unknown>),
              source,
            };
      }
      const starts = [0];
      for (
        let at = text.indexOf("\n");
        at !== -1;
        at = text.indexOf("\n", at + 1)
      )
        starts.push(at + 1);
      if (
        !Number.isInteger(cite.line) ||
        cite.line < 1 ||
        cite.line > starts.length
      )
        return undefined;
      const from = starts[cite.line - 1]!;
      const to =
        cite.line < starts.length ? starts[cite.line]! - 1 : text.length;
      const records = json ? jsonRecords(text) : ccdaRecords(text);
      const others = records
        .map((it) => ({ line: lineAt(starts, it.from), fields: it.fields }))
        .sort((a, b) => a.line - b.line);
      const holding = records
        .filter((it) => it.from <= to && it.to >= from)
        .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
      if (holding !== undefined)
        return { fields: holding.fields, source, others };
      const line = fresh();
      line.text.push(text.slice(from, to).replace(/<[^>]+>/g, " "));
      return { fields: line, source, others };
    },
  };
}
