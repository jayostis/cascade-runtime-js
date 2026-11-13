import {
  builtFileBytes,
  featureStory,
  fileStem,
  Graph,
  iri,
  documentName,
  enteredRecordName,
  recordNamedByInputs,
  comparison,
  QUERIES,
  QUESTIONS,
  RDF,
  RULE_LIST,
  readText,
  readWrittenFeature,
  type StepKind,
  type Term,
  Words,
} from "@cascade-runtime/runtime";
import type { Site } from "./site.js";
import { numberOf } from "./spec.js";
import { code, expanded, PREFIXES, prefixed, shown, terms } from "./terms.js";

/** The data object of a pod's explorer, written beside the pod's page. */
export const EXPLORER_FILE = "explorer.json";

/** The most bytes the data object may be, raw: the explorer loads it whole before it shows anything. */
export const EXPLORER_BUDGET = 400 * 1024;

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const PROV = "http://www.w3.org/ns/prov#";
const DCT = "http://purl.org/dc/terms/";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const PIM = "http://www.w3.org/ns/pim/space#";
const SOLID = "http://www.w3.org/ns/solid/terms#";
const TYPE = `${RDF}type`;
const BATCH = 32;

/** The ids the kit's `expected/handles.json` gives its records, servers and judgments. */
export type Handles = NonNullable<Awaited<ReturnType<typeof Words.handlesOf>>>;

/** A term as `prefix:name` when the site knows its prefix, or else the IRI whole. */
export type Curie = string;

/**
 * What a file is. A stored document's bytes are `bytes`; every other kind is read from the file's own statements:
 * `revision`, `version` (anything that specializes a thing), `record`, `judgment`, `assertion` (a matcher judgment's
 * assertion), `retraction`, `import`, `session`, `matcherrun`, `act` (any other act's file), `document`, `series`,
 * `subject`, `profile`, `preferences`, `typeindex`, `manifest`; a file the build writes is a `view` when the layout gives
 * it a class and `built` when it gives none; any other is `other`.
 */
export type FileKind =
  | "bytes"
  | "revision"
  | "version"
  | "record"
  | "judgment"
  | "assertion"
  | "retraction"
  | "import"
  | "session"
  | "matcherrun"
  | "act"
  | "document"
  | "series"
  | "subject"
  | "profile"
  | "preferences"
  | "typeindex"
  | "manifest"
  | "view"
  | "built"
  | "other";

/**
 * Where a file's writer is: a row of the log, `0` for files no act names (the pod's making), or `"build"` for a file the
 * build rewrites at every build.
 */
export type Writer = number | "build";

/**
 * Every reference between parts of the object is an index: into `files` (a "file index"), `log` (a "row"), `queries` or
 * `matcherRules`. `files` is sorted by path, so an index is stable for one build.
 */
export interface ExplorerFile {
  readonly path: string;
  readonly bytes: number;
  readonly kind: FileKind;
  /** The IRI of the thing the file is named for; the file's own IRI where it is named for none. */
  readonly thing: string;
  /** The label the pod gives the thing, or its `rdfs:label`, `dct:title` or the layout's title; a stored document's bytes have their document's; absent when there is none. */
  readonly label?: string;
  readonly types: readonly Curie[];
  readonly writer: Writer;
  /** The class the layout files it under, and the property it is filed with (a version, a revision). */
  readonly class?: Curie;
  readonly filedWith?: Curie;
  /** Its page in the site, relative to the site's root, where the site has one. */
  readonly page?: string;
  /** File indexes of the pod files its statements name, and of those whose statements name it, each ascending. */
  readonly names: readonly number[];
  readonly namedBy: readonly number[];
  /** Indices into `termList` of the predicates and classes its statements use, ascending; absent when it uses none. */
  readonly terms?: readonly number[];
  /** The handle the kit's `expected/handles.json` gives the record. */
  readonly handle?: string;
  /** A record: its revisions in time order, each with the version it sets. */
  readonly arrivals?: readonly Arrival[];
  /** A record: the id of the view entry it is in. */
  readonly entry?: string;
  /** A revision or a version: the record it belongs to. */
  readonly record?: number;
  /** A judgment. */
  readonly judgment?: ExplorerJudgment;
  /** A stored document's bytes: the document file that names them. */
  readonly document?: number;
  /** A view: its index in `views`. */
  readonly view?: number;
  /** The query that writes it, where a query does. */
  readonly writtenBy?: number;
}

export interface Arrival {
  /** The revision's file index. */
  readonly revision: number;
  /** The version's file index; absent when the pod holds none. */
  readonly version?: number;
  readonly time: string;
}

export interface ExplorerJudgment {
  readonly verdict?: Curie;
  /** `matcher` for a judgment the matcher made, `person` for any other. */
  readonly by: "matcher" | "person";
  readonly justification?: Curie;
  readonly description?: string;
  /** The record files it joins or separates. */
  readonly members: readonly number[];
  /** The IRIs of the members that are no file of the pod (a patient identity, say), ascending; absent when there are none. */
  readonly others?: readonly string[];
  /** Whether it counts under the site's lens; absent when the vocabulary's question about it gives no row. */
  readonly counts?: boolean;
  /** The row of `matcherRules` it was asserted under, for a matcher judgment. */
  readonly rule?: number;
}

/** What the layout files, by folder or by file. */
export interface ExplorerPlacement {
  readonly folder?: string;
  readonly file?: string;
  readonly class?: Curie;
  readonly filedWith?: Curie;
  readonly forSubjectsOf?: Curie;
  readonly title?: string;
  readonly holdsRecords: boolean;
  readonly storesBytes: boolean;
  /** The query that writes the file, as an index into `queries`. */
  readonly writtenBy?: number;
}

/** One row of the pod's own log. */
export interface ExplorerAct {
  /** `making` for row 0, `snapshot` for an act that left a snapshot, `time` for a person's judgments of one time. */
  readonly how: "making" | "snapshot" | "time";
  readonly time?: string;
  readonly type?: Curie;
  readonly label?: string;
  /** The act's file. */
  readonly act?: number;
  readonly snapshot?: string;
  /** The row of the snapshot before it. */
  readonly parent?: number;
  readonly setHash?: string;
  /** Files the row wrote. */
  readonly wrote: readonly number[];
  /** Files its snapshot names that the pod does not hold. */
  readonly missing: readonly string[];
  readonly informedBy?: number;
  readonly role?: Curie;
  /**
   * The kit's steps that fall on this row, each with whether the pod holds an act of exactly its time. A step that was
   * not performed here (the kit's decided E7, E9, M2) is listed `performed: false`; whether the row wrote files is
   * `wrote`, which a performed step may leave empty.
   */
  readonly kitSteps: readonly {
    readonly name: string;
    readonly performed: boolean;
  }[];
}

