import assert from "node:assert/strict";
import { test } from "node:test";
import { ENTRIES, entries } from "../src/entries.js";
import { readText } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, literal, type Triple, written } from "../src/rdf.js";
import { Union } from "../src/store.js";
import { vocabulary } from "./vocabulary.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const SEEDS = Number(process.env["CASCADE_RANDOM_SEEDS"] ?? 8);
const FIRST_SEED = Number(process.env["CASCADE_RANDOM_FIRST_SEED"] ?? 1);

/** Mulberry32: the same seed draws the same pod. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

async function both(triples: readonly Triple[]): Promise<[string[], string[]]> {
  const union = new Union(new OxigraphStore());
  await union.add(triples, "urn:test:pod");
  const query = await readText(await vocabulary(), ENTRIES);
  const lines = (found: readonly Triple[]) =>
    found.map((triple) => triple.map(written).join(" ")).sort();
  return [lines(await entries(union)), lines(await union.construct(query))];
}

test("the union-find gives the entries entries.rq constructs, on seeded random pods", async () => {
  for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
    const [found, constructed] = await both(drawn(seed, 400));
    assert.ok(constructed.length > 300, `seed ${seed}`);
    assert.deepEqual(found, constructed, `seed ${seed}`);
  }
});

test("the union-find gives entries.rq's one entry of a chain of 300 members", async () => {
  const chain: Triple[] = [];
  const member = (at: number) => iri(`urn:uuid:chain-${(at * 7919) % 300}`);
  for (let at = 0; at < 300; at++) {
    chain.push([member(at), iri(`${CASCADE}recordKind`), literal("Allergy")]);
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
