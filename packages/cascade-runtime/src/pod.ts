import {
  clock,
  codeIri,
  CorePod,
  type DeriveKey,
  EncryptedFiles,
  type Files,
  type Head,
  type Importer,
  type ConvertBudget,
  type ImportProgress,
  type IndexEntry,
  type Layout,
  LAYOUT_FILE,
  lenses,
  type Loaded,
  QUERIES,
  ofMediaType,
  type WasmBridge,
  type AdaptersOf,
  type Exported,
  exportedNames,
  ExportedFiles,
  type ListColumn,
  MemoryFiles,
  podRevision,
  type PodKey,
  SealedIndex,
  podStated,
  questions,
  randomId,
  RDF,
  readText,
  type References,
  Refusal,
  type Store,
  type StoreFactory,
  tableTerms,
  type Triple,
  Union,
  type VocabularyBuild,
  type VocabularyQuery,
  withLists,
} from "@cascade-runtime/runtime";
import { timed, timedAside } from "@cascade-runtime/runtime/probe";
import {
  answerKey,
  Answers,
  type AnswerStore,
  type Described,
} from "./answers.js";
import { checkJudgment, judged } from "./judging.js";
import { acceptOptions } from "./options.js";
import { THIS_JUDGMENT } from "./proposals.js";
import type { Row, TextRow } from "./row-text.js";
import { currentOf, ofKinds, shipped, type Tables } from "./tables.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const TYPE = `${RDF}type`;
const PREFIXES = `PREFIX cascade: <${CASCADE}> PREFIX prov: <${PROV}> PREFIX pav: <${PAV}> PREFIX bridge: <${BRIDGE}>`;
const UUID = "urn:uuid:";

/** A name as a person reads it, its runs of white space one space. */
function spaced(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function counted(counts: Map<string, number>, key?: string): void {
  if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
}

function sorted(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...counts].sort(([a], [b]) => compared(a, b)));
}

export type { Exported, ImportProgress } from "@cascade-runtime/runtime";

/**
 * `timeBudgetSeconds` (a positive number) and `memoryBudgetMiB` (a positive whole number, up to the Bridge's own cap)
 * hold each document's conversion to the seconds and the heap they name; a conversion that passes either rejects the import with a `BridgeError` of kind `bridge`
 * and the import files nothing. Left out, a conversion may take 120 seconds or 4 seconds a megabyte of its document, the
 * more of the two, and the Bridge's own heap, 1024 MiB.
 */
export interface ImportOptions extends ConvertBudget {
  /**
   * The profiles the person confirmed are theirs: the import files an About for the owner for each one that a version
   * it wrote names, when no counting About or counting NotAbout answers it. An export the pod already holds wrote no
   * version, so a re-import claims nothing, whatever the list: claim a profile found through
   * `profile/What needs review` with `ownerAbout`. An import claims no profile by itself, and `true` is refused.
   */
  readonly claimProfiles?: readonly string[];
  /** Runs the matcher on the import; on unless false. */
  readonly match?: boolean;
  /** Told as each part of the import begins, with what is done so far; the import goes on once what it returns settles. */
  readonly onProgress?: (progress: ImportProgress) => void | Promise<void>;
}

