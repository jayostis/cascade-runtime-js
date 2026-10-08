import { type Files, readText } from "./files.js";
import { Graph } from "./graph.js";
import { fileStem } from "./names.js";
import { iri, RDF, type Triple } from "./rdf.js";
import { REC, Refusal } from "./step.js";
import type { StoreFactory } from "./store.js";

const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const SPECIALIZATION_OF = `${PROV}specializationOf`;
const SHIPS_WITH = `${REC}shipsWith`;
const REVISION_OF = `${PROV}wasRevisionOf`;
/** What follows a version's file stem in the name of the index of its rows by code. */
export const CODES = ".codes.json";
const RECORDS = "ontologies/records/v1-draft/records.ttl";

/** What the vocabulary says of tables: each code system's URI space, and the properties each kind's rows are found by. */
export interface TableTerms {
  readonly uriSpaces: readonly string[];
  /** By kind; `rec:RowSubject` for a row found by its own subject. */
  readonly foundBy: ReadonlyMap<string, readonly string[]>;
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
      await readText(vocabulary, RECORDS),
      vocabulary.iri + RECORDS,
    ),
  );
  const foundBy = new Map<string, string[]>();
  for (const [kind, , property] of graph.match(undefined, `${REC}foundBy`))
    foundBy.set(kind.value, [
      ...(foundBy.get(kind.value) ?? []),
      property.value,
    ]);
  return {
    uriSpaces: graph
      .subjects(`${RDF}type`, iri(`${REC}CodeSystem`))
      .flatMap((system) =>
        graph.objects(system, "http://rdfs.org/ns/void#uriSpace"),
      )
      .map(({ value }) => value),
    foundBy,
  };
}

/** The index of a version's rows by each code they are found by, built for these properties; none for none. */
export function rowsByCode(
  rows: readonly Triple[],
  foundBy: readonly string[],
): Uint8Array | undefined {
  if (foundBy.length === 0) return undefined;
  const found = new Map<string, Set<string>>();
  const add = (code: string, row: string): void => {
    found.set(code, (found.get(code) ?? new Set()).add(row));
  };
  if (foundBy.includes(`${REC}RowSubject`))
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
 * Reference tables: `references.ttl`, the index of each series and its versions, and one file per version
 * holding its rows, named from the version's name.
 */
export class References {
  readonly #source: Files;
  readonly #folder: string;
  readonly #parse: (bytes: Uint8Array, base: string) => Promise<Triple[]>;
  readonly index: Graph;

  private constructor(
    source: Files,
    folder: string,
    parse: (bytes: Uint8Array, base: string) => Promise<Triple[]>,
    index: Graph,
  ) {
    this.#source = source;
    this.#folder = folder;
    this.#parse = parse;
    this.index = index;
  }

  /** The tables in `folder` of the files, which ends in a slash or is empty. */
  static async of(
    files: Files,
    folder: string,
    newStore: StoreFactory,
  ): Promise<References> {
    const path = `${folder}references.ttl`;
    const parse = (bytes: Uint8Array, base: string): Promise<Triple[]> =>
      newStore().parse(bytes, base);
    const turtle = new TextEncoder().encode(await readText(files, path));
    return new References(
      files,
      folder,
      parse,
      new Graph(await parse(turtle, files.iri + path)),
    );
  }

  /** What the index states about a series or one of its versions, less the version a series ships with. */
  description(thing: string): Triple[] {
    return this.index
      .match(iri(thing))
      .filter(([, predicate]) => predicate.value !== SHIPS_WITH);
  }

  isVersion(name: string): boolean {
    return this.index.match(iri(name), SPECIALIZATION_OF).length > 0;
  }

  seriesOf(version: string): string | undefined {
    return this.index.objects(iri(version), SPECIALIZATION_OF)[0]?.value;
  }

  seriesOfKind(kind: string): string[] {
    return this.index
      .subjects(`${REC}tableKind`, iri(kind))
      .map(({ value }) => value)
      .sort();
  }

  kindOf(series: string): string | undefined {
    return this.index.objects(iri(series), `${REC}tableKind`)[0]?.value;
  }

  /**
   * The version's rows; given codes, and an index of its rows by code beside them (`<stem>.codes.json`, the rows
   * N-Triples) built for the properties the vocabulary gives its kind, only the rows found by those codes.
   */
  async rows(
    version: string,
    find?: { readonly codes: ReadonlySet<string>; readonly terms: TableTerms },
  ): Promise<Triple[]> {
    let stem: string;
    try {
      stem = fileStem(version);
    } catch (error) {
      throw new Refusal(
        `${this.#folder} lists ${version}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const path = `${this.#folder}${stem}.ttl`;
    const bytes = await this.#source.read(path);
    if (bytes === undefined)
      throw new Refusal(`${this.#folder} holds no rows for ${version}`);
    const found =
      find === undefined
        ? undefined
        : indexed(
            await this.#source.read(`${this.#folder}${stem}${CODES}`),
            find.terms.foundBy.get(
              this.kindOf(this.seriesOf(version) ?? "") ?? "",
            ) ?? [],
          );
    if (find === undefined || found === undefined)
      return this.#parse(bytes, this.#source.iri + path);
    const subjects = new Set(
      [...find.codes].flatMap((code) => found.get(code) ?? []),
    );
    const lines = new TextDecoder()
      .decode(bytes)
      .split("\n")
      .filter((line) => subjects.has(/^<([^>]*)>/.exec(line)?.[1] ?? ""));
    return this.#parse(
      new TextEncoder().encode(lines.join("\n")),
      this.#source.iri + path,
    );
  }

  /** The one series whose versions hold the matcher's rules. */
  async ruleList(): Promise<string> {
    const found: string[] = [];
    for (const series of this.index.subjects(
      `${RDF}type`,
      iri(`${REC}ReferenceSeries`),
    )) {
      for (const version of this.index.subjects(SPECIALIZATION_OF, series)) {
        const rows = new Graph(await this.rows(version.value));
        if (rows.subjects(`${RDF}type`, iri(`${REC}MatcherRule`)).length > 0) {
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
    const shipped = this.index.objects(iri(series), SHIPS_WITH)[0]?.value;
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
