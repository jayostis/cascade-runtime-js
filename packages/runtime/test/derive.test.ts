import assert from "node:assert/strict";
import { test } from "node:test";
import { Derivations } from "../src/derive.js";
import { MemoryFiles } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, literal, type Triple, written } from "../src/rdf.js";
import { Union } from "../src/store.js";

const P = "urn:test:p";
const triple = (subject: string, object: string): Triple => [
  iri(subject),
  iri(P),
  literal(object),
];
const rows = (triples: readonly Triple[]): string[] =>
  triples.map((t) => t.map(written).join(" "));
const construct = (...objects: string[]): string =>
  `CONSTRUCT { ${objects.map((o) => `<urn:test:a> <${P}> "${o}" .`).join(" ")} } WHERE {}`;
const NEVER = `CONSTRUCT { ?s <urn:test:never> ?o } WHERE { ?s <urn:test:none> ?o }`;

/** A store whose CONSTRUCT answers every triple twice, as a store need not deduplicate. */
class Repeating extends OxigraphStore {
  override async construct(
    query: string,
    union: ReadonlySet<string>,
  ): Promise<Triple[]> {
    const triples = await super.construct(query, union);
    return [...triples, ...triples];
  }
}

async function derivedBy(
  derivations: string[],
  asserted: Triple[],
  store: OxigraphStore = new OxigraphStore(),
): Promise<string[][]> {
  const vocabulary = new MemoryFiles("urn:test:vocabulary/");
  const enc = new TextEncoder();
  const graph = derivations.map((_, at) => ({
    "@id": `queries/derivations/${at}.rq`,
    position: at,
  }));
  await vocabulary.write(
    "ro-crate-metadata.json",
    enc.encode(
      JSON.stringify({
        "@graph": [
          ...graph,
          { "@id": "queries/lenses/l.rq", position: 99 },
        ],
      }),
    ),
  );
  for (const [at, query] of derivations.entries())
    await vocabulary.write(
      `queries/derivations/${at}.rq`,
      enc.encode(query),
    );
  await vocabulary.write("queries/lenses/l.rq", enc.encode(NEVER));
  const union = new Union(store);
  await union.add(asserted, "urn:test:asserted");
  const steps = await (await Derivations.of(vocabulary)).derive(union, "l");
  return steps.slice(0, derivations.length).map((s) => rows(s.added));
}

test("a triple both asserted and constructed is not derived again", async () => {
  assert.deepEqual(
    await derivedBy([construct("1", "2")], [triple("urn:test:a", "1")]),
    [rows([triple("urn:test:a", "2")])],
  );
});

test("a triple a CONSTRUCT answers twice is derived once", async () => {
  assert.deepEqual(await derivedBy([construct("1")], [], new Repeating()), [
    rows([triple("urn:test:a", "1")]),
  ]);
});

test("a triple an earlier derivation added is not derived again", async () => {
  assert.deepEqual(await derivedBy([construct("1"), construct("1", "2")], []), [
    rows([triple("urn:test:a", "1")]),
    rows([triple("urn:test:a", "2")]),
  ]);
});
