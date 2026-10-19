import {
  CODES,
  fileStem,
  Graph,
  iri,
  ntriples,
  RDF,
  RULE_LIST,
  tableTerms,
  type Term,
  type Triple,
} from "@cascade-runtime/runtime";
import {
  IN_THIS_THREAD,
  PROV,
  REVISION_OF,
  SPECIALIZATION_OF,
} from "../rows.js";
import { DCT, INDEX, PAV, RDFS, REC } from "./constants.js";
import type { HeldRecord } from "./held-record.js";
import { currentIn } from "./references-index.js";
import { LISTED } from "./starter.js";
import type {
  Checked,
  TablesContext,
  TablesOptions,
  Watched,
} from "./types.js";

const DCAT = "http://www.w3.org/ns/dcat#";
const SPDX = "http://spdx.org/rdf/terms#";
/** Beside a feed, when its watcher last checked each source. */
const WATCHED = "checked.json";

/** What a pod keeps of a series, from the feed's description of it. */
const SERIES_KEPT = [
  `${RDF}type`,
  `${RDFS}label`,
  `${REC}tableKind`,
  `${DCT}license`,
  `${DCT}publisher`,
  `${DCT}bibliographicCitation`,
];
/** What a pod keeps of a version, from the feed's description of it. */
const VERSION_KEPT = [
  SPECIALIZATION_OF,
  `${PAV}version`,
  REVISION_OF,
  `${DCT}issued`,
  `${REC}coversGene`,
];

/** What a check of a feed reads and writes, beside what the other modules do. */
export interface FeedContext extends Pick<
  TablesContext,
  "options" | "files" | "terms" | "indexes"
> {
  readonly held: HeldRecord;
  kindsRead(): Promise<ReadonlySet<string>>;
  /** The store's own index, without the rule list's. */
  index(): Promise<Graph>;
  forgetIndex(): void;
}

/**
 * The kinds something the app runs reads: the kind a row of the vocabulary's rule list names, and the kinds the
 * vocabulary marks as read by pages. A series of any other kind is neither kept nor packed.
 */
export async function kindsRead({
  vocabulary,
  newStore,
}: Pick<TablesOptions, "vocabulary" | "newStore">): Promise<
  ReadonlySet<string>
> {
  const kinds = new Set((await tableTerms(vocabulary, newStore)).readByPages);
  for (const path of await vocabulary.list(RULE_LIST)) {
    const bytes = path.endsWith(".ttl")
      ? await vocabulary.read(path)
      : undefined;
    if (bytes === undefined) continue;
    for (const [, predicate, object] of await newStore().parse(
      bytes,
      vocabulary.iri + path,
    ))
      if (predicate.value === `${REC}tableKind`) kinds.add(object.value);
  }
  return kinds;
}

function only(graph: Graph, subject: Term, kept: readonly string[]): Triple[] {
  return graph
    .match(subject)
    .filter(
      ([, predicate, object]) =>
        kept.includes(predicate.value) && object.termType !== "BlankNode",
    );
}

/** The watcher's checks in a feed's `checked.json`, by source; none when it is not one. */
function watchedIn(bytes: Uint8Array): Record<string, Watched> | undefined {
  try {
    const { checked } = JSON.parse(new TextDecoder().decode(bytes)) as {
      checked?: Record<string, { at?: unknown; found?: unknown }>;
    };
    if (typeof checked !== "object" || checked === null) return undefined;
    return Object.fromEntries(
      Object.entries(checked).flatMap(([source, { at, found }]) =>
        typeof at === "string" && typeof found === "string"
          ? [[source, { at, found }]]
          : [],
      ),
    );
  } catch {
    return undefined;
  }
}

/** The check of a builder's feed with what kept the builder from building, if anything did. */
export function withBuilt(
  checked: Checked,
  built: ReadonlyMap<string, Omit<Checked, "feed" | "kept">>,
): Checked {
  const run = built.get(checked.feed);
  if (run === undefined) return checked;
  const later = run.later ?? checked.later;
  return {
    ...checked,
    ...(later === undefined ? {} : { later }),
    refused: [...run.refused, ...checked.refused],
  };
}

/** Whether the line of `prov:wasRevisionOf` the catalog gives from `version` reaches `held`. */
function descends(catalog: Graph, version: Term, held: string): boolean {
  const seen = new Set<string>();
  for (
    let at: Term | undefined = version;
    at !== undefined && !seen.has(at.value);
    at = catalog.objects(at, REVISION_OF)[0]
  ) {
    if (at.value === held) return true;
    seen.add(at.value);
  }
  return false;
}

