import { type Files, readText } from "./files.js";
import { Graph } from "./graph.js";
import { fileStem } from "./names.js";
import { iri, RDF, type Triple } from "./rdf.js";
import { CASCADE, Refusal } from "./step.js";
import type { StoreFactory } from "./store.js";

const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const VOID = "http://rdfs.org/ns/void#";
const SPECIALIZATION_OF = `${PROV}specializationOf`;
const DEFAULT_TABLE_VERSION = `${CASCADE}defaultTableVersion`;
const REVISION_OF = `${PROV}wasRevisionOf`;
const RULE_DECLARED_WRONG = `${CASCADE}matcherRuleDeclaredWrong`;
/** What follows a version's file stem in the name of the index of its rows by code. */
export const CODES = ".codes.json";
const ONTOLOGY = "ontologies/cascade.ttl";
/** Where the vocabulary keeps the versions of its rule list, which a folder of tables may leave to it. */
export const RULE_LIST = "runtime/rule-list/";

/** A code system the vocabulary registers: its codes are IRIs, its `uriSpace` followed by the code. */
export interface CodeSystem {
  readonly iri: string;
  readonly label: string;
  readonly uriSpace: string;
  /** Where a code's own page is at the publisher: an address with `{code}` for the code after the `uriSpace`. */
  readonly pageTemplate?: string;
}

/** What the vocabulary says of tables: each code system, and the properties each kind's rows are found by. */
export interface TableTerms {
  readonly codeSystems: readonly CodeSystem[];
  readonly uriSpaces: readonly string[];
  /** By kind; `cascade:RowSubject` for a row found by its own subject. */
  readonly foundBy: ReadonlyMap<string, readonly string[]>;
  /** The kinds the vocabulary declares, `a cascade:TableKind`: a series of any other kind is retired. */
  readonly declared: ReadonlySet<string>;
  /** The kinds the vocabulary marks `cascade:readByAppPages true`: an app keeps their series though no rule reads the kind. */
  readonly readByPages: ReadonlySet<string>;
}

const termsRead = new WeakMap<Files, Promise<TableTerms>>();

export function tableTerms(
  vocabulary: Files,
  newStore: StoreFactory,
): Promise<TableTerms> {
  let read = termsRead.get(vocabulary);
  if (read === undefined) {
    read = readTableTerms(vocabulary, newStore);
    read.catch(() => termsRead.delete(vocabulary));
    termsRead.set(vocabulary, read);
  }
  return read;
}

async function readTableTerms(
  vocabulary: Files,
  newStore: StoreFactory,
): Promise<TableTerms> {
  const graph = new Graph(
    await newStore().parse(
      await readText(vocabulary, ONTOLOGY),
      vocabulary.iri + ONTOLOGY,
    ),
  );
  const foundBy = new Map<string, string[]>();
  for (const [kind, , property] of graph.match(undefined, `${CASCADE}foundBy`))
    foundBy.set(kind.value, [
      ...(foundBy.get(kind.value) ?? []),
      property.value,
    ]);
  const codeSystems = graph
    .subjects(`${RDF}type`, iri(`${CASCADE}CodeSystem`))
    .map((system): CodeSystem => {
      const label = graph.objects(system, `${RDFS}label`)[0];
      const space = graph.objects(system, `${VOID}uriSpace`)[0];
      if (label === undefined || space === undefined)
        throw new Error(
          `${system.value} is a code system with no ${label === undefined ? "label" : "URI space"}`,
        );
      const template = graph.objects(
        system,
        `${CASCADE}codePageUrlTemplate`,
      )[0];
      if (template !== undefined && !template.value.includes("{code}"))
        throw new Error(
          `${system.value} is a code system whose page template has no {code}`,
        );
      return {
        iri: system.value,
        label: label.value,
        uriSpace: space.value,
        ...(template && { pageTemplate: template.value }),
      };
    });
  const declared = new Set(
    graph
      .subjects(`${RDF}type`, iri(`${CASCADE}TableKind`))
      .map(({ value }) => value),
  );
  return {
    codeSystems,
    uriSpaces: codeSystems.map(({ uriSpace }) => uriSpace),
    foundBy,
    declared,
    readByPages: new Set(
      graph
        .match(undefined, `${CASCADE}readByAppPages`)
        .filter(([, , marked]) => marked.value === "true")
        .map(([kind]) => kind.value),
    ),
  };
}

