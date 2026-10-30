import { ConnectRefused, readConnect } from "@cascade-runtime/fhir-pull";
import { fileConnect, fileEntry, fileExport } from "./arrivals.js";
import type { AdaptersOf } from "./bridge.js";
import {
  builtFileBytes,
  type Derive,
  type PodState,
  type VocabularyBuild,
} from "./build.js";
import { addLayout, built, podFiles, podStated } from "./dataset.js";
import type { Keep } from "./derive.js";
import { type Files, MemoryFiles, relative, writeAll } from "./files.js";
import { fileCreation, fileJudgment, fileReference } from "./filings.js";
import type { IdsAndTime } from "./ids.js";
import type { ExportDocument, Importer } from "./importer.js";
import { type Kept, KeptClaims } from "./kept.js";
import { HashedSet, type KeptSet } from "./kept-set.js";
import { LAYOUT_GRAPH, type Layout, SYNC } from "./layout.js";
import {
  MATCHER_LENS,
  matcherView,
  migrateRuleListVersions,
  openPod,
  podCodes,
  releaseRetractions,
  runMatcher,
} from "./matcher.js";
import {
  actDescriptionName,
  documentName,
  fileDigest,
  snapshotName,
} from "./names.js";
import { type Change, KeptBuild } from "./incremental.js";
import { type Act, same, StepWrites } from "./pod.js";
import { iri, literal, RDF, type Triple, XSD } from "./rdf.js";
import { type References, tableTerms } from "./references.js";
import { Shapes } from "./shapes.js";
import {
  type OnProgress,
  Refusal,
  type StepContext,
  type StepFile,
} from "./step.js";
import {
  RestorableUnion,
  type Rows,
  type Store,
  type StoreFactory,
  Union,
} from "./store.js";

const PROV = "http://www.w3.org/ns/prov#";
const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const TYPE = `${RDF}type`;
const DATASET = "dataset:";
const MATCHER_VIEW = "matcher view";
/**
 * The quads the matcher's views may remove from the kept build's store and add again before the build moves to a store
 * of its own: about 12 lends at 10,000 records, each moving some 175,000 quads.
 */
const COMPACT_AFTER_MOVED = 2_000_000;
const REVISION = "revision";
const KEPT = "kept";

export interface CorePodOptions {
  /** The pod's files, named by its address. */
  readonly pod: Files;
  readonly address: string;
  readonly subject: string;
  /** What the pod's manifest takes as its title. */
  readonly title: string;
  /** The vocabulary, whose queries the matcher and the build run. */
  readonly vocabulary: Files;
  readonly layout: Layout;
  readonly newStore: StoreFactory;
  readonly time: IdsAndTime;
  /** The importers `cascade-runtime.json` names, in its order. */
  readonly importers: readonly Importer[];
  /** The matcher's tables, read when a step first needs them. */
  readonly references: () => Promise<References>;
  /** The runtime performing the acts, as N7 names it: <repository>/tree/<commit>/. */
  readonly runtime: string;
  /**
   * The writer's last snapshot, which it keeps outside the pod (N14); a writer given none, or one the pod does not hold,
   * is a new writer.
   */
  readonly head?: Head;
  /** Told each new last snapshot once its act is written, to keep it outside the pod; a failure loses only the head. */
  readonly keepHead?: (head: Head) => Promise<void>;
  /**
   * When given, the files the build writes are rebuilt under the lens after every step and written to the pod: with
   * `incremental`, the build `derive` makes, kept across steps and rebuilt only where a step reached (currency.md,
   * row "view").
   */
  readonly build?: PodBuildOption;
}

/** The lens a pod's files are built under after every step, how, and the build to keep across steps. */
export interface PodBuildOption {
  readonly lens: string;
  readonly derive: Derive;
  readonly incremental?: VocabularyBuild;
  /** For tests: after each step rebuilt in part, builds the pod whole too, and throws where the two differ. */
  readonly verify?: boolean;
  /** The quads the matcher's views may remove from the kept build's store and add again before it is renewed. */
  readonly renewAfterMoved?: number;
}

/** A writer's last snapshot: its name and its set hash, and what it keeps of the set it hashed. */
export interface Head {
  readonly snapshot: string;
  readonly setHash: string;
  readonly set?: KeptSet;
}

/** What a step did. */
export interface Performed {
  /** The files new to the pod that it wrote, in the order it wrote them. */
  readonly wrote: readonly string[];
  /** Why the rules refused it; it then wrote nothing. */
  readonly refused?: string;
  /** The import or entry session it made. */
  readonly activity?: string;
  /** The versions the pod names that the tables an open was given do not hold (O2). */
  readonly unheld?: readonly string[];
  /** The files that arrived from another writer, which it wrote but its act did not (S3). */
  readonly arrived?: readonly string[];
}

/** The build after a step failed: the step itself is in the pod, as `performed` says. */
export class BuildFailure extends Error {
  override readonly name = "BuildFailure";

