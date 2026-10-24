import {
  clock,
  codeIri,
  CorePod,
  type DeriveKey,
  EncryptedFiles,
  type Files,
  type Head,
  type Importer,
  type ImportProgress,
  type IndexEntry,
  iri,
  type Layout,
  LAYOUT_FILE,
  lenses,
  literal,
  type Loaded,
  QUERIES,
  ofMediaType,
  type WasmBridge,
  type AdaptersOf,
  type Exported,
  exportedNames,
  ExportedFiles,
  MemoryFiles,
  ntriples,
  podFiles,
  podRevision,
  type PodKey,
  podStated,
  questions,
  randomId,
  RDF,
  readText,
  type References,
  Refusal,
  type StoreFactory,
  tableTerms,
  type Triple,
  Union,
  type VocabularyBuild,
  type VocabularyQuery,
  XSD,
} from "@cascade-runtime/runtime";
import {
  answerKey,
  Answers,
  type AnswerStore,
  type Described,
} from "./answers.js";
import { currentOf, shipped, type Tables } from "./tables.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const TYPE = `${RDF}type`;
const USED = `${PROV}used`;
const GENERATED_AT = `${PROV}generatedAtTime`;
const PREFIXES = `PREFIX cascade: <${CASCADE}> PREFIX prov: <${PROV}> PREFIX pav: <${PAV}> PREFIX bridge: <${BRIDGE}>`;
/** What an app names the judgment it hands to `judge`, which the package names in its place. */
const THIS_JUDGMENT = "urn:cascade:this-judgment";
/** The verdicts that say something of their members' versions, which name each version they saw. */
const SEEN = new Set(
  ["Same", "Different", "Erroneous"].map((v) => CASCADE + v),
);
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

export interface ImportOptions {
  /** Records an About for each profile of the import no counting About ties to the subject. */
  readonly aboutSubject?: boolean;
  /** Runs the matcher on the import; on unless false. */
  readonly match?: boolean;
  /** Told as each part of the import begins, with what is done so far; the import goes on once what it returns settles. */
  readonly onProgress?: (progress: ImportProgress) => void | Promise<void>;
}

export interface Pod {
  /** The pod's naming base, ending in a slash. */
  readonly address: string;
  /** The one cascade:Subject. */
  readonly subject: string;
  /** The owner's profile's #me. */
  readonly owner: string;
  /** The open that gave the pod the app's newer tables when it was opened (O1, O2); none when they had not changed. */
  readonly opened?: Opened;
  /** Whether its files and its kept answers are sealed under a key only its secret opens. */
  readonly encrypted: boolean;
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
  enter(turtle: string, options?: { match?: boolean }): Promise<Done>;
  judge(turtle: string): Promise<Done>;
  match(activity?: string): Promise<Done>;
  ask(
    question: string | { query: string },
    options?: { lens?: string },
  ): Promise<Row[]>;
  /**
   * How each report of a variant stands to the row of the variant classifications table the app holds that the variant
   * finds (`tables/agreement.rq`): the report's entry (`report`), the row (`row`), the version (`origin`) and the
   * `verdict`. It is answered over the app's current version of the table, kept as an answer is, and writes nothing.
   */
  agreement(): Promise<Row[]>;
  /**
   * The classes the app's tables give each active medication of the pod
   * (`tables/medication-classes-through-precise-ingredients.rq`): the entry
   * (`entry`), its `medication`, the `class`, the `relation` the class row gives it, the version of the drug classes
   * table that holds the row (`origin`) and the code the row is on (`through`). It is answered over the current
   * versions of the tables, reads the pod and writes nothing. A combination product is in no class: MED-RT classes none.
   */
  medicationClasses(): Promise<Row[]>;
  /**
   * The lab results of the pod in the LOINC panel with the code `panel`, which the person picked (`tables/panel-results.rq`
   * asked of that panel): each member the panel lists, directly or through a panel nested in it, with its `sequence`,
   * its `required` as LOINC writes it, the panel `via` whose row lists it, the version of the panel members table that
   * holds the row (`origin`) and the `entry` of the pod's result for it. A required member the pod has no result for is a
   * row with no `entry`. A member reached directly and through a nested panel is a row for each `via`, and a member with
   * several results a row for each. It is answered over the current versions of the tables, reads the pod and writes
   * nothing.
   */
  panelResults(panel: string): Promise<Row[]>;
  /**
   * The reference table versions that joined each entry's records (`tables/joined-by.rq`): the `entry` and the version
   * (`used`) that a counting machine Same cited while joining one of its records. The rule list and the records'
   * versions are never among them, a Same that no longer counts names nothing, and an entry joined without a table has no
   * row. It reads the pod and writes nothing.
   */
  joinedBy(): Promise<Row[]>;
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
  readonly claimed: boolean;
}