function shown(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Throws for an option `pod.import` does not take; the browser's pod checks before it loads the engine. */
export function acceptImportOptions(options: ImportOptions): void {
  acceptOptions("pod.import", options, {
    claimProfiles: true,
    match: true,
    onProgress: true,
    timeBudgetSeconds: true,
    memoryBudgetMiB: true,
  });
  if (options === undefined) return;
  const { claimProfiles, timeBudgetSeconds, memoryBudgetMiB } = options;
  if (
    claimProfiles !== undefined &&
    !(
      Array.isArray(claimProfiles) &&
      claimProfiles.every(
        (profile) => typeof profile === "string" && profile !== "",
      )
    )
  )
    throw new TypeError(
      `pod.import options.claimProfiles takes the list of the profile IRIs the person confirmed, not ${shown(claimProfiles)}: an import claims no profile by itself. To claim one profile at a time, file its About with pod.judge, then call pod.match(activity).`,
    );
  if (
    timeBudgetSeconds !== undefined &&
    !(Number.isFinite(timeBudgetSeconds) && timeBudgetSeconds > 0)
  )
    throw new TypeError(
      `pod.import options.timeBudgetSeconds is not a finite number of seconds above zero: ${String(timeBudgetSeconds)}`,
    );
  if (
    memoryBudgetMiB !== undefined &&
    !(Number.isInteger(memoryBudgetMiB) && memoryBudgetMiB > 0)
  )
    throw new TypeError(
      `pod.import options.memoryBudgetMiB is not a positive whole number of MiB: ${String(memoryBudgetMiB)}`,
    );
}

/** Throws for an option `pod.ask` does not take; the browser's pod checks before it reads its kept answers. */
export function acceptAskOptions(options: { lens?: string }): void {
  acceptOptions("pod.ask", options, { lens: true });
}

export interface Pod {
  /** The pod's naming base, ending in a slash. */
  readonly address: string;
  /** The one cascade:Subject. */
  readonly subject: string;
  /** The owner's profile's #me. */
  readonly owner: string;
  /**
   * The open that gives the pod the app's newer tables (O1, O2), which runs after `openPod` returns, as the pod's first
   * step: it settles once the step and the rebuild after it have run, to undefined when the tables had not changed, and
   * rejects as a step that fails rejects its call. Until it settles, a question by name is answered with the rows kept
   * for the pod as it was opened, where they were kept, and any other call waits for the step.
   */
  readonly opened: Promise<Opened | undefined>;
  /** Whether its files and its kept answers are sealed under a key only its secret opens. */
  readonly encrypted: boolean;
  /**
   * Whether a title was given when the pod was made, or since by `retitle`. A pod made with none is named for its
   * folder or database, which is no title: an app that wants the pod titled, as for the person whose record it claims,
   * calls `retitle` when this is false. A pod made before this was recorded is titled.
   */
  readonly titled: boolean;
  /**
   * The app's last snapshot in the pod (N14), which the app's tables store keeps beside the pod's name and hands back
   * as the writer's head at the next open; none until the app performs an act in it, so a first act is a new writer's.
   */
  readonly head: Head | undefined;
  /** The export or download at the path, or the files the app holds of one. */
  look(exported: string | Exported): Promise<readonly ExportSource[]>;
  import(
    exported: string | Exported,
    options?: ImportOptions,
  ): Promise<Imported>;
  /**
   * A connect to a server, saved as `connectFiles` saves it: its act and a version of the server's record (A16), and the
   * matcher run taking the server (M20), on unless false.
   */
  connect(saved: Exported, options?: { match?: boolean }): Promise<Done>;
  enter(turtle: string, options?: { match?: boolean }): Promise<Done>;
  /**
   * What `enter` would say to the entry, writing nothing: `refused` with why when the vocabulary refuses it or it states
   * a property the vocabulary does not declare, else its `statements` and the `labels` the vocabulary gives its terms.
   */
  checkEntry(turtle: string): Promise<{
    refused?: string;
    statements?: readonly Triple[];
    labels?: ReadonlyMap<string, string>;
  }>;
  judge(turtle: string): Promise<Done>;
  /** Why `judge` would fail on the Turtle before the pod's rules are asked, or nothing, writing nothing. */
  checkJudgment(turtle: string): Promise<string | undefined>;
  match(activity?: string): Promise<Done>;
  ask(question: string, options?: { lens?: string }): Promise<Row[]>;
  /** A query of your own gives text in every column: the vocabulary declares no list column for it. */
  ask(
    question: { query: string },
    options?: { lens?: string },
  ): Promise<TextRow[]>;
  ask(
    question: string | { query: string },
    options?: { lens?: string },
  ): Promise<Row[]>;
  /**
   * How each report of a variant stands to the row of the variant classifications table the app holds that the variant
   * finds (`tables/agreement.rq`): the report's entry (`report`), the row (`row`), the version (`origin`) and the
   * `verdict`. It is answered over the app's current version of the table, kept as an answer is, and writes nothing.
   */
  agreement(): Promise<TextRow[]>;
  /**
   * The classes the app's tables give each active medication of the pod
   * (`tables/medication-classes-through-precise-ingredients.rq`): the entry
   * (`entry`), its `medication`, the `class`, the `relation` the class row gives it, the version of the drug classes
   * table that holds the row (`origin`) and the code the row is on (`through`). It is answered over the current
   * versions of the tables, reads the pod and writes nothing. A combination product is in no class: MED-RT classes none.
   */
  medicationClasses(): Promise<TextRow[]>;
  /**
   * The lab results of the pod in the LOINC panel with the code `panel`, which the person picked (`tables/panel-results.rq`
   * asked of that panel): each member the panel lists, directly or through a panel nested in it, with its `sequence`,
   * its `required` as LOINC writes it, the panel `via` whose row lists it, the version of the panel members table that
   * holds the row (`origin`) and the `entry` of the pod's result for it. A required member the pod has no result for is a
   * row with no `entry`. A member reached directly and through a nested panel is a row for each `via`, and a member with
   * several results a row for each. It is answered over the current versions of the tables, reads the pod and writes
   * nothing.
   */
  panelResults(panel: string): Promise<TextRow[]>;
  /**
   * The reference table versions that joined each entry's records (`tables/joined-by.rq`): the `entry` and the version
   * (`used`) that a counting machine Same cited while joining one of its records. The rule list and the records'
   * versions are never among them, a Same that no longer counts names nothing, and an entry joined without a table has no
   * row. It reads the pod and writes nothing.
   */
  joinedBy(): Promise<TextRow[]>;
  /**
   * The current table versions the pod names that the app's tables do not hold, of each series a matcher Same used
   * another version of: such a Same counts where a device holds the version and its rows join the members, and not on
   * this one (M7). It reads the pod and writes nothing. Undefined while they are not known: a browser's pod drawn from
   * its kept answers knows them once the engine has opened it.
   */
  unheldTableVersions(): Promise<readonly string[] | undefined>;
  /**
   * Sets the pod's title, in its manifest and in `pod.json` (sealed in an encrypted pod), and so for the pod opened again;
   * `titled` is true from then on. It changes no revision, so every kept answer stays valid. Throws `Refusal` for an
   * empty or all-whitespace title.
   */
  retitle(title: string): Promise<void>;
  close(): Promise<void>;
}

/** A source of an export or a download: a hospital's FHIR server, or a document's custodian. */
export interface ExportSource {
  /** Where the export says the records came from: the hospital, or the document's custodian. */
  readonly name?: string;
  /** A FHIR source's server base URL, normalised as the Bridge does. */
  readonly server?: string;
  /** How many of each kind. */
  readonly records: Readonly<Record<string, number>>;
  /** How many entries each section holds, by its title, where the source has sections. */
  readonly sections?: Readonly<Record<string, number>>;
  /** Each time a record was received, in UTC, once each, in order; a document's own date where it gives no time. */
  readonly received: readonly string[];
  /**
   * The pod holds the subject's records from that server or, for a source with none, from a document whose author is
   * the source.
   */
  readonly holdsSubjectsRecords: boolean;
}

export interface Done {
  /** Paths of the files new to the pod, in the order written. */
  readonly wrote: readonly string[];
  /** Why the rules refused the step; it then wrote nothing. */
  readonly refused?: string;
  /** The import, entry session or connect it made. */
  readonly activity?: string;
  /** The judgment it filed, as the package named it. */
  readonly judgment?: string;
  /** The matcher run taking it, with matching on. */
  readonly matched?: Done;
}

export interface Opened extends Done {
  /** The versions the pod names that the app does not hold, which it is matched without (O2). */
  readonly unheld: readonly string[];
}

export interface Imported extends Done {
  /**
   * Each source change time (`pav:lastUpdateOn`) an arrival stated that its revision does not carry, being no
   * `xsd:dateTime` that states a time zone from -14:00 to +14:00 or whose instant in UTC is outside the years 0001 to 9999: the record, and the value as N-Triples writes it. Absent where there is none.
   */
  readonly changeTimesDropped?: readonly {
    readonly record: string;
    readonly changeTime: string;
  }[];
  readonly claimedProfiles: readonly {
    readonly profile: string;
    readonly judgment: string;
  }[];
  /**
   * The profiles of the versions this import wrote that no counting About or counting NotAbout answers. An export the pod
   * already holds wrote none, so a re-import lists nothing in any of the three lists: a profile left unclaimed is found
   * again through `profile/What needs review`.
   */
  readonly unclaimedProfiles: readonly string[];
  /** The profiles of the versions this import wrote that a counting NotAbout answers and no person's About stands against: an import claims none. */
  readonly disclaimedProfiles: readonly string[];
  /** The profiles of the versions this import wrote that a person's About stands against a counting NotAbout, which `profile/What needs review` lists. */
  readonly heldBackProfiles: readonly string[];
}

export { text, textRow, type Row, type TextRow } from "./row-text.js";

/** A folder by its path. */
export interface Folder {
  /** Its files, named by the IRI given, or else by their own. */
  readonly files: Files;
  readonly name: string;
}

export interface LoadedBridge {
  /** The adapters `cascade-runtime.json` names, loaded into it, by the media type each reads. */
  readonly adapters: AdaptersOf;
  close(): Promise<void>;
}

/** The adapters `load` puts into the Bridge, each freed before the Bridge closes; the Bridge closes if `load` fails. */
export async function bridgeLoaded(
  bridge: WasmBridge,
  load: (bridge: WasmBridge) => Promise<readonly Loaded[]>,
): Promise<LoadedBridge> {
  let loaded: readonly Loaded[];
  try {
    loaded = await load(bridge);
  } catch (error) {
    bridge.close();
    throw error;
  }
  return {
    adapters: ofMediaType(loaded),
    close: async () => {
      await Promise.allSettled(loaded.map(({ adapter }) => adapter.free()));
      bridge.close();
    },
  };
}

/** What a pod is opened with. */
export interface Parts {
  readonly vocabulary: Files;
  /** The runtime performing a pod's acts, as N7 names it. */
  readonly performer: string;
  readonly layout: Layout;
  readonly build: VocabularyBuild;
  /** The lens `cascade-runtime.json` names. */
  readonly lens: string;
  readonly importers: readonly Importer[];
  /** The matcher's tables: the versions the app keeps from its feeds, and the vocabulary's rule list. */
  readonly tables: Tables;
  readonly newStore: StoreFactory;
  /** What derives the key an encrypted pod's secret opens it with. */
  readonly derive: DeriveKey;
  folder(path: string, iri?: string): Folder;
  /** Where the answers of a pod in a folder are kept; none when nothing may be kept. */
  readonly answers?: AnswerStore;
  /** Where the build of a pod in a folder is kept beside it when its answers are not; none when it may not be. */
  readonly builtBeside?: (folder: string) => Files;
  /** What the code that runs is, by its bytes, where the performer does not name it exactly; a kept build names it. */
  readonly builtCode?: string;
  /** The export or download at the path, as the files it is in and its name there, or why no path is read. */
  exportAt(path: string): Export | string;
  loadBridge(): Promise<LoadedBridge>;
}

/** An export or a download as the importers are given it: the files it is in, and its name there. */
export interface Export {
  readonly files: Pick<Files, "read" | "list">;
  readonly name: string;
}

/** A server's base URL as a Bridge normalises it: scheme and host lower-cased, every trailing slash removed. */
function normalised(server: string): string {
  const parts = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i.exec(server);
  const lowered =
    parts === null
      ? server
      : `${(parts[1] ?? "").toLowerCase()}${(parts[2] ?? "").toLowerCase()}${parts[3] ?? ""}`;
  return lowered.replace(/\/+$/, "");
}

function compared(a: string | undefined, b: string | undefined): number {
  const [x, y] = [a ?? "", b ?? ""];
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Whether the query is a SELECT: its first word, after comments and its prologue. */
function isSelect(query: string): boolean {
  const code = query.replace(/(^|\s)#[^\n]*/g, "$1");
  const body = code.replace(
    /^\s*((BASE\s*<[^>]*>|PREFIX\s+[^\s:]*:\s*<[^>]*>)\s*)*/i,
    "",
  );
  return /^SELECT\b/i.test(body);
}

const read = new WeakMap<
  Files,
  Promise<{
    readonly questions: ReadonlyMap<string, VocabularyQuery>;
    readonly lenses: readonly string[];
    readonly layout: string;
  }>
>();

/** The vocabulary's questions, lenses and layout, read once. */
function askable(vocabulary: Files) {
  let found = read.get(vocabulary);
  if (found === undefined) {
    const reading = Promise.all([
      questions(vocabulary),
      lenses(vocabulary),
      readText(vocabulary, LAYOUT_FILE),
    ]);
    found = reading.then(([questions, lenses, layout]) => ({
      questions,
      lenses,
      layout,
    }));
    read.set(vocabulary, found);
    found.catch(() => read.delete(vocabulary));
  }
  return found;
}

type Askable = Awaited<ReturnType<typeof askable>>;

/** What the verdicts are kept under, among a pod's answers: not a question of the vocabulary's, a query beside them. */
export const AGREEMENT = "tables/agreement";
const AGREEMENT_QUERY = `${QUERIES}${AGREEMENT}.rq`;

/** The medicines in a class are asked of the tables the app holds, beside the verdicts: a query beside the questions. */
const CLASSES_QUERY = `${QUERIES}tables/medication-classes-through-precise-ingredients.rq`;
/** The statements of the medication entries, which the classes query reads of the pod. */
const MEDICATION_ENTRIES = `PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
CONSTRUCT { ?entry ?property ?value } WHERE { ?entry a cascade:PrescribedOrReportedMedication ; ?property ?value }`;
const SELECTED_CODE = `${CASCADE}userSelectedCode`;
const RXNORM_CODE = "https://ns.cascadeprotocol.org/cascade#rxNormCode";

/** A person's results in a panel are asked of the tables the app holds the same way. */
const PANEL_RESULTS_QUERY = `${QUERIES}tables/panel-results.rq`;
/** The lab result entries `tables/panel-results.rq` reads of the pod: their test codes. */
const LAB_ENTRIES = `PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
CONSTRUCT { ?entry cascade:testCode ?code ; cascade:leadMember ?lead }
WHERE { ?entry cascade:testCode ?code ; cascade:leadMember ?lead }`;

/** Which tables joined an entry is asked of the pod alone: its judgments name the versions, and it holds their descriptions. */
const JOINED_BY_QUERY = `${QUERIES}tables/joined-by.rq`;

const agreements = new WeakMap<Files, Promise<string>>();
const tableQueries = new WeakMap<Files, Map<string, Promise<string>>>();

/** The text of a query of the vocabulary's `tables/` folder, read once. */
function tableQueryText(vocabulary: Files, path: string): Promise<string> {
  const read = tableQueries.get(vocabulary) ?? new Map();
  tableQueries.set(vocabulary, read);
  let found = read.get(path);
  if (found === undefined) {
    found = readText(vocabulary, path);
    read.set(path, found);
    found.catch(() => read.delete(path));
  }
  return found;
}

/** The text of the vocabulary's agreement query, read once. */
function agreementText(vocabulary: Files): Promise<string> {
  let found = agreements.get(vocabulary);
  if (found === undefined) {
    found = readText(vocabulary, AGREEMENT_QUERY);
    agreements.set(vocabulary, found);
    found.catch(() => agreements.delete(vocabulary));
  }
  return found;
}

function offeredLens(offered: Askable, lens: string): void {
  if (!offered.lenses.includes(lens))
    throw new Refusal(
      `no lens ${lens}; there are ${offered.lenses.join(", ")}`,
    );
}

/** The text of the question the vocabulary offers by the name; none offered throws. */
function questionText(offered: Askable, question: string): string {
  const found = offered.questions.get(question);
  if (found === undefined)
    throw new Refusal(
      `no question ${question}; there are ${[...offered.questions.keys()].join(", ")}`,
    );
  return found.text;
}

/** The list columns the vocabulary declares for the question; none offered throws, as `questionText` does. */
function questionLists(
  offered: Askable,
  question: string,
): readonly ListColumn[] {
  questionText(offered, question);
  return offered.questions.get(question)!.lists;
}

/** The key the answer to the question, of the text given, under the lens is kept under at the revision. */
function keyOf(
  build: VocabularyBuild,
  layout: string,
  asked: {
    readonly runtime: string;
    readonly question: string;
    readonly text: string;
    /** The question's list columns, which change its rows as the text does. */
    readonly lists?: readonly ListColumn[];
    readonly lens: string;
    readonly revision: string;
    readonly tables: readonly string[];
  },
): Promise<string> {
  const { runtime, question, text, lists, lens, revision, tables } = asked;
  return answerKey({
    runtime,
    question,
    lens,
    revision,
    tables,
    texts: [
      text,
      ...(lists === undefined || lists.length === 0
        ? []
        : [JSON.stringify(lists)]),
      ...build.derivations.for(lens).map(({ query }) => query),
      layout,
      ...build.queries,
    ],
  });
}

/** What a pod's kept answers are read with: no store, so no engine. */
export type Reading = Pick<
  Parts,
  "vocabulary" | "layout" | "build" | "lens" | "tables"
>;

/** A pod as its kept answers read it, without the engine. */
export interface KeptPod extends Described {
  readonly owner: string;
  /**
   * The rows kept for the question, by its name, under the lens for the pod as it stands; none when none were. A
   * question or lens the vocabulary does not offer throws, as the pod opened with the engine would.
   */
  rows(question: string, lens?: string): Promise<Row[] | undefined>;
  /** The rows kept for `agreement()` under the lens for the pod as it stands; none when none were. */
  agreement(): Promise<TextRow[] | undefined>;
}

/** The pod in `pod`, as its answers kept in `answers` read it: what `pod.json` says it is; none when it says nothing. */
export async function keptPod(
  reading: Reading,
  pod: Files,
  answers: Answers,
): Promise<KeptPod | undefined> {
  const described = await answers.described();
  if (described === undefined) return undefined;
  const { vocabulary, layout, build } = reading;
  let revision: Promise<string> | undefined;
  let tables: Promise<readonly string[]> | undefined;
  return {
    ...described,
    owner: `${described.address}${layout.card}#me`,
    rows: async (question, lens = reading.lens) => {
      const offered = await askable(vocabulary);
      offeredLens(offered, lens);
      const text = questionText(offered, question);
      revision ??= podRevision(pod, layout, described.address);
      tables ??= reading.tables.current();
      return answers.rows(
        lens,
        question,
        await keyOf(build, offered.layout, {
          runtime: answers.runtime,
          question,
          text,
          lists: questionLists(offered, question),
          lens,
          revision: await revision,
          tables: await tables,
        }),
      );
    },
    agreement: async () => {
      const offered = await askable(vocabulary);
      revision ??= podRevision(pod, layout, described.address);
      tables ??= reading.tables.current();
      return answers.rows(
        reading.lens,
        AGREEMENT,
        await keyOf(build, offered.layout, {
          runtime: answers.runtime,
          question: AGREEMENT,
          text: await agreementText(vocabulary),
          lens: reading.lens,
          revision: await revision,
          tables: await tables,
        }),
      );
    },
  };
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The Turtle of the owner's About, the claim that `profile` is the pod's subject's by the owner's statement, for
 * `pod.judge`: what `claimProfiles` files for each profile it names, and what an app files for a profile the person says
 * is theirs, one at a time.
 */
export function ownerAbout(
  { subject, owner }: { readonly subject: string; readonly owner: string },
  profile: string,
): string {
  return `@prefix cascade: <${CASCADE}> .
@prefix prov: <${PROV}> .
<${THIS_JUDGMENT}> a cascade:Judgment ;
    cascade:verdict cascade:About ; cascade:subject <${subject}> ; cascade:basis cascade:OwnerStatement ;
    prov:hadMember <${profile}> ; prov:wasAttributedTo <${owner}> ;
    prov:wasGeneratedBy [ prov:qualifiedAssociation [ prov:agent <${owner}> ; prov:hadRole cascade:PatientRole ] ] .
<${owner}> a prov:Person .
`;
}

/** A new pod's naming base: `pod://` and a fresh version-4 UUID. */
function newBase(): string {
  return `pod://${randomId().slice(UUID.length)}/`;
}

class OpenPod implements Pod {
  readonly #parts: Parts;
  readonly #core: CorePod;
  readonly #answers: Answers | undefined;
  /** The current versions of the tables the pod was opened with, which its kept answers are keyed by. */
  readonly #tables: readonly string[];
  #queue: Promise<unknown> = Promise.resolve();
  #bridge: Promise<LoadedBridge> | undefined;
  #closed = false;
  #titled: boolean;
  /** While the open's step has not settled, the revision and the versions the answers kept before it are keyed by. */
  #before:
    | { readonly revision: Promise<string>; readonly tables: readonly string[] }
    | undefined;
  readonly opened: Promise<Opened | undefined>;

  constructor(
    parts: Parts,
    core: CorePod,
    readonly address: string,
    readonly subject: string,
    tables: readonly string[],
    answers: Answers | undefined,
    readonly encrypted: boolean,
    titled: boolean,
    adopting?: Adopting,
  ) {
    this.#titled = titled;
    this.#parts = parts;
    this.#core = core;
    this.#answers = answers;
    this.#tables = tables;
    if (adopting === undefined) {
      this.opened = Promise.resolve(undefined);
      return;
    }
    if (adopting.before !== undefined && answers !== undefined) {
      const revision = this.#next(() => core.revision());
      revision.catch(() => undefined);
      this.#before = { revision, tables: adopting.before };
    }
    this.opened = this.#next(async () => {
      try {
        const opened = await adopting.open();
        await core.revision();
        return opened;
      } finally {
        this.#before = undefined;
      }
    });
    this.opened.catch(() => undefined);
  }

  get owner(): string {
    return `${this.address}${this.#parts.layout.card}#me`;
  }

  get head(): Head | undefined {
    return this.#core.head;
  }

  get titled(): boolean {
    return this.#titled;
  }

  retitle(title: string): Promise<void> {
    return this.#next(async () => {
      if (title.trim() === "")
        throw new Refusal("a pod's title is not empty or all white space");
      await this.#core.retitle(title);
      await this.#answers?.describe({
        address: this.address,
        subject: this.subject,
        title,
        titled: true,
      });
      this.#titled = true;
    });
  }

  look(exported: string | Exported): Promise<readonly ExportSource[]> {
    return this.#next(() => this.#look(exported));
  }

  async import(
    exported: string | Exported,
    options: ImportOptions = {},
  ): Promise<Imported> {
    acceptImportOptions(options);
    return this.#next(() => this.#import(exported, options));
  }

  async connect(
    saved: Exported,
    options: { match?: boolean } = {},
  ): Promise<Done> {
    acceptOptions("pod.connect", options, { match: true });
    return this.#next(async () => {
      let names: string[];
      try {
        names = exportedNames(saved);
      } catch (error) {
        return this.#core.refuse(failure(error));
      }
      const [name] = names;
      if (names.length !== 1 || name === undefined)
        return this.#core.refuse(
          `a connect is saved as one folder, not ${names.length === 0 ? "no file" : names.join(" and ")}`,
        );
      const connected = await this.#core.connect(
        new ExportedFiles(saved, name),
        name,
      );
      if (
        options.match === false ||
        connected.refused !== undefined ||
        connected.activity === undefined
      )
        return connected;
      return {
        ...connected,
        matched: await this.#core.match(connected.activity),
      };
    });
  }

  async enter(
    turtle: string,
    options: { match?: boolean } = {},
  ): Promise<Done> {
    acceptOptions("pod.enter", options, { match: true });
    return this.#next(async () => {
      const entered = await this.#core.enter({
        bytes: new TextEncoder().encode(turtle),
        base: this.address,
        name: "the entry",
      });
      if (
        options.match === false ||
        entered.refused !== undefined ||
        entered.activity === undefined
      )
        return entered;
      return {
        ...entered,
        matched: await this.#core.match(entered.activity),
      };
    });
  }

  checkEntry(turtle: string) {
    return this.#next(async () => {
      const checked = await this.#core.checkEntry({
        bytes: new TextEncoder().encode(turtle),
        base: this.address,
        name: "the entry",
      });
      return checked;
    });
  }

  judge(turtle: string): Promise<Done> {
    return this.#next(() => this.#judge(turtle));
  }

  checkJudgment(turtle: string): Promise<string | undefined> {
    return this.#next(() =>
      checkJudgment(
        {
          core: this.#core,
          newStore: this.#parts.newStore,
          address: this.address,
          views: this.#viewsAddress(),
          time: clock,
        },
        turtle,
      ),
    );
  }

  match(activity?: string): Promise<Done> {
    return this.#next(() => this.#core.match(activity));
  }

  ask(question: string, options?: { lens?: string }): Promise<Row[]>;
  ask(
    question: { query: string },
    options?: { lens?: string },
  ): Promise<TextRow[]>;
  async ask(
    question: string | { query: string },
    options: { lens?: string } = {},
  ): Promise<Row[]> {
    acceptAskOptions(options);
    if (typeof question === "string" && !this.#closed) {
      const kept = await this.#keptBefore(question, options);
      if (kept !== undefined) return kept;
    }
    return this.#next(() => this.#ask(question, options));
  }

  /** While the open's step runs, the rows kept for the question before it, if they were. */
  async #keptBefore(
    question: string,
    options: { lens?: string },
  ): Promise<Row[] | undefined> {
    const before = this.#before;
    const answers = this.#answers;
    if (before === undefined || answers === undefined) return undefined;
    const revision = await before.revision.catch(() => undefined);
    if (revision === undefined) return undefined;
    const lens = options.lens ?? this.#parts.lens;
    const offered = await askable(this.#parts.vocabulary);
    offeredLens(offered, lens);
    const key = await keyOf(this.#parts.build, offered.layout, {
      runtime: answers.runtime,
      question,
      text: questionText(offered, question),
      lists: questionLists(offered, question),
      lens,
      revision,
      tables: before.tables,
    });
    return answers.rows(lens, question, key);
  }

  agreement(): Promise<TextRow[]> {
    return this.#next(() => this.#agreement());
  }

  medicationClasses(): Promise<TextRow[]> {
    return this.#next(() => this.#medicationClasses());
  }

  panelResults(panel: string): Promise<TextRow[]> {
    return this.#next(() => this.#panelResults(panel));
  }

  joinedBy(): Promise<TextRow[]> {
    return this.#next(() => this.#joinedBy());
  }

  unheldTableVersions(): Promise<readonly string[]> {
    return this.#next(() => this.#core.unheldTableVersions());
  }

  close(): Promise<void> {
    return this.#next(async () => {
      this.#closed = true;
      await this.#core.keepBuild().catch(() => undefined);
      this.#core.close();
      const bridge = this.#bridge;
      this.#bridge = undefined;
      if (bridge !== undefined) await (await bridge).close();
    });
  }

  /** The call, once every call made before it has finished. */
  #next<T>(call: () => Promise<T>): Promise<T> {
    const run = (): Promise<T> =>
      this.#closed
        ? Promise.reject(new Error(`the pod at ${this.address} is closed`))
        : call();
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  /** The importers' names, as a refusal lists them. */
  #importerNames(): string {
    return (
      this.#parts.importers.map((importer) => importer.name).join(", ") ||
      "none"
    );
  }

  /** The export at the path or in the files the app holds, or why there is none to read. */
  #exportOf(exported: string | Exported): Export | string {
    if (typeof exported === "string") return this.#parts.exportAt(exported);
    let names: string[];
    try {
      names = exportedNames(exported);
    } catch (error) {
      return failure(error);
    }
    const [name] = names;
    if (names.length !== 1 || name === undefined)
      return `no importer of ${this.#importerNames()} reads ${names.length === 0 ? "no file" : names.join(" and ")}`;
    return { files: new ExportedFiles(exported, name), name };
  }

  async #look(exported: string | Exported): Promise<ExportSource[]> {
    const found = this.#exportOf(exported);
    if (typeof found === "string") throw new Error(found);
    const { files, name } = found;
    const shown = typeof exported === "string" ? exported : name;
    let entries: readonly IndexEntry[] | undefined;
    for (const importer of this.#parts.importers) {
      try {
        entries = await importer.index(files, name);
      } catch (error) {
        throw new Error(
          `${importer.name} cannot read ${shown}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      if (entries !== undefined) break;
    }
    if (entries === undefined)
      throw new Error(`no importer of ${this.#importerNames()} reads ${shown}`);
    const { rows } = await this.#core.select(`${PREFIXES}
      SELECT DISTINCT ?server ?author WHERE {
        ?record cascade:subject <${this.subject}> .
        ?revision cascade:revisionOf ?record ; prov:wasDerivedFrom ?document .
        OPTIONAL { ?document cascade:serverBaseUrl ?server }
        OPTIONAL {
          FILTER NOT EXISTS { ?document cascade:serverBaseUrl ?anyServer }
          ?document prov:wasAttributedTo/(<http://www.w3.org/2000/01/rdf-schema#label>|^prov:specializationOf/<http://xmlns.com/foaf/0.1/name>) ?author .
        }
      }`);
    const serversHoldingSubjectsRecords = new Set(
      rows.flatMap((row) => {
        const server = row.get("server")?.value;
        return server === undefined ? [] : [normalised(server)];
      }),
    );
    const authorsHoldingSubjectsRecords = new Set(
      rows.flatMap((row) => {
        const author = row.get("author")?.value;
        return author === undefined ? [] : [spaced(author)];
      }),
    );
    const sources = new Map<
      string,
      {
        name?: string;
        server?: string;
        records: Map<string, number>;
        sections: Map<string, number>;
        received: Set<string>;
      }
    >();
    for (const entry of entries) {
      const server =
        entry.server === undefined ? undefined : normalised(entry.server);
      const key = JSON.stringify([entry.source ?? null, server ?? null]);
      let source = sources.get(key);
      if (source === undefined) {
        source = {
          ...(entry.source === undefined ? {} : { name: entry.source }),
          ...(server === undefined ? {} : { server }),
          records: new Map(),
          sections: new Map(),
          received: new Set(),
        };
        sources.set(key, source);
      }
      counted(source.records, entry.kind);
      counted(source.sections, entry.section);
      if (entry.received !== undefined) source.received.add(entry.received);
    }
    return [...sources.values()]
      .sort((a, b) => compared(a.name, b.name) || compared(a.server, b.server))
      .map(({ records, sections, received, ...source }) => ({
        ...source,
        records: sorted(records),
        ...(sections.size === 0 ? {} : { sections: sorted(sections) }),
        received: [...received].sort(),
        holdsSubjectsRecords:
          source.server === undefined
            ? source.name !== undefined &&
              authorsHoldingSubjectsRecords.has(spaced(source.name))
            : serversHoldingSubjectsRecords.has(source.server),
      }));
  }

  async #import(
    exported: string | Exported,
    options: ImportOptions,
  ): Promise<Imported> {
    const found = this.#exportOf(exported);
    if (typeof found === "string")
      return {
        ...(await this.#core.refuse(found)),
        claimedProfiles: [],
        unclaimedProfiles: [],
        disclaimedProfiles: [],
        heldBackProfiles: [],
      };
    const { onProgress, timeBudgetSeconds, memoryBudgetMiB } = options;
    const confirmed = new Set(options.claimProfiles);
    // What the import writes holds no judgment, so which profiles are answered now is which are answered once it is
    // written. It is read from the pod's kept build, built if the pod was just opened, which the import then continues from.
    const answered =
      confirmed.size > 0
        ? await timed("pod.profilesTied", () => this.#profilesAnswered(true))
        : new Map<string, "About" | "NotAbout">();
    // The import, the judgments that claim its profiles and the pod's build after them (one rebuild of all three) come
    // before the matcher's run, which reads what the build derives of them.
    const done = await this.#core.deferring(async () => {
      const { profilesNamed, ...filed } = await this.#core.import(
        found.files,
        found.name,
        async () => (await this.#loadedBridge()).adapters,
        onProgress,
        {
          ...(timeBudgetSeconds !== undefined && { timeBudgetSeconds }),
          ...(memoryBudgetMiB !== undefined && { memoryBudgetMiB }),
        },
      );
      const activity = filed.activity;
      const claimedProfiles: { profile: string; judgment: string }[] = [];
      if (filed.refused !== undefined || activity === undefined)
        return {
          filed,
          activity: undefined,
          matched: undefined,
          claimedProfiles,
        };
      const matching = options.match !== false;
      const profiles = [...new Set(profilesNamed ?? [])].filter(
        (profile) =>
          confirmed.has(profile) &&
          profile !== this.subject &&
          !answered.has(profile),
      );
      const of = profiles.length + (matching ? 1 : 0);
      if (of > 0) await onProgress?.({ part: "judging", done: 0, of });
      for (const [index, profile] of profiles.entries()) {
        const { judgment } = await timedAside("pod.judge", () =>
          this.#judge(ownerAbout(this, profile)),
        );
        if (judgment !== undefined) claimedProfiles.push({ profile, judgment });
        await onProgress?.({ part: "judging", done: index + 1, of });
      }
      const matched = matching
        ? await timedAside("pod.match", () => this.#core.match(activity))
        : undefined;
      return { filed, activity, matched, claimedProfiles };
    });
    const { filed, activity, matched, claimedProfiles } = done;
    if (activity === undefined)
      return {
        ...filed,
        claimedProfiles: [],
        unclaimedProfiles: [],
        disclaimedProfiles: [],
        heldBackProfiles: [],
      };
    return {
      ...filed,
      ...(matched === undefined ? {} : { matched }),
      claimedProfiles,
      ...(await this.#profilesOf(activity)),
    };
  }

  #loadedBridge(): Promise<LoadedBridge> {
    if (this.#bridge === undefined) {
      const loading = this.#parts.loadBridge();
      this.#bridge = loading;
      loading.catch(() => {
        if (this.#bridge === loading) this.#bridge = undefined;
      });
    }
    return this.#bridge;
  }

  /**
   * The patient profiles the import's revisions' versions name, in three lists by what answers them: those no counting
   * About or NotAbout answers; those a counting NotAbout answers; those held back, a person's About standing against a
   * counting NotAbout. Which About stands against which NotAbout is the vocabulary's, read as the reason it leaves a
   * record out, and the runtime decides none of it.
   */
  #profilesOf(
    activity: string,
  ): Promise<
    Pick<
      Imported,
      "unclaimedProfiles" | "disclaimedProfiles" | "heldBackProfiles"
    >
  > {
    return timed("pod.unclaimedProfiles", async () => {
      const [named, answered, heldBack] = await Promise.all([
        this.#core.select(`${PREFIXES}
        SELECT DISTINCT ?profile WHERE {
          ?revision prov:wasGeneratedBy <${activity}> ; cascade:version ?version .
          ?version cascade:patient ?profile .
          FILTER (isIRI(?profile) && ?profile != <${this.subject}>)
        }`),
        this.#profilesAnswered(),
        this.#core.select(`${PREFIXES}
        SELECT DISTINCT ?profile WHERE {
          ?left cascade:leftOutReason cascade:PatientProfileJudgedBothAboutAndNotAbout ;
                cascade:leftOutBecauseOf ?profile .
        }`),
      ]);
      const held = new Set(
        heldBack.rows.flatMap((row) => row.get("profile")?.value ?? []),
      );
      const profiles = named.rows
        .flatMap((row) => row.get("profile")?.value ?? [])
        .sort(compared);
      return {
        unclaimedProfiles: profiles.filter((profile) => !answered.has(profile)),
        disclaimedProfiles: profiles.filter(
          (profile) =>
            answered.get(profile) === "NotAbout" && !held.has(profile),
        ),
        heldBackProfiles: profiles.filter((profile) => held.has(profile)),
      };
    });
  }

  /**
   * The profiles a counting About ties to the subject or a counting NotAbout names, by which; one a person both ties and
   * denies is a NotAbout's here. `kept`, read from the pod's kept build, built whole when none is.
   */
  async #profilesAnswered(
    kept = false,
  ): Promise<Map<string, "About" | "NotAbout">> {
    const query = `${PREFIXES}
        SELECT DISTINCT ?profile ?verdict WHERE {
          ?judgment cascade:countsUnderLens true ; prov:hadMember ?profile .
          { ?judgment cascade:verdict cascade:About ; cascade:subject <${this.subject}> . BIND ("About" AS ?verdict) }
          UNION
          { ?judgment cascade:verdict cascade:NotAbout . BIND ("NotAbout" AS ?verdict) }
        }`;
    const answered = await (kept
      ? this.#core.selectKept(query)
      : this.#core.select(query));
    const by = new Map<string, "About" | "NotAbout">();
    for (const row of answered.rows) {
      const profile = row.get("profile")?.value;
      if (profile === undefined) continue;
      if (row.get("verdict")?.value === "NotAbout") by.set(profile, "NotAbout");
      else if (!by.has(profile)) by.set(profile, "About");
    }
    return by;
  }

  #viewsAddress(): string {
    return `${this.address}${this.#parts.layout.viewsFolder}`;
  }

  #judge(turtle: string): Promise<Done> {
    return judged(
      {
        core: this.#core,
        newStore: this.#parts.newStore,
        address: this.address,
        views: this.#viewsAddress(),
        time: clock,
      },
      turtle,
    );
  }

  async #agreement(): Promise<TextRow[]> {
    const { vocabulary, build, lens } = this.#parts;
    const [offered, text] = await Promise.all([
      askable(vocabulary),
      agreementText(vocabulary),
    ]);
    const answers = this.#answers;
    let key: string | undefined;
    if (answers !== undefined) {
      key = await keyOf(build, offered.layout, {
        runtime: answers.runtime,
        question: AGREEMENT,
        text,
        lens,
        revision: await this.#core.revision(),
        tables: this.#tables,
      });
      const kept = await answers.rows(lens, AGREEMENT, key);
      if (kept !== undefined) return kept as TextRow[];
    }
    const { rows } = await this.#core.selectWithRows(
      text,
      `${CASCADE}VariantClassifications`,
    );
    const verdicts = rows.map((row) =>
      Object.fromEntries([...row].map(([name, term]) => [name, term.value])),
    );
    if (answers !== undefined && key !== undefined)
      await answers.keep(lens, AGREEMENT, key, verdicts);
    return verdicts;
  }

  /**
   * The query over a dataset of its own, as the core's `selectWithRows` builds one but for the rows it reads: the
   * pod's medication entries, and the rows of the product ingredients and drug classes versions that can join the
   * codes they state, found by those codes, their ingredients and their own precise ingredients (`Tables.reached`). The
   * core finds a row by a code the pod states, which a class seldom is: FDA gives it on an ingredient or a precise
   * ingredient the pod does not state.
   */
  async #medicationClasses(): Promise<TextRow[]> {
    const { vocabulary, lens, newStore, tables } = this.#parts;
    const [text, held, { codeSystems }] = await Promise.all([
      tableQueryText(vocabulary, CLASSES_QUERY),
      this.#core.dataset(lens),
      tableTerms(vocabulary, newStore),
    ]);
    const entries = await held.construct(MEDICATION_ENTRIES);
    const space = codeSystems.find(({ label }) => label === "RxNorm")?.uriSpace;
    if (space === undefined)
      throw new Error("the vocabulary registers no code system RxNorm");
    const codes = new Set<string>();
    for (const [, property, value] of entries)
      if (property.value === SELECTED_CODE || property.value === RXNORM_CODE)
        if (value.termType === "Literal")
          codes.add(codeIri(space, value.value));
        else if (value.value.startsWith(space)) codes.add(value.value);
    if (codes.size === 0) return [];
    const union = new Union(newStore());
    await union.add(entries, "urn:cascade:entries");
    for (const { version, rows, description } of await tables.reached([
      ...codes,
    ])) {
      await union.add(rows, version);
      await union.add(description, "urn:cascade:references");
    }
    const { rows } = await union
      .select(text)
      .finally(() => union.store.free?.());
    return rows.map((row) =>
      Object.fromEntries([...row].map(([name, term]) => [name, term.value])),
    );
  }

  /**
   * The query over a dataset of its own: the pod's lab result entries, and the panel's rows and those of the panels
   * nested in it in the panel members versions, which are all the query needs to answer for that panel. It answers for
   * every panel it finds on the way down; the rows kept are the panel's.
   */
  async #panelResults(panel: string): Promise<TextRow[]> {
    const { vocabulary, lens, newStore, tables } = this.#parts;
    const [text, held] = await Promise.all([
      tableQueryText(vocabulary, PANEL_RESULTS_QUERY),
      this.#core.dataset(lens),
    ]);
    const entries = await held.construct(LAB_ENTRIES);
    if (entries.length === 0) return [];
    const union = new Union(newStore());
    await union.add(entries, "urn:cascade:entries");
    for (const { version, rows, description } of await tables.panelRows(
      panel,
    )) {
      await union.add(rows, version);
      await union.add(description, "urn:cascade:references");
    }
    const { rows } = await union
      .select(text)
      .finally(() => union.store.free?.());
    return rows
      .map((row) =>
        Object.fromEntries([...row].map(([name, term]) => [name, term.value])),
      )
      .filter((row) => row.panel === panel);
  }

  async #joinedBy(): Promise<TextRow[]> {
    const { vocabulary, lens } = this.#parts;
    const [text, held] = await Promise.all([
      tableQueryText(vocabulary, JOINED_BY_QUERY),
      this.#core.dataset(lens),
    ]);
    return (await held.select(text)).rows.map((row) =>
      Object.fromEntries([...row].map(([name, term]) => [name, term.value])),
    );
  }

  async #ask(
    question: string | { query: string },
    options: { lens?: string },
  ): Promise<Row[]> {
    const lens = options.lens ?? this.#parts.lens;
    const { vocabulary, build } = this.#parts;
    const offered = await askable(vocabulary);
    offeredLens(offered, lens);
    let query: string;
    let lists: readonly ListColumn[] = [];
    let keep: ((rows: Row[]) => Promise<void>) | undefined;
    if (typeof question === "string") {
      query = questionText(offered, question);
      lists = questionLists(offered, question);
      const answers = this.#answers;
      if (answers !== undefined) {
        const key = await keyOf(build, offered.layout, {
          runtime: answers.runtime,
          question,
          text: query,
          lists,
          lens,
          revision: await this.#core.revision(),
          tables: this.#tables,
        });
        const kept = await answers.rows(lens, question, key);
        if (kept !== undefined) return kept;
        keep = (rows) => answers.keep(lens, question, key, rows);
      }
    } else {
      if (!isSelect(question.query)) throw new Error("the query is no SELECT");
      query = question.query;
    }
    const store = await this.#core.dataset(lens);
    const rows = (await store.select(query)).rows.map((row) =>
      withLists(
        Object.fromEntries([...row].map(([name, term]) => [name, term.value])),
        lists,
      ),
    );
    await keep?.(rows);
    return rows;
  }
}

