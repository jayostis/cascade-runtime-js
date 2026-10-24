import { boundToPairs } from "./bound-records.js";
import { QUERIES } from "./derive.js";
import type { Files } from "./files.js";
import { podCodes } from "./matcher.js";
import { documentName } from "./names.js";
import { iri, written, type Triple } from "./rdf.js";
import { type References, tableTerms } from "./references.js";
import { CASCADE, Refusal } from "./step.js";
import type { Row, StoreFactory, Union } from "./store.js";

const COMPARISONS = `${QUERIES}matcher/`;
const DESCRIBED = "urn:cascade:kept-references:";
export const MEMBERS_JOINED = `${CASCADE}membersJoinedByCurrentTableVersion`;
/** The pairs one evaluation binds: Oxigraph's JavaScript build joins a long VALUES block in more than linear time. */
const PAIRS_AT_ONCE = 512;

const PREFIXES = `PREFIX cascade: <${CASCADE}>
PREFIX pav: <http://purl.org/pav/>
PREFIX prov: <http://www.w3.org/ns/prov#>
`;

/**
 * Each matcher Same that used a version of a series whose current version is another, its rule, and that version. Its
 * members and its rule's hash are asked apart: Oxigraph's JavaScript build joins all three patterns in quadratic time.
 */
const STALE = `${PREFIXES}SELECT DISTINCT ?claim ?rule ?now WHERE {
  ?series a cascade:ReferenceSeries ; pav:hasCurrentVersion ?now .
  ?input prov:specializationOf ?series .
  FILTER (?now != ?input)
  ?claim prov:used ?input ; prov:wasAttributedTo cascade:CascadeMatcher ; cascade:verdict cascade:Same ;
         cascade:matcherRule ?rule .
}`;

const MEMBERS = `${PREFIXES}SELECT DISTINCT ?claim ?member ?current WHERE {
  ?claim prov:wasAttributedTo cascade:CascadeMatcher ; prov:hadMember ?member .
  OPTIONAL { ?member pav:hasCurrentVersion ?current }
}`;

/** Each matcher claim with an assertion no retraction invalidates: one whose every assertion a release retracted is kept by none. */
const ASSERTED = `${PREFIXES}SELECT DISTINCT ?claim WHERE {
  ?assertion cascade:assertedClaim ?claim .
  FILTER NOT EXISTS { ?retraction prov:invalidated ?assertion }
}`;

/** The query hash each rule's row carries in the current version of a rule list. */
const HASHES = `${PREFIXES}SELECT DISTINCT ?rule ?hash WHERE {
  ?ruleList pav:hasCurrentVersion ?current .
  ?row cascade:rowOfRuleListVersion ?current ; cascade:matcherRule ?rule ; cascade:queryHash ?hash .
}`;

const comparisonsRead = new WeakMap<Files, Promise<Map<string, string>>>();

/** The vocabulary's comparisons' texts, by the name of their bytes (M11). */
function comparisons(vocabulary: Files): Promise<Map<string, string>> {
  let read = comparisonsRead.get(vocabulary);
  if (read === undefined) {
    read = (async () => {
      const found = new Map<string, string>();
      for (const path of await vocabulary.list(COMPARISONS)) {
        const bytes = path.endsWith(".rq")
          ? await vocabulary.read(path)
          : undefined;
        if (bytes !== undefined)
          found.set(await documentName(bytes), new TextDecoder().decode(bytes));
      }
      return found;
    })();
    read.catch(() => comparisonsRead.delete(vocabulary));
    comparisonsRead.set(vocabulary, read);
  }
  return read;
}

interface Stale {
  readonly claim: string;
  readonly now: string;
  readonly hash: string;
  readonly members: readonly string[];
  /** What decides the answer: the claim, the version, the query and each member's current version. */
  readonly key: string;
}

/** What M7 leaves as it was across a table version, as one read finds it. */
export interface Kept {
  /** `cascade:membersJoinedByCurrentTableVersion` from each Same its current version joins to that version. */
  readonly triples: readonly Triple[];
  /** The current versions the pod names, of series a matcher Same used another version of, that the tables lack. */
  readonly unheld: readonly string[];
}

const NONE: Kept = { triples: [], unheld: [] };

export interface KeptOptions {
  readonly vocabulary: Files;
  readonly newStore: StoreFactory;
}

let describedGraphs = 0;

/**
 * The Sames M7 leaves as they were across a table version: of each matcher Same that used an older version of a series,
 * whether the query the current rule list's row for its rule names, evaluated with ?record and ?other bound to each two
 * of its members over the union and the rows the tables hold of the series' current version, joins one member to each
 * other member by that version. A version the tables do not hold joins nothing, and is named unheld. Each answer is
 * kept by the claim, the version, the query and its members' current versions, none of which ever changes, so a later
 * read evaluates only the Sames it has not answered so.
 */
export class KeptClaims {
  readonly #options: KeptOptions;
  readonly #joined = new Map<string, boolean>();

  constructor(options: KeptOptions) {
    this.#options = options;
  }

