import {
  type AdaptersOf,
  type Bridge,
  type BridgeDocument,
  type Description,
  isBridgeError,
  type LoadedAdapter,
  type Named,
} from "./bridge.js";
import { type Followed, repositoryName } from "./config.js";
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

/** The vocabulary an adapter reads, by its `bridge:cascadeVocabularyRepository`, or none to load it without. */
export type VocabularyAt = (
  repository: string | undefined,
) => Promise<Source | undefined>;

export interface Loaded {
  readonly description: Description;
  readonly vocabulary?: Source;
  readonly adapter: LoadedAdapter;
}

function missing(error: unknown): boolean {
  return isBridgeError(error) && error.kind === "missing";
}

async function read(
  files: Files,
  paths: Iterable<string>,
): Promise<Map<string, Uint8Array>> {
  const read = await Promise.all(
    [...paths].map(async (path) => [path, await files.read(path)] as const),
  );
  return new Map(
    read.flatMap(([path, bytes]) =>
      bytes === undefined ? [] : [[path, bytes] as const],
    ),
  );
}

async function everyFile(files: Files): Promise<string[]> {
  return (await files.list("")).filter(
    (path) => path !== ".git" && !path.startsWith(".git/"),
  );
}

/**
 * Loads an adapter as library.md has a host do it, when a call first needs it: describe it from its metadata alone,
 * give it the files the description lists (all its files, where it is `whole`) and the vocabulary files it lists, and,
 * whenever a call fails for a file missing from a map, fetch that file and load it again.
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
  const listed = description.vocabulary?.files ?? [];
  const vocabularySource =
    listed.length === 0
      ? undefined
      : await vocabularyAt(description.vocabulary?.repository);

  type Maps = { adapter: Named; vocabulary?: Named };
  const reading = async (): Promise<Maps> => {
    const [adapter, vocabulary] = await Promise.all([
      source.whole
        ? everyFile(source.files).then((paths) => read(source.files, paths))
        : read(source.files, description.loadFiles),
      vocabularySource && read(vocabularySource.files, listed),
    ]);
    return {
      adapter: { iri: source.iri, files: adapter },
      ...(vocabularySource &&
        vocabulary && {
          vocabulary: { iri: vocabularySource.iri, files: vocabulary },
        }),
    };
  };
  let maps: Promise<Maps> | undefined;
  /** The files the first load is given, read when it needs them, and again when reading them failed. */
  const given = (): Promise<Maps> => {
    maps ??= reading().catch((error: unknown) => {
      maps = undefined;
      throw error;
    });
    return maps;
  };
  const sources = { adapter: source, vocabulary: vocabularySource };
  /** Adds the file a failure says is missing; false when it cannot. */
  const fetched = async (error: unknown): Promise<boolean> => {
    if (!missing(error)) return false;
    const { map, path } = error as {
      map?: "adapter" | "vocabulary";
      path?: string;
    };
    const named = map && (await given())[map];
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
    const { adapter, vocabulary } = await given();
    for (;;) {
      try {
        return await bridge.load(adapter, vocabulary);
      } catch (error) {
        if (!(await fetched(error))) throw error;
      }
    }
  };

  let loaded: Promise<LoadedAdapter> | undefined;
  /** The adapter as loaded now, loading it again when the last load failed or was let go. */
  const current = (): Promise<LoadedAdapter> => {
    if (loaded === undefined) {
      const next = loading();
      next.catch(() => {
        if (loaded === next) loaded = undefined;
      });
      loaded = next;
    }
    return loaded;
  };
  const envelopeOf = (document: BridgeDocument): BridgeDocument =>
    document.envelope === undefined
      ? document
      : {
          ...document,
          envelope: new URL(document.envelope, `${source.iri}${METADATA}`).href,
        };
  const retrying = async <T>(
    call: (on: LoadedAdapter) => Promise<T>,
  ): Promise<T> => {
    for (;;) {
      const now = current();
      const on = await now;
      try {
        return await call(on);
      } catch (error) {
        if (!missing(error) || (loaded === now && !(await fetched(error))))
          throw error;
        if (loaded === now) {
          loaded = undefined;
          void on.free().catch(() => undefined);
        }
      }
    }
  };
  return {
    description,
    ...(vocabularySource && { vocabulary: vocabularySource }),
    adapter: {
      accepts: (document) => retrying((on) => on.accepts(envelopeOf(document))),
      convert: (document, options) =>
        retrying((on) => on.convert(envelopeOf(document), options)),
      free: async () => {
        const last = loaded;
        loaded = undefined;
        await (await last)?.free();
      },
    },
  };
}

/**
 * Each adapter followed, described in order from the source `at` gives it, with the vocabulary its description names
 * from the source `at` gives that repository; if one fails, those already described are freed. None is loaded here: an
 * adapter loads when its first `accepts` or `convert` needs it, a load that fails rejects that call with a plain error,
 * and the next call tries the load again.
 */
export async function loadAdapters(
  bridge: Bridge,
  adapters: readonly Followed[],
  at: (followed: Followed) => Promise<Source>,
): Promise<Loaded[]> {
  const loaded: Loaded[] = [];
  try {
    for (const followed of adapters)
      loaded.push(
        await loadAdapter(bridge, await at(followed), async (repository) => {
          if (repository === undefined)
            throw new Error(
              `${repositoryName(followed)} names vocabulary files but no vocabulary repository`,
            );
          return at({ repository });
        }),
      );
  } catch (error) {
    await Promise.allSettled(loaded.map(({ adapter }) => adapter.free()));
    throw error;
  }
  return loaded;
}

/** A media type's essence: its type and subtype, lower-cased, without parameters. */
function essence(mediaType: string): string {
  return (mediaType.split(";")[0] ?? "").trim().toLowerCase();
}

/** Each media type's adapters: those whose description declares it as their `bridge:sourceMediaType`, in their order. */
export function ofMediaType(loaded: readonly Loaded[]): AdaptersOf {
  return (mediaType) =>
    loaded
      .filter(
        ({ description }) =>
          description.sourceMediaType !== undefined &&
          essence(description.sourceMediaType) === essence(mediaType),
      )
      .map(({ adapter }) => adapter);
}