/**
 * The core over the pod's files. `writer`, given for a pod kept in a folder, holds the head the app's tables store kept
 * for it, and each new head is kept there, and `beside` where its build is kept beside it with its answers; a pod in
 * memory keeps none.
 */
function coreOver(
  parts: Parts,
  references: References,
  pod: Files,
  address: string,
  subject: string,
  title: string | undefined,
  writer?: { readonly head: Head | undefined },
  beside?: Files,
): CorePod {
  const { build } = parts;
  return new CorePod({
    pod,
    address,
    subject,
    title,
    vocabulary: parts.vocabulary,
    layout: parts.layout,
    newStore: parts.newStore,
    time: clock,
    importers: parts.importers,
    runtime: parts.performer,
    ...(writer?.head === undefined ? {} : { head: writer.head }),
    ...(writer === undefined
      ? {}
      : { keepHead: (kept: Head) => parts.tables.keepHead(address, kept) }),
    references: () => Promise.resolve(references),
    ...(beside === undefined ? {} : { besidePod: beside }),
    ...(parts.builtCode === undefined ? {} : { builtCode: parts.builtCode }),
    build: {
      lens: parts.lens,
      derive: async (store, lens, pod, samesStillJoined) => {
        await build.derivations.derive(store, lens, samesStillJoined);
        return build.files(store, pod);
      },
      incremental: build,
    },
  });
}

