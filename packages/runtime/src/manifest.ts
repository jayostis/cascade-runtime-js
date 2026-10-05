import { type Files, readText } from "./files.js";
import type { StoreFactory } from "./store.js";

export const MF = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#";
export const QT = "http://www.w3.org/2001/sw/DataAccess/tests/test-query#";
export const REPLAY_TEST =
  "https://ns.cascadeprotocol.org/records/v1-draft#ReplayTest";

/** One entry of a test manifest; its files are IRIs, resolved against the manifest's own. */
export interface ManifestEntry {
  readonly iri: string;
  readonly name: string;
  readonly types: readonly string[];
  readonly story?: string;
  readonly step?: string;
  readonly lens?: string;
  readonly query?: string;
  readonly result?: string;
}

const PREFIXES = `
PREFIX mf: <${MF}>
PREFIX qt: <${QT}>
PREFIX rec: <https://ns.cascadeprotocol.org/records/v1-draft#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
`;

/** Each entry the manifest at `path` lists, in its order. */
export async function readManifest(
  files: Files,
  path: string,
  newStore: StoreFactory,
): Promise<ManifestEntry[]> {
  const store = newStore();
  const manifest = files.iri + path;
  await store.loadTurtle(await readText(files, path), { graph: manifest });
  const lists = await store.select(`${PREFIXES}
    SELECT ?head ?node ?first ?rest WHERE {
      ?manifest a mf:Manifest ; mf:entries ?head . ?head rdf:rest* ?node . ?node rdf:first ?first ; rdf:rest ?rest
    }`);
  const heads = new Set(lists.rows.map((row) => row.get("head")?.value));
  if (heads.size !== 1)
    throw new Error(
      `${manifest} lists its entries ${heads.size} times, not once`,
    );
  const links = new Map(
    lists.rows.map((row) => [row.get("node")?.value, row] as const),
  );
  const order: string[] = [];
  for (
    let node = [...heads][0];
    links.has(node);
    node = links.get(node)?.get("rest")?.value
  ) {
    order.push(links.get(node)?.get("first")?.value ?? "");
  }
  const described = await store.select(`${PREFIXES}
    SELECT ?entry ?type ?name ?story ?step ?lens ?query ?result WHERE {
      ?manifest a mf:Manifest ; mf:entries/rdf:rest*/rdf:first ?entry .
      OPTIONAL { ?entry a ?type }
      OPTIONAL { ?entry mf:name ?name }
      OPTIONAL { ?entry mf:result ?result }
      OPTIONAL { ?entry mf:action ?action .
        OPTIONAL { ?action rec:story ?story } OPTIONAL { ?action rec:step ?step }
        OPTIONAL { ?action rec:lens ?lens } OPTIONAL { ?action qt:query ?query } }
    }`);
  return order.map((entry): ManifestEntry => {
    const rows = described.rows.filter(
      (row) => row.get("entry")?.value === entry,
    );
    const one = (name: string): string | undefined => {
      const values = new Set(rows.flatMap((row) => row.get(name)?.value ?? []));
      if (values.size > 1)
        throw new Error(
          `entry ${entry} has ${values.size} values of ${name}, not one`,
        );
      return [...values][0];
    };
    const types = [
      ...new Set(rows.flatMap((row) => row.get("type")?.value ?? [])),
    ].sort();
    return {
      iri: entry,
      name: one("name") ?? entry,
      types,
      story: one("story"),
      step: one("step"),
      lens: one("lens"),
      query: one("query"),
      result: one("result"),
    };
  });
}
