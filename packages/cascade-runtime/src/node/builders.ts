import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve as absolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as Host from "cascade-reference-tables";
import type { Checked, LocalBuilds } from "../tables.js";

/** The package a builder runs through, which an app that names one installs itself. */
export const HOST = "cascade-reference-tables";

/** A builder named by its folder under the host's `builders/`; anything else is a path. */
const NAME = /^[a-z0-9][a-z0-9._-]*$/;

/** The builder's source as the host reads it: its name, or its path made absolute against `from`. */
export function builderAt(builder: string, from: string): string {
  return NAME.test(builder) ? builder : absolute(from, builder);
}

/** What reads `file:` URLs from disk, a missing file answering 404, and every other URL with `fetching`. */
export function withFiles(fetching: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith("file:")) return fetching(input, init);
    const path = fileURLToPath(url);
    return existsSync(path)
      ? new Response(await readFile(path))
      : new Response(null, { status: 404 });
  };
}

async function host(): Promise<{ module: typeof Host; root: string }> {
  let entry: string;
  try {
    entry = import.meta.resolve(HOST);
  } catch {
    throw new Error(
      `the tables' configuration names a builder, and a builder runs through ${HOST}, which this app has not installed: install it as the cascade-runtime guide's "Reference tables" says`,
    );
  }
  return {
    module: (await import(entry)) as typeof Host,
    root: join(dirname(fileURLToPath(entry)), "..", "..", ".."),
  };
}

async function seenIn(
  out: string,
  source: string,
): Promise<Host.Seen | undefined> {
  const path = join(out, "checked.json");
  if (!existsSync(path)) return undefined;
  const { checked } = JSON.parse(await readFile(path, "utf8")) as Host.Checked;
  return checked[source]?.inputs;
}

/**
 * The builders, each run through the host into `<folder>/<its name>/` and read from the feed it writes there, its rows
 * checked against the vocabulary in `vocabulary`.
 */
export function localBuilds(
  builders: readonly string[],
  folder: string,
  vocabulary: string,
  fetching: typeof fetch,
): LocalBuilds {
  const outOf = (builder: string): string => join(folder, basename(builder));
  return {
    feeds: builders.map(
      (builder) => pathToFileURL(join(outOf(builder), "feed.ttl")).href,
    ),
    async run(init) {
      const { module, root } = await host();
      const contract = await module.readContract(root, vocabulary);
      const outcomes = new Map<string, Omit<Checked, "feed" | "kept">>();
      for (const builder of builders) {
        const out = outOf(builder);
        const sourceFolder = module.sourceFolder(root, builder);
        const source = await module.readSource(sourceFolder);
        try {
          await module.buildLatest(contract, {
            source,
            build: await module.loadBuild(root, sourceFolder),
            feed: join(out, "feed.ttl"),
            out,
            now: new Date().toISOString(),
            fetch: (url, request) =>
              fetching(url, {
                ...request,
                ...(init.signal ? { signal: init.signal } : {}),
              }),
            seen: await seenIn(out, source.iri),
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          outcomes.set(
            pathToFileURL(join(out, "feed.ttl")).href,
            error instanceof module.Refusal
              ? { refused: [{ version: source.iri, reason }] }
              : {
                  later: `${source.label} could not be built: ${reason}`,
                  refused: [],
                },
          );
        }
      }
      return outcomes;
    },
  };
}