/** The subjects the files where the layout files the subject state, read without loading the pod's other files. */
async function subjectsFiled(
  files: Files,
  layout: Layout,
  address: string,
  store: Store,
): Promise<string[]> {
  const { file, folder } = layout.place(`${CASCADE}Subject`);
  const paths = file === undefined ? await files.list(folder ?? "") : [file];
  const found = new Set<string>();
  for (const path of paths.filter((path) => layout.loads(path))) {
    const bytes = await files.read(path);
    if (bytes === undefined) continue;
    let triples: readonly Triple[];
    try {
      triples = await store.parse(bytes, address + path);
    } catch (error) {
      throw new Error(`${files.iri}${path} is no Turtle: ${String(error)}`, {
        cause: error,
      });
    }
    for (const [subject, predicate, object] of triples)
      if (predicate.value === TYPE && object.value === `${CASCADE}Subject`)
        found.add(subject.value);
  }
  return [...found];
}

/** The parts with every file of a pod's folder, read through its sealed index, and of its kept answers and build sealed under the key. */
function sealedParts(parts: Parts, index: SealedIndex): Parts {
  const { answers, builtBeside } = parts;
  const { key } = index;
  return {
    ...parts,
    folder: (path, iri) => {
      const folder = parts.folder(path, iri);
      return {
        ...folder,
        files: new EncryptedFiles(folder.files, key, { index }),
      };
    },
    ...(answers === undefined
      ? {}
      : {
          answers: {
            runtime: answers.runtime,
            at: (folder) =>
              new EncryptedFiles(answers.at(folder), key, { kind: "answers" }),
          },
        }),
    ...(builtBeside === undefined
      ? {}
      : {
          builtBeside: (folder) =>
            new EncryptedFiles(builtBeside(folder), key, { kind: "answers" }),
        }),
  };
}

