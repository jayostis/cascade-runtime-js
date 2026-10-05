import {
  type Bridge,
  type Description,
  isBridgeError,
  type LoadedAdapter,
  type Named,
} from "./bridge.js";
import type { Pin } from "./config.js";
import type { Files } from "./files.js";

const METADATA = "ro-crate-metadata.json";

/** An adapter's or a vocabulary's files and the IRI the Bridge is given for them (runtime/rules.md, N8). */
export interface Source {
  readonly iri: string;
  readonly files: Files;
  /**
   * Whether every file under it is at hand, as in a local or cached checkout. An adapter's are then all given, so a
   * schema the adapter ships is read even where the description does not list it.
   */
  readonly whole?: boolean;
}

/** The vocabulary an adapter pins, by the IRI of its `bridge:cascadeVocabularyPin`, or none to load it without. */
export type VocabularyAt = (
  pin: string | undefined,
) => Promise<Source | undefined>;

export interface Loaded {
  readonly description: Description;
  readonly vocabulary?: Source;
  readonly adapter: LoadedAdapter;
}

/** The repository and commit a `<repository>/commit/<sha>` pin names. */
export function commitPin(iri: string): Pin {
  const found = /^(https:\/\/\S+)\/commit\/([0-9a-f]{40})$/.exec(iri);
  if (found === null) throw new Error(`${iri} names no repository at a commit`);
  return { repository: found[1] ?? "", commit: found[2] ?? "" };
}

function missing(error: unknown): boolean {
  return isBridgeError(error) && error.kind === "missing";
}

async function read(
  files: Files,
  paths: Iterable<string>,
): Promise<Map<string, Uint8Array>> {
  const map = new Map<string, Uint8Array>();
  for (const path of paths) {
    const bytes = await files.read(path);
    if (bytes !== undefined) map.set(path, bytes);
  }
  return map;
}

async function everyFile(files: Files): Promise<string[]> {
  return (await files.list("")).filter(
    (path) => path !== ".git" && !path.startsWith(".git/"),
  );
}

/**
 * Loads an adapter as library.md has a host do it: describe it from its metadata alone, give it the files the
 * description lists (all its files, where it is `whole`) and the vocabulary files it lists, and, whenever a call fails
 * for a file missing from a map, fetch that file and load it again.
 */
export async function loadAdapter(
  bridge: Bridge,
  source: Source,
  vocabularyAt: VocabularyAt,
): Promise<Loaded> {
  const metadata = await source.files.read(METADATA);
  if (metadata === undefined)
    throw new Error(`${source.iri} has no ${METADATA}`);
  const description = await bridge.describe(source.iri, metadata);
  const adapter: Named = {
    iri: source.iri,
    files: await read(
      source.files,
      source.whole ? await everyFile(source.files) : description.loadFiles,
    ),
  };
  const listed = description.vocabulary?.files ?? [];
  const vocabularySource =
    listed.length === 0
      ? undefined
      : await vocabularyAt(description.vocabulary?.pin);
  const vocabulary: Named | undefined = vocabularySource && {
    iri: vocabularySource.iri,
    files: await read(vocabularySource.files, listed),
  };

  const maps = { adapter, vocabulary };
  const sources = { adapter: source, vocabulary: vocabularySource };
  /** Adds the file a failure says is missing; false when it cannot. */
  const fetched = async (error: unknown): Promise<boolean> => {
    if (!missing(error)) return false;
    const { map, path } = error as {
      map?: "adapter" | "vocabulary";
      path?: string;
    };
    const named = map && maps[map];
    const from = map && sources[map];
    if (named === undefined || from === undefined || path === undefined)
      return false;
    if (named.files.has(path)) return false;
    const bytes = await from.files.read(path);
    if (bytes === undefined) return false;
    (named.files as Map<string, Uint8Array>).set(path, bytes);
    return true;
  };
  const loading = async (): Promise<LoadedAdapter> => {
    for (;;) {
      try {
        return await bridge.load(maps.adapter, maps.vocabulary);
      } catch (error) {
        if (!(await fetched(error))) throw error;
      }
    }
  };

  let loaded = loading();
  await loaded;
  const reload = (stale: Promise<LoadedAdapter>): void => {
    if (loaded !== stale) return;
    loaded = stale
      .then((on) => on.free())
      .catch(() => undefined)
      .then(loading);
  };
  const retrying = async <T>(
    call: (on: LoadedAdapter) => Promise<T>,
  ): Promise<T> => {
    for (;;) {
      const current = loaded;
      try {
        return await call(await current);
      } catch (error) {
        if (!missing(error) || (loaded === current && !(await fetched(error))))
          throw error;
        reload(current);
      }
    }
  };
  return {
    description,
    ...(vocabularySource && { vocabulary: vocabularySource }),
    adapter: {
      accepts: (document) => retrying((on) => on.accepts(document)),
      convert: (document, options) =>
        retrying((on) => on.convert(document, options)),
      free: async () => (await loaded).free(),
    },
  };
}
