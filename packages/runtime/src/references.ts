import { type Files, readText } from "./files.js";
import { Graph } from "./graph.js";
import { fileStem } from "./names.js";
import { iri, RDF, type Triple } from "./rdf.js";
import { inStory, REC, Refusal, type StepContext } from "./step.js";

const PROV = "http://www.w3.org/ns/prov#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const FOLDER = "scripted-input/references/";
const SPECIALIZATION_OF = `${PROV}specializationOf`;
const SHIPS_WITH = `${REC}shipsWith`;

/**
 * A story's reference tables: `references.ttl`, the index of each series and its versions, and one file per version
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

  static async of(context: StepContext): Promise<References> {
    const folder = inStory(context, FOLDER);
    const path = `${folder}references.ttl`;
    const parse = (bytes: Uint8Array, base: string): Promise<Triple[]> =>
      context.newStore().parse(bytes, base);
    const turtle = new TextEncoder().encode(
      await readText(context.source, path),
    );
    return new References(
      context.source,
      folder,
      parse,
      new Graph(await parse(turtle, context.source.iri + path)),
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

  async rows(version: string): Promise<Triple[]> {
    const path = `${this.#folder}${fileStem(version)}.ttl`;
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
