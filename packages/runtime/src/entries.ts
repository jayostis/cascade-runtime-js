import { byCodePoint, entryHash } from "./names.js";
import { iri, type Triple, written } from "./rdf.js";
import type { Dataset } from "./store.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";

/** The IRI `queries/derivations/entries.rq` gives an entry, which no file holds: SPARQL cannot mint a relative IRI. */
export const ENTRY_PLACEHOLDER = "urn:cascade:entry:";

/** The derivation `entries` gives the triples of, instead of the query's closure. */
export const ENTRIES = "queries/derivations/entries.rq";

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
  const parent = new Map<string, string>();
  const root = (name: string): string => {
    let at = name;
    for (let up = parent.get(at); up !== undefined; up = parent.get(at))
      at = up;
    for (let on = name; on !== at;) {
      const up = parent.get(on) as string;
      parent.set(on, at);
      on = up;
    }
    return at;
  };
  for (const row of pairs) {
    const [one, other] = [row.get("one"), row.get("other")];
    if (one === undefined || other === undefined) continue;
    const [a, b] = [root(written(one)), root(written(other))];
    if (a !== b) parent.set(a, b);
  }
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