const ROW_SUBJECT = `${CASCADE}RowSubject`;

/** Whether a kind's rows are found by their own subjects alone: the code is the subject, so no index is needed. */
function bySubjectAlone(foundBy: readonly string[]): boolean {
  return foundBy.length > 0 && foundBy.every((each) => each === ROW_SUBJECT);
}

/**
 * The index of a version's rows by each code they are found by, built for these properties; none for none, and none
 * for rows found by their own subjects alone, which canonical rows find by halving.
 */
export function rowsByCode(
  rows: readonly (readonly [
    { readonly value: string },
    { readonly value: string },
    { readonly value: string },
  ])[],
  foundBy: readonly string[],
): Uint8Array | undefined {
  if (foundBy.length === 0 || bySubjectAlone(foundBy)) return undefined;
  const found = new Map<string, Set<string>>();
  const add = (code: string, row: string): void => {
    found.set(code, (found.get(code) ?? new Set()).add(row));
  };
  if (foundBy.includes(ROW_SUBJECT))
    for (const [subject] of rows) add(subject.value, subject.value);
  for (const [subject, predicate, object] of rows)
    if (foundBy.includes(predicate.value)) add(object.value, subject.value);
  return new TextEncoder().encode(
    JSON.stringify({
      foundBy: [...foundBy].sort(),
      rows: Object.fromEntries(
        [...found].map(([code, subjects]) => [code, [...subjects].sort()]),
      ),
    }),
  );
}

