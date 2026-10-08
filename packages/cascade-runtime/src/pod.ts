import {
  clock,
  CorePod,
  type Files,
  type Importer,
  type ImportProgress,
  type IndexEntry,
  iri,
  type Layout,
  LAYOUT_FILE,
  lenses,
  literal,
  type Loaded,
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
  podStated,
  questions,
  randomId,
  RDF,
  readText,
  type References,
  type StoreFactory,
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

const JDG = "https://ns.cascadeprotocol.org/judgments/v1-draft#";
const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const TYPE = `${RDF}type`;
const USED = `${PROV}used`;
const GENERATED_AT = `${PROV}generatedAtTime`;
const PREFIXES = `PREFIX rec: <${REC}> PREFIX prov: <${PROV}> PREFIX pav: <${PAV}> PREFIX jdg: <${JDG}> PREFIX bridge: <${BRIDGE}>`;
/** What an app names the judgment it hands to `judge`, which the package names in its place. */
const THIS_JUDGMENT = "urn:cascade:this-judgment";
/** The verdicts that say something of their members' versions, which name each version they saw. */
const SEEN = new Set(["Same", "Different", "Erroneous"].map((v) => JDG + v));
const UUID = "urn:uuid:";
/** The matcher's tables every pod is given: those of Priya's kit, alpha test data. */
export const TABLES =
  "conformance/priya-natarajan/scripted-input/priya/references/";

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
  /** The one rec:Subject. */
  readonly subject: string;
  /** The owner's profile's #me. */
  readonly owner: string;
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
  readonly layout: Layout;
  readonly build: VocabularyBuild;
  /** The lens `cascade-runtime.json` names. */
  readonly lens: string;
  readonly importers: readonly Importer[];
  /** The matcher's tables. */
  readonly references: References;
  readonly newStore: StoreFactory;
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

function offeredLens(offered: Askable, lens: string): void {
  if (!offered.lenses.includes(lens))
    throw new Error(`no lens ${lens}; there are ${offered.lenses.join(", ")}`);
}

/** The text of the question the vocabulary offers by the name; none offered throws. */
function questionText(offered: Askable, question: string): string {
  const found = offered.questions.get(question);
  if (found === undefined)
    throw new Error(
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
  },
): Promise<string> {
  const { runtime, question, text, lens, revision } = asked;
  return answerKey({
    runtime,
    question,
    lens,
    revision,
    texts: [
      text,
      ...build.derivations.for(lens).map(({ query }) => query),
      layout,
      ...build.queries,
    ],
  });
}

/** What a pod's kept answers are read with: no store, so no engine. */
export type Reading = Pick<Parts, "vocabulary" | "layout" | "build" | "lens">;

/** A pod as its kept answers read it, without the engine. */
export interface KeptPod extends Described {
  readonly owner: string;
  /**
   * The rows kept for the question, by its name, under the lens for the pod as it stands; none when none were. A
   * question or lens the vocabulary does not offer throws, as the pod opened with the engine would.
   */
  rows(question: string, lens?: string): Promise<Row[] | undefined>;
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
  return {
    ...described,
    owner: `${described.address}${layout.card}#me`,
    rows: async (question, lens = reading.lens) => {
      const offered = await askable(vocabulary);
      offeredLens(offered, lens);
      const text = questionText(offered, question);
      revision ??= podRevision(pod, layout, described.address);
      return answers.rows(
        lens,
        question,
        await keyOf(build, offered.layout, {
          runtime: answers.runtime,
          question,
          text,
          lens,
          revision: await revision,
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
  return `@prefix jdg: <${JDG}> .
@prefix prov: <${PROV}> .
<${THIS_JUDGMENT}> a jdg:Judgment ;
    jdg:verdict jdg:About ; jdg:subject <${subject}> ; jdg:basis jdg:OwnerStatement ;
    prov:hadMember <${profile}> ; prov:wasAttributedTo <${owner}> ;
    prov:qualifiedAttribution [ a prov:Attribution ; prov:agent <${owner}> ; prov:hadRole jdg:patient ] .
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
  #queue: Promise<unknown> = Promise.resolve();
  #bridge: Promise<LoadedBridge> | undefined;
  #closed = false;

  constructor(
    parts: Parts,
    core: CorePod,
    readonly address: string,
    readonly subject: string,
    answers?: Answers,
  ) {
    this.#parts = parts;
    this.#core = core;
    this.#answers = answers;
  }

  get owner(): string {
    return `${this.address}${this.#parts.layout.card}#me`;
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
        ?record rec:subject <${this.subject}> .
        ?revision rec:revisionOf ?record ; prov:wasDerivedFrom ?document .
        OPTIONAL { ?document bridge:serverBaseUrl ?server }
        OPTIONAL {
          FILTER NOT EXISTS { ?document bridge:serverBaseUrl ?anyServer }
          ?document prov:qualifiedAttribution ?attribution .
          ?attribution prov:hadRole rec:author ; prov:agent/<http://www.w3.org/2000/01/rdf-schema#label> ?author .
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
        ?revision prov:wasGeneratedBy <${activity}> ; rec:version ?version .
        ?version rec:patient ?profile .
        FILTER (isIRI(?profile) && ?profile != <${this.subject}>)
        FILTER NOT EXISTS {
          ?judgment rec:counts true ; jdg:verdict jdg:About ;
            prov:hadMember ?profile ; jdg:subject <${this.subject}> .
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
      .filter(([, p, o]) => p.value === TYPE && o.value === `${JDG}Judgment`)
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
    if (of(`${JDG}verdict`).some((verdict) => SEEN.has(verdict))) {
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

function coreOver(
  parts: Parts,
  pod: Files,
  address: string,
  subject: string,
  title: string,
  opened?: Union,
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
      references: () => Promise.resolve(parts.references),
      build: {
        lens: parts.lens,
        derive: async (store, lens, pod) => {
          await build.derivations.derive(store, lens);
          return build.files(store, pod);
        },
      },
    },
    opened,
  );
}

/**
 * The pod in the folder, or in memory with none. A missing or empty folder, or memory, is a new pod, named from a base
 * of its own and created; a folder holding a pod opens as it is.
 */
export async function openPodWith(
  parts: Parts,
  folder?: string,
  options: { title?: string } = {},
): Promise<Pod> {
  const disk = folder === undefined ? undefined : parts.folder(folder);
  const answers =
    folder === undefined || parts.answers === undefined
      ? undefined
      : new Answers(parts.answers.at(folder), parts.answers.runtime);
  const card =
    disk === undefined ? undefined : await disk.files.read(parts.layout.card);
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
    const core = coreOver(parts, files, address, subject, title);
    const created = await core.create();
    if (created.refused !== undefined)
      throw new Error(`the pod's creation was refused: ${created.refused}`);
    await answers?.describe({ address, subject, title });
    return new OpenPod(parts, core, address, subject, answers);
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
      `SELECT DISTINCT ?subject WHERE { ?subject a <${REC}Subject> }`,
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
  return new OpenPod(
    parts,
    coreOver(parts, files, address, subject, title, opened),
    address,
    subject,
    answers,
  );
}
