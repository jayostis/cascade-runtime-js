import type { PodState, VocabularyBuild } from "./build.js";
import { addLayout, podFiles } from "./dataset.js";
import { DERIVED, type DerivedStep, type Keep } from "./derive.js";
import { ENTRY_PLACEHOLDER, unionFind } from "./entries.js";
import type { Files } from "./files.js";
import type { Layout } from "./layout.js";
import { type Term, type Triple, written } from "./rdf.js";
import { type StoreFactory, Union } from "./store.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const IN_ENTRY = `${CASCADE}inEntry`;
const LEFT_OUT_FOR = `${CASCADE}leftOutFor`;
const MEMBERS_JOINED = `${CASCADE}membersJoinedByCurrentTableVersion`;
const PREFIXES = `PREFIX cascade: <${CASCADE}>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX oa: <http://www.w3.org/ns/oa#>
PREFIX pav: <http://purl.org/pav/>
PREFIX prov: <${PROV}>
`;
/** The IRIs one query binds: Oxigraph's JavaScript build joins a long VALUES block in more than linear time. */
const AT_ONCE = 256;

/** What a pod's build reads besides the pod's files. */
export interface Rebuilding {
  readonly pod: Files;
  readonly layout: Layout;
  readonly address: string;
  readonly newStore: StoreFactory;
  readonly build: VocabularyBuild;
  readonly lens: string;
  /** What `Keep` derives over a union, the cache of one step aside: a scope holds only some records. */
  readonly keep: Keep;
}

/** What a step changed: every file it wrote, those that arrived from another writer among them. */
export interface Change {
  readonly written: readonly string[];
  /** A step that changes every record's inputs at once: an open, which gives the pod its tables, or a migration of the rule list versions. */
  readonly everything?: boolean;
}

function values(iris: Iterable<string>): string {
  return [...iris].map((value) => `<${value}>`).join(" ");
}

function batches<T>(all: readonly T[]): T[][] {
  const found: T[][] = [];
  for (let start = 0; start < all.length; start += AT_ONCE)
    found.push(all.slice(start, start + AT_ONCE));
  return found;
}

/**
 * The query's first variable's values, the query run once for each batch of the IRIs bound as `?bound`. Several
 * patterns are alternatives, each given the IRIs itself: Oxigraph's JavaScript build evaluates a UNION whole before
 * joining it to the VALUES outside it.
 */
async function boundValues(
  union: Union,
  iris: Iterable<string>,
  where: string | readonly string[],
  variable = "found",
): Promise<Set<string>> {
  const found = new Set<string>();
  const patterns = typeof where === "string" ? [where] : where;
  for (const batch of batches([...new Set(iris)])) {
    const bound = `VALUES ?bound { ${values(batch)} }`;
    const { rows } = await union.select(
      `${PREFIXES}SELECT DISTINCT ?${variable} WHERE { ${patterns.map((pattern) => `{ ${bound} ${pattern} }`).join(" UNION ")} }`,
    );
    for (const row of rows) {
      const value = row.get(variable);
      if (value?.termType === "NamedNode") found.add(value.value);
    }
  }
  return found;
}

/** The triples by their subjects' IRIs. */
function bySubject(triples: Iterable<Triple>): Map<string, Triple[]> {
  const found = new Map<string, Triple[]>();
  for (const triple of triples) {
    const held = found.get(triple[0].value);
    if (held === undefined) found.set(triple[0].value, [triple]);
    else held.push(triple);
  }
  return found;
}

/**
 * A view's triples by the entry each is of: the entry's own, and those of each node named after it (`<entry>-…`);
 * the view's own under "".
 */
