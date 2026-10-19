import {
  type Files,
  type Graph,
  type References,
  RULE_LIST,
  relative,
  type Term,
  type Triple,
} from "@cascade-runtime/runtime";
import { INDEX, REC, SHIPS_WITH, TABLE_KIND } from "./constants.js";
import type { Described } from "./types.js";

/** The version each series of the tables ships with, the rule list's among them, sorted. */
export function shipped(references: References): string[] {
  return references.index
    .match(undefined, `${REC}shipsWith`)
    .map(([, , version]) => version.value)
    .sort();
}

/** The version each series of a kind ships with, in the references: what a pod opened with them is given, sorted. */
export function currentOf(references: References): string[] {
  return currentIn(references.index);
}

/** The version each series of a kind ships with in the index, sorted: the rule list's series has no kind. */
export function currentIn(index: Graph): string[] {
  return index
    .match(undefined, SHIPS_WITH)
    .filter(([series]) => ofAKind(index, series))
    .map(([, , version]) => version.value)
    .sort();
}

export function ofAKind(index: Graph, series: Term): boolean {
  return index.objects(series, TABLE_KIND).length > 0;
}

/** The series the index says ship with a version, the rule list's left out. */
export function seriesOfAKind(index: Graph): Term[] {
  return index.subjects(SHIPS_WITH).filter((series) => ofAKind(index, series));
}

export function described(
  references: References,
  version: string,
  rows: Triple[],
): Described {
  return {
    version,
    rows,
    description: [
      ...references.description(version),
      ...references.description(references.seriesOf(version) ?? ""),
    ],
  };
}

/** One file of the rule list and the store as one folder, as `References` reads it: the store first. */
export class TablesFiles implements Files {
  readonly iri: string;

  constructor(
    readonly store: Files,
    readonly vocabulary: Files,
  ) {
    this.iri = store.iri;
  }

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const path = relative(this, pathOrIri);
    if (path !== INDEX)
      return (
        (await this.store.read(path)) ??
        (await this.vocabulary.read(RULE_LIST + path))
      );
    const parts = [
      await this.vocabulary.read(RULE_LIST + INDEX),
      await this.store.read(INDEX),
    ].flatMap((bytes) =>
      bytes === undefined ? [] : [new TextDecoder().decode(bytes)],
    );
    return new TextEncoder().encode(parts.join("\n"));
  }

  write(): Promise<void> {
    return Promise.reject(new Error("a pod's tables are written by a check"));
  }

  async list(folder: string): Promise<string[]> {
    return [...(await this.store.list(folder)), INDEX];
  }
}