/**
 * The pod in the folder, or in memory with none. A missing or empty folder, or memory, is a new pod, named from a base
 * of its own and created; a folder holding a pod opens as it is, and is given the app's tables unless `adopt` is false.
 * With `key`, the folder's pod is encrypted under it, and a folder holding only its header and its empty sealed index
 * (`madeNewPod`) is a new pod; its sealed index is the one given, or else opened here, the pod upgraded to 1.3 first
 * when it is an earlier version. Throws `Unopened`,
 * `changed outside the runtime`, when the index does not hold.
 */
export async function openPodWith(
  unsealed: Parts,
  folder?: string,
  options: {
    title?: string;
    adopt?: boolean;
    key?: PodKey;
    index?: SealedIndex;
  } = {},
): Promise<Pod> {
  const { key } = options;
  const encrypted = key !== undefined;
  const parts =
    key === undefined || folder === undefined
      ? unsealed
      : sealedParts(
          unsealed,
          options.index ??
            (await SealedIndex.open(unsealed.folder(folder).files, key, {
              laidOut: (path) => unsealed.layout.uses(path),
            })),
        );
  const disk = folder === undefined ? undefined : parts.folder(folder);
  const beside =
    folder === undefined
      ? undefined
      : (parts.answers?.at(folder) ?? parts.builtBeside?.(folder));
  const answers =
    beside === undefined || parts.answers === undefined
      ? undefined
      : new Answers(beside, parts.answers.runtime);
  const card =
    disk === undefined ? undefined : await disk.files.read(parts.layout.card);
  const references = await parts.tables.references();
  const tables = currentOf(references);
  if (disk === undefined || folder === undefined || card === undefined) {
    if (disk !== undefined && (await disk.files.list("")).length > 0)
      throw new Error(
        `${folder} holds files but no owner's profile, ${parts.layout.card}: it holds no pod`,
      );
    const address = newBase();
    const subject = randomId();
    const { title } = options;
    const files =
      folder === undefined
        ? new MemoryFiles(address)
        : parts.folder(folder, address).files;
    const core = coreOver(
      parts,
      references,
      files,
      address,
      subject,
      title,
      folder === undefined ? undefined : { head: undefined },
      beside,
    );
    const created = await core.create();
    if (created.refused !== undefined)
      throw new Error(`the pod's creation was refused: ${created.refused}`);
    await answers?.describe({
      address,
      subject,
      title: title ?? disk?.name ?? "pod",
      titled: title !== undefined,
    });
    if (folder !== undefined)
      await parts.tables.recordOpen(address, shipped(references), disk?.name);
    return new OpenPod(
      parts,
      core,
      address,
      subject,
      tables,
      answers,
      encrypted,
      title !== undefined,
    );
  }
  const store = parts.newStore();
  const [stated, described] = await Promise.all([
    podStated(disk.files, parts.layout, store),
    answers?.described(),
  ]);
  const { address } = stated;
  const subjects =
    described?.address === address
      ? [described.subject]
      : await subjectsFiled(disk.files, parts.layout, address, store);
  const [subject] = subjects;
  if (subject === undefined || subjects.length > 1)
    throw new Error(`${folder} holds ${subjects.length} subjects, not one`);
  const { title } = stated;
  await answers?.describe({
    address,
    subject,
    title: title ?? disk.name,
    titled: title !== undefined,
  });
  const files = parts.folder(folder, address).files;
  const core = coreOver(
    parts,
    references,
    files,
    address,
    subject,
    title,
    { head: await parts.tables.headOf(address) },
    beside,
  );
  return new OpenPod(
    parts,
    core,
    address,
    subject,
    tables,
    answers,
    encrypted,
    title !== undefined,
    options.adopt === false
      ? undefined
      : await tablesChanged(parts.tables, references, core, address, disk.name),
  );
}

/**
 * When the app's tables changed since the pod was last opened, or it never was, the open that gives it them (O1, O2),
 * to run as the pod's first step, and the versions of a kind it was last opened with, which its kept answers are keyed
 * by until that step has run.
 */
async function tablesChanged(
  tables: Tables,
  references: References,
  core: CorePod,
  address: string,
  name: string,
): Promise<Adopting | undefined> {
  const current = shipped(references);
  const before = await tables.openedWith(address);
  if (
    before !== undefined &&
    before.length === current.length &&
    before.every((version, index) => version === current[index])
  ) {
    await tables.recordName(address, name);
    return undefined;
  }
  return {
    before: before === undefined ? undefined : ofKinds(references, before),
    open: async () => {
      const performed = await core.open(references);
      if (performed.refused === undefined)
        await tables.recordOpen(address, current, name);
      return { ...performed, unheld: performed.unheld ?? [] };
    },
  };
}

/** The open an `OpenPod` runs as its first step, giving the pod the app's newer tables. */
interface Adopting {
  /** The versions of a kind the pod was last opened with; none for a pod no app's tables record. */
  readonly before: readonly string[] | undefined;
  readonly open: () => Promise<Opened>;
}
