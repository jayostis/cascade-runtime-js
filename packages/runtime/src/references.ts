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

  async rows(version: string): Promise<Triple[]> {
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
    return this.#parse(bytes, this.#source.iri + path);
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

  /** The version of the series the pod names as current (`named`), and otherwise the one it ships with. */
  current(series: string, named: readonly string[]): string {
    const label =
      this.index.objects(iri(series), `${RDFS}label`)[0]?.value ?? series;
    const lists = (version: string | undefined): version is string =>
      version !== undefined && this.seriesOf(version) === series;
    if (named.length === 0) {
      const shipped = this.index.objects(iri(series), SHIPS_WITH)[0]?.value;
      if (!lists(shipped))
        throw new Refusal(
          `${label} ships with ${shipped}, a version it does not list`,
        );
      return shipped;
    }
    const [version, ...others] = named;
    if (others.length > 0 || !lists(version))
      throw new Refusal(
        `the pod holds no one current version the matcher knows of ${label}`,
      );
    return version;
  }
}

/** A person's reference index, `references/references.ttl` under their folder: empty when they have none. */
export async function referenceIndex(
  files: Files,
  folder: string,
  parse: (bytes: Uint8Array, base: string) => Promise<Triple[]>,
): Promise<Graph> {
  const path = `${folder}/references/references.ttl`;
  const bytes = await files.read(path);
  return new Graph(
    bytes === undefined ? [] : await parse(bytes, files.iri + path),
  );
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
