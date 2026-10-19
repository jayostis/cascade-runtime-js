import type { Files, Graph, Term } from "@cascade-runtime/runtime";
import { SPECIALIZATION_OF } from "../rows.js";
import { DCT, HELD, PAV, RDFS, REC, SHIPS_WITH } from "./constants.js";
import { seriesOfAKind } from "./references-index.js";
import type { HeldSeries, HeldVersion, Watched } from "./types.js";

interface FeedChecked {
  readonly checked: string;
  readonly modified?: string;
  /** Each series the feed describes, by its IRI, with the source it is built from. */
  readonly series?: Record<string, string | null>;
  /** Each publisher's name the feed gives, by the publisher's IRI. */
  readonly publishers?: Record<string, string>;
  /** The watcher's last check of each source, by the source's IRI. */
  readonly watched?: Record<string, Watched>;
}

export interface Held {
  /** Each feed's last check, by its URL. */
  readonly feeds: Record<string, FeedChecked>;
  /** The version of each held series a pod opened now is given, sorted. */
  readonly current: readonly string[];
  /** The versions each pod was last opened with, the rule list's among them, by the pod's naming base. */
  readonly pods: Record<string, readonly string[]>;
  /** The name the app opened each pod by, by the pod's naming base. */
  readonly names?: Record<string, string>;
}

const NOTHING_HELD: Held = { feeds: {}, current: [], pods: {} };

export function heldOf(bytes: Uint8Array): Held {
  const held = JSON.parse(new TextDecoder().decode(bytes)) as Held;
  return {
    ...held,
    pods: Object.fromEntries(
      Object.entries(held.pods).filter(([, versions]) =>
        Array.isArray(versions),
      ),
    ),
  };
}

/** The feed that last described the series. */
function feedOf(held: Held, series: string): string | undefined {
  return Object.entries(held.feeds).find(
    ([, checked]) => checked.series?.[series] !== undefined,
  )?.[0];
}

/** HELD in the store: read once the store has started, and written one change at a time, apart from the checks. */
export class HeldRecord {
  readonly #files: Files;
  readonly #ready: () => Promise<void>;
  #changes: Promise<unknown> = Promise.resolve();

  constructor(files: Files, ready: () => Promise<void>) {
    this.#files = files;
    this.#ready = ready;
  }

  async read(): Promise<Held> {
    await this.#ready();
    const bytes = await this.#files.read(HELD);
    return bytes === undefined ? NOTHING_HELD : heldOf(bytes);
  }

  /** Writes what is held as `change` makes it of what is held now. */
  change(change: (held: Held) => Held): Promise<void> {
    const run = async (): Promise<void> => {
      const held = change(await this.read());
      await this.#files.write(
        HELD,
        new TextEncoder().encode(`${JSON.stringify(held, null, 2)}\n`),
      );
    };
    const next = this.#changes.then(run, run);
    this.#changes = next.catch(() => undefined);
    return next;
  }
}

/** Each series the index holds, in the order of the feeds and then by label, as a person reads of it. */
export function heldSeries(
  index: Graph,
  held: Held,
  feeds: readonly string[],
): HeldSeries[] {
  return ordered(index, held, feeds).map((series) => {
    const one = (subject: Term, predicate: string): string | undefined =>
      index.objects(subject, predicate)[0]?.value;
    const version = (of: Term): HeldVersion => ({
      iri: of.value,
      label: one(of, `${PAV}version`),
      issued: one(of, `${DCT}issued`),
    });
    const [current] = index.objects(series, SHIPS_WITH);
    const versions = index
      .subjects(SPECIALIZATION_OF, series)
      .filter((each) => each.value !== current?.value)
      .map(version)
      .sort((a, b) => (b.issued ?? "").localeCompare(a.issued ?? ""));
    const feed = feedOf(held, series.value);
    const checked = feed === undefined ? undefined : held.feeds[feed];
    const source = checked?.series?.[series.value];
    const publisher = one(series, `${DCT}publisher`);
    return {
      iri: series.value,
      label: one(series, `${RDFS}label`) ?? series.value,
      kind: one(series, `${REC}tableKind`),
      licence: one(series, `${DCT}license`),
      publisher,
      publisherName:
        publisher === undefined ? undefined : checked?.publishers?.[publisher],
      credit: one(series, `${DCT}bibliographicCitation`),
      current: version(current ?? series),
      versions: [version(current ?? series), ...versions],
      feed,
      modified: checked?.modified,
      checked: checked?.checked,
      watched:
        source === undefined || source === null
          ? undefined
          : checked?.watched?.[source],
      source: source ?? undefined,
    };
  });
}

/** The series the store holds, in the order of the feeds that describe them, and then by label. */
function ordered(index: Graph, held: Held, feeds: readonly string[]): Term[] {
  const place = (series: Term): number => {
    const at = feeds.indexOf(feedOf(held, series.value) ?? "");
    return at < 0 ? feeds.length : at;
  };
  const label = (series: Term): string =>
    index.objects(series, `${RDFS}label`)[0]?.value ?? series.value;
  return seriesOfAKind(index).sort(
    (a, b) => place(a) - place(b) || label(a).localeCompare(label(b)),
  );
}