/** Reads the feed and keeps each current version it describes that the store does not hold and that verifies. */
export async function checkFeed(
  context: FeedContext,
  feed: string,
  init: RequestInit,
): Promise<Checked> {
  const fetching = context.options.fetch ?? fetch;
  const kept: string[] = [];
  const refused: { version: string; reason: string }[] = [];
  const answer = async (
    url: string,
  ): Promise<Uint8Array<ArrayBuffer> | string> => {
    try {
      const response = await fetching(url, init);
      return response.ok
        ? new Uint8Array(await response.arrayBuffer())
        : `${url} answered ${response.status}`;
    } catch (error) {
      return `${url} could not be read: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  const answered = await answer(feed);
  if (typeof answered === "string")
    return { feed, kept, later: answered, refused };
  let catalog: Graph;
  try {
    catalog = new Graph(await context.options.newStore().parse(answered, feed));
  } catch (error) {
    return {
      feed,
      kept,
      later: `${feed} is not Turtle: ${error instanceof Error ? error.message : String(error)}`,
      refused,
    };
  }
  let index = await context.index();
  let later: string | undefined;
  for (const series of catalog.subjects(
    `${RDF}type`,
    iri(`${REC}ReferenceSeries`),
  )) {
    const [version] = catalog.objects(series, `${DCAT}hasCurrentVersion`);
    const kind = catalog.objects(series, `${REC}tableKind`)[0]?.value ?? "";
    if (
      version?.termType !== "NamedNode" ||
      index.match(version, SPECIALIZATION_OF).length > 0 ||
      !(await context.kindsRead()).has(kind)
    )
      continue;
    const [held] = index.objects(series, `${REC}shipsWith`);
    if (held !== undefined && !descends(catalog, version, held.value)) {
      refused.push({
        version: version.value,
        reason: `it does not descend from ${held.value}, the version of its series held`,
      });
      continue;
    }
    const [distribution] = catalog.objects(version, `${DCAT}distribution`);
    const [url] =
      distribution === undefined
        ? []
        : catalog.objects(distribution, `${DCAT}downloadURL`);
    const [checksum] =
      distribution === undefined
        ? []
        : catalog
            .objects(distribution, `${SPDX}checksum`)
            .flatMap((sum) => catalog.objects(sum, `${SPDX}checksumValue`));
    if (url === undefined || checksum === undefined) {
      refused.push({
        version: version.value,
        reason: "the feed gives no download URL and checksum for it",
      });
      continue;
    }
    const bytes = await answer(url.value);
    if (typeof bytes === "string") {
      later = bytes;
      continue;
    }
    const terms = await context.terms();
    const rows = await (context.options.work ?? IN_THIS_THREAD).verified({
      bytes,
      checksum: checksum.value,
      version: version.value,
      series: series.value,
      previous: catalog.objects(version, REVISION_OF)[0]?.value,
      foundBy: terms.foundBy.get(kind) ?? [],
      uriSpaces: terms.uriSpaces,
    });
    if ("refused" in rows) {
      refused.push({ version: version.value, reason: rows.refused });
      continue;
    }
    const stem = fileStem(version.value);
    await context.files.write(`${stem}.ttl`, rows.text);
    if (rows.codes !== undefined)
      await context.files.write(stem + CODES, rows.codes);
    await context.files.write(stem + LISTED, rows.listed);
    index = new Graph([
      ...index.triples.filter(
        ([subject, predicate]) =>
          !(
            subject.value === series.value &&
            [...SERIES_KEPT, `${REC}shipsWith`].includes(predicate.value)
          ),
      ),
      ...only(catalog, series, SERIES_KEPT),
      [series, iri(`${REC}shipsWith`), version],
      [version, iri(`${RDF}type`), iri(`${PROV}Entity`)],
      ...only(catalog, version, VERSION_KEPT),
      ...catalog
        .match(undefined, REVISION_OF)
        .filter(
          ([earlier]) =>
            catalog.match(earlier, SPECIALIZATION_OF, series).length > 0,
        ),
    ]);
    await context.files.write(INDEX, ntriples(index.triples));
    context.forgetIndex();
    const current = currentIn(index);
    await context.held.change((held) => ({ ...held, current }));
    if (held !== undefined) context.indexes.forget(held.value);
    kept.push(version.value);
  }
  const watched = await answer(new URL(WATCHED, feed).href);
  const modified = catalog.objects(iri(feed), `${DCT}modified`)[0]?.value;
  const current = currentIn(index);
  await context.held.change((held) => ({
    ...held,
    feeds: {
      ...held.feeds,
      [feed]: {
        checked: new Date().toISOString(),
        ...(modified === undefined ? {} : { modified }),
        series: Object.fromEntries(
          catalog
            .subjects(`${RDF}type`, iri(`${REC}ReferenceSeries`))
            .map((series) => [
              series.value,
              catalog.objects(series, `${DCT}source`)[0]?.value ?? null,
            ]),
        ),
        publishers: Object.fromEntries(
          catalog
            .match(undefined, `${DCT}publisher`)
            .flatMap(([, , publisher]) =>
              catalog
                .objects(publisher, `${RDFS}label`)
                .slice(0, 1)
                .map((label) => [publisher.value, label.value]),
            ),
        ),
        watched:
          (typeof watched === "string" ? undefined : watchedIn(watched)) ??
          held.feeds[feed]?.watched,
      },
    },
    current,
  }));
  return { feed, kept, ...(later === undefined ? {} : { later }), refused };
}