function byEntry(
  view: string,
  triples: Iterable<Triple>,
): Map<string, Triple[]> {
  const found = new Map<string, Triple[]>();
  for (const triple of triples) {
    const subject = triple[0].value;
    const key = subject.startsWith(`${view}#`)
      ? subject.replace(/-[^#]*$/, "")
      : subject === view
        ? ""
        : subject;
    const held = found.get(key);
    if (held === undefined) found.set(key, [triple]);
    else held.push(triple);
  }
  return found;
}

function flat(groups: ReadonlyMap<string, readonly Triple[]>): Triple[] {
  return [...groups.values()].flat();
}

/**
 * The build of a pod kept across its steps (currency.md, row "view"): the pod's files, the lens's derived state and
 * the files the build writes, in one union. A step rebuilds only the records it wrote revisions for and those its
 * judgments reach, closed over each one's entry, by deriving them again over the files every record's state reads
 * (the scope) and theirs, and putting what that gives in place of what the union held of them. A step that writes
 * anything else, or changes what every record reads, is rebuilt whole.
 */
export class KeptBuild {
  readonly union: Union;
  readonly #rebuilding: Rebuilding;
  /** The paths of the pod's files the union holds. */
  readonly #loaded: Set<string>;
  /** Each view of the clinical kinds, by its path, its triples by entry. */
  readonly #views = new Map<string, Map<string, Triple[]>>();
  /** Each other file the build's queries write, by its path, its triples by subject. */
  readonly #others = new Map<string, Map<string, Triple[]>>();
  /** Each view written always, by its path. */
  readonly #always = new Map<string, readonly Triple[]>();
  #held: ReadonlySet<string>;
  /** The subjects of the derived state that are no record's, its version's or revision's, or its entry's. */
  #globalDerived: Set<string>;
  /** Every judgment and every retraction the scope holds. */
  readonly #judging = new Set<string>();
  /** The files every record's state reads, held across steps; made when a step first needs it. */
  #scope: Union | undefined;
  readonly #scopeLoaded = new Set<string>();

  private constructor(
    rebuilding: Rebuilding,
    union: Union,
    loaded: Set<string>,
    held: ReadonlySet<string>,
  ) {
    this.#rebuilding = rebuilding;
    this.union = union;
    this.#loaded = loaded;
    this.#held = held;
    this.#globalDerived = new Set();
  }

  get #derived(): string {
    return DERIVED + this.#rebuilding.lens;
  }

  /** The kinds whose views list entries of records: every view the layout does not mark written always. */
  get #clinicalKinds(): string[] {
    return this.#rebuilding.layout.views.flatMap(({ kind, writtenAlways }) =>
      kind === undefined || writtenAlways ? [] : [kind],
    );
  }

  /** The kinds of the records filed with their versions and revisions that no view of a clinical kind lists. */
  get #unviewedKinds(): string[] {
    const viewed = new Set(
      this.#rebuilding.layout.views.flatMap(({ kind }) => kind ?? []),
    );
    return this.#rebuilding.layout.recordPlacements.flatMap(({ kind }) =>
      kind === undefined || viewed.has(kind) ? [] : [kind],
    );
  }

  /**
   * The folders of records every scope holds whole, whose files a step may write and still be rebuilt in part: those
   * of a kind a view written always lists, the patient profiles; and the servers', until two servers are judged the
   * same and the records under them are joined.
   */
  #wholeRecordFolders(serversJoined: boolean): string[] {
    const always = new Set(
      this.#rebuilding.layout.views.flatMap(({ kind, writtenAlways }) =>
        writtenAlways && kind !== undefined ? [kind] : [],
      ),
    );
    return this.#rebuilding.layout.recordPlacements.flatMap(
      ({ kind, folder }) =>
        folder !== undefined &&
        kind !== undefined &&
        (always.has(kind) || (!serversJoined && kind === `${CASCADE}Server`))
          ? [folder]
          : [],
    );
  }

  #serversJoined(): Promise<boolean> {
    return this.union.ask(
      `${PREFIXES}ASK { ?one a cascade:Server ; cascade:currentlySame ?two . ?two a cascade:Server }`,
    );
  }

  get #clinicalFolders(): string[] {
    const clinical = new Set(this.#clinicalKinds);
    return this.#rebuilding.layout.recordPlacements.flatMap(
      ({ kind, folder }) =>
        kind !== undefined && clinical.has(kind) && folder !== undefined
          ? [folder]
          : [],
    );
  }

  /** The folders of the files a step may write and still be rebuilt in part: acts, documents, judgments and findings. */
  get #partFolders(): string[] {
    const { layout } = this.#rebuilding;
    return [
      ...layout.actFolders,
      ...(layout.syncsFolder === undefined ? [] : [layout.syncsFolder]),
      layout.place(`${PROV}Entity`).folder,
      layout.place(`${CASCADE}Judgment`).folder,
      layout.place(`${CASCADE}FindingForReview`).folder,
      this.#referencesFolder,
    ].filter((folder): folder is string => folder !== undefined);
  }

  get #referencesFolder(): string | undefined {
    return this.#rebuilding.layout.place(`${CASCADE}ReferenceSeries`).folder;
  }

  /**
   * Whether the reference descriptions the step wrote leave the current version of every series the pod described
   * before as it was: a new current table or rule list version changes what every record's judgments count, where a
   * series described for the first time changes only the judgments that used it.
   */
  async #currentVersionsKept(): Promise<boolean> {
    const { build, lens } = this.#rebuilding;
    const current = build.derivations
      .for(lens)
      .find(({ path }) => path.endsWith("/current-reference-versions.rq"));
    if (current === undefined) return false;
    const currentOf = (triples: readonly Triple[]) => {
      const found = new Map<string, Set<string>>();
      for (const [series, , version] of triples) {
        const held = found.get(series.value) ?? new Set<string>();
        held.add(version.value);
        found.set(series.value, held);
      }
      return found;
    };
    const now = currentOf(await this.union.construct(current.query));
    const before = currentOf(
      await this.union.construct(
        `${PREFIXES}CONSTRUCT { ?series pav:hasCurrentVersion ?version } WHERE { GRAPH <${this.#derived}> { ?series pav:hasCurrentVersion ?version } ?series a cascade:ReferenceSeries }`,
      ),
    );
    return [...before].every(([series, versions]) => {
      const held = now.get(series);
      return (
        held !== undefined &&
        held.size === versions.size &&
        [...held].every((version) => versions.has(version))
      );
    });
  }

  /** The pod's files, the lens's derived state, every file the build writes and the layout, built whole. */
  static async whole(
    rebuilding: Rebuilding,
    pod: PodState,
  ): Promise<{
    kept: KeptBuild;
    files: ReadonlyMap<string, readonly Triple[]>;
  }> {
    const { layout, address, newStore, build, lens, keep } = rebuilding;
    const rebuilt = new Set(layout.rebuilt);
    const paths = (await rebuilding.pod.list("")).filter(
      (path) => layout.isRdf(path) && !rebuilt.has(path),
    );
    const union = new Union(newStore());
    await podFiles(rebuilding.pod, layout, address, union, paths);
    const derived = await build.derivations.derive(union, lens, keep);
    const { files, held } = await build.queried(union, address);
    const all = new Map(files);
    for (const [path, triples] of build.closing(pod, held)) {
      all.set(path, triples);
      await union.add(triples, address + path);
    }
    await addLayout(union, layout, address);
    const kept = new KeptBuild(rebuilding, union, new Set(paths), held);
    kept.#index(files);
    const owned = await kept.#recordsAndTheirs();
    kept.#globalDerived = KeptBuild.#global(derived, owned);
    return { kept, files: all };
  }

  #index(files: ReadonlyMap<string, readonly Triple[]>): void {
    const { layout, address } = this.#rebuilding;
    for (const { file, writtenAlways } of layout.views) {
      const triples = files.get(file ?? "");
      if (triples === undefined) continue;
      if (writtenAlways) this.#always.set(file ?? "", triples);
      else
        this.#views.set(file ?? "", byEntry(address + (file ?? ""), triples));
    }
    const views = new Set(layout.views.map(({ file }) => file));
    for (const [path, triples] of files)
      if (!views.has(path)) this.#others.set(path, bySubject(triples));
  }

  /**
   * Every record the union holds, with its versions and revisions: read from the union, since a derivation adds no
   * triple a file states already, such as a judgment's file typing a record.
   */
  async #recordsAndTheirs(): Promise<Set<string>> {
    const { rows } = await this.union.select(
      `${PREFIXES}SELECT ?owned WHERE { { ?owned a cascade:Record } UNION { ?owned prov:specializationOf|cascade:revisionOf ?record . ?record a cascade:Record } }`,
    );
    return new Set(rows.flatMap((row) => row.get("owned")?.value ?? []));
  }

  /** The subjects of the derivations' additions that are no record's, nor its version's, revision's, entry's or left-out's. */
  static #global(
    derived: readonly DerivedStep[],
    owned: ReadonlySet<string>,
  ): Set<string> {
    const recordish = new Set<string>();
    for (const { added } of derived)
      for (const [, predicate, object] of added)
        if (predicate.value === LEFT_OUT_FOR) recordish.add(object.value);
    const found = new Set<string>();
    for (const { added } of derived)
      for (const [subject] of added) {
        const value = subject.value;
        if (
          !recordish.has(value) &&
          !owned.has(value) &&
          !value.startsWith(ENTRY_PLACEHOLDER)
        )
          found.add(value);
      }
    return found;
  }

  /** The files every record's state reads: every file of the pod but those of records of the clinical kinds. */
  async #scoped(): Promise<Union> {
    if (this.#scope !== undefined) return this.#scope;
    const { pod, layout, address, newStore } = this.#rebuilding;
    const clinical = this.#clinicalFolders;
    const paths = [...this.#loaded].filter(
      (path) => !clinical.some((folder) => path.startsWith(folder)),
    );
    const scope = new Union(newStore());
    await podFiles(pod, layout, address, scope, paths);
    for (const path of paths) this.#scopeLoaded.add(path);
    await this.#learnJudging(scope, paths);
    this.#scope = scope;
    return scope;
  }

  /** Learns each judgment and retraction the files hold. */
  async #learnJudging(scope: Union, paths: readonly string[]): Promise<void> {
    const { address } = this.#rebuilding;
    for (const found of await boundValues(
      scope,
      paths.map((path) => address + path),
      [
        `GRAPH ?bound { ?found a cascade:Judgment }`,
        `GRAPH ?bound { ?found prov:invalidated ?retracted }`,
      ],
    ))
      this.#judging.add(found);
  }

  /**
   * Throws where this build and the whole one differ: in the derived state, or in a file the build writes, as the
   * union holds it or as it would be written.
   */
  async verify(whole: {
    kept: KeptBuild;
    files: ReadonlyMap<string, readonly Triple[]>;
  }): Promise<void> {
    const { address, layout } = this.#rebuilding;
    const graphOf = async (union: Union, graph: string) =>
      described(
        await union.construct(
          `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${graph}> { ?s ?p ?o } }`,
        ),
      );
    const graphsOf = async (union: Union) =>
      new Set(
        (
          await union.select(
            "SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }",
          )
        ).rows.flatMap((row) => row.get("g")?.value ?? []),
      );
    const differences: string[] = [];
    const compare = (
      what: string,
      kept: ReadonlyMap<string, number>,
      built: ReadonlyMap<string, number>,
    ) => {
      const beyond = (a: ReadonlyMap<string, number>, b: typeof a) =>
        [...a]
          .flatMap(([line, count]) =>
            Array<string>(Math.max(0, count - (b.get(line) ?? 0))).fill(line),
          )
          .sort();
      const extra = beyond(kept, built);
      const missing = beyond(built, kept);
      if (extra.length > 0 || missing.length > 0)
        differences.push(
          `${what}: ${extra.length} more, ${missing.length} fewer than built whole\n` +
            [
              ...extra.slice(0, 8).map((line) => `+ ${line}`),
              ...missing.slice(0, 8).map((line) => `- ${line}`),
            ].join("\n"),
        );
    };
    const keptGraphs = await graphsOf(this.union);
    const builtGraphs = await graphsOf(whole.kept.union);
    const listed = (graphs: ReadonlySet<string>) =>
      new Map([...graphs].map((graph) => [graph, 1]));
    compare("the graphs", listed(keptGraphs), listed(builtGraphs));
    const manifest = address + layout.manifest;
    const loaded = new Set([...this.#loaded].map((path) => address + path));
    for (const graph of new Set([...keptGraphs, ...builtGraphs]))
      if (graph !== manifest && !loaded.has(graph))
        compare(
          graph === this.#derived
            ? "the derived state"
            : `${graph} in the union`,
          await graphOf(this.union, graph),
          await graphOf(whole.kept.union, graph),
        );
    for (const [path, triples] of whole.files) {
      if (path === layout.manifest) continue;
      const kept = this.#views.get(path) ?? this.#others.get(path) ?? undefined;
      const writing =
        kept !== undefined ? flat(kept) : (this.#always.get(path) ?? undefined);
      if (writing !== undefined)
        compare(`${path} as written`, described(writing), described(triples));
    }
    whole.kept.free();
    if (differences.length > 0)
      throw new Error(
        `the build in part differs from the build whole:\n${differences.join("\n")}`,
      );
  }

  /** Frees what the build holds in the store's memory. */
  free(): void {
    for (const union of [this.union, this.#scope])
      (union?.store as { free?: () => void } | undefined)?.free?.();
    this.#scope = undefined;
  }

  /**
   * Rebuilds after a step that changed what `change` says, returning each file the build writes that changed; or
   * undefined, leaving the union as it was but the step's files, when the step must be rebuilt whole: it wrote a file
   * outside the records of the clinical kinds, the acts, the documents, the judgments and the findings, or reached a
   * record of another kind, or it is a migration.
   */
  async step(
    change: Change,
    pod: PodState,
  ): Promise<ReadonlyMap<string, readonly Triple[]> | undefined> {
    if (change.everything) return undefined;
    const { layout, address } = this.#rebuilding;
    const rebuilt = new Set(layout.rebuilt);
    const clinicalFolders = this.#clinicalFolders;
    const partFolders = this.#partFolders;
    const fresh = [...new Set(change.written)].filter(
      (path) => layout.isRdf(path) && !rebuilt.has(path),
    );
    if (fresh.some((path) => this.#loaded.has(path))) return undefined;
    const clinicalPaths: string[] = [];
    const sharedPaths: string[] = [];
    const wholeRecords = this.#wholeRecordFolders(await this.#serversJoined());
    for (const path of fresh) {
      if (clinicalFolders.some((folder) => path.startsWith(folder)))
        clinicalPaths.push(path);
      else if (
        [...partFolders, ...wholeRecords].some((folder) =>
          path.startsWith(folder),
        )
      )
        sharedPaths.push(path);
      else return undefined;
    }
    const scope = await this.#scoped();
    await podFiles(this.#rebuilding.pod, layout, address, this.union, fresh);
    for (const path of fresh) this.#loaded.add(path);
    const newShared = sharedPaths.filter(
      (path) => !this.#scopeLoaded.has(path),
    );
    await podFiles(this.#rebuilding.pod, layout, address, scope, newShared);
    for (const path of newShared) this.#scopeLoaded.add(path);
    await this.#learnJudging(scope, newShared);
    if (await this.#namedBefore(sharedPaths, fresh)) return undefined;

    const references = this.#referencesFolder;
    const described = sharedPaths.filter(
      (path) => references !== undefined && path.startsWith(references),
    );
    if (described.length > 0 && !(await this.#currentVersionsKept()))
      return undefined;
    const reached = await this.#reached(
      clinicalPaths,
      sharedPaths.filter((path) => !described.includes(path)),
      described,
    );
    if (reached === undefined) return undefined;
    const acts = [
      ...layout.actFolders,
      ...(layout.syncsFolder === undefined ? [] : [layout.syncsFolder]),
    ];
    if (
      reached.records.size === 0 &&
      sharedPaths.every((path) =>
        acts.some((folder) => path.startsWith(folder)),
      )
    )
      return this.#closing(pod);
    const records = await this.#closed(reached.records);
    return this.#rebuilt(records, reached.claims, sharedPaths, scope, pod);
  }

  /**
   * Whether a file the step wrote, of no record of a clinical kind, describes a thing a file held before named but no
   * file held before described: what named it was built as if it were absent, so its arrival can change what any
   * record's state reads.
   */
  async #namedBefore(
    paths: readonly string[],
    stepWrote: readonly string[],
  ): Promise<boolean> {
    const { address } = this.#rebuilding;
    const written = new Set(paths.map((path) => address + path));
    const now = new Set(stepWrote);
    const held = (graph: string) => {
      const path = graph.startsWith(address) ? graph.slice(address.length) : "";
      return this.#loaded.has(path) && !now.has(path);
    };
    const heldIn = async (things: Iterable<string>, pattern: string) => {
      const found = new Set<string>();
      for (const batch of batches([...new Set(things)])) {
        const { rows } = await this.union.select(
          `SELECT DISTINCT ?thing ?graph WHERE { VALUES ?thing { ${values(batch)} } GRAPH ?graph { ${pattern} } }`,
        );
        for (const row of rows) {
          const thing = row.get("thing")?.value;
          const graph = row.get("graph")?.value;
          if (thing !== undefined && graph !== undefined && held(graph))
            found.add(thing);
        }
      }
      return found;
    };
    const things = await boundValues(
      this.union,
      written,
      `GRAPH ?bound { ?found ?p ?o }`,
    );
    const describedBefore = await heldIn(things, "?thing ?p ?o");
    const named = await heldIn(
      [...things].filter((thing) => !describedBefore.has(thing)),
      "?s ?p ?thing",
    );
    return named.size > 0;
  }

  /** Only the type index and the manifest, after a step that wrote no file another reads but an act's. */
  async #closing(
    pod: PodState,
  ): Promise<ReadonlyMap<string, readonly Triple[]>> {
    const { address, build } = this.#rebuilding;
    const files = build.closing(pod, this.#held);
    for (const [path, triples] of files) {
      await this.union.drop(address + path);
      await this.union.add(triples, address + path);
    }
    return files;
  }

  /**
   * The records of the clinical kinds the step wrote files of, and those its judgments, retractions, assertions and
   * findings reach: their members, through what each retracts, replaces, asserts or targets; a revision's record; and
   * each record an act a judgment names wrote a revision of; with the claims that used a reference version the step
   * described, which reach their records the same way. Undefined when they reach a record of another kind.
   */
  async #reached(
    clinicalPaths: readonly string[],
    sharedPaths: readonly string[],
    described: readonly string[],
  ): Promise<
    { readonly records: Set<string>; readonly claims: Set<string> } | undefined
  > {
    const { address } = this.#rebuilding;
    const union = this.union;
    const found = await boundValues(
      union,
      clinicalPaths.map((path) => address + path),
      [
        `GRAPH ?bound { ?x cascade:revisionOf ?found }`,
        `GRAPH ?bound { ?x prov:specializationOf ?found }`,
        `GRAPH ?bound { ?found a ?kind VALUES ?kind { ${values(this.#clinicalKinds)} } }`,
      ],
    );
    const { layout } = this.#rebuilding;
    const judgingFolders = [
      layout.place(`${CASCADE}Judgment`).folder,
      layout.place(`${CASCADE}FindingForReview`).folder,
    ].filter((folder): folder is string => folder !== undefined);
    const judging = sharedPaths.filter((path) =>
      judgingFolders.some((folder) => path.startsWith(folder)),
    );
    const walk = `(prov:hadMember|prov:invalidated|dct:replaces|cascade:assertedClaim|oa:hasTarget)*`;
    const named = await boundValues(
      union,
      judging.map((path) => address + path),
      `GRAPH ?bound { ?start a ?type } ?start ${walk} ?found`,
    );
    const claims = await boundValues(
      union,
      described.map((path) => address + path),
      `GRAPH ?bound { ?version prov:specializationOf ?series } ?found prov:used ?version`,
    );
    for (const reached of await boundValues(
      union,
      claims,
      `?bound ${walk} ?found`,
    ))
      named.add(reached);
    if (named.size === 0) return { records: found, claims };
    const other = values(this.#unviewedKinds);
    const elsewhere = await boundValues(union, named, [
      `?bound a ?kind VALUES ?kind { ${other} } BIND (?bound AS ?found)`,
      `?bound cascade:revisionOf/a ?kind VALUES ?kind { ${other} } BIND (?bound AS ?found)`,
    ]);
    if (elsewhere.size > 0) return undefined;
    for (const record of await boundValues(union, named, [
      `?bound a cascade:Record BIND (?bound AS ?found)`,
      `?bound cascade:revisionOf ?found . ?found a cascade:Record`,
      `?revision prov:wasGeneratedBy ?bound ; cascade:revisionOf ?found . ?found a cascade:Record`,
      `?version ?names ?bound ; prov:specializationOf ?found . ?found a cascade:Record`,
    ]))
      found.add(record);
    return { records: found, claims };
  }

  /**
   * The records with every record whose state or entry could change with theirs, to a fixed point: each currently the
   * same as one, before the step or by a judgment it wrote (which names both); each whose version names one, or that a
   * version of one names; each with the same source record id, once two servers are judged the same; and every member
   * of a matcher Same over an older table version with one among its members, whose joining M7 decides by their current
   * versions.
   */
  async #closed(start: ReadonlySet<string>): Promise<Set<string>> {
    const union = this.union;
    const serversJoined = await this.#serversJoined();
    const same = await this.#currentlySame();
    const records = new Set(start);
    let frontier = [...start];
    while (frontier.length > 0) {
      const next = new Set<string>();
      const add = (found: Iterable<string>) => {
        for (const record of found)
          if (!records.has(record)) {
            records.add(record);
            next.add(record);
          }
      };
      for (const record of frontier) add(same(record));
      add(
        await boundValues(union, frontier, [
          `?version prov:specializationOf ?bound ; ?names ?found . ?found a cascade:Record
           FILTER (?names != prov:specializationOf)`,
          `?version ?names ?bound ; prov:specializationOf ?found . ?found a cascade:Record
           FILTER (?names != prov:specializationOf)`,
        ]),
      );
      if (serversJoined)
        add(
          await boundValues(
            union,
            frontier,
            `?bound cascade:sourceRecordId ?id . ?found cascade:sourceRecordId ?id ; a cascade:Record`,
          ),
        );
      add(
        await boundValues(
          union,
          frontier,
          `?claim prov:hadMember ?bound ; prov:wasAttributedTo cascade:CascadeMatcher ; cascade:verdict cascade:Same ;
                  prov:used ?input ; prov:hadMember ?found .
           ?found a cascade:Record .
           ?input prov:specializationOf ?series .
           ?series a cascade:ReferenceSeries ; pav:hasCurrentVersion ?now .
           FILTER (?now != ?input)`,
        ),
      );
      frontier = [...next];
    }
    return records;
  }

  /**
   * What each thing reaches through `cascade:currentlySame` either way, itself among it: its component of the pairs, by
   * union-find, where the path `(cascade:currentlySame|^cascade:currentlySame)*` walks the union from each thing.
   */
  async #currentlySame(): Promise<(thing: string) => readonly string[]> {
    const { rows } = await this.union.select(
      `${PREFIXES}SELECT ?one ?other WHERE { ?one cascade:currentlySame ?other }`,
    );
    const { root, joined } = unionFind(rows);
    const members = new Map<string, string[]>();
    for (const name of joined) {
      const top = root(name);
      const held = members.get(top);
      if (held === undefined) members.set(top, [name]);
      else held.push(name);
    }
    return (thing) => {
      const found = members.get(root(`<${thing}>`));
      return found === undefined
        ? [thing]
        : found.flatMap((name) =>
            name.startsWith("<") ? [name.slice(1, -1)] : [],
          );
    };
  }

  /**
   * The files of the pod's records of the clinical kinds holding the records, with their versions and revisions: the
   * scope holds every other file already, and keeps it.
   */
  async #filesOf(records: Iterable<string>): Promise<string[]> {
    const { address } = this.#rebuilding;
    const clinical = this.#clinicalFolders;
    const graphs = await boundValues(this.union, records, [
      `GRAPH ?found { ?bound a ?kind }`,
      `GRAPH ?found { ?owned prov:specializationOf ?bound }`,
      `GRAPH ?found { ?owned cascade:revisionOf ?bound }`,
    ]);
    return [...graphs].flatMap((graph) => {
      const path = graph.startsWith(address) ? graph.slice(address.length) : "";
      return this.#loaded.has(path) &&
        clinical.some((folder) => path.startsWith(folder))
        ? [path]
        : [];
    });
  }

  async #rebuilt(
    records: ReadonlySet<string>,
    describedClaims: ReadonlySet<string>,
    sharedPaths: readonly string[],
    scope: Union,
    pod: PodState,
  ): Promise<ReadonlyMap<string, readonly Triple[]>> {
    const { layout, address, build, lens, keep } = this.#rebuilding;
    const union = this.union;
    const derivedGraph = this.#derived;
    const writtenGraphs = sharedPaths.map((path) => address + path);

    const judgments = await boundValues(
      union,
      records,
      `?found prov:hadMember ?bound ; a cascade:Judgment`,
    );
    for (const judgment of await boundValues(
      union,
      writtenGraphs,
      `GRAPH ?bound { ?found a cascade:Judgment }`,
    ))
      judgments.add(judgment);
    const retractions = await boundValues(union, judgments, [
      `?found prov:invalidated ?bound`,
      `?found prov:invalidated ?assertion . ?assertion cascade:assertedClaim ?bound`,
    ]);
    for (const retraction of await boundValues(
      union,
      writtenGraphs,
      `GRAPH ?bound { ?found prov:invalidated ?retracted }`,
    ))
      retractions.add(retraction);
    const members = await boundValues(
      union,
      judgments,
      `?bound prov:hadMember ?found . ?found a cascade:Record`,
    );
    const read = new Set([...records, ...members]);

    const ownedBy = [
      `?found prov:specializationOf ?bound`,
      `?found cascade:revisionOf ?bound`,
    ];
    const owned = await boundValues(union, records, ownedBy);
    const ownedRead = await boundValues(union, read, ownedBy);
    const oldLeftOut = await boundValues(
      union,
      records,
      `GRAPH <${derivedGraph}> { ?bound cascade:leftOutFor ?found }`,
    );
    const oldEntries = await boundValues(
      union,
      records,
      `GRAPH <${derivedGraph}> { ?bound cascade:inEntry ?found }`,
    );

    const paths = await this.#filesOf(read);
    await podFiles(this.#rebuilding.pod, layout, address, scope, paths);
    const touchesStale = await boundValues(
      union,
      records,
      `?found prov:hadMember ?bound ; prov:wasAttributedTo cascade:CascadeMatcher ; cascade:verdict cascade:Same ;
              prov:used ?input .
       ?input prov:specializationOf ?series .
       ?series a cascade:ReferenceSeries ; pav:hasCurrentVersion ?now .
       FILTER (?now != ?input)`,
    );
    for (const claim of describedClaims) touchesStale.add(claim);
    const keptBefore = (
      await union.construct(
        `CONSTRUCT { ?claim <${MEMBERS_JOINED}> ?now } WHERE { GRAPH <${derivedGraph}> { ?claim <${MEMBERS_JOINED}> ?now } }`,
      )
    ).filter(([claim]) => !touchesStale.has(claim.value));
    const scopedKeep: Keep = async (held) =>
      touchesStale.size === 0
        ? keptBefore
        : [
            ...(await keep(held)).filter(([claim]) =>
              touchesStale.has(claim.value),
            ),
            ...keptBefore,
          ];
    const derived = await build.derivations.derive(scope, lens, scopedKeep);
    const held = await build.held(union, this.#held);
    const { files } = await build.queried(scope, address, held);

    // The derived state.
    const added = derived.flatMap(({ added: triples }) => triples);
    const newEntries = new Set<string>();
    const newLeftOut = new Set<string>();
    // The scope holds what any file but a record's own says of a record, such as a judgment's file typing it, so it can
    // leave out a record it holds no version of: only the left-outs of the records rebuilt are kept.
    const otherLeftOut = new Set<string>();
    for (const [subject, predicate, object] of added) {
      if (predicate.value === IN_ENTRY && records.has(subject.value))
        newEntries.add(object.value);
      if (predicate.value === LEFT_OUT_FOR) {
        if (records.has(subject.value)) newLeftOut.add(object.value);
        else otherLeftOut.add(object.value);
      }
    }
    const inScope = new Set([
      ...records,
      ...owned,
      ...newEntries,
      ...newLeftOut,
    ]);
    const elsewhere = new Set([...read, ...ownedRead, ...otherLeftOut]);
    const candidates = new Set<string>();
    for (const [subject] of added) {
      const value = subject.value;
      if (
        !inScope.has(value) &&
        !elsewhere.has(value) &&
        !value.startsWith(ENTRY_PLACEHOLDER)
      )
        candidates.add(value);
    }
    for (const recordish of await boundValues(union, candidates, [
      `?bound a cascade:Record BIND (?bound AS ?found)`,
      `?bound prov:specializationOf ?record . ?record a cascade:Record BIND (?bound AS ?found)`,
      `?bound cascade:revisionOf ?record . ?record a cascade:Record BIND (?bound AS ?found)`,
    ]))
      candidates.delete(recordish);
    await union.removeSubjects(derivedGraph, [
      ...records,
      ...owned,
      ...oldLeftOut,
      ...oldEntries,
      ...this.#globalDerived,
    ]);
    await union.add(
      added.filter(
        ([subject]) =>
          inScope.has(subject.value) || candidates.has(subject.value),
      ),
      derivedGraph,
    );
    this.#globalDerived = candidates;

    // The views.
    const changed = new Map<string, readonly Triple[]>();
    const hashes = (entries: Iterable<string>) =>
      [...entries].map((entry) => entry.slice(ENTRY_PLACEHOLDER.length));
    const oldHashes = hashes(oldEntries);
    const newHashes = new Set(hashes(newEntries));
    const entryNames = new Set<string>();
    for (const { file, writtenAlways } of layout.views) {
      const path = file ?? "";
      const view = address + path;
      const made = files.get(path);
      if (writtenAlways) {
        if (made === undefined) continue;
        const before = this.#always.get(path) ?? [];
        if (sameTriples(before, made)) continue;
        for (const [subject] of [...before, ...made])
          if (subject.value !== view) entryNames.add(subject.value);
        await union.removeSubjects(
          view,
          before.map(([subject]) => subject.value),
        );
        await union.add(made, view);
        this.#always.set(path, made);
        changed.set(path, made);
        continue;
      }
      let groups = this.#views.get(path);
      const gone: string[] = [];
      for (const hash of oldHashes) {
        const entry = `${view}#${hash}`;
        entryNames.add(entry);
        const triples = groups?.get(entry);
        if (triples === undefined) continue;
        gone.push(...new Set(triples.map(([subject]) => subject.value)));
        groups?.delete(entry);
      }
      const fresh: Triple[] = [];
      if (made !== undefined) {
        const madeGroups = byEntry(view, made);
        if (groups === undefined) {
          groups = new Map();
          this.#views.set(path, groups);
        }
        const own = madeGroups.get("") ?? [];
        const before = groups.get("") ?? [];
        if (!sameTriples(before, own)) {
          gone.push(view);
          groups.set("", own);
          fresh.push(...own);
        }
        for (const [entry, triples] of madeGroups) {
          if (!newHashes.has(entry.slice(view.length + 1))) continue;
          entryNames.add(entry);
          groups.set(entry, triples);
          fresh.push(...triples);
        }
      }
      if (gone.length === 0 && fresh.length === 0) continue;
      await union.removeSubjects(view, gone);
      await union.add(fresh, view);
      if (groups !== undefined) changed.set(path, flat(groups));
    }
    this.#held = held;

    // The other files the queries write: the labels. Each gives a thing the least label of what describes it. The scope
    // holds every member of the judgments and retractions that reach a record and every version of each, so their labels
    // are taken from it as they are, as the records' and the entries' are: a judgment's label reads its members'
    // versions, whose first name can replace "no name". Of anything else what describes it only grows, so the least of
    // the old label and the scope's is the whole pod's; but the scope's label of a judgment or a retraction whose members
    // it lacks is none, nor that of an entry the act did not reach, which the scope may name from some of its members.
    const clinicalViews = layout.views.flatMap(({ file, writtenAlways }) =>
      writtenAlways || file === undefined ? [] : [address + file],
    );
    for (const [path, made] of files) {
      if (layout.views.some(({ file }) => file === path)) continue;
      const graph = address + path;
      const replaced = new Set([
        ...records,
        ...entryNames,
        ...judgments,
        ...retractions,
        graph,
      ]);
      const subjects = this.#others.get(path) ?? new Map<string, Triple[]>();
      this.#others.set(path, subjects);
      const madeBySubject = bySubject(made);
      const gone: string[] = [];
      const fresh: Triple[] = [];
      for (const subject of replaced)
        if (subjects.has(subject) && !madeBySubject.has(subject)) {
          subjects.delete(subject);
          gone.push(subject);
        }
      for (const [subject, triples] of madeBySubject) {
        if (
          !replaced.has(subject) &&
          ((this.#judging.has(subject) &&
            !judgments.has(subject) &&
            !retractions.has(subject)) ||
            clinicalViews.some((view) => subject.startsWith(`${view}#`)))
        )
          continue;
        const before = subjects.get(subject);
        const after =
          before === undefined || replaced.has(subject)
            ? triples
            : least(before, triples);
        if (before !== undefined && sameTriples(before, after)) continue;
        if (before !== undefined) gone.push(subject);
        subjects.set(subject, after);
        fresh.push(...after);
      }
      if (gone.length === 0 && fresh.length === 0) continue;
      await union.removeSubjects(graph, gone);
      await union.add(fresh, graph);
      changed.set(path, flat(subjects));
    }

    for (const [path, triples] of build.closing(pod, held)) {
      await union.drop(address + path);
      await union.add(triples, address + path);
      changed.set(path, triples);
    }

    for (const path of paths) await scope.drop(address + path);
    await scope.drop(derivedGraph);
    for (const path of files.keys()) await scope.drop(address + path);
    return changed;
  }
}

/**
 * The triples as lines counted, each blank node written as what it says, so two graphs that differ only in their blank
 * nodes' labels give the same lines, and two blank nodes saying the same thing count twice.
 */
function described(triples: readonly Triple[]): Map<string, number> {
  const blank = new Map<string, Triple[]>();
  const objects = new Set<string>();
  for (const triple of triples) {
    const [subject, , object] = triple;
    if (subject.termType === "BlankNode") {
      const held = blank.get(subject.value);
      if (held === undefined) blank.set(subject.value, [triple]);
      else held.push(triple);
    }
    if (object.termType === "BlankNode") objects.add(object.value);
  }
  const term = (value: Term, seen: ReadonlySet<string>): string => {
    if (value.termType !== "BlankNode") return written(value);
    if (seen.has(value.value)) return "[…]";
    const inside = new Set([...seen, value.value]);
    return `[ ${(blank.get(value.value) ?? [])
      .map(
        ([, predicate, object]) =>
          `${written(predicate)} ${term(object, inside)}`,
      )
      .sort()
      .join(" ; ")} ]`;
  };
  const counts = new Map<string, number>();
  for (const [subject, predicate, object] of triples) {
    if (subject.termType === "BlankNode" && objects.has(subject.value))
      continue;
    const line = `${term(subject, new Set())} ${written(predicate)} ${term(object, new Set())}`;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

/** Of the two descriptions of one thing, for each predicate the triple whose object is least. */
function least(a: readonly Triple[], b: readonly Triple[]): Triple[] {
  const found = new Map<string, Triple>();
  for (const triple of [...a, ...b]) {
    const held = found.get(triple[1].value);
    if (held === undefined || triple[2].value < held[2].value)
      found.set(triple[1].value, triple);
  }
  return [...found.values()];
}

function sameTriples(a: readonly Triple[], b: readonly Triple[]): boolean {
  const key = (triple: Triple) => triple.map(written).join(" ");
  const left = new Set(a.map(key));
  const right = new Set(b.map(key));
  return left.size === right.size && [...left].every((each) => right.has(each));
}