export interface Done {
  /** Paths of the files new to the pod, in the order written. */
  readonly wrote: readonly string[];
  /** Why the rules refused the step; it then wrote nothing. */
  readonly refused?: string;
  /** The import or entry session it made. */
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
  readonly claimed: readonly {
    readonly profile: string;
    readonly judgment: string;
  }[];
  /** The import's profiles no counting About ties to the subject. */
  readonly unclaimed: readonly string[];
}

export type Row = Readonly<Record<string, string>>;

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
CONSTRUCT { ?entry cascade:testCode ?code ; cascade:latestMember ?latest }
WHERE { ?entry cascade:testCode ?code ; cascade:latestMember ?latest }`;

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

/** The key the answer to the question, of the text given, under the lens is kept under at the revision. */
function keyOf(
  build: VocabularyBuild,
  layout: string,
  asked: {
    readonly runtime: string;
    readonly question: string;
    readonly text: string;
    readonly lens: string;
    readonly revision: string;
    readonly tables: readonly string[];
  },
): Promise<string> {
  const { runtime, question, text, lens, revision, tables } = asked;
  return answerKey({
    runtime,
    question,
    lens,
    revision,
    tables,
    texts: [
      text,
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
  agreement(): Promise<Row[] | undefined>;
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

/** The About the claim records: the profile is the subject's, by the owner's statement. */
function about(subject: string, profile: string, owner: string): string {
  return `@prefix cascade: <${CASCADE}> .
