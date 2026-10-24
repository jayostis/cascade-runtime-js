import { boundToPairs } from "./bound-records.js";
import { QUERIES } from "./derive.js";
import type { Files } from "./files.js";
import { podCodes } from "./matcher.js";
import { documentName } from "./names.js";
import { iri, type Triple } from "./rdf.js";
import { type References, tableTerms } from "./references.js";
import { CASCADE, Refusal } from "./step.js";
import type { Row, StoreFactory, Union } from "./store.js";

const COMPARISONS = `${QUERIES}matcher/`;
const DESCRIBED = "urn:cascade:kept-references";
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

const MEMBERS = `${PREFIXES}SELECT DISTINCT ?claim ?member WHERE {
  ?claim prov:wasAttributedTo cascade:CascadeMatcher ; prov:hadMember ?member .
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
  readonly members: Set<string>;
}

/**
 * The Sames M7 leaves as they were across a table version: of each matcher Same that used an older version of a series,
 * whether the query the current rule list's row for its rule names, evaluated with ?record and ?other bound to each two of its members over
 * the union and the rows the tables hold of the series' current version, joins one member to each other member by that
 * version; `cascade:membersJoinedByCurrentTableVersion` from each that it joins to the version. Rows and descriptions
 * it adds are dropped again. A version the tables do not hold joins nothing.
 */
export async function keptClaims(
  union: Union,
  options: {
    readonly vocabulary: Files;
    /** The tables, read only when some Same used an older version. */
    readonly references: () => Promise<References>;
    readonly newStore: StoreFactory;
  },
): Promise<Triple[]> {
  const { rows } = await union.select(STALE);
  if (rows.length === 0) return [];
  const { vocabulary, newStore } = options;
  const references = await options.references();
  const value = (row: Row, name: string): string => row.get(name)?.value ?? "";
  const hashes = new Map<string, string[]>();
  for (const row of (await union.select(HASHES)).rows)
    hashes.set(value(row, "rule"), [
      ...(hashes.get(value(row, "rule")) ?? []),
      value(row, "hash"),
    ]);
  const members = new Map<string, Set<string>>();
  for (const row of (await union.select(MEMBERS)).rows)
    members.set(
      value(row, "claim"),
      (members.get(value(row, "claim")) ?? new Set()).add(value(row, "member")),
    );
  const stale = new Map<string, Stale>();
  for (const row of rows) {
    const [claim, rule, now] = ["claim", "rule", "now"].map((name) =>
      value(row, name),
    ) as [string, string, string];
    if (references.seriesOf(now) === undefined) continue;
    for (const hash of hashes.get(rule) ?? [])
      stale.set(`${claim} ${now} ${hash}`, {
        claim,
        now,
        hash,
        members: members.get(claim) ?? new Set(),
      });
  }
  if (stale.size === 0) return [];
  const texts = await comparisons(vocabulary);
  const versions = [...new Set([...stale.values()].map(({ now }) => now))];
  const loaded = versions.filter((version) => !union.graphs.has(version));
  const terms = await tableTerms(vocabulary, newStore);
  const find = { codes: await podCodes(union, terms), terms };
  const described = versions.flatMap((version) => [
    ...references.description(version),
    ...references.description(references.seriesOf(version) ?? ""),
  ]);
  const held = await union.holds(described);
  try {
    for (const version of loaded)
      await union.add(await references.rows(version, find), version);
    await union.add(
      described.filter((_, at) => !held[at]),
      DESCRIBED,
    );
    const joined = new Set<string>();
    for (const hash of new Set([...stale.values()].map(({ hash }) => hash))) {
      const text = texts.get(hash);
      if (text === undefined) continue;
      const pairs = new Map<string, readonly [string, string]>();
      for (const found of stale.values())
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
            `${hash} ${value(row, "record")} ${value(row, "other")} ${value(row, "origin")}`,
          );
      }
    }
    return [...stale.values()]
      .filter(({ hash, now, members }) =>
        [...members].some((one) =>
          [...members].every(
            (other) =>
              other === one || joined.has(`${hash} ${one} ${other} ${now}`),
          ),
        ),
      )
      .map(({ claim, now }): Triple => [
        iri(claim),
        iri(MEMBERS_JOINED),
        iri(now),
      ]);
  } finally {
    for (const version of loaded) await union.drop(version);
    await union.drop(DESCRIBED);
  }
}