export interface ExplorerKit {
  readonly name: string;
  readonly feature: string;
  readonly steps: readonly {
    readonly name: string;
    readonly when: string;
    readonly kind: StepKind;
    /** The row of the log it falls on. */
    readonly row: number;
    /** Whether the pod holds an act of exactly that time; false when the step was not performed here and leaves no act of its own. */
    readonly performed: boolean;
  }[];
  readonly cases: readonly {
    /** `P1`, `T3` and so on, or absent for a rule with no number. */
    readonly id?: string;
    readonly rule: string;
    readonly example: string;
    /** The step whose pod the example reads ("as it stood after"), and the lens, when it says so. */
    readonly after?: string;
    readonly lens?: string;
    /** The row it is checked after: its step's, or the last for an example that names none. */
    readonly row: number;
  }[];
  readonly handles?: Handles;
}

export interface ExplorerEntry {
  /** The view file's path, `#`, and the entry's fragment. */
  readonly id: string;
  readonly label: string;
  readonly page?: string;
  readonly members: readonly number[];
  /** The IRIs of the members that are no file of the pod (the patient identities a profile merges, say), ascending; absent when there are none. */
  readonly others?: readonly string[];
  readonly lead?: number;
  readonly statusFrom?: number;
  /** A field: the property, the value on the entry itself, each member's value (in `members` then `others` order) and whether they disagree. */
  readonly fields: readonly {
    readonly term: Curie;
    readonly entry: string;
    readonly members: readonly string[];
    readonly disagree: boolean;
  }[];
  /** Judgment files that join two or more of its members (files or `others`), and those that name one of them only. */
  readonly within: readonly number[];
  readonly touching: readonly number[];
}

/** A view the layout names: the query that defines it and the file it writes. */
export interface ExplorerView {
  readonly file: string;
  /** The file's index; absent when the pod holds nothing of its kind, so the file is not written. */
  readonly fileIndex?: number;
  readonly class?: Curie;
  readonly title?: string;
  readonly query: number;
  readonly statements: number;
  readonly entries: readonly ExplorerEntry[];
}

export interface ExplorerQuery {
  /** The path in the vocabulary, and, under the site's `queries/`, where the query's text is. */
  readonly path: string;
  readonly group: string;
  readonly name: string;
  readonly form: string;
  /** For a question, its name in `answers.json`. */
  readonly question?: string;
  /** Terms its CONSTRUCT template writes, and terms its WHERE names. */
  readonly writes: readonly Curie[];
  readonly reads: readonly Curie[];
  /** Its place in the build's order, 0 first, for a query the build runs; and each term it adds, with how many statements. */
  readonly order?: number;
  readonly added?: readonly (readonly [Curie, number])[];
  /** The file it writes. */
  readonly file?: number;
  /** The rows of `matcherRules` that name it. */
  readonly rules?: readonly number[];
}

/** A rule of a rule-list version a matcher judgment was asserted under, and the query it names. */
export interface ExplorerMatcherRule {
  readonly rule: Curie;
  readonly version: string;
  /** The query's index in `queries`, absent where the rule names none the vocabulary holds. */
  readonly query?: number;
  readonly hash: string;
  /** How the query was found: by the `queryPath` of the vocabulary's rule list, or, for a version it does not hold, by its hash. */
  readonly by: "path" | "hash";
  /** Why the rule's query cannot be trusted (it does not hash to `hash`, or is not there); absent when it hashes true. */
  readonly problem?: string;
}

export interface ExplorerHop {
  readonly file: number;
  readonly triples: readonly {
    readonly predicate: Curie;
    readonly object: string;
    /** The file the object is, where it is one. */
    readonly go?: number;
  }[];
  /** For the type index: what each registration points at. */
  readonly registrations?: readonly {
    readonly title?: string;
    readonly class?: Curie;
    readonly target: string;
    readonly file?: number;
    readonly query?: number;
  }[];
}

/**
 * The explorer's data object, `explorer.json`: everything the explorer's fixed app shows of one pod but the bodies of
 * files, the text of queries and the rows of answers, which it fetches (`pod/<path>`, `queries/<path>`, `answers.json`).
 */
export interface ExplorerData {
  readonly version: 1;
  readonly pod: {
    readonly address: string;
    readonly title: string;
    readonly subject?: string;
    readonly created?: string;
    readonly lens: string;
    /** The software the manifest names. */
    readonly runtime?: string;
    /** The last snapshot, which the manifest names. */
    readonly head?: string;
    /** Set when the chain of snapshots breaks before its first: the snapshot named that is not in the pod. */
    readonly brokenAt?: string;
    readonly manifest: number;
    readonly card: number;
    readonly preferences: number;
    readonly typeIndex: number;
    /** `…/blob/<commit>/` of the vocabulary: a query's file is at this plus its path. */
    readonly vocabularyBlob?: string;
    /** The site's pages the explorer links, as the site has them. */
    readonly links: {
      readonly front?: string;
      readonly terms?: string;
      readonly spec?: string;
    };
  };
  /** The label and comment of each term of the vocabulary's own that the object uses, by its `prefix:name`. */
  readonly terms: Readonly<
    Record<Curie, { readonly label?: string; readonly comment?: string }>
  >;
  /** The prefixes the explorer prints IRIs with: `prefix` to namespace. */
  readonly prefixes: Readonly<Record<string, string>>;
  /** The terms the pod's files use that a query's WHERE can name (no `rdf:type`, no `rdfs:label`), sorted; a file's `terms` index it. */
  readonly termList: readonly Curie[];
  readonly placements: readonly ExplorerPlacement[];
  readonly files: readonly ExplorerFile[];
  readonly log: readonly ExplorerAct[];
  /** Absent for a pod built from no kit. */
  readonly kit?: ExplorerKit;
  readonly views: readonly ExplorerView[];
  readonly queries: readonly ExplorerQuery[];
  readonly matcherRules: readonly ExplorerMatcherRule[];
  /** Each lens's answer to "pod/How many judgments count". */
  readonly lenses: readonly {
    readonly lens: string;
    readonly columns: readonly string[];
    readonly rows: readonly (readonly string[])[];
  }[];
  /** How an app finds a view: the card, the preferences file and the type index, each with the lines that name the next. */
  readonly chain: readonly ExplorerHop[];
}

interface Held {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly graph: Graph | undefined;
  readonly thing: string;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byTime = (a: string, b: string): number => Date.parse(a) - Date.parse(b);

/** The terms the object uses, so that only those are described. */
class Used {
  readonly curies = new Set<string>();

