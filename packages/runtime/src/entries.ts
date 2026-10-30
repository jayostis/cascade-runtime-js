import { byCodePoint, entryHash } from "./names.js";
import { iri, type Triple, written } from "./rdf.js";
import type { Dataset, Row } from "./store.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";

/** The IRI `queries/derivations/entries.rq` gives an entry, which no file holds: SPARQL cannot mint a relative IRI. */
export const ENTRY_PLACEHOLDER = "urn:cascade:entry:";

/** The derivation whose triples `entries` gives, instead of the query's closure, when its text is the one pinned here. */
export const ENTRIES = "queries/derivations/entries.rq";

/** The lower-case hex SHA-256 of the text of `entries.rq` that `entries` gives the triples of. */
const ENTRIES_TEXT =
  "18724f88b81f6aa75639fb28f3eec8fee5ebd43925630782d298f2dc0ca3e635";

const answered = new Map<string, Promise<boolean>>();

/** Whether `entries` gives the triples of the query's text: any other text, as a vocabulary changes it, is run itself. */
export function answersQuery(text: string): Promise<boolean> {
  let found = answered.get(text);
  if (found === undefined) {
    found = entryHash(text).then((hash) => hash === ENTRIES_TEXT);
    answered.set(text, found);
  }
  return found;
}

/**
 * The union-find over the terms of the rows' `?one` and `?other`, each written as N-Triples writes it: `root` gives
 * a term's component, the same for two terms a chain of rows joins, and `joined` every term no row leaves alone.
 */
export function unionFind(pairs: readonly Row[]): {
  root: (term: string) => string;
  joined: Iterable<string>;
} {
  const parent = new Map<string, string>();
  const root = (term: string): string => {
    let at = term;
    for (let up = parent.get(at); up !== undefined; up = parent.get(at))
      at = up;
    for (let on = term; on !== at;) {
      const up = parent.get(on) as string;
      parent.set(on, at);
      on = up;
    }
    return at;
  };
  const joined = new Set<string>();
  for (const row of pairs) {
    const [one, other] = [row.get("one"), row.get("other")];
    if (one === undefined || other === undefined) continue;
    const [a, b] = [root(written(one)), root(written(other))];
    joined.add(written(one)).add(written(other));
    if (a !== b) parent.set(a, b);
  }
  return { root, joined };
}

/**
 * The triples `queries/derivations/entries.rq` constructs, found by union-find over the currently-same pairs: linear in
 * the pairs, where the query's `cascade:currentlySame*` walks every entry once from each of its members (#246). The
 * derivations write `cascade:currentlySame` both ways, so what a record reaches through it is what it is joined to.
 */
export async function entries(dataset: Dataset): Promise<Triple[]> {
  const { rows: pairs } = await dataset.select(
    `SELECT ?one ?other WHERE { ?one <${CASCADE}currentlySame> ?other }`,
  );
  const { rows: kinds } = await dataset.select(
    `SELECT ?record ?kind WHERE { ?record <${CASCADE}recordKind> ?kind FILTER NOT EXISTS { ?record <${CASCADE}leftOutFor> [] } }`,
  );
  const { root } = unionFind(pairs);
  const ofKind: [record: string, group: string][] = [];
  const least = new Map<string, string>();
  for (const row of kinds) {
    const [record, kind] = [row.get("record"), row.get("kind")];
    if (record?.termType !== "NamedNode" || kind === undefined) continue;
    const group = `${root(written(record))} ${written(kind)}`;
    ofKind.push([record.value, group]);
    const was = least.get(group);
    if (was === undefined || byCodePoint(record.value, was) < 0)
      least.set(group, record.value);
  }
  const entryOf = new Map<string, string>();
  for (const [record, group] of ofKind) {
    const member = least.get(group) as string;
    const was = entryOf.get(record);
    if (was === undefined || byCodePoint(member, was) < 0)
      entryOf.set(record, member);
  }
  const hashes = new Map<string, string>();
  const triples: Triple[] = [];
  for (const [record, member] of entryOf) {
    let hash = hashes.get(member);
    if (hash === undefined) {
      hash = await entryHash(member);
      hashes.set(member, hash);
    }
    triples.push([
      iri(record),
      iri(`${CASCADE}inEntry`),
      iri(ENTRY_PLACEHOLDER + hash),
    ]);
  }
  return triples;
}