  /** Over the union, with the tables, read only when some Same used an older version. */
  async of(union: Union, tables: () => Promise<References>): Promise<Kept> {
    const { rows } = await union.select(STALE);
    if (rows.length === 0) return NONE;
    const references = await tables();
    const value = (row: Row, name: string): string =>
      row.get(name)?.value ?? "";
    const hashes = new Map<string, string[]>();
    for (const row of (await union.select(HASHES)).rows)
      hashes.set(value(row, "rule"), [
        ...(hashes.get(value(row, "rule")) ?? []),
        value(row, "hash"),
      ]);
    const members = new Map<string, Map<string, string>>();
    for (const row of (await union.select(MEMBERS)).rows) {
      const claim = value(row, "claim");
      const of = members.get(claim) ?? new Map<string, string>();
      of.set(value(row, "member"), value(row, "current"));
      members.set(claim, of);
    }
    const asserted = new Set(
      (await union.select(ASSERTED)).rows.map((row) => value(row, "claim")),
    );
    const unheld = new Set<string>();
    const stale = new Map<string, Stale>();
    for (const row of rows) {
      const [claim, rule, now] = ["claim", "rule", "now"].map((name) =>
        value(row, name),
      ) as [string, string, string];
      if (!asserted.has(claim)) continue;
      if (references.seriesOf(now) === undefined) {
        unheld.add(now);
        continue;
      }
      const of = members.get(claim) ?? new Map<string, string>();
      const current = [...of]
        .map(([member, version]) => `${member} ${version}`)
        .sort();
      for (const hash of hashes.get(rule) ?? []) {
        const key = [claim, now, hash, ...current].join("|");
        stale.set(key, { claim, now, hash, members: [...of.keys()], key });
      }
    }
    const asked = [...stale.values()].filter(
      ({ key }) => !this.#joined.has(key),
    );
    if (asked.length > 0) await this.#ask(union, references, asked);
    const triples = new Map<string, Triple>();
    for (const { claim, now, key } of stale.values())
      if (this.#joined.get(key) === true)
        triples.set(`${claim} ${now}`, [
          iri(claim),
          iri(MEMBERS_JOINED),
          iri(now),
        ]);
    return { triples: [...triples.values()], unheld: [...unheld].sort() };
  }

  /**
   * Answers each Same, adding to the union the rows of each version that no graph of the store holds and the
   * descriptions it lacks, and dropping again only what it added.
   */
  async #ask(
    union: Union,
    references: References,
    asked: readonly Stale[],
  ): Promise<void> {
    const { vocabulary, newStore } = this.#options;
    const texts = await comparisons(vocabulary);
    const versions = [...new Set(asked.map(({ now }) => now))];
    const absent: string[] = [];
    for (const version of versions)
      if (
        !union.graphs.has(version) &&
        !(await union.store.ask(
          `ASK { GRAPH ${written(iri(version))} { ?s ?p ?o } }`,
          new Set(),
        ))
      )
        absent.push(version);
    const descriptions = versions.flatMap((version) => [
      ...references.description(version),
      ...references.description(references.seriesOf(version) ?? ""),
    ]);
    const held = await union.holds(descriptions);
    const added: string[] = [];
    try {
      if (absent.length > 0) {
        const terms = await tableTerms(vocabulary, newStore);
        const find = { codes: await podCodes(union, terms), terms };
        for (const version of absent) {
          added.push(version);
          await union.add(await references.rows(version, find), version);
        }
      }
      const graph = `${DESCRIBED}${(describedGraphs += 1)}`;
      added.push(graph);
      await union.add(
        descriptions.filter((_, at) => !held[at]),
        graph,
      );
      const joined = new Set<string>();
      for (const hash of new Set(asked.map(({ hash }) => hash))) {
        const text = texts.get(hash);
        if (text === undefined) continue;
        const pairs = new Map<string, readonly [string, string]>();
        for (const found of asked)
          if (found.hash === hash)
            for (const one of found.members)
              for (const other of found.members)
                if (one !== other) pairs.set(`${one} ${other}`, [one, other]);
        const all = [...pairs.values()];
        for (let at = 0; at < all.length; at += PAIRS_AT_ONCE) {
          let answer;
          try {
            answer = await union.select(
              boundToPairs(text, all.slice(at, at + PAIRS_AT_ONCE)),
            );
          } catch (error) {
            if (error instanceof Refusal) break;
            throw error;
          }
          for (const row of answer.rows)
            joined.add(
              [
                hash,
                ...["record", "other", "origin"].map(
                  (name) => row.get(name)?.value ?? "",
                ),
              ].join(" "),
            );
        }
      }
      for (const { hash, now, members, key } of asked)
        this.#joined.set(
          key,
          members.some((one) =>
            members.every(
              (other) =>
                other === one || joined.has(`${hash} ${one} ${other} ${now}`),
            ),
          ),
        );
    } finally {
      for (const graph of added) await union.drop(graph);
    }
  }
}

/** The triples a `KeptClaims` of its own gives over the union. */
export async function keptClaims(
  union: Union,
  options: KeptOptions & { readonly references: () => Promise<References> },
): Promise<readonly Triple[]> {
  return (await new KeptClaims(options).of(union, options.references)).triples;
}
