import {
  canonical,
  type Files,
  fileStem,
  Graph,
  MemoryFiles,
  References,
  type TableTerms,
  tableTerms,
  type Triple,
} from "@cascade-runtime/runtime";
import { gunzipped, IN_THIS_THREAD, nameOver } from "./rows.js";
import { about } from "./tables/about.js";
import { HELD, INDEX, SHIPS_WITH } from "./tables/constants.js";
import { classedElsewhere, reached } from "./tables/drug-classes.js";
import { facts } from "./tables/facts.js";
import { checkFeed, kindsRead, withBuilt } from "./tables/feed-check.js";
import { heldOf, HeldRecord, heldSeries } from "./tables/held-record.js";
import { inPanels, panelRows } from "./tables/panels.js";
import { currentOf, TablesFiles } from "./tables/references-index.js";
import { codeNamed, search } from "./tables/search.js";
import { PUBLISHED_ROWS, StarterFiles, versionsIn } from "./tables/starter.js";
import type {
  About,
  Checked,
  Described,
  Fact,
  Facts,
  HeldSeries,
  Placed,
  Searched,
  TablesContext,
  TablesOptions,
  VariantAsked,
  WhatClinVarSays,
} from "./tables/types.js";
import { conceptLabels, variantClassification } from "./tables/variants.js";
import { VersionIndexes } from "./tables/version-indexes.js";

export { HELD, PAGE_SIZE } from "./tables/constants.js";
export { currentOf, shipped } from "./tables/references-index.js";
export { LISTED, PUBLISHED_ROWS } from "./tables/starter.js";
export type {
  About,
  Checked,
  ClassificationRow,
  Coded,
  Codes,
  Concept,
  Fact,
  Facts,
  Found,
  HeldSeries,
  HeldVersion,
  InClass,
  LocalBuilds,
  Placed,
  Searched,
  TablesOptions,
  VariantAsked,
  Watched,
  WhatClinVarSays,
  WithheldClass,
} from "./tables/types.js";

/** How long the check an open starts may take: a network that stalls must not hold a local pod closed. */
export const CHECK_ON_OPEN_MS = 10_000;

/** A version's name (N12): over its series, the version it revises and its rows. */
export async function versionName(
  series: string,
  previous: string | undefined,
  rows: readonly Triple[],
): Promise<string> {
  if (rows.some((triple) => triple.some((t) => t.termType === "BlankNode")))
    throw new Error("content to be named holds a blank node");
  const text = await canonical(rows);
  return nameOver(
    text.split("\n").filter((line) => line !== ""),
    series,
    previous,
  );
}

/** What `make` gives, made at the first `get` and kept until `forget`; one that fails is made again at the next. */
class Lazy<T> {
  readonly #make: () => Promise<T>;
  #made: Promise<T> | undefined;

  constructor(make: () => Promise<T>) {
    this.#make = make;
  }

  get(): Promise<T> {
    if (this.#made === undefined) {
      const made = this.#make();
      made.catch(() => {
        if (this.#made === made) this.#made = undefined;
      });
      this.#made = made;
    }
    return this.#made;
  }

  forget(): void {
    this.#made = undefined;
  }
}

/**
 * An app's reference tables: the versions it keeps from its feeds, beside its pods, and the vocabulary's rule list.
 * The one object callers use; what it answers is worked out in `tables/`.
 */
export class Tables {
  readonly #options: TablesOptions;
  /** The store, read through to the starter copies when there are some. */
  readonly #files: Files;
  readonly #starterFiles: StarterFiles | undefined;
  readonly #held: HeldRecord;
  readonly #indexes: VersionIndexes;
  readonly #context: TablesContext;
  #queue: Promise<unknown> = Promise.resolve();
  #started: Promise<void> | undefined;
  #written = 0;
  readonly #references = new Lazy(() =>
    References.of(
      new TablesFiles(this.#files, this.#options.vocabulary),
      "",
      this.#options.newStore,
      undefined,
      { canonical: true },
    ),
  );
  readonly #concepts = new Lazy(() => conceptLabels(this.#options));
  readonly #kinds = new Lazy(() => kindsRead(this.#options));