  constructor(
    readonly performed: Performed,
    cause: unknown,
  ) {
    super(
      `the build after the step failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

/**
 * The pod's files as listed once, each read from the pod once and then held, which holds while the pod is written
 * only through them: a write goes through to the pod, but not one giving a file the bytes it already holds. A file
 * not held is looked for in the pod, so a step never writes over one that reached the pod another way; it is held,
 * but not listed.
 */
class HeldFiles implements Files {
  readonly #pod: Files;
  readonly #bytes = new Map<string, Uint8Array>();
  #paths: Promise<Set<string>> | undefined;
  /** The paths of the listing it was sorted from, in code unit order, until one is added. */
  #sorted: { readonly of: Set<string>; readonly paths: string[] } | undefined;

  constructor(pod: Files) {
    this.#pod = pod;
  }

  get iri(): string {
    return this.#pod.iri;
  }

  #listed(): Promise<Set<string>> {
    if (this.#paths === undefined) {
      const listing = this.#pod.list("").then((paths) => new Set(paths));
      this.#paths = listing;
      listing.catch(() => {
        if (this.#paths === listing) this.#paths = undefined;
      });
    }
    return this.#paths;
  }

  async #held(path: string): Promise<Uint8Array | undefined> {
    const held = this.#bytes.get(path);
    if (held !== undefined) return held;
    const bytes = await this.#pod.read(path);
    if (bytes === undefined) return undefined;
    this.#bytes.set(path, bytes);
    return bytes;
  }

  async read(pathOrIri: string): Promise<Uint8Array | undefined> {
    const bytes = await this.#held(relative(this, pathOrIri));
    return bytes === undefined ? undefined : new Uint8Array(bytes);
  }

  write(pathOrIri: string, bytes: Uint8Array): Promise<void> {
    return this.writeAll([[pathOrIri, bytes]]);
  }

  /**
   * Writes, in one `writeAll` on the pod, each file it does not hold with the same bytes; held once all are written.
   * When the write fails, what is held is dropped and read from the pod again, which may hold some of them.
   */
  async writeAll(
    files: Iterable<readonly [string, Uint8Array]>,
  ): Promise<void> {
    const changed: [string, Uint8Array][] = [];
    for (const [pathOrIri, bytes] of files) {
      const path = relative(this, pathOrIri);
      const held = await this.#held(path);
      if (held === undefined || !same(held, bytes))
        changed.push([path, new Uint8Array(bytes)]);
    }
    if (changed.length === 0) return;
    const listed = await this.#listed();
    try {
      await writeAll(this.#pod, changed);
    } catch (error) {
      this.#paths = undefined;
      this.#bytes.clear();
      throw error;
    }
    for (const [path, bytes] of changed) {
      this.#bytes.set(path, bytes);
      if (!listed.has(path)) this.#sorted = undefined;
      listed.add(path);
    }
  }

  /** The paths under the folder, found in the sorted listing: those under a folder are contiguous in it. */
  async list(folder: string): Promise<string[]> {
    const prefix = relative(this, folder);
    const listed = await this.#listed();
    if (this.#sorted?.of !== listed)
      this.#sorted = { of: listed, paths: [...listed].sort() };
    const sorted = this.#sorted.paths;
    if (prefix === "") return [...sorted];
    const start = prefix.endsWith("/") ? prefix : `${prefix}/`;
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((sorted[middle] as string) < start) low = middle + 1;
      else high = middle;
    }
    let end = low;
    while (end < sorted.length && (sorted[end] as string).startsWith(start))
      end++;
    return sorted.slice(low, end);
  }
}

/** The hash of the pod's address, the files it holds but those the build writes, and its manifest's bytes; nothing is parsed. */
export async function podRevision(
  pod: Files,
  layout: Layout,
  address: string,
): Promise<string> {
  const rebuilt = new Set(layout.rebuilt);
  const listing = new TextEncoder().encode(
    JSON.stringify([
      address,
      (await pod.list("")).filter((path) => !rebuilt.has(path)).sort(),
    ]),
  );
  const manifest = (await pod.read(layout.manifest)) ?? new Uint8Array();
  const bytes = new Uint8Array(listing.length + manifest.length);
  bytes.set(listing);
  bytes.set(manifest, listing.length);
  return documentName(bytes);
}

/** What an act's file holds of the chain: its snapshot, the act that generated it, the parents and set hash it names, whether the act is a sync. */
interface ActFile {
  readonly snapshot?: string;
  readonly act?: string;
  readonly parents: readonly string[];
  readonly setHash?: string;
  readonly sync: boolean;
}

/** Reads what the act's file holds of the chain; a file naming no snapshot is not parsed. */
async function actFileOf(
  bytes: Uint8Array,
  base: string,
  newStore: StoreFactory,
): Promise<ActFile> {
  if (!new TextDecoder().decode(bytes).includes("Snapshot"))
    return { parents: [], sync: false };
  const triples = await newStore().parse(bytes, base);
  let snapshot: string | undefined;
  const syncs = new Set<string>();
  for (const [s, p, o] of triples) {
    if (p.value !== TYPE) continue;
    if (o.value === `${CASCADE}Snapshot`) snapshot ??= s.value;
    if (o.value === SYNC) syncs.add(s.value);
  }
  let act: string | undefined;
  let setHash: string | undefined;
  const parents: string[] = [];
  for (const [s, p, o] of triples) {
    if (s.value !== snapshot) continue;
    if (p.value === `${PROV}wasGeneratedBy`) act = o.value;
    if (p.value === `${CASCADE}setHash`) setHash = o.value;
    if (
      p.value === `${CASCADE}firstParentSnapshot` ||
      p.value === `${CASCADE}mergedParentSnapshot`
    )
      parents.push(o.value);
  }
  return {
    ...(snapshot === undefined ? {} : { snapshot }),
    ...(act === undefined ? {} : { act }),
    ...(setHash === undefined ? {} : { setHash }),
    parents,
    sync: act !== undefined && syncs.has(act),
  };
}

/** The act files by the snapshot each holds. */
function bySnapshot(files: Iterable<ActFile>): Map<string, ActFile> {
  const found = new Map<string, ActFile>();
  for (const file of files)
    if (file.snapshot !== undefined) found.set(file.snapshot, file);
  return found;
}

/** The heads among the snapshots the act files hold: those none of them names as a parent, in code point order. */
function headsOf(files: Iterable<ActFile>): string[] {
  const snapshots = new Set<string>();
  const parents = new Set<string>();
  for (const file of files) {
    if (file.snapshot !== undefined) snapshots.add(file.snapshot);
    for (const parent of file.parents) parents.add(parent);
  }
  return [...snapshots]
    .filter((snapshot) => !parents.has(snapshot))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The snapshot and each it descends from, as far as the snapshots held go. */
function ancestorsOf(
  snapshot: string,
  held: ReadonlyMap<string, ActFile>,
): Set<string> {
  const found = new Set<string>([snapshot]);
  const next = [snapshot];
  for (let at = next.pop(); at !== undefined; at = next.pop())
    for (const parent of held.get(at)?.parents ?? [])
      if (!found.has(parent)) {
        found.add(parent);
        next.push(parent);
      }
  return found;
}

/** The act files, each after those holding its snapshot's parents, else in path order (W1). */
function parentsFirst<
  T extends { readonly path: string; readonly file: ActFile },
>(acts: readonly T[]): T[] {
  const held = new Map(
    acts.flatMap((act) =>
      act.file.snapshot === undefined
        ? []
        : [[act.file.snapshot, act] as const],
    ),
  );
  const placed = new Set<T>();
  const visiting = new Set<T>();
  const ordered: T[] = [];
  for (const start of [...acts].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const stack: [T, number][] = [[start, 0]];
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as [T, number];
      const [act, index] = top;
      visiting.add(act);
      if (placed.has(act)) {
        stack.pop();
        continue;
      }
      const parent = held.get(act.file.parents[index] ?? "");
      if (index < act.file.parents.length) {
        top[1] = index + 1;
        if (
          parent !== undefined &&
          !placed.has(parent) &&
          !visiting.has(parent)
        )
          stack.push([parent, 0]);
        continue;
      }
      placed.add(act);
      ordered.push(act);
      stack.pop();
    }
  }
  return ordered;
}

/** A copy of the pod's files, in memory. */
async function copied(pod: Files): Promise<Files> {
  const copy = new MemoryFiles(pod.iri);
  for (const path of await pod.list("")) {
    const bytes = await pod.read(path);
    if (bytes !== undefined) await copy.write(path, bytes);
  }
  return copy;
}

/**
 * A pod over the four interfaces, performing each step of the rules with its inputs: a step writes all it writes or,
 * refused, nothing, and with a build the views and the other files the build writes are rebuilt after it.
 */
export class CorePod {
  readonly #options: CorePodOptions;
  #references: Promise<References> | undefined;
  #readShapes: Promise<Shapes> | undefined;
  /** What is built of the pod as it stands, by what it is; a step drops it all. */
  #kept = new Map<string, Promise<unknown>>();
  /** The writer's last snapshot, and whether the pod is known to hold it. */
  #head: Head | undefined;
  #headHeld = false;
  /** The set the writer's last act hashed and the files written since, held while no step fails after hashing it. */
  #hashed: HashedSet | undefined;
  /** The answers M7 gives across table versions, kept across steps: what decides each never changes. */
  #keptClaims: KeptClaims;
  /** The build kept across steps, when the build is incremental and the last rebuild held. */
  #built: KeptBuild | undefined;
  /** The files of the build made whole for the step in progress before it wrote, written with the step's rebuild. */
  #builtBefore: ReadonlyMap<string, readonly Triple[]> | undefined;
  /** What each act file of the pod read or written so far holds of the chain, by path. */
  readonly #chain = new Map<string, ActFile>();
  /** What the act files the step in progress writes hold of the chain, by path, learnt once they are written. */
  #writing = new Map<string, ActFile>();
  /** Whether a step is being performed, after which the pod builds its dataset again. */
  #performing = false;
  /** The quads the matcher's views lent from the kept build's store have had it remove and add again. */
  #movedInBuilt = 0;

  constructor(options: CorePodOptions) {
    this.#options = { ...options, pod: new HeldFiles(options.pod) };
    this.#keptClaims = new KeptClaims(options);
    this.#head = options.head;
  }

  get files(): Files {
    return this.#options.pod;
  }

  /**
   * The writer's last snapshot, for it to keep outside the pod (N14) and hand back as `CorePodOptions.head`: the one it
   * was handed until it performs an act, undefined for a new writer.
   */
  get head(): Head | undefined {
    return this.#head;
  }

  /**
   * The pod as an ask reads it under the lens: its files but those the build writes, the files the build writes, the
   * lens's derived state and the layout, each a graph of a store of its own. The union is valid only until the next
   * step, `select` or `close`: a step or `close` frees it or moves it to a store of its own, and a `select` lends it to
   * the matcher's view.
   */
  async dataset(lens: string): Promise<Union> {
    await this.#putBackMatcherView();
    return this.#held(`${DATASET}${lens}`, () =>
      this.#filled(new Union(this.#options.newStore()), lens),
    );
  }

  /** The union with the pod's files, the lens's derived state, the files the build writes and the layout. */
  async #filled(union: Union, lens: string): Promise<Union> {
    const { pod, layout, address, title, time, build } = this.#options;
    await podFiles(pod, layout, address, union);
    if (build === undefined) {
      for (const path of layout.rebuilt.filter((path) => layout.isRdf(path))) {
        const bytes = await pod.read(path);
        if (bytes !== undefined) await union.loadTurtle(bytes, address + path);
      }
    } else {
      const at = (await podStated(pod, layout, union.store)).at ?? time.now();
      await build.derive(union, lens, { address, at, title }, this.#keep());
    }
    await addLayout(union, layout, address);
    return union;
  }

  /**
   * The pod's revision, as `podRevision` names it. Any step that writes changes it, and so does a refused one, whose
   * build writes the manifest again.
   */
  revision(): Promise<string> {
    return this.#held(REVISION, () => {
      const { pod, layout, address } = this.#options;
      return podRevision(pod, layout, address);
    });
  }

  /** Drops what is kept, and frees it; the pod builds again when next read. */
  close(): void {
    this.#release();
    this.#dropBuilt();
  }

  /** Frees the build kept across steps; the next step builds whole. */
  #dropBuilt(): void {
    this.#built?.free();
    this.#built = undefined;
    this.#movedInBuilt = 0;
  }

  /**
   * Drops what is kept, freeing each union once it is made: the pod owns every union it keeps, and a union `dataset`
   * gave is read only until the next step or `close`.
   */
  #release(): void {
    const kept = this.#kept;
    this.#kept = new Map();
    const owned = this.#built?.union.store;
    for (const held of kept.values())
      held.then(
        (union) => {
          if (union instanceof Union && union.store !== owned)
            union.store.free?.();
        },
        () => undefined,
      );
  }

  /** The pod's creation (A13). */
  create(): Promise<Performed> {
    return this.#step(fileCreation);
  }

  /**
   * An export's or a download's arrival: its documents, as the first importer that reads the path finds them, each
   * converted by the first adapter of its media type that accepts it (A1 to A11, A14). The adapters are asked for only
   * once an importer reads the path. `onProgress` is told as loading the adapter, each conversion and saving begin.
   */
  import(
    exported: Pick<Files, "read" | "list">,
    folder: string,
    adapters: () => Promise<AdaptersOf>,
    onProgress?: OnProgress,
  ): Promise<Performed> {
    const { importers } = this.#options;
    return this.#step(async (context) => {
      let documents: readonly ExportDocument[] | undefined;
      for (const importer of importers) {
        try {
          documents = await importer.documents(exported, folder);
        } catch (error) {
          throw new Refusal(
            `${folder}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (documents !== undefined) break;
      }
      if (documents === undefined)
        throw new Refusal(
          `no importer of ${importers.map((importer) => importer.name).join(", ") || "none"} reads ${folder}`,
        );
      await onProgress?.({ part: "loading the adapter" });
      const activity = await fileExport(
        context,
        documents,
        await adapters(),
        onProgress,
      );
      await onProgress?.({ part: "saving" });
      return activity;
    });
  }

  /** A connect to a server, as the folder of the files saves it (A16, A14). */
  connect(saved: Pick<Files, "read">, folder: string): Promise<Performed> {
    return this.#step(async (context) => {
      let reported;
      try {
        reported = await readConnect(saved, folder);
      } catch (error) {
        if (!(error instanceof ConnectRefused)) throw error;
        throw new Refusal(`${folder}: ${error.message}`);
      }
      return fileConnect(context, reported);
    });
  }

  /** An entry (A12), refused where its statements break the vocabulary's shapes. */
  enter(entry: StepFile): Promise<Performed> {
    return this.#step(async (context) =>
      fileEntry(context, entry, await this.#shapes()),
    );
  }

  /** A person's judgment, filed as it is (N10). */
  judge(judgment: StepFile): Promise<Performed> {
    return this.#step((context) => fileJudgment(context, judgment));
  }

  /** A step refused before the pod is given its inputs: it writes nothing, and the build is rebuilt as after any step. */
  refuse(why: string): Promise<Performed> {
    return this.#step(() => Promise.reject(new Refusal(why)));
  }

  /** A reference version's arrival. */
  reference(version: string): Promise<Performed> {
    return this.#step(async (context) =>
      fileReference(context, await this.#tables(), version),
    );
  }

  /**
   * The pod opened with the tables (O1, O2), which it matches with from then on: first, when the rule list version it
   * adopts, or one that version revises, declares a rule wrong, the rule list version migration (N15), an act of its
   * own, then the open's matcher run.
   */
  async open(tables: References): Promise<Performed> {
    const migrated = await this.#migrated(tables, true);
    let unheld: readonly string[] = [];
    const performed = await this.#step(async (context) => {
      const opened = await openPod(context, tables);
      unheld = opened.unheld;
      this.#references = Promise.resolve(tables);
      return opened.activity;
    }, true);
    return {
      ...performed,
      wrote: [...(migrated?.wrote ?? []), ...performed.wrote],
      ...(unheld.length === 0 ? {} : { unheld }),
    };
  }

  /**
   * A matcher run taking the import or entry session given, or the records a sync brought, or, given none, a recheck
   * (M7): first, as at an open, the rule list version migration, when the pod's current rule list version or one it
   * revises declares a rule wrong (N15).
   */
  async match(activity?: string): Promise<Performed> {
    const tables = await this.#tables();
    const migrated = await this.#migrated(tables, false);
    const performed = await this.#step((context) =>
      runMatcher(context, tables, activity),
    );
    return migrated === undefined
      ? performed
      : { ...performed, wrote: [...migrated.wrote, ...performed.wrote] };
  }

  /**
   * Another writer's files arriving (S1 to S4): each file it holds that the pod lacks, in a folder the layout gives by
   * solid:instanceContainer but the views', is written in W1's order, the stored documents' bytes first, then the other
   * files of the set, then the act files, parents first. A sync is written last whenever the pod holds an act, other
   * than a sync, whose snapshot is no ancestor of the writer's last, naming each such act; with none, a writer that
   * then holds one head takes it as its last snapshot, as git fast-forwards. What it writes depends on what the pod
   * holds, never on what this call wrote, so a call that stops partway and is made again writes the same sync. Only
   * the files that arrived and the act files not read before are read. Then, when the pod's current rule list version
   * or one it revises declares a rule wrong, the rule list version migration, an act of its own (N15); a writer with no
   * tables to read has none.
   */
  async receive(other: Pick<Files, "list" | "read">): Promise<Performed> {
    const arrived: string[] = [];
    let fastForward: Head | undefined;
    const performed = await this.#step(
      async ({ pod, layout, time, writes, newStore }) => {
        const held = new Set(await pod.list(""));
        const stored: [string, Uint8Array][] = [];
        const others: [string, Uint8Array][] = [];
        const acts: { path: string; bytes: Uint8Array; file: ActFile }[] = [];
        for (const path of await other.list("")) {
          if (
            held.has(path) ||
            !(layout.inSnapshotSet(path) || layout.inSyncsFolder(path))
          )
            continue;
          const bytes = await other.read(path);
          if (bytes === undefined) continue;
          if (layout.inActFolder(path))
            acts.push({
              path,
              bytes,
              file: await actFileOf(bytes, pod.iri + path, newStore),
            });
          else
            (layout.inStoredBytes(path) ? stored : others).push([path, bytes]);
        }
        stored.sort(([a], [b]) => (a < b ? -1 : 1));
        others.sort(([a], [b]) => (a < b ? -1 : 1));
        for (const [path, bytes] of [
          ...stored,
          ...others,
          ...parentsFirst(acts).map(
            ({ path, bytes }) => [path, bytes] as const,
          ),
        ]) {
          writes.arrive(path, bytes);
          arrived.push(path);
        }
        for (const { path, file } of acts) this.#writing.set(path, file);
        const chain = await this.#chainHeld();
        const snapshots = bySnapshot(chain);
        const head =
          this.#head !== undefined && snapshots.has(this.#head.snapshot)
            ? this.#head.snapshot
            : undefined;
        const merged =
          head === undefined ? new Set<string>() : ancestorsOf(head, snapshots);
        const unmerged = new Set(
          chain.flatMap(({ snapshot, act, sync }) =>
            snapshot === undefined ||
            act === undefined ||
            sync ||
            merged.has(snapshot)
              ? []
              : [act],
          ),
        );
        if (unmerged.size === 0) {
          const heads = headsOf(chain);
          const setHash = snapshots.get(heads[0] ?? "")?.setHash;
          if (heads.length === 1 && heads[0] !== head && setHash !== undefined)
            fastForward = { snapshot: heads[0] as string, setHash };
          return undefined;
        }
        const name = time.newId();
        const sync = iri(name);
        writes.act({
          name,
          path: layout.place(SYNC).path(name),
          triples: [
            [sync, iri(TYPE), iri(`${PROV}Activity`)],
            [sync, iri(TYPE), iri(SYNC)],
            [
              sync,
              iri(`${PROV}startedAtTime`),
              literal(time.now(), `${XSD}dateTime`),
            ],
            ...[...unmerged]
              .sort()
              .map((act): Triple => [
                sync,
                iri(`${PROV}wasInformedBy`),
                iri(act),
              ]),
          ],
        });
        return name;
      },
    );
    if (performed.refused !== undefined) return performed;
    if (fastForward !== undefined) {
      const hashed = await this.#hashedSet(new Map());
      this.#hashed = hashed;
      fastForward = { ...fastForward, set: await hashed.kept() };
      this.#head = fastForward;
      this.#headHeld = true;
      await this.#options.keepHead?.(fastForward).catch(() => undefined);
    }
    const tables = await this.#tables().catch(() => undefined);
    const migrated =
      tables === undefined ? undefined : await this.#migrated(tables, false);
    return migrated === undefined
      ? { ...performed, arrived }
      : {
          ...performed,
          arrived,
          wrote: [...performed.wrote, ...migrated.wrote],
        };
  }

  /**
   * What every act file the pod holds, and every one the step in progress writes, holds of the chain. Only act files
   * not read before are read.
   */
  async #chainHeld(): Promise<ActFile[]> {
    const { pod, layout, newStore } = this.#options;
    for (const path of await pod.list("")) {
      if (
        this.#chain.has(path) ||
        this.#writing.has(path) ||
        !layout.inActFolder(path)
      )
        continue;
      const bytes = await pod.read(path);
      if (bytes !== undefined)
        this.#chain.set(path, await actFileOf(bytes, pod.iri + path, newStore));
    }
    return [...this.#chain.values(), ...this.#writing.values()];
  }

  /**
   * The rule list version migration (N15), a step of its own, when it has a retraction to write. Finding none reads the
   * matcher's view the step after it reads, and writes nothing.
   */
  async #migrated(
    tables: References,
    opening: boolean,
  ): Promise<Performed | undefined> {
    const retractions = await releaseRetractions(
      () => this.#matcherView(),
      tables,
      opening,
    );
    if (retractions.length === 0) return undefined;
    return this.#step(
      async (context) => migrateRuleListVersions(context, retractions),
      true,
    );
  }

  /** The query's rows over the pod as the matcher reads it: its RDF files but those the build writes, and the everyday lens's derived state. */
  async select(query: string): Promise<Rows> {
    return (await this.#matcherView()).select(query);
  }

  /**
   * The query's rows over a dataset of its own, built as `dataset` builds one (the pod's views among it, which the
   * matcher's view lacks), with the current version of each series of the kind added as the matcher adds it: the rows
   * the pod's codes find and the descriptions. It writes nothing, and no row reaches a held dataset, a question's
   * dataset or an answer.
   */
  async selectWithRows(query: string, kind: string): Promise<Rows> {
    const { vocabulary, newStore, build } = this.#options;
    const [union, references, terms] = await Promise.all([
      this.#filled(new Union(newStore()), build?.lens ?? ""),
      this.#tables(),
      tableTerms(vocabulary, newStore),
    ]);
    const find = { codes: await podCodes(union, terms), terms };
    for (const series of references.seriesOfKind(kind)) {
      const version = references.fallback(series);
      await union.add(await references.rows(version, find), version);
      await union.add(
        [...references.description(version), ...references.description(series)],
        "urn:cascade:references",
      );
    }
    try {
      return await union.select(query);
    } finally {
      union.store.free?.();
    }
  }

  /**
   * The dataset kept under the build's lens, which holds the pod's files and their derived state, if any; put back
   * first, when the matcher's view is lent from it.
   */
  async #keptDataset(): Promise<Union | undefined> {
    await this.#putBackMatcherView();
    return this.#keptUnderLens();
  }

  #keptUnderLens(): Promise<Union | undefined> | undefined {
    const lens = this.#options.build?.lens;
    const kept =
      lens === undefined
        ? undefined
        : (this.#kept.get(DATASET + lens) as Promise<Union> | undefined);
    return kept?.catch(() => undefined);
  }

  /**
   * The matcher's view: the dataset kept under the matcher's lens, which holds the same files and derived state, without
   * the files the build writes and the layout. That dataset is changed in place and lent until the view is released or
   * the dataset is read, when it is put back as it was; but during a step a dataset the build does not keep across
   * steps is taken from what the pod keeps, which builds it again after. Else read and derived.
   */
  #matcherView(): Promise<Union> {
    return this.#held(MATCHER_VIEW, async () => {
      const { build, address, layout } = this.#options;
      const dataset =
        build?.lens === MATCHER_LENS ? await this.#keptUnderLens() : undefined;
      if (dataset === undefined)
        return matcherView(this.#options, this.#keep());
      const rebuilt = new Set(layout.rebuilt.map((path) => address + path));
      const left = [...dataset.graphs].filter(
        (graph) => graph === LAYOUT_GRAPH || rebuilt.has(graph),
      );
      if (this.#performing && dataset !== this.#built?.union) {
        this.#kept.delete(DATASET + MATCHER_LENS);
        for (const graph of left) await dataset.drop(graph);
        return dataset;
      }
      const view = new RestorableUnion(dataset.store, dataset.graphs);
      for (const graph of left) await view.drop(graph);
      return view;
    });
  }

  /** Puts back the dataset the matcher's view is lent from, if it is, so that whatever reads it next reads all of it. */
  async #putBackMatcherView(): Promise<void> {
    const held = this.#kept.get(MATCHER_VIEW) as Promise<Union> | undefined;
    if (held === undefined) return;
    const view = await held.catch(() => undefined);
    if (
      view instanceof RestorableUnion &&
      this.#kept.get(MATCHER_VIEW) === held
    )
      await this.#releaseMatcherView();
  }

  /** Takes the matcher's view out of what the pod keeps: puts back the dataset it was made in, or frees its store. */
  async #releaseMatcherView(): Promise<void> {
    const held = this.#kept.get(MATCHER_VIEW) as Promise<Union> | undefined;
    if (held === undefined) return;
    this.#kept.delete(MATCHER_VIEW);
    const view = await held.catch(() => undefined);
    if (!(view instanceof RestorableUnion)) {
      view?.store.free?.();
      return;
    }
    try {
      await view.restore();
    } catch (error) {
      this.#dropDatasets(view.store);
      throw error;
    }
    if (view.store !== this.#built?.union.store) return;
    this.#movedInBuilt += view.moved;
    if (
      this.#movedInBuilt >=
      (this.#options.build?.renewAfterMoved ?? COMPACT_AFTER_MOVED)
    )
      await this.#compactBuilt();
  }

  /**
   * Forgets every dataset the pod keeps, freeing each, and the build kept across steps: a store a view was not put back
   * in whole is read again by nothing.
   */
  #dropDatasets(store: Store): void {
    const built = this.#built?.union.store;
    for (const [key, held] of [...this.#kept])
      if (key.startsWith(DATASET)) {
        this.#kept.delete(key);
        held.then(
          (union) => {
            if (
              union instanceof Union &&
              union.store !== built &&
              union.store !== store
            )
              union.store.free?.();
          },
          () => undefined,
        );
      }
    if (store === built) this.#dropBuilt();
    else store.free?.();
  }

  /**
   * Moves the kept build to a store of its own, which every dataset kept as its union then reads; when that fails, the
   * old store may be freed already, and the build is dropped, so the next read or step builds the pod whole.
   */
  async #compactBuilt(): Promise<void> {
    const built = this.#built;
    if (built === undefined) return;
    const was = built.union;
    try {
      await built.compact();
    } catch (error) {
      this.#dropDatasets(was.store);
      throw error;
    }
    this.#movedInBuilt = 0;
    for (const [key, held] of [...this.#kept])
      if (
        key.startsWith(DATASET) &&
        (await held.catch(() => undefined)) === was
      )
        this.#kept.set(key, Promise.resolve(built.union));
  }

  /** What is kept under the key, or what `make` builds, kept until a step unless it fails. */
  #held<T>(key: string, make: () => Promise<T>): Promise<T> {
    const kept = this.#kept;
    const found = kept.get(key) as Promise<T> | undefined;
    if (found !== undefined) return found;
    const making = make();
    kept.set(key, making);
    making.catch(() => {
      if (kept.get(key) === making) kept.delete(key);
    });
    return making;
  }

  /** A pod that stands where this one does, over a copy of its files, with its own time. */
  async fork(time: IdsAndTime): Promise<CorePod> {
    const fork = new CorePod({
      ...this.#options,
      pod: await copied(this.#options.pod),
      time,
    });
    fork.#references = this.#references;
    fork.#keptClaims = this.#keptClaims;
    fork.#head = this.#head;
    fork.#headHeld = this.#headHeld;
    fork.#hashed = this.#hashed?.copy();
    for (const [path, file] of this.#chain) fork.#chain.set(path, file);
    if (this.#readShapes !== undefined) fork.#holdShapes(this.#readShapes);
    return fork;
  }

  /** A second writer of the pod: over a copy of its files, with no snapshot of its own, a new writer (N14). */
  async newWriter(): Promise<CorePod> {
    const writer = new CorePod({
      ...this.#options,
      pod: await copied(this.#options.pod),
      head: undefined,
      keepHead: undefined,
    });
    writer.#references = this.#references;
    writer.#hashed = this.#hashed?.copy();
    for (const [path, file] of this.#chain) writer.#chain.set(path, file);
    if (this.#readShapes !== undefined) writer.#holdShapes(this.#readShapes);
    return writer;
  }

  #tables(): Promise<References> {
    this.#references ??= this.#options.references();
    return this.#references;
  }

  /**
   * The Sames M7 leaves as they were across a table version, over the tables the pod is read with: found once a step for
   * every union read under a lens that reads them, each holding the same files.
   */
  #keep(): Keep {
    return async (union) =>
      (
        await this.#held(KEPT, () =>
          this.#keptClaims.of(union, () => this.#tables()),
        )
      ).triples;
  }

  /**
   * The current table versions the pod names that its tables do not hold, of each series a matcher Same used another
   * version of: the Same counts on where a device holds the version and its rows join the members, and not here (M7).
   * Read over the dataset kept under the build's lens when there is one, rather than the matcher's view of it.
   */
  async unheldTableVersions(): Promise<readonly string[]> {
    let kept = this.#kept.get(KEPT) as Promise<Kept> | undefined;
    if (kept === undefined) {
      const dataset = await this.#keptDataset();
      if (dataset !== undefined) {
        // KeptClaims adds a version's rows to the union it reads and drops them after: safe on the kept dataset only
        // because a pod's reads and steps run one at a time.
        kept = this.#held(KEPT, () =>
          this.#keptClaims.of(dataset, () => this.#tables()),
        );
      } else {
        await this.#matcherView();
        kept = this.#kept.get(KEPT) as Promise<Kept> | undefined;
      }
    }
    return (await kept)?.unheld ?? [];
  }

  #shapes(): Promise<Shapes> {
    return (
      this.#readShapes ??
      this.#holdShapes(
        Shapes.read(this.#options.vocabulary, this.#options.newStore),
      )
    );
  }

  /** Holds a read of the shapes until it fails, so a failed read is tried again. */
  #holdShapes(reading: Promise<Shapes>): Promise<Shapes> {
    this.#readShapes = reading;
    reading.catch(() => {
      if (this.#readShapes === reading) this.#readShapes = undefined;
    });
    return reading;
  }

  async #step(
    perform: (context: StepContext) => Promise<string | void>,
    everything = false,
  ): Promise<Performed> {
    const options = this.#options;
    const at = options.build === undefined ? undefined : options.time.now();
    const writes = new StepWrites();
    let performed: Performed;
    let change: Change | undefined = { written: [], everything };
    try {
      this.#performing = true;
      const activity = await perform({
        address: options.address,
        subject: options.subject,
        pod: options.pod,
        time: options.time,
        writes,
        newStore: options.newStore,
        layout: options.layout,
        vocabulary: options.vocabulary,
        ...(this.#head === undefined
          ? {}
          : { lastSnapshot: this.#head.snapshot }),
        matcherView: () => this.#matcherView(),
        releaseMatcherView: () => this.#releaseMatcherView(),
        keptDataset: () => this.#keptOrBuiltWhole(at),
      }).finally(async () => {
        this.#performing = false;
        await this.#releaseMatcherView();
      });
      let head: Head | undefined;
      let hashed: { readonly set: HashedSet; readonly act: string } | undefined;
      const wrote = await writes.commit(
        options.pod,
        async (act, fresh, arrived) => {
          const finished = await this.#finished(act, fresh, arrived);
          head = finished.head;
          hashed = { set: finished.hashed, act: act.path };
          return finished.triples;
        },
      );
      for (const [path, file] of this.#writing) this.#chain.set(path, file);
      if (head !== undefined) {
        this.#head = head;
        this.#headHeld = true;
        const kept = await this.#keptAfter(hashed);
        if (kept !== undefined) this.#head = head = { ...head, set: kept };
        await options.keepHead?.(head).catch(() => undefined);
      }
      performed =
        typeof activity === "string" ? { wrote, activity } : { wrote };
    } catch (error) {
      if (!(error instanceof Refusal)) {
        change = undefined;
        throw error;
      }
      performed = { wrote: [], refused: error.message };
    } finally {
      this.#release();
      this.#writing = new Map();
      if (change === undefined) {
        this.#dropBuilt();
        this.#builtBefore = undefined;
      } else change = { ...change, written: writes.committed };
    }
    if (options.build !== undefined) {
      try {
        await this.#rebuild(options.build, at, change);
      } catch (error) {
        this.#dropBuilt();
        throw new BuildFailure(performed, error);
      } finally {
        this.#builtBefore = undefined;
      }
    }
    return performed;
  }

  /**
   * The dataset kept under the build's lens; when none is, as after a reopen, and the build is kept across steps, the
   * pod built whole as it stands before the step, kept as the build the step's rebuild continues from. So the pod's
   * files are read and parsed once for the step and its rebuild, rather than once for each.
   */
  async #keptOrBuiltWhole(at: string | undefined): Promise<Union | undefined> {
    const kept = await this.#keptDataset();
    const build = this.#options.build;
    const incremental = build?.incremental;
    if (
      kept !== undefined ||
      build === undefined ||
      incremental === undefined ||
      at === undefined ||
      this.#built !== undefined
    )
      return kept;
    return this.#held(DATASET + build.lens, async () => {
      const whole = await KeptBuild.whole(
        this.#rebuilding(build, incremental),
        this.#state(at),
      );
      this.#built = whole.kept;
      this.#builtBefore = whole.files;
      return whole.kept.union;
    });
  }

  /** What a kept build reads the pod with. */
  #rebuilding(build: PodBuildOption, incremental: VocabularyBuild) {
    const { pod, layout, address, newStore } = this.#options;
    return {
      pod,
      layout,
      address,
      newStore,
      build: incremental,
      lens: build.lens,
      keep: async (union: Union) =>
        (await this.#keptClaims.of(union, () => this.#tables())).triples,
    };
  }

  /** The pod's state for a build at the time. */
  #state(at: string): PodState {
    const { address, title } = this.#options;
    return {
      address,
      at,
      title,
      ...(this.#head === undefined ? {} : { snapshot: this.#head.snapshot }),
    };
  }

  /**
   * What an act's file holds beside its description: the runtime that performed it (N7) and its snapshot (N14), chained
   * to the writer's last. A writer with none, or whose last the pod does not hold, is a new writer, whose snapshot merges
   * every head the pod holds; a sync's merges every head the pod holds but its first parent (S3). The set hash is over
   * every file of the set the pod holds once the step's other files are written; the snapshot names only the files of
   * the set the act wrote, its own among them unless a sync's, which is outside the set.
   */
  async #finished(
    act: Act,
    fresh: readonly (readonly [string, Uint8Array])[],
    arrived: ReadonlySet<string>,
  ): Promise<{
    readonly triples: Triple[];
    readonly head: Head;
    readonly hashed: HashedSet;
  }> {
    const { layout, runtime } = this.#options;
    const written = new Map(fresh);
    const hashed = await this.#hashedSet(written, act.path);
    const hash = await hashed.setHash();
    const sync = act.triples.some(
      ([, p, o]) => p.value === TYPE && o.value === SYNC,
    );
    let first = this.#head;
    let merged: string[] = [];
    if (first === undefined || !this.#headHeld || sync) {
      const chain = await this.#chainHeld();
      const snapshots = bySnapshot(chain);
      if (first !== undefined && !snapshots.has(first.snapshot))
        first = undefined;
      const heads = headsOf(chain);
      merged =
        first === undefined
          ? heads
          : sync
            ? heads.filter((head) => head !== first?.snapshot)
            : [];
    }
    const agent = iri(runtime);
    const description: Triple[] = [
      ...act.triples,
      [iri(act.name), iri(`${PROV}wasAssociatedWith`), agent],
      [agent, iri(TYPE), iri(`${PROV}SoftwareAgent`)],
    ];
    const snapshot = await snapshotName({
      act: act.name,
      description: await actDescriptionName(description),
      ...(first === undefined ? {} : { firstParent: first.snapshot }),
      mergedParents: merged,
      setHash: hash,
    });
    const node = iri(snapshot);
    this.#writing.set(act.path, {
      snapshot,
      act: act.name,
      parents: [...(first === undefined ? [] : [first.snapshot]), ...merged],
      setHash: hash,
      sync,
    });
    const added = [...written.keys(), act.path].filter(
      (path) => !arrived.has(path) && layout.inSnapshotSet(path),
    );
    return {
      head: { snapshot, setHash: hash },
      hashed,
      triples: [
        ...description.slice(act.triples.length),
        [node, iri(TYPE), iri(`${CASCADE}Snapshot`)],
        [node, iri(`${PROV}wasGeneratedBy`), iri(act.name)],
        ...(first === undefined
          ? []
          : [
              [
                node,
                iri(`${CASCADE}firstParentSnapshot`),
                iri(first.snapshot),
              ] as Triple,
            ]),
        ...merged.map((parent): Triple => [
          node,
          iri(`${CASCADE}mergedParentSnapshot`),
          iri(parent),
        ]),
        [node, iri(`${CASCADE}setHash`), literal(hash)],
        ...added.map((path): Triple => [
          node,
          iri(`${CASCADE}fileAddedToSet`),
          literal(path),
        ]),
      ],
    };
  }

  /**
   * The set the writer has hashed, with every file of the set the pod lists, and each written, but the one `leaving`,
   * multiplied in once. It starts from the one held across steps, else from the one kept beside the writer's head when
   * the pod lists exactly its files, else, as for a new writer or when the pod no longer holds a file of it, from every
   * file read. It is held again only once the step that hashed it is written.
   */
  async #hashedSet(
    written: ReadonlyMap<string, Uint8Array>,
    leaving?: string,
  ): Promise<HashedSet> {
    const { pod, layout } = this.#options;
    const listing = await pod.list("");
    const inSet = (path: string) =>
      path !== leaving && layout.inSnapshotSet(path);
    const kept = this.#head?.set;
    const held =
      this.#hashed ??
      (kept === undefined
        ? undefined
        : await HashedSet.kept(kept, new Set(listing.filter(inSet))));
    this.#hashed = undefined;
    const paths = [...listing, ...written.keys()];
    const missing = held?.missing(paths, inSet);
    const digests = async (paths: Iterable<string>) => {
      const files = new Map<string, Uint8Array>();
      for (const path of paths)
        files.set(path, await this.#digestOf(path, written));
      return files;
    };
    if (held === undefined || missing === undefined)
      return HashedSet.of(await digests(new Set(paths.filter(inSet))));
    await held.add(await digests(missing));
    return held;
  }

  /**
   * What the writer keeps of the set its act hashed, with the act's own file once written unless a sync's; held from
   * then on. When the act's file cannot be read back, nothing is held or kept, and the next act hashes the whole set.
   */
  async #keptAfter(
    hashed: { readonly set: HashedSet; readonly act: string } | undefined,
  ): Promise<KeptSet | undefined> {
    if (hashed === undefined) return undefined;
    const { set, act } = hashed;
    try {
      if (this.#options.layout.inSnapshotSet(act))
        await set.add([[act, await this.#digestOf(act, new Map())]]);
      const kept = await set.kept();
      this.#hashed = set;
      return kept;
    } catch {
      return undefined;
    }
  }

  /** The SHA-256 of the file's bytes, as written or as the pod holds them. */
  async #digestOf(
    path: string,
    written: ReadonlyMap<string, Uint8Array>,
  ): Promise<Uint8Array> {
    const bytes = written.get(path) ?? (await this.#options.pod.read(path));
    if (bytes === undefined) throw new Error(`${path} is listed but not held`);
    return fileDigest(bytes);
  }

  async #rebuild(
    build: PodBuildOption,
    at: string | undefined,
    change: Change,
  ): Promise<void> {
    const { pod, layout, address, title, newStore } = this.#options;
    if (build.incremental !== undefined && at !== undefined) {
      const state = this.#state(at);
      const rebuilding = this.#rebuilding(build, build.incremental);
      let built = this.#built;
      let files = await built?.step(change, state);
      if (files !== undefined && this.#builtBefore !== undefined)
        files = new Map([...this.#builtBefore, ...files]);
      if (built !== undefined && files !== undefined && build.verify === true)
        await built.verify(await KeptBuild.whole(rebuilding, state));
      if (built === undefined || files === undefined) {
        this.#dropBuilt();
        const whole = await KeptBuild.whole(rebuilding, state);
        built = this.#built = whole.kept;
        files = whole.files;
      }
      await writeAll(
        pod,
        [...files].map(
          ([path, triples]) =>
            [path, builtFileBytes(layout, address, path, triples)] as const,
        ),
      );
      this.#kept.set(DATASET + build.lens, Promise.resolve(built.union));
      return;
    }
    const rebuilt = new Set(layout.rebuilt);
    const files = (await pod.list("")).filter((path) => !rebuilt.has(path));
    const union = new Union(newStore());
    const made = await built(
      pod,
      layout,
      address,
      files,
      at,
      title,
      build.lens,
      union,
      build.derive,
      this.#keep(),
    );
    await writeAll(
      pod,
      [...made].map(
        ([path, triples]) =>
          [path, builtFileBytes(layout, address, path, triples)] as const,
      ),
    );
    await addLayout(union, layout, address);
    this.#kept.set(DATASET + build.lens, Promise.resolve(union));
  }
}
