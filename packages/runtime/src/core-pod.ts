import { ConnectRefused, readConnect } from "@cascade-runtime/fhir-pull";
import {
  type ChangeTimeDropped,
  entryChecked,
  fileConnect,
  fileEntry,
  fileExport,
} from "./arrivals.js";
import { counted, countedQuery, timed, timedAside } from "./probe.js";
import type { AdaptersOf, ConvertBudget } from "./bridge.js";
import {
  builtFileBytes,
  type Derive,
  manifest,
  type PodState,
  type VocabularyBuild,
} from "./build.js";
import {
  addLayout,
  built,
  podFiles,
  podStated,
  type PodStated,
} from "./dataset.js";
import type { SamesStillJoined } from "./derive.js";
import { Unopened } from "./encryption.js";
import { type Files, MemoryFiles, relative, writeAll } from "./files.js";
import { fileCreation, fileJudgment, fileReference } from "./filings.js";
import type { IdsAndTime } from "./ids.js";
import type { ExportDocument, Importer } from "./importer.js";
import { comparisons, type Kept, KeptMatcherJudgments } from "./kept.js";
import { HashedSet, type KeptSet } from "./kept-set.js";
import { LAYOUT_GRAPH, type Layout, SYNC } from "./layout.js";
import {
  MATCHER_LENS,
  matcherView,
  migrateRuleListVersions,
  openWithTables,
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
import {
  type BuildChange,
  type Change,
  KeptBuild,
  type Rebuilding,
} from "./incremental.js";
import { type BesideDatabase, PodDatabase } from "./pod-database.js";
import { type Act, same, StepWrites } from "./pod.js";
import {
  iri,
  KeptFiles,
  literal,
  RDF,
  type Triple,
  written,
  XSD,
} from "./rdf.js";
import { type References, tableTerms } from "./references.js";
import { Shapes } from "./shapes.js";
import { matcherJudgmentTouched } from "./shown.js";
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
 * The quads the matcher's views and the steps' rebuilds may remove from the kept build's store and add again before the
 * build moves to a store of its own.
 */
const COMPACT_AFTER_MOVED = 100_000;
const REVISION = "revision";
const KEPT = "kept";
const STATED = "stated";

export interface CorePodOptions {
  /** The pod's files, named by its address. */
  readonly pod: Files;
  readonly address: string;
  readonly subject: string;
  /** What the pod's manifest takes as its title; none for a pod that was never titled, whose manifest holds no title. */
  readonly title: string | undefined;
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
  /**
   * Where the runtime keeps what it built of the pod beside it, never in it. Given, with a build kept across steps, the manifest
   * names the hash of what the build read, `keepBuild` keeps the lens's derived state there, and a pod opened again reads
   * its build back instead of building it whole when the hash is still the pod's (C8).
   */
  readonly besidePod?: Files;
  /**
   * The database kept beside the pod, `pod.db`, by its path. Given, with `besidePod` and a build kept across steps, it is
   * built whole from the build at `keepBuild` when it is absent or its ledger names another hash than the build's, and
   * kept current after each step, once the step's files are written; a failure only leaves it to be built whole.
   */
  readonly database?: BesideDatabase;
  /**
   * What the code that runs is, by its bytes, where `runtime` does not name it exactly, as for a runtime run from a
   * checkout, whose built code is not committed; the hash of what a build read names it too.
   */
  readonly builtCode?: string;
}

/**
 * Where the build's working copy is kept beside the pod: one name whatever the pod or its lens, as a sealed pod's names
 * say nothing of what it holds.
 */
const BUILT_BESIDE = "build.trig";
/** Where an earlier runtime kept the build's derived state alone, removed once a working copy is kept. */
const DERIVED_BESIDE = "build.nt";

/** What a working copy is kept under: the hash of what its build read and the digest of each file the build wrote. */
function keptUnder(
  inputsHash: string,
  digests: Iterable<readonly [string, string]>,
): string {
  return JSON.stringify([
    inputsHash,
    [...digests].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The lens a pod's files are built under after every step, how, and the build to keep across steps. */
export interface PodBuildOption {
  readonly lens: string;
  readonly derive: Derive;
  readonly incremental?: VocabularyBuild;
  /**
   * For tests: after each step rebuilt in part, builds the pod whole too, and throws where it differs from the build in
   * part, or where a file written from the kept lines is not the bytes of one written from the same triples with nothing
   * kept, or from the build read back from what the step wrote and the derived state as it is kept beside the pod. The
   * file check compares only bytes of the same triples, so it cannot catch a write closure gone stale: one that reads
   * what changed between rebuilds, which a fresh write would not carry over.
   */
  readonly verify?: boolean;
  /** The quads the matcher's views may remove from the kept build's store and add again before it is renewed. */
  readonly renewAfterMoved?: number;
}

/** What the next rebuild changes of the kept build, recorded for the database beside the pod that holds it. */
interface DatabaseRecording {
  readonly built: KeptBuild;
  readonly database: PodDatabase;
  readonly changes: BuildChange[];
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
  /** Why the rules refused it; it then wrote no file of the person's. */
  readonly refused?: string;
  /** The import or entry session it made. */
  readonly activity?: string;
  /** The versions the pod names that the tables an open was given do not hold (O2). */
  readonly unheld?: readonly string[];
  /** The files that arrived from another writer, which it wrote but its act did not (S3). */
  readonly arrived?: readonly string[];
  /** The patient profiles the versions of an import's new revisions name, sorted. */
  readonly profilesNamed?: readonly string[];
  /** Each source change time an import's arrival stated and its revision does not carry, being no `xsd:dateTime` that states a time zone from -14:00 to +14:00 or whose instant in UTC is outside the years 0001 to 9999. */
  readonly changeTimesDropped?: readonly ChangeTimeDropped[];
}

/** The steps whose perform reads none of what the build writes, so that within `deferring` they leave their rebuild to the next read. */
const DEFERRABLE = new Set(["import", "judge"]);

/** The files each record was written in by either of two steps. */
function filesTogether(
  first: ReadonlyMap<string, readonly string[]> | undefined,
  second: ReadonlyMap<string, readonly string[]>,
): Map<string, readonly string[]> {
  const together = new Map(first);
  for (const [record, paths] of second)
    together.set(record, [...(together.get(record) ?? []), ...paths]);
  return together;
}

/** The rebuild of the steps `deferring` has not yet rebuilt after: what they changed, when the last began, and what they did. */
interface Pending {
  readonly kinds: readonly string[];
  readonly at: string;
  readonly change: Change;
  readonly performed: Performed;
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

/** The manifest's line giving the pod's title, which a retitle changes and no answer depends on; a line ends at a newline alone, not at U+2028 or U+2029, which a title may hold. */
const TITLE_LINE =
  /(?<=^|\n)\S+ <http:\/\/purl\.org\/dc\/terms\/title> [^\n]*\n?/g;

/** The manifest's line giving the hash of what its build read (C8), which a read may write again and no answer depends on. */
const INPUTS_HASH_LINE =
  /(?<=^|\n)\S+ <https:\/\/ns\.cascadeprotocol\.org\/cascade#buildInputsHash> [^\n]*\n?/g;

/**
 * The hash of the pod's address, the files it holds but those the build writes, and its manifest's bytes but its title
 * and its build's inputs hash; nothing is parsed. The build adds the title to the pod's union, so a named question that read the manifest's
 * `dct:title` would keep a stale answer after a retitle; none does.
 */
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
  const written = await pod.read(layout.manifest);
  const manifest =
    written === undefined
      ? new Uint8Array()
      : new TextEncoder().encode(
          new TextDecoder()
            .decode(written)
            .replace(TITLE_LINE, "")
            .replace(INPUTS_HASH_LINE, ""),
        );
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
 * refused, no file of the person's, and with a build the views and the other files the build writes are rebuilt after it.
 */
export class CorePod {
  #options: CorePodOptions;
  /** The pod's files as given, read past what `HeldFiles` holds of them. */
  readonly #unheld: Files;
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
  #keptMatcherJudgments: KeptMatcherJudgments;
  /** The build kept across steps, when the build is incremental and the last rebuild held. */
  #built: KeptBuild | undefined;
  /** The files of the build made whole for the step in progress before it wrote, written with the step's rebuild. */
  #builtBefore: ReadonlyMap<string, readonly Triple[]> | undefined;
  /** The hash of what the kept build read (C8), when it was read back or built under one. */
  #builtHash: string | undefined;
  /** The SHA-256, in hex, of each file the kept build wrote, as written or as read back. */
  #builtDigests = new Map<string, string>();
  /** The hash of what every build of the pod reads whatever its files: the runtime, the lens, the address and the vocabulary's texts, its comparisons among them. */
  #builtWith: Promise<string> | undefined;
  /** What each act file of the pod read or written so far holds of the chain, by path. */
  readonly #chain = new Map<string, ActFile>();
  /** What the act files the step in progress writes hold of the chain, by path, learnt once they are written. */
  #writing = new Map<string, ActFile>();
  /** Whether a step is being performed, after which the pod builds its dataset again. */
  #performing = false;
  /** The quads the matcher's views lent from the kept build's store have had it remove and add again. */
  #movedInBuilt = 0;
  /** How many `deferring` calls are running, which let the steps of `DEFERRABLE` leave their rebuild. */
  #deferring = 0;
  /** What the steps that left their rebuild changed, rebuilt before anything reads what the build writes. */
  #pending: Pending | undefined;
  /** The hash of what the kept build read, when it was rebuilt since its working copy was last kept beside the pod. */
  #toKeep: string | undefined;
  /**
   * What the working copy beside the pod was kept under, once this session read it back or kept it: the hash of what it
   * was built from and the digest of each file the build wrote.
   */
  #besideKept: string | undefined;
  /** The database beside the pod, opened when first needed; none where it is not kept or does not open. */
  #database: Promise<PodDatabase | undefined> | undefined;
  #databaseOpened: PodDatabase | undefined;
  /** The kept build the database beside the pod holds as it stands, under `#builtHash`; none when it may hold another. */
  #databaseHolds: KeptBuild | undefined;

  constructor(options: CorePodOptions) {
    this.#options = { ...options, pod: new HeldFiles(options.pod) };
    this.#unheld = options.pod;
    this.#keptMatcherJudgments = new KeptMatcherJudgments(options);
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
    await this.#settle();
    await this.#putBackMatcherView();
    await this.#withBuilt();
    return this.#held(`${DATASET}${lens}`, () =>
      this.#filled(new Union(this.#options.newStore()), lens),
    );
  }

  /** The union with the pod's files, the lens's derived state, the files the build writes and the layout. */
  async #filled(union: Union, lens: string): Promise<Union> {
    const { pod, layout, address, title, time, build } = this.#options;
    if (
      this.#options.besidePod !== undefined &&
      build?.incremental !== undefined &&
      lens === build.lens &&
      this.#built === undefined
    ) {
      const stated = await podStated(pod, layout, union.store);
      union.store.free?.();
      const state = { address, at: stated.at ?? time.now(), title };
      const paths = await this.#readPaths();
      const { inputsHash, back } = await this.#writtenBuild(
        build,
        build.incremental,
        state,
        stated.inputsHash,
        paths,
      );
      if (back !== undefined) {
        this.#built = back.kept;
        this.#builtDigests = back.digests;
        this.#builtHash = inputsHash;
        return back.kept.union;
      }
      return this.#builtForRead(
        build,
        build.incremental,
        state,
        stated,
        paths,
        inputsHash,
      );
    }
    await timedAside("core-pod.filled.podFiles", () =>
      podFiles(pod, layout, address, union),
    );
    if (build === undefined) {
      for (const path of layout.rebuilt.filter((path) => layout.loads(path))) {
        const bytes = await pod.read(path);
        if (bytes !== undefined) await union.loadTurtle(bytes, address + path);
      }
    } else {
      const at = (await podStated(pod, layout, union.store)).at ?? time.now();
      await build.derive(
        union,
        lens,
        { address, at, title },
        this.#samesStillJoined(),
      );
    }
    await addLayout(union, layout, address);
    return union;
  }

  /**
   * The pod's revision, as `podRevision` names it. Any step that writes changes it, and so does a refused one, whose
   * build writes the manifest again.
   */
  async revision(): Promise<string> {
    await this.#settle();
    return this.#held(REVISION, () => {
      const { pod, layout, address } = this.#options;
      return podRevision(pod, layout, address);
    });
  }

  /**
   * Sets the title the pod's manifest takes, and writes the manifest again with it, as a build writes it. The manifest
   * is a rebuilt file, outside the set hash, and the revision hashes it but for its title, so no revision, set hash or
   * kept answer changes. What is kept is dropped, since it holds the old title; the pod builds again when next read.
   */
  async retitle(title: string): Promise<void> {
    await this.#settle();
    this.#options = { ...this.#options, title };
    const { pod, layout, address, build, time } = this.#options;
    this.#release();
    this.#dropBuilt();
    (await this.#openDatabase())?.forget();
    if (build === undefined) return;
    const store = this.#options.newStore();
    let stated: Awaited<ReturnType<typeof podStated>>;
    try {
      stated = await podStated(pod, layout, store);
    } finally {
      store.free?.();
    }
    await pod.write(
      layout.manifest,
      builtFileBytes(
        layout,
        address,
        layout.manifest,
        manifest(
          address + layout.manifest,
          title,
          stated.at ?? time.now(),
          this.#head?.snapshot,
          stated.inputsHash,
        ),
      ),
    );
  }

  /**
   * The hash of what a build of the pod as it stands reads (C8), which the manifest names once the pod is built; none
   * when the pod keeps no build beside it.
   */
  async buildInputsHash(): Promise<string | undefined> {
    await this.#settle();
    const { build } = this.#options;
    return build?.incremental === undefined
      ? undefined
      : this.#inputsHash(build, build.incremental, await this.#readPaths());
  }

  /**
   * Keeps the build's derived state beside the pod, when it was rebuilt since it was last kept, so the pod opened again
   * reads its build back (C8): once, before `close`, rather than at every step. Left unkept, as when the process stops
   * first, the manifest names a hash the derived state beside the pod does not, and the pod is built whole when next
   * opened.
   */
  async keepBuild(): Promise<void> {
    await this.#settle();
    await this.#putBackMatcherView();
    await this.#withBuilt();
    const inputsHash = this.#toKeep;
    const built = this.#built;
    if (built === undefined) return;
    let dumping: Promise<Uint8Array> | undefined;
    const dumped = () => (dumping ??= built.union.store.dump());
    if (inputsHash !== undefined) {
      await timedAside("core-pod.keepBuild", () =>
        this.#keepBeside(inputsHash, built, dumped),
      );
      if (this.#built === built) this.#toKeep = undefined;
    }
    await timedAside("core-pod.keepDatabase", () =>
      this.#keepDatabase(built, dumped),
    );
  }

  /** The database beside the pod, opened once; none where none is kept, or where it does not open. */
  #openDatabase(): Promise<PodDatabase | undefined> {
    const { database, besidePod, vocabulary } = this.#options;
    if (database === undefined || besidePod === undefined)
      return Promise.resolve(undefined);
    if (this.#database === undefined) {
      const opening = PodDatabase.opened(database, besidePod, vocabulary).then(
        (opened) => (this.#databaseOpened = opened),
        () => {
          if (this.#database === opening) this.#database = undefined;
          return undefined;
        },
      );
      this.#database = opening;
    }
    return this.#database;
  }

  /**
   * Builds the database beside the pod whole from the kept build, when its ledger names another hash than the build's
   * or it was never built; a failure leaves it to be built whole the next time.
   */
  async #keepDatabase(
    built: KeptBuild,
    dumped: () => Promise<Uint8Array>,
  ): Promise<void> {
    const hash = this.#builtHash;
    if (hash === undefined || this.#built !== built) return;
    const database = await this.#openDatabase();
    if (database === undefined) return;
    if (database.fingerprint !== hash) {
      this.#databaseHolds = undefined;
      try {
        await timedAside("core-pod.keepDatabase.whole", async () =>
          database.builtWhole(await dumped(), built.union.graphs, hash),
        );
      } catch {
        return;
      }
    }
    this.#databaseHolds = built;
  }

  /**
   * The database beside the pod and the record of what the next rebuild changes of the kept build, when the database
   * holds that build as it stands: its ledger names the build's hash.
   */
  async #recordingForDatabase(): Promise<DatabaseRecording | undefined> {
    const built = this.#built;
    const hash = this.#builtHash;
    if (built === undefined || hash === undefined) return undefined;
    const database = await this.#openDatabase();
    if (database === undefined) return undefined;
    if (this.#databaseHolds !== built) {
      if (database.fingerprint !== hash) return undefined;
      this.#databaseHolds = built;
    }
    const changes: BuildChange[] = [];
    built.recording = changes;
    return { built, database, changes };
  }

  /**
   * After the rebuild, whose files are written, the database beside the pod kept current by keyed writes of what it
   * changed, in one transaction with its ledger; where the build was made whole instead, or the write fails, the
   * ledger still names the hash before the step and the database is built whole when next kept.
   */
  async #databaseKeptCurrent(
    recorded: DatabaseRecording | undefined,
  ): Promise<void> {
    if (recorded === undefined) return;
    const { built, database, changes } = recorded;
    built.recording = undefined;
    const hash = this.#builtHash;
    if (this.#built !== built || hash === undefined) {
      this.#databaseHolds = undefined;
      return;
    }
    try {
      await timedAside("core-pod.step.database", () =>
        database.applied(changes, built.unionAsItStands, hash),
      );
    } catch {
      this.#databaseHolds = undefined;
    }
  }

  /**
   * Drops what is kept, and frees it; the pod builds again when next read. Inside `deferring` it throws and drops
   * nothing, since the steps it left would be lost with their rebuild undone.
   */
  close(): void {
    if (this.#deferring > 0)
      throw new Error("close() inside deferring() would drop its rebuild");
    this.#pending = undefined;
    this.#release();
    this.#dropBuilt();
    this.#databaseOpened?.close();
    this.#databaseOpened = undefined;
    this.#database = undefined;
  }

  /**
   * Runs `run`, in which an import's step and the judgments filed after it leave their rebuild until something reads what
   * the build writes, or `run` ends, and are then rebuilt once for all of them: the rebuild of what several steps wrote
   * is the one the last would make, since a rebuild reads the files as they stand. A step that reads it (the matcher's
   * run, which reads each record's current version and subject) first rebuilds what was left. When `run` fails, what was
   * left is rebuilt before the failure is thrown, and when that rebuild fails too, an AggregateError of what `run`
   * threw and the rebuild's failure, in that order, is thrown; what `run` threw is not touched. A rebuild that
   * fails comes after the judgments were filed, since the steps it follows are all done by then: where each step
   * rebuilt on its own, the import's rebuild failed before any judgment was filed.
   */
  async deferring<T>(run: () => Promise<T>): Promise<T> {
    this.#deferring += 1;
    let result: T;
    try {
      result = await run();
    } catch (error) {
      this.#deferring -= 1;
      if (this.#deferring === 0)
        try {
          await this.#settle();
        } catch (failure) {
          throw new AggregateError(
            [error, failure],
            `the rebuild failed after the run failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: failure },
          );
        }
      throw error;
    }
    this.#deferring -= 1;
    if (this.#deferring === 0) await this.#settle();
    return result;
  }

  /** Rebuilds after the steps that left their rebuild, if any did, as the last of them would have. */
  async #settle(): Promise<void> {
    const pending = this.#pending;
    if (pending === undefined) return;
    this.#pending = undefined;
    await this.#rebuilt(
      pending.kinds.join("+"),
      pending.at,
      pending.change,
      pending.performed,
    );
  }

  /**
   * The build rebuilt after a step, or after the steps that left it; then, its files written, the database beside the
   * pod kept current with it.
   */
  async #rebuilt(
    kind: string,
    at: string | undefined,
    change: Change,
    performed: Performed,
  ): Promise<void> {
    const { build } = this.#options;
    if (build === undefined) return;
    const recorded = await this.#recordingForDatabase();
    try {
      await timedAside(`core-pod.step.rebuild:${kind}`, () =>
        this.#rebuild(build, at, change),
      );
    } catch (error) {
      this.#dropBuilt();
      if (error instanceof Unopened) throw error;
      throw new BuildFailure(performed, error);
    } finally {
      this.#builtBefore = undefined;
      if (recorded !== undefined) recorded.built.recording = undefined;
    }
    await this.#databaseKeptCurrent(recorded);
  }

  /** Each built file's lines by the triple each writes, kept while the build is: a step's rebuild hands back the triples that did not change as they were. */
  #lines = new KeptFiles();

  /** Frees the build kept across steps; the next step builds whole. */
  #dropBuilt(): void {
    this.#lines = new KeptFiles();
    this.#built?.free();
    this.#built = undefined;
    this.#builtHash = undefined;
    this.#builtDigests = new Map();
    this.#toKeep = undefined;
    this.#movedInBuilt = 0;
    this.#databaseHolds = undefined;
  }

  /**
   * Drops what is kept, freeing each union once it is made: the pod owns every union it keeps, and a union `dataset`
   * gave is read only until the next step or `close`.
   */
  #release(): void {
    const kept = this.#kept;
    this.#kept = new Map();
    const owned = this.#built?.store;
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
   * once an importer reads the path. `onProgress` is told as loading the adapter, each conversion and saving begin;
   * each conversion is held to `budget`.
   */
  async import(
    exported: Pick<Files, "read" | "list">,
    folder: string,
    adapters: () => Promise<AdaptersOf>,
    onProgress?: OnProgress,
    budget?: ConvertBudget,
  ): Promise<Performed> {
    const { importers } = this.#options;
    let profilesNamed: readonly string[] = [];
    let changeTimesDropped: readonly ChangeTimeDropped[] = [];
    let filesOf: ReadonlyMap<string, readonly string[]> | undefined;
    const performed = await this.#step(
      async (context) => {
        let documents: readonly ExportDocument[] | undefined;
        for (const importer of importers) {
          try {
            documents = await timedAside("core-pod.import.documents", () =>
              importer.documents(exported, folder),
            );
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
        const loaded = await timedAside("core-pod.import.adapters", adapters);
        const filed = await timedAside("arrivals.fileExport", () =>
          fileExport(context, documents, loaded, onProgress, budget),
        );
        profilesNamed = filed.patients;
        changeTimesDropped = filed.changeTimesDropped;
        filesOf = filed.filesOf;
        await onProgress?.({ part: "saving" });
        return filed.activity;
      },
      false,
      "import",
      () => filesOf,
    );
    return performed.refused === undefined
      ? {
          ...performed,
          profilesNamed,
          ...(changeTimesDropped.length === 0 ? {} : { changeTimesDropped }),
        }
      : performed;
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

  /** What `enter` would say to `entry`, without writing anything: why it is refused, or its statements and the vocabulary's labels. */
  async checkEntry(entry: StepFile) {
    return entryChecked(
      { newStore: this.#options.newStore, time: this.#options.time },
      entry,
      await this.#shapes(),
    );
  }

  /** A person's judgment, filed as N16 keeps it (N10). */
  judge(judgment: StepFile): Promise<Performed> {
    return this.#step(
      (context) =>
        fileJudgment(
          context,
          judgment,
          {
            // The matcher's view is built only for a judgment that has something to read it for.
            select: async (query) =>
              (await context.matcherView()).select(query),
          },
          () => this.#shapes(),
        ),
      false,
      "judge",
      () => new Map(),
    );
  }

  /**
   * Refuses another writer's files that replace or retract a matcher's judgment (N16), one of the pod's or one among
   * the files arriving; reads nothing when no arriving file in a judgment's folder or a retraction's folder says so.
   * Only a writer that went around its runtime files one, so a replacement placed outside those folders, or one whose
   * matcher's judgment arrives in a later call, is not caught. One refused file refuses the whole receive, which writes
   * nothing, and every later receive from that writer meets the same file.
   */
  async #refuseMatcherJudgmentsTouched(
    layout: Layout,
    arriving: readonly (readonly [string, Uint8Array])[],
    address: string,
    newStore: StoreFactory,
  ): Promise<void> {
    const folders = [
      layout.find(`${CASCADE}Judgment`)?.folder,
      layout.find(`${PROV}Activity`, [`${PROV}invalidated`])?.folder,
    ].flatMap((folder) => folder ?? []);
    const decoder = new TextDecoder();
    const files = arriving.filter(([path]) =>
      folders.some((folder) => path.startsWith(folder)),
    );
    if (
      !files.some(([, bytes]) =>
        /replaces|invalidated/.test(decoder.decode(bytes)),
      )
    )
      return;
    const parsed = await Promise.all(
      files.map(async ([path, bytes]) =>
        newStore().parse(bytes, address + path),
      ),
    );
    const matchers = new Set(
      parsed.flatMap((triples) =>
        triples.flatMap(([s, p]) =>
          p.value === `${CASCADE}matcherRule` ? [s.value] : [],
        ),
      ),
    );
    const read = await this.#matcherView();
    for (const [at, triples] of parsed.entries())
      for (const subject of new Set(
        triples.flatMap(([s, p]) =>
          p.value === "http://purl.org/dc/terms/replaces" ||
          p.value === `${PROV}invalidated`
            ? [s.value]
            : [],
        ),
      )) {
        const refused = await matcherJudgmentTouched(
          read,
          triples,
          subject,
          matchers,
        );
        if (refused !== undefined)
          throw new Refusal(
            `${files[at]?.[0] ?? ""} is refused, and with it every file of this receive: ${refused}. It came from a writer that went around its runtime: remove it on the sending device, or file a Same or a Different over the records instead`,
          );
      }
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
      const opened = await openWithTables(context, tables);
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
    const performed = await this.#step(
      (context) => runMatcher(context, tables, activity),
      false,
      "match",
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
   * tables to read has none. A file that replaces or retracts a matcher's judgment (N16) refuses the whole receive,
   * which writes nothing; one placed outside the judgment folders, or whose matcher's judgment arrives in a later call,
   * is not caught, as only a writer that went around its runtime makes one.
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
        await this.#refuseMatcherJudgmentsTouched(
          layout,
          others,
          pod.iri,
          newStore,
        );
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
    countedQuery("core-pod.matcherSelect", query);
    return timed("core-pod.matcherSelect", async () =>
      (await this.#matcherView()).select(query),
    );
  }

  /** The kinds of finding for review the vocabulary names, which an Acknowledged may answer. */
  async findingKinds(): Promise<ReadonlySet<string>> {
    const { vocabulary, newStore } = this.#options;
    return (await tableTerms(vocabulary, newStore)).findingKinds;
  }

  /**
   * `select`, read from the build kept across steps, which a pod just opened has none of and is built whole for it: so
   * the step after, an import's, continues from that build and does not read and derive the pod again. Where the build
   * is not kept across steps this is `select`.
   */
  async selectKept(query: string): Promise<Rows> {
    await this.#settle();
    const { build, time } = this.#options;
    const kept = await this.#keptOrBuiltWhole(
      build === undefined ? undefined : time.now(),
    );
    if (kept === undefined) return this.select(query);
    countedQuery("core-pod.matcherSelect", query);
    return timed("core-pod.matcherSelect", () => kept.select(query));
  }

  /**
   * The query's rows over the pod's RDF files but those the build writes, with nothing derived: the vocabulary is not
   * read. The files are read into a store once, kept until the next step, which may change them.
   */
  async selectStated(query: string): Promise<Rows> {
    for (;;) {
      const held = this.#held(STATED, async () => {
        const { pod, layout, address, newStore } = this.#options;
        const union = new Union(newStore());
        try {
          await timedAside("core-pod.selectStated.podFiles", () =>
            podFiles(pod, layout, address, union),
          );
        } catch (error) {
          union.store.free?.();
          throw error;
        }
        return union;
      });
      const union = await held;
      if (this.#kept.get(STATED) === held) return union.select(query);
    }
  }

  /**
   * The query's rows over a dataset of its own, built as `dataset` builds one (the pod's views among it, which the
   * matcher's view lacks), with the current version of each series of the kind added as the matcher adds it: the rows
   * the pod's codes find and the descriptions. It writes nothing, and no row reaches a held dataset, a question's
   * dataset or an answer.
   */
  async selectWithRows(query: string, kind: string): Promise<Rows> {
    await this.#settle();
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
    await this.#settle();
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
  async #matcherView(): Promise<Union> {
    await this.#settle();
    return this.#held(MATCHER_VIEW, () => this.#lendMatcherView());
  }

  async #lendMatcherView(): Promise<Union> {
    return timed("core-pod.matcherView", async () => {
      const { build, address, layout } = this.#options;
      const dataset =
        build?.lens === MATCHER_LENS
          ? ((await this.#keptUnderLens()) ?? (await this.#readBack()))
          : undefined;
      if (dataset === undefined)
        return matcherView(this.#options, this.#samesStillJoined());
      const built = this.#built;
      const lent = built !== undefined && dataset === built.unionAsItStands;
      if (lent) this.#movedInBuilt += await built.withoutBuilt();
      const rebuilt = new Set(layout.rebuilt.map((path) => address + path));
      const left = [...dataset.graphs].filter(
        (graph) => graph === LAYOUT_GRAPH || rebuilt.has(graph),
      );
      if (this.#performing && !lent) {
        this.#kept.delete(DATASET + MATCHER_LENS);
        for (const graph of left) await dataset.drop(graph);
        return dataset;
      }
      const view = new RestorableUnion(dataset.store, dataset.graphs);
      for (const graph of left) await view.drop(graph);
      return view;
    });
  }

  /**
   * The build kept beside the pod read back, when nothing is built and it holds (C8), kept as the build the next step
   * continues from; else none.
   */
  async #readBack(): Promise<Union | undefined> {
    const { build, besidePod, time } = this.#options;
    const incremental = build?.incremental;
    if (
      build === undefined ||
      incremental === undefined ||
      besidePod === undefined ||
      this.#built !== undefined
    )
      return undefined;
    const { inputsHash, back } = await this.#writtenBuild(
      build,
      incremental,
      this.#state(time.now()),
      await this.#namedHash(),
      await this.#readPaths(),
    );
    if (back === undefined) return undefined;
    this.#built = back.kept;
    this.#builtHash = inputsHash;
    this.#builtDigests = back.digests;
    if (this.#performing) this.#builtBefore = back.files;
    this.#kept.set(DATASET + build.lens, Promise.resolve(back.kept.union));
    return back.kept.union;
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

  /**
   * Puts the files the build writes and the layout back in the build kept across steps, if they were lent out to the
   * matcher's view: they stay out across steps, which rebuild them beside the union, until a read needs the whole pod.
   */
  async #withBuilt(): Promise<void> {
    const built = this.#built;
    if (built === undefined) return;
    this.#movedInBuilt += await built.withBuilt();
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
    if (view.store !== this.#built?.store) return;
    this.#movedInBuilt += view.moved;
    await this.#compactedIfMoved();
  }

  /** Moves the kept build to a store of its own once the quads removed from its store and added again are enough. */
  async #compactedIfMoved(): Promise<void> {
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
    const built = this.#built?.store;
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
    counted("core-pod.compactions");
    const was = built.unionAsItStands;
    try {
      await timedAside("core-pod.compact", () => built.compact());
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
        this.#kept.set(key, Promise.resolve(built.unionAsItStands));
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

  /** A pod that stands where this one does, over a copy of its files, with its own time, keeping nothing beside the pod. */
  async fork(time: IdsAndTime): Promise<CorePod> {
    await this.#settle();
    const options: {
      -readonly [K in keyof CorePodOptions]: CorePodOptions[K];
    } = { ...this.#options };
    delete options.besidePod;
    delete options.database;
    const fork = new CorePod({
      ...options,
      pod: await copied(this.#options.pod),
      time,
    });
    fork.#references = this.#references;
    fork.#keptMatcherJudgments = this.#keptMatcherJudgments;
    fork.#head = this.#head;
    fork.#headHeld = this.#headHeld;
    fork.#hashed = this.#hashed?.copy();
    for (const [path, file] of this.#chain) fork.#chain.set(path, file);
    if (this.#readShapes !== undefined) fork.#holdShapes(this.#readShapes);
    return fork;
  }

  /** A second writer of the pod: over a copy of its files, with no snapshot of its own, a new writer (N14). */
  async newWriter(): Promise<CorePod> {
    await this.#settle();
    const writer = new CorePod({
      ...this.#options,
      pod: await copied(this.#options.pod),
      head: undefined,
      keepHead: undefined,
      database: undefined,
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
  #samesStillJoined(): SamesStillJoined {
    return async (union) =>
      (
        await this.#held(KEPT, () =>
          this.#keptMatcherJudgments.of(union, () => this.#tables()),
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
        // KeptMatcherJudgments adds a version's rows to the union it reads and drops them after: safe on the kept dataset only
        // because a pod's reads and steps run one at a time.
        kept = this.#held(KEPT, () =>
          this.#keptMatcherJudgments.of(dataset, () => this.#tables()),
        );
      } else {
        await this.#matcherView();
        kept = this.#kept.get(KEPT) as Promise<Kept> | undefined;
      }
    }
    return (await kept)?.unheld ?? [];
  }

  /** The vocabulary's shapes, read once for the pod. */
  vocabularyShapes(): Promise<Shapes> {
    return this.#shapes();
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
    kind = "other",
    /** The records of the files of the clinical kinds the step wrote, for the steps that know them. */
    filesWritten?: () => ReadonlyMap<string, readonly string[]> | undefined,
  ): Promise<Performed> {
    const options = this.#options;
    const deferred = this.#deferring > 0 && DEFERRABLE.has(kind);
    if (!deferred) await this.#settle();
    const at = options.build === undefined ? undefined : options.time.now();
    const writes = new StepWrites();
    let performed: Performed;
    let change: Change | undefined = { written: [], everything };
    try {
      this.#performing = true;
      const activity = await timedAside("core-pod.step.perform", () =>
        perform({
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
          selectStated: (query) => this.selectStated(query),
        }),
      ).finally(async () => {
        this.#performing = false;
        await this.#releaseMatcherView();
      });
      let head: Head | undefined;
      let hashed: { readonly set: HashedSet; readonly act: string } | undefined;
      const wrote = await timedAside("core-pod.step.commit", () =>
        writes.commit(options.pod, (act, fresh, arrived) =>
          timedAside("core-pod.step.finished", async () => {
            const finished = await this.#finished(act, fresh, arrived);
            head = finished.head;
            hashed = { set: finished.hashed, act: act.path };
            return finished.triples;
          }),
        ),
      );
      for (const [path, file] of this.#writing) this.#chain.set(path, file);
      if (head !== undefined) {
        this.#head = head;
        this.#headHeld = true;
        const kept = await timedAside("core-pod.step.keptAfter", () =>
          this.#keptAfter(hashed),
        );
        if (kept !== undefined) this.#head = head = { ...head, set: kept };
        await options.keepHead?.(head).catch(() => undefined);
      }
      performed =
        typeof activity === "string" ? { wrote, activity } : { wrote };
    } catch (error) {
      if (!(error instanceof Refusal) || error instanceof Unopened) {
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
      } else {
        const filesOf =
          writes.committed.length === 0
            ? new Map<string, readonly string[]>()
            : filesWritten?.();
        change = {
          ...change,
          written: writes.committed,
          ...(filesOf === undefined ? {} : { filesOf }),
        };
      }
    }
    if (options.build === undefined) return performed;
    if (deferred && at !== undefined) {
      const before = this.#pending;
      this.#pending = {
        kinds: before?.kinds.includes(kind)
          ? before.kinds
          : [...(before?.kinds ?? []), kind],
        at,
        change: {
          written: [...(before?.change.written ?? []), ...change.written],
          ...(before?.change.everything === true || change.everything === true
            ? { everything: true }
            : {}),
          ...(change.filesOf !== undefined &&
          (before === undefined || before.change.filesOf !== undefined)
            ? {
                filesOf: filesTogether(before?.change.filesOf, change.filesOf),
              }
            : {}),
        },
        performed: {
          ...performed,
          wrote: [...(before?.performed.wrote ?? []), ...performed.wrote],
          ...(performed.activity === undefined &&
          before?.performed.activity !== undefined
            ? { activity: before.performed.activity }
            : {}),
        },
      };
      return performed;
    }
    await this.#rebuilt(kind, at, change, performed);
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
      const paths = await this.#readPaths();
      const { inputsHash, back } = await this.#writtenBuild(
        build,
        incremental,
        this.#state(at),
        await this.#namedHash(),
        paths,
      );
      const whole =
        back ??
        (await timedAside("kept.whole", () =>
          KeptBuild.whole(
            this.#rebuilding(build, incremental),
            this.#state(at),
            paths,
          ),
        ));
      this.#built = whole.kept;
      this.#builtHash = inputsHash;
      this.#builtDigests = back?.digests ?? new Map<string, string>();
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
      samesStillJoined: async (union: Union) =>
        (await this.#keptMatcherJudgments.of(union, () => this.#tables()))
          .triples,
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
        : await HashedSet.ofKept(kept, new Set(listing.filter(inSet))));
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

  /** The paths of the pod's files a build reads: every RDF file but those the build writes. */
  async #readPaths(): Promise<string[]> {
    const { pod, layout } = this.#options;
    const rebuilt = new Set(layout.rebuilt);
    return (await pod.list("")).filter(
      (path) => layout.loads(path) && !rebuilt.has(path),
    );
  }

  /**
   * The hash of everything a build of the pod's files at the paths reads (C8): the runtime, the lens, the pod's address,
   * the texts of the lens's derivations, the layout, the build's queries and the matcher's comparisons; each path; the
   * bytes of each file outside the snapshot set, which may change in place, as the card, the settings or a file placed by
   * hand; and what the tables' index states of each version the pod files and of its series, as its kind, but the version
   * the series ships with. A file of the set is named by what it holds (N9), so its path stands for its bytes; a
   * version's rows never change, and a series' current version is read from the pod's files, not the tables. None
   * without a place beside the pod to keep the build in.
   */
  async #inputsHash(
    build: PodBuildOption,
    incremental: VocabularyBuild,
    read: readonly string[],
  ): Promise<string | undefined> {
    const { pod, layout, address, runtime, builtCode, besidePod, vocabulary } =
      this.#options;
    if (besidePod === undefined) return undefined;
    return timedAside("core-pod.inputsHash", async () => {
      this.#builtWith ??= comparisons(vocabulary).then((compared) =>
        fileDigest(
          new TextEncoder().encode(
            JSON.stringify([
              runtime,
              builtCode ?? null,
              build.lens,
              address,
              incremental.derivations.for(build.lens).map(({ query }) => query),
              layout.turtle,
              incremental.queries,
              [...compared].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
            ]),
          ),
        ).then(hex),
      );
      const paths = [...read].sort();
      const inPlace: string[] = [];
      for (const path of paths)
        if (!layout.inSnapshotSet(path)) {
          const bytes = await pod.read(path);
          inPlace.push(
            path,
            bytes === undefined ? "" : hex(await fileDigest(bytes)),
          );
        }
      const references = await this.#tables();
      const { index } = references;
      const listed = new Set(paths);
      const series = layout.place(`${CASCADE}ReferenceSeries`);
      const described = new Set<string>();
      for (const [version] of index.match(
        undefined,
        `${PROV}specializationOf`,
      )) {
        let path: string;
        try {
          path = layout.version(series, version.value);
        } catch {
          continue;
        }
        if (!listed.has(path)) continue;
        described.add(version.value);
        const of = references.seriesOf(version.value);
        if (of !== undefined) described.add(of);
      }
      const tables = [...described]
        .flatMap((thing) => references.description(thing))
        .map((triple) => triple.map(written).join(" "))
        .sort();
      const all = JSON.stringify([
        await this.#builtWith,
        paths,
        inPlace,
        tables,
      ]);
      return hex(await fileDigest(new TextEncoder().encode(all)));
    });
  }

  /**
   * The build the pod's files and what is kept beside it hold, read back, when the manifest names the hash of what a
   * build of the pod as it stands reads, and the derived state kept beside it was kept under that hash with every file
   * it names still holding the bytes it was kept with; otherwise none, and the pod is built. Beside it, the hash it was
   * compared with; none when the manifest names none, which is not hashed, so the tables are read only when needed.
   */
  async #writtenBuild(
    build: PodBuildOption,
    incremental: VocabularyBuild,
    state: PodState,
    named: string | undefined,
    paths: readonly string[],
  ): Promise<{
    inputsHash: string | undefined;
    back:
      | {
          kept: KeptBuild;
          files: ReadonlyMap<string, readonly Triple[]>;
          digests: Map<string, string>;
        }
      | undefined;
  }> {
    const { besidePod } = this.#options;
    if (besidePod === undefined || named === undefined)
      return { inputsHash: undefined, back: undefined };
    const inputsHash = await this.#inputsHash(build, incremental, paths);
    return {
      inputsHash,
      back:
        named === inputsHash
          ? await this.#keptBack(build, incremental, state, inputsHash, paths)
          : undefined,
    };
  }

  /** The build kept beside the pod under the hash, read back, when it holds; otherwise none. */
  async #keptBack(
    build: PodBuildOption,
    incremental: VocabularyBuild,
    state: PodState,
    inputsHash: string,
    paths: readonly string[],
  ): Promise<
    | {
        kept: KeptBuild;
        files: ReadonlyMap<string, readonly Triple[]>;
        digests: Map<string, string>;
      }
    | undefined
  > {
    const { pod, besidePod } = this.#options;
    if (besidePod === undefined) return undefined;
    const kept = await besidePod.read(BUILT_BESIDE).catch(() => undefined);
    if (kept === undefined) return undefined;
    const end = kept.indexOf(0x0a);
    if (end < 0) return undefined;
    let header: {
      inputsHash?: unknown;
      built?: unknown;
      graphs?: unknown;
      sha256?: unknown;
    };
    try {
      header = JSON.parse(
        new TextDecoder().decode(kept.subarray(2, end)),
      ) as typeof header;
    } catch {
      return undefined;
    }
    if (
      header.inputsHash !== inputsHash ||
      typeof header.built !== "object" ||
      header.built === null ||
      Array.isArray(header.built)
    )
      return undefined;
    const { graphs, sha256 } = header;
    if (
      !Array.isArray(graphs) ||
      !graphs.every((graph) => typeof graph === "string") ||
      typeof sha256 !== "string"
    )
      return undefined;
    const digests = new Map<string, string>();
    const held = await timedAside("core-pod.builtDigests", async () => {
      for (const [path, digest] of Object.entries(header.built as object)) {
        const bytes = await pod.read(path);
        if (bytes === undefined || hex(await fileDigest(bytes)) !== digest)
          return false;
        digests.set(path, digest as string);
      }
      return true;
    });
    if (!held) return undefined;
    const store = kept.subarray(end + 1);
    const digest = await timedAside("core-pod.besideDigest", () =>
      fileDigest(store),
    );
    if (hex(digest) !== sha256) return undefined;
    const back = await KeptBuild.readBack(
      this.#rebuilding(build, incremental),
      state,
      { store, graphs: graphs as string[], read: [...digests.keys()], paths },
    ).catch(() => undefined);
    if (back === undefined) return undefined;
    if (!(await this.#hashCovers(back.kept.union, paths))) {
      back.kept.free();
      return undefined;
    }
    this.#besideKept = keptUnder(inputsHash, digests);
    return { ...back, digests };
  }

  /**
   * Whether the inputs hash over the paths covers what a build of them read of the tables: it hashes the tables' index
   * of each version filed where the layout gives it, and a build reads the tables for each current version of a series
   * the union names, which a file elsewhere may state.
   */
  async #hashCovers(union: Union, paths: readonly string[]): Promise<boolean> {
    const { layout } = this.#options;
    const listed = new Set(paths);
    const series = layout.place(`${CASCADE}ReferenceSeries`);
    const { rows } = await union.select(
      `SELECT DISTINCT ?version WHERE { ?series a <${CASCADE}ReferenceSeries> ; <http://purl.org/pav/hasCurrentVersion> ?version }`,
    );
    return rows.every((row) => {
      try {
        return listed.has(
          layout.version(series, row.get("version")?.value ?? ""),
        );
      } catch {
        return false;
      }
    });
  }

  /** The hash the manifest names, read before anything is hashed: a pod built before builds were kept names none. */
  async #namedHash(): Promise<string | undefined> {
    const { pod, layout, newStore } = this.#options;
    const store = newStore();
    try {
      return (await podStated(pod, layout, store)).inputsHash;
    } finally {
      store.free?.();
    }
  }

  /**
   * The pod built whole for a read, kept as the build the next step continues from and, once the pod closes, beside the
   * pod (C8), so the next session reads it back. The read writes each file the build writes whose bytes the pod does not
   * hold, the manifest last, as a step would: all of them when the manifest names another hash than the build's, as
   * after an upgrade, and when it names the build's, those a crash or a sync left holding other bytes. The manifest is
   * the one the pod held but for the hash, so the pod's revision stays as it was; it writes no file a step does not
   * write, and a write that fails, as to a pod on a read-only disk, keeps nothing and answers all the same.
   */
  async #builtForRead(
    build: PodBuildOption,
    incremental: VocabularyBuild,
    pod: PodState,
    stated: PodStated,
    paths: readonly string[],
    hashed?: string,
  ): Promise<Union> {
    const { layout, address } = this.#options;
    const inputsHash =
      hashed ?? (await this.#inputsHash(build, incremental, paths));
    const state = {
      ...pod,
      ...(inputsHash === undefined ? {} : { inputsHash }),
    };
    const whole = await timedAside("kept.whole", () =>
      KeptBuild.whole(this.#rebuilding(build, incremental), state, paths),
    );
    this.#built = whole.kept;
    this.#builtHash = inputsHash;
    this.#lines = new KeptFiles();
    const bytes = [...whole.files]
      .map(
        ([path, triples]) =>
          [
            path,
            builtFileBytes(
              layout,
              address,
              path,
              path === layout.manifest
                ? manifest(
                    address + layout.manifest,
                    stated.title,
                    pod.at,
                    stated.snapshot,
                    inputsHash,
                  )
                : triples,
            ),
          ] as const,
      )
      .sort(
        ([a], [b]) =>
          Number(a === layout.manifest) - Number(b === layout.manifest),
      );
    const files = this.#options.pod;
    const differing: (readonly [string, Uint8Array])[] = [];
    for (const [path, made] of bytes) {
      const held = await files.read(path);
      if (held === undefined || !same(held, made)) differing.push([path, made]);
    }
    const written =
      differing.length === 0 ||
      ((await this.#unchangedSince(paths)) &&
        (await writeAll(files, differing).then(
          () => true,
          () => false,
        )));
    if (written) {
      this.#builtDigests = new Map();
      for (const [path, made] of bytes)
        this.#builtDigests.set(path, hex(await fileDigest(made)));
      this.#toKeep = inputsHash;
    }
    return whole.kept.union;
  }

  /**
   * Whether the pod, read past what is held of it, still holds the manifest the read was built under and lists the paths
   * it read: no other session's step landed since, whose files and manifest a read's write would go over. No lock is
   * taken, so this narrows the race rather than closing it.
   */
  async #unchangedSince(paths: readonly string[]): Promise<boolean> {
    const { pod, layout } = this.#options;
    const held = await pod.read(layout.manifest);
    const now = await this.#unheld.read(layout.manifest);
    if (
      held === undefined
        ? now !== undefined
        : now === undefined || !same(held, now)
    )
      return false;
    const rebuilt = new Set(layout.rebuilt);
    const listed = (await this.#unheld.list("")).filter(
      (path) => layout.loads(path) && !rebuilt.has(path),
    );
    const read = new Set(paths);
    return (
      listed.length === read.size && listed.every((path) => read.has(path))
    );
  }

  /**
   * Keeps the build's working copy beside the pod, its store as `Store.dump` writes it, under the hash of what it read,
   * naming each file of the pod its queries wrote with the SHA-256 of the bytes written there, the SHA-256 of the store's
   * bytes, and the union's graphs; a failure keeps nothing, and so does a build that does not know those bytes, and the
   * pod is built whole when next opened.
   */
  async #keepBeside(
    inputsHash: string,
    built: KeptBuild,
    dumped: () => Promise<Uint8Array>,
  ): Promise<void> {
    const { besidePod, layout } = this.#options;
    if (besidePod === undefined) return;
    const views = new Set(layout.views.map(({ file }) => file));
    const digests: Record<string, string> = {};
    for (const file of layout.built.flatMap(({ file }) => file ?? []))
      if (!views.has(file) || built.held.has(file)) {
        const digest = this.#builtDigests.get(file);
        if (digest === undefined) return;
        digests[file] = digest;
      }
    const kept = keptUnder(inputsHash, Object.entries(digests));
    if (kept === this.#besideKept) return;
    let store: Uint8Array;
    try {
      store = await timedAside("core-pod.keepBuild.dump", dumped);
    } catch {
      return;
    }
    const sha256 = hex(await fileDigest(store));
    const graphs = [...built.union.graphs];
    const header = new TextEncoder().encode(
      `# ${JSON.stringify({ inputsHash, built: digests, sha256, graphs })}\n`,
    );
    const bytes = new Uint8Array(header.length + store.length);
    bytes.set(header);
    bytes.set(store, header.length);
    const written = await timedAside("core-pod.keepBuild.write", () =>
      besidePod.write(BUILT_BESIDE, bytes),
    ).then(
      () => true,
      () => false,
    );
    if (!written) return;
    this.#besideKept = kept;
    await besidePod.remove?.([DERIVED_BESIDE]).catch(() => undefined);
  }

  /** Throws where the build in part, or the build read back from what it wrote and kept, differs from a build whole. */
  async #verified(
    rebuilding: Rebuilding,
    state: PodState,
    built: KeptBuild,
  ): Promise<void> {
    const { pod, layout } = this.#options;
    const views = new Set(layout.views.map(({ file }) => file));
    const read: string[] = [];
    for (const file of layout.built.flatMap(({ file }) => file ?? []))
      if (
        (!views.has(file) || built.held.has(file)) &&
        (await pod.read(file)) !== undefined
      )
        read.push(file);
    const whole = await KeptBuild.whole(rebuilding, state);
    const union = await built.unionWhole();
    const back = await KeptBuild.readBack(rebuilding, state, {
      store: await union.store.dump(),
      graphs: [...union.graphs],
      read,
      paths: [...built.paths],
    });
    try {
      await built.verify(whole);
      await back.kept.verify(whole, { everyGraph: true });
    } finally {
      back.kept.free();
      whole.kept.free();
    }
  }

  async #rebuild(
    build: PodBuildOption,
    at: string | undefined,
    change: Change,
  ): Promise<void> {
    const { pod, layout, address, title, newStore } = this.#options;
    if (build.incremental !== undefined && at !== undefined) {
      const { incremental } = build;
      const stated = async (paths: readonly string[]) => {
        const inputsHash = await this.#inputsHash(build, incremental, paths);
        return {
          ...this.#state(at),
          ...(inputsHash === undefined ? {} : { inputsHash }),
        };
      };
      const rebuilding = this.#rebuilding(build, incremental);
      let built = this.#built;
      let state: PodState | undefined;
      let files: ReadonlyMap<string, readonly Triple[]> | undefined;
      if (built !== undefined) {
        const rebuilt = new Set(layout.rebuilt);
        const read = new Set(built.paths);
        for (const path of change.written)
          if (layout.loads(path) && !rebuilt.has(path)) read.add(path);
        const given = (state = await stated([...read]));
        const stepping = built;
        // A step for every record that wrote nothing, as an open given tables the build was made with, changed none.
        const changed =
          change.everything === true &&
          change.written.length === 0 &&
          given.inputsHash !== undefined &&
          given.inputsHash === this.#builtHash &&
          (await this.#hashCovers(await stepping.unionWhole(), [...read]))
            ? { written: [] }
            : change;
        files = await timedAside("kept.step", () =>
          stepping.step(changed, given),
        );
      }
      if (files !== undefined && this.#builtBefore !== undefined)
        files = new Map([...this.#builtBefore, ...files]);
      const verifying =
        built !== undefined && files !== undefined && build.verify === true
          ? built
          : undefined;
      if (built === undefined || files === undefined || state === undefined) {
        this.#dropBuilt();
        const paths = await this.#readPaths();
        const given = (state = await stated(paths));
        const whole = await timedAside("kept.whole", () =>
          KeptBuild.whole(rebuilding, given, paths),
        );
        built = this.#built = whole.kept;
        files = whole.files;
      }
      const { inputsHash } = state;
      const made = files;
      this.#lines.keepOnly(new Set(made.keys()));
      const bytes = await timedAside("core-pod.rebuild.bytes", async () =>
        [...made]
          .map(
            ([path, triples]) =>
              [
                path,
                builtFileBytes(
                  layout,
                  address,
                  path,
                  triples,
                  this.#lines.of(path),
                ),
              ] as const,
          )
          .sort(
            ([a], [b]) =>
              Number(a === layout.manifest) - Number(b === layout.manifest),
          ),
      );
      await timedAside("core-pod.rebuild.writeAll", () => writeAll(pod, bytes));
      for (const [path, written] of bytes)
        this.#builtDigests.set(path, hex(await fileDigest(written)));
      if (build.verify === true)
        for (const [path, written] of bytes) {
          const fresh = builtFileBytes(
            layout,
            address,
            path,
            made.get(path) ?? [],
          );
          if (
            fresh.length !== written.length ||
            fresh.some((byte, at) => byte !== written[at])
          )
            throw new Error(
              `${path} as written from the kept lines differs from it written afresh`,
            );
        }
      if (verifying !== undefined)
        await this.#verified(rebuilding, state, verifying);
      if (built === this.#built) {
        this.#movedInBuilt += built.moved();
        await this.#compactedIfMoved();
      }
      this.#kept.set(
        DATASET + build.lens,
        Promise.resolve(built.unionAsItStands),
      );
      this.#builtHash = inputsHash;
      this.#toKeep = inputsHash;
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
      this.#samesStillJoined(),
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