  constructor(options: TablesOptions) {
    this.#options = options;
    this.#starterFiles =
      options.starter === undefined
        ? undefined
        : new StarterFiles(
            options.files,
            options.starter,
            options.work ?? IN_THIS_THREAD,
          );
    this.#files = this.#starterFiles ?? options.files;
    this.#held = new HeldRecord(this.#files, () => this.#start());
    const read = {
      options,
      files: this.#files,
      references: () => this.references(),
      terms: () => this.#terms(),
    };
    this.#indexes = new VersionIndexes(read);
    this.#context = {
      ...read,
      indexes: this.#indexes,
      about: (codes) => this.about(codes),
      labels: (concepts) => this.labels(concepts),
    };
  }

  /** Runs the local builders, then reads each feed and keeps each current version it does not hold that verifies. */
  check(init: RequestInit = {}): Promise<Checked[]> {
    return this.#next(async () => {
      const { feeds, builds } = this.#options;
      const built = (await builds?.run(init)) ?? new Map();
      const context = {
        ...this.#context,
        held: this.#held,
        kindsRead: () => this.#kinds.get(),
        index: () => this.#index(),
        forgetIndex: () => this.#forgetIndex(),
      };
      const checked: Checked[] = [];
      for (const feed of [...feeds, ...(builds?.feeds ?? [])])
        checked.push(withBuilt(await checkFeed(context, feed, init), built));
      return checked;
    });
  }

  /**
   * Copies into the store every version of the package's tables it lacks, which a first use of each reads through to
   * anyway, then lists each current version the copies carry no listing of, so a first search or lookup lists none; a
   * start cut short goes on from where it stopped. The bytes written, or 0 when the store held them already.
   */
  async start(): Promise<number> {
    const before = this.#written;
    await this.#start();
    const copied =
      (await this.#starterFiles?.copyAll(await this.#shippedStems())) ?? 0;
    const listed = await this.#indexes.keep(currentOf(await this.references()));
    return this.#written - before + copied + listed;
  }

  /**
   * What the tables say of each code: how it is written, and its name, status and ingredients from the first held
   * series of each kind in the order of preference that holds it. Every code asked is answered, with the rest absent
   * when no table says it.
   */
  about(codes: readonly string[]): Promise<Map<string, About>> {
    return about(this.#context, codes);
  }

  #terms(): Promise<TableTerms> {
    return tableTerms(this.#options.vocabulary, this.#options.newStore);
  }

  /** The tables a pod is given now. */
  async references(): Promise<References> {
    await this.#start();
    return this.#references.get();
  }

  /**
   * The version of each held series a pod opened now is given. An empty store answers from the starter copies it starts
   * from, without waiting for them to be copied, so a pod's kept answers are read on a first visit before they are.
   */
  async current(): Promise<readonly string[]> {
    const bytes = await this.#readable(HELD);
    return bytes === undefined ? [] : heldOf(bytes).current;
  }

  /** The versions the pod was last opened with; none if it never was. */
  async openedWith(pod: string): Promise<readonly string[] | undefined> {
    return (await this.#held.read()).pods[pod];
  }

  /**
   * Records that the pod was opened with the versions and, given, the name the app opened it by.
   */
  opened(
    pod: string,
    versions: readonly string[],
    name?: string,
  ): Promise<void> {
    return this.#held.change((held) => ({
      ...held,
      pods: { ...held.pods, [pod]: versions },
      ...(name === undefined ? {} : { names: { ...held.names, [pod]: name } }),
    }));
  }

  /** Records the name the app opens the pod by, when it is not the one recorded. */
  async named(pod: string, name: string): Promise<void> {
    if ((await this.#held.read()).names?.[pod] === name) return;
    await this.#held.change((held) => ({
      ...held,
      names: { ...held.names, [pod]: name },
    }));
  }

  /** Each series the app holds, in the order of its feeds and then by label. */
  async held(): Promise<HeldSeries[]> {
    const held = await this.#held.read();
    let references = await this.references();
    // What is held names the current versions after each index written, so another app on the store has changed the
    // index when they differ.
    if (
      JSON.stringify(currentOf(references)) !== JSON.stringify(held.current)
    ) {
      this.#forgetIndex();
      references = await this.references();
    }
    return heldSeries(references.index, held, this.#options.feeds);
  }

  /** The pods last opened with each version, by the names the app opened them by, sorted. */
  async uses(): Promise<Record<string, string[]>> {
    const { pods, names = {} } = await this.#held.read();
    const using: Record<string, string[]> = {};
    for (const [pod, versions] of Object.entries(pods)) {
      const name = names[pod];
      if (name === undefined) continue;
      for (const version of versions) (using[version] ??= []).push(name);
    }
    for (const named of Object.values(using)) named.sort();
    return using;
  }

  /**
   * The codes in the current version of the series, or of each of several, that are `text`, as written or as an IRI,
   * or whose name holds it, ignoring case; every code for no text. In the order of their codes, `PAGE_SIZE` a page,
   * the page numbered `page` from 1, each with what names and status say of it and, in a mapping series, the codes it
   * maps to.
   */
  search(
    series: string | readonly string[],
    text: string,
    page = 1,
  ): Promise<Searched> {
    return search(this.#context, series, text, page);
  }

  /**
   * The code written so in the current versions of the series, a code they list or one they map to, from the first
   * series that holds one; none when they hold none.
   */
  codeNamed(
    series: string | readonly string[],
    written: string,
  ): Promise<string | undefined> {
    return codeNamed(this.#context, series, written);
  }

  /**
   * For each code, the ingredients a different form of which the current drug classes versions class, where the code
   * reaches no class of that relation: RxNorm does not tie the code to that form. A code with none is left out.
   */
  classedElsewhere(codes: readonly string[]): Promise<Map<string, string[]>> {
    return classedElsewhere(this.#context, codes);
  }

  /** What every held series says of the code, or each of `among`, from its current version. */
  facts(code: string, among?: readonly string[]): Promise<Facts> {
    return facts(this.#context, code, among);
  }

  /**
   * The panels the current version of each panel members series lists the code in, at most a page of them by their
   * codes, with the sequence and requirement of the row that lists it, and how many there are in all; a series that
   * lists it in none is left out.
   */
  inPanels(
    code: string,
  ): Promise<(Fact & { total: number; panels: readonly Placed[] })[]> {
    return inPanels(this.#context, code);
  }

  /**
   * The rows `tables/panel-results.rq` reads of a panel: in the current version of each panel members series, the rows
   * that list a member of the panel or of a panel nested in it, however deep, each with the descriptions of the version
   * and its series. The rows of the panels that list the panel, or list a member of it, are left out: the query is
   * asked of this panel alone.
   */
  panelRows(panel: string): Promise<Described[]> {
    return panelRows(this.#context, panel);
  }

  /**
   * The rows a walk from these codes to their drug classes can read, for
   * `tables/medication-classes-through-precise-ingredients.rq`: in the current version of each drug classes series the
   * rows of the codes, their ingredients and their own precise ingredients, the only codes a class of theirs may be on;
   * in the current version of each product ingredients series the rows of those codes, and one precise ingredient row
   * where the version holds any, which says the version states them. Each comes with the descriptions of the version
   * and its series. A superset of what the query joins; the query says what is a class of what.
   */
  reached(codes: readonly string[]): Promise<Described[]> {
    return reached(this.#context, codes);
  }

  /**
   * What the app's current version of the first held variant classifications series that covers the variant's gene says
   * of the variant. The row is found as rule R13 finds it: through the variant's ClinVar IDs when it has any, through
   * its HGVS expressions only when it has none; one row answers, none or several are "not found".
   */
  variantClassification(variant: VariantAsked): Promise<WhatClinVarSays> {
    return variantClassification(this.#context, variant);
  }

  /** Each concept's `skos:prefLabel`, else `rdfs:label`, in the vocabulary's records ontology; a concept with neither is left out. */
  async labels(concepts: readonly string[]): Promise<Map<string, string>> {
    const known = await this.#concepts.get();
    return new Map(
      concepts.flatMap((concept) => {
        const label = known.get(concept);
        return label === undefined ? [] : [[concept, label] as const];
      }),
    );
  }

  #next<T>(call: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      await this.#start();
      return call();
    };
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  /**
   * An empty store starts from the starter copies' index and what they hold, and again whenever it is emptied, as
   * removing an app's pods does; their versions are read through on first use. What is held is written last, so a
   * start cut short starts again.
   */
  #start(): Promise<void> {
    this.#started ??= (async () => {
      const { files, starter } = this.#options;
      const empty = (await files.read(HELD)) === undefined;
      if (empty) this.#forgetIndex();
      if (starter === undefined || !empty) return;
      const paths = await starter.list("");
      const ofVersions = new Set([...versionsIn(paths).values()].flat());
      for (const path of [
        ...paths.filter((path) => !ofVersions.has(path) && path !== HELD),
        ...paths.filter((path) => path === HELD),
      ]) {
        const bytes = await starter.read(path);
        if (bytes === undefined) continue;
        await files.write(path, bytes);
        this.#written += bytes.byteLength;
      }
      this.#forgetIndex();
    })().finally(() => {
      this.#started = undefined;
    });
    return this.#started;
  }

  /** The file stems of the versions the store's index names, so a start copies no version nothing reads. */
  async #shippedStems(): Promise<Set<string>> {
    const stems = new Set<string>();
    for (const [, , version] of (await this.#index()).match(
      undefined,
      SHIPS_WITH,
    )) {
      try {
        stems.add(fileStem(version.value));
      } catch {
        continue;
      }
    }
    return stems;
  }

  async #index(): Promise<Graph> {
    return this.#graph(await this.#files.read(INDEX));
  }

  /** Drops what was read of the store's index, once it is written. */
  #forgetIndex(): void {
    this.#references.forget();
  }

  /** The store's file at `path`, or, while the store holds nothing, the starter copy it starts from. */
  async #readable(path: string): Promise<Uint8Array | undefined> {
    const { files, starter } = this.#options;
    const held = (await files.read(HELD)) !== undefined;
    return held || starter === undefined
      ? files.read(path)
      : starter.read(path);
  }

  async #graph(bytes: Uint8Array | undefined): Promise<Graph> {
    return new Graph(
      bytes === undefined
        ? []
        : await this.#options.newStore().parse(bytes, this.#options.files.iri),
    );
  }
}