  curie(value: string): Curie {
    const found = prefixed(value);
    if (found !== undefined) this.curies.add(found);
    return found ?? value;
  }
}

/** A query's code: its comments, strings, IRIs and prologue taken out. */
function codeOf(text: string): string {
  return text
    .replace(/^\s*#.*$/gm, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/<[^>\s]*>/g, "<>")
    .replace(/^\s*PREFIX.*$/gim, "");
}

const TERM_IN_QUERY =
  /(?<![\w:])(cascade|prov|pav|dct|rdfs|solid|foaf|pim|dcat|oa|bridge):([A-Za-z][\w-]*)/g;
const QUERY_PREFIXES = new Set(
  "cascade prov pav dct rdfs solid foaf pim dcat oa bridge".split(" "),
);
const GENERIC = new Set(["rdfs:label", "rdf:type"]);

function termsIn(text: string): string[] {
  return [
    ...new Set([...text.matchAll(TERM_IN_QUERY)].map((found) => found[0])),
  ]
    .filter((term) => !GENERIC.has(term))
    .sort(compare);
}

/** A query's CONSTRUCT template and its WHERE clause, each as code. */
function partsOf(text: string): {
  form: string;
  template: string;
  where: string;
} {
  const stripped = codeOf(text);
  const form = /\b(CONSTRUCT|SELECT|ASK|DESCRIBE)\b/.exec(stripped)?.[1] ?? "";
  if (form !== "CONSTRUCT") return { form, template: "", where: stripped };
  const open = stripped.indexOf("{", stripped.indexOf("CONSTRUCT"));
  let depth = 0;
  let close = open;
  for (; close < stripped.length; close++) {
    if (stripped[close] === "{") depth++;
    else if (stripped[close] === "}" && --depth === 0) break;
  }
  return {
    form,
    template: stripped.slice(open, close + 1),
    where: stripped.slice(close + 1),
  };
}

async function held(site: Site): Promise<Held[]> {
  const { options, pod } = site;
  const { layout } = options;
  const loaded: Held[] = [];
  for (let start = 0; start < pod.files.length; start += BATCH) {
    loaded.push(
      ...(await Promise.all(
        pod.files.slice(start, start + BATCH).map(async (path) => {
          const rebuilt = pod.built.get(path);
          const bytes =
            rebuilt === undefined
              ? await options.pod.read(path)
              : builtFileBytes(layout, pod.address, path, rebuilt);
          if (bytes === undefined) throw new Error(`${path} is gone`);
          if (!layout.isRdf(path))
            return { path, bytes, graph: undefined, thing: pod.address + path };
          const store = options.newStore();
          const triples =
            rebuilt ?? (await store.parse(bytes, pod.address + path));
          store.free?.();
          const graph = new Graph(triples);
          const stem = path
            .slice(path.lastIndexOf("/") + 1)
            .replace(/\.ttl$/, "");
          const subjects = new Set(triples.map(([subject]) => subject.value));
          const named = [...subjects].find((subject) => {
            try {
              return fileStem(subject) === stem;
            } catch {
              return false;
            }
          });
          const fragments = [...subjects]
            .filter((subject) => subject.startsWith(`${pod.address}${path}#`))
            .sort(compare);
          const own =
            fragments.find((subject) => subject.endsWith(`#${stem}`)) ??
            (fragments.length === 1 ? fragments[0] : undefined);
          return {
            path,
            bytes,
            graph,
            thing: named ?? own ?? pod.address + path,
          };
        }),
      )),
    );
  }
  return loaded;
}

const object = (graph: Graph, subject: string, predicate: string) =>
  graph.objects(iri(subject), predicate)[0];

/**
 * Each rule of each rule-list version the pod states a row for (a rule, a query hash and the version it is a row of), with
 * the query it names: the path the vocabulary's rule list gives for the version, or, for a version the vocabulary's rule
 * list does not hold, the query under `matcher/` whose bytes hash to the pod's hash. Either way the query's bytes must hash
 * to the pod's hash, as `matcherRules()` checks the rule list's; one that does not is reported with why.
 */
async function ruleRows(
  site: Site,
  stated: readonly { version: string; rule: string; hash: string }[],
  queryIndex: ReadonlyMap<string, number>,
): Promise<{
  rules: ExplorerMatcherRule[];
  at: Map<string, number>;
}> {
  const { vocabulary, newStore } = site.options;
  const hashes = new Map<string, string>();
  const hashOf = async (path: string): Promise<string | undefined> => {
    const known = hashes.get(path);
    if (known !== undefined) return known;
    const bytes = await vocabulary.read(path);
    if (bytes === undefined) return undefined;
    const hash = await documentName(bytes);
    hashes.set(path, hash);
    return hash;
  };
  const listed = new Map<string, Graph | undefined>();
  const rowsOf = async (version: string): Promise<Graph | undefined> => {
    if (listed.has(version)) return listed.get(version);
    let rows: Graph | undefined;
    try {
      const path = `${RULE_LIST}${fileStem(version)}.ttl`;
      const bytes = await vocabulary.read(path);
      if (bytes !== undefined) {
        const store = newStore();
        rows = new Graph(await store.parse(bytes, vocabulary.iri + path));
        store.free?.();
      }
    } catch {
      rows = undefined;
    }
    listed.set(version, rows);
    return rows;
  };
  const byHash = new Map<string, string>();
  for (const path of queryIndex.keys())
    if (path.startsWith(`${QUERIES}matcher/`)) {
      const hash = await hashOf(path);
      if (hash !== undefined) byHash.set(hash, path);
    }
  const rules: ExplorerMatcherRule[] = [];
  const at = new Map<string, number>();
  for (const { version, rule, hash } of [...stated].sort(
    (a, b) => compare(a.version, b.version) || compare(a.rule, b.rule),
  )) {
    const rows = await rowsOf(version);
    const row = rows
      ?.subjects(`${CASCADE}matcherRule`, iri(rule))
      .find((each) => rows.objects(each, `${CASCADE}queryPath`).length > 0);
    const queryPath =
      row === undefined
        ? undefined
        : rows?.objects(row, `${CASCADE}queryPath`)[0]?.value;
    const path =
      queryPath === undefined ? byHash.get(hash) : comparison(queryPath);
    const computed = path === undefined ? undefined : await hashOf(path);
    const listedHash =
      row === undefined
        ? undefined
        : rows?.objects(row, `${CASCADE}queryHash`)[0]?.value;
    const problem =
      path === undefined
        ? queryPath === undefined
          ? `no query of the vocabulary hashes to ${hash}`
          : `the rule list's queryPath ${queryPath} names no query under ${QUERIES}matcher/`
        : computed === undefined
          ? `${path} is not in the vocabulary`
          : computed !== hash
            ? `${path} hashes to ${computed}, not ${hash} as the pod's rule row says`
            : listedHash !== undefined && listedHash !== hash
              ? `the vocabulary's rule list says ${listedHash} for the rule, not ${hash} as the pod's rule row does`
              : undefined;
    const query = path === undefined ? undefined : queryIndex.get(path);
    at.set(`${version}\n${rule}`, rules.length);
    rules.push({
      rule: prefixed(rule) ?? rule,
      version,
      ...(query === undefined ? {} : { query }),
      hash,
      by: queryPath === undefined ? "hash" : "path",
      ...(problem === undefined ? {} : { problem }),
    });
  }
  return { rules, at };
}

/** A field's value as a reader reads it: a code by its system, a term by its name, a literal as the site shows it. */
function valueOf(site: Site, used: Used, term: Term): string {
  if (term.termType === "Literal") return shown(term);
  if (term.termType === "BlankNode") return "";
  const named = site.name(term);
  if (named !== term.value) return named;
  const coded = code(term.value, site.codeSystems);
  if (coded !== undefined) return `${coded[0]} ${coded[1]}`;
  return used.curie(term.value);
}

const STRUCTURE = new Set([
  TYPE,
  `${CASCADE}mergedFrom`,
  `${CASCADE}memberCurrentValues`,
  `${CASCADE}leadMember`,
  `${CASCADE}statusFrom`,
  `${CASCADE}dateFrom`,
  `${CASCADE}valuesOfMember`,
  `${PROV}wasDerivedFrom`,
]);

/** The data object of the site's pod, built from what `Site.build` holds. */
export async function explorerData(site: Site): Promise<ExplorerData> {
  const { options, pod } = site;
  const { layout, vocabulary } = options;
  const used = new Used();
  const loaded = await held(site);
  const indexOf = new Map(loaded.map(({ path }, index) => [path, index]));
  const fileOfThing = new Map(loaded.map(({ thing }, index) => [thing, index]));
  const at = (path: string): number => {
    const found = indexOf.get(path);
    if (found === undefined) throw new Error(`the pod has no file ${path}`);
    return found;
  };
  const fileOf = (value: string): number | undefined => {
    const whole = fileOfThing.get(value);
    if (whole !== undefined) return whole;
    const bare = value.replace(/#.*$/, "");
    if (fileOfThing.has(bare)) return fileOfThing.get(bare);
    return value.startsWith(pod.address)
      ? indexOf.get(value.slice(pod.address.length).replace(/#.*$/, ""))
      : undefined;
  };

  // queries
  const paths = (await vocabulary.list(QUERIES)).filter((path) =>
    path.endsWith(".rq"),
  );
  const texts = new Map<string, string>();
  for (const path of paths)
    texts.set(path, (await readText(vocabulary, path)).replace(/\r\n/g, "\n"));
  const queryIndex = new Map(paths.map((path, index) => [path, index]));
  const order = new Map<string, { n: number; added: [Curie, number][] }>();
  for (const { answer, added } of site.pipeline.get(options.lens) ?? []) {
    if (order.has(answer.query.path)) continue;
    order.set(answer.query.path, {
      n: order.size,
      added: terms(added).map(([term, count]) => [
        used.curie(term.value),
        count,
      ]),
    });
  }

  // the layout
  const builtAt = new Map(
    layout.built.flatMap(({ file, writtenBy }) =>
      file === undefined || writtenBy === undefined
        ? []
        : [[file, queryIndex.get(`${QUERIES}${writtenBy}`)] as const],
    ),
  );
  const viewFiles = new Set(layout.views.map(({ file }) => file));
  const classOf = (kind: string | undefined): Curie | undefined =>
    kind === undefined ? undefined : used.curie(kind);
  const placements: ExplorerPlacement[] = layout.placements.map((each) => {
    const query =
      each.writtenBy === undefined
        ? undefined
        : queryIndex.get(`${QUERIES}${each.writtenBy}`);
    const kind = classOf(each.kind);
    const filedWith = classOf(each.filedWith);
    const subjects = classOf(each.forSubjectsOf);
    return {
      ...(each.folder === undefined ? {} : { folder: each.folder }),
      ...(each.file === undefined ? {} : { file: each.file }),
      ...(kind === undefined ? {} : { class: kind }),
      ...(filedWith === undefined ? {} : { filedWith }),
      ...(subjects === undefined ? {} : { forSubjectsOf: subjects }),
      ...(each.title === undefined ? {} : { title: each.title }),
      holdsRecords: each.holdsRecords,
      storesBytes: each.storesBytes,
      ...(query === undefined ? {} : { writtenBy: query }),
    };
  });
  const recordClasses = new Set(
    layout.recordPlacements.map(({ kind }) => kind),
  );

  // kinds
  const kinds: FileKind[] = loaded.map(({ path, graph, thing }) => {
    if (graph === undefined) return "bytes";
    if (path === layout.manifest) return "manifest";
    if (path === layout.card) return "profile";
    if (path === layout.preferences) return "preferences";
    if (path === layout.typeIndex) return "typeindex";
    if (viewFiles.has(path)) return "view";
    if (builtAt.has(path)) return "built";
    const types = new Set(
      graph.objects(iri(thing), TYPE).map(({ value }) => value),
    );
    if (types.has(`${CASCADE}Revision`)) return "revision";
    if (graph.match(iri(thing), `${PROV}specializationOf`).length > 0)
      return "version";
    if (types.has(`${CASCADE}Judgment`)) return "judgment";
    if (types.has(`${CASCADE}MatcherJudgmentAssertion`)) return "assertion";
    if (graph.match(iri(thing), `${PROV}invalidated`).length > 0)
      return "retraction";
    if (types.has(`${CASCADE}DocumentImport`)) return "import";
    if (types.has(`${CASCADE}HandEntrySession`)) return "session";
    if (types.has(`${CASCADE}MatcherRun`)) return "matcherrun";
    if (layout.inActFolder(path)) return "act";
    if (types.has(`${CASCADE}ReferenceSeries`)) return "series";
    if (types.has(`${CASCADE}Subject`)) return "subject";
    if ([...types].some((type) => recordClasses.has(type))) return "record";
    if (types.has(`${PROV}Entity`)) return "document";
    return "other";
  });

  // the log: the snapshot chain from the manifest, and a person's judgments by their own time
  interface Snapshot {
    readonly iri: string;
    readonly file: number;
    readonly act: string | undefined;
    readonly parent: string | undefined;
    readonly setHash: string | undefined;
    readonly wrote: string[];
  }
  const snapshots = new Map<string, Snapshot>();
  loaded.forEach(({ graph }, file) => {
    for (const [subject] of graph?.match(
      undefined,
      TYPE,
      iri(`${CASCADE}Snapshot`),
    ) ?? []) {
      snapshots.set(subject.value, {
        iri: subject.value,
        file,
        act: object(graph as Graph, subject.value, `${PROV}wasGeneratedBy`)
          ?.value,
        parent: object(
          graph as Graph,
          subject.value,
          `${CASCADE}firstParentSnapshot`,
        )?.value,
        setHash: object(graph as Graph, subject.value, `${CASCADE}setHash`)
          ?.value,
        wrote: (graph as Graph)
          .objects(subject, `${CASCADE}fileAddedToSet`)
          .map(({ value }) => value)
          .sort(compare),
      });
    }
  });
  const manifest = at(layout.manifest);
  const manifestGraph = loaded[manifest]?.graph as Graph;
  const head = manifestGraph
    .match(undefined, `${PROV}used`)
    .map(([, , target]) => target.value)
    .find((value) => snapshots.has(value));
  const walked: Snapshot[] = [];
  let brokenAt: string | undefined;
  for (let next = head; next !== undefined;) {
    const found = snapshots.get(next);
    if (found === undefined) {
      brokenAt = next;
      break;
    }
    walked.unshift(found);
    next = found.parent;
  }
  const typeOf = (graph: Graph, thing: string): string | undefined => {
    const types = graph.objects(iri(thing), TYPE).map(({ value }) => value);
    return types.find((type) => type.startsWith(CASCADE)) ?? types[0];
  };
  const snapshotRows = walked.map((snapshot) => {
    const file = loaded[snapshot.file] as Held;
    const graph = file.graph as Graph;
    return {
      sort: object(graph, file.thing, `${PROV}startedAtTime`)?.value ?? "",
      snapshot,
      time: object(graph, file.thing, `${PROV}startedAtTime`)?.value,
      type: typeOf(graph, file.thing),
      label: object(graph, file.thing, `${RDFS}label`)?.value,
      informedBy: fileOf(
        object(graph, file.thing, `${PROV}wasInformedBy`)?.value ?? "",
      ),
    };
  });
  const snapshotted = new Set(walked.flatMap(({ wrote }) => wrote));
  const timed = new Map<
    string,
    { time: string; role: string | undefined; files: number[] }
  >();
  loaded.forEach(({ graph, thing }, file) => {
    const kind = kinds[file];
    if (
      graph === undefined ||
      (kind !== "judgment" && kind !== "retraction") ||
      snapshotted.has((loaded[file] as Held).path)
    )
      return;
    const time =
      object(graph, thing, `${PROV}generatedAtTime`)?.value ??
      object(graph, thing, `${PROV}startedAtTime`)?.value;
    if (time === undefined) return;
    const role = graph.match(undefined, `${PROV}hadRole`)[0]?.[2].value;
    const key = `${time}|${role ?? ""}`;
    const group = timed.get(key) ?? { time, role, files: [] };
    group.files.push(file);
    timed.set(key, group);
  });
  const rebuilt = new Set(
    loaded.flatMap(({ path }, file) =>
      layout.rebuilt.includes(path) ? [file] : [],
    ),
  );
  type Draft = Omit<ExplorerAct, "parent" | "kitSteps"> & {
    readonly snapshotParent?: string;
  };
  const drafts: Draft[] = [
    ...snapshotRows.map(
      ({ snapshot, time, type, label, informedBy }): Draft => ({
        how: "snapshot",
        ...(time === undefined ? {} : { time }),
        ...(type === undefined ? {} : { type: used.curie(type) }),
        ...(label === undefined ? {} : { label }),
        act: snapshot.file,
        snapshot: snapshot.iri,
        ...(snapshot.parent === undefined
          ? {}
          : { snapshotParent: snapshot.parent }),
        ...(snapshot.setHash === undefined
          ? {}
          : { setHash: snapshot.setHash }),
        wrote: snapshot.wrote
          .flatMap((path) => indexOf.get(path) ?? [])
          .sort((a, b) => a - b),
        missing: snapshot.wrote.filter((path) => !indexOf.has(path)),
        ...(informedBy === undefined ? {} : { informedBy }),
      }),
    ),
    ...[...timed.values()].map(({ time, role, files }): Draft => ({
      how: "time",
      time,
      ...(role === undefined ? {} : { role: used.curie(role) }),
      wrote: files.sort((a, b) => a - b),
      missing: [],
    })),
  ].sort(
    (a, b) =>
      byTime(a.time ?? "", b.time ?? "") ||
      (a.how === "snapshot" ? -1 : 1) - (b.how === "snapshot" ? -1 : 1),
  );
  const named = new Set(drafts.flatMap(({ wrote }) => wrote));
  const making: Draft = {
    how: "making",
    wrote: loaded.flatMap((_, file) =>
      named.has(file) || rebuilt.has(file) ? [] : [file],
    ),
    missing: [],
  };
  const rowsOfSnapshot = new Map<string, number>();
  [making, ...drafts].forEach((draft, row) => {
    if (draft.snapshot !== undefined) rowsOfSnapshot.set(draft.snapshot, row);
  });
  const writers: Writer[] = loaded.map(() => "build");
  [making, ...drafts].forEach(({ wrote }, row) => {
    for (const file of wrote) writers[file] = row;
  });

  // the kit
  let kit: ExplorerKit | undefined;
  let handles: Handles | undefined;
  const kitRows = new Map<string, number>();
  if (options.kit !== undefined) {
    const feature = `conformance/${options.kit}/${options.kit}.feature`;
    const times = [making, ...drafts].map(({ time }) =>
      time === undefined ? undefined : Date.parse(time),
    );
    const rowAt = (when: string): { row: number; performed: boolean } => {
      const time = Date.parse(when);
      const exact = times.indexOf(time);
      if (exact > 0) return { row: exact, performed: true };
      const first = times.find((each) => each !== undefined);
      if (first === undefined || time < first)
        return { row: 0, performed: true };
      let row = 0;
      times.forEach((each, index) => {
        if (each !== undefined && each <= time) row = index;
      });
      return { row, performed: false };
    };
    const { steps } = await featureStory(vocabulary, feature, options.newStore);
    const placed = steps.map((step) => ({ step, ...rowAt(step.when) }));
    for (const { step, row } of placed) kitRows.set(step.name, row);
    const written = await readWrittenFeature(vocabulary, feature);
    handles = await Words.handlesOf(vocabulary, `conformance/${options.kit}`);
    kit = {
      name: options.kit,
      feature,
      steps: placed.map(({ step, row, performed }) => ({
        name: step.name,
        when: step.when,
        kind: step.happened.kind,
        row,
        performed,
      })),
      cases: written.rules.flatMap((rule) =>
        rule.examples.map((example) => {
          const after = /as it stood after "(\w+)"/.exec(example.text)?.[1];
          const lens = /under the (\w+) lens/.exec(example.text)?.[1];
          const id = numberOf(rule);
          return {
            ...(id === undefined ? {} : { id }),
            rule:
              id === undefined
                ? rule.name
                : rule.name.slice(id.length + 1).trim(),
            example: example.name,
            ...(after === undefined ? {} : { after }),
            ...(lens === undefined ? {} : { lens }),
            row:
              (after === undefined ? undefined : kitRows.get(after)) ??
              drafts.length,
          };
        }),
      ),
      ...(handles === undefined ? {} : { handles }),
    };
  }
  const kitSteps = (row: number): ExplorerAct["kitSteps"] =>
    kit?.steps
      .filter((step) => step.row === row)
      .map(({ name, performed }) => ({ name, performed })) ?? [];
  const log: ExplorerAct[] = [making, ...drafts].map((draft, row) => {
    const { snapshotParent, ...rest } = draft;
    const parent =
      snapshotParent === undefined
        ? undefined
        : rowsOfSnapshot.get(snapshotParent);
    return {
      ...rest,
      ...(parent === undefined ? {} : { parent }),
      kitSteps: kitSteps(row),
    };
  });

  // matcher rules: the rows the pod states for each rule-list version, and the versions its matcher judgments were asserted under
  const versionOfJudgment = new Map<string, string>();
  const statedRows: { version: string; rule: string; hash: string }[] = [];
  loaded.forEach(({ graph, thing }, file) => {
    if (graph === undefined) return;
    if (kinds[file] === "assertion") {
      const judgment = object(
        graph,
        thing,
        `${CASCADE}assertedJudgment`,
      )?.value;
      const version = object(
        graph,
        thing,
        `${CASCADE}assertedUnderRuleListVersion`,
      )?.value;
      if (judgment !== undefined && version !== undefined)
        versionOfJudgment.set(judgment, version);
    }
    for (const [row, , version] of graph.match(
      undefined,
      `${CASCADE}rowOfRuleListVersion`,
    )) {
      const rule = object(graph, row.value, `${CASCADE}matcherRule`)?.value;
      const hash = object(graph, row.value, `${CASCADE}queryHash`)?.value;
      if (rule !== undefined && hash !== undefined)
        statedRows.push({ version: version.value, rule, hash });
    }
  });
  const { rules: matcher, at: ruleAt } = await ruleRows(
    site,
    statedRows,
    queryIndex,
  );

  // judgments
  const counts = new Map<string, boolean>();
  for (const row of site.questions.get("judgment/Whether it counts")?.rows ??
    []) {
    const [judgment, counted, happened] = [
      row.get("judgment"),
      row.get("counts"),
      row.get("happened"),
    ];
    if (
      judgment !== undefined &&
      counted !== undefined &&
      happened === undefined
    )
      counts.set(judgment.value, counted.value === "true");
  }
  const judgments = new Map<number, ExplorerJudgment>();
  // a member is its file's index where the pod holds a file for it, and else its IRI
  const keyOf = (value: string): number | string => fileOf(value) ?? value;
  const judgedKeys = new Map<number, (number | string)[]>();
  loaded.forEach(({ graph, thing }, file) => {
    if (kinds[file] !== "judgment" || graph === undefined) return;
    const verdict = object(graph, thing, `${CASCADE}verdict`)?.value;
    const justification = object(
      graph,
      thing,
      `${CASCADE}justification`,
    )?.value;
    const description = object(graph, thing, `${DCT}description`)?.value;
    const rule = object(graph, thing, `${CASCADE}matcherRule`)?.value;
    const version = versionOfJudgment.get(thing);
    const ruleRow =
      rule === undefined || version === undefined
        ? undefined
        : ruleAt.get(`${version}\n${rule}`);
    const counted = counts.get(thing);
    const heldOf = graph
      .objects(iri(thing), `${PROV}hadMember`)
      .map(({ value }) => value);
    const others = [
      ...new Set(heldOf.filter((value) => fileOf(value) === undefined)),
    ].sort(compare);
    judgedKeys.set(file, heldOf.map(keyOf));
    judgments.set(file, {
      ...(verdict === undefined ? {} : { verdict: used.curie(verdict) }),
      by: graph
        .objects(iri(thing), `${PROV}wasAttributedTo`)
        .some(({ value }) => value === `${CASCADE}CascadeMatcher`)
        ? "matcher"
        : "person",
      ...(justification === undefined
        ? {}
        : { justification: used.curie(justification) }),
      ...(description === undefined ? {} : { description }),
      members: [
        ...new Set(heldOf.flatMap((value) => fileOf(value) ?? [])),
      ].sort((a, b) => a - b),
      ...(others.length === 0 ? {} : { others }),
      ...(counted === undefined ? {} : { counts: counted }),
      ...(ruleRow === undefined ? {} : { rule: ruleRow }),
    });
  });
  const queryRules = new Map<number, number[]>();
  matcher.forEach(({ query }, row) => {
    if (query !== undefined)
      queryRules.set(query, [...(queryRules.get(query) ?? []), row]);
  });

  // views and their entries
  const entryOfRecord = new Map<number, string>();
  const views: ExplorerView[] = [];
  const viewOf = new Map<number, number>();
  const sortedBuilt = [...layout.built].sort((a, b) =>
    compare(a.file ?? "", b.file ?? ""),
  );
  for (const placement of sortedBuilt) {
    const { file, writtenBy } = placement;
    if (file === undefined || writtenBy === undefined) continue;
    const query = queryIndex.get(`${QUERIES}${writtenBy}`);
    if (query === undefined) continue;
    const index = indexOf.get(file);
    const graph = index === undefined ? undefined : loaded[index]?.graph;
    const entries: ExplorerEntry[] = [];
    if (graph !== undefined && index !== undefined && kinds[index] === "view") {
      const subjects = graph
        .match(undefined, `${CASCADE}mergedFrom`)
        .map(([subject]) => subject);
      for (const subject of new Map(
        subjects.map((each) => [each.value, each]),
      ).values()) {
        const merged = graph
          .objects(subject, `${CASCADE}mergedFrom`)
          .map(({ value }) => value);
        const members = merged.flatMap((value) => fileOf(value) ?? []);
        const others = [
          ...new Set(merged.filter((value) => fileOf(value) === undefined)),
        ].sort(compare);
        const lead = fileOf(
          object(graph, subject.value, `${CASCADE}leadMember`)?.value ?? "",
        );
        const status = fileOf(
          object(graph, subject.value, `${CASCADE}statusFrom`)?.value ?? "",
        );
        const sorted = [...new Set(members)].sort((a, b) =>
          a === lead ? -1 : b === lead ? 1 : a - b,
        );
        const nodes = graph.objects(subject, `${CASCADE}memberCurrentValues`);
        const nodeOfMember = new Map(
          nodes.flatMap((node) => {
            const of = object(
              graph,
              node.value,
              `${CASCADE}valuesOfMember`,
            )?.value;
            return of === undefined ? [] : [[keyOf(of), node] as const];
          }),
        );
        const memberKeys = [...sorted, ...others];
        const properties = new Set<string>();
        for (const from of [subject, ...nodes])
          for (const [, predicate] of graph.match(from))
            if (!STRUCTURE.has(predicate.value))
              properties.add(predicate.value);
        const cell = (from: Term | undefined, predicate: string): string =>
          from === undefined
            ? ""
            : graph
                .objects(from, predicate)
                .map((value) => valueOf(site, used, value))
                .sort(compare)
                .join(", ");
        const fields = [...properties]
          .map((predicate) => {
            const each = memberKeys.map((member) =>
              cell(nodeOfMember.get(member), predicate),
            );
            return {
              term: used.curie(predicate),
              entry: cell(subject, predicate),
              members: each,
              disagree: new Set(each.filter((value) => value !== "")).size > 1,
            };
          })
          .sort((a, b) => compare(a.term, b.term));
        const id = `${file}#${subject.value.slice(subject.value.indexOf("#") + 1)}`;
        const inEntry = new Set<number | string>(memberKeys);
        const namedIn = new Map(
          [...judgedKeys].map(([judged, keys]) => [
            judged,
            new Set(keys.filter((key) => inEntry.has(key))).size,
          ]),
        );
        const within = [...namedIn]
          .filter(([, count]) => count >= 2)
          .map(([judged]) => judged);
        const touching = [...namedIn]
          .filter(([, count]) => count === 1)
          .map(([judged]) => judged);
        for (const member of sorted) entryOfRecord.set(member, id);
        const entryPage = site.page(subject);
        entries.push({
          id,
          label: site.name(subject),
          ...(entryPage === undefined ? {} : { page: entryPage }),
          members: sorted,
          ...(others.length === 0 ? {} : { others }),
          ...(lead === undefined ? {} : { lead }),
          ...(status === undefined ? {} : { statusFrom: status }),
          fields,
          within,
          touching,
        });
      }
      entries.sort((a, b) => compare(a.label, b.label));
    }
    const kind = classOf(placement.kind);
    if (index !== undefined) viewOf.set(index, views.length);
    views.push({
      file,
      ...(index === undefined ? {} : { fileIndex: index }),
      ...(kind === undefined ? {} : { class: kind }),
      ...(placement.title === undefined ? {} : { title: placement.title }),
      query,
      statements: site.built.get(pod.address + file)?.statements ?? 0,
      entries,
    });
  }

  // names between files
  const names: Set<number>[] = loaded.map(() => new Set());
  const namedBy: Set<number>[] = loaded.map(() => new Set());
  loaded.forEach(({ graph }, file) => {
    if (
      graph === undefined ||
      kinds[file] === "view" ||
      kinds[file] === "built"
    )
      return;
    for (const [, , target] of graph.triples) {
      const found =
        target.termType === "NamedNode"
          ? fileOf(target.value)
          : target.termType === "Literal"
            ? indexOf.get(target.value)
            : undefined;
      if (found === undefined || found === file) continue;
      names[file]?.add(found);
      namedBy[found]?.add(file);
    }
  });

  // records, versions and documents
  const recordOf = (file: number): number | undefined => {
    const { graph, thing } = loaded[file] as Held;
    const of =
      object(graph as Graph, thing, `${CASCADE}revisionOf`)?.value ??
      object(graph as Graph, thing, `${PROV}specializationOf`)?.value;
    return of === undefined ? undefined : fileOf(of);
  };
  const arrivals = new Map<number, Arrival[]>();
  loaded.forEach(({ graph, thing }, file) => {
    if (kinds[file] !== "revision" || graph === undefined) return;
    const record = recordOf(file);
    if (record === undefined) return;
    const version = fileOf(
      object(graph, thing, `${CASCADE}version`)?.value ?? "",
    );
    arrivals.set(record, [
      ...(arrivals.get(record) ?? []),
      {
        revision: file,
        ...(version === undefined ? {} : { version }),
        time: object(graph, thing, `${PROV}generatedAtTime`)?.value ?? "",
      },
    ]);
  });
  const documentOfBytes = new Map<number, number>();
  loaded.forEach(({ path }, file) => {
    if (kinds[file] !== "bytes") return;
    const stem = path.slice(path.lastIndexOf("/") + 1);
    const found = loaded.findIndex(
      (other, index) =>
        kinds[index] === "document" &&
        other.path.slice(other.path.lastIndexOf("/") + 1) === `${stem}.ttl`,
    );
    if (found >= 0) documentOfBytes.set(file, found);
  });
  const handleOfRecord = new Map<number, string>();
  if (handles !== undefined) {
    // the runtime names each record from the handle's inputs as the kit's steps do; the file whose thing is that name is it
    const recordOfName = new Map<string, number>();
    const sessions: string[] = [];
    loaded.forEach(({ thing }, file) => {
      if (kinds[file] === "record") recordOfName.set(thing, file);
      if (kinds[file] === "session") sessions.push(thing);
    });
    for (const [handle, inputs] of Object.entries(handles.records ?? {})) {
      const { entry, position } = inputs;
      const named =
        typeof entry === "string" && typeof position === "number"
          ? await Promise.all(
              sessions.map((session) => enteredRecordName(session, position)),
            )
          : [
              await recordNamedByInputs(
                vocabulary,
                `conformance/${options.kit}`,
                handle,
                inputs,
              ),
            ];
      for (const name of named) {
        const file = name === undefined ? undefined : recordOfName.get(name);
        if (file !== undefined) handleOfRecord.set(file, handle);
      }
    }
  }

  // files
  const placementOf = (
    path: string,
    kind: FileKind,
    types: string[],
  ): Pick<ExplorerFile, "class" | "filedWith"> => {
    const match =
      kind === "version"
        ? layout.placements.find(
            (each) => each.filedWith === `${PROV}specializationOf`,
          )
        : kind === "revision"
          ? layout.placements.find(
              (each) => each.filedWith === `${CASCADE}revisionOf`,
            )
          : (() => {
              const here = layout.placements.filter(
                (each) =>
                  each.file === path ||
                  (each.folder !== undefined && path.startsWith(each.folder)),
              );
              return (
                here.find(
                  (each) =>
                    each.kind !== undefined && types.includes(each.kind),
                ) ?? here[0]
              );
            })();
    const cls = match?.kind === undefined ? undefined : used.curie(match.kind);
    const filed =
      match?.filedWith === undefined ? undefined : used.curie(match.filedWith);
    return {
      ...(cls === undefined ? {} : { class: cls }),
      ...(filed === undefined ? {} : { filedWith: filed }),
    };
  };
  const labelOf = (file: number): string | undefined => {
    const { path, graph, thing } = loaded[file] as Held;
    const labelled = site.name(iri(thing));
    return labelled !== thing
      ? labelled
      : graph === undefined
        ? undefined
        : (object(graph, thing, `${RDFS}label`)?.value ??
          object(graph, thing, `${DCT}title`)?.value ??
          layout.placements.find((each) => each.file === path)?.title);
  };
  // the terms each file's statements use, the ones a query's WHERE can name
  const termsOf = loaded.map(({ graph }) => {
    const found = new Set<string>();
    for (const [, predicate, object] of graph?.triples ?? [])
      for (const value of predicate.value === TYPE
        ? [object.value]
        : [predicate.value]) {
        const curie = prefixed(value);
        if (
          curie !== undefined &&
          QUERY_PREFIXES.has(curie.slice(0, curie.indexOf(":"))) &&
          !GENERIC.has(curie)
        )
          found.add(curie);
      }
    return found;
  });
  const termList = [...new Set(termsOf.flatMap((each) => [...each]))].sort(
    compare,
  );
  const termIndex = new Map(termList.map((curie, index) => [curie, index]));
  const files: ExplorerFile[] = loaded.map(
    ({ path, bytes, graph, thing }, file) => {
      const kind = kinds[file] as FileKind;
      const fileTerms = [...(termsOf[file] ?? [])]
        .map((curie) => termIndex.get(curie) as number)
        .sort((a, b) => a - b);
      const typeIris =
        graph?.objects(iri(thing), TYPE).map(({ value }) => value) ?? [];
      const placed = placementOf(path, kind, typeIris);
      const documentFile = documentOfBytes.get(file);
      const label = labelOf(documentFile ?? file);
      const page = site.page(iri(thing)) ?? site.page(iri(pod.address + path));
      const arrived = arrivals.get(file);
      const entry = entryOfRecord.get(file);
      const record =
        kind === "revision" || kind === "version" ? recordOf(file) : undefined;
      const judgment = judgments.get(file);
      const view = viewOf.get(file);
      const writtenBy = builtAt.get(path);
      const handle = handleOfRecord.get(file);
      return {
        path,
        bytes: bytes.length,
        kind,
        thing,
        ...(label === undefined || label === "" ? {} : { label }),
        types: typeIris.map((type) => used.curie(type)).sort(compare),
        writer: writers[file] as Writer,
        ...placed,
        ...(page === undefined ? {} : { page }),
        names: [...(names[file] ?? [])].sort((a, b) => a - b),
        namedBy: [...(namedBy[file] ?? [])].sort((a, b) => a - b),
        ...(fileTerms.length === 0 ? {} : { terms: fileTerms }),
        ...(handle === undefined ? {} : { handle }),
        ...(arrived === undefined
          ? {}
          : { arrivals: arrived.sort((a, b) => byTime(a.time, b.time)) }),
        ...(entry === undefined ? {} : { entry }),
        ...(record === undefined ? {} : { record }),
        ...(judgment === undefined ? {} : { judgment }),
        ...(documentFile === undefined ? {} : { document: documentFile }),
        ...(view === undefined ? {} : { view }),
        ...(writtenBy === undefined ? {} : { writtenBy }),
      };
    },
  );

  // the queries
  const queries: ExplorerQuery[] = paths.map((path, index) => {
    const text = texts.get(path) as string;
    const { form, template, where } = partsOf(text);
    const rest = path.slice(QUERIES.length).split("/");
    const name = (rest.at(-1) ?? "").replace(/\.rq$/, "");
    const ordered = order.get(path);
    const writes = layout.built.find(
      ({ writtenBy }) =>
        writtenBy !== undefined && `${QUERIES}${writtenBy}` === path,
    )?.file;
    const rules = queryRules.get(index);
    return {
      path,
      group: rest.slice(0, -1).join("/"),
      name,
      form,
      ...(path.startsWith(QUESTIONS)
        ? { question: path.slice(QUESTIONS.length, -3) }
        : {}),
      writes: termsIn(template).map((term) => used.curie(expandedTerm(term))),
      reads: termsIn(where).map((term) => used.curie(expandedTerm(term))),
      ...(ordered === undefined
        ? {}
        : { order: ordered.n, added: ordered.added }),
      ...(writes === undefined || !indexOf.has(writes)
        ? {}
        : { file: at(writes) }),
      ...(rules === undefined ? {} : { rules }),
    };
  });

  // lenses
  const lenses = [...site.answers].flatMap(([lens, answered]) => {
    const found = answered.get("pod/How many judgments count");
    return found === undefined
      ? []
      : [
          {
            lens,
            columns: found.columns,
            rows: found.rows.map((row) =>
              found.columns.map((column) => {
                const cell = row.get(column);
                return cell?.termType === "NamedNode"
                  ? used.curie(cell.value)
                  : (cell?.value ?? "");
              }),
            ),
          },
        ];
  });

  // how an app finds a view
  const triplesOf = (
    file: number,
    predicates: readonly string[],
  ): ExplorerHop["triples"] => {
    const graph = loaded[file]?.graph;
    return predicates.flatMap((predicate) =>
      (graph?.match(undefined, predicate) ?? []).map(([, , target]) => {
        const go =
          target.termType === "NamedNode" ? fileOf(target.value) : undefined;
        return {
          predicate: used.curie(predicate),
          object: target.value.startsWith(pod.address)
            ? `/${target.value.slice(pod.address.length)}`
            : target.value,
          ...(go === undefined ? {} : { go }),
        };
      }),
    );
  };
  const card = at(layout.card);
  const preferences = at(layout.preferences);
  const typeIndex = at(layout.typeIndex);
  const indexGraph = loaded[typeIndex]?.graph as Graph;
  const registrations = indexGraph
    .subjects(TYPE, iri(`${SOLID}TypeRegistration`))
    .map((registration) => {
      const target =
        object(indexGraph, registration.value, `${SOLID}instance`)?.value ??
        object(indexGraph, registration.value, `${SOLID}instanceContainer`)
          ?.value ??
        "";
      const path = target.startsWith(pod.address)
        ? target.slice(pod.address.length)
        : target;
      const title = object(
        indexGraph,
        registration.value,
        `${DCT}title`,
      )?.value;
      const cls = object(
        indexGraph,
        registration.value,
        `${SOLID}forClass`,
      )?.value;
      const file = indexOf.get(path);
      const query = builtAt.get(path);
      return {
        ...(title === undefined ? {} : { title }),
        ...(cls === undefined ? {} : { class: used.curie(cls) }),
        target: path,
        ...(file === undefined ? {} : { file }),
        ...(query === undefined ? {} : { query }),
      };
    })
    .sort((a, b) => compare(a.target, b.target));
  const chain: ExplorerHop[] = [
    {
      file: card,
      triples: triplesOf(card, [`${PIM}storage`, `${PIM}preferencesFile`]),
    },
    {
      file: preferences,
      triples: triplesOf(preferences, [
        `${SOLID}privateTypeIndex`,
        `${SOLID}publicTypeIndex`,
      ]),
    },
    { file: typeIndex, triples: [], registrations },
  ];

  const subject = loaded.findIndex((_, file) => kinds[file] === "subject");
  const created = object(
    manifestGraph,
    loaded[manifest]?.thing ?? "",
    `${DCT}created`,
  )?.value;
  const runtime = manifestGraph.match(undefined, `${RDFS}label`)[0]?.[2].value;
  const described: Record<Curie, { label?: string; comment?: string }> = {};
  for (const curie of [...used.curies].sort(compare)) {
    const [prefix, local] = curie.split(":");
    const value = expanded(prefix ?? "", local ?? "");
    if (value === undefined) continue;
    const label = site.labels.get(value);
    const comment = site.comments.get(value);
    if (label !== undefined || comment !== undefined)
      described[curie] = {
        ...(label === undefined ? {} : { label }),
        ...(comment === undefined ? {} : { comment }),
      };
  }
  return {
    version: 1,
    pod: {
      address: pod.address,
      title: pod.title,
      ...(subject < 0 ? {} : { subject: loaded[subject]?.thing as string }),
      ...(created === undefined ? {} : { created }),
      lens: options.lens,
      ...(runtime === undefined ? {} : { runtime }),
      ...(head === undefined ? {} : { head }),
      ...(brokenAt === undefined ? {} : { brokenAt }),
      manifest,
      card,
      preferences,
      typeIndex,
      ...(options.blob === undefined ? {} : { vocabularyBlob: options.blob }),
      links: {
        ...(options.front === undefined ? {} : { front: options.front }),
        ...(options.terms === undefined ? {} : { terms: options.terms }),
        ...(options.spec === undefined ? {} : { spec: options.spec }),
      },
    },
    terms: described,
    prefixes: PREFIXES,
    termList,
    placements,
    files,
    log,
    ...(kit === undefined ? {} : { kit }),
    views,
    queries,
    matcherRules: matcher,
    lenses,
    chain,
  };
}

function expandedTerm(term: string): string {
  const [prefix, local] = term.split(":");
  return expanded(prefix ?? "", local ?? "") ?? term;
}

/** `explorer.json`, and each query of the vocabulary under `queries/`, as the explorer fetches them. */
export async function explorerFiles(
  site: Site,
): Promise<Map<string, Uint8Array>> {
  const encoder = new TextEncoder();
  const files = new Map<string, Uint8Array>();
  files.set(
    EXPLORER_FILE,
    encoder.encode(JSON.stringify(await explorerData(site))),
  );
  const { vocabulary } = site.options;
  for (const path of await vocabulary.list(QUERIES)) {
    if (!path.endsWith(".rq")) continue;
    const bytes = await vocabulary.read(path);
    if (bytes !== undefined) files.set(path, bytes);
  }
  return files;
}
