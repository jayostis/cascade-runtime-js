// The mechanical half of an answer's evidence: a cited pod entry followed to the records merged into it, their
// revisions and the documents they came in; a cited file to its passage and its download's date. Lookups only: what
// links one record to another is what the agent wrote, or what the pod joined when it was built.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Cite } from "./citations.js";
import type { EntryProvenance, Passage } from "./results.js";

interface Triple {
  readonly s: string;
  readonly p: string;
  readonly o?: string;
  readonly literal?: string;
}

const TRIPLE = /^(\S+) <([^>]+)> (.+) \.\s*$/;
const LITERAL = /^"((?:[^"\\]|\\.)*)"(?:\^\^<[^>]+>|@\S+)?$/;
const local = (iri: string) => iri.replace(/^.*[#/]/, "");

async function turtleFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((it) => it.isFile() && it.name.endsWith(".ttl"))
    .map((it) => join(it.parentPath, it.name));
}

/**
 * A pod's entries, each followed through its own triples: `mergedFrom` to its member records, `revisionOf` to their
 * revisions, `wasDerivedFrom` to the source document, its `retrievedOn`, server and author. A pod writes one triple a
 * line; a blank node is its file's own, and `<#…>` is its file's IRI.
 */
export async function podProvenance(
  pod: string,
): Promise<(entry: string) => EntryProvenance | undefined> {
  const manifest = join(pod, "manifest.ttl");
  const base = existsSync(manifest)
    ? /^<(pod:\/\/[^/]+\/)/.exec(await readFile(manifest, "utf8"))?.[1]
    : undefined;
  const bySubject = new Map<string, Triple[]>();
  const byObject = new Map<string, Triple[]>();
  for (const path of existsSync(pod) ? await turtleFiles(pod) : []) {
    const file = relative(pod, path).replaceAll("\\", "/");
    const name = (term: string) =>
      term.startsWith("<#")
        ? `${base ?? ""}${file}${term.slice(1, -1)}`
        : term.startsWith("_:")
          ? `${file}${term}`
          : term.replace(/^<|>$/g, "");
    for (const line of (await readFile(path, "utf8")).split("\n")) {
      const match = TRIPLE.exec(line);
      if (match === null) continue;
      const [, s, p, o] = match as unknown as [string, string, string, string];
      const literal = LITERAL.exec(o)?.[1]?.replace(/\\"/g, '"');
      const triple: Triple = {
        s: name(s),
        p: local(p),
        ...(literal === undefined ? { o: name(o) } : { literal }),
      };
      (
        bySubject.get(triple.s) ?? bySubject.set(triple.s, []).get(triple.s)!
      ).push(triple);
      if (triple.o !== undefined)
        (
          byObject.get(triple.o) ?? byObject.set(triple.o, []).get(triple.o)!
        ).push(triple);
    }
  }
  const of = (s: string) => bySubject.get(s) ?? [];
  const value = (s: string, p: string) =>
    of(s).find((it) => it.p === p && it.literal !== undefined)?.literal;
  const node = (s: string, p: string) => of(s).find((it) => it.p === p)?.o;
  const nodes = (s: string, p: string) =>
    of(s)
      .filter((it) => it.p === p && it.o !== undefined)
      .map((it) => it.o!);
  const SKIP = new Set([
    "type",
    "leadMember",
    "mergedFrom",
    "statusFrom",
    "memberCurrentValues",
    "valuesOfMember",
  ]);
  const document = (iri: string) => {
    const attribution = node(iri, "qualifiedAttribution");
    const agent =
      attribution === undefined ? undefined : node(attribution, "agent");
    return {
      iri,
      ...pick({
        retrievedOn: value(iri, "retrievedOn"),
        author: agent === undefined ? undefined : value(agent, "label"),
        server: value(iri, "serverBaseUrl"),
        answeredAsOf: value(iri, "answeredAsOf"),
      }),
    };
  };
  return (entry) => {
    const type = node(entry, "type");
    if (type === undefined) return undefined;
    return {
      entry,
      type: local(type),
      fields: of(entry)
        .filter((it) => !SKIP.has(it.p))
        .map((it) => [it.p, it.literal ?? local(it.o ?? "")] as const),
      members: nodes(entry, "mergedFrom").map((record) => ({
        record,
        ...pick({
          sourceId: value(record, "sourceRecordId"),
          sourceUrl: node(record, "sourceUrl"),
        }),
        revisions: (byObject.get(record) ?? [])
          .filter((it) => it.p === "revisionOf")
          .map(({ s: revision }) => {
            const selector = node(revision, "hasSelector");
            const from =
              node(revision, "wasDerivedFrom") ?? node(revision, "hasSource");
            return {
              revision,
              ...pick({
                version: value(revision, "version"),
                observedAsOf: value(revision, "observedAsOf"),
                selector:
                  selector === undefined ? undefined : value(selector, "value"),
              }),
              ...(from === undefined ? {} : { document: document(from) }),
            };
          })
          .sort((a, b) =>
            (a.observedAsOf ?? "").localeCompare(b.observedAsOf ?? ""),
          ),
      })),
    };
  };
}

function pick<T extends Record<string, string | undefined>>(
  values: T,
): { [K in keyof T]?: string } {
  return Object.fromEntries(
    Object.entries(values).filter(([, it]) => it !== undefined),
  ) as { [K in keyof T]?: string };
}

const RESOURCE = /^\s*"resource": \{\s*$/;

/** The line a JSON value opening on `start` closes on, by its braces outside strings. */
function closing(lines: readonly string[], start: number): number {
  let depth = 0;
  for (let at = start; at < lines.length; at++) {
    for (const char of lines[at]!.replace(/"(?:[^"\\]|\\.)*"/g, '""'))
      if (char === "{") depth++;
      else if (char === "}") depth--;
    if (depth === 0) return at;
  }
  return lines.length - 1;
}

/**
 * The passage a grab-bag citation names: for a FHIR resource, the lines it spans and its JSON pointer; for a line,
 * that line. With the download's source and date from its folder's `pull.json`, when it has one.
 */
export async function passageOf(
  downloads: string,
  cite: Cite,
): Promise<Passage | undefined> {
  if (!("file" in cite)) return undefined;
  const root = resolve(downloads);
  const path = resolve(root, cite.file);
  const inside = relative(root, path);
  if (inside.startsWith("..") || isAbsolute(inside) || !existsSync(path))
    return undefined;
  const text = await readFile(path, "utf8");
  const lines = text.split("\n");
  const pull = join(root, cite.file.split("/")[0]!, "pull.json");
  let download: Passage["download"];
  if (existsSync(pull)) {
    const { source, retrievedAt } = JSON.parse(
      await readFile(pull, "utf8"),
    ) as { source?: string; retrievedAt?: string };
    download = pick({ source, retrievedAt });
  }
  const passage = (from: number, to: number, rest: Partial<Passage>) => ({
    file: cite.file,
    ...rest,
    from,
    to,
    text: lines.slice(from - 1, to).join("\n"),
    ...(download === undefined ? {} : { download }),
  });
  if ("line" in cite)
    return Number.isInteger(cite.line) &&
      cite.line >= 1 &&
      cite.line <= lines.length
      ? passage(cite.line, cite.line, { line: cite.line })
      : undefined;
  let parsed: { resourceType?: string; id?: string; entry?: unknown };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return undefined;
  }
  if (`${parsed.resourceType}/${parsed.id}` === cite.resource)
    return passage(1, lines.length, { resource: cite.resource, pointer: "" });
  const entries = Array.isArray(parsed.entry) ? parsed.entry : [];
  const at = entries.findIndex((it) => {
    const { resourceType, id } = ((it as { resource?: unknown }).resource ??
      {}) as { resourceType?: string; id?: string };
    return `${resourceType}/${id}` === cite.resource;
  });
  if (at === -1) return undefined;
  const opening = lines
    .map((line, n) => (RESOURCE.test(line) ? n : -1))
    .filter((n) => n !== -1)[at];
  if (opening === undefined) return undefined;
  return passage(opening + 1, closing(lines, opening) + 1, {
    resource: cite.resource,
    pointer: `/entry/${at}/resource`,
  });
}
