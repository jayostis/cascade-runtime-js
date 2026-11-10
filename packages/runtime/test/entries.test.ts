import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { Derivations } from "../src/derive.js";
import { answersQuery, ENTRIES, entries } from "../src/entries.js";
import { MemoryFiles, readText } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, literal, type Triple, written } from "../src/rdf.js";
import { Union } from "../src/store.js";
import { random } from "./random.js";
import { vocabulary } from "./vocabulary.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const SEEDS = Number(process.env["CASCADE_RANDOM_SEEDS"] ?? 8);
const FIRST_SEED = Number(process.env["CASCADE_RANDOM_FIRST_SEED"] ?? 1);

/**
 * Records of two kinds, some left out, some of both kinds, and things of none, joined both ways as the derivations
 * write currentlySame: chains and stars of 2 to 20, and pairs drawn at random across them, so an entry reaches its
 * members through records left out, of the other kind or of none.
 */
function drawn(seed: number, size: number): Triple[] {
  const draw = random(seed);
  const name = (at: number) =>
    `urn:uuid:${(at * 2654435761 + seed).toString(16).padStart(8, "0")}-${at}`;
  const triples: Triple[] = [];
  const same = (a: number, b: number) =>
    triples.push(
      [iri(name(a)), iri(`${CASCADE}currentlySame`), iri(name(b))],
      [iri(name(b)), iri(`${CASCADE}currentlySame`), iri(name(a))],
    );
  for (let at = 0; at < size; at++) {
    const kinds =
      draw() < 0.05
        ? []
        : draw() < 0.03
          ? ["Allergy", "Condition"]
          : [draw() < 0.5 ? "Allergy" : "Condition"];
    for (const kind of kinds)
      triples.push([iri(name(at)), iri(`${CASCADE}recordKind`), literal(kind)]);
    if (draw() < 0.1)
      triples.push([
        iri(name(at)),
        iri(`${CASCADE}leftOutFor`),
        iri(`${CASCADE}SomeReason`),
      ]);
  }
  for (let at = 0; at < size;) {
    const length = 2 + Math.floor(draw() * 19);
    if (draw() < 0.6) {
      at += 1;
      continue;
    }
    const star = draw() < 0.5;
    for (let k = 1; k < length && at + k < size; k++)
      same(star ? at : at + k - 1, at + k);
    at += length;
  }
  for (let k = 0; k < size / 20; k++)
    same(Math.floor(draw() * size), Math.floor(draw() * size));
  return triples;
}

/** The entries of the triples as `entries` finds them, and as the vocabulary's `entries.rq` constructs them, each as sorted lines. */
async function both(triples: readonly Triple[]): Promise<[string[], string[]]> {
  const union = new Union(new OxigraphStore());
  await union.add(triples, "urn:test:pod");
  const query = await readText(await vocabulary(), ENTRIES);
  const lines = (found: readonly Triple[]) =>
    found.map((triple) => triple.map(written).join(" ")).sort();
  return [lines(await entries(union)), lines(await union.construct(query))];
}

/** A store that counts the CONSTRUCTs it answers. */
class Counting extends OxigraphStore {
  constructs = 0;
  override construct(
    query: string,
    union: ReadonlySet<string>,
  ): Promise<Triple[]> {
    this.constructs += 1;
    return super.construct(query, union);
  }
}

/** What the derivations give over a random pod with `text` as entries.rq, and how many CONSTRUCTs they ran. */
async function derivedWith(
  text: string,
): Promise<{ lines: string[]; constructs: number }> {
  const files = new MemoryFiles("urn:test:vocabulary/");
  const encoded = new TextEncoder();
  await files.write(
    "ro-crate-metadata.json",
    encoded.encode(
      JSON.stringify({
        "@graph": [
          { "@id": ENTRIES, position: 1 },
          { "@id": "queries/lenses/l.rq", position: 2 },
        ],
      }),
    ),
  );
  await files.write(ENTRIES, encoded.encode(text));
  await files.write(
    "queries/lenses/l.rq",
    encoded.encode(
      "CONSTRUCT { ?s <urn:test:never> ?o } WHERE { ?s <urn:test:none> ?o }",
    ),
  );
  const store = new Counting();
  const union = new Union(store);
  await union.add(drawn(FIRST_SEED, 50), "urn:test:pod");
  const [step] = await (await Derivations.of(files)).derive(union, "l");
  return {
    lines: (step?.added ?? [])
      .map((triple) => triple.map(written).join(" "))
      .sort(),
    constructs: store.constructs,
  };
}

describe("Deriving a pod's state with the vocabulary's queries · Derivations.derive(), entries()", () => {
  describe("entries(dataset)", () => {
    it("returns the triples `entries.rq` constructs, on seeded random pods of 400 records", async () => {
      for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
        const [found, constructed] = await both(drawn(seed, 400));
        assert.ok(constructed.length > 300, `seed ${seed}`);
        assert.deepEqual(found, constructed, `seed ${seed}`);
      }
    });

    it("returns the one entry `entries.rq` gives a chain of 300 records", async () => {
      const chain: Triple[] = [];
      const member = (at: number) => iri(`urn:uuid:chain-${(at * 7919) % 300}`);
      for (let at = 0; at < 300; at++) {
        chain.push([
          member(at),
          iri(`${CASCADE}recordKind`),
          literal("Allergy"),
        ]);
        if (at > 0)
          chain.push(
            [member(at - 1), iri(`${CASCADE}currentlySame`), member(at)],
            [member(at), iri(`${CASCADE}currentlySame`), member(at - 1)],
          );
      }
      const [found, constructed] = await both(chain);
      assert.equal(new Set(found.map((line) => line.split(" ")[2])).size, 1);
      assert.deepEqual(found, constructed);
    });
  });

  describe("given an `entries.rq` whose text is not the one `entries` was written for", () => {
    let text: string;
    let changed: string;
    let answered: boolean;
    let pinned: { lines: string[]; constructs: number };
    let run: { lines: string[]; constructs: number };

    before(async () => {
      text = await readText(await vocabulary(), ENTRIES);
      changed = text.replace("MIN(STR(?m))", "MAX(STR(?m))");
      answered = await answersQuery(changed);
      pinned = await derivedWith(text);
      run = await derivedWith(changed);
    });

    it("runs the query as it is written", () => {
      assert.notEqual(changed, text);
      assert.equal(answered, false);
      assert.equal(run.constructs, 2);
      assert.notDeepEqual(run.lines, pinned.lines);
    });
  });

  /**
   * Red means the vocabulary changed `entries.rq`. The pod is still right, because the changed query runs as it is
   * written, but slowly (#246), until `entries()` is checked against the new text and `ENTRIES_TEXT` in `src/entries.ts`
   * is set to the new text's hash.
   */
  describe("given the vocabulary's own `entries.rq` (tripwire)", () => {
    let answered: boolean;
    let pinned: { lines: string[]; constructs: number };

    before(async () => {
      const text = await readText(await vocabulary(), ENTRIES);
      answered = await answersQuery(text);
      pinned = await derivedWith(text);
    });

    it("returns its triples through `entries`, without running it", () => {
      assert.ok(answered);
      assert.equal(pinned.constructs, 1);
      assert.ok(pinned.lines.length > 0);
    });
  });
});