/**
 * The starter copies: the store a check of the feeds keeps now, each version's rows in it as the feed published them
 * (`PUBLISHED_ROWS`) in place of its N-Triples, so they are carried at their published size, and its listing for
 * search beside it, so a new app lists nothing.
 */
export async function writeStarterCopies(
  options: Pick<TablesOptions, "feeds" | "vocabulary" | "newStore"> & {
    readonly fetch?: typeof fetch;
  },
  write: (path: string, bytes: Uint8Array) => Promise<void>,
): Promise<Checked[]> {
  const published = new Map<string, Uint8Array>();
  const fetching = options.fetch ?? fetch;
  const store = new MemoryFiles("urn:cascade:starter-tables/");
  const checked = await new Tables({
    ...options,
    files: store,
    fetch: async (input, init) => {
      const response = await fetching(input, init);
      if (!response.ok) return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const nquads = await gunzipped(bytes).catch(() => "");
        const [, version] = / <([^<>]*)> \.$/m.exec(nquads) ?? [];
        if (version !== undefined)
          published.set(`${fileStem(version)}.ttl`, bytes);
      }
      return new Response(bytes, { status: response.status });
    },
  }).check({ cache: "no-cache" });
  for (const path of await store.list("")) {
    const rows = published.get(path);
    if (rows !== undefined)
      await write(`${path.slice(0, -".ttl".length)}${PUBLISHED_ROWS}`, rows);
    else await write(path, (await store.read(path))!);
  }
  return checked;
}