/** An index `rowsByCode` wrote for these properties; none when it is missing, unreadable or built for others. */
function indexed(
  bytes: Uint8Array | undefined,
  foundBy: readonly string[],
): ReadonlyMap<string, readonly string[]> | undefined {
  if (bytes === undefined) return undefined;
  try {
    const index = JSON.parse(new TextDecoder().decode(bytes)) as {
      foundBy: unknown;
      rows: Record<string, unknown>;
    };
    const rows = new Map(Object.entries(index.rows));
    return JSON.stringify(index.foundBy) ===
      JSON.stringify([...foundBy].sort()) &&
      [...rows.values()].every(
        (subjects) =>
          Array.isArray(subjects) &&
          subjects.every((subject) => typeof subject === "string"),
      )
      ? (rows as Map<string, string[]>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The lines of a subject in a version's N-Triples, found by halving: the lines are sorted, so a subject's are together.
 * The core relies on rows being in canonical order wherever a `.codes.json` exists or the references are `canonical`:
 * an index is only ever written beside rows in that order (`rowsOf` refuses any other), and a folder with unsorted rows
 * read so would lose rows silently.
 */
export function linesAbout(text: string, subject: string): string[] {
  const prefix = `<${subject}> `;
  let [low, high] = [0, text.length];
  while (low < high) {
    const start = text.lastIndexOf("\n", ((low + high) >> 1) - 1) + 1;
    if (text.slice(start, start + prefix.length) < prefix) {
      const end = text.indexOf("\n", start);
      low = end < 0 ? text.length : end + 1;
    } else high = start;
  }
  const lines: string[] = [];
  for (let at = low; text.startsWith(prefix, at);) {
    const end = text.indexOf("\n", at);
    lines.push(text.slice(at, end < 0 ? text.length : end));
    at = end < 0 ? text.length : end + 1;
  }
  return lines;
}

/**
 * Reference tables: `references.ttl`, the index of each series and its versions, and one file per version
 * holding its rows, named from the version's name.
 */
export class References {
  readonly #source: Files;
  readonly #folder: string;
  readonly #vocabulary: Files | undefined;
  readonly #parse: (bytes: Uint8Array, base: string) => Promise<Triple[]>;
  readonly #canonical: boolean;
  readonly #texts = new Map<string, Promise<string>>();
  readonly #indexes = new Map<
    string,
    Promise<ReadonlyMap<string, readonly string[]> | undefined>
  >();
  readonly index: Graph;

  private constructor(
    source: Files,
    folder: string,
    vocabulary: Files | undefined,
    parse: (bytes: Uint8Array, base: string) => Promise<Triple[]>,
    canonical: boolean,
    index: Graph,
  ) {
    this.#source = source;
    this.#folder = folder;
    this.#vocabulary = vocabulary;
    this.#parse = parse;
    this.#canonical = canonical;
    this.index = index;
  }

  /**
   * The tables in `folder` of the files, which ends in a slash or is empty. Given the vocabulary, a version the
   * folder holds no file for is read from the vocabulary's rule list, if that holds one. `canonical` states that every
   * version's rows in the folder are N-Triples, a line each, in canonical order, as a check keeps them; a version from elsewhere, such as the
   * vocabulary's rule list, is told by its first character and parsed whole if it is Turtle.
   */
  static async of(
    files: Files,
    folder: string,
    newStore: StoreFactory,
    vocabulary?: Files,
    options?: { readonly canonical?: boolean },
  ): Promise<References> {
    const path = `${folder}references.ttl`;
    const parse = (bytes: Uint8Array, base: string): Promise<Triple[]> =>
      newStore().parse(bytes, base);
    const turtle = new TextEncoder().encode(await readText(files, path));
    return new References(
      files,
      folder,
      vocabulary,
      parse,
      options?.canonical ?? false,
      new Graph(await parse(turtle, files.iri + path)),
    );
  }

  /** What the index states about a series or one of its versions, less the version a series ships with. */
  description(thing: string): Triple[] {
    return this.index
      .match(iri(thing))
      .filter(([, predicate]) => predicate.value !== DEFAULT_TABLE_VERSION);
  }

  /**
   * What a pod states of a series or a version: its description, and, of a rule list version, each of its rows, named
   * `<version>#<the local name of its rule term>`, by the version it is a row of, its rule and its query hash (M8).
   */
  async podDescription(thing: string): Promise<Triple[]> {
    const described = this.description(thing);
    const series = this.seriesOf(thing);
    if (series === undefined || this.kindOf(series) !== undefined)
      return described;
    const rows = new Graph(await this.rows(thing));
    const found: Triple[] = [];
    for (const row of rows.subjects(
      `${RDF}type`,
      iri(`${CASCADE}RuleListRow`),
    )) {
      const [rule] = rows.objects(row, `${CASCADE}matcherRule`);
      const [hash] = rows.objects(row, `${CASCADE}queryHash`);
      if (rule === undefined || hash === undefined) continue;
      const named = iri(`${thing}#${rule.value.replace(/^.*[#/]/, "")}`);
      found.push(
        [named, iri(`${CASCADE}rowOfRuleListVersion`), iri(thing)],
        [named, iri(`${CASCADE}matcherRule`), iri(rule.value)],
        [named, iri(`${CASCADE}queryHash`), iri(hash.value)],
      );
    }
    return [...described, ...found];
  }

  isVersion(name: string): boolean {
    return this.index.match(iri(name), SPECIALIZATION_OF).length > 0;
  }

  seriesOf(version: string): string | undefined {
    return this.index.objects(iri(version), SPECIALIZATION_OF)[0]?.value;
  }

  seriesOfKind(kind: string): string[] {
    return this.index
      .subjects(`${CASCADE}tableKind`, iri(kind))
      .map(({ value }) => value)
      .sort();
  }

  kindOf(series: string): string | undefined {
    return this.index.objects(iri(series), `${CASCADE}tableKind`)[0]?.value;
  }

  /**
   * The version's rows; given codes, only the rows found by those codes: by halving the rows for the codes themselves
   * when the references are canonical and its kind's rows are found by their own subjects alone, and otherwise by an
   * index of its rows by code beside them (`<stem>.codes.json`, the rows N-Triples) built for the properties the
   * vocabulary gives its kind.
   */
  async rows(
    version: string,
    find?: { readonly codes: ReadonlySet<string>; readonly terms: TableTerms },
  ): Promise<Triple[]> {
    const stem = this.#stem(version);
    const path = `${this.#folder}${stem}.ttl`;
    const subjects =
      find === undefined ? undefined : await this.#subjects(version, find);
    if (subjects !== undefined) {
      const text = await this.text(version);
      const lines = [...subjects]
        .sort((a, b) => (`<${a}> ` < `<${b}> ` ? -1 : 1))
        .flatMap((subject) => linesAbout(text, subject));
      return this.#parse(
        new TextEncoder().encode(lines.join("\n")),
        this.#source.iri + path,
      );
    }
    const bytes = await this.#source.read(path);
    if (bytes === undefined && this.#vocabulary !== undefined) {
      const shared = `${RULE_LIST}${stem}.ttl`;
      const rules = await this.#vocabulary.read(shared);
      if (rules !== undefined)
        return this.#parse(rules, this.#vocabulary.iri + shared);
    }
    if (bytes === undefined)
      throw new Refusal(`${this.#folder} holds no rows for ${version}`);
    return this.#parse(bytes, this.#source.iri + path);
  }

  #stem(version: string): string {
    try {
      return fileStem(version);
    } catch (error) {
      throw new Refusal(
        `${this.#folder} lists ${version}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** The subjects of the version's rows the codes find; none when they can be found only by reading every row. */
  async #subjects(
    version: string,
    find: { readonly codes: ReadonlySet<string>; readonly terms: TableTerms },
  ): Promise<ReadonlySet<string> | undefined> {
    const foundBy =
      find.terms.foundBy.get(this.kindOf(this.seriesOf(version) ?? "") ?? "") ??
      [];
    if (this.#canonical && bySubjectAlone(foundBy)) {
      const text = await this.text(version);
      if (text === "" || text.startsWith("<")) return find.codes;
    }
    const found = await this.codes(version, foundBy);
    return found === undefined
      ? undefined
      : new Set([...find.codes].flatMap((code) => found.get(code) ?? []));
  }

  /** A version's N-Triples, read once: a version's rows never change. A missing file is refused, and not remembered. */
  text(version: string): Promise<string> {
    const stem = this.#stem(version);
    let text = this.#texts.get(stem);
    if (text === undefined) {
      text = (async () => {
        const bytes = await this.#source.read(`${this.#folder}${stem}.ttl`);
        if (bytes === undefined)
          throw new Refusal(`${this.#folder} holds no rows for ${version}`);
        return new TextDecoder().decode(bytes);
      })();
      this.#texts.set(stem, text);
      const kept = text;
      text.catch(() => {
        if (this.#texts.get(stem) === kept) this.#texts.delete(stem);
      });
    }
    return text;
  }

  /**
   * The subjects each code finds in a version, by the index beside its rows built for these properties, read once;
   * none when there is no index for them, which is not remembered, so one written later is found.
   */
  codes(
    version: string,
    foundBy: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]> | undefined> {
    const stem = this.#stem(version);
    const key = `${stem} ${JSON.stringify([...foundBy].sort())}`;
    let found = this.#indexes.get(key);
    if (found === undefined) {
      found = this.#source
        .read(`${this.#folder}${stem}${CODES}`)
        .then((bytes) => indexed(bytes, foundBy));
      this.#indexes.set(key, found);
      const kept = found;
      const forget = (): void => {
        if (this.#indexes.get(key) === kept) this.#indexes.delete(key);
      };
      found.then((each) => each === undefined && forget(), forget);
    }
    return found;
  }

  /** The one series whose versions hold the matcher's rules. */
  async ruleList(): Promise<string> {
    const found: string[] = [];
    for (const series of this.index.subjects(
      `${RDF}type`,
      iri(`${CASCADE}ReferenceSeries`),
    )) {
      if (this.kindOf(series.value) !== undefined) continue;
      for (const version of this.index.subjects(SPECIALIZATION_OF, series)) {
        const rows = new Graph(await this.rows(version.value));
        if (
          rows.subjects(`${RDF}type`, iri(`${CASCADE}RuleListRow`)).length > 0
        ) {
          found.push(series.value);
          break;
        }
      }
    }
    const [series, ...others] = found;
    if (series === undefined || others.length > 0)
      throw new Refusal(
        `${this.#folder} holds ${found.length} rule lists, not one`,
      );
    return series;
  }

  /** The matcher rules a rule list version, a release, declares wrong (N15). */
  rulesDeclaredWrong(version: string): string[] {
    return this.index
      .objects(iri(version), RULE_DECLARED_WRONG)
      .map(({ value }) => value);
  }

  /** Whether any version these tables describe declares a rule wrong. */
  declareARuleWrong(): boolean {
    return this.index.match(undefined, RULE_DECLARED_WRONG).length > 0;
  }

  /** The version this one revises, if any. */
  revisionOf(version: string): string | undefined {
    return this.index.objects(iri(version), REVISION_OF)[0]?.value;
  }

  /** Every version a version of these tables revises. */
  revised(): Set<string> {
    return new Set(
      this.index
        .match(undefined, REVISION_OF)
        .map(([, , earlier]) => earlier.value),
    );
  }

  /** The series' default (M10): the version it ships with. */
  fallback(series: string): string {
    const shipped = this.index.objects(iri(series), DEFAULT_TABLE_VERSION)[0]
      ?.value;
    if (shipped === undefined || this.seriesOf(shipped) !== series)
      throw new Refusal(
        `${this.#label(series)} ships with ${shipped}, a version it does not list`,
      );
    return shipped;
  }

  /**
   * The version of the series the pod names as current (`named`), and otherwise its default; none when the pod names
   * a version these tables do not list (O2).
   */
  current(series: string, named: readonly string[]): string | undefined {
    const [version, ...others] = named;
    if (version === undefined) return this.fallback(series);
    if (others.length > 0)
      throw new Refusal(
        `the pod holds ${named.length} current versions of ${this.#label(series)}, not one`,
      );
    return this.seriesOf(version) === series ? version : undefined;
  }

  #label(series: string): string {
    return this.index.objects(iri(series), `${RDFS}label`)[0]?.value ?? series;
  }
}

/**
 * A person's reference indexes as one: `references/references.ttl` under their folder and each tables folder's under
 * `tables/`; empty when they have none.
 */
export async function referenceIndex(
  files: Files,
  folder: string,
  parse: (bytes: Uint8Array, base: string) => Promise<Triple[]>,
): Promise<Graph> {
  const tables = await files.list(`${folder}/tables/`);
  const triples: Triple[] = [];
  for (const path of [
    `${folder}/references/references.ttl`,
    ...tables.filter((path) => path.endsWith("/references.ttl")),
  ]) {
    const bytes = await files.read(path);
    if (bytes !== undefined)
      triples.push(...(await parse(bytes, files.iri + path)));
  }
  return new Graph(triples);
}

/** The versions the index numbers so (`pav:version`) of the series so labelled. */
export function versionsNumbered(
  index: Graph,
  label: string,
  version: string,
): string[] {
  return index
    .subjects(`${RDFS}label`)
    .filter(
      (series) => index.objects(series, `${RDFS}label`)[0]?.value === label,
    )
    .flatMap((series) => index.subjects(SPECIALIZATION_OF, series))
    .filter(
      (found) => index.objects(found, `${PAV}version`)[0]?.value === version,
    )
    .map(({ value }) => value);
}
