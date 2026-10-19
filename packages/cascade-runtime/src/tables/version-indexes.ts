import { CODES, fileStem, Refusal, rowsByCode } from "@cascade-runtime/runtime";
import {
  IN_THIS_THREAD,
  LISTING_FORMAT,
  type Listed,
  merged,
  notation,
  termsOfRows,
} from "../rows.js";
import { TablesFiles } from "./references-index.js";
import { LISTED } from "./starter.js";
import type { TablesContext } from "./types.js";

/** What `make` gives for the key, made at the first call and kept; one that fails is made again at the next. */
function once<T>(
  made: Map<string, Promise<T>>,
  key: string,
  make: () => Promise<T>,
): Promise<T> {
  let found = made.get(key);
  if (found === undefined) {
    found = make();
    found.catch(() => made.delete(key));
    made.set(key, found);
  }
  return found;
}

/** The stem of a held version's files; a version named by no file is refused. */
function stemOf(version: string): string {
  try {
    return fileStem(version);
  } catch (error) {
    throw new Refusal(
      `the tables hold ${version}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** A listing kept beside a version, when it is one of this shape over these URI spaces. */
function keptListing(
  bytes: Uint8Array,
  uriSpaces: readonly string[],
): Listed | undefined {
  let kept: Partial<Listed> | null;
  try {
    kept = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as Partial<Listed> | null;
  } catch {
    return undefined;
  }
  return kept?.format === LISTING_FORMAT &&
    JSON.stringify(kept.uriSpaces) === JSON.stringify(uriSpaces) &&
    Array.isArray(kept.codes) &&
    typeof kept.mapsTo === "object" &&
    kept.mapsTo !== null &&
    typeof kept.names === "object" &&
    kept.names !== null &&
    Object.values(kept.names).every((names) => typeof names === "string")
    ? (kept as Listed)
    : undefined;
}

/** What is read and made of each held version, once: a version's rows never change. */
export class VersionIndexes {
  readonly #context: Pick<
    TablesContext,
    "options" | "files" | "references" | "terms"
  >;
  readonly #listings = new Map<string, Promise<Listed>>();
  /** Each version being listed and kept beside it, until it is: what a read and `keep` share. */
  readonly #listing = new Map<string, Promise<Uint8Array>>();
  readonly #merges = new Map<string, Promise<readonly string[]>>();
  readonly #notations = new Map<string, Promise<ReadonlyMap<string, string>>>();
  readonly #inverses = new Map<
    string,
    Promise<ReadonlyMap<string, readonly string[]>>
  >();

  constructor(
    context: Pick<TablesContext, "options" | "files" | "references" | "terms">,
  ) {
    this.#context = context;
  }

  /** Drops what was made of a version that is no longer current. */
  forget(version: string): void {
    this.#listings.delete(version);
    this.#inverses.delete(version);
    this.#notations.delete(version);
    for (const key of this.#merges.keys())
      if (key.split(" ").includes(version)) this.#merges.delete(key);
  }

  /**
   * In a version, the row subjects each code finds, as the index `rowsByCode` wrote beside it; when that is missing or
   * was built for other properties, made from its lines and kept beside it, as a listing is. Read once, by `References`.
   */
  async codesIn(
    version: string,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const [references, { foundBy }] = await Promise.all([
      this.#context.references(),
      this.#context.terms(),
    ]);
    const by =
      foundBy.get(
        references.kindOf(references.seriesOf(version) ?? "") ?? "",
      ) ?? [];
    const kept = await references.codes(version, by);
    if (kept !== undefined) return kept;
    const made = rowsByCode(termsOfRows(await references.text(version)), by);
    if (made === undefined) return new Map();
    await this.#context.files.write(`${stemOf(version)}${CODES}`, made);
    return (await references.codes(version, by)) ?? new Map();
  }

  /** The codes the versions list, as one list in the order of their notations; made once for the versions. */
  mergedCodes(versions: readonly string[]): Promise<readonly string[]> {
    return once(this.#merges, versions.join(" "), async () => {
      const [listings, { uriSpaces }] = await Promise.all([
        Promise.all(versions.map((version) => this.listed(version))),
        this.#context.terms(),
      ]);
      return merged(
        listings.map(({ codes }) => codes),
        uriSpaces,
      );
    });
  }

  /** In a version, each code it lists or maps to, by its notation, the first listed for a notation; made once. */
  notationsIn(version: string): Promise<ReadonlyMap<string, string>> {
    return once(this.#notations, version, async () => {
      const [{ codes, mapsTo }, { uriSpaces }] = await Promise.all([
        this.listed(version),
        this.#context.terms(),
      ]);
      const named = new Map<string, string>();
      for (const code of [...codes, ...Object.values(mapsTo).flat()]) {
        const written = notation(uriSpaces, code);
        if (!named.has(written)) named.set(written, code);
      }
      return named;
    });
  }

  /** In a mapping version, the codes mapped to each code; made once. */
  mappedFrom(version: string): Promise<ReadonlyMap<string, readonly string[]>> {
    return once(this.#inverses, version, async () => {
      const from = new Map<string, string[]>();
      const { codes, mapsTo } = await this.listed(version);
      for (const code of codes)
        for (const target of Object.hasOwn(mapsTo, code) ? mapsTo[code]! : []) {
          const sources = from.get(target) ?? [];
          sources.push(code);
          from.set(target, sources);
        }
      return from;
    });
  }

  /** A held version's N-Triples, read once, by `References`. */
  async text(version: string): Promise<string> {
    return (await this.#context.references()).text(version);
  }

  /** A held version's N-Triples as they are kept. */
  async #rows(version: string): Promise<Uint8Array<ArrayBuffer>> {
    const bytes = await new TablesFiles(
      this.#context.files,
      this.#context.options.vocabulary,
    ).read(`${stemOf(version)}.ttl`);
    if (bytes === undefined)
      throw new Refusal(`the tables hold no rows for ${version}`);
    return new Uint8Array(bytes);
  }

  /**
   * A held version's listing, read once: as a check kept it beside the version, or, when it did not, as listed from
   * its rows and then kept there.
   */
  listed(version: string): Promise<Listed> {
    return once(this.#listings, version, async () => {
      const files = this.#context.files;
      const path = `${stemOf(version)}${LISTED}`;
      const [bytes, { uriSpaces }] = await Promise.all([
        files.read(path),
        this.#context.terms(),
      ]);
      const kept =
        bytes === undefined ? undefined : keptListing(bytes, uriSpaces);
      if (kept !== undefined) return kept;
      return JSON.parse(
        new TextDecoder().decode(await this.#list(version, uriSpaces)),
      ) as Listed;
    });
  }

  /**
   * Lists each version whose listing is not kept beside it, or not as a read takes one kept, one at a time, and keeps
   * it there, so a first read of it waits for none; a version whose rows the tables do not hold is left to its read.
   * The bytes written.
   */
  async keep(versions: readonly string[]): Promise<number> {
    const { uriSpaces } = await this.#context.terms();
    let written = 0;
    for (const version of versions) {
      if (this.#listings.has(version)) continue;
      try {
        const bytes = await this.#context.files.read(
          `${stemOf(version)}${LISTED}`,
        );
        if (bytes !== undefined && keptListing(bytes, uriSpaces) !== undefined)
          continue;
        written += (await this.#list(version, uriSpaces)).byteLength;
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
      }
    }
    return written;
  }

  /** A version's listing, listed from its rows and kept beside it; one listing of a version at a time. */
  #list(version: string, uriSpaces: readonly string[]): Promise<Uint8Array> {
    let listing = this.#listing.get(version);
    if (listing === undefined) {
      listing = (async () => {
        const listed = await (
          this.#context.options.work ?? IN_THIS_THREAD
        ).listed(await this.#rows(version), uriSpaces);
        await this.#context.files.write(`${stemOf(version)}${LISTED}`, listed);
        return listed;
      })();
      const made = listing;
      const drop = (): void => {
        if (this.#listing.get(version) === made) this.#listing.delete(version);
      };
      made.then(drop, drop);
      this.#listing.set(version, made);
    }
    return listing;
  }
}