@prefix prov: <${PROV}> .
<${THIS_JUDGMENT}> a cascade:Judgment ;
    cascade:verdict cascade:About ; cascade:subject <${subject}> ; cascade:basis cascade:OwnerStatement ;
    prov:hadMember <${profile}> ; prov:wasAttributedTo <${owner}> ;
    prov:qualifiedAttribution [ a prov:Attribution ; prov:agent <${owner}> ; prov:hadRole cascade:PatientRole ] .
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

  constructor(
    parts: Parts,
    core: CorePod,
    readonly address: string,
    readonly subject: string,
    tables: readonly string[],
    answers: Answers | undefined,
    readonly encrypted: boolean,
    readonly opened?: Opened,
  ) {
    this.#parts = parts;
    this.#core = core;
    this.#answers = answers;
    this.#tables = tables;
  }

  get owner(): string {
    return `${this.address}${this.#parts.layout.card}#me`;
  }

  get head(): Head | undefined {
    return this.#core.head;
  }

  look(exported: string | Exported): Promise<readonly ExportSource[]> {
    return this.#next(() => this.#look(exported));
  }

  import(
    exported: string | Exported,
    options: ImportOptions = {},
  ): Promise<Imported> {
    return this.#next(() => this.#import(exported, options));
  }

  enter(turtle: string, options: { match?: boolean } = {}): Promise<Done> {
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

  judge(turtle: string): Promise<Done> {
    return this.#next(() => this.#judge(turtle));
  }

  match(activity?: string): Promise<Done> {
    return this.#next(() => this.#core.match(activity));
  }

  ask(
    question: string | { query: string },
    options: { lens?: string } = {},
  ): Promise<Row[]> {
    return this.#next(() => this.#ask(question, options));
  }

  agreement(): Promise<Row[]> {
    return this.#next(() => this.#agreement());
  }

  medicationClasses(): Promise<Row[]> {
    return this.#next(() => this.#medicationClasses());
  }

  panelResults(panel: string): Promise<Row[]> {
    return this.#next(() => this.#panelResults(panel));
  }

  joinedBy(): Promise<Row[]> {
    return this.#next(() => this.#joinedBy());
  }

  close(): Promise<void> {
    return this.#next(async () => {
      this.#closed = true;
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
          ?document prov:qualifiedAttribution ?attribution .
          ?attribution prov:hadRole ?role ;
            prov:agent/(<http://www.w3.org/2000/01/rdf-schema#label>|^prov:specializationOf/<http://xmlns.com/foaf/0.1/name>) ?author .
          FILTER (?role IN (cascade:AuthorRole, cascade:CustodianRole))
        }
      }`);
    const claimedServers = new Set(
      rows.flatMap((row) => {
        const server = row.get("server")?.value;
        return server === undefined ? [] : [normalised(server)];
      }),
    );
    const claimedAuthors = new Set(
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
        claimed:
          source.server === undefined
            ? source.name !== undefined &&
              claimedAuthors.has(spaced(source.name))
            : claimedServers.has(source.server),
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
        claimed: [],
        unclaimed: [],
      };
    const { onProgress } = options;
    const filed = await this.#core.import(
      found.files,
      found.name,
      async () => (await this.#loadedBridge()).adapters,
      onProgress,
    );
    const activity = filed.activity;
    if (filed.refused !== undefined || activity === undefined)
      return { ...filed, claimed: [], unclaimed: [] };
    const matching = options.match !== false;
    const profiles =
      options.aboutSubject === true ? await this.#unclaimed(activity) : [];
    const of = profiles.length + (matching ? 1 : 0);
    if (of > 0) await onProgress?.({ part: "judging", done: 0, of });
    const claimed: { profile: string; judgment: string }[] = [];
    for (const [index, profile] of profiles.entries()) {
      const { judgment } = await this.#judge(
        about(this.subject, profile, this.owner),
      );
      if (judgment !== undefined) claimed.push({ profile, judgment });
      await onProgress?.({ part: "judging", done: index + 1, of });
    }
    const matched = matching ? await this.#core.match(activity) : undefined;
    return {
      ...filed,
      ...(matched === undefined ? {} : { matched }),
      claimed,
      unclaimed: await this.#unclaimed(activity),
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

  /** The patient profiles the import's revisions' versions name that no counting About ties to the subject. */
  async #unclaimed(activity: string): Promise<string[]> {
    const { rows } = await this.#core.select(`${PREFIXES}
      SELECT DISTINCT ?profile WHERE {
        ?revision prov:wasGeneratedBy <${activity}> ; cascade:version ?version .
        ?version cascade:patient ?profile .
        FILTER (isIRI(?profile) && ?profile != <${this.subject}>)
        FILTER NOT EXISTS {
          ?judgment cascade:countsUnderLens true ; cascade:verdict cascade:About ;
            prov:hadMember ?profile ; cascade:subject <${this.subject}> .
        }
      } ORDER BY ?profile`);
    return rows.flatMap((row) => row.get("profile")?.value ?? []);
  }

  async #judge(turtle: string): Promise<Done> {
    let stated: Triple[];
    try {
      stated = await this.#parts.newStore().parse(turtle, this.address);
    } catch (error) {
      throw new Error(`the judgment is no Turtle: ${failure(error)}`, {
        cause: error,
      });
    }
    const judgments = stated
      .filter(
        ([, p, o]) => p.value === TYPE && o.value === `${CASCADE}Judgment`,
      )
      .map(([s]) => s.value);
    if (judgments.length !== 1 || judgments[0] !== THIS_JUDGMENT)
      throw new Error(
        `the judgment's Turtle holds ${judgments.length === 0 ? "no judgment" : judgments.join(", ")}; it holds one, named <${THIS_JUDGMENT}>`,
      );
    const name = randomId();
    const judgment = iri(name);
    const named = stated
      .map(
        (triple) =>
          triple.map((term) =>
            term.termType === "NamedNode" && term.value === THIS_JUDGMENT
              ? judgment
              : term,
          ) as unknown as Triple,
      )
      .filter(
        ([s, p]) =>
          !(s.value === name && (p.value === USED || p.value === GENERATED_AT)),
      );
    const of = (predicate: string): string[] =>
      named.flatMap(([s, p, o]) =>
        s.value === name && p.value === predicate && o.termType === "NamedNode"
          ? [o.value]
          : [],
      );
    const used: Triple[] = [];
    if (of(`${CASCADE}verdict`).some((verdict) => SEEN.has(verdict))) {
      const members = of(`${PROV}hadMember`);
      const current = await this.#currentVersions(members);
      for (const member of members) {
        const version = current.get(member);
        if (version === undefined)
          throw new Error(
            `${member} has no current version in the pod: it names no record`,
          );
        used.push([judgment, iri(USED), iri(version)]);
      }
    }
    const filed = await this.#core.judge({
      bytes: ntriples([
        ...named,
        ...used,
        [judgment, iri(GENERATED_AT), literal(clock.now(), `${XSD}dateTime`)],
      ]),
      base: this.address,
      name: "the judgment",
    });
    return filed.refused === undefined ? { ...filed, judgment: name } : filed;
  }

  /** Each record's current version, under the everyday lens, by the record. */
  async #currentVersions(
    records: readonly string[],
  ): Promise<Map<string, string>> {
    if (records.length === 0) return new Map();
    const { rows } = await this.#core.select(`${PREFIXES}
      SELECT ?record ?version WHERE {
        VALUES ?record { ${records.map((record) => `<${record}>`).join(" ")} }
        ?record pav:hasCurrentVersion ?version .
      }`);
    return new Map(
      rows.flatMap((row) => {
        const [record, version] = [row.get("record"), row.get("version")];
        return record === undefined || version === undefined
          ? []
          : [[record.value, version.value] as const];
      }),
    );
  }

  async #agreement(): Promise<Row[]> {
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
      if (kept !== undefined) return kept;
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
  async #medicationClasses(): Promise<Row[]> {
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
    const { rows } = await union.select(text);
    return rows.map((row) =>
      Object.fromEntries([...row].map(([name, term]) => [name, term.value])),
    );
  }

  /**
   * The query over a dataset of its own: the pod's lab result entries, and the panel's rows and those of the panels
   * nested in it in the panel members versions, which are all the query needs to answer for that panel. It answers for
   * every panel it finds on the way down; the rows kept are the panel's.
   */
  async #panelResults(panel: string): Promise<Row[]> {
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
    const { rows } = await union.select(text);
    return rows
      .map((row) =>
        Object.fromEntries([...row].map(([name, term]) => [name, term.value])),
      )
      .filter((row) => row.panel === panel);
  }

  async #joinedBy(): Promise<Row[]> {
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
    let keep: ((rows: Row[]) => Promise<void>) | undefined;
    if (typeof question === "string") {
      query = questionText(offered, question);
      const answers = this.#answers;
      if (answers !== undefined) {
        const key = await keyOf(build, offered.layout, {
          runtime: answers.runtime,
          question,
          text: query,
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
      Object.fromEntries([...row].map(([name, term]) => [name, term.value])),
    );
    await keep?.(rows);
    return rows;
  }
}

/**
 * The core over the pod's files. `writer`, given for a pod kept in a folder, holds the head the app's tables store kept
 * for it, and each new head is kept there; a pod in memory keeps none.
 */
function coreOver(
  parts: Parts,
  references: References,
  pod: Files,
  address: string,
  subject: string,
  title: string,
  opened?: Union,
  writer?: { readonly head: Head | undefined },
): CorePod {
  const { build } = parts;
  return new CorePod(
    {
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
        : { keepHead: (kept: Head) => parts.tables.keptHead(address, kept) }),
      references: () => Promise.resolve(references),
      build: {
        lens: parts.lens,
        derive: async (store, lens, pod, keep) => {
          await build.derivations.derive(store, lens, keep);
          return build.files(store, pod);
        },
      },
    },
    opened,
  );
}

/** The parts with every file of a pod's folder and of its kept answers sealed under the key. */
function sealedParts(parts: Parts, key: PodKey): Parts {
  const { answers } = parts;
  return {
    ...parts,
    folder: (path, iri) => {
      const folder = parts.folder(path, iri);
      return { ...folder, files: new EncryptedFiles(folder.files, key) };
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
  };
}

/**
 * The pod in the folder, or in memory with none. A missing or empty folder, or memory, is a new pod, named from a base
 * of its own and created; a folder holding a pod opens as it is, and is given the app's tables unless `adopt` is false.
 * With `key`, the folder's pod is encrypted under it, and a folder holding only its header is a new pod.
 */
export async function openPodWith(
  unsealed: Parts,
  folder?: string,
  options: { title?: string; adopt?: boolean; key?: PodKey } = {},
): Promise<Pod> {
  const encrypted = options.key !== undefined;
  const parts =
    options.key === undefined ? unsealed : sealedParts(unsealed, options.key);
  const disk = folder === undefined ? undefined : parts.folder(folder);
  const answers =
    folder === undefined || parts.answers === undefined
      ? undefined
      : new Answers(parts.answers.at(folder), parts.answers.runtime);
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
    const title = options.title ?? disk?.name ?? "pod";
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
      undefined,
      folder === undefined ? undefined : { head: undefined },
    );
    const created = await core.create();
    if (created.refused !== undefined)
      throw new Error(`the pod's creation was refused: ${created.refused}`);
    await answers?.describe({ address, subject, title });
    if (folder !== undefined)
      await parts.tables.opened(address, shipped(references), disk?.name);
    return new OpenPod(
      parts,
      core,
      address,
      subject,
      tables,
      answers,
      encrypted,
    );
  }
  const store = parts.newStore();
  const [stated, described] = await Promise.all([
    podStated(disk.files, parts.layout, store),
    answers?.described(),
  ]);
  const { address } = stated;
  const title = stated.title ?? disk.name;
  let subject = described?.address === address ? described.subject : undefined;
  let opened: Union | undefined;
  if (subject === undefined) {
    opened = new Union(store);
    await podFiles(disk.files, parts.layout, address, opened);
    const { rows } = await opened.select(
      `SELECT DISTINCT ?subject WHERE { ?subject a <${CASCADE}Subject> }`,
    );
    const [found, ...others] = rows.flatMap(
      (row) => row.get("subject")?.value ?? [],
    );
    if (found === undefined || others.length > 0)
      throw new Error(`${folder} holds ${rows.length} subjects, not one`);
    subject = found;
  }
  await answers?.describe({ address, subject, title });
  const files = parts.folder(folder, address).files;
  const core = coreOver(
    parts,
    references,
    files,
    address,
    subject,
    title,
    opened,
    { head: await parts.tables.headOf(address) },
  );
  return new OpenPod(
    parts,
    core,
    address,
    subject,
    tables,
    answers,
    encrypted,
    options.adopt === false
      ? undefined
      : await openedWithTables(
          parts.tables,
          references,
          core,
          address,
          disk.name,
        ),
  );
}

/** The pod given the app's tables when they changed since it was last opened, or it never was (O1, O2). */
async function openedWithTables(
  tables: Tables,
  references: References,
  core: CorePod,
  address: string,
  name: string,
): Promise<Opened | undefined> {
  const current = shipped(references);
  const before = await tables.openedWith(address);
  if (
    before !== undefined &&
    before.length === current.length &&
    before.every((version, index) => version === current[index])
  ) {
    await tables.named(address, name);
    return undefined;
  }
  const performed = await core.open(references);
  if (performed.refused === undefined)
    await tables.opened(address, current, name);
  return { ...performed, unheld: performed.unheld ?? [] };
}
